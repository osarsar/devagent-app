/* ═══ Le poste de travail d'un projet ═══
   A gauche tu parles a l'agent ; a droite tu regardes le projet : son etat, le site en local,
   le site en ligne, le terminal. Quatre vues du meme panneau (wsView). */
let wsViewCur = 'term', wsStation = null, wsOnline = null, wsStationTimer = null, wsLiveUrl = null;

const _wsShowTermBase = wsShowTerm, _wsToggleViewBase = wsToggleView;
function _wsViewMark(v) {
    wsViewCur = v;
    document.querySelectorAll('.ws-view-btn').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    document.getElementById('ws-etat').style.display = v === 'etat' ? 'block' : 'none';
    document.getElementById('ws-ligne').style.display = v === 'ligne' ? 'flex' : 'none';
    document.querySelectorAll('.ws-term-only').forEach(e => { e.style.display = v === 'term' ? '' : 'none'; });
}
wsShowTerm = function () { _wsShowTermBase(); _wsViewMark('term'); };
wsToggleView = function (on) {                       // kept for the code that opens the local preview itself
    _wsToggleViewBase(on);
    _wsViewMark(wsPrevOn ? 'local' : 'term');
};

function wsView(v) {
    if (v === 'term') return wsShowTerm();
    if (v === 'local') { if (!wsPrevOn) wsToggleView(true); else _wsViewMark('local'); return; }
    if (wsPrevOn) _wsToggleViewBase(false);          // leaves the local preview
    document.getElementById('ws-xterm').style.display = 'none';
    _wsViewMark(v);
    if (v === 'etat') loadWsStation();
    if (v === 'ligne') renderWsLive();
}

async function loadWsStation(online) {
    const pid = wsProjectId;
    clearTimeout(wsStationTimer);
    const s = await fetch('/api/agent/station/' + pid).then(r => r.ok ? r.json() : null).catch(() => null);
    if (pid !== wsProjectId) return;
    if (s) wsStation = s;
    renderWsStation();
    if (online || !wsOnline || wsOnline.pid !== pid) {                 // the hosting platform: asked apart (network)
        fetch(`/api/agent/station/${pid}/en-ligne`).then(r => r.json()).then(o => {
            if (pid !== wsProjectId) return;
            wsOnline = Object.assign(o, { pid });
            renderWsStation();
        }).catch(() => {});
    }
    if (currentPage === 'workspace' && wsViewCur === 'etat') wsStationTimer = setTimeout(loadWsStation, 12000);
}

/* a ready-made request, put in the chat for the user to read and send */
function wsAsk(text) {
    DA.state.draft = text;
    wsTab('agent');
}

function wsStationLocal(dir, url) {
    devChoose(dir);
    wsPrevUrl = url || null;
    wsView('local');
}
async function wsStationStart(dir, btn) {
    devChoose(dir);
    wsView('term');                                  // you see it start…
    await devStart(dir, btn);
    wsView('local');                                 // …then the site
    loadWsStation();
}

