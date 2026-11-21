/* DevAgent — the shell of the interface. Each screen registers itself with
   DA.page({...}) from its own file in pages/. */
const DA = (() => {
  const pages = [];
  /* /agent?projet=3#carte opens the page on a given project (links from the dashboard) */
  const asked = Number(new URLSearchParams(location.search).get('projet')) || null;
  const state = { project: asked || Number(localStorage.getItem('da.project')) || null, projects: [], agent: {} };
  let current = null, cleanup = null;

  /* h('div', {class:'x', onclick:fn}, child, 'text', [more]) — text is never parsed as HTML */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  async function api(path, body, method) {
    const opt = body !== undefined || method
      ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }
      : {};
    let r;
    try { r = await fetch(path, opt); }
    catch (e) { throw new Error('DevAgent ne repond pas (est-il lance ?)'); }
    let data = null;
    try { data = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok && !(data && (data.message || data.statut))) throw new Error(`Erreur ${r.status}`);
    return data;
  }

  function toast(text, kind) {
    const t = h('div', { class: 'toast ' + (kind || '') }, text);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), kind === 'bad' ? 9000 : 4500);
  }

  /* Run an async action from a button: disabled while it runs, errors shown. */
  async function act(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { toast(e.message || String(e), 'bad'); }
    finally { if (btn) btn.disabled = false; }
  }

  const pill = (text, kind) => h('span', { class: 'pill ' + (kind || '') }, text);
  const riskPill = r => pill(r, r === 'irreversible' ? 'bad' : r === 'ecriture' ? 'warn' : '');
  const statusPill = s => pill(s, { ok: 'ok', fait: 'ok', erreur: 'bad', echec: 'bad', refuse: 'bad',
    attente: 'warn', confirmation_requise: 'warn', en_cours: 'info' }[s] || '');
  const when = iso => iso ? String(iso).replace('T', ' ').slice(0, 16) : '';
  const json = v => { const s = JSON.stringify(v); return s === undefined || s === '{}' || s === 'null' ? '' : s; };

  function page(def) { pages.push(def); pages.sort((a, b) => (a.order || 99) - (b.order || 99)); }

  function projectName(id) {
    const p = state.projects.find(x => x.id === (id || state.project));
    return p ? p.name : '';
  }

  /* Approve a waiting action. Asks for the project name when the tool requires it. */
  async function approve(a) {
    let confirmText;
    if (a.confirm_name) {
      confirmText = prompt(`Action irreversible : ${a.tool}\n\nTape le nom du projet pour confirmer :`);
      if (confirmText === null) return null;
    } else if (!confirm(`Confirmer : ${a.tool} ?\n${a.preview || json(a.args)}`)) return null;
    const out = await api(`/api/agent/approvals/${a.id}/approve`, { confirm: confirmText });
    if (out.statut === 'ok') toast('Action faite.', 'ok');
    else toast(out.message || 'Echec', 'bad');
    refreshState();
    return out;
  }

  /* Ask for a password in a small dialog (never a browser prompt: it would show the text). */
  function askPassword(title, hint) {
    return new Promise(resolve => {
      const input = h('input', { class: 'input', type: 'password', autocomplete: 'off' });
      const done = v => { back.remove(); resolve(v); };
      const ok = h('button', { class: 'btn primary', type: 'button', onclick: () => done(input.value) }, 'Valider');
      const no = h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Plus tard');
      const back = h('div', { class: 'dialog-back' }, h('div', { class: 'card stack dialog', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, title), hint ? h('p', { class: 'muted small' }, hint) : null, input, h('div', { class: 'row' }, ok, no)));
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(input.value); if (ev.key === 'Escape') done(null); });
      document.body.append(back);
      input.focus();
    });
  }

  async function refreshState() {
    try {
      state.agent = await api('/api/agent/state');
      for (const [id, n] of [['confirmations', state.agent.waiting], ['afaire', state.agent.todos]]) {
        const b = document.querySelector(`.nav-item[data-id="${id}"] .badge`);
        if (b) { b.textContent = n; b.hidden = !n; }
      }
      const pb = document.getElementById('pause-btn');
      pb.textContent = state.agent.paused ? '▶ Reprendre l\'agent' : '⏸ Mettre l\'agent en pause';
      pb.classList.toggle('danger', !!state.agent.paused);
    } catch (e) { /* shown on the next action */ }
  }

  function show(id) {
    const def = pages.find(p => p.id === id) || pages[0];
    if (!def) return;
    if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
    current = def;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('on', n.dataset.id === def.id));
    document.getElementById('page-title').textContent = def.title;
    document.title = `${def.title} — DevAgent`;
    const root = document.getElementById('page');
    const actions = document.getElementById('page-actions');
    root.replaceChildren(); actions.replaceChildren();
    Promise.resolve(def.render(root, { actions, project: state.project }))
      .then(fn => { if (typeof fn === 'function') cleanup = fn; })
      .catch(e => root.replaceChildren(h('div', { class: 'empty' }, e.message || String(e))));
  }

  async function start() {
    const nav = document.getElementById('nav');
    for (const p of pages) {
      nav.append(h('a', { class: 'nav-item', href: '#' + p.id, 'data-id': p.id },
        h('span', { class: 'ico' }, p.icon || '•'), p.title,
        (p.id === 'confirmations' || p.id === 'afaire') ? h('span', { class: 'badge', hidden: true }) : null));
    }
    // the rest of the application, in the same menu (the dashboard lists the agent's screens too)
    const dash = [['projects', '📁', 'Projets'], ['dashboard', '▦', 'Vue d\'ensemble'], ['sessions', '>_', 'Sessions'],
      ['running', '▶', 'En cours'], ['storage', '🗄', 'Stockage'], ['docker', '🐳', 'Docker'], ['network', '🖧', 'Reseau'],
      ['caches', '⚡', 'Caches'], ['cloud', '☁', 'Cloud Sync'], ['timeline', '🕘', 'Timeline'], ['settings', '⚙', 'Parametres']];
    const navDash = document.getElementById('nav-dash');
    for (const [id, icon, title] of dash) {
      const a = h('a', { class: 'nav-item', href: '/#' + id }, h('span', { class: 'ico' }, icon), title);
      if (id === 'projects') a.addEventListener('click', () => { if (state.project) a.href = '/#workspace:' + state.project; });
      navDash.append(a);
    }
    const sel = document.getElementById('project-select');
    try { state.projects = (await api('/api/agent/projects')).projects; } catch (e) { toast(e.message, 'bad'); }
    sel.append(h('option', { value: '' }, 'Tous les projets'));
    for (const p of state.projects) sel.append(h('option', { value: p.id }, p.name));
    if (!state.projects.some(p => p.id === state.project)) state.project = null;
    sel.value = state.project || '';
    sel.addEventListener('change', () => {
      state.project = Number(sel.value) || null;
      localStorage.setItem('da.project', state.project || '');
      show(current && current.id);
    });
    document.getElementById('pause-btn').addEventListener('click', ev => act(ev.currentTarget, async () => {
      await api('/api/agent/pause', { paused: !state.agent.paused });
      await refreshState();
      toast(state.agent.paused ? 'Agent en pause : il ne fait plus que lire.' : 'Agent actif.');
    }));
    window.addEventListener('hashchange', () => show(location.hash.slice(1)));
    await refreshState();
    setInterval(refreshState, 8000);
    // opening DevAgent: straight to what waits for the user, when something does
    show(location.hash.slice(1) || (state.agent.todos ? 'afaire' : state.agent.waiting ? 'confirmations' : 'chat'));
  }

  return { page, start, h, api, act, toast, askPassword, pill, riskPill, statusPill, when, json, approve, state,
    projectName, refreshState, show };
})();
