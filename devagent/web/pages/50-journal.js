/* Journal — every write made by the agent, the automations or the interface. */
DA.page({
  id: 'journal', title: 'Journal', icon: '📜', order: 50,
  async render(root, ctx) {
    const { h, api } = DA;
    const q = ctx.project ? `?project_id=${ctx.project}&limit=200` : '?limit=200';
    const { actions } = await api('/api/agent/journal' + q);
    root.append(h('p', { class: 'muted' }, 'Chaque action qui change quelque chose laisse une ligne ici : qui, quoi, quand, ',
      'avec quel resultat. Les lectures ne sont pas notees. Aucun secret n\'est ecrit.'));
    if (!actions.length) { root.append(h('div', { class: 'empty card' }, 'Aucune action pour l\'instant.')); return; }
    root.append(h('table', {},
      h('thead', {}, h('tr', {}, ...['Quand', 'Qui', 'Outil', 'Risque', 'Etat', 'Arguments', 'Resultat'].map(t => h('th', {}, t)))),
      h('tbody', {}, ...actions.map(a => h('tr', {},
        h('td', { class: 'small' }, DA.when(a.at)), h('td', { class: 'small' }, a.actor),
        h('td', { class: 'mono' }, a.tool), h('td', {}, DA.riskPill(a.risk)), h('td', {}, DA.statusPill(a.status)),
        h('td', { class: 'mono' }, DA.json(a.args)),
        h('td', { class: 'mono' }, (a.result || '').slice(0, 220)))))));
  }
});
