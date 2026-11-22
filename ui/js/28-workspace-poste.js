/* ═══ Le poste de travail d'un projet ═══
   A gauche l'agent : c'est lui qui travaille (code, git, connexions, etapes). A droite tu regardes
   le projet : son etat, le site en local, le site en ligne. Trois vues du meme panneau (wsView).
   Plus de terminal ni d'onglets : leur code reste (l'apercu local s'en sert) mais rien ne s'affiche. */
let wsViewCur = 'etat', wsStation = null, wsOnline = null, wsStationTimer = null, wsLiveUrl = null;

const _wsShowTermBase = wsShowTerm, _wsToggleViewBase = wsToggleView;
function _wsViewMark(v) {
    wsViewCur = v;
    document.querySelectorAll('.ws-view-btn').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    document.getElementById('ws-etat').style.display = v === 'etat' ? 'block' : 'none';
    document.getElementById('ws-ligne').style.display = v === 'ligne' ? 'flex' : 'none';
}
wsShowTerm = function () { _wsShowTermBase(); document.getElementById('ws-xterm').style.display = 'none'; };
wsToggleView = function (on) {                       // the local preview opens or closes
    _wsToggleViewBase(on);
    if (wsPrevOn) _wsViewMark('local'); else wsView('etat');
};
startXterm = function () {};                         // no terminal in the page any more…
wsAttach = function (sid) { wsTermSid = sid; };       // …a session started for the site keeps running on its own

function wsView(v) {
    if (v === 'local') { if (!wsPrevOn) wsToggleView(true); else _wsViewMark('local'); return; }
    if (wsPrevOn) _wsToggleViewBase(false);          // leaves the local preview
    document.getElementById('ws-xterm').style.display = 'none';
    _wsViewMark(v === 'ligne' ? 'ligne' : 'etat');
    if (v === 'ligne') renderWsLive(); else loadWsStation();
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
    await devStart(dir, btn);                        // runs in the background, ready in a few seconds
    loadWsStation();
    const pv = devPrev(dir);
    if (pv && pv.running.some(x => x.kind === 'page')) wsView('local');
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
              : (!up && d.lancement ? `<button class="btn btn-xs btn-primary" onclick="wsStationStart(${q(d.dir)}, this)">${uiIcon('play', 11)} Lancer</button>` : '')}
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
    }).join('') || '<div class="st-sub">Aucun depot de code dans ce projet.</div>';

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
            <a class="btn btn-xs" href="${hx(d.inspecter || d.url)}" target="_blank" rel="noopener" style="text-decoration:none">Vercel ${uiIcon('external', 11)}</a>
            <button class="btn btn-xs" onclick="wsAsk('Mets en ligne la derniere version du site.')">Deployer</button></div>`;
        live += `<div class="st-line">${dot(o.git_relie ? 'ok' : 'warn')}
            <div class="st-main">${o.git_relie ? 'Vercel est relie a GitHub : chaque envoi met le site en ligne.' : 'Vercel n\'est pas relie a GitHub : la mise en ligne se fait a la main.'}</div></div>`;
    } else if (!s.domaine) live += `<div class="st-sub" style="padding:8px 0">Ce projet n'a pas encore de site en ligne.
        <a href="#" onclick="wsAsk('Aide-moi a mettre ce projet en ligne : hebergement et nom de domaine.');return false">Demander a l'agent</a></div>`;

    const agent = (s.confirmations.length ? `<div class="st-line">${dot('bad')}<div class="st-main"><b>${s.confirmations.length} action(s) attendent ta confirmation</b>
            <div class="st-sub">${s.confirmations.map(a => hx(a.tool)).join(', ')}</div></div>
            <button class="btn btn-xs btn-primary" onclick="go('agent:confirmations')">Decider</button></div>` : '')
        + (s.activite.map(a => `<div class="st-line small">${dot(a.status === 'ok' ? 'ok' : a.status === 'erreur' || a.status === 'echec' ? 'bad' : 'warn')}
            <div class="st-main"><span class="mono">${hx(a.tool)}</span> <span class="st-sub" style="display:inline">· ${hx(a.actor)}</span></div>
            <span class="st-sub">${when(a.at)}</span></div>`).join('') || '<div class="st-sub">Aucune action sur ce projet pour l\'instant.</div>');

    const missing = s.dossier ? '' : `<div class="st-card"><div class="st-line">${dot('bad')}<div class="st-main"><b>Le dossier du projet est introuvable sur ce PC</b>
            <div class="st-sub">Il a ete deplace ou supprime.</div></div>
            <button class="btn btn-xs btn-primary" onclick="go('projects');openMoveModal(${s.id})">Relocaliser</button></div></div>`;
    el.innerHTML = missing + `
        <div class="st-card"><div class="st-head"><h4>En local, sur ce PC</h4></div>${local}</div>
        <div class="st-card"><div class="st-head"><h4>En ligne</h4><button class="icon-btn" onclick="loadWsStation(true)" title="Relire l'hebergement">${uiIcon('reload')}</button></div>${live}</div>
        <div class="st-card"><div class="st-head"><h4>Le code</h4></div>${code}</div>
        <div class="st-card"><div class="st-head"><h4>Ce que l'agent a fait</h4><a href="#agent:journal" class="st-sub">journal</a></div>${agent}</div>`;
}

