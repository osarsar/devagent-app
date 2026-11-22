/* Accueil — what matters now, across every project: ask the agent, what waits for you,
   what is wrong, and where each project stands. */
DA.page({
  id: 'accueil', title: 'Accueil', icon: '⌂', order: 0, global: true,
  async render(root) {
    const { h, api, act, toast } = DA;
    const d = await api('/api/agent/home');
    const chat = await api('/api/agent/chat/config');

    /* ask the agent, from the first screen */
    const input = h('input', { class: 'ask-input', type: 'text', autocomplete: 'off',
      placeholder: chat.configured ? 'Demande quelque chose a l\'agent…' : 'Ajoute ta cle API dans Acces et cles pour parler a l\'agent ici' });
    const send = h('button', { class: 'ask-send', type: 'button', title: 'Envoyer' }, '↑');
    async function ask(text) {
      if (!text.trim()) return;
      if (!chat.configured) { DA.show('acces'); return; }
      const c = await api('/api/agent/chats', { project_id: null });
      const r = await api(`/api/agent/chats/${c.id}/send`, { text });
      if (!r.ok) throw new Error(r.message);
      DA.state.chat = c.id;
      DA.setProject(null);
      DA.show('chat');
    }
    send.onclick = () => act(send, () => ask(input.value));
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') act(send, () => ask(input.value)); });
    const guide = h('button', { class: 'chip', type: 'button' }, '✦ Le point sur tous mes projets');
    guide.onclick = () => act(guide, async () => {
      if (!chat.configured) { DA.show('acces'); return; }
      const r = await api('/api/agent/guide', { project_id: null });
      if (!r.ok) throw new Error(r.message);
      DA.state.chat = r.chat.id; DA.setProject(null); DA.show('chat');
    });
    const n = d.a_faire_total + d.confirmations_total;
    root.append(h('section', { class: 'hero' },
      h('h1', {}, n ? `${n} chose${n > 1 ? 's' : ''} t'attend${n > 1 ? 'ent' : ''}. ` : 'Tout est en ordre. ',
        h('em', {}, 'Que fait-on ?')),
      h('div', { class: 'ask' }, h('span', { class: 'ask-mark' }, '✦'), input, send),
      h('div', { class: 'row chips' }, guide,
        h('a', { class: 'chip', href: '#agent:automatisations' }, 'Automatisations'),
        h('a', { class: 'chip', href: '#agent:acces' }, 'Acces et cles'),
        d.pause ? DA.pill('agent en pause', 'bad') : null)));

    /* what waits for the user | what is wrong */
    const todo = h('div', { class: 'card stack' },
      h('div', { class: 'spread' }, h('h2', {}, 'A faire par toi'),
        h('a', { class: 'small', href: '#agent:afaire' }, d.a_faire_total ? `tout voir (${d.a_faire_total})` : '')),
      ...(d.a_faire.length ? d.a_faire.slice(0, 5).map(t => h('div', { class: 'line' },
        h('span', { class: 'dot warn' }),
        h('div', { class: 'line-main' }, h('b', {}, t.titre), t.projet ? h('span', { class: 'muted small' }, ' · ' + t.projet) : null,
          t.pourquoi ? h('div', { class: 'muted small' }, t.pourquoi) : null),
        t.lien ? h('a', { class: 'btn sm primary', href: t.lien, target: '_blank', rel: 'noopener' }, 'Ouvrir ↗')
          : h('a', { class: 'btn sm', href: '#agent:afaire' }, 'Voir')))
        : [h('div', { class: 'muted' }, 'Rien a faire de ton cote.')]),
      ...(d.confirmations_total ? [h('div', { class: 'line' }, h('span', { class: 'dot bad' }),
        h('div', { class: 'line-main' }, h('b', {}, `${d.confirmations_total} action(s) attendent ta confirmation`),
          h('div', { class: 'muted small' }, d.confirmations.map(a => a.tool).join(', '))),
        h('a', { class: 'btn sm primary', href: '#agent:confirmations' }, 'Decider'))] : []));

    const alerts = h('div', { class: 'card stack' },
      h('h2', {}, 'A surveiller'),
      ...(d.alertes.length ? d.alertes.slice(0, 6).map(a => {
        const open = a.projet ? () => openWorkspace(a.projet) : a.page ? () => go(a.page) : null;
        return h('div', { class: 'line' }, h('span', { class: 'dot ' + a.niveau }),
          h('div', { class: 'line-main' }, h('b', {}, a.titre), h('div', { class: 'muted small' }, a.texte)),
          a.lien ? h('a', { class: 'btn sm', href: a.lien, target: '_blank', rel: 'noopener' }, 'Renouveler ↗')
            : open ? h('button', { class: 'btn sm', type: 'button', onclick: open }, 'Voir') : null);
      }) : [h('div', { class: 'muted' }, 'Aucune alerte : sites, acces et automatisations vont bien.')]));
    root.append(h('div', { class: 'two' }, todo, alerts));

    /* the projects */
    const health = { ok: 'va bien', warn: 'a regarder', bad: 'a un probleme' };
    root.append(h('div', { class: 'spread section-head' }, h('h2', {}, 'Projets'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => go('projects') }, 'Gerer les projets')));
    root.append(h('div', { class: 'grid projects' }, ...d.projets.map(p => {
      const pct = p.total ? Math.round(p.fait * 100 / p.total) : 0;
      const guideBtn = h('button', { class: 'btn sm', type: 'button' }, '✦ Que faire ?');
      guideBtn.onclick = ev => { ev.stopPropagation(); openWorkspace(p.id).then(() => wsTab('agent')); };
      const card = h('div', { class: 'card stack project', tabindex: 0, role: 'button' },
        h('div', { class: 'spread' }, h('h3', {}, p.nom), h('span', { class: 'health ' + p.sante }, h('span', { class: 'dot ' + p.sante }), health[p.sante])),
        p.description ? h('div', { class: 'muted small clamp' }, p.description) : null,
        h('div', { class: 'progress-line' }, h('i', { style: `width:${pct}%` })),
        h('div', { class: 'small' }, h('span', { class: 'muted' }, `${p.phase || 'Sans feuille de route'} · ${p.fait}/${p.total}`)),
        p.prochaine ? h('div', {}, h('span', { class: 'muted small' }, 'Prochaine etape  '), p.prochaine) : null,
        h('div', { class: 'row tags' },
          p.site === 'ok' ? DA.pill(p.domaine, 'ok') : p.site === 'en_panne' ? DA.pill(p.domaine + ' ne repond pas', 'bad') : p.domaine ? DA.pill(p.domaine) : null,
          p.non_envoye ? DA.pill('travail non envoye', 'warn') : null,
          p.automatisations ? DA.pill(`${p.automatisations} automatisation(s)`, 'info') : null,
          ...p.manque.slice(0, 2).map(m => DA.pill('manque : ' + m))),
        h('div', { class: 'row' }, h('button', { class: 'btn sm primary', type: 'button', onclick: ev => { ev.stopPropagation(); openWorkspace(p.id); } }, 'Ouvrir'), guideBtn));
      card.addEventListener('click', () => openWorkspace(p.id));
      card.addEventListener('keydown', ev => { if (ev.key === 'Enter') openWorkspace(p.id); });
      return card;
    })));
    if (!d.projets.length) root.append(h('div', { class: 'empty card' }, 'Aucun projet. ', h('a', { href: '#projects' }, 'Ajoute ton premier projet.')));

    /* the PC, the sync, the last actions */
    root.append(h('div', { class: 'two foot' },
      h('div', { class: 'card stack' }, h('h2', {}, 'Dernieres actions'),
        ...(d.activite.length ? d.activite.slice(0, 6).map(a => h('div', { class: 'line small' },
          DA.statusPill(a.status), h('div', { class: 'line-main' }, h('span', { class: 'mono' }, a.tool), h('span', { class: 'muted' }, ` · ${a.actor}`)),
          h('span', { class: 'muted' }, DA.when(a.at)))) : [h('div', { class: 'muted' }, 'Aucune action pour l\'instant.')]),
        h('a', { class: 'small', href: '#agent:journal' }, 'Tout le journal')),
      h('div', { class: 'card stack' }, h('h2', {}, 'Ce PC'),
        h('div', { class: 'line' }, h('span', { class: 'dot ' + (d.systeme.libre_go < 5 ? 'bad' : 'ok') }),
          h('div', { class: 'line-main' }, 'Disque', h('div', { class: 'muted small' }, `${d.systeme.libre_go} Go libres (${d.systeme.pourcent} % utilises)`)),
          h('button', { class: 'btn sm', type: 'button', onclick: () => go('storage') }, 'Voir')),
        h('div', { class: 'line' }, h('span', { class: 'dot ' + (d.sync.branche ? 'ok' : 'warn') }),
          h('div', { class: 'line-main' }, 'Mes projets sur tous mes PC',
            h('div', { class: 'muted small' }, d.sync.branche ? `synchronise · ${DA.when(d.sync.derniere_synchro) || 'jamais'}` : 'non branche')),
          h('a', { class: 'btn sm', href: '#agent:reglages' }, 'Regler')))));
  }
});
