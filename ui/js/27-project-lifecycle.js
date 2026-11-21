/* ═══ Project lifecycle UI: add / delete / move (backend: projects.py) ═══ */
function hx(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// apiPost that returns the JSON body even on 409 (refusals carry a message)
async function apiJson(method, u, d) {
    const opt = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (d !== undefined) opt.body = JSON.stringify(d);
    const res = await fetch('/api/' + u, opt);
    try { return await res.json(); }
    catch (e) { return { success: false, message: 'Erreur serveur (' + res.status + ')' }; }
}

function showErr(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg || '';
    el.style.display = msg ? '' : 'none';
}

// ── Add ──
let addMode = 'new';
let addCustom = false;

function openAddProject(tab, prefill) {
    if (tab === 'term' && window._imp && window._imp.ws && window._imp.ws.readyState <= WebSocket.OPEN) {
        showModal('import-modal'); setTimeout(impFit, 50); return;
    }
    ['add-url', 'add-name', 'add-branch', 'add-loc-custom', 'add-desc', 'add-src', 'add-src-name'].forEach(id => document.getElementById(id).value = '');
    delete document.getElementById('add-name').dataset.touched;
    document.querySelector('input[name="add-mode"][value="move"]').checked = true;
    addCustom = false;
    document.getElementById('add-loc-custom').style.display = 'none';
    document.getElementById('add-loc-toggle').textContent = 'Choisir un autre emplacement';
    if (prefill) {
        if (prefill.url) document.getElementById('add-url').value = prefill.url;
        if (prefill.name) document.getElementById('add-name').value = prefill.name;
    }
    addTab(tab || 'new');
    showModal('add-modal');
    setTimeout(() => document.getElementById(tab === 'clone' ? 'add-url' : tab === 'folder' ? 'add-src' : 'add-name').focus(), 50);
}

function addTab(tab) {
    addMode = tab;
    document.querySelectorAll('#add-tabs button').forEach(b => {
        const on = b.dataset.tab === tab;
        b.style.borderColor = on ? 'var(--violet)' : '';
        b.style.color = on ? 'var(--violet)' : '';
    });
    const show = (id, v) => document.getElementById(id).style.display = v ? '' : 'none';
    show('add-common', tab !== 'folder');
    show('add-folder', tab === 'folder');
    show('add-url-group', tab === 'clone');
    show('add-branch-group', tab === 'clone');
    show('add-desc-group', tab === 'new');
    show('add-type-group', tab === 'new');
    modelLoadMeta().then(meta => {
        const sel = document.getElementById('add-type');
        if (sel.options.length <= 1) meta.profiles_order.forEach(k => { const p = meta.profiles[k]; sel.add(new Option(p.icon + ' ' + p.label + ' — ' + p.desc, k)); });
    });
    show('add-term-help', tab === 'term');
    show('add-progress', false);
    showErr('add-error', '');
    const btn = document.getElementById('add-submit');
    btn.disabled = false;
    btn.textContent = { new: 'Creer', clone: 'Cloner', term: 'Ouvrir le terminal', folder: 'Ajouter' }[tab];
    addSyncLocation();
    if (tab === 'folder') addLoadUnregistered();
}

function addUrlChanged() {
    const url = document.getElementById('add-url').value.trim();
    const nameEl = document.getElementById('add-name');
    if (!nameEl.dataset.touched) {
        const tail = url.replace(/\/+$/, '').split('/').pop().split(':').pop();
        nameEl.value = tail.replace(/\.git$/, '');
        addSyncLocation();
    }
}
document.addEventListener('input', e => { if (e.target && e.target.id === 'add-name') e.target.dataset.touched = e.target.value ? '1' : ''; });

function addSyncLocation() {
    const n = document.getElementById('add-name').value.trim();
    document.getElementById('add-loc-default').textContent = '~/devpilot/projects/' + (n || '…');
    document.getElementById('add-loc-default').style.textDecoration = addCustom ? 'line-through' : '';
}

function addToggleCustom() {
    addCustom = !addCustom;
    const input = document.getElementById('add-loc-custom');
    input.style.display = addCustom ? '' : 'none';
    document.getElementById('add-loc-toggle').textContent = addCustom ? 'Utiliser l\'emplacement par defaut' : 'Choisir un autre emplacement';
    if (addCustom) { if (!input.value) input.value = '~/'; input.focus(); }
    addSyncLocation();
}

async function addLoadUnregistered() {
    const box = document.getElementById('add-unregistered');
    const list = await api('projects/unregistered').catch(() => []);
    if (!list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="card-label">Dans ~/devpilot/projects mais pas enregistres</div>` + list.map(f => `
        <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border-0);font-size:12px">
            <span><b>${hx(f.name)}</b> <span style="color:var(--text-4)">${f.repos.length ? hx(f.repos.join(', ')) : 'pas de depot git'}</span></span>
            <button class="btn btn-xs btn-primary" data-path="${hx(f.path)}" onclick="addAdoptInPlace(this.dataset.path)">Enregistrer</button>
        </div>`).join('');
}

async function addAdoptInPlace(path) {
    const r = await apiJson('POST', 'projects/adopt', { path: path, mode: 'link' });
    if (!r.success) { showErr('add-error', r.message); return; }
    toast('Projet "' + r.name + '" enregistre');
    addLoadUnregistered(); loadProjects();
}

async function addSubmit() {
    showErr('add-error', '');
    const btn = document.getElementById('add-submit');
    const name = document.getElementById('add-name').value.trim();
    const path = addCustom ? document.getElementById('add-loc-custom').value.trim() : '';
    let r;

    if (addMode === 'new') {
        r = await apiJson('POST', 'projects', { name: name, path: path,
                                                description: document.getElementById('add-desc').value.trim() });
        if (!r.success) return showErr('add-error', r.message);
        const typ = document.getElementById('add-type').value;
        if (typ) await apiJson('PUT', 'projects/' + r.id + '/model', { profile: typ });
        toast('Projet "' + name + '" cree dans ' + r.path);
        closeModals(); await loadProjects(); openWorkspace(r.id);      // straight into its space

    } else if (addMode === 'clone') {
        const url = document.getElementById('add-url').value.trim();
        if (!url) return showErr('add-error', 'URL requise');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width:12px;height:12px"></span> Clonage...';
        const log = document.getElementById('add-log');
        document.getElementById('add-progress').style.display = '';
        log.textContent = '$ git clone ' + url + '\n';
        r = await apiJson('POST', 'projects/clone', { url: url, name: name, path: path,
                                                      branch: document.getElementById('add-branch').value.trim() });
        if (!r.success) { btn.disabled = false; btn.textContent = 'Cloner'; return showErr('add-error', r.message); }
        const job = await waitJob(r.job_id, lines => { log.textContent = '$ git clone ' + url + '\n' + lines.join('\n'); log.scrollTop = log.scrollHeight; });
        btn.disabled = false; btn.textContent = 'Cloner';
        if (job.status !== 'done') return showErr('add-error', job.error);
        toast('"' + job.result.name + '" clone');
        closeModals(); await loadProjects(); showProjectDetail(job.result.id);

    } else if (addMode === 'term') {
        r = await apiJson('POST', 'projects/import/prepare', { name: name, path: path });
        if (!r.success) return showErr('add-error', r.message);
        closeModals();
        showModal('import-modal');
        impOpenTerminal(r);

    } else if (addMode === 'folder') {
        const src = document.getElementById('add-src').value.trim();
        if (!src) return showErr('add-error', 'Chemin requis');
        const mode = document.querySelector('input[name="add-mode"]:checked').value;
        btn.disabled = true;
        r = await apiJson('POST', 'projects/adopt', { path: src, mode: mode, name: document.getElementById('add-src-name').value.trim() });
        btn.disabled = false;
        if (!r.success) return showErr('add-error', r.message + reportText(r.details));
        toast('Projet "' + r.name + '" ajoute');
        closeModals(); await loadProjects(); showProjectDetail(r.id);
    }
}

async function waitJob(jid, onLog) {
    while (true) {
        const j = await api('jobs/' + jid);
        if (onLog) onLog(j.log || []);
        if (j.status !== 'running') return j;
        await new Promise(res => setTimeout(res, 400));
    }
}

function reportText(d) {
    if (!d) return '';
    return '\n' + [...(d.blockers || []), ...(d.risks || [])].map(x => '• ' + x).join('\n');
}

// ── Delete ──
let delProject = null;

async function openDeleteModal(pid) {
    const p = projectsCache.find(x => x.id === pid) || { id: pid, name: '' };
    delProject = p;
    document.getElementById('del-title').textContent = 'Supprimer "' + p.name + '"';
    document.getElementById('del-body').innerHTML = '<div class="loading-state"><div class="spinner"></div> Inventaire de tout ce qui appartient au projet...</div>';
    document.getElementById('del-files').style.display = 'none';
    document.getElementById('del-log').style.display = 'none';
    document.getElementById('del-confirm').value = '';
    document.getElementById('del-expected').textContent = p.name;
    document.getElementById('del-files-btn').disabled = true;
    showErr('del-error', '');
    showModal('del-modal');

    const pl = await api('projects/' + pid + '/purge-plan');
    delProject.plan = pl;
    if (!pl.exists) {
        document.getElementById('del-body').innerHTML = `<div class="alert alert-info">Le dossier n'existe plus : seul l'enregistrement sera retire.</div>`;
        return;
    }
    const f = pl.folder;
    const repoRows = (f.repos || []).map(r => {
        const st = r.state || {};
        const bad = st.modified || st.untracked || st.unpushed || st.stash || !st.has_remote;
        return `<tr><td class="mono">${hx(r.dir)}</td><td>${hx(st.branch || '')}</td>
            <td class="text-right">${st.modified ?? '?'} / ${st.untracked ?? '?'}</td>
            <td class="text-right" style="${st.unpushed ? 'color:var(--rose);font-weight:700' : ''}">${st.unpushed ?? '?'}</td>
            <td>${bad ? '<span class="badge badge-amber">a verifier</span>' : '<span class="badge badge-emerald">sauvegarde</span>'}</td></tr>`;
    }).join('');
    document.getElementById('del-body').innerHTML = `
        <div class="mono" style="font-size:11px;color:var(--text-3);margin-bottom:8px">${hx(f.path)} — ${f.size != null ? fmtBytes(f.size) : '?'}</div>
        ${(f.repos || []).length ? `<div style="overflow-x:auto;max-height:180px;overflow-y:auto"><table><thead><tr><th>Depot</th><th>Branche</th><th class="text-right">Modifs / non suivis</th><th class="text-right">Non pousses</th><th></th></tr></thead><tbody>${repoRows}</tbody></table></div>` : ''}
        ${(f.blockers || []).map(b => `<div class="alert alert-critical mt-8">${hx(b)}</div>`).join('')}
        ${(f.risks || []).length ? `<div class="alert alert-warning mt-8"><div><b>Ce qui serait perdu avec le dossier :</b><br>${f.risks.map(x => '• ' + hx(x)).join('<br>')}</div></div>` : ''}
        <div style="font-size:12px;color:var(--text-2);margin-top:10px">« Retirer de DevAgent » ne touche a rien : ni fichiers, ni conteneurs.</div>`;
    delRenderPlan(pl);
    document.getElementById('del-files').style.display = '';
}

function delRenderPlan(pl) {
    const box = (key, label, checked, extra) => `<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;padding:4px 0;cursor:pointer">
        <input type="checkbox" class="del-opt" data-k="${key}" ${checked ? 'checked' : ''} style="accent-color:var(--rose);margin-top:2px">
        <span>${label}${extra ? '<br><span style="font-size:10px;color:var(--text-4)">' + extra + '</span>' : ''}</span></label>`;
    const d = pl.docker || [];
    const cs = d.flatMap(g => g.containers), vols = d.flatMap(g => g.volumes), nets = d.flatMap(g => g.networks), imgs = d.flatMap(g => g.images);
    const ports = [...new Set(cs.flatMap(c => c.ports))].sort((a, b) => a - b);
    let html = '';
    if (cs.length) html += box('containers', `<b>${cs.length} conteneur(s)</b> ${d.map(g => '<span class="mono">' + hx(g.name) + '</span>').join(', ')}`, true,
        cs.map(c => hx(c.name) + (c.running ? ' (en cours)' : '')).join(', ') + (ports.length ? ' — ports liberes : ' + ports.join(', ') : ''));
    if (nets.length) html += box('networks', `<b>${nets.length} reseau(x)</b>`, true, nets.map(hx).join(', '));
    if (vols.length) html += box('volumes', `<b>${vols.length} volume(s) Docker</b> <span style="color:var(--rose)">— donnees (bases de donnees...) supprimees definitivement</span>`, true, vols.map(hx).join(', '));
    if (imgs.length) html += box('images', `<b>${imgs.length} image(s) construite(s) par le projet</b>`, true,
        imgs.map(i => hx(i.ref) + ' ' + hx(i.size)).join(', ') + ' — les images de base partagees (postgres, node...) sont gardees');
    if ((pl.processes || []).length) html += box('processes', `<b>${pl.processes.length} processus lance(s) depuis le dossier</b>`, true,
        pl.processes.map(p => hx(p.name) + ' (' + p.pid + ')' + (p.ports.length ? ' port ' + p.ports.join(', ') : '')).join(', '));
    (pl.outside || []).forEach((o, i) => {
        html += `<label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;padding:4px 0;cursor:pointer">
            <input type="checkbox" class="del-out" data-path="${hx(o.path)}" ${o.default ? 'checked' : ''} style="accent-color:var(--rose);margin-top:2px">
            <span><span class="mono">${hx(o.path.replace(/^\/home\/[^/]+/, '~'))}</span><br><span style="font-size:10px;color:var(--text-4)">${hx(o.why)}${o.default ? '' : ' — non coche par defaut'}</span></span></label>`;
    });
    html += `<label style="display:flex;gap:8px;font-size:12px;padding:4px 0;color:var(--text-3)"><input type="checkbox" checked disabled style="margin-top:2px">
        <span><b>Le dossier du projet</b> (a la corbeille)</span></label>`;
    document.getElementById('del-plan').innerHTML = `<div class="card" style="padding:8px 12px;max-height:280px;overflow-y:auto">${html}</div>`;
}

function delCheck() {
    const ok = document.getElementById('del-confirm').value.trim() === delProject.name
        && !(((delProject.plan || {}).folder || {}).blockers || []).length;
    document.getElementById('del-files-btn').disabled = !ok;
}

async function delRun(everything) {
    const p = delProject;
    let r;
    if (everything) {
        const choices = { outside: [...document.querySelectorAll('.del-out:checked')].map(x => x.dataset.path) };
        document.querySelectorAll('.del-opt').forEach(x => choices[x.dataset.k] = x.checked);
        const btn = document.getElementById('del-files-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner" style="width:12px;height:12px"></span> Suppression...';
        r = await apiJson('POST', 'projects/' + p.id + '/purge', { confirm: document.getElementById('del-confirm').value.trim(), choices: choices });
        btn.textContent = 'Tout supprimer';
        const log = r.log || (r.details && r.details.log) || [];
        if (log.length) {
            const box = document.getElementById('del-log');
            box.style.display = '';
            box.innerHTML = '<div class="card" style="padding:8px 12px;font-size:11px">' + log.map(l => '✓ ' + hx(l)).join('<br>') + '</div>';
        }
        if (!r.success) { btn.disabled = false; return showErr('del-error', r.message); }
        toast('"' + p.name + '" supprime du PC');
        document.getElementById('project-detail').style.display = 'none';
        loadProjects();
        setTimeout(closeModals, 2500);          // leave the log visible a moment
        return;
    }
    r = await apiJson('DELETE', 'projects/' + p.id);
    if (!r.success) return showErr('del-error', r.message + reportText(r.details));
    toast('"' + p.name + '" retire de DevAgent (fichiers conserves)');
    closeModals();
    document.getElementById('project-detail').style.display = 'none';
    loadProjects();
}

// ── Move / relocate / duplicate ──
let moveProject = null;

function openMoveModal(pid) {
    const p = projectsCache.find(x => x.id === pid);
    if (!p) return;
    moveProject = p;
    const missing = p.state === 'missing';
    document.getElementById('move-title').textContent = 'Emplacement de "' + p.name + '"';
    document.getElementById('move-current').textContent = 'Actuel : ' + (p.path || 'aucun');
    document.getElementById('move-missing').style.display = missing ? '' : 'none';
    document.getElementById('move-ok').style.display = missing ? 'none' : '';
    document.getElementById('move-relocate').style.display = missing ? '' : 'none';
    document.getElementById('move-dest').value = p.path || '';
    document.getElementById('move-symlink').checked = false;
    document.getElementById('move-dup-name').value = p.name + '-copie';
    document.getElementById('move-reloc').value = '';
    showErr('move-error', '');
    showModal('move-modal');
}

async function moveRun() {
    const dest = document.getElementById('move-dest').value.trim();
    const r = await apiJson('POST', 'projects/' + moveProject.id + '/move', { dest: dest, custom_location: true,
        leave_symlink: document.getElementById('move-symlink').checked });
    if (!r.success) return showErr('move-error', r.message + reportText(r.details));
    let msg = 'Deplace vers ' + r.project.path;
    if ((r.project.venvs_to_rebuild || []).length) msg += ' — venv a recreer : ' + r.project.venvs_to_rebuild.join(', ');
    toast(msg);
    closeModals(); await loadProjects(); showProjectDetail(moveProject.id);
}

async function relocRun() {
    const r = await apiJson('POST', 'projects/' + moveProject.id + '/relocate', { path: document.getElementById('move-reloc').value.trim() });
    if (!r.success) return showErr('move-error', r.message);
    toast('Chemin mis a jour');
    closeModals(); await loadProjects(); showProjectDetail(moveProject.id);
}

async function dupRun() {
    const r = await apiJson('POST', 'projects/' + moveProject.id + '/duplicate', { name: document.getElementById('move-dup-name').value.trim() });
    if (!r.success) return showErr('move-error', r.message);
    toast('Copie creee : ' + r.project.name);
    closeModals(); await loadProjects(); showProjectDetail(r.project.id);
}

// ── Folders in ~/devpilot/projects that DevAgent does not know ──
async function renderUnregisteredBanner() {
    const box = document.getElementById('unregistered-banner');
    if (!box) return;
    const list = await api('projects/unregistered').catch(() => []);
    box.style.display = list.length ? '' : 'none';
    box.innerHTML = list.length ? `<div class="alert alert-info flex-between" style="align-items:center">
        <span>${list.length} dossier(s) dans ~/devpilot/projects ne sont pas enregistres : ${list.map(f => '<b>' + hx(f.name) + '</b>').join(', ')}</span>
        <button class="btn btn-xs btn-primary" onclick="openAddProject('folder')">Voir</button></div>` : '';
}

/* ── Lier a GitHub = a terminal in the project folder; DevAgent records what you cloned ── */
async function openLinkTerminal(pid) {
    const p = projectsCache.find(x => x.id === pid) || wsProjectData?.project;
    if (!p || !p.path) return toast('Projet sans dossier', 'error');
    const imp = window._imp;
    if (imp && imp.linkPid === pid && imp.ws && imp.ws.readyState <= WebSocket.OPEN) {
        showModal('import-modal'); setTimeout(impFit, 50); return;       // already open: bring it back
    }
    closeModals();
    showModal('import-modal');
    document.getElementById('imp-title').textContent = 'Lier "' + p.name + '" a GitHub';
    document.getElementById('imp-paste').style.display = '';
    document.getElementById('imp-finish').style.display = '';
    document.getElementById('imp-finish').innerHTML = 'Termine &mdash; enregistrer le lien';
    document.getElementById('imp-result').style.display = 'none';
    impOpenTerminal({ name: p.name, path: p.path, sid: 'link-' + pid, mode: 'link', linkPid: pid });
    const btn = document.getElementById('btn-import-project');
    if (btn) btn.textContent = 'Terminal GitHub : ' + p.name;
    const d = await apiJson('GET', 'projects/' + pid + '/github/detect');
    const user = d.gh_user || 'TON-COMPTE';
    const chip = (cmd, title) => `<button class="btn btn-xs mono" title="${hx(title)}" onclick="impType(this.textContent)">${hx(cmd)}</button>`;
    document.getElementById('imp-hints').innerHTML = `<span style="font-size:11px;color:var(--text-3)">Exemples (tape Entree pour lancer) :</span>
        ${chip('git clone git@github.com:' + user + '/' + p.name + '.git .', 'Un depot : clone directement dans le dossier du projet')}
        ${chip('git clone git@github.com:' + user + '/' + p.name + '.git', 'Dans un sous-dossier (projet a plusieurs depots)')}
        <span style="font-size:11px;color:var(--text-4)">ou ton script (./md_console/reconstruct.sh ...)</span>`;
    linkPoll(pid);
}

function linkShowDetect(d) {
    const el = document.getElementById('imp-detect');
    if (!d || d.success === false) { el.textContent = ''; return; }
    if (!d.kind) { el.innerHTML = 'Rien de clone pour l\'instant dans ce dossier.'; return; }
    const what = d.kind === 'single' ? 'un depot a la racine' : d.kind === 'org'
        ? d.repos.length + ' depot(s) de l\'organisation <b>' + hx(d.org) + '</b>' : d.repos.length + ' depot(s)';
    const list = d.kind === 'single' ? '' : ' — ' + d.repos.map(r => '<span class="mono">' + hx(r.dir) + '</span>').join(', ');
    el.innerHTML = '<span style="color:var(--emerald)">Detecte : ' + what + '</span>' + list + '. Clique « Termine » quand tu as fini.';
}

async function linkPoll(pid) {
    // live hint while the terminal is open for this project
    while (window._imp && window._imp.linkPid === pid) {
        if (document.getElementById('import-modal').classList.contains('visible')) {
            linkShowDetect(await apiJson('GET', 'projects/' + pid + '/github/detect'));
        }
        await new Promise(r => setTimeout(r, 3000));
    }
}

async function linkFinish(imp) {
    const pid = imp.linkPid;
    const r = await apiJson('POST', 'projects/' + pid + '/github/detect');
    const box = document.getElementById('imp-result');
    if (!r.success) {
        box.style.display = '';
        box.innerHTML = '<div class="alert alert-warning"></div>';
        box.firstChild.textContent = r.message;
        return;
    }
    // the workspace terminal of the project continues this same shell
    try { localStorage.setItem('dp-term-sid-' + pid, imp.sid); } catch (e) {}
    toast(r.message);
    impDispose();
    closeModals();
    await loadProjects();
    await openWorkspace(pid);
    wsTab('git');
}

function impPasteLink() {
    const imp = window._imp;
    if (!imp || !imp.linkPid) return;
    closeModals();
    showLinkGit(imp.linkPid);
}
/* ── Import project: persistent terminal in the project folder ── */
function openImportProject() { openAddProject('term'); }
// window._imp = { name, path, sid, term, ws, fit }



function impOpenTerminal(info) {
    impDispose();
    document.getElementById('imp-path-label').textContent = info.path;
    const btn = document.getElementById('btn-import-project');
    if (btn) { btn.textContent = 'Terminal d\'import : ' + info.name; btn.style.display = ''; }

    const container = document.getElementById('imp-xterm');
    container.innerHTML = '';
    const term = new Terminal(xtermOptions());
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(container);
    const ws = new WebSocket(terminalWsUrl({ cwd: info.path, sid: info.sid, mode: info.mode || 'import' }));
    window._imp = { name: info.name, path: info.path, sid: info.sid, term: term, ws: ws, fit: fit, linkPid: info.linkPid || null };

    ws.onopen = () => { impFit(); term.focus(); };
    ws.onmessage = (e) => term.write(e.data);
    ws.onclose = () => {
        term.write('\r\n\x1b[31m[Terminal deconnecte]\x1b[0m\r\n');
        if (btn) btn.style.display = 'none';
    };
    term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(d); });
    term.onResize(({ rows, cols }) => { if (ws.readyState === WebSocket.OPEN) ws.send(`\x1b[RESIZE:${rows},${cols}]`); });
    setTimeout(impFit, 100);
}

function impFit() {
    const imp = window._imp;
    if (!imp) return;
    try { imp.fit.fit(); } catch (e) {}
    const dims = imp.fit.proposeDimensions();
    if (dims && imp.ws.readyState === WebSocket.OPEN) imp.ws.send(`\x1b[RESIZE:${dims.rows},${dims.cols}]`);
}
window.addEventListener('resize', () => { if (window._imp) impFit(); });

function impType(cmd) {
    const imp = window._imp;
    if (!imp || imp.ws.readyState !== WebSocket.OPEN) return;
    imp.ws.send(cmd);          // typed, not run: press Enter to confirm
    imp.term.focus();
}

function impDispose() {
    const imp = window._imp;
    if (!imp) return;
    try { imp.ws.onclose = null; imp.ws.close(); } catch (e) {}
    try { imp.term.dispose(); } catch (e) {}
    window._imp = null;
    const btn = document.getElementById('btn-import-project');
    if (btn) btn.style.display = 'none';
}

async function impAbort() {
    const imp = window._imp;
    if (!imp) { closeModals(); return; }
    await apiDel('terminal/sessions/' + encodeURIComponent(imp.sid)).catch(() => {});
    impDispose();
    closeModals();
    toast('Terminal arrete');
}

async function impFinish() {
    const imp = window._imp;
    if (!imp) return;
    if (imp.linkPid) return linkFinish(imp);
    const r = await apiPost('projects/import/finish', { name: imp.name, path: imp.path });
    const box = document.getElementById('imp-result');
    if (!r.success) {
        box.style.display = '';
        box.innerHTML = '<div class="alert alert-warning"></div>';
        box.firstChild.textContent = r.message;
        return;
    }
    // The project's own terminal reattaches to this session
    try { localStorage.setItem('dp-term-sid-' + r.id, imp.sid); } catch (e) {}
    const repos = (r.repos || []).map(x => x.dir).join(', ');
    toast('Projet "' + r.name + '" ' + (r.created ? 'enregistre' : 'mis a jour') + (repos ? ' — depots : ' + repos : ''));
    impDispose();          // detach only: the shell keeps running server-side
    closeModals();
    await loadProjects();
    if (typeof openWorkspace === 'function') openWorkspace(r.id);
}

// Open real system terminal for this project
async function wsOpenTerminal(mode) {
    if (!wsProjectId) { toast('Pas de projet actif', 'error'); return; }

    // Make sure CLAUDE.md is up to date before launching Claude
    if (mode === 'claude') {
        await apiPost('projects/' + wsProjectId + '/init-devpilot', {}).catch(() => {});
    }

    const r = await apiPost('projects/' + wsProjectId + '/open-terminal', { mode: mode });
    if (r.success) {
        toast(mode === 'claude' ? 'Claude ouvert dans un terminal' : 'Terminal ouvert');
    } else {
        toast(r.error || 'Erreur ouverture terminal', 'error');
    }
}

async function saveDetailChecklist() {
    const tasks = window._specsChecklist;
    const pid = window._specsPid;
    if (!tasks || !pid) return;
    document.querySelectorAll('.detail-check').forEach(cb => {
        const idx = parseInt(cb.dataset.idx);
        if (tasks[idx]) {
            tasks[idx].done = cb.checked;
            const label = cb.nextElementSibling;
            if (label) {
                label.style.textDecoration = cb.checked ? 'line-through' : 'none';
                label.style.color = cb.checked ? 'var(--text-4)' : 'var(--text-1)';
            }
        }
    });
    const doneCount = tasks.filter(t => t.done).length;
    const pct = tasks.length ? Math.round(doneCount / tasks.length * 100) : 0;
    const bar = document.querySelector('#detail-specs-section .progress-fill');
    if (bar) bar.style.width = pct + '%';
    await apiPost('projects/' + pid + '/checklist', { checklist: tasks });
}

function showLinkGit(pid) {
    window._linkGitPid = pid;
    window._linkGitOrg = currentPage === 'workspace' && wsProjectId === pid && wsIsMultiRepo();
    const org = window._linkGitOrg;
    document.querySelector('#git-modal h3').textContent = org ? 'Lier a une organisation GitHub' : 'Lier a GitHub';
    document.querySelector('#git-modal p').textContent = org
        ? "Ce projet contient plusieurs depots. Donne l'organisation GitHub : DevAgent liste ses depots, retrouve ceux deja clones ici (a n'importe quelle profondeur) et te propose de cloner les autres."
        : "Colle le lien du depot GitHub. Le dossier du projet est lie directement : ensuite pull / push marchent depuis DevAgent ou n'importe quel terminal. Rien n'est ecrase ni fusionne.";
    document.querySelector('#git-modal label').textContent = org ? 'Organisation GitHub' : 'Lien du depot';
    document.getElementById('git-url').placeholder = org ? 'marocdefender  ou  github.com/marocdefender'
        : 'https://github.com/osarsar/mon-projet  ou  osarsar/mon-projet';
    document.getElementById('git-url').value = '';
    document.getElementById('git-output').style.display = 'none';
    document.getElementById('git-link-btn').disabled = false;
    document.getElementById('git-link-btn').textContent = 'Lier';
    document.getElementById('git-link-btn').style.background = '';
    document.getElementById('git-replace-btn').style.display = 'none';
    showModal('git-modal');
    setTimeout(() => document.getElementById('git-url').focus(), 50);
}

async function executeLinkGit(replace) {
    const pid = window._linkGitPid;
    const url = document.getElementById('git-url').value.trim();
    if (!url) { toast('Lien requis', 'error'); return; }
    const btn = document.getElementById('git-link-btn');
    const log = document.getElementById('git-log');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:12px;height:12px"></span> Verification...';
    document.getElementById('git-replace-btn').style.display = 'none';
    document.getElementById('git-output').style.display = 'block';
    log.textContent = 'Verification de l\'acces au depot...\n';

    const r = window._linkGitOrg
        ? await apiJson('POST', 'projects/' + pid + '/github/org', { org: url })
        : await apiJson('POST', 'projects/' + pid + '/link-git', { url: url, replace: !!replace });
    btn.disabled = false;
    log.textContent = r.message || '';
    if (!r.success) {
        btn.textContent = 'Lier';
        if (r.details && r.details.needs_confirm) document.getElementById('git-replace-btn').style.display = '';
        return;
    }
    if (r.action === 'needs_choice') {
        closeModals();
        // the folder is now a repo: refresh the workspace first, so "Plus tard" leaves it up to date
        if (currentPage === 'workspace' && wsProjectId === pid) await openWorkspace(pid);
        openReconcile(pid, '.', r.compare);
        return;
    }
    btn.textContent = 'Lie';
    btn.style.background = 'var(--emerald)';
    toast('Projet lie a GitHub');
    setTimeout(() => {
        closeModals();
        if (currentPage === 'workspace' && wsProjectId === pid) { openWorkspace(pid).then(() => wsTab('git')); }
        else { loadProjects(); showProjectDetail(pid); }
    }, 900);
}

let selectMode = false;
let selectedProjects = new Set();

function toggleSelectMode() {
    selectMode = !selectMode;
    selectedProjects.clear();
    document.getElementById('btn-select-mode').textContent = selectMode ? 'Annuler' : 'Selectionner';
    document.getElementById('btn-select-mode').style.borderColor = selectMode ? 'var(--accent)' : '';
    document.getElementById('btn-delete-selected').style.display = 'none';
    renderProjectGrid();
}

function toggleProjectSelect(pid, ev) {
    ev.stopPropagation();
    if (selectedProjects.has(pid)) selectedProjects.delete(pid);
    else selectedProjects.add(pid);
    document.getElementById('btn-delete-selected').style.display = selectedProjects.size > 0 ? '' : 'none';
    document.getElementById('btn-delete-selected').textContent = 'Supprimer (' + selectedProjects.size + ')';
    // Update checkbox
    const cb = document.getElementById('sel-' + pid);
    if (cb) cb.checked = selectedProjects.has(pid);
}

async function deleteSelectedProjects() {
    const count = selectedProjects.size;
    if (!count) return;
    // Bulk = unregister only. Deleting files is per project (inspection + typed name).
    if (!confirm('Retirer ' + count + ' projet(s) de DevAgent ?\n\nLes fichiers sont conserves. Pour supprimer les fichiers, fais-le projet par projet.')) return;
    for (const pid of selectedProjects) {
        await apiJson('DELETE', 'projects/' + pid);
    }
    toast(count + ' projet(s) retire(s) — fichiers conserves');
    selectedProjects.clear();
    selectMode = false;
    document.getElementById('btn-select-mode').textContent = 'Selectionner';
    document.getElementById('btn-select-mode').style.borderColor = '';
    document.getElementById('btn-delete-selected').style.display = 'none';
    document.getElementById('project-detail').style.display = 'none';
    loadProjects();
}

function addFromPath() { openAddProject('folder'); }

function pathLine(p) {
    return `<div class="flex gap-6 mt-8" style="align-items:center">
        <span class="mono" style="font-size:10px;color:${p.state === 'missing' ? 'var(--rose)' : 'var(--text-4)'}">${p.path ? hx(p.path) : 'Pas de dossier'}${p.state === 'missing' ? ' — introuvable' : ''}</span>
        <button class="btn btn-xs" onclick="openMoveModal(${p.id})" style="font-size:9px">${p.state === 'missing' ? 'Relocaliser' : 'Deplacer / dupliquer'}</button>
    </div>`;
}

function changePath(pid) { openMoveModal(pid); }

async function runOpenFolder(path) {
    await apiPost('terminal/exec', { cmd: 'xdg-open ' + shq(path), cwd: path });
}

// (launchProjectConsole: see the controller section above)

async function updateProjectConsole(pid, btn) {
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Mise à jour...';
    try {
        const r = await apiPost('projects/' + pid + '/update-console', {});
        if (r.success) {
            toast(r.message || 'Console mise à jour');
            if (r.log) console.log('Update log:', r.log);
        } else {
            toast(r.error || 'Échec de la mise à jour', 'error');
        }
    } catch (e) {
        toast('Erreur: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = oldText;
    }
}

function deleteProject(pid) { openDeleteModal(pid); }

async function setLifecycle(status) {
    if (!detailPid) return;
    await apiPost('projects/' + detailPid + '/lifecycle', { status });
    toast('Status: ' + status);
    loadProjects();
    showProjectDetail(detailPid);
}

async function showSpecs() {
    if (!detailPid) return;
    const specs = await api('projects/' + detailPid + '/specs');
    if (!specs || !specs.prompt) { toast('Aucune spec sauvegardee', 'error'); return; }

    const tasks = specs.checklist || [];
    document.getElementById('wiz-result-checklist').innerHTML = `
        <div class="card-label">Checklist — taches manuelles</div>
        <div style="max-height:250px;overflow-y:auto">
            ${tasks.map((t, i) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-0);font-size:12px">
                <input type="checkbox" class="spec-check" data-idx="${i}" ${t.done ? 'checked' : ''} onchange="saveChecklistState()" style="accent-color:var(--violet);width:14px;height:14px;flex-shrink:0">
                <label style="cursor:pointer;flex:1;${t.done ? 'text-decoration:line-through;color:var(--text-4)' : ''}">${t.text}</label>
            </div>`).join('')}
        </div>`;

    document.getElementById('wiz-result-prompt').textContent = specs.prompt;
    window._generatedPrompt = specs.prompt;
    window._specsPid = detailPid;
    window._specsChecklist = tasks;
    // View mode — hide create button, show close
    window._wizardMode = 'view';
    document.getElementById('wiz-finish-btn').textContent = 'Fermer';
    document.getElementById('wiz-finish-btn').onclick = () => closeSpecsModal();
    showModal('wizard-result-modal');
}

function closeSpecsModal() {
    saveChecklistState();
    closeModals();
}

async function saveChecklistState() {
    if (!window._specsPid || !window._specsChecklist) return;
    document.querySelectorAll('.spec-check').forEach(cb => {
        const idx = parseInt(cb.dataset.idx);
        if (window._specsChecklist[idx]) {
            window._specsChecklist[idx].done = cb.checked;
        }
    });
    await apiPost('projects/' + window._specsPid + '/checklist', { checklist: window._specsChecklist });
}

async function showCleanupPreview(pid) {
    detailPid = pid;
    const data = await api('projects/' + pid + '/cleanup-preview');

    const catLabel = { cache: 'Cache', docker: 'Docker', file: 'Fichier', port: 'Port', project_dir: 'Dossier' };
    const catBadge = { cache: 'badge-sky', docker: 'badge-violet', file: 'badge-amber', port: 'badge-emerald', project_dir: 'badge-rose' };

    document.getElementById('cleanup-items').innerHTML = data.items.map((item, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-0)">
            <input type="checkbox" class="cleanup-check" data-idx="${i}" ${item.safe ? 'checked' : ''} style="accent-color:var(--violet);width:15px;height:15px;flex-shrink:0">
            <span class="badge ${catBadge[item.category] || 'badge-violet'}" style="min-width:60px;justify-content:center">${catLabel[item.category] || item.category}</span>
            <span style="flex:1;font-size:12px;font-weight:500">${item.name}</span>
            <span class="mono text-dim">${item.size_h}</span>
            ${item.safe ? '<span class="badge badge-emerald">safe</span>' : '<span class="badge badge-rose">attention</span>'}
        </div>`).join('');

    document.getElementById('cleanup-total').textContent = `${data.total_reclaimable_h} recuperables`;
    document.getElementById('cleanup-set-done').checked = false;
    window._cleanupData = data;
    showModal('cleanup-modal');
}

async function executeSelectiveCleanup() {
    if (!window._cleanupData || !detailPid) return;
    const selected = [];
    document.querySelectorAll('.cleanup-check:checked').forEach(cb => {
        selected.push(window._cleanupData.items[parseInt(cb.dataset.idx)]);
    });
    if (!selected.length) { toast('Rien selectionne', 'error'); return; }

    const hasProjDir = selected.some(s => s.category === 'project_dir');
    if (hasProjDir && !confirm('Tu as selectionne le dossier projet entier. Es-tu sur ?')) return;

    closeModals();
    const setDone = document.getElementById('cleanup-set-done').checked;

    const r = await apiPost('projects/' + detailPid + '/cleanup', {
        items: selected,
        delete_project_dir: hasProjDir,
        set_done: setDone,
    });

    toast(r.message);
    loadProjects();
    if (!hasProjDir) showProjectDetail(detailPid);
    else document.getElementById('project-detail').style.display = 'none';
}

let pmTab = 'clone';
function pmSwitchTab(tab) { /* only the edit form remains; adding goes through openAddProject */ }

function showCreateProject() { openAddProject('new'); }

function editProject(pid) {
    const p = projectsCache.find(x => x.id === pid); if (!p) return;
    editingProjId = pid;
    document.getElementById('project-modal-title').textContent = 'Modifier';
    pmSwitchTab('manual');
    document.getElementById('pm-name').value = p.name;
    document.getElementById('pm-desc').value = p.description;
    document.getElementById('pm-path').value = p.path || '';
    document.getElementById('pm-pattern').value = '';
    selectedColor = p.color;
    renderColors();
    showModal('project-modal');
}
function renderColors() { document.getElementById('color-picker').innerHTML = COLORS.map(c => `<span style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c === selectedColor ? 'white' : 'transparent'};transition:.15s;display:inline-block" onclick="selectedColor='${c}';renderColors()"></span>`).join(''); }

async function saveProject() {
    const name = document.getElementById('pm-name').value.trim();
    if (!name) { toast('Nom requis', 'error'); return; }
    const data = { name, color: selectedColor, description: document.getElementById('pm-desc').value.trim(), pattern: document.getElementById('pm-pattern').value.trim() };
    if (editingProjId) {
        const r = await apiJson('PUT', 'projects/' + editingProjId, data);
        if (!r.success) { toast(r.message, 'error'); return; }
        toast('Modifie');
    } else {
        const r = await apiJson('POST', 'projects', data);
        if (!r.success) { toast(r.message, 'error'); return; }
        toast('Projet cree');
    }
    closeModals(); loadProjects();
}

async function scanProjects() {
    const box = document.getElementById('scan-results');
    box.style.display = 'block';
    box.innerHTML = '<div class="loading-state"><div class="spinner"></div> Scan des dossiers...</div>';
    try {
        const detected = await api('scan/detect');
        if (!detected.length) {
            box.innerHTML = '<div class="alert alert-info">Aucun nouveau projet detecte. Tout est deja importe.</div>';
            setTimeout(() => box.style.display = 'none', 3000);
            return;
        }
        window._detectedProjects = detected;
        box.innerHTML = `
            <div class="card" style="border-color:var(--border-2)">
                <div class="flex-between mb-12">
                    <div>
                        <div class="section-title">${detected.length} projets detectes</div>
                        <div style="font-size:11px;color:var(--text-3);margin-top:-8px;margin-bottom:12px">Coche les projets a importer. Les dossiers avec <span class="badge badge-emerald">.git</span> sont probablement de vrais projets.</div>
                    </div>
                    <div class="flex gap-6">
                        <button class="btn btn-sm" onclick="scanToggleAll(true)">Tout cocher</button>
                        <button class="btn btn-sm" onclick="scanToggleAll(false)">Tout decocher</button>
                        <button class="btn btn-sm" onclick="document.getElementById('scan-results').style.display='none'">Fermer</button>
                    </div>
                </div>
                <table><thead><tr><th style="width:30px"></th><th>Projet</th><th>Tech</th><th>Indice</th><th>Chemin</th><th class="text-right">Caches</th></tr></thead>
                <tbody>${detected.map((d, i) => `<tr>
                    <td><input type="checkbox" class="scan-check" data-idx="${i}" ${d.has_git ? 'checked' : ''} style="cursor:pointer;width:15px;height:15px;accent-color:var(--violet)"></td>
                    <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${d.color};margin-right:6px"></span><strong>${d.name}</strong></td>
                    <td><span class="badge badge-violet">${d.manifest}</span></td>
                    <td>${d.has_git ? '<span class="badge badge-emerald">.git</span>' : '<span class="badge badge-amber">pas de .git</span>'}${d.depth <= 1 ? ' <span class="badge badge-sky">racine</span>' : ''}</td>
                    <td class="mono text-dim" style="font-size:10px">${d.path.replace('/home/osarsar/Desktop/', '')}</td>
                    <td class="text-right mono">${d.cache_size_h}</td>
                </tr>`).join('')}</tbody></table>
                <div class="flex-between mt-12">
                    <span id="scan-selected-count" style="font-size:12px;color:var(--text-3)"></span>
                    <div class="flex gap-6" style="align-items:center">
                        <select id="scan-mode" class="form-input" style="width:auto;padding:4px 8px;font-size:12px">
                            <option value="move">Deplacer dans ~/devpilot/projects</option>
                            <option value="link">Garder a leur place</option>
                        </select>
                        <button class="btn btn-primary btn-sm" onclick="importSelected()">Importer la selection</button>
                    </div>
                </div>
            </div>`;
        updateScanCount();
        box.querySelectorAll('.scan-check').forEach(cb => cb.addEventListener('change', updateScanCount));
    } catch (e) { box.innerHTML = '<div class="alert alert-critical">Erreur scan</div>'; }
}

function updateScanCount() {
    const checked = document.querySelectorAll('.scan-check:checked').length;
    const total = document.querySelectorAll('.scan-check').length;
    const el = document.getElementById('scan-selected-count');
    if (el) el.textContent = `${checked} / ${total} selectionnes`;
}

function scanToggleAll(state) {
    document.querySelectorAll('.scan-check').forEach(cb => cb.checked = state);
    updateScanCount();
}

async function importSelected() {
    if (!window._detectedProjects) return;
    const selected = [];
    document.querySelectorAll('.scan-check:checked').forEach(cb => {
        selected.push(window._detectedProjects[parseInt(cb.dataset.idx)]);
    });
    if (!selected.length) { toast('Rien selectionne', 'error'); return; }
    const r = await apiJson('POST', 'scan/import', { projects: selected, mode: document.getElementById('scan-mode').value });
    toast(r.imported + ' projet(s) importe(s)' + (r.errors && r.errors.length ? ' — ' + r.errors.length + ' refuse(s)' : ''));
    if (r.errors && r.errors.length) alert('Refuses :\n\n' + r.errors.join('\n'));
    document.getElementById('scan-results').style.display = 'none';
    loadProjects();
}

function showLinkModal(rid) { pendingLinkId = rid; document.getElementById('link-select').innerHTML = '<option value="">Choisir un projet...</option>' + projectsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join(''); showModal('link-modal'); }
async function executeLink() { const pid = document.getElementById('link-select').value; if (!pid || !pendingLinkId) return; await apiPost('resources/' + pendingLinkId + '/link', { project_id: parseInt(pid) }); closeModals(); toast('Ressource liee'); loadPage(currentPage); }

