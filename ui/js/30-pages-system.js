/* ═══════════════════════════════════════════════════════════
   PAGE: STORAGE
   ═══════════════════════════════════════════════════════════ */
async function loadStorage() {
    const [sys, dl] = await Promise.all([api('system'), api('downloads')]);
    const d = sys.disks.find(x => x.mount === '/') || sys.disks[0];
    const pctFill = (p) => p > 85 ? 'fill-rose' : p > 70 ? 'fill-amber' : 'fill-violet';

    document.getElementById('storage-stats').innerHTML = `
        <div class="card metric-card"><div class="accent-bar accent-violet"></div><div class="card-label">SSD</div><div class="card-value" style="font-size:22px">${d?.used_h||''} <span style="font-size:11px;color:var(--text-3)">/ ${d?.total_h||''}</span></div><div class="progress"><div class="progress-fill ${pctFill(d?.percent||0)}" style="width:${d?.percent||0}%"></div></div><div class="card-sub">${d?.free_h||''} libre</div></div>
        <div class="card metric-card"><div class="accent-bar accent-sky"></div><div class="card-label">RAM</div><div class="card-value" style="font-size:22px">${sys.ram.used_h} <span style="font-size:11px;color:var(--text-3)">/ ${sys.ram.total_h}</span></div><div class="progress"><div class="progress-fill fill-sky" style="width:${sys.ram.percent}%"></div></div><div class="card-sub">${sys.ram.percent}%</div></div>
        <div class="card metric-card"><div class="accent-bar accent-emerald"></div><div class="card-label">Swap</div><div class="card-value" style="font-size:22px">${sys.swap.used_h} <span style="font-size:11px;color:var(--text-3)">/ ${sys.swap.total_h}</span></div><div class="progress"><div class="progress-fill fill-emerald" style="width:${sys.swap.percent}%"></div></div></div>
        <div class="card metric-card"><div class="accent-bar ${sys.trash.size>1073741824?'accent-rose':'accent-emerald'}"></div><div class="card-label">Corbeille</div><div class="card-value" style="font-size:22px;color:${sys.trash.size>1073741824?'var(--rose)':'var(--emerald)'}">${sys.trash.size_h}</div>${sys.trash.size>104857600?'<button class="btn btn-sm btn-danger mt-8" onclick="cleanConfirm(\'trash\',\'Vider la corbeille ?\')">Vider</button>':''}</div>`;

    const files = dl.files.filter(f => f.size > 1048576);
    document.getElementById('dl-count').textContent = files.length;
    document.getElementById('dup-count').textContent = dl.duplicates.length;

    document.getElementById('downloads-table').innerHTML = `<table><thead><tr><th>Fichier</th><th class="text-right">Taille</th><th>Date</th><th></th></tr></thead><tbody>${files.slice(0, 20).map(f => `<tr><td class="mono ellipsis" title="${f.name}">${f.name}</td><td class="text-right mono">${f.size_h}</td><td class="text-dim">${f.mtime}</td><td><div class="row-actions"><button class="btn btn-xs btn-danger" onclick="deleteFile('${esc(f.path)}','${esc(f.name)}')">Suppr</button></div></td></tr>`).join('')}</tbody></table>`;
    document.getElementById('duplicates-table').innerHTML = dl.duplicates.length ? `<table><thead><tr><th>Doublon</th><th class="text-right">Taille</th><th>Raison</th><th></th></tr></thead><tbody>${dl.duplicates.map(d => `<tr><td class="mono ellipsis">${d.name}</td><td class="text-right mono">${d.size_h}</td><td class="text-dim" style="font-size:11px">${d.reason}</td><td><button class="btn btn-xs btn-danger" onclick="deleteFile('${esc(d.path)}','${esc(d.name)}')">Suppr</button></td></tr>`).join('')}</tbody></table>` : '<div style="text-align:center;color:var(--text-4);padding:24px;font-size:12px">Aucun doublon detecte</div>';
}

/* ═══════════════════════════════════════════════════════════
   PAGE: CACHES
   ═══════════════════════════════════════════════════════════ */
