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

    function card(t) {
      const done = h('button', { class: 'btn sm primary', type: 'button' }, 'C\'est fait');
      done.onclick = () => act(done, async () => { await api(`/api/agent/todos/${t.id}`, { action: 'done' }); await load(false); });
      const drop = h('button', { class: 'btn sm ghost', type: 'button' }, 'Ecarter');
      drop.onclick = () => act(drop, async () => { await api(`/api/agent/todos/${t.id}`, { action: 'drop' }); await load(false); });
      const verify = t.check_tool ? h('button', { class: 'btn sm', type: 'button' }, 'Verifier maintenant') : null;
      if (verify) verify.onclick = () => act(verify, async () => {
        const r = await api(`/api/agent/todos/${t.id}`, { action: 'check' });
        toast(r.closed.length ? 'C\'est bien fait : je raye la ligne.' : 'Pas encore fait, d\'apres ce que je vois.', r.closed.length ? 'ok' : '');
        await load(false);
      });
      const ask = h('a', { class: 'btn sm ghost', href: '#agent:chat' }, 'En parler a l\'agent');
      return h('div', { class: 'card stack' },
        h('div', { class: 'spread' }, h('h3', {}, t.title),
          h('span', {}, t.project ? DA.pill(t.project, 'info') : null, ' ', t.check_tool ? DA.pill('verifie tout seul', 'ok') : null)),
        t.why ? h('div', { class: 'muted' }, t.why) : null,
        t.how ? h('pre', { style: 'font-family:inherit;font-size:14px' }, t.how) : null,
        h('div', { class: 'row' },
          t.link ? h('a', { class: 'btn sm primary', href: t.link, target: '_blank', rel: 'noopener' }, 'Ouvrir la page ↗') : null,
          t.link ? null : done, verify, t.link ? done : null, drop, ask),
        h('div', { class: 'small muted' }, `Note le ${DA.when(t.at)} par ${t.actor}`,
          t.last_check ? ` · derniere verification : ${DA.when(t.last_check)}` : ''));
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
        h('td', { class: 'small muted' }, `${DA.when(t.done_at)} · ${t.done_by === 'verification' ? 'constate par DevAgent' : 'coche par toi'}`)))))
        : h('div', { class: 'empty' }, 'Aucune pour l\'instant.'));
      DA.refreshState();
    }
    await load();
  }
});
