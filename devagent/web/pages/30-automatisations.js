/* Automatisations — « when this happens, do these steps », per project. */
DA.page({
  id: 'automatisations', title: 'Automatisations', icon: '⏱', order: 30,
  async render(root, ctx) {
    const { h, api, act, toast } = DA;
    const listEl = h('div', { class: 'grid' }), runsEl = h('div'), editor = h('div');
    const q = ctx.project ? `?project_id=${ctx.project}` : '';
    let templates = {};

    root.append(
      h('p', { class: 'muted' }, 'Une automatisation est un fichier YAML dans le projet (.devpilot/automations/). ',
        'L\'agent peut en proposer ; elle ne tourne que si tu l\'actives. Si le fichier change, elle redevient ',
        'inactive. Les automatisations tournent tant que DevAgent est lance.'),
      editor, listEl, h('h2', { style: 'margin-top:22px' }, 'Derniers lancements'), runsEl);

    function trigger(t) {
      if (t.type === 'horaire') return `chaque jour a ${t.a}` + (t.jours ? ` (${t.jours.join(', ')})` : '');
      if (t.type === 'intervalle') return `toutes les ${t.toutes}`;
      if (t.type === 'depot') return `a chaque nouveau commit sur GitHub (${t.branche || 'branche principale'})`;
      return t.type || '?';
    }

    function card(a) {
      const state = a.erreurs.length ? DA.pill('invalide', 'bad')
        : a.actif ? DA.pill('active', 'ok')
          : DA.pill(a.modifie_depuis_activation ? 'modifiee : a reactiver' : 'inactive', a.modifie_depuis_activation ? 'warn' : '');
      const toggle = h('button', { class: 'btn sm ' + (a.actif ? '' : 'primary'), type: 'button' }, a.actif ? 'Desactiver' : 'Activer');
      toggle.onclick = () => act(toggle, async () => {
        const out = await api(`/api/agent/automations/${a.project_id}/${a.nom}/active`, { active: !a.actif });
        if (!out.ok) throw new Error(out.message);
        await load();
      });
      const run = h('button', { class: 'btn sm', type: 'button' }, 'Lancer maintenant');
      run.onclick = () => act(run, async () => {
        const out = await api(`/api/agent/automations/${a.project_id}/${a.nom}/run`, {});
        if (!out.ok) throw new Error(out.message);
        toast(`${a.nom} : ${out.result.statut}` + (out.result.erreur ? ` — ${out.result.erreur}` : ''),
          out.result.statut === 'ok' ? 'ok' : 'bad');
        await load();
      });
      const edit = h('button', { class: 'btn sm ghost', type: 'button', onclick: () => openEditor(a) }, 'Modifier');
      const del = h('button', { class: 'btn sm ghost', type: 'button' }, 'Supprimer');
      del.onclick = () => act(del, async () => {
        if (!confirm(`Supprimer l'automatisation « ${a.nom} » ? (le fichier part a la corbeille)`)) return;
        await api(`/api/agent/automations/${a.project_id}/${a.nom}`, {}, 'DELETE');
        await load();
      });
      return h('div', { class: 'card stack' },
        h('div', { class: 'spread' }, h('h3', {}, a.nom), state),
        h('div', { class: 'small muted' }, `${a.projet} · ${trigger(a.declencheur)}`),
        a.description ? h('div', {}, a.description) : null,
        h('ol', { class: 'small', style: 'margin:0;padding-left:18px' }, ...a.etapes.map(s =>
          h('li', {}, h('span', { class: 'mono' }, s.outil), s.si && s.si !== 'succes' ? ` (si ${s.si})` : ''))),
        a.erreurs.length ? h('div', { class: 'small', style: 'color:#ff8fa3' }, a.erreurs.join(' · ')) : null,
        a.dernier ? h('div', { class: 'small muted' }, 'Dernier : ', DA.when(a.dernier.started_at), ' ', DA.statusPill(a.dernier.status)) : null,
        h('div', { class: 'row' }, toggle, run, edit, del));
    }

    async function openEditor(a) {
      const out = await api(`/api/agent/automations/${a.project_id}/${a.nom}`);
      if (!out.ok) { toast(out.message, 'bad'); return; }
      const area = h('textarea', { rows: 14 });
      area.value = out.result.yaml;
      const save = h('button', { class: 'btn primary', type: 'button' }, 'Enregistrer');
      save.onclick = () => act(save, async () => {
        const r = await api(`/api/agent/automations/${a.project_id}/${a.nom}`, { yaml: area.value }, 'PUT');
        if (!r.ok) throw new Error(r.message);
        toast('Enregistree. Elle est inactive jusqu\'a ce que tu l\'actives.', 'ok');
        editor.replaceChildren(); await load();
      });
      editor.replaceChildren(h('div', { class: 'card stack' },
        h('h2', {}, `Modifier ${a.nom}`), area,
        h('div', { class: 'row' }, save, h('button', { class: 'btn', type: 'button', onclick: () => editor.replaceChildren() }, 'Annuler'))));
      area.focus();
    }

    function addBar() {
      if (!ctx.project) return h('div', { class: 'card muted' }, 'Choisis un projet (en haut a gauche) pour ajouter une automatisation.');
      const sel = h('select', { class: 'input', style: 'max-width:260px' },
        ...Object.entries(templates).map(([k, t]) => h('option', { value: k, title: t.description }, k)));
      const desc = h('span', { class: 'small muted' });
      const sync = () => { desc.textContent = (templates[sel.value] || {}).description || ''; };
      sel.addEventListener('change', sync); sync();
      const add = h('button', { class: 'btn primary', type: 'button' }, 'Ajouter depuis ce modele');
      add.onclick = () => act(add, async () => {
        const r = await api(`/api/agent/automations/${ctx.project}/template`, { template: sel.value });
        if (!r.ok) throw new Error(r.message);
        toast('Ajoutee, inactive. Relis-la puis active-la.', 'ok');
        await load();
      });
      return h('div', { class: 'card row' }, h('b', {}, `Nouvelle automatisation pour ${DA.projectName()} :`), sel, add, desc);
    }

    async function load() {
      const data = await api('/api/agent/automations' + q);
      templates = data.templates;
      const bar = addBar();
      listEl.replaceChildren(...(data.automations.length ? data.automations.map(card)
        : [h('div', { class: 'empty card' }, 'Aucune automatisation.')]));
      if (!root.querySelector('#auto-add')) { bar.id = 'auto-add'; root.insertBefore(bar, editor); }
      if (data.paused) toast('L\'agent est en pause : aucune automatisation ne tourne.', 'bad');
      const { runs } = await api('/api/agent/automations/runs' + (q ? q + '&limit=25' : '?limit=25'));
      runsEl.replaceChildren(runs.length ? h('table', {},
        h('thead', {}, h('tr', {}, ...['Quand', 'Projet', 'Automatisation', 'Declencheur', 'Etat', 'Etapes'].map(t => h('th', {}, t)))),
        h('tbody', {}, ...runs.map(r => h('tr', {},
          h('td', { class: 'small' }, DA.when(r.started_at)), h('td', {}, r.project_name || ''), h('td', {}, r.name),
          h('td', { class: 'small' }, r.trigger), h('td', {}, DA.statusPill(r.status)),
          h('td', { class: 'small mono' }, r.steps.map(s => `${s.outil}:${s.statut}` + (s.message ? ` (${s.message})` : '')).join(' → ')))))
      ) : h('div', { class: 'empty' }, 'Aucun lancement pour l\'instant.'));
    }
    await load();
  }
});
