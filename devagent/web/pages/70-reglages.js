/* Reglages — Claude Code (MCP), the chat's API key, notifications, the vault. */
DA.page({
  id: 'reglages', title: 'Reglages', icon: '⚙', order: 70,
  async render(root) {
    const { h, api, act, toast } = DA;
    const field = (label, input) => h('label', { class: 'field' }, label, input);
    const [mcp, chat, notif, vault] = await Promise.all([
      api('/api/agent/mcp'), api('/api/agent/chat/config'), api('/api/agent/notify'), api('/api/agent/vault')]);

    /* Claude Code */
    const mcpBtn = h('button', { class: 'btn ' + (mcp.installed ? '' : 'primary'), type: 'button' },
      mcp.installed ? 'Reinstaller' : 'Brancher DevAgent dans Claude Code');
    mcpBtn.onclick = () => act(mcpBtn, async () => {
      const r = await api('/api/agent/mcp', { install: true });
      toast(r.ok ? 'Branche. Ouvre une nouvelle session Claude pour l\'utiliser.' : (r.message || 'Echec'), r.ok ? 'ok' : 'bad');
      DA.show('reglages');
    });
    const mcpOff = mcp.installed ? h('button', { class: 'btn ghost', type: 'button' }, 'Debrancher') : null;
    if (mcpOff) mcpOff.onclick = () => act(mcpOff, async () => { await api('/api/agent/mcp', { install: false }); DA.show('reglages'); });
    root.append(h('div', { class: 'card stack' },
      h('div', { class: 'spread' }, h('h2', {}, 'Claude Code'), DA.pill(mcp.installed ? 'branche' : 'non branche', mcp.installed ? 'ok' : 'warn')),
      h('p', { class: 'muted' }, 'Donne les outils de DevAgent a chaque session Claude Code, dans tous tes projets. ',
        'Aucun cout en plus : c\'est ton abonnement Claude Code.'),
      mcp.claude ? null : h('div', { style: 'color:#ff8fa3' }, 'Claude Code est introuvable sur ce PC.'),
      h('div', { class: 'mono muted' }, mcp.command), h('div', { class: 'row' }, mcpBtn, mcpOff)));

    /* Chat */
    const model = h('input', { class: 'input', value: chat.model });
    const effort = h('select', { class: 'input' }, ...['low', 'medium', 'high', 'xhigh'].map(e => h('option', { value: e }, e)));
    effort.value = chat.effort;
    const saveChat = h('button', { class: 'btn primary', type: 'button' }, 'Enregistrer');
    saveChat.onclick = () => act(saveChat, async () => {
      await api('/api/agent/chat/config', { model: model.value, effort: effort.value });
      toast('Enregistre.', 'ok'); DA.show('reglages');
    });
    root.append(h('div', { class: 'card stack' },
      h('div', { class: 'spread' }, h('h2', {}, 'Chat integre'), DA.pill(chat.configured ? 'pret' : 'sans cle', chat.configured ? 'ok' : 'warn')),
      h('p', { class: 'muted' }, 'La cle API se saisit dans la page ', h('a', { href: '#agent:acces' }, 'Acces'),
        '. Si le modele refuse une demande, l\'API peut la confier a un autre modele (repli active par defaut).'),
      h('div', { class: 'grid' }, field('Modele', model), field('Effort de reflexion', effort)),
      h('div', {}, saveChat)));

    /* Notifications */
    const testN = h('button', { class: 'btn', type: 'button' }, 'Envoyer un message de test');
    testN.onclick = () => act(testN, async () => {
      const r = await api('/api/agent/notify/test', {});
      const lines = Object.entries(r.canaux).map(([c, v]) => `${c} : ${v.ok ? 'envoye' : 'echec — ' + v.erreur}`);
      toast(lines.join(' · ') || r.note, r.envoye ? 'ok' : 'bad');
    });
    root.append(h('div', { class: 'card stack' },
      h('div', { class: 'spread' }, h('h2', {}, 'Notifications'),
        h('span', {}, DA.pill('Telegram', notif.channels.telegram ? 'ok' : ''), ' ', DA.pill('Email', notif.channels.email ? 'ok' : ''))),
      h('p', { class: 'muted' }, 'Ou l\'agent et les automatisations te previennent. Les canaux (Telegram, email) et tous les ',
        'autres acces — DNS, stockage, hebergeurs — se reglent dans la page ', h('a', { href: '#agent:acces' }, 'Acces'), '.'),
      h('div', {}, testN)));

    /* Sync between PCs */
    const sync = await api('/api/agent/sync');
    const syncOut = h('div', { class: 'small' });
    const showSync = r => {
      const parts = [h('div', {}, r.resume)];
      if (r.ailleurs.length) parts.push(h('div', {}, h('b', {}, 'Projets presents sur un autre PC, absents ici : '),
        r.ailleurs.map(a => a.projet + (a.git ? ` (${a.git})` : '')).join(', '), '. Clone-les (tableau de bord → Ajouter un projet), puis resynchronise.'));
      if (r.conflits.length) parts.push(h('div', { style: 'color:#ffb454' }, h('b', {}, 'Modifies sur deux PC : '),
        r.conflits.map(c => c.fichier).join(', '), '. Ce PC garde sa version ; l\'autre est a cote (fichier .autre-pc).'));
      if (r.non_envoyes.length) parts.push(h('div', { class: 'muted' }, 'Non envoyes car ils semblent contenir une cle : ', r.non_envoyes.join(', ')));
      syncOut.replaceChildren(...parts);
    };
    const syncBtn = h('button', { class: 'btn primary', type: 'button' }, sync.branche ? 'Synchroniser maintenant' : 'Brancher la synchronisation');
    syncBtn.onclick = () => act(syncBtn, async () => {
      if (!sync.branche) {
        if (!confirm('Creer (ou utiliser) le depot PRIVE « devagent-etat » sur ton compte GitHub et y envoyer l\'etat de tes projets ? Aucun secret ne part.')) return;
        const c = await api('/api/agent/sync', { connect: true });
        if (!c.ok) throw new Error(c.message);
      }
      const r = await api('/api/agent/sync', {});
      if (!r.ok) throw new Error(r.message);
      toast(r.result.resume, 'ok');
      if (!sync.branche) { DA.show('reglages'); return; }
      showSync(r.result);
    });
    const auto = h('input', { type: 'checkbox' });
    auto.checked = sync.auto;
    auto.addEventListener('change', () => api('/api/agent/sync', { auto: auto.checked }));
    root.append(h('div', { class: 'card stack' },
      h('div', { class: 'spread' }, h('h2', {}, 'Mes projets sur tous mes PC'), DA.pill(sync.branche ? 'branche' : 'non branche', sync.branche ? 'ok' : 'warn')),
      h('p', { class: 'muted' }, 'L\'etat de chaque projet (profil, feuille de route, serveurs, connexions, automatisations, notes de session) ',
        'est partage par un depot GitHub prive. Les cles passent par Bitwarden, pas par ici. Une automatisation n\'est active que sur le PC ou tu l\'as activee.'),
      sync.branche ? h('div', { class: 'small muted' }, `${sync.depot} · derniere synchronisation : ${DA.when(sync.derniere_synchro) || 'jamais'}`) : null,
      sync.branche ? h('label', { class: 'row small' }, auto, 'Synchroniser tout seul toutes les 10 minutes') : null,
      h('div', {}, syncBtn), syncOut));

    /* Vault */
    const clear = vault.reglages_encore_en_clair || [];
    root.append(h('div', { class: 'card stack' },
      h('div', { class: 'spread' }, h('h2', {}, 'Coffre'), DA.pill(clear.length ? `${clear.length} en clair` : 'chiffre', clear.length ? 'bad' : 'ok')),
      h('p', { class: 'muted' }, 'Les tokens et mots de passe sont chiffres dans la base. La cle du coffre est ce fichier : ',
        'garde-en une copie avec tes autres cles. Sans elle, les secrets doivent etre saisis a nouveau.'),
      h('div', { class: 'mono' }, vault.cle, vault.cle_presente ? '' : ' (pas encore creee)'),
      h('div', { class: 'small muted' }, `${vault.reglages_secrets} reglage(s) secret(s) · ${vault.connexions_avec_secret_chiffre} connexion(s) avec un secret chiffre`),
      clear.length ? h('div', { style: 'color:#ff8fa3' }, 'Encore en clair : ', clear.join(', '), ' — relance DevAgent, ou « devagent coffre sceller ».') : null));
  }
});
