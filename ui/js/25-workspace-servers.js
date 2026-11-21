/* ═══ Server access with its password (backend: sshaccess.py) ═══ */
let accServer = null;

function openAccessModal(id, firstTime) {
    const s = (window._wsServers || []).find(x => x.id === id);
    if (!s) return;
    accServer = s;
    document.getElementById('acc-title').textContent = (firstTime ? 'Premiere connexion a ' : 'Acces par mot de passe — ') + s.name;
    document.getElementById('acc-cur-label').textContent = firstTime ? 'Mot de passe recu de ' + ((srvMeta && srvMeta.providers[s.provider] || {}).label || 'l\'hebergeur') + ' (email)'
                                                                     : 'Mot de passe actuel du serveur (le tien, ou celui de l\'hebergeur)';
    ['acc-cur', 'acc-new', 'acc-new2'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('acc-change').checked = !!firstTime;
    document.getElementById('acc-root').checked = false;
    document.getElementById('acc-allow').checked = true;
    document.getElementById('acc-log').style.display = 'none';
    document.getElementById('acc-go').disabled = false;
    document.getElementById('acc-go').textContent = 'Connecter';
    showErr('acc-error', '');
    accToggle(); accStrength();
    showModal('acc-modal');
    setTimeout(() => document.getElementById('acc-cur').focus(), 50);
}

function accToggle() {
    document.getElementById('acc-new-box').style.display = document.getElementById('acc-change').checked ? '' : 'none';
}

function accStrength() {
    const a = document.getElementById('acc-new').value, b = document.getElementById('acc-new2').value, el = document.getElementById('acc-strength');
    if (!a) { el.textContent = ''; return; }
    const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(a)).length;
    const ok = a.length >= 12 && new Set(a).size >= 6;
    el.style.color = !ok ? 'var(--rose)' : kinds >= 3 ? 'var(--emerald)' : 'var(--amber)';
    el.textContent = !ok ? 'Trop court ou trop simple (12 caracteres minimum)' : (kinds >= 3 ? 'Solide' : 'Correct — ajoute chiffres / majuscules / symboles')
        + (b && a !== b ? ' · les deux ne correspondent pas' : '');
}

async function accRun() {
    const cur = document.getElementById('acc-cur').value;
    const change = document.getElementById('acc-change').checked;
    const nw = document.getElementById('acc-new').value, nw2 = document.getElementById('acc-new2').value;
    showErr('acc-error', '');
    if (!cur) return showErr('acc-error', 'Tape le mot de passe actuel du serveur');
    if (change && nw !== nw2) return showErr('acc-error', 'Les deux nouveaux mots de passe ne correspondent pas');
    const btn = document.getElementById('acc-go');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:12px;height:12px"></span> Connexion...';
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/servers/' + accServer.id + '/access', {
        current: cur, new: change ? nw : '', also_root: document.getElementById('acc-root').checked,
        allow_password_login: document.getElementById('acc-allow').checked });
    btn.disabled = false; btn.textContent = 'Connecter';
    if (!r.success) return showErr('acc-error', r.message);
    if (r.needs_new) {
        document.getElementById('acc-change').checked = true; accToggle();
        showErr('acc-error', 'Ce mot de passe a expire : le serveur exige d\'en choisir un nouveau. Remplis « Nouveau mot de passe » puis « Connecter ».');
        document.getElementById('acc-new').focus();
        return;
    }
    ['acc-cur', 'acc-new', 'acc-new2'].forEach(i => document.getElementById(i).value = '');   // never kept in the page
    const box = document.getElementById('acc-log');
    box.style.display = '';
    box.innerHTML = '<div class="alert alert-info"><div><b style="color:var(--emerald)">Acces pret</b><br>' + r.log.map(l => '✓ ' + hx(l)).join('<br>') + '</div></div>';
    btn.textContent = 'Termine'; btn.onclick = () => { closeModals(); btn.onclick = accRun; };
    loadWsServers();
}

/* ═══ Servers of a project (backend: servers.py) ═══ */
let srvMeta = null;       // providers + roles
let srvEditing = null;    // server being changed (null = new)

async function srvLoadMeta() {
    if (!srvMeta) srvMeta = await api('servers/providers');
    return srvMeta;
}