async function loadCaches() {
    const [br, pc, gc, sc] = await Promise.all([api('caches/browser'), api('caches/projects'), api('caches/global'), api('caches/system')]);
    const tB = br.reduce((s, b) => s + b.total, 0), tP = pc.reduce((s, p) => s + p.total, 0), tG = gc.reduce((s, g) => s + (g.size || 0), 0);
    document.getElementById('cache-summary').innerHTML = `Navigateurs: <b style="color:var(--sky)">${fmtB(tB)}</b> &middot; Projets: <b style="color:var(--violet)">${fmtB(tP)}</b> &middot; Globaux: <b style="color:var(--emerald)">${fmtB(tG)}</b> &middot; Total: <b style="color:var(--rose)">${fmtB(tB + tP + tG)}</b>`;

    // Browsers
    document.getElementById('browser-count').textContent = br.length;
    document.getElementById('browser-cards').innerHTML = br.length ? br.map(b => `<div class="card" style="padding:16px"><div class="flex-between mb-8"><span style="font-weight:700;font-size:13px;color:var(--text-0)">${b.label}</span><button class="btn btn-xs btn-danger" onclick="clearBrowser('${b.key}','${b.label}')">Vider</button></div><div class="card-value" style="font-size:20px;color:var(--sky)">${b.total_h}</div>${b.subs.length ? '<div class="mt-8">' + b.subs.map(s => `<div class="flex-between" style="font-size:10px;color:var(--text-3);padding:1px 0"><span>${s.label}</span><span class="mono">${s.size_h}</span></div>`).join('') + '</div>' : ''}</div>`).join('') : '<div class="card" style="grid-column:1/-1;text-align:center;padding:24px;color:var(--text-4);font-size:12px">Aucun cache navigateur detecte</div>';

    // Project caches
    document.getElementById('projcache-count').textContent = pc.length;
    document.getElementById('project-caches').innerHTML = pc.length ? pc.map(p => `<div class="card mb-8" style="padding:16px;border-left:2px solid ${p.project_color || 'var(--violet)'}"><div class="flex-between mb-8"><div><span style="font-weight:700;color:var(--text-0)">${p.name}</span>${p.project_id ? '<span class="badge badge-violet" style="margin-left:8px">Lie</span>' : ''}<span style="color:var(--text-4);font-size:10px;margin-left:8px">${p.manifest}</span></div><div class="flex gap-8"><span style="font-weight:700;color:var(--violet)">${p.total_h}</span><button class="btn btn-xs btn-danger" onclick="cleanConfirm('clear_project_all','Tout vider pour ${esc(p.name)} ?',{dir:'${esc(p.dir)}'})">Tout</button></div></div><div class="flex gap-6" style="flex-wrap:wrap">${p.caches.map(c => `<div class="cache-chip"><div style="flex:1"><div style="font-weight:600;font-size:11px;color:var(--text-1)">${c.name}</div><div class="mono" style="font-size:10px;color:${c.heavy ? 'var(--rose)' : 'var(--text-4)'}">${c.size_h}</div></div>${c.safe ? `<button class="btn btn-xs btn-danger" onclick="event.stopPropagation();cleanConfirm('clear_project_cache','Supprimer ${esc(c.name)} ?',{path:'${esc(c.path)}'})">&times;</button>` : '<span class="badge badge-amber">?</span>'}</div>`).join('')}</div><div style="font-size:9px;color:var(--text-4);margin-top:4px;font-family:monospace">${p.dir}</div></div>`).join('') : '<div class="card" style="text-align:center;padding:32px;color:var(--text-4);font-size:12px">Aucun cache projet detecte</div>';

    // Global caches
    document.getElementById('global-count').textContent = gc.length;
    destroyChart('chart-gcache');
    const gf = gc.filter(g => g.size > 0);
    if (gf.length) { charts['chart-gcache'] = new Chart(document.getElementById('chart-gcache'), { type: 'doughnut', data: { labels: gf.map(g => g.label), datasets: [{ data: gf.map(g => g.size), backgroundColor: CHART_COLORS, borderWidth: 0, spacing: 3, borderRadius: 4 }] }, options: { ...DOUGHNUT_OPTS, plugins: { ...DOUGHNUT_OPTS.plugins, tooltip: { ...DOUGHNUT_OPTS.plugins.tooltip, callbacks: { label: ctx => gf[ctx.dataIndex].size_h } } } } }); }
    document.getElementById('global-table').innerHTML = `<table><thead><tr><th>Cache</th><th class="text-right">Taille</th><th></th></tr></thead><tbody>${gc.map(g => `<tr><td><span style="font-weight:600">${g.label}</span>${g.cmd ? `<span class="text-dim mono" style="font-size:9px;margin-left:8px">${g.cmd}</span>` : ''}</td><td class="text-right mono" style="font-weight:600;color:var(--sky)">${g.size_h}</td><td><button class="btn btn-xs btn-danger" onclick="clearGlobal('${g.key}','${g.label}')">Vider</button></td></tr>`).join('')}</tbody></table>`;

    // System cache
    document.getElementById('syscache-count').textContent = sc.length;
    const scBadge = { safe: '<span class="badge badge-emerald">Safe</span>', partial: '<span class="badge badge-amber">Partiel</span>', unknown: '<span class="badge badge-violet">?</span>' };
    document.getElementById('syscache-table').innerHTML = `<table><thead><tr><th>Dossier</th><th class="text-right">Taille</th><th>Statut</th><th></th></tr></thead><tbody>${sc.map(c => `<tr><td class="mono">${c.name}</td><td class="text-right mono">${c.size_h}</td><td>${scBadge[c.cleanable]}</td><td><div class="row-actions">${c.cleanable === 'safe' ? `<button class="btn btn-xs btn-danger" onclick="cleanConfirm('delete_cache_dir','Supprimer ${c.name} ?',{name:'${c.name}'})">Suppr</button>` : ''}</div></td></tr>`).join('')}</tbody></table>`;
}