function renderWsStation() {
    const el = document.getElementById('ws-etat'), s = wsStation;
    if (!el || !s || s.id !== wsProjectId) return;
    const o = wsOnline && wsOnline.pid === s.id ? wsOnline : null;
    const dot = k => `<span class="st-dot ${k}"></span>`;
    const when = t => t ? hx(String(t).replace('T', ' ').slice(0, 16)) : '';
    const q = t => hx(JSON.stringify(t));

    const local = s.depots.map(d => {
        const pages = d.local.filter(x => x.page), up = d.local.length > 0;
        return `<div class="st-line">${dot(up ? 'ok' : 'off')}
            <div class="st-main"><b>${hx(d.nom)}</b>
              <div class="st-sub">${up ? d.local.map(x => 'localhost:' + x.port).join(', ') : (d.lancement ? 'pas lance · <code>' + hx(d.lancement) + '</code>' : 'rien a lancer')}</div></div>
            ${pages.length ? `<button class="btn btn-xs btn-primary" onclick="wsStationLocal(${q(d.dir)}, ${q(pages[0].url)})">Voir</button>`
              : (!up && d.lancement ? `<button class="btn btn-xs btn-primary" onclick="wsStationStart(${q(d.dir)}, this)">▶ Lancer</button>` : '')}
        </div>`;
    }).join('') || '<div class="st-sub">Aucun depot dans ce projet.</div>';

    const code = s.depots.map(d => {
        const dirty = d.modifies || d.non_envoyes, onMain = /^(main|master)$/.test(d.branche);
        const what = [d.modifies ? `${d.modifies} fichier(s) modifie(s)` : '', d.non_envoyes ? `${d.non_envoyes} commit(s) pas envoye(s)` : ''].filter(Boolean).join(' · ');
        return `<div class="st-line">${dot(d.erreur ? 'bad' : dirty ? 'warn' : 'ok')}
            <div class="st-main"><b>${hx(d.nom)}</b> <span class="st-branch${onMain ? '' : ' work'}">${hx(d.branche || '?')}</span>
              <div class="st-sub">${d.erreur ? hx(d.erreur) : (what || 'tout est enregistre et envoye')}</div></div>
            ${dirty ? `<button class="btn btn-xs" onclick="wsAsk(${q(`Enregistre mon travail du depot ${d.dir} et envoie-le sur GitHub.`)})">Envoyer</button>` : ''}
        </div>`;
    }).join('');

    let live = '';
    if (s.domaine) {
        live += `<div class="st-line">${dot(s.site === 'ok' ? 'ok' : s.site === 'en_panne' ? 'bad' : 'off')}
            <div class="st-main"><b>${hx(s.domaine)}</b><div class="st-sub">${s.site === 'ok' ? 'le site repond' : s.site === 'en_panne' ? 'ne repondait plus a la derniere verification' : 'pas encore verifie'}</div></div>
            <button class="btn btn-xs btn-primary" onclick="wsView('ligne')">Voir</button>
            <button class="btn btn-xs" onclick="wsAsk(${q(`Verifie que le site ${s.domaine} repond bien, et dis-moi ce qui ne va pas.`)})">Verifier</button></div>`;
    }
    if (!o) live += `<div class="st-sub" style="padding:8px 0"><span class="dev-spin"></span> lecture de l'hebergement…</div>`;
    else if (o.vercel) {
        const d = (o.deploiements || [])[0];
        const st = d ? { READY: ['ok', 'en ligne'], ERROR: ['bad', 'en echec'], BUILDING: ['warn', 'en construction'], QUEUED: ['warn', 'en attente'], CANCELED: ['off', 'annule'] }[d.etat] || ['off', d.etat] : null;
        if (d) live += `<div class="st-line">${dot(st[0])}
            <div class="st-main"><b>Dernier deploiement</b> · ${hx(st[1])}
              <div class="st-sub">${when(d.quand)}${d.commit ? ' · ' + hx(d.commit) : ''}${d.erreur ? ' · ' + hx(d.erreur) : ''}</div></div>
            <a class="btn btn-xs" href="${hx(d.inspecter || d.url)}" target="_blank" rel="noopener" style="text-decoration:none">Vercel ↗</a>
            <button class="btn btn-xs" onclick="wsAsk('Mets en ligne la derniere version du site.')">Deployer</button></div>`;
        live += `<div class="st-line">${dot(o.git_relie ? 'ok' : 'warn')}
            <div class="st-main">${o.git_relie ? 'Vercel est relie a GitHub : chaque envoi met le site en ligne.' : 'Vercel n\'est pas relie a GitHub : la mise en ligne se fait a la main.'}</div></div>`;
    } else if (!s.domaine) live += `<div class="st-sub" style="padding:8px 0">Ce projet n'a pas encore de site en ligne.
        <a href="#" onclick="wsTab('connections');return false">Connexions</a></div>`;

    const agent = (s.confirmations.length ? `<div class="st-line">${dot('bad')}<div class="st-main"><b>${s.confirmations.length} action(s) attendent ta confirmation</b>
            <div class="st-sub">${s.confirmations.map(a => hx(a.tool)).join(', ')}</div></div>
            <button class="btn btn-xs btn-primary" onclick="go('agent:confirmations')">Decider</button></div>` : '')
        + (s.activite.map(a => `<div class="st-line small">${dot(a.status === 'ok' ? 'ok' : a.status === 'erreur' || a.status === 'echec' ? 'bad' : 'warn')}
            <div class="st-main"><span class="mono">${hx(a.tool)}</span> <span class="st-sub" style="display:inline">· ${hx(a.actor)}</span></div>
            <span class="st-sub">${when(a.at)}</span></div>`).join('') || '<div class="st-sub">Aucune action sur ce projet pour l\'instant.</div>');

    el.innerHTML = `
        <div class="st-card"><div class="st-head"><h4>En local, sur ce PC</h4></div>${local}</div>
        <div class="st-card"><div class="st-head"><h4>En ligne</h4><button class="btn btn-xs btn-ghost" onclick="loadWsStation(true)" title="Relire l'hebergement">⟳</button></div>${live}</div>
        <div class="st-card"><div class="st-head"><h4>Le code</h4></div>${code}</div>
        <div class="st-card"><div class="st-head"><h4>Ce que l'agent a fait</h4><a href="#agent:journal" class="st-sub">journal</a></div>${agent}</div>`;
}

