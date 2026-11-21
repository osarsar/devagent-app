/* ═══ Multi-repo project ↔ GitHub organisation (backend: ghorg.py) ═══ */
function wsIsMultiRepo() {
    const d = wsProjectData || {};
    return !!d.github_org || (d.repos || []).some(r => r.dir !== '.') && !(d.repos || []).some(r => r.dir === '.');
}

async function loadWsOrg() {
    const box = document.getElementById('ws-org');
    if (!box || !wsProjectData?.github_org) return;
    const pid = wsProjectId;
    box.innerHTML = '<div class="card mb-8" style="padding:14px;font-size:12px;color:var(--text-3)"><span class="spinner" style="width:10px;height:10px"></span> Lecture de github.com/' + hx(wsProjectData.github_org) + '...</div>';
    const ov = await apiJson('GET', 'projects/' + pid + '/github/overview');
    if (pid !== wsProjectId) return;
    if (ov.success === false) { box.innerHTML = `<div class="alert alert-warning">${hx(ov.message)}</div>`; return; }
    window._wsOrg = ov;
    box.innerHTML = renderOrg(ov);
}

function renderOrg(ov) {
    const rows = ov.repos.map(r => {
        const role = r.role ? hx(r.role) : '<span style="color:var(--text-4)">(role)</span>';
        const places = r.clones.length ? r.clones.map(c => {
            const on = wsGitRepo && wsGitRepo.dir === c.dir;
            const dirty = c.modified + c.untracked;
            const badges = [c.ahead ? `<span style="color:var(--violet)">↑${c.ahead}</span>` : '',
                            c.behind ? `<span style="color:var(--sky)">↓${c.behind}</span>` : '',
                            dirty ? `<span class="badge badge-amber">${dirty} modif</span>` : ''].join(' ');
            return `<div data-dir="${hx(c.dir)}" onclick="wsSelectRepo(this.dataset.dir)" title="Choisir ce depot pour Synchroniser et les actions"
                style="cursor:pointer;padding:3px 6px;border-radius:5px;margin-top:2px;${on ? 'background:rgba(109,92,255,.15);' : ''}">
                <span class="mono" style="font-size:11px;${on ? 'color:var(--violet);font-weight:700' : ''}">${hx(c.dir)}</span>
                <span style="font-size:10px;color:var(--text-3)"> ${hx(c.branch)}</span> ${badges}</div>`;
        }).join('') : `<button class="btn btn-xs" data-name="${hx(r.name)}" onclick="wsOrgClone(this.dataset.name)">Cloner</button>
                       <span style="font-size:10px;color:var(--text-4)">pas sur ton PC</span>`;
        return `<div style="padding:8px 0;border-bottom:1px solid var(--border-0)">
            <div class="flex-between" style="gap:6px"><a href="${hx(r.web)}" target="_blank" class="mono" style="font-size:12px;font-weight:700;color:var(--text-0);text-decoration:none">${hx(r.name)}</a>
                <span data-name="${hx(r.name)}" onclick="wsOrgRole(this.dataset.name)" style="font-size:11px;color:var(--text-3);cursor:pointer" title="Modifier le role">${role} ✎</span></div>
            ${places}</div>`;
    }).join('');
    return `<div class="card mb-8" style="padding:14px">
        <div class="flex-between mb-8"><a href="${hx(ov.web)}" target="_blank" style="font-size:13px;font-weight:700;color:var(--text-0);text-decoration:none">github.com/${hx(ov.org)}</a>
            <button class="btn btn-xs btn-primary" onclick="majOpen()" title="Chaque dépôt avec sa branche : tu choisis ce qui est récupéré">⇣ Mettre à jour les dépôts</button></div>
        ${rows}
        <div id="ws-org-out" style="margin-top:8px"></div>
        <div style="font-size:10px;color:var(--text-4);margin-top:6px">Clique sur un emplacement pour le choisir : Synchroniser et les actions rapides s'y appliquent.</div>
    </div>`;
}

async function wsOrgClone(name) {
    const dest = prompt('Ou cloner ' + name + ' ? (chemin dans le dossier du projet)', name);
    if (dest === null) return;
    const out = document.getElementById('ws-org-out');
    out.innerHTML = '<span class="spinner" style="width:10px;height:10px"></span> Clonage de ' + hx(name) + '...';
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/github/clone', { name: name, dest: dest.trim() });
    out.innerHTML = '';
    if (!r.success) return toast(r.message, 'error');
    toast(r.message);
    openWorkspace(wsProjectId).then(() => wsTab('git'));
}

