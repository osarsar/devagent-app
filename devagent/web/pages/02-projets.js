/* Projets — every project, what it needs now, and one click to work on it with the agent.
   Managing a project (rename, move, clean, delete) is in its « ⋯ » menu: the dialogs of the app. */
DA.page({
  id: 'projets', title: 'Projets', icon: '▦', order: 2, global: true,
  async render(root) {
    const { h, api, act } = DA;
    const [{ projets }, legacy, unregistered, chat] = await Promise.all([
      api('/api/agent/projets'), api('/api/projects').catch(() => []),
      api('/api/projects/unregistered').catch(() => []), api('/api/agent/chat/config').catch(() => ({}))]);
    window.projectsCache = legacy;                                     // the management dialogs read it
    const ports = Object.fromEntries(legacy.map(p => [p.id, p.running_ports || []]));
    let filter = localStorage.getItem('da.projets.filtre') || 'active', query = '';

    async function guide(p, btn) {
      if (!chat.configured) return openWorkspace(p.id);
      await act(btn, async () => {
        const r = await api('/api/agent/guide', { project_id: p.id });
        if (!r.ok) throw new Error(r.message);
        DA.state.chat = r.chat.id;
        openWorkspace(p.id);
      });
    }
    async function setStatus(p, status) {
      await api(`/api/projects/${p.id}/lifecycle`, { status });
      DA.toast({ active: 'Projet repris', paused: 'Projet en pause', done: 'Projet termine' }[status], 'ok');
      DA.show('projets');
    }

    function menu(p) {
      const item = (label, fn, cls) => h('button', { type: 'button', class: 'menu-item ' + (cls || ''),
        onclick: ev => { ev.stopPropagation(); box.open = false; fn(); } }, label);
      const box = h('details', { class: 'menu', onclick: ev => ev.stopPropagation() },
        h('summary', { class: 'btn sm ghost', title: 'Gerer le projet' }, '⋯'),
        h('div', { class: 'menu-list' },
          item('Modifier le nom et la description', () => editProject(p.id)),
          p.statut === 'active' ? item('Mettre en pause', () => setStatus(p, 'paused')) : item('Reprendre', () => setStatus(p, 'active')),
          p.statut !== 'done' ? item('Marquer termine', () => setStatus(p, 'done')) : null,
          item('Deplacer ou dupliquer', () => openMoveModal(p.id)),
          p.dossier_present ? item('Ouvrir le dossier', () => runOpenFolder(p.chemin)) : null,
          item('Nettoyer (caches, Docker…)', () => showCleanupPreview(p.id)),
          item('Supprimer…', () => openDeleteModal(p.id), 'danger')));
      box.addEventListener('toggle', () => {           // one menu open at a time
        if (box.open) root.querySelectorAll('.menu[open]').forEach(m => { if (m !== box) m.open = false; });
      });
      return box;
    }

    function card(p) {
      const pct = p.total ? Math.round(p.fait * 100 / p.total) : 0;
      const running = ports[p.id] || [];
      const health = { ok: 'va bien', warn: 'a regarder', bad: 'a un probleme' }[p.sante];
      const signals = [
        !p.dossier_present ? DA.pill('dossier introuvable', 'bad') : null,
        p.domaine ? DA.pill((p.site === 'en_panne' ? '⚠ ' : '🌐 ') + p.domaine + (p.site === 'en_panne' ? ' ne repond pas' : ''),
          p.site === 'ok' ? 'ok' : p.site === 'en_panne' ? 'bad' : '') : null,
        running.length ? DA.pill('▶ en local :' + running.join(' :'), 'info') : null,
        p.non_envoye ? DA.pill('travail non envoye', 'warn') : null,
        p.nb_confirmations ? DA.pill(`${p.nb_confirmations} confirmation(s) en attente`, 'bad') : null,
        p.automatisations ? DA.pill(`${p.automatisations} automatisation(s)` + (p.automatisations_en_echec ? ' · echec' : ''),
          p.automatisations_en_echec ? 'bad' : '') : null,
        ...p.manque.slice(0, 3).map(m => DA.pill('manque : ' + m))].filter(Boolean);
      const guideBtn = h('button', { class: 'btn sm', type: 'button', title: 'L\'agent lit l\'etat reel du projet et te dit quoi faire' }, '✦ Que faire ?');
      guideBtn.onclick = ev => { ev.stopPropagation(); guide(p, guideBtn); };
      const el = h('article', { class: 'card stack pcard' + (p.statut !== 'active' ? ' dim' : ''), tabindex: 0, role: 'button',
          'aria-label': 'Ouvrir ' + p.nom, style: p.couleur ? `--pc:${p.couleur}` : null },
        h('div', { class: 'spread' },
          h('div', { class: 'row pcard-title' }, h('span', { class: 'pdot' }), h('h3', {}, p.nom),
            p.statut === 'paused' ? DA.pill('en pause') : p.statut === 'done' ? DA.pill('termine') : null),
          h('span', { class: 'health ' + p.sante }, h('span', { class: 'dot ' + p.sante }), health)),
        p.description ? h('p', { class: 'muted small clamp' }, p.description) : null,
        h('div', { class: 'stack tight' },
          h('div', { class: 'spread small' }, h('span', {}, h('b', {}, p.phase || 'Sans feuille de route')),
            p.total ? h('span', { class: 'muted' }, `${p.fait}/${p.total} etapes`) : null),
          h('div', { class: 'progress-line' }, h('i', { style: `width:${pct}%` })),
          p.prochaine ? h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Prochaine etape · '), p.prochaine) : null),
        signals.length ? h('div', { class: 'row tags' }, ...signals) : null,
        h('div', { class: 'pres', 'data-pid': p.id }),                 // disk and live use, filled by refreshRes()
        h('div', { class: 'row pcard-foot' },
          h('button', { class: 'btn sm primary', type: 'button', onclick: ev => { ev.stopPropagation(); openWorkspace(p.id); } }, 'Ouvrir'),
          guideBtn, h('span', { class: 'grow' }), menu(p)));
      el.addEventListener('click', () => openWorkspace(p.id));
      el.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target === el) openWorkspace(p.id); });
      return el;
    }

    const counts = { active: 0, paused: 0, done: 0 };
    projets.forEach(p => { counts[p.statut] = (counts[p.statut] || 0) + 1; });
    const grid = h('div', { class: 'grid pgrid' });
    const seg = h('div', { class: 'seg' });
    function draw() {
      seg.replaceChildren(...[['active', 'Actifs'], ['paused', 'En pause'], ['done', 'Termines'], ['all', 'Tous']].map(([k, label]) =>
        h('button', { type: 'button', class: filter === k ? 'on' : '', onclick: () => { filter = k; localStorage.setItem('da.projets.filtre', k); draw(); } },
          label, h('span', { class: 'seg-n' }, k === 'all' ? projets.length : counts[k] || 0))));
      const q = query.toLowerCase();
      const shown = projets.filter(p => (filter === 'all' || p.statut === filter)
        && (!q || (p.nom + ' ' + p.description + ' ' + (p.domaine || '')).toLowerCase().includes(q)));
      grid.replaceChildren(...(shown.length ? shown.map(card)
        : [h('div', { class: 'empty card' }, projets.length ? 'Aucun projet ici.' : 'Aucun projet pour l\'instant.')]));
    }
    const search = h('input', { class: 'input search', type: 'search', placeholder: 'Chercher un projet…' });
    search.addEventListener('input', () => { query = search.value; draw(); });

    root.append(h('div', { class: 'spread phead' },
      h('div', { class: 'row' }, seg, search),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openAddProject() }, '+ Nouveau projet')));
    if (unregistered.length) root.append(h('div', { class: 'note-line' },
      h('span', {}, unregistered.length === 1 ? 'Le dossier ' : 'Les dossiers ', h('b', {}, unregistered.map(f => f.name).join(', ')),
        unregistered.length === 1 ? ' est dans tes projets mais DevAgent ne le suit pas.' : ' sont dans tes projets mais DevAgent ne les suit pas.'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => openAddProject('folder') }, 'Ajouter')));
    root.append(grid);
    draw();

    /* what each project costs this PC: disk always, RAM / CPU / GPU while it runs (every 5 s) */
    let resTimer = null;
    async function refreshRes() {
      let r;
      try { r = (await api('/api/agent/ressources')).projets; } catch (e) { r = null; }
      if (r) root.querySelectorAll('.pres').forEach(el => {
        const x = r[el.dataset.pid];
        if (!x) return;
        const disk = x.disque ? octets(x.disque) : (x.disque_en_cours ? 'mesure…' : '—');
        el.innerHTML = `<span class="pres-item" title="Place sur le disque">${uiIcon('disk', 12)} ${disk}</span>`
          + (x.en_marche
            ? `<span class="pres-item on" title="Consommation en direct"><span class="st-dot ok"></span>RAM ${octets(x.ram)} · CPU ${String(x.cpu).replace('.', ',')} %${x.gpu ? ' · GPU ' + octets(x.gpu) : ''}</span>`
            : '<span class="pres-item off">ne tourne pas</span>');
      });
      resTimer = setTimeout(refreshRes, 5000);
    }
    refreshRes();
    return () => clearTimeout(resTimer);
  }
});
