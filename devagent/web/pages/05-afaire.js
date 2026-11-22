/* A faire par toi — what the agent could not do itself and asks you to do. */
DA.page({
  id: 'afaire', title: 'A faire par toi', icon: '☑', order: 5,
  async render(root, ctx) {
    const { h, api, act, toast } = DA;
    const list = h('div', { class: 'stack' }), past = h('div');
    root.append(
      h('p', { class: 'muted' }, 'Ce que l\'agent n\'a pas pu faire lui-meme : un accord a donner sur un site, une cle a creer, ',
        'une decision a prendre. Quand DevAgent peut le constater, il raye la ligne tout seul.'),
      list, h('h2', { style: 'margin-top:22px' }, 'Deja faites'), past);

    /* the agent takes over (an answer, a check): open its conversation, in the project when there is one */
    function follow(chat) {
      DA.state.chat = chat;
      if (ctx.project || DA.state.project) openWorkspace(ctx.project || DA.state.project).then(() => wsTab('agent'));
      else DA.show('chat');
    }
    async function todo(t, action, btn, text) {
      return act(btn, async () => {
        const r = await api(`/api/agent/todos/${t.id}`, { action, text });
        if (r && r.ok === false) throw new Error(r.message);
        if (r.chat) {
          toast(action === 'answer' ? 'Reponse envoyee : l\'agent continue.' : 'L\'agent verifie…', 'ok');
          if (t.project_id) { DA.setProject(t.project_id); }
          follow(r.chat);
          return;
        }
        if (action === 'verify') toast(r.closed && r.closed.length ? 'C\'est bien fait : je raye la ligne.' : 'Pas encore fait, d\'apres ce que je vois.', r.closed && r.closed.length ? 'ok' : '');
        await load(false);
      });
    }

    function card(t) {
      const drop = h('button', { class: 'btn sm ghost', type: 'button' }, 'Ecarter');
      drop.onclick = () => todo(t, 'drop', drop);
      const head = h('div', { class: 'spread' }, h('h3', {}, t.est_question ? h('span', { class: 'todo-q' }, '?') : null, ' ', t.title),
        h('span', {}, t.project ? DA.pill(t.project, 'info') : null, ' ', t.check_tool ? DA.pill('verifie tout seul', 'ok') : null));
      const foot = h('div', { class: 'small muted' }, `Note le ${DA.when(t.at)} par ${t.actor}`,
        t.last_check ? ` · derniere verification : ${DA.when(t.last_check)}` : '');
      if (t.est_question) {
        const box = h('textarea', { rows: 2, placeholder: 'Ta reponse… l\'agent la recoit et continue' });
        const send = h('button', { class: 'send-mini', type: 'button', title: 'Envoyer a l\'agent (Ctrl+Entree)' });
        send.innerHTML = uiIcon('up', 16);
        const go = () => box.value.trim() ? todo(t, 'answer', send, box.value.trim()) : box.focus();
        send.onclick = go;
        box.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); go(); } });
        return h('div', { class: 'card stack question-card' }, head,
          t.question && t.question !== t.title ? h('div', { class: 'todo-ask' }, t.question) : null,
          t.why ? h('div', { class: 'muted' }, t.why) : null,
          t.how ? h('pre', { style: 'font-family:inherit;font-size:14px' }, t.how) : null,
          h('div', { class: 'todo-reply' }, box, send),
          h('div', { class: 'row' }, t.link ? h('a', { class: 'btn sm', href: t.link, target: '_blank', rel: 'noopener' }, 'Ouvrir la page ↗') : null, drop),
          foot);
      }
      const verify = h('button', { class: 'btn sm' + (t.link ? '' : ' primary'), type: 'button',
        title: t.check_tool ? 'DevAgent verifie tout de suite' : 'L\'agent regarde avec ses outils si c\'est fait' }, 'Verifier');
      verify.onclick = () => todo(t, 'verify', verify);
      const done = h('button', { class: 'btn sm ghost', type: 'button', title: 'Tu l\'as fait : la ligne est rayee sans verification' }, 'Marquer fait');
      done.onclick = () => todo(t, 'done', done);
      return h('div', { class: 'card stack' }, head,
        t.why ? h('div', { class: 'muted' }, t.why) : null,
        t.how ? h('pre', { style: 'font-family:inherit;font-size:14px' }, t.how) : null,
        h('div', { class: 'row' },
          t.link ? h('a', { class: 'btn sm primary', href: t.link, target: '_blank', rel: 'noopener' }, 'Ouvrir la page ↗') : null,
          verify, done, drop),
        foot);
    }

    async function load(check) {
      const q = (ctx.project ? `project_id=${ctx.project}&` : '') + `check=${check === false ? 0 : 1}`;
      const data = await api('/api/agent/todos?' + q);
      if (data.closed.length) toast(`Fait entre-temps : ${data.closed.map(c => c.titre).join(', ')}`, 'ok');
      list.replaceChildren(...(data.open.length ? data.open.map(card)
        : [h('div', { class: 'empty card' }, 'Rien a faire de ton cote. ',
          h('a', { href: '#agent:chat' }, 'Demande a l\'agent « que faire maintenant ? »'))]));
      past.replaceChildren(data.done.length ? h('table', {}, h('tbody', {}, ...data.done.map(t => h('tr', {},
        h('td', {}, t.title), h('td', { class: 'small muted' }, t.project || ''),
        h('td', { class: 'small muted' }, `${DA.when(t.done_at)} · ${{ verification: 'constate par DevAgent', reponse: 'repondu par toi' }[t.done_by] || 'coche'}`)))))
        : h('div', { class: 'empty' }, 'Aucune pour l\'instant.'));
      DA.refreshState();
    }
    await load();
  }
});