async function wsOrgRole(name) {
    const cur = (window._wsOrg?.repos || []).find(r => r.name === name)?.role || '';
    const role = prompt('Role de ' + name + ' :', cur);
    if (role === null) return;
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/github/role', { name: name, role: role });
    if (!r.success) return toast(r.message, 'error');
    loadWsOrg();
}

async function wsOrgPullAll() {
    const out = document.getElementById('ws-org-out');
    out.innerHTML = '<span class="spinner" style="width:10px;height:10px"></span> Recuperation...';
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/github/pull-all', {});
    if (!r.success) { out.innerHTML = `<div class="alert alert-critical">${hx(r.message)}</div>`; return; }
    const color = { 'recupere': 'var(--emerald)', 'a jour': 'var(--text-3)', 'ignore': 'var(--amber)', 'echec': 'var(--rose)' };
    out.innerHTML = r.report.map(x => `<div style="font-size:11px"><span class="mono">${hx(x.repo)}</span> :
        <span style="color:${color[x.result] || 'inherit'}">${hx(x.result)}</span> ${x.detail ? '<span style="color:var(--text-4)">' + hx(x.detail) + '</span>' : ''}</div>`).join('');
    setTimeout(loadWsOrg, 400);
}

/* ═══ Folder vs GitHub (backend: gitsync.py) ═══ */
let recState = null;     // { pid, repo, compare }

function repoQ(repo) { return repo && repo !== '.' ? '?repo=' + encodeURIComponent(repo) : ''; }

function openReconcile(pid, repo, cmp) {
    recState = { pid: pid, repo: repo || '.', compare: cmp };
    const c = cmp;
    document.getElementById('rec-summary').innerHTML =
        `Branche GitHub <b class="mono">${hx(c.branch)}</b> — rien n'a encore change dans ton dossier.<br>
         <span style="color:var(--emerald)">✓ ${c.identical.length} identique(s)</span> ·
         <span style="color:var(--amber)">≠ ${c.different.length} different(s)</span> ·
         <span>+ ${c.only_local.length} seulement dans ton dossier</span> ·
         <span>+ ${c.only_github.length} seulement sur GitHub</span>`;
    const list = (t, a) => a.length ? t + ' :\n  ' + a.map(hx).join('\n  ') + '\n' : '';
    document.getElementById('rec-lists').innerHTML = list('Differents', c.different) + list('Seulement dans ton dossier', c.only_local)
        + list('Seulement sur GitHub', c.only_github) + list('Identiques', c.identical);
    document.querySelectorAll('input[name="rec-mode"]').forEach(r => r.checked = false);
    document.getElementById('rec-files').style.display = 'none';
    document.getElementById('rec-result').style.display = 'none';
    document.getElementById('rec-options').style.display = '';
    document.getElementById('rec-apply').disabled = true;
    document.getElementById('rec-apply').style.display = '';
    showErr('rec-error', '');
    showModal('rec-modal');
}

