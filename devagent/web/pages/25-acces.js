/* Acces — every platform DevAgent connects to: what it is for, its keys, where to create
   or renew them, whether they work, when they expire. */
DA.page({
  id: 'acces', title: 'Acces', icon: '🔑', order: 25,
  async render(root, ctx) {
    const { h, api, act, toast } = DA;
    const STATE = { ok: ['fonctionne', 'ok'], a_tester: ['a tester', 'info'], absent: ['pas saisi', ''],
      en_panne: ['en panne', 'bad'], expire: ['expire', 'bad'], expire_bientot: ['expire bientot', 'warn'] };
    const pillOf = s => DA.pill((STATE[s] || [s])[0], (STATE[s] || [])[1]);
    const head = h('div'), list = h('div', { class: 'grid' }), bwBox = h('div');
    let bw = { etat: 'absent' };

    /* Send the keys of this PC to Bitwarden (asks the master password; « Plus tard » skips). */
    async function sendToBitwarden(why) {
      if (bw.etat === 'absent' || bw.etat === 'deconnecte') return;
      const pw = await DA.askPassword('Mot de passe maitre Bitwarden',
        (why || 'Pour envoyer les cles de ce PC vers Bitwarden.') + ' Il n\'est pas garde.');
      if (!pw) { toast('Cle enregistree sur ce PC seulement. Pense a l\'envoyer vers Bitwarden.'); return; }
      const r = await api('/api/agent/bitwarden/push', { password: pw });
      if (!r.ok) throw new Error(r.message);
      toast(`Bitwarden a jour : ${r.result.cles.length} cle(s), ${r.result.hebergeurs.length} hebergeur(s).`, 'ok');
      await loadBw();
    }

    async function loadBw() {
      bw = await api('/api/agent/bitwarden');
      const label = { absent: 'pas installe', deconnecte: 'pas connecte', verrouille: 'connecte', ouvert: 'connecte' }[bw.etat];
      const ready = bw.etat === 'verrouille' || bw.etat === 'ouvert';
      const push = h('button', { class: 'btn sm primary', type: 'button' }, 'Envoyer vers Bitwarden');
      push.onclick = () => act(push, () => sendToBitwarden());
      const pull = h('button', { class: 'btn sm', type: 'button' }, 'Recuperer de Bitwarden');
      pull.onclick = () => act(pull, async () => {
        const pw = await DA.askPassword('Mot de passe maitre Bitwarden', 'Pour recuperer les cles sur ce PC. Il n\'est pas garde.');
        if (!pw) return;
        const r = await api('/api/agent/bitwarden/pull', { password: pw });
        if (!r.ok) throw new Error(r.message);
        toast(`${r.result.cles.length} cle(s) et ${r.result.hebergeurs.length} hebergeur(s) recuperes. Je les teste…`, 'ok');
        await api('/api/agent/access/test', {});
        await load();
      });
      bwBox.replaceChildren(h('div', { class: 'card stack' },
        h('div', { class: 'spread' }, h('h2', {}, 'Bitwarden — tes cles sur tous tes PC'), DA.pill(label, ready ? 'ok' : 'warn')),
        h('p', { class: 'muted' }, 'Toutes les cles de cette page sont gardees dans une note de ton Bitwarden (« ', bw.note || '',
          ' »). Sur un nouveau PC : tu te connectes, tu recuperes, et tout est en place. Quand tu ajoutes ou renouvelles une cle ici, ',
          'DevAgent te demande ton mot de passe maitre et met Bitwarden a jour.'),
        ready ? h('div', { class: 'small muted' }, `Compte ${bw.email || '?'} · dernier envoi : ${DA.when(bw.dernier_envoi) || 'jamais'}`,
          ` · derniere recuperation : ${DA.when(bw.derniere_recuperation) || 'jamais'}`)
          : h('div', { class: 'small' }, bw.etat === 'absent' ? 'Installe-le : ' : 'Connecte ce PC une fois, dans un terminal : ',
            h('code', {}, bw.etat === 'absent' ? 'sudo snap install bw' : 'devagent coffre connecter')),
        ready ? h('div', { class: 'row' }, push, pull) : null));
    }

    const testAll = h('button', { class: 'btn primary', type: 'button' }, 'Tester tous les acces');
    testAll.onclick = () => act(testAll, async () => {
      const r = await api('/api/agent/access/test', {});
      if (!r.ok) throw new Error(r.message);
      toast(r.result.resume, r.result.tout_ok ? 'ok' : 'bad');
      await load();
    });
    ctx.actions.append(testAll);
    root.append(
      h('p', { class: 'muted' }, 'Les cles sont chiffrees dans le coffre. L\'agent voit leur etat, jamais leur valeur. ',
        'Une cle ne se renouvelle pas toute seule : il faut ton identifiant sur la plateforme. DevAgent te dit laquelle ',
        'ne marche plus ou expire bientot, et t\'ouvre la bonne page.'),
      bwBox, head, list);

    function card(e) {
      const inputs = {};
      const fields = e.fields.map(f => {
        inputs[f.key] = h('input', { class: 'input', type: f.secret ? 'password' : 'text', autocomplete: 'off',
          value: f.secret ? '' : (f.value || ''),
          placeholder: f.secret ? (f.set ? '•••• (enregistre) — laisse vide pour garder' : '') : '' });
        return h('label', { class: 'field' }, f.label + (f.optional ? ' (facultatif)' : ''), inputs[f.key]);
      });
      const save = e.fields.length ? h('button', { class: 'btn sm primary', type: 'button' }, 'Enregistrer') : null;
      if (save) save.onclick = () => act(save, async () => {
        const body = {};
        for (const f of e.fields) {
          const v = inputs[f.key].value;
          if (f.secret ? v.trim() : true) body[f.key] = v;        // an empty secret field keeps the stored key
        }
        await api('/api/agent/access', body);
        const r = await api('/api/agent/access/test', { key: e.key });
        if (r.ok) toast(`${e.label} : ${r.result.resume}`, r.result.tout_ok ? 'ok' : 'bad');
        await load();
        await sendToBitwarden(`« ${e.label} » est enregistre sur ce PC. Pour que tes autres PC l'aient aussi.`);
      });
      const test = e.configured ? h('button', { class: 'btn sm', type: 'button' }, 'Tester') : null;
      if (test) test.onclick = () => act(test, async () => {
        const r = await api('/api/agent/access/test', { key: e.key });
        if (!r.ok) throw new Error(r.message);
        toast(`${e.label} : ${r.result.resume}`, r.result.tout_ok ? 'ok' : 'bad');
        await load();
      });
      const link = e.create_url ? h('a', { class: 'btn sm ghost', href: e.create_url, target: '_blank', rel: 'noopener' },
        e.state === 'absent' ? 'Creer la cle ↗' : 'Renouveler / modifier ↗') : null;
      return h('div', { class: 'card stack' },
        h('div', { class: 'spread' }, h('h3', {}, e.label), pillOf(e.state)),
        h('div', { class: 'muted small' }, e.role),
        h('div', { class: 'small' }, e.explain),
        e.last && e.last.at ? h('div', { class: 'small muted' }, 'Dernier test : ', DA.when(e.last.at)) : null,
        h('details', { class: 'small' }, h('summary', { style: 'cursor:pointer' }, 'Comment obtenir la cle'), h('p', { class: 'muted' }, e.how)),
        fields.length ? h('div', { class: 'stack' }, ...fields) : null,
        h('div', { class: 'row' }, save, test, link));
    }

    function hostingAdd() {
      const platform = h('select', { class: 'input' }, ...['vercel', 'netlify', 'railway', 'render', 'fly', 'cloudflare'].map(p => h('option', { value: p }, p)));
      const token = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Token du compte' });
      const add = h('button', { class: 'btn sm primary', type: 'button' }, 'Ajouter le compte');
      add.onclick = () => act(add, async () => {
        const r = await api('/api/hosting/accounts', { platform: platform.value, token: token.value });
        if (!r || r.success === false) throw new Error((r && r.message) || 'Echec');
        toast('Compte ajoute et verifie.', 'ok');
        await load();
        await sendToBitwarden('Le compte est enregistre sur ce PC. Pour que tes autres PC l\'aient aussi.');
      });
      return h('div', { class: 'card stack' },
        h('h3', {}, 'Ajouter un hebergeur'),
        h('div', { class: 'muted small' }, 'Vercel, Netlify, Railway… Le token est verifie aupres de la plateforme avant d\'etre garde. ',
          h('a', { href: 'https://vercel.com/account/tokens', target: '_blank', rel: 'noopener' }, 'Creer un token Vercel ↗')),
        h('label', { class: 'field' }, 'Plateforme', platform), h('label', { class: 'field' }, 'Token', token),
        h('div', {}, add));
    }

    async function load() {
      const q = ctx.project ? `?project_id=${ctx.project}` : '';
      const data = await api('/api/agent/access' + q);
      const p = data.project;
      head.replaceChildren(...(p ? [h('div', { class: 'card stack' },
        h('div', { class: 'spread' }, h('h2', {}, `Ce dont « ${p.projet} » a besoin`),
          DA.pill(p.a_regler ? `${p.a_regler} a regler` : 'rien ne bloque', p.a_regler ? 'bad' : 'ok')),
        h('table', {}, h('thead', {}, h('tr', {}, ...['Besoin', 'Acces', 'Etat', 'Explication'].map(t => h('th', {}, t)))),
          h('tbody', {}, ...p.besoins.map(r => h('tr', {},
            h('td', {}, r.besoin), h('td', {}, r.acces || '—'),
            h('td', {}, r.etat === 'info' ? DA.pill('info') : pillOf(r.etat)),
            h('td', { class: 'small' }, r.explication,
              r.ou ? [' ', h('a', { href: r.ou, target: '_blank', rel: 'noopener' }, 'ouvrir ↗')] : null))))))] : []));
      const order = { en_panne: 0, expire: 0, expire_bientot: 1, a_tester: 2, ok: 3, absent: 4 };
      const items = [...data.access].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));
      list.replaceChildren(...items.map(card), hostingAdd());
    }
    await loadBw();
    await load();
  }
});
