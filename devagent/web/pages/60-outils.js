/* Outils — everything the agent can do, by domain, with its risk level. */
DA.page({
  id: 'outils', title: 'Outils', icon: '🧰', order: 60,
  async render(root, ctx) {
    const { h, api, act } = DA;
    const { tools, domains } = await api('/api/agent/tools');
    const count = r => tools.filter(t => t.risk === r).length;
    root.append(h('p', { class: 'muted' }, `${tools.length} outils. `,
      DA.riskPill('lecture'), ` ${count('lecture')} libres · `,
      DA.riskPill('ecriture'), ` ${count('ecriture')} journalises · `,
      DA.riskPill('irreversible'), ` ${count('irreversible')} avec ta confirmation. `,
      'Le chat, Claude Code et les automatisations utilisent tous cette meme liste.'));
    const out = h('pre', { class: 'card', hidden: true });
    for (const d of domains) {
      const rows = tools.filter(t => t.domain === d).map(t => {
        const params = Object.keys(t.input_schema.properties || {});
        const req = new Set(t.input_schema.required || []);
        const tryBtn = t.risk === 'lecture' && [...req].every(p => p === 'projet') ? h('button', { class: 'btn sm ghost', type: 'button' }, 'Essayer') : null;
        if (tryBtn) tryBtn.onclick = () => act(tryBtn, async () => {
          const r = await api(`/api/agent/tools/${t.name}`, { project_id: ctx.project, args: {} });
          out.hidden = false;
          out.textContent = `${t.name}\n\n` + JSON.stringify(r, null, 2).slice(0, 6000);
          out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        return h('tr', {},
          h('td', { class: 'mono', style: 'white-space:nowrap' }, t.name), h('td', {}, DA.riskPill(t.risk)),
          h('td', {}, t.description),
          h('td', { class: 'mono' }, params.map(p => (req.has(p) ? p + '*' : p)).join(', ')),
          h('td', {}, tryBtn));
      });
      root.append(h('div', { class: 'card' }, h('h2', {}, d),
        h('table', {}, h('thead', {}, h('tr', {}, ...['Outil', 'Risque', 'Ce qu\'il fait', 'Arguments (* obligatoire)', ''].map(x => h('th', {}, x)))),
          h('tbody', {}, ...rows))));
    }
    root.append(out);
  }
});
