/* ═══════════════════════════════════════════════════════════
   PAGE: PROJECTS
   ═══════════════════════════════════════════════════════════ */
let projectFilter = 'all';
let detailPid = null;

async function loadProjects() {
    const proj = await api('projects'); projectsCache = proj;
    // Load specs status for all projects (which ones have specs)
    window._projectSpecs = {};
    await Promise.all(proj.map(async p => {
        try {
            const s = await api('projects/' + p.id + '/specs');
            if (s && s.prompt) window._projectSpecs[p.id] = true;
        } catch(e) {}
    }));
    renderProjectGrid();
    renderUnregisteredBanner();
}

function renderProjectGrid() {
    const search = (document.getElementById('proj-search')?.value || '').toLowerCase();
    let filtered = projectFilter === 'all' ? projectsCache : projectsCache.filter(p => p.status === projectFilter);
    if (search) {
        filtered = filtered.filter(p =>
            p.name.toLowerCase().includes(search) ||
            (p.description || '').toLowerCase().includes(search) ||
            (p.path || '').toLowerCase().includes(search)
        );
    }

    document.getElementById('proj-count').textContent = filtered.length;

    ['all','active','paused','done'].forEach(f => {
        const el = document.getElementById('f-' + f);
        if (el) el.style.borderColor = f === projectFilter ? 'var(--violet)' : '';
    });

    if (!filtered.length) {
        document.getElementById('projects-grid').innerHTML = `<div class="card" style="grid-column:1/-1;text-align:center;padding:48px"><p style="color:var(--text-4);margin-bottom:12px">${search ? 'Aucun projet pour "' + search + '"' : projectFilter === 'all' ? 'Aucun projet.' : 'Aucun projet ' + projectFilter + '.'}</p></div>`;
        return;
    }

    const statusBadge = { active: 'badge-emerald', paused: 'badge-amber', done: 'badge-violet' };
    const statusLabel = { active: 'Actif', paused: 'Pause', done: 'Termine' };

    const hasSpecs = window._projectSpecs || {};

    document.getElementById('projects-grid').innerHTML = filtered.map(p => {
        const specs = hasSpecs[p.id];
        return `<div class="card project-card" onclick="${selectMode ? `toggleProjectSelect(${p.id}, event)` : `showProjectDetail(${p.id})`}" style="${p.status === 'done' ? 'opacity:.6' : ''}${selectMode && selectedProjects.has(p.id) ? ';border-color:var(--rose);background:var(--rose-dim)' : ''}">
            <div class="accent-bar" style="background:${p.color};position:absolute;top:0;left:0;right:0;height:2px;border-radius:var(--radius) var(--radius) 0 0"></div>
            <div style="padding-top:4px">
                <div class="flex-between mb-8">
                    <div class="flex gap-8" style="align-items:center">
                        ${selectMode ? `<input type="checkbox" id="sel-${p.id}" ${selectedProjects.has(p.id) ? 'checked' : ''} onclick="toggleProjectSelect(${p.id}, event)" style="accent-color:var(--rose);width:15px;height:15px;cursor:pointer">` : ''}
                        <span style="font-weight:700;font-size:13px;color:var(--text-0)">${p.name}</span>
                    </div>
                    <div class="flex gap-6">
                        ${p.profile && WIZ_PROFILES[p.profile] ? `<span class="badge" style="background:rgba(109,92,255,.12);color:var(--violet)" title="${p.components?.length || 0} composants">${WIZ_PROFILES[p.profile].icon} ${WIZ_PROFILES[p.profile].label}</span>` : ''}
                        ${specs ? '<span class="badge badge-sky" title="Specs & Prompt disponibles">Specs</span>' : ''}
                        ${p.git_remote ? '<span class="badge badge-emerald" title="' + hx(p.git_remote) + '">GitHub</span>' : '<span class="badge badge-amber" title="Pas encore lie a GitHub">Pas de GitHub</span>'}
                        ${p.state === 'missing' ? '<span class="badge" style="background:var(--rose-dim);color:var(--rose)" title="Dossier introuvable">Introuvable</span>' : ''}
                        <span class="badge ${statusBadge[p.status] || 'badge-violet'}">${statusLabel[p.status] || p.status}</span>
                    </div>
                </div>
                <div class="card-value" style="font-size:18px;color:${p.color}">${p.disk_size_h || p.total_size_h}</div>
                ${(p.running_ports || []).length ? `<div style="margin-top:6px;font-size:10px;color:var(--emerald)">● en marche : ${p.running_ports.map(x => ':' + x).join(' ')}</div>` : ''}
                ${p.phase && p.phase.total ? `<div style="margin-top:6px;font-size:10px;color:var(--text-3)"><span class="badge badge-violet" style="font-size:9px">${hx(p.phase.current_label)}</span> ${p.phase.done}/${p.phase.total}${p.phase.next ? ' · <span style="color:var(--text-2)">' + hx(p.phase.next) + '</span>' : (p.phase.complete ? ' · <span style="color:var(--emerald)">en production</span>' : '')}</div>` : ''}
                ${p.needs ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;align-items:center">
                    <span style="font-size:10px;color:${p.needs.profile ? 'var(--text-2)' : 'var(--amber)'}">${p.needs.profile ? hx(p.needs.label) : 'Type non defini'}</span>
                    ${p.needs.controller ? '<span class="badge badge-sky" style="font-size:9px">console</span>' : ''}
                    ${p.needs.total ? `<span style="font-size:10px;color:var(--text-4)">${p.needs.done}/${p.needs.total}</span>` : ''}
                    ${p.needs.items.map(x => `<span title="${hx(x.label)} : ${hx((NEED_STATE[x.state] || NEED_STATE.missing).label)}" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${(NEED_STATE[x.state] || NEED_STATE.missing).dot}"></span>`).join('')}
                </div>` : ''}
                ${p.path ? `<div class="mono" style="font-size:9px;color:${p.state === 'missing' ? 'var(--rose)' : 'var(--text-4)'};margin-top:6px;${p.state === 'missing' ? 'text-decoration:line-through' : ''}">${hx(p.path)}</div>` : ''}
                <div class="mt-8 flex-between">
                    <span style="font-size:10px;color:var(--text-4)">${p.created_at ? p.created_at.slice(0,10) : ''}</span>
                    ${specs ? '<span class="badge badge-sky">Specs</span>' : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

function filterProjects(f) { projectFilter = f; renderProjectGrid(); }

async function showProjectDetail(pid) {
    detailPid = pid;
    document.getElementById('project-detail').style.display = 'block';
    document.getElementById('detail-stats').innerHTML = '<div class="loading-state" style="grid-column:1/-1;padding:20px"><div class="spinner"></div> Chargement...</div>';
    document.getElementById('detail-specs-section').style.display = 'none';

    const [data, specs] = await Promise.all([api('projects/' + pid + '/status'), api('projects/' + pid + '/specs')]);
    const p = data.project;
    const g = data.git;
    const wd = specs?.wizard_data || {};
    const hasSpecs = !!(specs && specs.prompt);

    // Title
    document.getElementById('detail-title').innerHTML = `<span style="color:${p.color}">${p.name}</span>`;
    document.getElementById('btn-edit').onclick = () => editProject(pid);
    const pn = (projectsCache.find(x => x.id === pid) || {}).needs;
    const needsBox = document.getElementById('detail-needs');
    const pph = (projectsCache.find(x => x.id === pid) || {}).phase;
    if (needsBox) needsBox.innerHTML = (pph && pph.total ? `<div style="font-size:12px;margin-bottom:6px"><span class="badge badge-violet">${hx(pph.current_label)}</span> <span style="color:var(--text-4)">${pph.done}/${pph.total}</span>${pph.next ? ' · Prochaine etape : <b>' + hx(pph.next) + '</b>' : ''} <button class="btn btn-xs" onclick="openWorkspace(${pid}).then(() => wsTab('roadmap'))">Feuille de route</button></div>` : '') + (pn ? `<div class="flex gap-6" style="align-items:center;flex-wrap:wrap;font-size:12px">
        <span>${pn.profile ? '<b>' + hx(pn.label) + '</b>' : '<span style="color:var(--amber)">Type non defini</span>'}</span>
        ${pn.controller ? '<span class="badge badge-sky">console</span>' : ''}
        ${pn.items.map(x => needChip(x, false)).join(' ')}
        <button class="btn btn-xs" onclick="openModelModal(${pid})">Type &amp; besoins</button></div>` : '');
    document.getElementById('btn-cleanup-preview').onclick = () => showCleanupPreview(pid);
    document.getElementById('btn-delete-proj').onclick = () => openDeleteModal(pid);
    document.getElementById('btn-open-folder').onclick = () => { if (p.path) runOpenFolder(p.path); else toast('Pas de dossier lie', 'error'); };
    document.getElementById('btn-workspace').onclick = () => openWorkspace(pid);

    // Show "Console" + "Mettre à jour" buttons if project has a run.sh or server.py
    const consoleBtnEl = document.getElementById('btn-launch-console');
    const updateBtnEl = document.getElementById('btn-update-console');
    if (data.controller) {
        consoleBtnEl.style.display = '';
        consoleBtnEl.innerHTML = ctrlDot(data.controller.status) + 'Console ' + hx(data.controller.name || '');
        consoleBtnEl.onclick = () => launchProjectConsole(pid);
        updateBtnEl.style.display = data.has_console ? '' : 'none';
        updateBtnEl.onclick = () => updateProjectConsole(pid, updateBtnEl);
    } else {
        consoleBtnEl.style.display = 'none';
        updateBtnEl.style.display = 'none';
    }

    // Lifecycle buttons
    ['active','paused','done'].forEach(s => {
        const btn = document.getElementById('btn-status-' + s);
        btn.style.borderColor = p.status === s ? 'var(--violet)' : '';
        btn.style.color = p.status === s ? 'var(--violet)' : '';
    });

    // Info bar (client, type, tech, domain)
    if (hasSpecs) {
        const techLabels = {nextjs:'Next.js',react:'React',vue:'Vue.js',nuxt:'Nuxt',svelte:'SvelteKit',html:'HTML/CSS',astro:'Astro',
            fastapi:'FastAPI',flask:'Flask',express:'Express',nestjs:'NestJS',django:'Django',laravel:'Laravel',
            postgresql:'PostgreSQL',mongodb:'MongoDB',mysql:'MySQL',sqlite:'SQLite',supabase:'Supabase'};
        const typeLabels = {vitrine:'Site Vitrine',blog:'Blog',ecommerce:'E-commerce',saas:'SaaS',landing:'Landing',portfolio:'Portfolio',dashboard:'Dashboard',custom:'Custom'};

        let infoParts = [];
        if (wd.client_name) infoParts.push(`<span style="color:var(--text-0);font-weight:600">${wd.client_name}</span>`);
        if (wd.site_type) infoParts.push(`<span class="badge badge-violet">${typeLabels[wd.site_type] || wd.site_type}</span>`);
        if (wd.frontend_framework) infoParts.push(`<span class="badge badge-amber">${techLabels[wd.frontend_framework] || wd.frontend_framework}</span>`);
        if (wd.css_framework) infoParts.push(`<span class="badge badge-sky">${wd.css_framework}</span>`);
        if (wd.needs_backend === 'yes' && wd.backend_framework) infoParts.push(`<span class="badge badge-emerald">${techLabels[wd.backend_framework] || wd.backend_framework}</span>`);
        if (wd.needs_db === 'yes' && wd.db_type) infoParts.push(`<span class="badge badge-rose">${techLabels[wd.db_type] || wd.db_type}</span>`);
        if (wd.domain_name) infoParts.push(`<span class="mono" style="font-size:11px;color:var(--text-2)">${wd.domain_name}</span>`);

        document.getElementById('detail-info-bar').innerHTML = `<div class="flex gap-8" style="flex-wrap:wrap;align-items:center">${infoParts.join('')}</div>${pathLine(p)}`;
    } else {
        document.getElementById('detail-info-bar').innerHTML = `${p.description ? `<div style="font-size:12px;color:var(--text-3)">${p.description}</div>` : ''}${pathLine(p)}`;
    }

    // Stats row
    document.getElementById('detail-stats').innerHTML = `
        <div class="card metric-card" style="padding:14px"><div class="accent-bar accent-violet"></div><div class="card-label">Disque</div><div class="card-value" style="font-size:18px">${data.disk_total_h}</div></div>
        <div class="card metric-card" style="padding:14px"><div class="accent-bar accent-sky"></div><div class="card-label">Caches</div><div class="card-value" style="font-size:18px;color:var(--sky)">${data.total_cache_h}</div><div class="card-sub">${data.caches.length} types</div></div>
        <div class="card metric-card" style="padding:14px"><div class="accent-bar accent-emerald"></div><div class="card-label">Ressources</div><div class="card-value" style="font-size:18px">${data.resources.length}</div></div>
        <div class="card metric-card" style="padding:14px"><div class="accent-bar accent-amber"></div><div class="card-label">Ports</div><div class="card-value" style="font-size:18px">${data.ports.length}</div></div>`;

    // Specs section — checklist + prompt button
    if (hasSpecs) {
        const tasks = specs.checklist || [];
        const doneCount = tasks.filter(t => t.done).length;
        const progress = tasks.length ? Math.round(doneCount / tasks.length * 100) : 0;
        window._specsChecklist = tasks;
        window._specsPid = pid;

        document.getElementById('detail-specs-section').style.display = 'block';
        document.getElementById('detail-specs-section').innerHTML = `
            <div class="grid-2">
                <div class="card" style="padding:16px">
                    <div class="flex-between mb-8">
                        <div class="card-label" style="margin-bottom:0">Checklist</div>
                        <span style="font-size:11px;color:var(--text-3)">${doneCount}/${tasks.length} termines</span>
                    </div>
                    <div class="progress mb-12" style="height:6px"><div class="progress-fill fill-emerald" style="width:${progress}%"></div></div>
                    <div style="max-height:240px;overflow-y:auto">
                        ${tasks.map((t, i) => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-0)">
                            <input type="checkbox" class="detail-check" data-idx="${i}" ${t.done ? 'checked' : ''} onchange="saveDetailChecklist()" style="accent-color:var(--emerald);width:14px;height:14px;flex-shrink:0;cursor:pointer">
                            <span style="font-size:12px;${t.done ? 'text-decoration:line-through;color:var(--text-4)' : 'color:var(--text-1)'}">${t.text}</span>
                        </div>`).join('')}
                    </div>
                </div>
                <div class="card" style="padding:16px">
                    <div class="flex-between mb-8">
                        <div class="card-label" style="margin-bottom:0">Prompt Claude</div>
                        <button class="btn btn-xs" onclick="navigator.clipboard.writeText(window._detailPrompt||'');toast('Copie')">Copier</button>
                    </div>
                    <pre class="mono" style="font-size:10px;color:var(--text-2);white-space:pre-wrap;background:var(--bg-0);padding:12px;border-radius:var(--radius-xs);border:1px solid var(--border-0);max-height:260px;overflow-y:auto;line-height:1.5">${specs.prompt}</pre>
                </div>
            </div>`;
        window._detailPrompt = specs.prompt;
    }

    // Git
    const orgRepos = (data.repos || []).filter(r => r.dir !== '.');
    if (data.github_org) {
        // multi-repo project linked to its organisation: the repos live in the Git tab of the workspace
        document.getElementById('detail-git').innerHTML = `<div class="card" style="padding:14px">
            <div class="flex-between"><div class="card-label" style="margin-bottom:0">GitHub</div>
                <button class="btn btn-xs btn-primary" onclick="openWorkspace(${pid}).then(() => wsTab('git'))">Voir les depots</button></div>
            <div style="font-size:12px;margin-top:8px">Lie a l'organisation <a href="https://github.com/${hx(data.github_org)}" target="_blank" class="mono" style="color:var(--sky)">github.com/${hx(data.github_org)}</a></div>
            <div style="font-size:11px;color:var(--text-3);margin-top:4px">Plusieurs depots : chacun a sa place et se synchronise depuis l'onglet Git.</div></div>`;
    } else if (!g && orgRepos.length) {
        document.getElementById('detail-git').innerHTML = `<div class="card" style="padding:14px">
            <div class="flex-between"><div class="card-label" style="margin-bottom:0">GitHub</div>
                <button class="btn btn-xs btn-primary" onclick="openLinkTerminal(${pid})">Lier a GitHub</button></div>
            <div style="color:var(--text-4);font-size:12px;margin-top:8px">${orgRepos.length} depot(s) dans ce projet, pas encore lie a leur organisation GitHub</div></div>`;
    } else
    document.getElementById('detail-git').innerHTML = g ? `
        <div class="card" style="padding:14px">
            <div class="flex-between"><div class="card-label" style="margin-bottom:0">Git</div><button class="btn btn-xs" onclick="showLinkGit(${pid})">Changer remote</button></div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px;margin-top:8px">
                <span class="text-dim">Branche</span><span style="font-weight:600">${g.branch}</span>
                <span class="text-dim">Status</span><span>${g.is_clean ? '<span class="badge badge-emerald">Clean</span>' : '<span class="badge badge-amber">' + g.modified + ' modifies, ' + g.untracked + ' untracked</span>'}</span>
                <span class="text-dim">Dernier commit</span><span>${g.last_commit}</span>
                ${g.remote ? '<span class="text-dim">Remote</span><span class="mono" style="font-size:10px">' + g.remote + '</span>' : ''}
            </div>
        </div>` : `<div class="card" style="padding:14px"><div class="flex-between"><div class="card-label" style="margin-bottom:0">Git</div><button class="btn btn-xs btn-primary" onclick="openLinkTerminal(${pid})">Lier a GitHub</button></div><div style="color:var(--text-4);font-size:12px;margin-top:8px">Pas de repo git lie</div></div>`;

    // Caches
    document.getElementById('detail-caches').innerHTML = `
        <div class="card" style="padding:14px">
            <div class="card-label">Caches</div>
            ${data.caches.length ? data.caches.map(c => `
                <div class="flex-between" style="padding:4px 0;border-bottom:1px solid var(--border-0);font-size:12px">
                    <span>${c.name}</span>
                    <div class="flex gap-6">
                        <span class="mono" style="color:${c.heavy ? 'var(--rose)' : 'var(--text-2)'}">${c.size_h}</span>
                        ${c.safe ? `<button class="btn btn-xs btn-danger" onclick="event.stopPropagation();cleanConfirm('clear_project_cache','Supprimer ${esc(c.name)} ?',{path:'${esc(c.path)}'})">Suppr</button>` : ''}
                    </div>
                </div>`).join('') : '<div style="color:var(--text-4);font-size:12px">Aucun cache</div>'}
        </div>`;

    // Docker
    const dk = data.docker;
    const dkTotal = dk.containers.length + dk.images.length + dk.volumes.length;
    document.getElementById('detail-docker').innerHTML = `
        <div class="card" style="padding:14px">
            <div class="card-label">Docker (${dkTotal})</div>
            ${dkTotal ? `
                ${dk.containers.map(c => `<div class="flex-between" style="padding:3px 0;font-size:11px"><span class="badge badge-sky">container</span><span class="mono">${c.name}</span></div>`).join('')}
                ${dk.images.map(c => `<div class="flex-between" style="padding:3px 0;font-size:11px"><span class="badge badge-violet">image</span><span class="mono">${c.name}</span></div>`).join('')}
                ${dk.volumes.map(c => `<div class="flex-between" style="padding:3px 0;font-size:11px"><span class="badge badge-amber">volume</span><span class="mono">${c.name}</span></div>`).join('')}
            ` : '<div style="color:var(--text-4);font-size:12px">Aucune ressource Docker</div>'}
        </div>`;

    // Resources
    document.getElementById('detail-resources').innerHTML = `
        <div class="card" style="padding:14px">
            <div class="card-label">Fichiers suivis (${data.resources.filter(r=>!r.type.startsWith('docker_')).length})</div>
            ${data.resources.filter(r => !r.type.startsWith('docker_')).length ? `<div style="max-height:200px;overflow-y:auto">${data.resources.filter(r => !r.type.startsWith('docker_')).map(r => `
                <div class="flex-between" style="padding:3px 0;border-bottom:1px solid var(--border-0);font-size:11px">
                    <span class="mono ellipsis">${r.name}</span>
                    <span class="mono text-dim">${r.size_h}</span>
                </div>`).join('')}</div>` : '<div style="color:var(--text-4);font-size:12px">Aucun fichier suivi</div>'}
        </div>`;

    document.getElementById('project-detail').scrollIntoView({ behavior: 'smooth' });
}

