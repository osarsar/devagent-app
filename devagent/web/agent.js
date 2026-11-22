/* DevAgent — the agent's screens, inside the application.

   Each screen is one file in pages/ and registers itself with DA.page({id, title, icon, order,
   render(root, ctx)}). A screen can be shown as a page of the app (DA.open, called by go('agent:<id>'))
   or mounted anywhere — a tab of a project's workspace, for instance (DA.mount). */
const DA = (() => {
  const pages = [];
  const state = { project: Number(localStorage.getItem('da.project')) || null, projects: [], agent: {}, chat: null };
  const cleanups = new WeakMap();

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

  /* one kind of message for the whole app: the application's own toasts */
  function toast(text, kind) {
    window.toast(text, kind === 'ok' ? 'success' : kind === 'bad' ? 'error' : 'info');
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
  const def = id => pages.find(p => p.id === id);

  function projectName(id) {
    const p = state.projects.find(x => x.id === (id || state.project));
    return p ? p.name : '';
  }

  /* Ask for a password in a small dialog (never a browser prompt: it would show the text). */
  function askPassword(title, hint) {
    return new Promise(resolve => {
      const input = h('input', { class: 'input', type: 'password', autocomplete: 'off' });
      const done = v => { back.remove(); resolve(v); };
      const ok = h('button', { class: 'btn primary', type: 'button', onclick: () => done(input.value) }, 'Valider');
      const no = h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Plus tard');
      const back = h('div', { class: 'da dialog-back' }, h('div', { class: 'card stack dialog', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, title), hint ? h('p', { class: 'muted small' }, hint) : null, input, h('div', { class: 'row' }, ok, no)));
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(input.value); if (ev.key === 'Escape') done(null); });
      document.body.append(back);
      input.focus();
    });
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

  async function refreshState() {
    try {
      state.agent = await api('/api/agent/state');
      for (const [id, n] of [['confirmations', state.agent.waiting], ['afaire', state.agent.todos]]) {
        document.querySelectorAll(`[data-da-badge="${id}"]`).forEach(b => { b.textContent = n; b.hidden = !n; });
      }
      document.body.classList.toggle('agent-paused', !!state.agent.paused);
    } catch (e) { /* shown on the next action */ }
  }

  /* Render a screen into any element. opts: {project, actions (an element for the screen's buttons)} */
  function mount(root, id, opts) {
    const d = def(id);
    if (!root || !d) return;
    const old = cleanups.get(root);
    if (old) { try { old(); } catch (e) { /* ignore */ } cleanups.delete(root); }
    root.classList.add('da');
    root.replaceChildren();
    const o = opts || {};
    const actions = o.actions || h('div', { class: 'actions' });
    if (!o.actions) root.append(h('div', { class: 'da-actions' }, actions));
    else actions.replaceChildren();
    const body = h('div', { class: 'da-body' });
    root.append(body);
    Promise.resolve(d.render(body, { actions, project: o.project === undefined ? state.project : o.project, embedded: !!o.embedded }))
      .then(fn => { if (typeof fn === 'function') cleanups.set(root, fn); })
      .catch(e => body.replaceChildren(h('div', { class: 'empty' }, e.message || String(e))));
  }

  /* Show a screen as a page of the app (called by go('agent:<id>')). Returns its title. */
  function open(id) {
    const d = def(id) || def('accueil') || pages[0];
    if (!d) return '';
    if (d.id === 'chat') setProject(null);                     // the menu's Chat is the general one; a project's chat is in its work station
    const head = document.getElementById('da-head');
    const sel = document.getElementById('da-project');
    if (head) head.hidden = !!d.global;                       // a screen about everything has no project to choose
    if (sel) sel.value = state.project || '';
    mount(document.getElementById('da-root'), d.id, { actions: document.getElementById('da-actions') });
    return d.title;
  }

  function setProject(id) {
    state.project = Number(id) || null;
    localStorage.setItem('da.project', state.project || '');
  }

  /* go to another screen of the agent */
  function show(id) { window.go('agent:' + id); }

  async function init() {
    try { state.projects = (await api('/api/agent/projects')).projects; } catch (e) { /* offline */ }
    if (!state.projects.some(p => p.id === state.project)) state.project = null;
    const sel = document.getElementById('da-project');
    if (sel) {
      sel.replaceChildren(h('option', { value: '' }, 'Tous les projets'),
        ...state.projects.map(p => h('option', { value: p.id }, p.name)));
      sel.value = state.project || '';
      sel.addEventListener('change', () => {
        setProject(sel.value);
        if (state.project && window.currentPage === 'agent:chat') {     // a project chosen in the chat: its work station
          window.openWorkspace(state.project).then(() => window.wsTab('agent'));
          return;
        }
        if (window.currentPage && window.currentPage.startsWith('agent:')) open(window.currentPage.split(':')[1]);
      });
    }
    await refreshState();
    setInterval(refreshState, 8000);
  }

  return { page, mount, open, show, init, setProject, h, api, act, toast, askPassword, pill, riskPill, statusPill, when,
    json, approve, state, projectName, refreshState, title: id => (def(id) || {}).title || '' };
})();