async function clearBrowser(key, label) { if (!confirm('Vider cache ' + label + ' ?\nFerme le navigateur pour de meilleurs resultats.')) return; try { const r = await apiPost('clean', { action: 'clear_browser', browser: key }); toast(r.success ? r.message : r.message, r.success ? 'success' : 'error'); if (r.success) setTimeout(() => loadCaches(), 600); } catch (e) { toast('Erreur', 'error'); } }
async function clearAllBrowsers() { if (!confirm('Vider TOUS les caches navigateur ?')) return; const br = await api('caches/browser'); for (const b of br) { try { await apiPost('clean', { action: 'clear_browser', browser: b.key }); } catch (e) {} } toast('Caches navigateur vides'); setTimeout(() => loadCaches(), 600); }
async function clearGlobal(key, label) { if (!confirm('Vider ' + label + ' ?')) return; try { const r = await apiPost('clean', { action: 'clear_global', key }); toast(r.success ? r.message : r.message, r.success ? 'success' : 'error'); if (r.success) setTimeout(() => loadCaches(), 600); } catch (e) { toast('Erreur', 'error'); } }

/* ═══════════════════════════════════════════════════════════
   PAGE: DOCKER
   ═══════════════════════════════════════════════════════════ */
async function loadDocker() {
    const d = await api('docker');
    if (!d.available) { document.getElementById('docker-stats').innerHTML = '<div class="alert alert-info" style="grid-column:1/-1">Docker non disponible ou non demarre</div>'; return; }

    const accentClasses = ['accent-violet', 'accent-sky', 'accent-emerald', 'accent-amber'];
    document.getElementById('docker-stats').innerHTML = (d.system_df || []).map((s, i) => `<div class="card metric-card"><div class="accent-bar ${accentClasses[i % 4]}"></div><div class="card-label">${s.Type}</div><div class="card-value" style="font-size:22px">${s.TotalCount || '—'}</div><div class="card-sub">${s.Size} &middot; Recup: ${s.Reclaimable}</div></div>`).join('');

    document.getElementById('ct-count').textContent = d.containers.length;
    document.getElementById('docker-containers').innerHTML = `<table><thead><tr><th>Nom</th><th>Image</th><th>Etat</th><th>Projet</th><th></th></tr></thead><tbody>${d.containers.map(c => `<tr><td class="mono ellipsis">${c.name}</td><td class="text-dim mono" style="font-size:10px">${c.image}</td><td><span class="badge ${c.state === 'running' ? 'badge-emerald' : 'badge-rose'}">${c.state}</span></td><td>${c.project_name ? '<span class="badge badge-violet">' + c.project_name + '</span>' : c.resource_id ? '<button class="btn btn-xs" onclick="showLinkModal(' + c.resource_id + ')">Lier</button>' : '<span class="text-dim">—</span>'}</td><td><div class="row-actions"><button class="btn btn-xs btn-danger" onclick="cleanConfirm('docker_rm','Supprimer container ${esc(c.name)} ?',{kind:'container',name:'${esc(c.name)}'})">Suppr</button></div></td></tr>`).join('')}</tbody></table>`;

    document.getElementById('img-count').textContent = d.images.length;
    document.getElementById('docker-images').innerHTML = `<table><thead><tr><th>Image</th><th>Tag</th><th class="text-right">Taille</th><th>Projet</th><th></th></tr></thead><tbody>${d.images.slice(0, 25).map(i => `<tr><td class="mono ellipsis">${i.repo}</td><td class="text-dim">${i.tag}</td><td class="text-right mono">${i.size}</td><td>${i.project_name ? '<span class="badge badge-violet">' + i.project_name + '</span>' : i.resource_id ? '<button class="btn btn-xs" onclick="showLinkModal(' + i.resource_id + ')">Lier</button>' : '<span class="text-dim">—</span>'}</td><td><div class="row-actions"><button class="btn btn-xs btn-danger" onclick="cleanConfirm('docker_rm','Supprimer image ${esc(i.repo)}:${esc(i.tag)} ?',{kind:'image',name:'${esc(i.id)}'})">Suppr</button></div></td></tr>`).join('')}</tbody></table>`;

    document.getElementById('vol-count').textContent = d.volumes.length;
    document.getElementById('docker-volumes').innerHTML = `<table><thead><tr><th>Volume</th><th>Driver</th><th>Projet</th><th></th></tr></thead><tbody>${d.volumes.map(v => `<tr><td class="mono">${v.name}</td><td class="text-dim">${v.driver}</td><td>${v.project_name ? '<span class="badge badge-violet">' + v.project_name + '</span>' : v.resource_id ? '<button class="btn btn-xs" onclick="showLinkModal(' + v.resource_id + ')">Lier</button>' : '<span class="text-dim">—</span>'}</td><td><div class="row-actions"><button class="btn btn-xs btn-danger" onclick="cleanConfirm('docker_rm','Supprimer volume ${esc(v.name)} ?',{kind:'volume',name:'${esc(v.name)}'})">Suppr</button></div></td></tr>`).join('')}</tbody></table>`;
}