function recModeChanged() {
    const mode = document.querySelector('input[name="rec-mode"]:checked')?.value;
    document.getElementById('rec-apply').disabled = !mode;
    const box = document.getElementById('rec-files');
    const diff = recState.compare.different;
    if (mode !== 'merge' || !diff.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    box.innerHTML = `<div class="card-label">Fichiers differents des deux cotes</div>` + diff.map((f, i) => `
        <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border-0);font-size:12px;gap:8px">
            <span class="mono" style="word-break:break-all">${hx(f)}</span>
            <select class="form-input rec-choice" data-file="${hx(f)}" style="width:auto;padding:3px 8px;font-size:11px">
                <option value="">— choisir —</option><option value="local">Le mien</option>
                <option value="github">GitHub</option><option value="edit">Les deux (j'edite)</option>
            </select>
        </div>`).join('');
}

async function recApply() {
    const mode = document.querySelector('input[name="rec-mode"]:checked')?.value;
    const choices = {};
    document.querySelectorAll('.rec-choice').forEach(s => { if (s.value) choices[s.dataset.file] = s.value; });
    const btn = document.getElementById('rec-apply');
    btn.disabled = true;
    const r = await apiJson('POST', 'projects/' + recState.pid + '/git/reconcile', { mode: mode, choices: choices, repo: recState.repo });
    btn.disabled = false;
    if (!r.success) return showErr('rec-error', r.message + (r.details && r.details.missing ? '\n' + r.details.missing.join('\n') : ''));
    showErr('rec-error', '');
    recShowResult(r);
}

function recShowResult(r) {
    const box = document.getElementById('rec-result');
    box.style.display = '';
    document.getElementById('rec-options').style.display = 'none';
    document.getElementById('rec-files').style.display = 'none';
    if (r.status === 'edit') {
        box.innerHTML = `<div class="alert alert-warning"><div>${hx(r.message)}<br>${r.files.map(f => '• <span class="mono">' + hx(f) + '</span>').join('<br>')}</div></div>
            <div class="modal-actions" style="margin-top:8px"><button class="btn btn-primary" onclick="recFinish()">Terminer la fusion</button></div>`;
        document.getElementById('rec-apply').style.display = 'none';
        return;
    }
    closeModals();
    toast(r.message);
    if (currentPage === 'workspace') openWorkspace(recState.pid).then(() => wsTab('git'));
}

async function recFinish(pid, repo) {
    if (pid) recState = { pid: pid, repo: repo || '.' };
    const r = await apiJson('POST', 'projects/' + recState.pid + '/git/reconcile/finish', { repo: recState.repo });
    if (!r.success) {
        if (document.getElementById('rec-modal').classList.contains('visible')) return showErr('rec-error', r.message);
        return toast(r.message, 'error');
    }
    closeModals();
    toast(r.message);
    if (currentPage === 'workspace') openWorkspace(recState.pid).then(() => wsTab('git'));
}

async function recOpenFromWorkspace() {
    const repo = wsGitRepo ? wsGitRepo.dir : '.';
    const c = await apiJson('GET', 'projects/' + wsProjectId + '/git/compare' + repoQ(repo));
    if (c.success === false) return toast(c.message, 'error');
    openReconcile(wsProjectId, repo, c);
}

// ── Sync card in the Git tab ──
async function loadWsSync() {
    const box = document.getElementById('ws-sync');
    if (!box || !wsProjectId) return;
    const pid = wsProjectId, repo = wsGitRepo ? wsGitRepo.dir : '.';
    if (!wsGitRepo) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card mb-8" style="padding:14px;font-size:12px;color:var(--text-3)"><span class="spinner" style="width:10px;height:10px"></span> Verification avec GitHub...</div>';
    const s = await apiJson('GET', 'projects/' + pid + '/git/sync-status' + repoQ(repo));
    if (pid !== wsProjectId) return;
    if (s.success === false) { box.innerHTML = `<div class="alert alert-warning">${hx(s.message)}</div>`; return; }
    box.innerHTML = renderSync(s);
}

function renderSync(s) {
    const card = inner => `<div class="card mb-8" style="padding:14px"><div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:8px">Synchronisation avec GitHub</div>${inner}</div>`;
    if (s.pending_link) return card(`<div style="font-size:12px;color:var(--amber);margin-bottom:8px">La liaison n'est pas terminee : ton dossier et GitHub sont differents.</div>
        <button class="btn btn-xs btn-primary" onclick="recOpenFromWorkspace()">Comparer et choisir</button>`);
    if (s.reconcile_edit && s.reconcile_edit.length) return card(`<div style="font-size:12px;margin-bottom:8px">Fusion en cours : edite ${s.reconcile_edit.map(f => '<span class="mono">' + hx(f) + '</span>').join(', ')} (les deux versions sont dedans), puis :</div>
        <button class="btn btn-xs btn-primary" onclick="recFinish(wsProjectId, wsGitRepo && wsGitRepo.dir)">Terminer la fusion</button>`);
    if (s.rebasing) return card(renderConflicts(s.conflicts));
    const dirty = s.modified + s.untracked;
    const parts = [];
    if (s.ahead) parts.push(`<span style="color:var(--violet)">↑ ${s.ahead} a envoyer</span>`);
    if (s.behind) parts.push(`<span style="color:var(--sky)">↓ ${s.behind} a recuperer</span>`);
    if (dirty) parts.push(`<span style="color:var(--amber)">${dirty} fichier(s) modifie(s)</span>`);
    const line = parts.length ? parts.join(' · ') : '<span style="color:var(--emerald)">A jour avec GitHub</span>';
    return card(`<div style="font-size:12px;margin-bottom:10px">${line}${s.upstream ? '' : ' <span style="color:var(--text-4)">(branche pas encore sur GitHub)</span>'}</div>
        <div id="ws-sync-dirty" style="display:none;margin-bottom:8px">
            <input class="form-input" id="ws-sync-msg" placeholder="Message du commit" style="margin-bottom:6px" onkeydown="if(event.key==='Enter')wsSync('commit')">
            <div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="wsSync('commit')">Commiter et synchroniser</button>
            <button class="btn btn-xs" onclick="wsSync('stash')">Mettre de cote le temps de la synchro</button></div>
        </div>
        <button class="btn btn-xs btn-primary" id="ws-sync-btn" onclick="wsSync()">Synchroniser ${hx(s.branch || '')}</button>
        <span style="font-size:10px;color:var(--text-4);margin-left:6px">la branche <b>${hx(s.branch || '?')}</b> seulement : récupère GitHub (rebase) puis envoie tes commits — pour changer de branche : « ⇣ Mettre à jour les dépôts »</span>
        <div id="ws-sync-out" style="margin-top:8px"></div>`);
}

function renderConflicts(files) {
    // the status card below dates from before the sync: hide it while a conflict is open
    setTimeout(() => { const st = document.getElementById('ws-git-status'); if (st) st.style.display = 'none'; }, 0);
    return `<div style="font-size:12px;color:var(--rose);margin-bottom:8px">Conflit : ces fichiers ont ete modifies ici ET sur GitHub. Choisis pour chacun.</div>
        ${files.map(f => `<div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border-0);font-size:12px;gap:6px;flex-wrap:wrap">
            <span class="mono" style="word-break:break-all">${hx(f)}</span>
            <span class="flex gap-6">
                <button class="btn btn-xs" data-f="${hx(f)}" onclick="wsResolve(this.dataset.f,'local')">Garder le mien</button>
                <button class="btn btn-xs" data-f="${hx(f)}" onclick="wsResolve(this.dataset.f,'github')">Garder GitHub</button>
                <button class="btn btn-xs" data-f="${hx(f)}" onclick="wsResolve(this.dataset.f,'edited')" title="Edite le fichier (les deux versions y sont), puis clique ici">J'ai edite</button>
            </span></div>`).join('')}
        <div class="flex gap-6 mt-8">
            <button class="btn btn-xs btn-primary" onclick="wsSyncContinue()" ${files.length ? 'disabled' : ''}>Continuer</button>
            <button class="btn btn-xs btn-danger" onclick="wsSyncAbort()">Annuler la synchro</button>
        </div>`;
}

