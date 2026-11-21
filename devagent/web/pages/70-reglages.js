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
    const key = h('input', { class: 'input', type: 'password', placeholder: chat.key_saved ? '•••• (enregistree)' : 'sk-ant-…', autocomplete: 'off' });
    const model = h('input', { class: 'input', value: chat.model });
    const effort = h('select', { class: 'input' }, ...['low', 'medium', 'high', 'xhigh'].map(e => h('option', { value: e }, e)));
    effort.value = chat.effort;
    const saveChat = h('button', { class: 'btn primary', type: 'button' }, 'Enregistrer');
    saveChat.onclick = () => act(saveChat, async () => {
      const body = { model: model.value, effort: effort.value };
      if (key.value.trim()) body.api_key = key.value;
      await api('/api/agent/chat/config', body);
      toast('Enregistre.', 'ok'); DA.show('reglages');
    });
    root.append(h('div', { class: 'card stack' },
      h('div', { class: 'spread' }, h('h2', {}, 'Chat integre'), DA.pill(chat.configured ? 'pret' : 'sans cle', chat.configured ? 'ok' : 'warn')),
      h('p', { class: 'muted' }, 'Le chat appelle Claude avec ta cle API Anthropic, payee a l\'usage. La cle est chiffree dans le coffre. ',
        'Si le modele refuse une demande, l\'API peut la confier a un autre modele (repli active par defaut).'),
      h('div', { class: 'grid' }, field('Cle API Anthropic', key), field('Modele', model), field('Effort de reflexion', effort)),
      h('div', {}, saveChat)));

    /* Notifications */
    const s = notif.settings;
    const inputs = {};
    const mk = (k, label, type) => { inputs[k] = h('input', { class: 'input', type: type || 'text', value: s[k] || '', autocomplete: 'off' }); return field(label, inputs[k]); };
    const saveN = h('button', { class: 'btn primary', type: 'button' }, 'Enregistrer');
    saveN.onclick = () => act(saveN, async () => {
      const body = {};
      for (const [k, el] of Object.entries(inputs)) body[k] = el.value;
      await api('/api/agent/notify', body);
      toast('Enregistre.', 'ok'); DA.show('reglages');
    });
    const testN = h('button', { class: 'btn', type: 'button' }, 'Envoyer un message de test');
    testN.onclick = () => act(testN, async () => {
      const r = await api('/api/agent/notify/test', {});
      const lines = Object.entries(r.canaux).map(([c, v]) => `${c} : ${v.ok ? 'envoye' : 'echec — ' + v.erreur}`);
      toast(lines.join(' · ') || r.note, r.envoye ? 'ok' : 'bad');
    });
    root.append(h('div', { class: 'card stack' },
      h('div', { class: 'spread' }, h('h2', {}, 'Notifications et DNS'),
        h('span', {}, DA.pill('Telegram', notif.channels.telegram ? 'ok' : ''), ' ', DA.pill('Email', notif.channels.email ? 'ok' : ''))),
      h('p', { class: 'muted' }, 'Ou l\'agent et les automatisations te previennent (site en panne, sauvegarde ratee…). ',
        'Sans canal, les messages restent dans le journal de DevAgent.'),
      h('h3', {}, 'Telegram'),
      h('div', { class: 'grid' }, mk('notify_telegram_bot_token', 'Token du bot (via @BotFather)', 'password'), mk('notify_telegram_chat_id', 'Identifiant du chat')),
      h('h3', {}, 'Email (SMTP)'),
      h('div', { class: 'grid' }, mk('notify_smtp_host', 'Serveur SMTP'), mk('notify_smtp_port', 'Port (587 ou 465)'),
        mk('notify_smtp_user', 'Utilisateur'), mk('notify_smtp_password', 'Mot de passe', 'password'),
        mk('notify_email_from', 'Expediteur'), mk('notify_email_to', 'Destinataire')),
      h('h3', {}, 'DNS'),
      h('p', { class: 'muted small' }, 'Avec tes acces chez le fournisseur DNS du domaine (Cloudflare, OVH ou Hostinger), l\'agent peut ',
        'ecrire les enregistrements. Chaque ecriture attend ta confirmation, avec la liste de ce qui change. ',
        'OVH : cree les trois cles sur auth.eu.ovhcloud.com/api/createToken avec les droits GET, POST et PUT sur /domain/zone/*.'),
      h('div', { class: 'grid' }, mk('dns_cloudflare_api_token', 'Cloudflare — token API (DNS lecture + ecriture)', 'password'),
        mk('dns_hostinger_api_token', 'Hostinger — token API', 'password'),
        mk('dns_ovh_application_key', 'OVH — application key', 'password'),
        mk('dns_ovh_application_secret', 'OVH — application secret', 'password'),
        mk('dns_ovh_consumer_key', 'OVH — consumer key', 'password')),
      h('div', { class: 'row' }, saveN, testN)));

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