function renderWsLive() {
    const bar = document.getElementById('ws-ligne-bar'), body = document.getElementById('ws-ligne-body'), s = wsStation;
    if (!s || s.id !== wsProjectId) { body.innerHTML = '<div class="ws-prev-msg"><span class="dev-spin"></span> lecture…</div>'; loadWsStation().then(() => { if (wsViewCur === 'ligne' && wsStation) renderWsLive(); }); return; }
    if (!s.domaine) {
        bar.innerHTML = '<span>pas de site en ligne</span>';
        body.innerHTML = `<div class="ws-prev-msg">Ce projet n'a pas de nom de domaine enregistre.<br>
            <button class="btn btn-sm btn-primary" style="margin-top:10px" onclick="wsAsk('Aide-moi a mettre ce projet en ligne : hebergement et nom de domaine.')">Demander a l'agent</button></div>`;
        return;
    }
    const url = 'https://' + s.domaine;
    bar.innerHTML = `<b style="color:var(--text-1)">${hx(s.domaine)}</b>
        <button class="icon-btn" onclick="wsLiveUrl=null;renderWsLive()" title="Recharger la page">${uiIcon('reload')}</button>
        <a class="icon-btn" href="${hx(url)}" target="_blank" rel="noopener" title="Ouvrir dans un onglet du navigateur">${uiIcon('external')}</a>
        <span style="margin-left:auto">le site que voient tes visiteurs · vide ? ouvre-le dans un onglet</span>`;
    if (wsLiveUrl !== url) { wsLiveUrl = url; body.innerHTML = `<iframe src="${hx(url)}" title="Site en ligne"></iframe>`; }
}

/* a project page is its work station: whatever tab is asked for, the agent is shown */
const _wsTabBase = wsTab;
wsTab = function (tab) {
    if (tab === 'dev') loadWsDev();                  // the repositories: the local preview needs them
    _wsTabBase('agent');
    document.body.classList.add('ws-agent-open');
};
const _openWorkspaceBase = openWorkspace;
openWorkspace = async function (pid) {
    if (pid !== wsProjectId) { wsStation = null; wsOnline = null; wsLiveUrl = null; }
    if (wsPrevOn) _wsToggleViewBase(false);
    const sel = document.getElementById('ws-project-select');
    if (sel && DA.state.projects.length) {
        sel.innerHTML = DA.state.projects.map(p => `<option value="${p.id}">${hx(p.name)}</option>`).join('');
        sel.value = pid;
    }
    await _openWorkspaceBase(pid);                   // its wsTab('dev') loads the repositories and shows the agent
    if (wsProjectId === pid) wsView('etat');
};
