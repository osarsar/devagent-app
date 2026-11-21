/* ═══════════════════════════════════════════════════════════
   CLOUD SYNC — R2 Settings
   ═══════════════════════════════════════════════════════════ */

async function saveR2() {
    const account = document.getElementById('set-r2-account').value.trim();
    const accessKey = document.getElementById('set-r2-access-key').value.trim();
    const secretKey = document.getElementById('set-r2-secret-key').value.trim();
    const bucket = document.getElementById('set-r2-bucket').value.trim();
    await apiPost('settings', {
        r2_account_id: account,
        r2_access_key_id: accessKey,
        r2_secret_access_key: secretKey,
        r2_default_bucket: bucket
    });
    toast('R2 sauvegarde');
    testR2();
}

async function testR2() {
    document.getElementById('r2-status').innerHTML = '<span class="spinner" style="width:12px;height:12px"></span>';
    const r = await api('r2/test');
    if (r.connected) {
        document.getElementById('r2-status').innerHTML = `<span class="badge badge-emerald">Connecte (${r.bucket_count} buckets)</span>`;
        loadR2Buckets();
    } else {
        document.getElementById('r2-status').innerHTML = `<span class="badge badge-rose">${r.message}</span>`;
    }
}

async function loadR2Buckets() {
    const el = document.getElementById('r2-buckets');
    el.innerHTML = '<div class="spinner" style="width:14px;height:14px;margin:8px"></div>';
    const buckets = await api('r2/buckets');
    if (!buckets.length) { el.innerHTML = '<span style="color:var(--text-4);font-size:12px">Aucun bucket</span>'; }
    else {
        el.innerHTML = buckets.map(b => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-0);font-size:12px">
                <span style="font-weight:600;flex:1;color:var(--text-0)">${b.name}</span>
                <span style="font-size:9px;color:var(--text-4)">${b.created || ''}</span>
                <button class="btn btn-xs" onclick="document.getElementById('set-r2-bucket').value='${b.name}'">Utiliser</button>
            </div>`).join('');
    }
    document.getElementById('r2-create-bucket').style.display = 'block';
}

async function createR2Bucket() {
    const name = document.getElementById('r2-new-bucket').value.trim();
    if (!name) return;
    const r = await apiPost('r2/buckets', { name });
    if (r.success) { toast(r.message); loadR2Buckets(); document.getElementById('r2-new-bucket').value = ''; }
    else toast(r.message, 'error');
}

/* ═══════════════════════════════════════════════════════════
   CLOUD SYNC — Overview Page
   ═══════════════════════════════════════════════════════════ */

async function loadCloudOverview() {
    const data = await api('cloud/overview');

    // Connection badges
    const badges = document.getElementById('cloud-badges');
    badges.innerHTML = `
        ${data.github_connected ? '<span class="badge badge-emerald">GitHub connecte</span>' : '<span class="badge badge-rose">GitHub non configure</span>'}
        ${data.r2_configured ? '<span class="badge badge-emerald">R2 configure</span>' : '<span class="badge badge-rose">R2 non configure</span>'}
    `;

    // GitHub card
    const ghCard = document.getElementById('cloud-gh-info');
    if (data.github_connected) {
        const gh = await api('github/test');
        if (gh.connected) {
            document.getElementById('cloud-gh-badge').innerHTML = '<span class="badge badge-emerald">OK</span>';
            ghCard.innerHTML = `<div style="font-size:12px"><strong>${gh.login}</strong> ${gh.name ? '(' + gh.name + ')' : ''}<br><span class="text-dim">${gh.public_repos || 0} repos publics</span></div>`;
        } else {
            document.getElementById('cloud-gh-badge').innerHTML = '<span class="badge badge-rose">Erreur</span>';
            ghCard.innerHTML = `<span style="color:var(--rose)">${gh.message}</span>`;
        }
    } else {
        document.getElementById('cloud-gh-badge').innerHTML = '<span class="badge badge-amber">Non configure</span>';
        ghCard.innerHTML = '<a onclick="go(\'settings\')" style="color:var(--sky);cursor:pointer;font-size:12px">Configurer dans Parametres</a>';
    }

    // R2 card
    const r2Card = document.getElementById('cloud-r2-info');
    if (data.r2_configured) {
        const r2 = await api('r2/test');
        if (r2.connected) {
            document.getElementById('cloud-r2-badge').innerHTML = '<span class="badge badge-emerald">OK</span>';
            r2Card.innerHTML = `<div style="font-size:12px"><strong>${r2.bucket_count} buckets</strong><br><span class="text-dim">${r2.buckets.join(', ')}</span></div>`;
        } else {
            document.getElementById('cloud-r2-badge').innerHTML = '<span class="badge badge-rose">Erreur</span>';
            r2Card.innerHTML = `<span style="color:var(--rose)">${r2.message}</span>`;
        }
    } else {
        document.getElementById('cloud-r2-badge').innerHTML = '<span class="badge badge-amber">Non configure</span>';
        r2Card.innerHTML = '<a onclick="go(\'settings\')" style="color:var(--sky);cursor:pointer;font-size:12px">Configurer dans Parametres</a>';
    }

    // Projects table
    const tbl = document.getElementById('cloud-projects-table');
    if (!data.projects.length) {
        tbl.innerHTML = '<div style="color:var(--text-4);font-size:12px;text-align:center;padding:20px">Aucun projet</div>';
    } else {
        tbl.innerHTML = `<table><thead><tr>
            <th>Projet</th><th>Git</th><th>Dernier Push</th><th>Dernier Backup R2</th><th>R2</th><th>Regles</th><th>Actions</th>
        </tr></thead><tbody>${data.projects.map(p => `<tr>
            <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span><strong>${p.name}</strong></td>
            <td>${p.git_clean === null ? '<span class="text-dim">—</span>' : (p.git_clean ? '<span class="badge badge-emerald" style="font-size:8px">Clean</span>' : '<span class="badge badge-amber" style="font-size:8px">' + p.pending_changes + ' changes</span>')}</td>
            <td style="font-size:11px">${p.last_push ? new Date(p.last_push).toLocaleDateString() : '<span class="text-dim">Jamais</span>'}</td>
            <td style="font-size:11px">${p.last_backup ? new Date(p.last_backup).toLocaleDateString() : '<span class="text-dim">Jamais</span>'}</td>
            <td style="font-size:11px">${p.r2_objects > 0 ? p.r2_objects + ' obj (' + p.r2_size_h + ')' : '<span class="text-dim">—</span>'}</td>
            <td>${p.rules_count > 0 ? '<span class="badge badge-violet" style="font-size:8px">' + p.rules_count + '</span>' : '<span class="text-dim">0</span>'}</td>
            <td>
                <div class="flex gap-4">
                    ${p.git_clean !== null ? '<button class="btn btn-xs" onclick="cloudSyncGithub(' + p.id + ')">Push</button>' : ''}
                    <button class="btn btn-xs" onclick="cloudBackupR2(' + p.id + ')">Backup</button>
                    ${p.rules_count === 0 ? '<button class="btn btn-xs btn-primary" onclick="cloudApplyDefaults(' + p.id + ')">Init Rules</button>' : ''}
                </div>
            </td>
        </tr>`).join('')}</tbody></table>`;
    }

    // Sync history
    const hist = document.getElementById('cloud-history');
    const history = await api('cloud/history?limit=20');
    if (!history.length) {
        hist.innerHTML = '<div style="color:var(--text-4);font-size:12px;text-align:center;padding:20px">Aucune synchronisation</div>';
    } else {
        hist.innerHTML = `<table><thead><tr><th>Date</th><th>Projet</th><th>Action</th><th>Backend</th><th>Fichiers</th><th>Status</th></tr></thead><tbody>${history.map(h => `<tr>
            <td style="font-size:11px">${new Date(h.started_at).toLocaleString()}</td>
            <td><strong>${h.project_name}</strong></td>
            <td>${h.direction}</td>
            <td><span class="badge ${h.backend === 'github' ? 'badge-violet' : 'badge-sky'}" style="font-size:8px">${h.backend}</span></td>
            <td>${h.files_count || '—'}</td>
            <td><span class="badge ${h.status === 'success' ? 'badge-emerald' : (h.status === 'partial' ? 'badge-amber' : 'badge-rose')}" style="font-size:8px">${h.status}</span></td>
        </tr>`).join('')}</tbody></table>`;
    }
}

async function cloudSyncGithub(pid) {
    const msg = prompt('Message de commit:', 'DevAgent sync');
    if (!msg) return;
    toast('Sync GitHub en cours...', 'info');
    const r = await apiPost(`projects/${pid}/cloud/sync`, { backend: 'github', message: msg, add_all: true });
    if (r.success) { toast(r.message); loadCloudOverview(); }
    else toast(r.message, 'error');
}

async function cloudBackupR2(pid) {
    toast('Backup R2 en cours...', 'info');
    const r = await apiPost(`projects/${pid}/cloud/backup`, {});
    if (r.success) { toast(r.message); loadCloudOverview(); }
    else toast(r.message, 'error');
}

async function cloudApplyDefaults(pid) {
    const r = await apiPost(`projects/${pid}/assets/apply-defaults`, {});
    if (r.success) { toast(r.message); loadCloudOverview(); }
    else toast(r.message, 'error');
}

/* ═══════════════════════════════════════════════════════════
   CLOUD SYNC — Workspace Tab
   ═══════════════════════════════════════════════════════════ */

async function loadWsCloud() {
    const el = document.getElementById('ws-cloud');
    if (!wsProjectData || !wsProjectData.project) { el.innerHTML = ''; return; }
    const p = wsProjectData.project;
    el.innerHTML = '<div class="card" style="padding:16px"><div class="spinner" style="width:16px;height:16px;margin:12px auto"></div></div>';

    const [summary, scanResult] = await Promise.all([
        api(`projects/${p.id}/cloud/summary`),
        api(`projects/${p.id}/assets/scan`)
    ]);

    let html = '';

    // Connection status
    html += `<div class="card mb-8" style="padding:14px">
        <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Connexions</div>
        <div class="flex gap-8">
            ${summary.github_connected ? '<span class="badge badge-emerald">GitHub OK</span>' : '<span class="badge badge-rose">GitHub —</span>'}
            ${summary.r2_configured ? '<span class="badge badge-emerald">R2 OK</span>' : '<span class="badge badge-rose">R2 —</span>'}
        </div>
    </div>`;

    // Sync status
    const ss = summary.sync_status;
    html += `<div class="card mb-8" style="padding:14px">
        <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Sync Status</div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12px;align-items:center">
            <span class="text-dim">Dernier push GitHub</span><span>${ss.last_github_push ? new Date(ss.last_github_push.date).toLocaleString() + ' (' + ss.last_github_push.files + ' fichiers)' : '<span class="text-dim">Jamais</span>'}</span>
            <span class="text-dim">Dernier backup R2</span><span>${ss.last_r2_backup ? new Date(ss.last_r2_backup.date).toLocaleString() : '<span class="text-dim">Jamais</span>'}</span>
            <span class="text-dim">Objets R2</span><span>${ss.r2_objects.count} (${fmtBytes(ss.r2_objects.total_size)})</span>
            <span class="text-dim">Regles</span><span>${ss.rules_count} ${!ss.has_rules ? '<button class="btn btn-xs btn-primary" style="margin-left:8px" onclick="wsCloudApplyDefaults()">Appliquer defauts</button>' : ''}</span>
        </div>
    </div>`;

    // Quick actions
    html += `<div class="card mb-8" style="padding:14px">
        <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Actions</div>
        <div class="flex gap-6" style="flex-wrap:wrap">
            <button class="btn btn-xs btn-primary" onclick="wsCloudPushGithub()">Push GitHub</button>
            <button class="btn btn-xs" onclick="wsCloudPull()">Pull GitHub</button>
            <button class="btn btn-xs" style="border-color:var(--sky);color:var(--sky)" onclick="wsCloudBackupR2()">Backup R2</button>
            <button class="btn btn-xs" onclick="wsCloudRestoreR2()">Restore R2</button>
            <button class="btn btn-xs" onclick="wsCloudScanAssets()">Scanner assets</button>
        </div>
    </div>`;

    // Asset breakdown (if scan has data)
    if (scanResult.breakdown && Object.keys(scanResult.breakdown).length > 0) {
        const b = scanResult.breakdown;
        const typeLabels = { source: 'Code source', database: 'Base de donnees', media: 'Media', config: 'Config/Secrets', build: 'Build', session: 'Sessions', unclassified: 'Non classifie' };
        const typeColors = { source: 'var(--violet)', database: 'var(--sky)', media: 'var(--emerald)', config: 'var(--amber)', build: 'var(--text-4)', session: 'var(--text-3)', unclassified: 'var(--rose)' };
        const backendLabels = { github: 'GitHub', r2: 'Cloudflare R2', local: 'Local', ephemeral: 'Ephemere', unclassified: '—' };

        html += `<div class="card mb-8" style="padding:14px">
            <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Assets (${scanResult.total_files} fichiers)</div>
            ${Object.entries(b).map(([type, info]) => `
                <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-0);font-size:12px">
                    <span style="width:10px;height:10px;border-radius:2px;background:${typeColors[type] || 'var(--text-4)'};flex-shrink:0"></span>
                    <span style="flex:1;font-weight:600;color:var(--text-0)">${typeLabels[type] || type}</span>
                    <span class="text-dim">${info.count} fichiers</span>
                    <span style="font-weight:500">${fmtBytes(info.size)}</span>
                    <span class="badge ${info.backend === 'github' ? 'badge-violet' : info.backend === 'r2' ? 'badge-sky' : 'badge-amber'}" style="font-size:8px">${backendLabels[info.backend] || info.backend}</span>
                </div>`).join('')}
        </div>`;
    }

    // Asset rules
    if (summary.rules.length > 0) {
        html += `<div class="card" style="padding:14px">
            <div class="flex-between mb-8">
                <span style="font-size:13px;font-weight:700;color:var(--text-0)">Regles (${summary.rules.length})</span>
                <button class="btn btn-xs" onclick="wsCloudAddRule()">+ Ajouter</button>
            </div>
            <div style="max-height:200px;overflow-y:auto">
                ${summary.rules.map(r => `
                    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-0);font-size:11px">
                        <code style="flex:1;color:var(--text-2)">${r.glob_pattern}</code>
                        <span class="badge badge-violet" style="font-size:8px">${r.asset_type}</span>
                        <span class="text-dim">${r.storage_backend}</span>
                        <button class="btn btn-xs btn-danger" onclick="wsCloudDeleteRule(${r.id})" style="font-size:9px">X</button>
                    </div>`).join('')}
            </div>
        </div>`;
    } else {
        html += `<div class="card" style="padding:14px">
            <div style="color:var(--text-4);font-size:12px;text-align:center;padding:12px">
                Pas de regles configurees
                <br><button class="btn btn-xs btn-primary mt-8" onclick="wsCloudApplyDefaults()">Appliquer les regles par defaut</button>
            </div>
        </div>`;
    }

    // Sync history
    if (summary.history.length > 0) {
        html += `<div class="card mt-8" style="padding:14px">
            <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Historique</div>
            ${summary.history.slice(0, 8).map(h => `
                <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-0);font-size:11px">
                    <span class="text-dim" style="width:100px">${new Date(h.started_at).toLocaleDateString()}</span>
                    <span>${h.direction}</span>
                    <span class="badge ${h.backend === 'github' ? 'badge-violet' : 'badge-sky'}" style="font-size:8px">${h.backend}</span>
                    <span style="flex:1;text-align:right">${h.files_count || 0} fichiers</span>
                    <span class="badge ${h.status === 'success' ? 'badge-emerald' : 'badge-rose'}" style="font-size:8px">${h.status}</span>
                </div>`).join('')}
        </div>`;
    }

    el.innerHTML = html;
}

function fmtBytes(b) {
    if (!b || b === 0) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0;
    while (Math.abs(b) >= 1024 && i < units.length - 1) { b /= 1024; i++; }
    return b.toFixed(1) + ' ' + units[i];
}

async function wsCloudPushGithub() {
    if (!wsProjectData) return;
    const msg = prompt('Message de commit:', 'DevAgent sync');
    if (!msg) return;
    toast('Push GitHub en cours...', 'info');
    const r = await apiPost(`projects/${wsProjectData.project.id}/cloud/sync`, { backend: 'github', message: msg, add_all: true });
    if (r.success) { toast(r.message); loadWsCloud(); }
    else toast(r.message, 'error');
}

async function wsCloudPull() {
    if (!wsProjectData) return;
    toast('Pull en cours...', 'info');
    const r = await apiPost(`projects/${wsProjectData.project.id}/git/pull`, {});
    if (r.success) toast('Pull OK: ' + (r.output || '').substring(0, 100));
    else toast(r.output || 'Erreur', 'error');
}

async function wsCloudBackupR2() {
    if (!wsProjectData) return;
    toast('Backup R2 en cours...', 'info');
    const r = await apiPost(`projects/${wsProjectData.project.id}/cloud/backup`, {});
    if (r.success) { toast(r.message); loadWsCloud(); }
    else toast(r.message, 'error');
}

async function wsCloudRestoreR2() {
    if (!wsProjectData) return;
    if (!confirm('Restaurer les fichiers depuis R2 ?')) return;
    toast('Restore R2 en cours...', 'info');
    const r = await apiPost(`projects/${wsProjectData.project.id}/cloud/restore`, {});
    if (r.success) { toast(r.message); loadWsCloud(); }
    else toast(r.message, 'error');
}

async function wsCloudScanAssets() {
    if (!wsProjectData) return;
    toast('Scan en cours...', 'info');
    await loadWsCloud();
    toast('Scan termine');
}

async function wsCloudApplyDefaults() {
    if (!wsProjectData) return;
    const r = await apiPost(`projects/${wsProjectData.project.id}/assets/apply-defaults`, {});
    if (r.success) { toast(r.message); loadWsCloud(); }
    else toast(r.message, 'error');
}

async function wsCloudAddRule() {
    if (!wsProjectData) return;
    const pattern = prompt('Glob pattern (ex: *.sql, media/*, .env):');
    if (!pattern) return;
    const types = ['source', 'database', 'media', 'config', 'build', 'session'];
    const type = prompt('Type d\'asset (' + types.join(', ') + '):', 'source');
    if (!type || !types.includes(type)) { toast('Type invalide', 'error'); return; }
    const backends = ['github', 'r2', 'local', 'ephemeral'];
    const backend = prompt('Backend (' + backends.join(', ') + '):', type === 'source' ? 'github' : (type === 'config' ? 'local' : 'r2'));
    if (!backend || !backends.includes(backend)) { toast('Backend invalide', 'error'); return; }
    const r = await apiPost(`projects/${wsProjectData.project.id}/assets/rules`, { asset_type: type, storage_backend: backend, glob_pattern: pattern });
    if (r.success) { toast('Regle ajoutee'); loadWsCloud(); }
    else toast(r.message || 'Erreur', 'error');
}

async function wsCloudDeleteRule(ruleId) {
    if (!wsProjectData) return;
    await apiDel(`projects/${wsProjectData.project.id}/assets/rules/${ruleId}`);
    toast('Regle supprimee');
    loadWsCloud();
}