function renderWsLive() {
    const bar = document.getElementById('ws-ligne-bar'), body = document.getElementById('ws-ligne-body'), s = wsStation;
    if (!s || s.id !== wsProjectId) { body.innerHTML = '<div class="ws-prev-msg"><span class="dev-spin"></span> lecture…</div>'; loadWsStation().then(() => { if (wsViewCur === 'ligne' && wsStation) renderWsLive(); }); return; }
    if (!s.domaine) {
        bar.innerHTML = '<span>pas de site en ligne</span>';
        body.innerHTML = `<div class="ws-prev-msg">Ce projet n'a pas de nom de domaine enregistre.<br>
            <button class="btn btn-sm btn-primary" style="margin-top:10px" onclick="wsTab('connections')">Ouvrir Connexions</button></div>`;
        return;
    }
    const url = 'https://' + s.domaine;
    bar.innerHTML = `<b style="color:var(--text-1)">${hx(s.domaine)}</b>
        <button class="btn btn-xs" onclick="wsLiveUrl=null;renderWsLive()" title="Recharger la page">⟳</button>
        <a class="btn btn-xs" href="${hx(url)}" target="_blank" rel="noopener" style="text-decoration:none" title="Ouvrir dans un onglet du navigateur">↗</a>
        <span style="margin-left:auto">le site que voient tes visiteurs · vide ? ouvre-le avec ↗</span>`;
    if (wsLiveUrl !== url) { wsLiveUrl = url; body.innerHTML = `<iframe src="${hx(url)}" title="Site en ligne"></iframe>`; }
}

/* opening a project, or its Agent tab: the work station */
const _wsTabBase = wsTab;
wsTab = function (tab) {
    _wsTabBase(tab);
    document.body.classList.toggle('ws-agent-open', tab === 'agent');
    if (tab === 'agent' && wsViewCur === 'term' && !wsStationSeen) { wsStationSeen = true; wsView('etat'); }
    try { if (fitAddon) fitAddon.fit(); } catch (e) {}
};
let wsStationSeen = false;
const _openWorkspaceBase = openWorkspace;
openWorkspace = async function (pid) {
    if (pid !== wsProjectId) { wsStation = null; wsOnline = null; wsLiveUrl = null; wsStationSeen = false; }
    wsShowTerm();
    const sel = document.getElementById('ws-project-select');
    if (sel && DA.state.projects.length) {
        sel.innerHTML = DA.state.projects.map(p => `<option value="${p.id}">${hx(p.name)}</option>`).join('');
        sel.value = pid;
    }
    await _openWorkspaceBase(pid);                   // loads the repositories (tab Développer)…
    if (wsProjectId === pid) wsTab('agent');         // …then shows the work station: the agent and the state
};
