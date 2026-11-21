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
    /* Missing tools noted by the agent: build them with Claude Code, or mark them done */
    const wanted = (await api('/api/agent/tool-requests')).requests;
    if (wanted.length) {
      root.append(h('div', { class: 'card stack' },
        h('div', { class: 'spread' }, h('h2', {}, 'Outils qui manquent'), DA.pill(`${wanted.length} demande(s)`, 'warn')),
        h('p', { class: 'muted' }, 'L\'agent les a notes quand il a du passer par une commande ou te renvoyer vers un site. ',
          '« Construire » ouvre Claude Code dans le code de DevAgent avec la demande deja redigee : il ecrit l\'outil et son test ',
          'sur une branche. Le nouvel outil n\'est actif qu\'apres ta relecture et un redemarrage de DevAgent.'),
        ...wanted.map(r => {
          const build = h('button', { class: 'btn sm primary', type: 'button' }, 'Construire avec Claude Code');
          const cmdBox = h('pre', { class: 'muted small', hidden: true });
          build.onclick = () => act(build, async () => {
            const x = await api(`/api/agent/tool-requests/${r.id}`, { build: true });
            if (!x.ok) throw new Error(x.message);
            cmdBox.hidden = false;
            cmdBox.textContent = (x.result.opened ? 'Claude Code s\'ouvre dans un terminal. Sinon, lance :\n' : 'Lance dans un terminal :\n') + x.result.command;
          });
          const done = h('button', { class: 'btn sm', type: 'button' }, 'C\'est fait');
          done.onclick = () => act(done, async () => { await api(`/api/agent/tool-requests/${r.id}`, { status: 'faite' }); DA.show('outils'); });
          const drop = h('button', { class: 'btn sm ghost', type: 'button' }, 'Ecarter');
          drop.onclick = () => act(drop, async () => { await api(`/api/agent/tool-requests/${r.id}`, { status: 'ecartee' }); DA.show('outils'); });
          return h('div', { class: 'stack', style: 'border-top:1px solid var(--border-1);padding-top:10px' },
            h('div', {}, h('b', {}, r.need), h('span', { class: 'muted small' }, `  · ${DA.when(r.at)} · ${r.actor}`)),
            r.example ? h('div', { class: 'mono muted' }, 'En attendant : ', r.example) : null,
            h('div', { class: 'row' }, build, done, drop), cmdBox);
        })));
    }
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
