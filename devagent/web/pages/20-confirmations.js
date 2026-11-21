/* Confirmations — irreversible actions waiting for the user's decision. */
DA.page({
  id: 'confirmations', title: 'Confirmations', icon: '⚠', order: 20,
  async render(root) {
    const { h, api, act } = DA;
    const waiting = h('div', { class: 'stack' }), past = h('div');
    root.append(
      h('p', { class: 'muted' }, 'Une action irreversible (supprimer, restaurer, deployer…) n\'est jamais faite par ',
        'l\'agent. Elle attend ici : c\'est ta confirmation qui la lance.'),
      waiting, h('h2', { style: 'margin-top:22px' }, 'Deja traitees'), past);

    async function load() {
      const all = (await api('/api/agent/approvals?status=toutes')).approvals;
      const w = all.filter(a => a.status === 'attente');
      waiting.replaceChildren(...(w.length ? w.map(card) : [h('div', { class: 'empty card' }, 'Rien n\'attend ta confirmation.')]));
      const done = all.filter(a => a.status !== 'attente');
      past.replaceChildren(done.length ? h('table', {},
        h('thead', {}, h('tr', {}, ...['N°', 'Quand', 'Outil', 'Arguments', 'Demande par', 'Etat'].map(t => h('th', {}, t)))),
        h('tbody', {}, ...done.map(a => h('tr', {},
          h('td', {}, a.id), h('td', { class: 'small' }, DA.when(a.created_at)), h('td', { class: 'mono' }, a.tool),
          h('td', { class: 'mono' }, DA.json(a.args)), h('td', { class: 'small' }, a.actor),
          h('td', {}, DA.statusPill(a.status)))))) : h('div', { class: 'empty' }, 'Aucune pour l\'instant.'));
      DA.refreshState();
    }

    function card(a) {
      const yes = h('button', { class: 'btn primary', type: 'button' }, 'Confirmer et lancer');
      const no = h('button', { class: 'btn', type: 'button' }, 'Refuser');
      yes.onclick = () => act(yes, async () => { await DA.approve(a); await load(); });
      no.onclick = () => act(no, async () => { await api(`/api/agent/approvals/${a.id}/refuse`, {}); await load(); });
      return h('div', { class: 'card stack' },
        h('div', { class: 'spread' },
          h('h3', {}, `N° ${a.id} — `, h('span', { class: 'mono' }, a.tool)),
          h('span', { class: 'small muted' }, `${a.actor} · ${DA.when(a.created_at)}`)),
        a.description ? h('div', { class: 'muted' }, a.description) : null,
        h('pre', {}, DA.json(a.args) || '(sans argument)'),
        a.reason ? h('div', {}, DA.pill('motif', 'warn'), ' ', a.reason) : null,
        a.preview ? h('div', {}, DA.pill('ce qui sera lance', 'info'), ' ', a.preview) : null,
        a.confirm_name ? h('div', { class: 'small muted' }, 'Il faudra taper le nom du projet.') : null,
        h('div', { class: 'row' }, yes, no));
    }

    await load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }
});
