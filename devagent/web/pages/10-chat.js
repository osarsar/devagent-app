/* Chat — talk to the agent. Its actions show as lines, like in Claude Code; when one needs your OK,
   the conversation waits and asks at the bottom, then goes on by itself. */
DA.page({
  id: 'chat', title: 'Chat', icon: '💬', order: 10,
  async render(root, ctx) {
    const { h, api, act } = DA;
    let chatId = null, seen = 0, timer = null, status = 'pret', asked = '';

    const cfg = await api('/api/agent/chat/config');
    if (!cfg.configured) {
      root.append(h('div', { class: 'card stack' },
        h('h2', {}, 'Le chat a besoin d\'une cle API Anthropic'),
        h('p', { class: 'muted' }, 'Le chat integre appelle Claude avec ta propre cle, payee a l\'usage. ',
          'Sans cle, l\'agent reste utilisable gratuitement depuis Claude Code (page Reglages → Claude Code).'),
        h('div', {}, h('a', { class: 'btn primary', href: '#agent:acces' }, 'Ajouter la cle'))));
      return;
    }

    /* ── layout ── */
    const pick = h('select', { class: 'input chat-pick', title: 'Tes conversations' });
    const newBtn = h('button', { class: 'btn sm', type: 'button', title: 'Nouvelle conversation' }, '+ Nouvelle');
    const guideBtn = h('button', { class: 'btn sm primary', type: 'button', title: 'L\'agent lit l\'etat reel et te dit quoi faire. Il ne modifie rien.' },
      ctx.project ? '✦ Que faire ?' : '✦ Le point sur mes projets');
    const msgs = h('div', { class: 'msgs' });
    const working = h('div', { class: 'working', hidden: true }, h('span', { class: 'spark' }, '✦'), 'L\'agent travaille…');
    const ask = h('div', { class: 'permission', hidden: true });
    const input = h('textarea', { rows: 1, placeholder: 'Demande quelque chose a l\'agent…' });
    const sendBtn = h('button', { class: 'send', type: 'button', title: 'Envoyer (Entree)' });
    sendBtn.innerHTML = uiIcon('up', 18);
    root.append(h('div', { class: 'chat2' },
      h('div', { class: 'chat-top' }, pick, newBtn, guideBtn),
      h('div', { class: 'chat-body' }, msgs),
      h('div', { class: 'chat-foot' }, ask, h('div', { class: 'composer2' }, input, sendBtn))));
    msgs.append(working);

    /* ── a few markdown marks, on escaped text ── */
    const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function md(text) {
      const lines = esc(text).split('\n').map(l => l
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/^#{1,4} (.*)$/, '<span class="md-h">$1</span>')
        .replace(/^\s*[-*] (.*)$/, '<span class="md-li">$1</span>')
        .replace(/^\s*(\d+)\. (.*)$/, '<span class="md-li n" data-n="$1.">$2</span>'));
      const el = h('div', { class: 'msg assistant' });
      el.innerHTML = lines.join('\n');
      return el;
    }

    /* ── an action of the agent: one line, like Claude Code ── */
    const short = v => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 48 ? s.slice(0, 47) + '…' : s; };
    function argsText(a) {
      const e = Object.entries(a || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined);
      return e.length ? e.slice(0, 3).map(([k, v]) => `${k}: ${short(v)}`).join(' · ') : '';
    }
    const STATE = { ok: ['ok', ''], erreur: ['bad', 'erreur'], confirmation_requise: ['wait', 'attend ta reponse'],
      fait: ['ok', 'autorise · fait'], refuse: ['off', 'refuse'], echec: ['bad', 'autorise · a echoue'] };
    function toolLine(e) {
      const [cls, label] = STATE[e.statut] || ['off', e.statut];
      const row = h('details', { class: 'act ' + cls, 'data-confirmation': e.confirmation || null },
        h('summary', {}, h('span', { class: 'act-dot' }), h('span', { class: 'act-name' }, e.name),
          h('span', { class: 'act-args' }, argsText(e.args)), h('span', { class: 'act-state' }, label)),
        h('div', { class: 'act-more' },
          e.message ? h('div', { class: 'act-msg' }, '⎿ ', e.message) : null,
          h('pre', {}, DA.json(e.args) || '(sans argument)')));
      return row;
    }
    function decided(e) {                       // the tool line of a confirmation takes its final state
      const row = msgs.querySelector(`.act[data-confirmation="${e.confirmation}"]`);
      if (!row) return null;
      const [cls, label] = STATE[e.statut] || ['off', e.statut];
      row.className = 'act ' + cls;
      row.querySelector('.act-state').textContent = label;
      return null;
    }
    function eventNode(e) {
      if (e.type === 'tool') return toolLine(e);
      if (e.type === 'decision') return decided(e);
      if (e.type === 'assistant') return md(e.text || '');
      return h('div', { class: 'msg ' + e.type }, e.text || '');
    }

    /* ── the question at the bottom, while the agent waits ── */
    async function showAsk(waiting) {
      const key = waiting.map(w => w.confirmation).join(',');
      if (key === asked) return;
      asked = key;
      ask.replaceChildren();
      if (!waiting.length) { ask.hidden = true; return; }
      const all = (await api('/api/agent/approvals')).approvals;
      const first = all.find(a => a.id === waiting[0].confirmation);
      if (!first) { ask.hidden = true; return; }
      const nameIn = first.confirm_name ? h('input', { class: 'input', placeholder: 'tape le nom du projet pour confirmer', autocomplete: 'off' }) : null;
      const yes = h('button', { class: 'btn sm primary', type: 'button' }, 'Autoriser');
      const no = h('button', { class: 'btn sm', type: 'button' }, 'Refuser');
      const decide = (btn, path, body) => act(btn, async () => {
        const out = await api(`/api/agent/approvals/${first.id}/${path}`, body || {});
        if (out && out.nom_requis) throw new Error(out.message);
        asked = ''; ask.hidden = true; DA.refreshState(); poll();
      });
      yes.onclick = () => decide(yes, 'approve', { confirm: nameIn ? nameIn.value : undefined });
      no.onclick = () => decide(no, 'refuse');
      ask.append(...[
        h('div', { class: 'perm-head' }, h('span', { class: 'perm-mark' }, '!'),
          h('div', {}, h('b', {}, 'L\'agent attend ton accord'),
            waiting.length > 1 ? h('span', { class: 'muted small' }, ` · 1 sur ${waiting.length}`) : null)),
        h('div', { class: 'perm-what' }, h('span', { class: 'act-name' }, first.tool),
          h('div', { class: 'perm-detail' }, first.preview || first.reason || argsText(first.args) || first.description || '')),
        nameIn,
        h('div', { class: 'row perm-actions' }, yes, no, h('span', { class: 'muted small' }, 'ou ecris en dessous pour refuser et expliquer'))].filter(Boolean));
      ask.hidden = false;
      (nameIn || yes).focus();
    }

    /* ── the conversation ── */
    async function poll() {
      if (!chatId) return;
      let c;
      try { c = await api(`/api/agent/chats/${chatId}?since=${seen}`); } catch (e) { return; }
      if (!c || c.id !== chatId) return;
      const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
      for (const e of c.events) { const n = eventNode(e); if (n) msgs.insertBefore(n, working); }
      seen = c.total;
      status = c.status;
      working.hidden = status !== 'en_cours';
      sendBtn.disabled = status === 'en_cours';
      await showAsk(c.waiting || []);
      if (atBottom || c.events.length) msgs.scrollTop = msgs.scrollHeight;
      clearTimeout(timer);
      if (status === 'en_cours') timer = setTimeout(poll, 900);
      else if (status === 'attente') timer = setTimeout(poll, 2500);   // a decision may come from another page
      else loadList();
    }

    async function loadList() {
      const q = ctx.project ? `?project_id=${ctx.project}` : '';
      const { chats } = await api('/api/agent/chats' + q);
      pick.replaceChildren(h('option', { value: '' }, chats.length ? 'Nouvelle conversation' : 'Aucune conversation'),
        ...chats.map(c => h('option', { value: c.id }, (c.status === 'attente' ? '● ' : '') + (c.title || 'Conversation'))));
      pick.value = chatId || '';
    }

    async function open(id) {
      clearTimeout(timer);
      chatId = id; seen = 0; asked = ''; status = 'pret';
      ask.hidden = true;
      msgs.replaceChildren(working);
      working.hidden = true;
      if (!id) {
        msgs.insertBefore(h('div', { class: 'empty hello' },
          h('div', { class: 'hello-mark' }, '✦'),
          h('div', {}, ctx.project ? `Que fait-on sur « ${DA.projectName(ctx.project)} » ?` : 'Que fait-on ?'),
          h('div', { class: 'muted small' }, 'Exemples : « Ou en est ce projet ? » · « Que manque-t-il avant la mise en ligne ? » · « Sauvegarde ce projet chaque nuit »')), working);
      } else await poll();
      loadList();
      input.focus();
    }

    async function send() {
      const text = input.value.trim();
      if (!text || status === 'en_cours') return;
      await act(sendBtn, async () => {
        if (!chatId) {
          chatId = (await api('/api/agent/chats', { project_id: ctx.project })).id;
          msgs.replaceChildren(working);
        }
        const out = await api(`/api/agent/chats/${chatId}/send`, { text });
        if (!out.ok) throw new Error(out.message);
        input.value = ''; grow();
        asked = ''; ask.hidden = true;
        await poll();
      });
    }

    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); } });
    sendBtn.addEventListener('click', send);
    pick.addEventListener('change', () => open(Number(pick.value) || null));
    newBtn.addEventListener('click', () => open(null));
    guideBtn.onclick = () => act(guideBtn, async () => {
      const r = await api('/api/agent/guide', { project_id: ctx.project });
      if (!r.ok) throw new Error(r.message);
      await open(r.chat.id);
    });

    await loadList();
    const wanted = DA.state.chat; DA.state.chat = null;                             // a conversation asked for by another screen
    await open(wanted || null);
    if (DA.state.draft) { input.value = DA.state.draft; DA.state.draft = null; grow(); input.focus(); }   // prepared by a button: you read, then send
    return () => clearTimeout(timer);
  }
});