/* ═══════════════════════════════════════════════════════════
   PAGE: NETWORK
   ═══════════════════════════════════════════════════════════ */
async function loadNetwork() {
    const [ports, procs] = await Promise.all([api('ports'), api('processes')]);
    document.getElementById('port-count').textContent = ports.length;
    const typeBadge = { system: 'badge-violet', docker: 'badge-sky', dev: 'badge-amber' };
    const typeLabel = { system: 'System', docker: 'Docker', dev: 'Dev' };
    document.getElementById('ports-table').innerHTML = `<table><thead><tr><th>Port</th><th>Adresse</th><th>Process</th><th>Type</th><th>Projet</th><th>Info</th></tr></thead><tbody>${ports.map(p => `<tr><td class="mono" style="font-size:14px;font-weight:700;color:var(--violet)">${p.port}</td><td class="mono text-dim">${p.bind}</td><td>${p.process}</td><td><span class="badge ${typeBadge[p.type] || 'badge-amber'}">${typeLabel[p.type] || 'Dev'}</span></td><td>${p.project_name ? '<span class="badge badge-violet">' + p.project_name + '</span>' : '<span class="text-dim">—</span>'}</td><td class="text-dim">${p.label}</td></tr>`).join('')}</tbody></table>`;

    const devProcs = procs.filter(p => p.is_dev);
    const other = procs.filter(p => !p.is_dev);
    document.getElementById('proc-count').textContent = procs.length;
    document.getElementById('procs-table').innerHTML = `<table><thead><tr><th>Process</th><th class="text-right">RAM</th><th class="text-right">CPU</th><th>Projet</th><th></th></tr></thead><tbody>${[...devProcs, ...other].slice(0, 25).map(p => `<tr><td><span ${p.is_dev ? 'style="color:var(--sky)"' : ''} class="ellipsis" title="${p.cmd}">${p.name}</span></td><td class="text-right mono" style="font-weight:600;color:${p.memory > 500 * 1024 * 1024 ? 'var(--rose)' : p.memory > 200 * 1024 * 1024 ? 'var(--amber)' : 'var(--text-1)'}">${p.memory_h}</td><td class="text-right mono">${p.cpu.toFixed(1)}%</td><td>${p.project_hint ? '<span class="badge badge-violet">' + p.project_hint + '</span>' : ''}</td><td><div class="row-actions"><button class="btn btn-xs btn-danger" onclick="cleanConfirm('kill_process','Terminer ${esc(p.name)} (PID ${p.pid}) ?',{pid:${p.pid}})">Kill</button></div></td></tr>`).join('')}</tbody></table>`;
}

