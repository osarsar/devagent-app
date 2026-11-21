/* Chat — talk to the agent. One conversation per row on the left. */
DA.page({
  id: 'chat', title: 'Chat', icon: '💬', order: 10,
  async render(root, ctx) {
    const { h, api, act, toast } = DA;
    let chatId = null, seen = 0, timer = null, busy = false;

    const cfg = await api('/api/agent/chat/config');
    if (!cfg.configured) {
      root.append(h('div', { class: 'card stack' },
        h('h2', {}, 'Le chat a besoin d\'une cle API Anthropic'),
        h('p', { class: 'muted' }, 'Le chat integre appelle Claude avec ta propre cle, payee a l\'usage. ',
          'Sans cle, l\'agent reste utilisable gratuitement depuis Claude Code (page Reglages → Claude Code).'),
        h('div', {}, h('a', { class: 'btn primary', href: '#agent:reglages' }, 'Ouvrir les reglages'))));
      return;
    }

    const list = h('div', { class: 'chat-list' });
    const msgs = h('div', { class: 'msgs' });
    const input = h('textarea', { placeholder: 'Demande quelque chose… (Entree pour envoyer, Maj+Entree pour une ligne)', rows: 1 });
    const sendBtn = h('button', { class: 'btn primary', type: 'button' }, 'Envoyer');
    const typing = h('div', { class: 'typing', hidden: true }, 'L\'agent travaille…');
    const guideBtn = h('button', { class: 'btn primary', type: 'button', title: 'L\'agent lit l\'etat reel et te dit quoi faire. Il ne modifie rien.' },
      ctx.project ? '✦ Que faire maintenant ?' : '✦ Le point sur tous mes projets');
    guideBtn.onclick = () => act(guideBtn, async () => {
      const r = await api('/api/agent/guide', { project_id: ctx.project });
      if (!r.ok) throw new Error(r.message);
      await open(r.chat.id);
    });
    root.append(h('div', { class: 'chat' },
      h('div', { class: 'stack' },
        guideBtn,
        h('button', { class: 'btn', type: 'button', onclick: () => open(null) }, '+ Nouvelle conversation'), list),
      h('div', { class: 'chat-main' }, msgs, h('div', { class: 'composer' }, input, sendBtn))));

    function eventNode(e) {
      if (e.type === 'tool') {
        const box = h('details', { class: 'toolcall' },
          h('summary', {}, '🔧 ', h('span', { class: 'mono' }, e.name), DA.statusPill(e.statut)),
          h('pre', { class: 'muted' }, DA.json(e.args) || '(sans argument)'),
          e.message ? h('div', { class: 'small' }, e.message) : null);
        if (e.statut === 'confirmation_requise' && e.confirmation) {
          const zone = h('div', { class: 'confirm' }, h('span', { class: 'small' }, `Confirmation n° ${e.confirmation} : `));
          box.open = true;
          box.append(zone);
          fillConfirm(zone, e.confirmation);
        }
        return box;
      }
      return h('div', { class: 'msg ' + e.type }, e.text || '');
    }

    async function fillConfirm(zone, id) {
      const all = (await api('/api/agent/approvals?status=toutes')).approvals;
      const a = all.find(x => x.id === id);
      if (!a) return;
      if (a.status !== 'attente') { zone.append(DA.statusPill(a.status)); return; }
      if (a.preview) zone.append(h('div', { class: 'small muted', style: 'flex-basis:100%' }, a.preview));
      const yes = h('button', { class: 'btn sm primary', type: 'button' }, 'Confirmer');
      const no = h('button', { class: 'btn sm', type: 'button' }, 'Refuser');
      yes.onclick = () => act(yes, async () => {
        const out = await DA.approve(a);
        if (out) { zone.replaceChildren(DA.statusPill(out.statut === 'ok' ? 'fait' : 'echec')); }
      });
      no.onclick = () => act(no, async () => {
        await api(`/api/agent/approvals/${id}/refuse`, {});
        zone.replaceChildren(DA.statusPill('refuse')); DA.refreshState();
      });
      zone.append(yes, no);
    }

    async function poll() {
      if (!chatId) return;
      let c;
      try { c = await api(`/api/agent/chats/${chatId}?since=${seen}`); } catch (e) { return; }
      if (!c || c.id !== chatId) return;
      const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
      for (const e of c.events) msgs.insertBefore(eventNode(e), typing);
      seen = c.total;
      busy = c.status === 'en_cours';
      typing.hidden = !busy;
      sendBtn.disabled = busy;
      if (atBottom) msgs.scrollTop = msgs.scrollHeight;
      clearTimeout(timer);
      if (busy) timer = setTimeout(poll, 900);
      else loadList();
    }

    async function loadList() {
      const q = ctx.project ? `?project_id=${ctx.project}` : '';
      const { chats } = await api('/api/agent/chats' + q);
      list.replaceChildren(...chats.map(c => h('button', {
        class: 'btn ghost' + (c.id === chatId ? ' on' : ''), type: 'button', title: c.title, onclick: () => open(c.id)
      }, c.title || 'Nouvelle conversation')));
    }

    async function open(id) {
      clearTimeout(timer);
      chatId = id; seen = 0;
      msgs.replaceChildren(typing);
      if (!id) {
        msgs.insertBefore(h('div', { class: 'empty' },
          ctx.project ? `Conversation sur « ${DA.projectName()} ». ` : 'Aucun projet choisi : l\'agent te demandera lequel. ',
          'Exemples : « Ou en est ce projet ? » · « Que manque-t-il avant la mise en ligne ? » · ',
          '« Sauvegarde ce projet chaque nuit ».'), typing);
      } else await poll();
      loadList();
      input.focus();
    }

    async function send() {
      const text = input.value.trim();
      if (!text || busy) return;
      await act(sendBtn, async () => {
        if (!chatId) {
          chatId = (await api('/api/agent/chats', { project_id: ctx.project })).id;
          msgs.replaceChildren(typing);
        }
        const out = await api(`/api/agent/chats/${chatId}/send`, { text });
        if (!out.ok) throw new Error(out.message);
        input.value = '';
        await poll();
      });
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); }
    });
    await loadList();
    const wanted = DA.state.chat; DA.state.chat = null;                             // a conversation asked for by another screen
    await open(wanted || null);
    return () => clearTimeout(timer);
  }
});