async function wsSync(how) {
    const repo = wsGitRepo ? wsGitRepo.dir : '.';
    const body = { repo: repo };
    if (how === 'commit') {
        body.commit_message = document.getElementById('ws-sync-msg').value.trim();
        if (!body.commit_message) return toast('Message du commit requis', 'error');
    }
    if (how === 'stash') body.stash = true;
    const out = document.getElementById('ws-sync-out');
    out.innerHTML = '<span class="spinner" style="width:10px;height:10px"></span> Synchronisation...';
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/git/sync', body);
    out.innerHTML = '';
    if (!r.success) {
        if (r.details && r.details.needs_commit) {
            document.getElementById('ws-sync-dirty').style.display = '';
            document.getElementById('ws-sync-btn').style.display = 'none';
            document.getElementById('ws-sync-msg').focus();
            return;
        }
        out.innerHTML = `<div class="alert alert-critical">${hx(r.message)}</div>`;
        return;
    }
    wsSyncResult(r);
}

function wsSyncResult(r) {
    if (r.status === 'conflict') {
        document.getElementById('ws-sync').innerHTML = `<div class="card mb-8" style="padding:14px"><div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:8px">Synchronisation avec GitHub</div>${renderConflicts(r.conflicts)}</div>`;
        return;
    }
    toast(r.message);
    openWorkspace(wsProjectId).then(() => wsTab('git'));
}

async function wsResolve(file, choice) {
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/git/resolve', { repo: wsGitRepo ? wsGitRepo.dir : '.', file: file, choice: choice });
    if (!r.success) return toast(r.message, 'error');
    document.getElementById('ws-sync').innerHTML = `<div class="card mb-8" style="padding:14px"><div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:8px">Synchronisation avec GitHub</div>${renderConflicts(r.conflicts)}</div>`;
    if (!r.conflicts.length) toast('Tous les fichiers sont choisis : clique Continuer');
}

async function wsSyncContinue() {
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/git/continue', { repo: wsGitRepo ? wsGitRepo.dir : '.' });
    if (!r.success) return toast(r.message, 'error');
    wsSyncResult(r);
}

async function wsSyncAbort() {
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/git/abort', { repo: wsGitRepo ? wsGitRepo.dir : '.' });
    if (!r.success) return toast(r.message, 'error');
    toast(r.message);
    openWorkspace(wsProjectId).then(() => wsTab('git'));
}

