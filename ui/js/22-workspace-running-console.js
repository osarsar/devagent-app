/* ═══ What the project runs: ports, close (backend: ports.py) ═══ */
async function loadWsRunning() {
    const bar = document.getElementById('ws-running-bar');
    if (!bar || !wsProjectId) return;
    const pid = wsProjectId;
    const r = await apiJson('GET', 'projects/' + pid + '/ports');
    if (pid !== wsProjectId || r.success === false) return;
    const items = (r.ports || []).map(x => `<span class="badge" style="background:rgba(16,185,129,.12);color:var(--emerald)" title="${hx(x.label)} — ${hx(x.name)} (pid ${x.pid})">
            <a href="${hx(x.url)}" target="_blank" style="color:inherit;text-decoration:none">:${x.port}</a> ${hx(x.source === 'console' ? 'console' : x.name)}
            <span style="cursor:pointer;margin-left:4px;opacity:.7" title="Arreter et liberer le port" onclick="wsStopPort(${x.port})">✕</span></span>`);
    const dk = (r.docker || []).map(c => `<span class="badge" title="conteneur ${hx(c.name)} (${hx(c.compose)})">🐳 ${hx(c.ports.join(', '))}</span>`);
    if (!items.length && !dk.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px">
            <span style="color:var(--text-3)">En marche :</span>${items.join(' ')}${dk.length ? ' <span style="color:var(--text-4)">·</span> ' + dk.join(' ') : ''}</div>
        ${items.length ? `<button class="btn btn-xs btn-danger" onclick="wsCloseProject()" title="Arrete la console, les terminaux et ce qui tourne depuis le dossier (pas Docker)">Fermer le projet</button>` : ''}`;
}

async function wsStopPort(port) {
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/ports/' + port + '/stop');
    if (!r.success) return toast(r.message, 'error');
    toast(r.message); loadWsRunning(); refreshCtrl();
}

async function wsCloseProject() {
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/close', {});
    if (!r.success) return toast(r.message, 'error');
    toast(r.message + (r.freed.length ? ' — ports liberes : ' + r.freed.join(', ') : ''));
    loadWsRunning(); refreshCtrl();
    if (r.log.some(l => l.includes('terminal'))) startXterm(wsProjectData.project.path, wsProjectId);   // a fresh, empty terminal
}

async function refreshCtrl() {
    if (!wsProjectId) return;
    const d = await apiJson('GET', 'projects/' + wsProjectId + '/controller');
    if (d.success === false) return;
    renderCtrlButton(d.controller);
    if (document.getElementById('ws-controller')) loadWsController();
}

async function restartProjectConsole(pid) {
    toast('Console : redemarrage avec le code actuel...', 'info');
    const r = await apiJson('POST', 'projects/' + pid + '/controller/restart');
    if (!r.success) return toast(r.message, 'error');
    toast('Console redemarree');
    if (currentPage === 'workspace' && wsProjectId === pid) { renderCtrlButton(r.controller); loadWsController(); loadWsRunning(); }
}

/* ═══ The project's own console / controller (backend: controller.py) ═══ */
function ctrlDot(st) {
    const on = st && st.running;
    return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${on ? 'var(--emerald)' : 'var(--text-4)'};margin-right:5px" title="${on ? 'en marche' : 'arretee'}"></span>`;
}

// Header button of the workspace (and detail panel): start if needed, then open
function renderCtrlButton(ctrl) {
    const btn = document.getElementById('ws-ctrl-btn');
    if (!btn) return;
    if (!ctrl) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.innerHTML = ctrlDot(ctrl.status) + 'Console ' + hx(ctrl.name || '') + (ctrl.status && ctrl.status.stale ? ' <span class="badge badge-amber" style="font-size:9px">ancienne version</span>' : '');
    btn.title = (ctrl.status && ctrl.status.stale ? 'Le code a changé : un clic la relance avec le code actuel, puis l\'ouvre — '
                 : ctrl.status && ctrl.status.running ? 'Ouvrir ' : 'Lancer et ouvrir ') + (ctrl.url || '');
}

async function launchProjectConsole(pid) {
    // L'onglet s'ouvre DANS le clic : ouvert après l'attente (lancement, relance),
    // le navigateur le bloque comme une fenêtre surgissante — « le lien n'ouvre plus ».
    const w = window.open('about:blank', '_blank');
    try { w && w.document.write('<body style="font:15px system-ui;background:#0b0b10;color:#c8c8d4;padding:40px">Console : lancement…</body>'); } catch (e) {}
    toast('Console : ouverture...', 'info');
    // fresh : si elle tourne une ANCIENNE version (code changé depuis), elle est relancée avec le code actuel
    const r = await apiJson('POST', 'projects/' + pid + '/controller/start', {fresh: true});
    if (!r.success) { if (w) w.close(); return toast(r.message, 'error'); }
    if (r.restarted) toast('Console relancée avec le code actuel (elle tournait une ancienne version)');
    if (w && !w.closed) w.location.href = r.status.url; else window.open(r.status.url, '_blank');
    if (currentPage === 'workspace' && wsProjectId === pid) { renderCtrlButton(r.controller); loadWsController(); loadWsRunning(); }
}

async function stopProjectConsole(pid) {
    const r = await apiJson('POST', 'projects/' + pid + '/controller/stop');
    if (!r.success) return toast(r.message, 'error');
    toast('Console arretee');
    if (currentPage === 'workspace' && wsProjectId === pid) { renderCtrlButton(r.controller); loadWsController(); loadWsRunning(); }
}

// Connections tab: the console card (what it manages), first
async function loadWsController() {
    const box = document.getElementById('ws-controller');
    if (!box || !wsProjectId) return;
    const pid = wsProjectId;
    const d = await apiJson('GET', 'projects/' + pid + '/controller');
    if (pid !== wsProjectId || d.success === false) return;
    const c = d.controller;
    window._wsCtrl = c;
    if (!c) {
        box.innerHTML = d.candidates && d.candidates.length ? `<div class="card mb-8" style="padding:14px"><div class="flex-between">
            <div><div style="font-size:13px;font-weight:700;color:var(--text-0)">Console du projet</div>
            <div style="font-size:11px;color:var(--text-3)">Un dossier ressemble a une console : ${d.candidates.map(x => '<span class="mono">' + hx(x.dir) + '</span>').join(', ')}</div></div>
            <button class="btn btn-xs" onclick="ctrlDeclare()">Declarer la console</button></div></div>` : '';
        return;
    }
    const st = c.status || {};
    const labels = window._needLabels || {};
    const manages = (c.manages || []).map(k => hx(labels[k] || k)).join(', ');
    box.innerHTML = `<div class="card mb-8" style="padding:14px;border-color:rgba(56,189,248,.35)">
        <div class="flex-between" style="gap:8px;flex-wrap:wrap">
            <div><div style="font-size:13px;font-weight:700;color:var(--text-0)">${ctrlDot(st)}Console du projet : ${hx(c.name || '')}${c.auto ? ' <span class="badge" style="font-size:9px">detectee</span>' : ''}</div>
                <div class="mono" style="font-size:11px;color:var(--text-3);margin-top:3px">${hx(c.dir || '.')} · ${hx(c.command || '')} · <a href="${hx(c.url || '#')}" target="_blank" style="color:var(--sky)">${hx(c.url || '')}</a></div>
                ${st.stale ? `<div style="font-size:11px;color:var(--amber);margin-top:4px">Le code a change depuis son lancement : elle tourne encore l'ancienne version. Clique « Redemarrer ».</div>` : ''}
                <div style="font-size:11px;color:var(--text-2);margin-top:4px">Elle gere : <b>${manages || 'rien de declare'}</b> — ces connexions ne sont pas saisies dans DevAgent.</div></div>
            <div class="flex gap-6" style="flex-wrap:wrap">
                ${st.running ? `<a class="btn btn-xs btn-primary" href="${hx(c.url)}" target="_blank" style="text-decoration:none">Ouvrir</a>
                                <button class="btn btn-xs ${st.stale ? 'btn-primary' : ''}" onclick="restartProjectConsole(wsProjectId)" title="Arreter puis relancer avec le code actuel">Redemarrer</button>
                                <button class="btn btn-xs" onclick="stopProjectConsole(wsProjectId)">Arreter</button>`
                             : `<button class="btn btn-xs btn-primary" onclick="launchProjectConsole(wsProjectId)">Lancer et ouvrir</button>`}
                <button class="btn btn-xs" onclick="ctrlShowLog()">Journal</button>
                <button class="btn btn-xs" onclick="ctrlDeclare()">Modifier</button>
            </div></div>
        <div id="ws-ctrl-log" style="display:none;margin-top:8px"></div></div>`;
}

async function ctrlShowLog() {
    const box = document.getElementById('ws-ctrl-log');
    const lines = await api('projects/' + wsProjectId + '/controller/log?n=60');
    box.style.display = '';
    box.innerHTML = `<pre class="mono" style="font-size:10px;max-height:200px;overflow:auto;background:var(--bg-0);padding:8px;border-radius:6px;margin:0">${hx((lines || []).join('\n') || '(journal vide)')}</pre>`;
}

async function ctrlDeclare() {
    const c = window._wsCtrl || {};
    const d = await apiJson('GET', 'projects/' + wsProjectId + '/controller');
    const cand = (d.candidates || [])[0] || {};
    const meta = await modelLoadMeta();
    const cur = c.manages || meta.needs_order.filter(k => ['hosting', 'domain', 'email', 'backup', 'monitoring'].includes(k));
    document.getElementById('ctrl-name').value = c.name || cand.name || '';
    document.getElementById('ctrl-dir').value = c.dir || cand.dir || '.';
    document.getElementById('ctrl-cmd').value = c.command || cand.command || './run.sh';
    document.getElementById('ctrl-url').value = c.url || cand.url || 'http://127.0.0.1:8800';
    document.getElementById('ctrl-manages').innerHTML = meta.needs_order.filter(k => k !== 'controller' && k !== 'github').map(k => `
        <label style="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer"><input type="checkbox" class="ctrl-manage" data-k="${k}" ${cur.includes(k) ? 'checked' : ''} style="accent-color:var(--sky)"> ${hx(meta.needs[k].label)}</label>`).join('');
    showErr('ctrl-error', '');
    showModal('ctrl-modal');
}

async function ctrlSave() {
    const body = { name: document.getElementById('ctrl-name').value.trim(), dir: document.getElementById('ctrl-dir').value.trim() || '.',
                   command: document.getElementById('ctrl-cmd').value.trim(), url: document.getElementById('ctrl-url').value.trim(),
                   manages: [...document.querySelectorAll('.ctrl-manage:checked')].map(x => x.dataset.k) };
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/controller', body);
    if (!r.success) return showErr('ctrl-error', r.message);
    closeModals(); toast('Console enregistree');
    openWorkspace(wsProjectId).then(() => wsTab('connections'));
}

async function ctrlClear() {
    if (!confirm('Oublier cette console ? (rien n\'est supprime sur le disque)')) return;
    const r = await apiJson('DELETE', 'projects/' + wsProjectId + '/controller');
    if (!r.success) return toast(r.message, 'error');
    closeModals(); toast('Console oubliee');
    openWorkspace(wsProjectId).then(() => wsTab('connections'));
}