/* ═══════════════════════════════════════════════════════════
   PAGE: RUNNING
   ═══════════════════════════════════════════════════════════ */
async function loadRunning() {
    const data = await api('running');
    document.getElementById('running-count').textContent = data.length;
    document.getElementById('btn-stop-all').style.display = data.length > 0 ? '' : 'none';

    if (!data.length) {
        document.getElementById('running-list').innerHTML = `<div class="card" style="text-align:center;padding:48px"><div style="font-size:32px;opacity:.2;margin-bottom:12px">&#9724;</div><div style="color:var(--text-4);font-size:13px">Aucun projet en cours d'execution</div><div style="color:var(--text-4);font-size:11px;margin-top:4px">Lance un serveur dev ou un container Docker pour le voir ici</div></div>`;
        return;
    }

    document.getElementById('running-list').innerHTML = data.map(r => {
        const p = r.project;
        const totalItems = r.ports.length + r.containers.length + r.processes.length;
        const allPids = r.processes.map(pr => pr.pid);
        const allContainers = r.containers.map(c => c.name);

        return `<div class="card mb-12" style="border-left:3px solid ${p.color}">
            <div class="flex-between mb-12">
                <div>
                    <span style="font-weight:700;font-size:15px;color:var(--text-0)">${p.name}</span>
                    <span class="badge badge-emerald" style="margin-left:8px">En cours</span>
                    <span style="font-size:11px;color:var(--text-4);margin-left:8px">${totalItems} ressources actives</span>
                </div>
                <div class="flex gap-6">
                    <button class="btn btn-sm" onclick="go('projects');setTimeout(()=>showProjectDetail(${p.id}),300)">Details</button>
                    <button class="btn btn-sm" onclick="openWorkspace(${p.id})">Workspace</button>
                    <button class="btn btn-sm btn-danger" onclick="stopProject(${p.id}, '${esc(p.name)}', ${JSON.stringify(allPids)}, ${JSON.stringify(allContainers).replace(/"/g,'&quot;')})">Arreter tout</button>
                </div>
            </div>

            ${r.ports.length ? `<div class="mb-8"><div class="card-label">Ports (${r.ports.length})</div><div style="display:flex;gap:8px;flex-wrap:wrap">${r.ports.map(pt => `<div style="background:var(--bg-0);border:1px solid var(--border-1);border-radius:var(--radius-xs);padding:6px 12px;display:flex;align-items:center;gap:8px"><span style="font-size:18px;font-weight:800;color:var(--accent)">${pt.port}</span><span style="font-size:10px;color:var(--text-3)">${pt.process}</span></div>`).join('')}</div></div>` : ''}

            ${r.containers.length ? `<div class="mb-8"><div class="card-label">Containers (${r.containers.length})</div><table><thead><tr><th>Nom</th><th>Image</th><th>Status</th><th>Ports</th><th></th></tr></thead><tbody>${r.containers.map(c => `<tr><td class="mono" style="font-weight:600">${c.name}</td><td class="mono text-dim" style="font-size:10px">${c.image}</td><td><span class="badge badge-emerald">${c.status}</span></td><td class="mono text-dim" style="font-size:10px">${c.ports}</td><td><div class="row-actions"><button class="btn btn-xs btn-danger" onclick="stopContainer('${esc(c.name)}')">Stop</button></div></td></tr>`).join('')}</tbody></table></div>` : ''}

            ${r.processes.length ? `<div><div class="card-label">Processus (${r.processes.length})</div><table><thead><tr><th>PID</th><th>Nom</th><th>RAM</th><th>CPU</th><th></th></tr></thead><tbody>${r.processes.map(pr => `<tr><td class="mono">${pr.pid}</td><td style="font-weight:500">${pr.name}</td><td class="mono">${pr.memory_h}</td><td class="mono">${pr.cpu.toFixed(1)}%</td><td><div class="row-actions"><button class="btn btn-xs btn-danger" onclick="killProcess(${pr.pid})">Kill</button></div></td></tr>`).join('')}</tbody></table></div>` : ''}

            <div class="mono" style="font-size:9px;color:var(--text-4);margin-top:8px">${p.path}</div>
        </div>`;
    }).join('');
}