function renderWsGithubConn() {
    const box = document.getElementById('ws-github-conn');
    if (!box || !wsProjectData) return;
    const p = wsProjectData.project, org = wsProjectData.github_org;
    const linked = org || p.git_remote;
    box.innerHTML = `<div class="card mb-8" style="padding:14px"><div class="flex-between">
        <div><div style="font-size:13px;font-weight:700;color:var(--text-0)">GitHub</div>
        <div style="font-size:11px;color:${linked ? 'var(--text-2)' : 'var(--amber)'};margin-top:3px" class="${linked ? 'mono' : ''}">${linked ? hx(org ? 'github.com/' + org + ' (organisation)' : p.git_remote) : 'Pas encore lie : le code source n\'est pas sauvegarde sur GitHub'}</div></div>
        ${linked ? `<button class="btn btn-xs" onclick="wsTab('git')">Onglet Git</button>` : `<button class="btn btn-xs btn-primary" onclick="openLinkTerminal(wsProjectId)">Lier a GitHub</button>`}
    </div></div>`;
}

async function loadWsServers() {
    const box = document.getElementById('ws-servers');
    if (!box || !wsProjectId) return;
    const pid = wsProjectId;
    const list = await apiJson('GET', 'projects/' + pid + '/servers');
    if (pid !== wsProjectId) return;
    if (list.success === false) { box.innerHTML = `<div class="alert alert-warning">${hx(list.message)}</div>`; return; }
    window._wsServers = list;
    const meta = await srvLoadMeta();
    const ctrl = (window._wsNeeds || {}).controller || wsProjectData?.controller;
    const delegated = ctrl && (ctrl.manages || []).includes('hosting');
    if (delegated && !list.length) {
        box.innerHTML = `<div class="card mb-8" style="padding:14px"><div class="flex-between"><div>
            <div style="font-size:13px;font-weight:700;color:var(--text-0)">Serveurs</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:3px">Geres par la console <b>${hx(ctrl.name || '')}</b> (hebergement, deploiements) — rien a saisir ici.</div></div>
            <div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="launchProjectConsole(wsProjectId)">Ouvrir la console</button>
            <button class="btn btn-xs" onclick="srvOpen()" title="Ajouter quand meme un serveur dans DevAgent">+ Serveur</button></div></div></div>`;
        return;
    }
    const rows = list.map(s => {
        const t = s.test || {};
        const state = t.ok ? `<span class="badge badge-emerald" title="Teste le ${hx((t.at || '').replace('T', ' '))}">Connecte</span>`
            : t.error ? `<span class="badge" style="background:var(--rose-dim);color:var(--rose)" title="${hx(t.error)}">Injoignable</span>`
            : '<span class="badge badge-amber">Non teste</span>';
        const info = t.ok ? [t.hostname, t.os, t.disk, t.docker ? 'Docker' : 'pas de Docker',
                             s.remote_path ? (t.path_exists ? 'dossier present' : 'dossier absent') : ''].filter(Boolean).map(hx).join(' · ') : hx(t.error || '');
        return `<div style="padding:10px 0;border-bottom:1px solid var(--border-0)">
            <div class="flex-between" style="gap:6px;flex-wrap:wrap">
                <span><b>${hx(s.name)}</b> <span class="badge badge-violet">${hx(s.role)}</span> <span style="font-size:11px;color:var(--text-3)">${hx((meta.providers[s.provider] || {}).label || s.provider)}</span></span>
                ${state}</div>
            <div class="mono" style="font-size:11px;color:var(--text-2);margin-top:3px">${hx(s.user)}@${hx(s.host)}${s.port != 22 ? ':' + s.port : ''}${s.remote_path ? '  ' + hx(s.remote_path) : ''}</div>
            <div style="font-size:10px;color:var(--text-4);margin-top:2px">${info}</div>
            <div class="flex gap-6 mt-8" style="flex-wrap:wrap">
                <button class="btn btn-xs btn-primary" data-id="${s.id}" onclick="srvTerminal(this.dataset.id)">Terminal serveur</button>
                <button class="btn btn-xs" data-id="${s.id}" onclick="srvRetest(this.dataset.id)">Tester</button>
                <button class="btn btn-xs ${t.ok ? '' : 'btn-primary'}" data-id="${s.id}" onclick="openAccessModal(this.dataset.id, ${t.ok ? 'false' : 'true'})" title="Avec le mot de passe : installer la cle de ce PC, changer le mot de passe">${t.ok ? 'Mot de passe / cle de ce PC' : 'Se connecter avec le mot de passe'}</button>
                <button class="btn btn-xs" data-id="${s.id}" onclick="srvOpen(this.dataset.id)">Modifier</button>
                ${(s.history || []).length ? `<button class="btn btn-xs" data-id="${s.id}" onclick="srvHistory(this.dataset.id)">Historique (${s.history.length})</button>` : ''}
                ${s.dashboard_url ? `<a class="btn btn-xs" href="${hx(s.dashboard_url)}" target="_blank" style="text-decoration:none">Console ${hx((meta.providers[s.provider] || {}).label || '')}</a>` : ''}
                ${(s.urls || []).map(u => `<a class="btn btn-xs" href="${hx(u)}" target="_blank" style="text-decoration:none">${hx(u.replace(/^https?:\/\//, ''))}</a>`).join('')}
                <button class="btn btn-xs btn-danger" data-id="${s.id}" onclick="srvRemove(this.dataset.id)">Retirer</button>
            </div></div>`;
    }).join('');
    box.innerHTML = `<div class="card mb-8" style="padding:14px">
        <div class="flex-between mb-8" style="gap:6px;flex-wrap:wrap"><div style="font-size:13px;font-weight:700;color:var(--text-0)">Serveurs</div>
            <div class="flex gap-6" style="flex-wrap:wrap">
            <button class="btn btn-xs btn-primary" onclick="srvOpen()">+ Ajouter un serveur</button>
            <button class="btn btn-xs" onclick="wsSetupDeploy()" title="Vercel, Netlify, Railway, Render, Cloudflare Pages — pas de SSH">+ Plateforme (Vercel...)</button></div></div>
        ${rows || '<div style="font-size:12px;color:var(--text-4)">Aucun serveur lie a ce projet. Un site peut aussi vivre sur une plateforme (Vercel, Netlify...) : bouton ci-dessus.</div>'}</div>`;
}

async function srvOpen(id) {
    const meta = await srvLoadMeta();
    srvEditing = id ? (window._wsServers || []).find(s => s.id === id) : null;
    document.getElementById('srv-title').textContent = srvEditing ? 'Modifier « ' + srvEditing.name + ' »' : 'Ajouter un serveur';
    showErr('srv-error', '');
    document.getElementById('srv-test').innerHTML = '';
    document.getElementById('srv-pub').style.display = 'none';
    document.getElementById('srv-role').innerHTML = meta.roles.map(r => `<option value="${r}">${r}</option>`).join('');
    document.getElementById('srv-provider').innerHTML = Object.entries(meta.providers).map(([k, v]) => `<option value="${k}">${hx(v.label)}</option>`).join('');
    await srvLoadKeys();
    if (srvEditing) { srvFill(srvEditing); srvStep('form'); }
    else {
        document.getElementById('srv-providers').innerHTML = Object.entries(meta.providers).map(([k, v]) =>
            `<button class="btn" data-p="${k}" onclick="srvPickProvider(this.dataset.p)" style="justify-content:center">${hx(v.label)}</button>`).join('');
        const hosts = await api('servers/ssh-hosts').catch(() => []);
        window._sshHosts = hosts;
        document.getElementById('srv-sshhosts').innerHTML = hosts.length ? `<div style="font-size:12px;color:var(--text-3);margin-bottom:6px">Ou un serveur deja dans ton ~/.ssh/config :</div>
            <div class="flex gap-6" style="flex-wrap:wrap">${hosts.map((h, i) => `<button class="btn btn-xs mono" data-i="${i}" onclick="srvPickSshHost(+this.dataset.i)">${hx(h.alias)} <span style="color:var(--text-4)">${hx(h.user ? h.user + '@' : '')}${hx(h.host)}</span></button>`).join('')}</div>` : '';
        srvStep('provider');
    }
    showModal('srv-modal');
}

function srvStep(step) {
    document.getElementById('srv-step-provider').style.display = step === 'provider' ? '' : 'none';
    document.getElementById('srv-step-form').style.display = step === 'form' ? '' : 'none';
    document.getElementById('srv-test-btn').style.display = step === 'form' ? '' : 'none';
    document.getElementById('srv-save').style.display = step === 'form' ? '' : 'none';
}

function srvFill(s) {
    const set = (id, v) => document.getElementById(id).value = v ?? '';
    set('srv-name', s.name); set('srv-role', s.role || 'prod'); set('srv-provider', s.provider || 'other');
    set('srv-host', s.host); set('srv-user', s.user); set('srv-port', s.port || 22);
    set('srv-path', s.remote_path); set('srv-urls', (s.urls || []).join(' '));
    const sel = document.getElementById('srv-key');
    if (s.key_path && ![...sel.options].some(o => o.value === s.key_path)) sel.add(new Option(s.key_path, s.key_path));
    sel.value = s.key_path || '';
}

function srvPickProvider(p) {
    const prov = srvMeta.providers[p];
    srvFill({ name: '', role: 'prod', provider: p, user: prov.user, port: 22 });
    srvStep('form');
    document.getElementById('srv-name').value = prov.label !== 'Autre' ? 'Serveur ' + prov.label : '';
    document.getElementById('srv-host').focus();
}

function srvPickSshHost(i) {
    const h = window._sshHosts[i];
    srvFill({ name: h.alias, role: 'prod', provider: 'other', host: h.host, user: h.user, port: h.port, key_path: h.key_path });
    srvStep('form');
}

async function srvLoadKeys() {
    const keys = await api('servers/ssh-keys').catch(() => []);
    document.getElementById('srv-key').innerHTML = '<option value="">Automatique (agent SSH / cle par defaut)</option>'
        + keys.map(k => `<option value="${hx(k.path)}">~/.ssh/${hx(k.name)} ${k.type ? '(' + hx(k.type) + ')' : ''}</option>`).join('');
}

async function srvKeyChanged() {
    const path = document.getElementById('srv-key').value;
    const box = document.getElementById('srv-pub');
    if (!path) { box.style.display = 'none'; return; }
    const r = await apiJson('GET', 'servers/public-key?path=' + encodeURIComponent(path));
    srvShowPub(r.success ? r.public : null);
}

function srvShowPub(pub) {
    const box = document.getElementById('srv-pub');
    if (!pub) { box.style.display = 'none'; return; }
    box.style.display = '';
    box.innerHTML = `<div style="font-size:11px;color:var(--text-3);margin-bottom:4px">Cle publique a autoriser sur le serveur (panneau du fournisseur, ou ~/.ssh/authorized_keys) :</div>
        <div class="flex gap-6"><input class="form-input mono" readonly value="${hx(pub)}" style="flex:1;font-size:10px" onclick="this.select()">
        <button class="btn btn-xs" onclick="navigator.clipboard.writeText(this.previousElementSibling.value);toast('Cle publique copiee')">Copier</button></div>`;
}

async function srvGenerateKey() {
    const label = document.getElementById('srv-name').value.trim() || document.getElementById('srv-role').value;
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/servers/generate-key', { label: label });
    if (!r.success) return showErr('srv-error', r.message);
    await srvLoadKeys();
    document.getElementById('srv-key').value = r.path;
    srvShowPub(r.public);
    toast('Cle creee : ' + r.path.replace(/^.*\.ssh\//, '~/.ssh/'));
}

function srvForm() {
    const v = id => document.getElementById(id).value.trim();
    return { name: v('srv-name'), role: v('srv-role'), provider: v('srv-provider'), host: v('srv-host'), user: v('srv-user'),
             port: v('srv-port'), key_path: v('srv-key'), remote_path: v('srv-path'), urls: v('srv-urls') };
}

function srvShowTest(t) {
    document.getElementById('srv-test').innerHTML = t.ok
        ? `<div class="alert alert-info"><div><b style="color:var(--emerald)">Connexion reussie</b> — ${[t.hostname, t.os, t.disk, t.docker || 'pas de Docker'].filter(Boolean).map(hx).join(' · ')}
           ${srvForm().remote_path ? '<br>Dossier du projet sur le serveur : ' + (t.path_exists ? 'present' : '<b>absent</b> (il faudra le creer, ou corrige le chemin)') : ''}</div></div>`
        : `<div class="alert alert-warning"><div><b>Connexion impossible</b><br>${hx(t.error || '')}${/pas autorisee/i.test(t.error || '') ? '<br><span style="color:var(--text-2)">Normal pour un serveur neuf : enregistre-le, DevAgent te proposera de te connecter avec le mot de passe recu.</span>' : ''}</div></div>`;
}

async function srvTest() {
    showErr('srv-error', '');
    document.getElementById('srv-test').innerHTML = '<span class="spinner" style="width:10px;height:10px"></span> Connexion...';
    const r = await apiJson('POST', 'servers/test', srvForm());
    if (r.success === false && r.message) { document.getElementById('srv-test').innerHTML = ''; return showErr('srv-error', r.message); }
    srvShowTest(r);
    return r;
}

async function srvSave() {
    showErr('srv-error', '');
    const btn = document.getElementById('srv-save');
    btn.disabled = true;
    document.getElementById('srv-test').innerHTML = '<span class="spinner" style="width:10px;height:10px"></span> Connexion et enregistrement...';
    const r = srvEditing ? await apiJson('PUT', 'projects/' + wsProjectId + '/servers/' + srvEditing.id, srvForm())
                         : await apiJson('POST', 'projects/' + wsProjectId + '/servers', srvForm());
    btn.disabled = false;
    if (!r.success) { document.getElementById('srv-test').innerHTML = ''; return showErr('srv-error', r.message); }
    closeModals();
    toast(r.server.test && r.server.test.ok ? 'Serveur lie au projet (connexion OK)' : 'Serveur enregistre — connexion impossible pour l\'instant');
    await loadWsServers();
    const err = (r.server.test && r.server.test.error) || '';
    if (!(r.server.test && r.server.test.ok) && /pas autorisee|Permission/i.test(err)) openAccessModal(r.server.id, true);
}

async function srvRetest(id) {
    toast('Test de la connexion...', 'info');
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/servers/' + id + '/test');
    if (!r.success) return toast(r.message, 'error');
    toast(r.server.test.ok ? 'Connexion OK' : r.server.test.error, r.server.test.ok ? undefined : 'error');
    loadWsServers();
}

async function srvRemove(id) {
    const s = (window._wsServers || []).find(x => x.id === id);
    if (!confirm('Retirer « ' + s.name + ' » de ce projet ?\n\nRien n\'est touche sur le serveur.')) return;
    const r = await apiJson('DELETE', 'projects/' + wsProjectId + '/servers/' + id);
    if (!r.success) return toast(r.message, 'error');
    toast('Serveur retire du projet');
    loadWsServers();
}

async function srvHistory(id) {
    const s = (window._wsServers || []).find(x => x.id === id);
    const lines = s.history.map((h, i) => `${i}: ${h.at.replace('T', ' ')} — ${h.config.user}@${h.config.host} (${h.config.provider})`).join('\n');
    const pick = prompt('Revenir a une ancienne config de « ' + s.name + ' » ? Tape son numero :\n\n' + lines);
    if (pick === null || pick.trim() === '') return;
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/servers/' + id + '/restore', { index: +pick });
    if (!r.success) return toast(r.message, 'error');
    toast('Config restauree' + (r.server.test.ok ? ' (connexion OK)' : ''));
    loadWsServers();
}

// Terminal on the server: same modal as the project terminals, the session runs ssh
function srvTerminal(id) {
    const s = (window._wsServers || []).find(x => x.id === id);
    closeModals();
    showModal('import-modal');
    document.getElementById('imp-title').textContent = 'Terminal « ' + s.name + ' » — ' + s.user + '@' + s.host;
    document.getElementById('imp-hints').innerHTML = '';
    document.getElementById('imp-detect').textContent = s.remote_path ? 'Dossier : ' + s.remote_path : '';
    document.getElementById('imp-paste').style.display = 'none';
    document.getElementById('imp-finish').style.display = 'none';
    document.getElementById('imp-result').style.display = 'none';
    impDispose();
    const container = document.getElementById('imp-xterm');
    container.innerHTML = '';
    const term = new Terminal(xtermOptions());
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(container);
    const ws = new WebSocket(terminalWsUrl({ mode: 'ssh', project: wsProjectId, server: id }));
    window._imp = { name: s.name, path: '', sid: 'srv-' + wsProjectId + '-' + id, term: term, ws: ws, fit: fit, server: id };
    document.getElementById('imp-path-label').textContent = s.user + '@' + s.host;
    ws.onopen = () => { impFit(); term.focus(); };
    ws.onmessage = e => term.write(e.data);
    ws.onclose = () => term.write('\r\n\x1b[31m[Deconnecte du serveur]\x1b[0m\r\n');
    term.onData(d => { if (ws.readyState === WebSocket.OPEN) ws.send(d); });
    term.onResize(({ rows, cols }) => { if (ws.readyState === WebSocket.OPEN) ws.send(`\x1b[RESIZE:${rows},${cols}]`); });
    setTimeout(impFit, 100);
}