async function stopProject(pid, name, pids, containers) {
    if (!confirm('Arreter tout pour "' + name + '" ?\n\nProcessus et containers seront stoppes.')) return;
    const r = await apiPost('running/stop', { project_id: pid, pids: pids, containers: containers });
    toast(r.message);
    setTimeout(() => loadRunning(), 500);
}

async function stopContainer(name) {
    if (!confirm('Arreter le container "' + name + '" ?')) return;
    await apiPost('running/stop', { containers: [name] });
    toast('Container ' + name + ' arrete');
    setTimeout(() => loadRunning(), 500);
}

async function killProcess(pid) {
    if (!confirm('Terminer le processus PID ' + pid + ' ?')) return;
    await apiPost('clean', { action: 'kill_process', pid: pid });
    toast('Processus termine');
    setTimeout(() => loadRunning(), 500);
}

async function stopAllProjects() {
    if (!confirm('Arreter TOUS les projets en cours ?')) return;
    const data = await api('running');
    for (const r of data) {
        const pids = r.processes.map(p => p.pid);
        const containers = r.containers.map(c => c.name);
        await apiPost('running/stop', { project_id: r.project.id, pids, containers });
    }
    toast('Tout arrete');
    setTimeout(() => loadRunning(), 500);
}

/* ═══════════════════════════════════════════════════════════
   PAGE: TIMELINE
   ═══════════════════════════════════════════════════════════ */
async function loadTimeline(hours) {
    const events = await api(hours ? 'events?limit=100&hours=' + hours : 'events?limit=100');
    if (!events.length) { document.getElementById('timeline-content').innerHTML = '<div style="text-align:center;color:var(--text-4);padding:32px;font-size:12px">Aucun evenement</div>'; return; }
    const labels = { created: 'Cree', deleted: 'Supprime', cleaned: 'Nettoye', expired: 'Expire' };
    const badgeType = { created: 'badge-emerald', deleted: 'badge-rose', cleaned: 'badge-sky', expired: 'badge-amber' };
    document.getElementById('timeline-content').innerHTML = events.map(e => `<div class="tl-item ${e.type}"><div style="font-size:9px;color:var(--text-4);font-weight:600">${e.created_at?.slice(0, 16).replace('T', ' ') || ''}</div><div style="font-size:11px;margin-top:3px"><strong style="color:var(--text-0)">${labels[e.type] || e.type}</strong> <span class="badge ${badgeType[e.type] || 'badge-violet'}">${e.resource_type || ''}</span> <span class="mono">${e.resource_name || ''}</span>${e.project_name ? ' <span class="badge badge-violet">' + e.project_name + '</span>' : ''}</div></div>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   PAGE: SETTINGS
   ═══════════════════════════════════════════════════════════ */
async function loadSettings() {
    const [s, rules] = await Promise.all([api('settings'), api('rules')]);
    // GitHub
    document.getElementById('set-gh-user').value = s.github_user || '';
    document.getElementById('set-gh-token').value = s.github_token || '';
    if (s.github_token && s.github_token !== '****') testGitHub();

    // R2
    document.getElementById('set-r2-account').value = s.r2_account_id || '';
    document.getElementById('set-r2-access-key').value = s.r2_access_key_id || '';
    document.getElementById('set-r2-secret-key').value = s.r2_secret_access_key || '';
    document.getElementById('set-r2-bucket').value = s.r2_default_bucket || '';
    if (s.r2_account_id && s.r2_account_id !== '****') testR2();

    document.getElementById('set-scan').value = s.scan_dirs || '~/Desktop';
    document.getElementById('set-dl').value = s.watch_downloads || '1';
    document.getElementById('set-desk').value = s.watch_desktop || '1';
    document.getElementById('set-docker').value = s.watch_docker || '1';
    document.getElementById('set-expire').value = s.temp_expire_days || '7';
    document.getElementById('set-notify').value = s.notify_enabled || '1';
    document.getElementById('rules-list').innerHTML = rules.length ? `<table><thead><tr><th>Pattern</th><th>Projet</th><th>Type</th><th></th></tr></thead><tbody>${rules.map(r => `<tr><td class="mono">${r.pattern}</td><td><span class="badge badge-violet">${r.project_name}</span></td><td class="text-dim">${r.resource_type}</td><td><button class="btn btn-xs btn-danger" onclick="apiDel('rules/${r.id}').then(()=>{toast('Supprime');loadSettings()})">Suppr</button></td></tr>`).join('')}</tbody></table>` : '<div style="color:var(--text-4);font-size:12px;padding:8px 0">Aucune regle configuree</div>';
}

async function saveGitHub() {
    const user = document.getElementById('set-gh-user').value.trim();
    const token = document.getElementById('set-gh-token').value.trim();
    await apiPost('settings', { github_user: user, github_token: token });
    toast('GitHub sauvegarde');
    testGitHub();
}

async function testGitHub() {
    document.getElementById('gh-status').innerHTML = '<span class="spinner" style="width:12px;height:12px"></span>';
    const r = await api('github/test');
    if (r.connected) {
        document.getElementById('gh-status').innerHTML = `<span class="badge badge-emerald">Connecte: ${r.login}</span>`;
        loadGitHubRepos();
    } else {
        document.getElementById('gh-status').innerHTML = `<span class="badge badge-rose">${r.message}</span>`;
    }
}

async function loadGitHubRepos() {
    const el = document.getElementById('gh-repos');
    el.innerHTML = '<div class="spinner" style="width:14px;height:14px;margin:8px"></div>';
    const repos = await api('github/repos');
    if (!repos.length) { el.innerHTML = '<span style="color:var(--text-4);font-size:12px">Aucun repo</span>'; return; }
    el.innerHTML = repos.map(r => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-0);font-size:12px">
            <a href="https://github.com/${r.full_name}" target="_blank" style="font-weight:600;flex:1;color:var(--text-0);text-decoration:none">${r.name}</a>
            ${r.private ? '<span class="badge badge-amber" style="font-size:8px">Prive</span>' : ''}
            ${r.language ? '<span class="badge badge-violet" style="font-size:8px">' + r.language + '</span>' : ''}
            <span style="font-size:9px;color:var(--text-4)">${r.updated_at}</span>
            <a href="https://github.com/${r.full_name}" target="_blank" class="btn btn-xs" style="text-decoration:none">Ouvrir</a>
            <button class="btn btn-xs" onclick="cloneFromGitHub('${esc(r.clone_url)}','${esc(r.name)}')">Clone</button>
        </div>`).join('');
}

function cloneFromGitHub(url, name) { go('projects'); openAddProject('clone', { url: url, name: name }); }

async function saveSettings() {
    await apiPost('settings', {
        scan_dirs: document.getElementById('set-scan').value,
        watch_downloads: document.getElementById('set-dl').value,
        watch_desktop: document.getElementById('set-desk').value,
        watch_docker: document.getElementById('set-docker').value,
        temp_expire_days: document.getElementById('set-expire').value,
        notify_enabled: document.getElementById('set-notify').value
    });
    toast('Parametres sauvegardes');
}

