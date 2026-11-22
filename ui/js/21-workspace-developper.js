/* ═══════════════════════ DÉVELOPPER ═══════════════════════
   Choisir OÙ travailler (dépôt, branche), puis ouvrir l'outil LÀ :
   Claude, VS Code, un terminal — dans DevAgent ou dans une fenêtre.
   Plusieurs sessions par projet, en onglets au-dessus du terminal.  */
let devState = null;              // {repos, tools} du projet ouvert
let devPreviews = {};             // dir → {running:[{port,url,via,name}], start:{cmd,cwd,why}}
let wsDevRepo = null;             // dir du dépôt choisi ('.' = racine)
let wsTermSid = null;             // session affichée dans le terminal
const devBranches = {};           // cache des branches par dépôt
const DEV_KIND_ICO = {claude: '✦', terminal: '›_', ssh: '⇄', import: '⇣'};

function devErr(r) { return (r && (r.message || r.error)) || 'erreur'; }
function devRepoKey(pid) { return 'dp-dev-repo-' + pid; }
function devCur() { return devState && (devState.repos.find(r => r.dir === wsDevRepo) || devState.repos[0]); }

async function loadWsDev(fetchGh) {
    const pid = wsProjectId, el = document.getElementById('ws-dev');
    if (!devState) el.innerHTML = '<div class="dev-wait"><span class="dev-spin"></span> Lecture des dépôts…</div>';
    const r = await api(`projects/${pid}/dev/repos${fetchGh ? '?fetch=1' : ''}`).catch(e => ({success: false, message: e.message}));
    if (pid !== wsProjectId) return;
    if (!r.success){ el.innerHTML = `<div class="alert alert-warning">${hx(devErr(r))}</div>`; return; }
    devState = r;
    loadDevPreviews();
    let saved = null; try { saved = localStorage.getItem(devRepoKey(pid)); } catch (e) {}
    if (!r.repos.some(x => x.dir === wsDevRepo)) wsDevRepo = r.repos.some(x => x.dir === saved) ? saved : (r.repos[0] || {}).dir || null;
    renderWsDev();
    loadTermTabs();
}

function devChoose(dir) {
    wsDevRepo = dir;
    try { localStorage.setItem(devRepoKey(wsProjectId), dir); } catch (e) {}
    wsPrevUrl = null;
    renderWsDev(); renderWsPreview();
}

function devRepoRow(r) {
    const chips = [];
    if (r.modified) chips.push(`<span class="dev-chip warn" title="fichiers modifiés non commités">${r.modified} modifié${r.modified > 1 ? 's' : ''}</span>`);
    if (r.untracked) chips.push(`<span class="dev-chip" title="nouveaux fichiers non suivis">${r.untracked} nouveau${r.untracked > 1 ? 'x' : ''}</span>`);
    if (r.for_base) chips.push(`<span class="dev-chip" title="commits de cette branche pas encore dans ${hx(r.base)}">↑${r.for_base} pour ${hx(r.base)}</span>`);
    if (r.ahead) chips.push(`<span class="dev-chip info" title="commits pas encore poussés sur GitHub">${r.ahead} à pousser</span>`);
    if (r.rebasing || r.merging) chips.push(`<span class="dev-chip bad">${r.rebasing ? 'rebase' : 'fusion'} en cours</span>`);
    const pv = devPrev(r.dir);
    if (pv && pv.running.length) {
        const pg_ = pv.running.filter(x => x.kind === 'page'), ap = pv.running.filter(x => x.kind === 'api').length;
        if (pv.running.some(x => x.kind === 'down')) chips.push(`<span class="dev-chip bad" title="le port est ouvert mais rien ne répond">● ne répond pas</span>`);
        else chips.push(`<span class="dev-chip live" title="tourne sur ce PC">● ${pg_.length ? pg_.map(x => ':' + x.port).join(' ') : 'API'}${pg_.length && ap ? ` <span style="opacity:.6">+${ap} API</span>` : ''}</span>`);
    }
    const sel = r.dir === wsDevRepo ? ' on' : '';
    return `<button class="dev-repo${sel}" onclick="devChoose('${hx(r.dir)}')" title="${hx(r.path)}">
        <span class="dev-rn">${hx(r.name)}</span>
        <span class="dev-br ${r.on_base ? 'base' : ''}" title="${r.on_base ? 'tu es sur la branche principale' : 'branche courante'}">${hx(r.branch)}</span>
        <span class="dev-rd">${r.dir === '.' ? '' : hx(r.dir)}</span>
        <span class="dev-rc">${chips.join('')}</span></button>`;
}

function renderWsDev() {
    const el = document.getElementById('ws-dev');
    if (!devState) return;
    const r = devCur(), t = devState.tools;
    if (!devState.repos.length){
        el.innerHTML = `<div class="dev-vide">Aucun dépôt git dans ce projet.<br>
            <button class="btn btn-sm" onclick="wsNewSession('terminal', '.')">Ouvrir un terminal dans le projet</button>
            <button class="btn btn-sm" onclick="wsTab('git')">Lier à GitHub</button></div>`;
        return;
    }
    const outil = (ok, cmd) => ok ? '' : `disabled title="introuvable : ${hx(cmd)} — Paramètres → Outils de développement"`;
    el.innerHTML = `
      <div class="dev-sec"><span>Dépôts <span class="dev-n">${devState.repos.length}</span></span>
        <span style="display:flex;gap:6px"><button class="btn btn-xs" id="dev-maj-btn" onclick="majOpen()" title="Récupérer depuis GitHub en choisissant la branche de chaque dépôt">⇣ Mettre à jour</button>
        <button class="btn btn-xs" id="dev-brm-btn" onclick="brmOpen()" title="Voir chaque dépôt, sa branche de travail et son chemin vers main">⎇ Carte des branches</button>
        <button class="btn btn-xs" onclick="this.disabled=true;this.innerHTML='<span class=dev-spin></span> GitHub…';loadWsDev(true)" title="Relit aussi GitHub (git fetch)">Actualiser</button></span></div>
      <div class="dev-repos">${devState.repos.map(devRepoRow).join('')}</div>
      ${r ? `
      <div class="dev-card">
        <div class="dev-ch"><b>${hx(r.name)}</b> <span class="dev-path mono">${hx(r.path)}</span></div>
        ${r.on_base ? `<div class="dev-warn">Tu es sur <b>${hx(r.base)}</b> : crée une branche avant de modifier (on ne pousse jamais sur ${hx(r.base)}).</div>` : ''}
        ${r.base_behind ? `<div class="dev-info">Ta copie de <b>${hx(r.base)}</b> a ${r.base_behind} commit${r.base_behind > 1 ? 's' : ''} de retard sur GitHub.
            <button class="btn btn-xs" onclick="devUpdateMain(this)">Mettre ${hx(r.base)} à jour</button></div>` : ''}
        <div class="dev-lbl">Branche</div>
        <div class="dev-row">
          <select class="form-input dev-sel" id="dev-branch-sel" onfocus="devLoadBranches()" onchange="devSwitchReady()">
            <option value="">${hx(r.branch)} (actuelle)</option></select>
          <button class="btn btn-sm" id="dev-switch-btn" onclick="devSwitch(this)" disabled>Passer dessus</button>
        </div>
        <div class="dev-row">
          <input class="form-input mono" id="dev-new-name" placeholder="nouvelle branche, ex. fix/message-connexion" onkeydown="if(event.key==='Enter')devNewBranch(document.getElementById('dev-new-btn'))">
          <button class="btn btn-sm btn-primary" id="dev-new-btn" onclick="devNewBranch(this)" title="Créée depuis ${hx(r.base)} à jour (GitHub)">Créer</button>
        </div>
        <label class="dev-stash"><input type="checkbox" id="dev-stash"> mettre de côté mes modifications non commitées (git stash) si besoin</label>
        <div class="dev-lbl">Voir en local (tes modifications en direct)</div>
        ${devPreviewHtml(r)}
        <div class="dev-lbl">Ouvrir ici</div>
        <div class="dev-tools">
          <button class="btn btn-sm dev-claude" onclick="wsNewSession('claude')" ${outil(t.claude.ok, t.claude.cmd)} title="Claude dans ce dépôt, dans DevAgent">✦ Claude</button>
          <button class="btn btn-sm" onclick="wsNewSession('terminal')" title="Un terminal dans ce dépôt, dans DevAgent">›_ Terminal</button>
          <button class="btn btn-sm" onclick="devOpen('editor', this)" ${outil(t.editor.ok, t.editor.cmd)} title="Ouvre ce dépôt dans l'éditeur">VS Code</button>
          <button class="btn btn-sm" onclick="devOpen('external', this)" ${outil(t.external_terminal.ok, 'terminal externe')} title="Fenêtre de terminal séparée, dans ce dépôt">Fenêtre</button>
          <button class="btn btn-sm" onclick="devOpen('external-claude', this)" ${outil(t.claude.ok && t.external_terminal.ok, t.claude.cmd)} title="Claude dans une fenêtre séparée">✦ Claude fenêtre</button>
        </div>
        <div class="dev-last">Dernier commit : <span class="mono">${hx(r.last.sha)}</span> ${hx(r.last.message)}</div>
      </div>` : ''}
      <div class="dev-sec"><span>Sessions de ce projet</span>
        ${t.persistence && t.persistence.ok ? '<span class="dev-chip info" title="elles survivent à un redémarrage de DevAgent (tmux)">persistantes</span>' : ''}</div>
      ${t.persistence && !t.persistence.ok ? `<div class="dev-info">Les sessions s'arrêtent quand DevAgent redémarre. Pour les garder (Claude, un serveur de dev…), installe tmux :
          <code class="mono">sudo apt install -y tmux</code> puis relance DevAgent.</div>` : ''}
      <div id="dev-sessions"><div class="dev-wait"><span class="dev-spin"></span></div></div>`;
    renderDevSessions();
}

async function devLoadBranches(force) {
    const r = devCur(); if (!r) return;
    const sel = document.getElementById('dev-branch-sel');
    if (!force && devBranches[r.path]) return fillBranches(sel, devBranches[r.path]);
    sel.innerHTML = '<option>chargement…</option>';
    const b = await api(`projects/${wsProjectId}/dev/branches?repo=${encodeURIComponent(r.dir)}`);
    if (!b.success){ toast(devErr(b), 'error'); return; }
    devBranches[r.path] = b;
    fillBranches(sel, b);
}
function fillBranches(sel, b) {
    if (!sel) return;
    sel.innerHTML = b.branches.map(x => `<option value="${hx(x.name)}" ${x.current ? 'selected' : ''}>${hx(x.name)}${x.current ? ' (actuelle)' : ''}${!x.local ? ' — sur GitHub' : ''}${x.name === b.base ? ' — principale' : ''}</option>`).join('');
}
function devSwitchReady() {
    const sel = document.getElementById('dev-branch-sel'), r = devCur();
    document.getElementById('dev-switch-btn').disabled = !sel.value || sel.value === r.branch;
}
async function devAction(btn, url, body, ok) {
    const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="dev-spin"></span>';
    const r = await apiJson('POST', url, body);
    btn.disabled = false; btn.innerHTML = old;
    if (!r.success){ toast(devErr(r), 'error'); return null; }
    if (ok) toast(ok(r));
    if (r.note) toast(r.note, 'info');
    const cur = devCur(); if (cur) delete devBranches[cur.path];
    await loadWsDev();
    return r;
}
function devSwitch(btn) {
    const sel = document.getElementById('dev-branch-sel'), r = devCur();
    return devAction(btn, `projects/${wsProjectId}/dev/switch`, {repo: r.dir, branch: sel.value, stash: document.getElementById('dev-stash').checked},
                     x => `${r.name} : sur ${x.branch}`);
}
function devNewBranch(btn) {
    const name = document.getElementById('dev-new-name').value.trim(), r = devCur();
    if (!name){ document.getElementById('dev-new-name').focus(); return; }
    return devAction(btn, `projects/${wsProjectId}/dev/new-branch`, {repo: r.dir, name, stash: document.getElementById('dev-stash').checked},
                     x => `${r.name} : branche ${x.branch} créée depuis ${x.from}`);
}
function devUpdateMain(btn) {
    const r = devCur();
    return devAction(btn, `projects/${wsProjectId}/dev/update-main`, {repo: r.dir}, x => `${r.name} : ${x.message}`);
}
async function devOpen(tool, btn) {
    const r = devCur(); if (!r) return;
    btn.disabled = true;
    const x = await apiJson('POST', `projects/${wsProjectId}/dev/open`, {repo: r.dir, tool});
    btn.disabled = false;
    if (!x.success) toast(devErr(x), 'error');
    else toast(tool === 'editor' ? `${r.name} ouvert dans ${x.with}` : `Fenêtre ouverte dans ${r.name}`);
}


/* ── aperçu local : où voir ce dépôt tourner, en un clic ── */
async function loadDevPreviews() {
    const pid = wsProjectId;
    const x = await api(`projects/${pid}/dev/previews`).catch(() => null);
    if (pid !== wsProjectId || !x || !x.success) return;
    const neuf = x.previews || {};
    if (JSON.stringify(neuf) === JSON.stringify(devPreviews)) return;     // rien de changé : ne pas effacer une saisie
    devPreviews = neuf;
    renderWsDev(); brmRender(); renderWsPreview();
}
function devPrev(dir) { return devPreviews[dir] || null; }
function devPreviewHtml(r) {
    const pv = devPrev(r.dir);
    if (!pv) return '<div class="dev-off"><span class="dev-spin"></span> recherche…</div>';
    if (pv.running.length) {
        const pages = pv.running.filter(x => x.kind === 'page'), apis = pv.running.filter(x => x.kind === 'api'),
              morts = pv.running.filter(x => x.kind === 'down');
        const d = x => (x.via === 'docker' ? 'conteneur ' : 'processus ') + x.name;
        return `<div class="dev-prev">${pages.map(x =>
            `<a class="dev-live" href="${hx(x.url)}" target="_blank" rel="noopener" title="La page à ouvrir — ${hx(d(x))}">localhost:${x.port} <small>ouvrir ↗</small></a>`).join('')}
          ${morts.map(x => `<span class="dev-down" title="Le port est ouvert mais rien ne répond : le service démarre encore, ou il a planté.">localhost:${x.port} <small>ne répond pas</small></span>`).join('')}
          ${apis.map(x => `<a class="dev-api" href="${hx(x.docs || x.url)}" target="_blank" rel="noopener"
              title="API (JSON) utilisée par ${pages.length ? 'la page' : 'les autres services'} — pas une page à ouvrir. ${x.docs ? 'Lien : sa documentation /docs' : ''} — ${hx(d(x))}">API :${x.port}${x.docs ? ' · docs' : ''}</a>`).join('')}</div>
          ${morts.length ? `<div class="dev-off" style="color:var(--rose)">Pour voir pourquoi : <code>${hx(morts[0].logs || './dev.sh logs')}</code>
              <button class="btn btn-xs" onclick="devLogs('${hx(r.dir)}')">Voir les journaux</button></div>` : ''}`;
    }
    if (pv.start) return `<div class="dev-off">Pas lancé sur ce PC.
        <button class="btn btn-xs btn-primary" onclick="devStart('${hx(r.dir)}', this)">▶ Lancer</button>
        <code>${hx(pv.start.cmd)}</code> dans <code>${hx(pv.start.cwd)}</code> <span style="color:var(--text-4)">(${hx(pv.start.why)})</span></div>`;
    return '<div class="dev-off">Rien ne tourne pour ce dépôt, et aucune commande de lancement trouvée (dev.sh, npm run dev).</div>';
}
/* ── Apercu : le site qu'on developpe, a la place du terminal (pas un onglet de plus) ── */
let wsPrevOn = false, wsPrevUrl = null, wsPrevPhone = false;

function wsPrevPages() {
    const repo = devCur(), pv = repo && devPrev(repo.dir);
    return {repo, pv, pages: pv ? pv.running.filter(x => x.kind === 'page') : []};
}

function wsShowTerm() {
    wsPrevOn = false;
    document.body.classList.remove('ws-prev-open');
    document.getElementById('ws-preview').style.display = 'none';
    document.getElementById('ws-xterm').style.display = '';
    document.getElementById('ws-view-btn')?.classList.remove('btn-primary');
    try { if (fitAddon) fitAddon.fit(); } catch (e) {}
}

function wsToggleView(on) {
    if (on === undefined ? wsPrevOn : !on) return wsShowTerm();
    wsPrevOn = true;
    document.body.classList.add('ws-prev-open');
    document.getElementById('ws-xterm').style.display = 'none';
    document.getElementById('ws-preview').style.display = 'flex';
    document.getElementById('ws-view-btn')?.classList.add('btn-primary');
    renderWsPreview();
}

function renderWsPreview() {
    if (!wsPrevOn) return;
    const bar = document.getElementById('ws-prev-bar'), body = document.getElementById('ws-prev-body');
    const {repo, pv, pages} = wsPrevPages();
    const nom = repo ? repo.name : '';
    if (!pages.length) {
        wsPrevUrl = null;
        bar.innerHTML = `<b style="color:var(--text-1)">${hx(nom)}</b><span>rien a afficher pour l'instant</span>`;
        body.className = 'ws-prev-body';
        body.innerHTML = !pv ? '<div class="ws-prev-msg"><span class="dev-spin"></span> recherche…</div>'
            : pv.start ? `<div class="ws-prev-msg">Ce dépôt n'est pas lancé sur ce PC.<br>
                  <button class="btn btn-sm btn-primary" style="margin-top:10px" onclick="wsPrevStart(this)">${uiIcon('play', 12)} Lancer</button>
                  <div style="margin-top:10px;font-size:11px;color:var(--text-4)"><code>${hx(pv.start.cmd)}</code> dans <code>${hx(pv.start.cwd)}</code> (${hx(pv.start.why)})</div></div>`
            : (pv.running.length ? `<div class="ws-prev-msg">Ce dépôt répond sur ${pv.running.map(x => 'localhost:' + x.port).join(', ')},
                  mais aucune page web à afficher (API / service).</div>`
               : `<div class="ws-prev-msg">Rien ne tourne pour ce dépôt, et aucune commande de lancement trouvée (dev.sh, npm run dev).</div>`);
        return;
    }
    if (!pages.some(x => x.url === wsPrevUrl)) wsPrevUrl = pages[0].url;
    const choix = pages.length > 1
        ? `<select class="form-input" style="font-size:11px;padding:3px 6px;width:auto" onchange="wsPrevUrl=this.value;renderWsPreview()">
             ${pages.map(x => `<option value="${hx(x.url)}"${x.url === wsPrevUrl ? ' selected' : ''}>localhost:${x.port}</option>`).join('')}</select>`
        : `<span class="mono" style="color:var(--text-1)">${hx(wsPrevUrl.replace(/^https?:\/\//, ''))}</span>`;
    bar.innerHTML = `<b style="color:var(--text-1)">${hx(nom)}</b> ${choix}
        <button class="icon-btn" onclick="wsPrevReload()" title="Recharger la page">${uiIcon('reload')}</button>
        <button class="icon-btn" onclick="wsPrevPhone=!wsPrevPhone;renderWsPreview()" title="Largeur téléphone / pleine largeur">${uiIcon(wsPrevPhone ? 'desktop' : 'phone')}</button>
        <a class="icon-btn" href="${hx(wsPrevUrl)}" target="_blank" rel="noopener" title="Ouvrir dans un onglet du navigateur">${uiIcon('external')}</a>
        <span style="margin-left:auto">tes modifications, en direct</span>`;
    body.className = 'ws-prev-body' + (wsPrevPhone ? ' phone' : '');
    const f = body.querySelector('iframe');
    if (!f || f.dataset.url !== wsPrevUrl) {
        body.innerHTML = `<iframe data-url="${hx(wsPrevUrl)}" src="${hx(wsPrevUrl)}" title="Apercu local"></iframe>`;
    }
}

function wsPrevReload() {
    const f = document.querySelector('#ws-prev-body iframe');
    if (!f) return;
    const u = f.dataset.url;                     // cross-origin : on ne peut pas reload(), on repose l'adresse
    f.src = 'about:blank';
    setTimeout(() => { f.src = u; }, 50);
}

async function wsPrevStart(btn) {
    const r = devCur(); if (!r) return;
    await devStart(r.dir, btn);                  // le terminal montre le demarrage...
    wsToggleView(true);                          // ...puis on revient voir le site
}

async function devLogs(dir) {
    // the logs of the service that does not answer, in a terminal (the command comes from DevAgent's detection)
    const pid = wsProjectId;
    const x = await apiJson('POST', 'terminal/sessions', {pid, repo: dir, logs: true, rows: xterm && xterm.rows, cols: xterm && xterm.cols});
    if (!x.success){ toast(devErr(x), 'error'); return; }
    closeModals(); await loadTermTabs(); wsAttach(x.sid);
}
async function devStart(dir, btn) {
    const pid = wsProjectId;
    if (btn){ btn.disabled = true; btn.innerHTML = '<span class="dev-spin"></span> lancement…'; }
    closeModals();
    const x = await apiJson('POST', 'terminal/sessions', {pid, repo: dir, start: true, rows: xterm && xterm.rows, cols: xterm && xterm.cols});
    if (!x.success){ toast(devErr(x), 'error'); if (btn){ btn.disabled = false; btn.textContent = '▶ Lancer'; } return; }
    await loadTermTabs(); wsAttach(x.sid);
    toast(`${x.run} lancé — l'adresse apparaît dès que ça répond`, 'info');
    for (let i = 0; i < 45 && pid === wsProjectId; i++) {          // jusqu'à ~90 s (npm install la 1re fois)
        await new Promise(res => setTimeout(res, 2000));
        await loadDevPreviews();
        const pv = devPrev(dir);
        if (pv && pv.running.length){ toast(`Prêt : localhost:${pv.running[0].port} — clique pour ouvrir`); return; }
    }
}

/* ── mettre à jour les dépôts : la branche de chacun, MONTRÉE et CHOISIE ── */
let majPlan = null;
async function majOpen() {
    closeModals();
    document.getElementById('overlay').classList.add('visible');
    document.getElementById('maj-modal').classList.add('visible');
    document.getElementById('maj-title').textContent = 'Mettre à jour les dépôts — ' + ((devState && devState.project) || '');
    const body = document.getElementById('maj-body'), go = document.getElementById('maj-go');
    body.innerHTML = '<div class="brm-wait"><span class="dev-spin"></span> Lecture des dépôts et de GitHub…</div>'; go.disabled = true;
    const pid = wsProjectId;
    const r = await api(`projects/${pid}/dev/maj`).catch(e => ({success: false, message: e.message}));
    if (pid !== wsProjectId) return;
    if (!r.success){ body.innerHTML = `<div class="alert alert-warning">${hx(devErr(r))}</div>`; return; }
    majPlan = r;
    body.innerHTML = `<div class="maj-zone"><table class="maj-tab"><thead><tr><th>Dépôt</th><th>Branche actuelle</th><th>Récupérer</th></tr></thead><tbody>
      ${r.repos.map((x, i) => `<tr>
        <td><b>${hx(x.name)}</b><div class="maj-pq mono">${x.dir === '.' ? 'racine' : hx(x.dir)}</div></td>
        <td><span class="mono">${hx(x.branch)}</span>
          ${x.pourquoi ? `<div class="maj-pq">${hx(x.pourquoi)}</div>` : ''}
          ${x.nouveautes ? `<div class="maj-pq" style="color:var(--blue)">${hx(x.base)} a ${x.nouveautes} nouveauté${x.nouveautes > 1 ? 's' : ''} sur GitHub</div>` : ''}</td>
        <td><select class="form-input" id="maj-sel-${i}">${x.choix.map(c => `<option value="${hx(c.name)}" ${c.name === x.cible ? 'selected' : ''}>${c.name === x.cible ? '★ ' : ''}${hx(c.name)}${c.name === x.branch ? ' (actuelle)' : ''}${!c.local ? ' — sur GitHub' : (!c.github ? ' — sur ce PC seulement' : '')}</option>`).join('')}</select></td>
      </tr>`).join('')}</tbody></table></div><div class="maj-res" id="maj-res"></div>`;
    go.disabled = false;
}
async function majAppliquer() {
    if (!majPlan) return;
    const choix = {};
    majPlan.repos.forEach((x, i) => { choix[x.dir] = document.getElementById('maj-sel-' + i).value; });
    const go = document.getElementById('maj-go'); go.disabled = true; go.innerHTML = '<span class="dev-spin"></span> Mise à jour…';
    const r = await apiJson('POST', `projects/${wsProjectId}/dev/maj`, {choix});
    go.innerHTML = 'Appliquer';
    const res = document.getElementById('maj-res');
    if (!r.success){ res.innerHTML = `<div class="alert alert-warning">${hx(devErr(r))}</div>`; go.disabled = false; return; }
    const nom = d => (majPlan.repos.find(x => x.dir === d) || {}).name || d;
    res.innerHTML = r.resultats.map(x => x.ok
        ? `<div>✓ <b>${hx(nom(x.dir))}</b> : ${x.de !== x.branch ? `${hx(x.de)} → ` : ''}<span class="mono">${hx(x.branch)}</span> ${x.change ? `${hx(x.avant)} → ${hx(x.apres)} <span style="color:var(--text-4)">${hx(x.message)}</span>` : '<span style="color:var(--text-4)">déjà à jour</span>'}</div>`
        : `<div style="color:var(--rose)">✗ <b>${hx(nom(x.dir))}</b> : ${hx(x.message)}</div>`).join('');
    const ko = r.resultats.filter(x => !x.ok).length;
    toast(ko ? `${ko} dépôt(s) non mis à jour — détail dans la fenêtre` : 'Dépôts à jour sur les branches choisies', ko ? 'error' : 'success');
    loadWsDev();
}

/* ── carte des branches : dépôt → branche de travail → main ── */
let brmPrs = {};
const BRM_PR = {OPEN: 'ouverte', MERGED: 'fusionnée', CLOSED: 'fermée'};
function brmOpen() {
    closeModals();
    document.getElementById('overlay').classList.add('visible');
    document.getElementById('brm-modal').classList.add('visible');
    document.getElementById('brm-title').textContent = 'Branches — ' + ((devState && devState.project) || '');
    brmRender();
    brmLoad(false);
}
async function brmLoad(fetchGh) {
    const pid = wsProjectId, btn = document.getElementById('brm-refresh');
    if (fetchGh){ btn.disabled = true; btn.innerHTML = '<span class="dev-spin"></span> GitHub…'; }
    await loadWsDev(fetchGh);
    brmRender();
    const p = await api(`projects/${pid}/dev/prs`).catch(() => null);
    if (pid !== wsProjectId) return;
    if (p && p.success){ brmPrs = p.prs || {}; brmRender(); }
    btn.disabled = false; btn.innerHTML = 'Actualiser depuis GitHub';
}
function brmVisible() { const m = document.getElementById('brm-modal'); return m && m.classList.contains('visible'); }

function brmBranch(r, i) {
    const pr = brmPrs[r.dir];
    const id = 'brm-n-' + i;
    const creer = (label, carry) => `<div class="brm-new"><input class="form-input mono" id="${id}" placeholder="feat/mon-changement"
            onkeydown="if(event.key==='Enter')brmCreate(${i}, this.nextElementSibling)"><button class="btn btn-sm btn-primary" onclick="brmCreate(${i}, this)">${label}</button></div>
        ${carry ? `<label class="brm-carry"><input type="checkbox" id="${id}-carry" checked> emporter mes ${r.modified} modification${r.modified > 1 ? 's' : ''} sur la nouvelle branche</label>` : ''}`;
    if (r.on_base) {
        return `<div class="brm-box brm-br none" data-row="${i}" data-state="none">
            <div class="brm-none-t">Pas de branche de travail</div>
            <div class="brm-state">Ce dépôt est sur <b>${hx(r.base)}</b>. Pour y changer quelque chose, crée d'abord ta branche
              (elle part de ${hx(r.base)} à jour sur GitHub).</div>
            ${r.modified ? `<div class="brm-chips"><span class="dev-chip warn">${r.modified} fichier${r.modified > 1 ? 's' : ''} modifié${r.modified > 1 ? 's' : ''} sur ${hx(r.base)}</span></div>` : ''}
            ${creer('Créer la branche', r.modified > 0)}
            <div style="margin-top:8px">${devPreviewHtml(r)}</div>
            <div class="brm-tomain">${hx(r.base)}</div></div>`;
    }
    const chips = [];
    if (r.modified) chips.push(`<span class="dev-chip warn" title="pas encore commités">✎ ${r.modified} modifié${r.modified > 1 ? 's' : ''}</span>`);
    if (r.untracked) chips.push(`<span class="dev-chip" title="nouveaux fichiers">+${r.untracked} nouveau${r.untracked > 1 ? 'x' : ''}</span>`);
    if (!r.remote_branch) chips.push(`<span class="dev-chip warn" title="seulement sur ce PC">jamais poussée</span>`);
    else if (r.to_push) chips.push(`<span class="dev-chip info" title="commits pas encore sur GitHub">↑ ${r.to_push} à pousser</span>`);
    else chips.push(`<span class="dev-chip brm-ok" title="ta branche est sauvegardée sur GitHub">✓ sur GitHub</span>`);
    if (r.to_pull) chips.push(`<span class="dev-chip warn" title="poussés depuis un autre PC">↓ ${r.to_pull} à récupérer</span>`);
    if (pr) chips.push(`<a class="dev-chip ${pr.state === 'OPEN' ? 'info' : pr.state === 'MERGED' ? 'brm-ok' : ''}" href="${hx(pr.url)}" target="_blank" rel="noopener">PR #${pr.number} ${BRM_PR[pr.state] || hx(pr.state)}</a>`);
    if (r.rebasing || r.merging) chips.push(`<span class="dev-chip bad">${r.rebasing ? 'rebase' : 'fusion'} en cours</span>`);
    const etat = {
        todo: `<b>${r.for_base} commit${r.for_base > 1 ? 's' : ''}</b> à fusionner dans ${hx(r.base)} — `
              + (!r.remote_branch || r.to_push ? 'pousse, puis ouvre la PR.' : pr && pr.state === 'OPEN' ? `la PR #${pr.number} attend ta fusion.` : 'ouvre la PR, puis fusionne.'),
        done: `Tout ce travail est <b>déjà dans ${hx(r.base)}</b>. Pour la suite, crée une nouvelle branche.`
              + (pr && pr.state === 'OPEN' ? ` La PR #${pr.number} encore ouverte peut être fermée.` : ''),
        empty: r.modified || r.untracked ? `Tes changements ne sont <b>pas encore commités</b> : commite, pousse, puis PR vers ${hx(r.base)}.`
                                         : `Rien encore pour ${hx(r.base)} : modifie, commite, pousse.`,
    }[r.merge] || '';
    const autres = r.others.length ? `<div class="brm-state" style="color:var(--text-4)">+ ${r.others.length} autre${r.others.length > 1 ? 's' : ''} branche${r.others.length > 1 ? 's' : ''} sur ce PC (liste « Branche » du dépôt)</div>` : '';
    return `<div class="brm-box brm-br ${r.merge}" data-row="${i}" data-state="${r.merge}">
        <div class="brm-bn">⎇ ${hx(r.branch)}</div>
        <div class="brm-chips">${chips.join('')}</div>
        <div class="brm-state">${etat}${r.to_pull ? ` Ta branche a avancé sur GitHub : <b>git pull</b> dans son terminal.` : ''}</div>
        ${autres}
        <div style="margin-top:8px">${devPreviewHtml(r)}</div>
        <div class="brm-act">
          <button class="btn" onclick="brmGo(${i})" title="Choisir ce dépôt dans l'onglet Développer">Ouvrir</button>
          <button class="btn" onclick="brmSession(${i}, 'terminal')">›_ Terminal</button>
          <button class="btn" onclick="brmSession(${i}, 'claude')" ${devState.tools.claude.ok ? '' : 'disabled'}>✦ Claude</button>
          ${r.merge === 'done' ? `<button class="btn" onclick="this.parentNode.nextElementSibling.hidden=false;this.remove()">+ Nouvelle branche</button>` : ''}
        </div>
        ${r.merge === 'done' ? `<div hidden>${creer('Créer', r.modified > 0)}</div>` : ''}
        <div class="brm-tomain">${r.merge === 'done' ? '✓ ' : '→ '}${hx(r.base)}</div></div>`;
}
function brmRender() {
    if (!brmVisible()) return;
    const body = document.getElementById('brm-body');
    if (!devState){ body.innerHTML = '<div class="brm-wait"><span class="dev-spin"></span> Lecture des dépôts…</div>'; return; }
    const repos = devState.repos;
    if (!repos.length){ body.innerHTML = '<div class="brm-wait">Aucun dépôt git dans ce projet.</div>'; return; }
    // garder ce qui est en cours de saisie
    const saisie = {}; body.querySelectorAll('.brm-new input').forEach(x => { if (x.value) saisie[x.id] = x.value; });
    const n = k => repos.filter(r => k(r)).length;
    const todo = n(r => r.merge === 'todo'), done = n(r => r.merge === 'done'), none = n(r => r.on_base);
    const base = repos.every(r => r.base === repos[0].base) ? repos[0].base : 'main';
    body.innerHTML = `<div class="brm-wrap"><svg class="brm-svg" id="brm-svg"></svg>
      <div class="brm-grid" style="--brm-rows:${repos.length}">
        ${repos.map((r, i) => `
          <div class="brm-box brm-repo" data-row="${i}" style="grid-row:${i + 1}"><b>${hx(r.name)}</b>
            <div class="brm-dir" title="${hx(r.path)}">${r.dir === '.' ? 'racine du projet' : hx(r.dir)}</div>
            <div class="brm-chips">${r.base_behind ? `<button class="dev-chip warn" style="border:0;cursor:pointer" onclick="brmUpdateMain(${i}, this)" title="Mettre ${hx(r.base)} à jour depuis GitHub">${hx(r.base)} : ${r.base_behind} en retard ↻</button>` : ''}</div></div>
          ${brmBranch(r, i).replace('<div class="brm-box brm-br', `<div style="grid-row:${i + 1}" class="brm-box brm-br`)}`).join('')}
        <div class="brm-box brm-main" id="brm-main"><b>${hx(base)}</b><div style="font-size:11px;color:var(--text-3)">GitHub · ce qui part en production</div>
          <div class="brm-sum">${todo ? `<div style="color:var(--blue)">${todo} branche${todo > 1 ? 's' : ''} à fusionner</div>` : ''}
            ${done ? `<div style="color:var(--emerald)">${done} déjà fusionnée${done > 1 ? 's' : ''}</div>` : ''}
            ${none ? `<div>${none} dépôt${none > 1 ? 's' : ''} sans branche</div>` : ''}</div></div>
      </div></div>`;
    Object.entries(saisie).forEach(([k, v]) => { const x = document.getElementById(k); if (x) x.value = v; });
    requestAnimationFrame(brmArrows);
}
function brmArrows() {
    const svg = document.getElementById('brm-svg'), main = document.getElementById('brm-main');
    if (!svg || !main || !main.offsetParent) { if (svg) svg.innerHTML = ''; return; }
    const o = svg.getBoundingClientRect(), m = main.getBoundingClientRect();
    const col = {todo: 'var(--blue)', done: 'var(--emerald)', empty: 'var(--text-3)', none: 'var(--text-4)'};
    const pointes = {...col, violet: 'var(--violet)'};
    let out = '<defs>' + Object.entries(pointes).map(([k, c]) => `<marker id="brm-a-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join('') + '</defs>';
    const rows = document.querySelectorAll('#brm-body .brm-br');
    rows.forEach((br, k) => {
        const i = br.dataset.row, st = br.dataset.state;
        const repo = document.querySelector(`#brm-body .brm-repo[data-row="${i}"]`);
        const a = repo.getBoundingClientRect(), b = br.getBoundingClientRect();
        const y1 = a.top + Math.min(a.height / 2, 22) - o.top, y2 = b.top + Math.min(b.height / 2, 22) - o.top;
        const x1 = a.right - o.left, x2 = b.left - o.left - 2;
        const dash1 = st === 'none' ? ' stroke-dasharray="5 4"' : '';
        out += `<path d="M${x1},${y1} C${x1 + 30},${y1} ${x2 - 30},${y2} ${x2},${y2}" fill="none" stroke="${st === 'none' ? col.none : 'var(--violet)'}" stroke-width="1.8"${dash1} marker-end="url(#brm-a-${st === 'none' ? 'none' : 'violet'})"/>`;
        const sx = b.right - o.left, sy = y2;
        const n = rows.length, ty = m.top - o.top + m.height * (k + 1) / (n + 1), tx = m.left - o.left - 2;
        const dash2 = (st === 'none' || st === 'empty') ? ' stroke-dasharray="5 4"' : '';
        out += `<path d="M${sx},${sy} C${sx + 40},${sy} ${tx - 40},${ty} ${tx},${ty}" fill="none" stroke="${col[st]}" stroke-width="${st === 'todo' ? 2.4 : 1.8}"${dash2} opacity="${st === 'none' ? .6 : 1}" marker-end="url(#brm-a-${st})"/>`;
    });
    svg.innerHTML = out;
}
window.addEventListener('resize', () => { if (brmVisible()) brmArrows(); });

async function brmCreate(i, btn) {
    const r = devState.repos[i], inp = document.getElementById('brm-n-' + i), carry = document.getElementById('brm-n-' + i + '-carry');
    const name = inp.value.trim();
    if (!name){ inp.focus(); return; }
    btn.disabled = true; btn.innerHTML = '<span class="dev-spin"></span>';
    const x = await apiJson('POST', `projects/${wsProjectId}/dev/new-branch`, {repo: r.dir, name, carry: !!(carry && carry.checked)});
    btn.disabled = false; btn.textContent = 'Créer';
    if (!x.success){ toast(devErr(x), 'error'); return; }
    toast(`${r.name} : branche ${x.branch} créée depuis ${x.from}`);
    if (x.note) toast(x.note, 'info');
    inp.value = '';
    delete devBranches[r.path];
    await brmLoad(false);
}
async function brmUpdateMain(i, btn) {
    const r = devState.repos[i]; btn.disabled = true;
    const x = await apiJson('POST', `projects/${wsProjectId}/dev/update-main`, {repo: r.dir});
    if (!x.success){ btn.disabled = false; toast(devErr(x), 'error'); return; }
    toast(`${r.name} : ${x.message}`);
    await brmLoad(false);
}
function brmGo(i) { closeModals(); wsTab('dev'); devChoose(devState.repos[i].dir); }
async function brmSession(i, kind) { const r = devState.repos[i]; closeModals(); devChoose(r.dir); await wsNewSession(kind, r.dir); }

/* ── sessions (onglets du terminal) ── */
let devSessions = [];
async function loadTermTabs() {
    if (!wsProjectId) return;
    const pid = wsProjectId;
    const l = await api('terminal/sessions?pid=' + pid).catch(() => []);
    if (pid !== wsProjectId) return;
    devSessions = Array.isArray(l) ? l : [];
    renderTermTabs();
    renderDevSessions();
}
function wsBaseSid() { return projectTermSid(wsProjectId); }
function renderTermTabs() {
    const box = document.getElementById('ws-term-tabs'); if (!box) return;
    const base = wsBaseSid();
    const autres = devSessions.filter(s => s.sid !== base);
    const actif = wsTermSid || base;
    const tab = (sid, ico, label, sous, fermable) => `<span class="term-tab ${sid === actif ? 'on' : ''}" onclick="wsAttach('${hx(sid)}')" title="${hx(sous || '')}">
        <span class="term-ico">${ico}</span>${hx(label)}${sous ? `<span class="term-sous">${hx(sous)}</span>` : ''}
        ${fermable ? `<span class="term-x" onclick="event.stopPropagation();wsKill('${hx(sid)}')" title="Fermer cette session">×</span>` : ''}</span>`;
    const baseInfo = devSessions.find(s => s.sid === base);
    box.innerHTML = tab(base, '›_', 'Projet', baseInfo && baseInfo.branch ? baseInfo.branch : '', false)
        + autres.map(s => tab(s.sid, DEV_KIND_ICO[s.kind] || '›_', s.label, [s.repo !== '.' ? s.repo.split('/').pop() : '', s.branch].filter(Boolean).join(' · '), true)).join('');
}
function renderDevSessions() {
    const z = document.getElementById('dev-sessions'); if (!z) return;
    const base = wsBaseSid(), actif = wsTermSid || base;
    if (!devSessions.length){ z.innerHTML = '<div class="dev-vide">Aucune session ouverte. « ✦ Claude » ou « ›_ Terminal » en ouvrent une dans le dépôt choisi.</div>'; return; }
    z.innerHTML = devSessions.map(s => `<div class="dev-sess ${s.sid === actif ? 'on' : ''}">
        <span class="dev-sk">${DEV_KIND_ICO[s.kind] || '›_'}</span>
        <span class="dev-sl"><b>${hx(s.sid === base ? 'Terminal du projet' : s.label)}</b>
          <span class="dev-ss">${hx(s.repo || '.')}${s.branch ? ' · ' + hx(s.branch) : ''} · ${hx(devDepuis(s.created))}${s.persistent ? ' · persistante' : ''}</span></span>
        <button class="btn btn-xs" onclick="wsAttach('${hx(s.sid)}')">${s.sid === actif ? 'Affichée' : 'Afficher'}</button>
        ${s.sid !== base ? `<button class="btn btn-xs" onclick="wsKill('${hx(s.sid)}')" title="Arrête la session (et ce qui tourne dedans)">Fermer</button>` : ''}</div>`).join('');
}
function devDepuis(t) {
    const s = Math.max(0, Date.now() / 1000 - t);
    return s < 60 ? 'à l’instant' : s < 3600 ? `depuis ${Math.floor(s / 60)} min` : s < 86400 ? `depuis ${Math.floor(s / 3600)} h` : `depuis ${Math.floor(s / 86400)} j`;
}
function wsAttach(sid) {
    const p = wsProjectData && wsProjectData.project; if (!p) return;
    if (wsPrevOn) wsShowTerm();                  // une session qu'on ouvre veut la place
    wsTermSid = sid;
    startXterm(p.path, p.id, sid);
    renderTermTabs(); renderDevSessions();
}
async function wsNewSession(kind, repo) {
    const pid = wsProjectId; if (!pid) return;
    const r = repo !== undefined ? repo : (devCur() ? devCur().dir : '.');
    const x = await apiJson('POST', 'terminal/sessions', {pid, repo: r, kind, rows: xterm && xterm.rows, cols: xterm && xterm.cols});
    if (!x.success){ toast(devErr(x), 'error'); return; }
    await loadTermTabs();
    wsAttach(x.sid);
    toast(kind === 'claude' ? `Claude démarré dans ${x.label.replace('Claude · ', '')}` : `Terminal ouvert dans ${x.label}`);
}
async function wsKill(sid) {
    const s = devSessions.find(x => x.sid === sid);
    if (!confirm(`Fermer la session « ${s ? s.label : sid} » ? Ce qui tourne dedans est arrêté.`)) return;
    await apiDel('terminal/sessions/' + encodeURIComponent(sid)).catch(() => {});
    if ((wsTermSid || wsBaseSid()) === sid) wsAttach(wsBaseSid());
    await loadTermTabs();
}

/* ── page « Sessions » : tous les projets ── */
async function loadSessionsPage() {
    const z = document.getElementById('sessions-body');
    z.innerHTML = '<div class="dev-wait"><span class="dev-spin"></span> Lecture des sessions…</div>';
    const l = await api('terminal/sessions').catch(() => []);
    if (!l.length){ z.innerHTML = '<div class="card"><div class="dev-vide">Aucune session ouverte. Ouvre un projet, onglet « Développer », puis « ✦ Claude » ou « ›_ Terminal ».</div></div>'; return; }
    const groupes = {};
    l.forEach(s => { (groupes[s.project || 'Hors projet'] = groupes[s.project || 'Hors projet'] || []).push(s); });
    z.innerHTML = `<div class="dev-intro">${l.length} session${l.length > 1 ? 's' : ''} ouverte${l.length > 1 ? 's' : ''}. Elles continuent en arrière-plan${l.some(s => s.persistent) ? ', même si DevAgent redémarre' : ''} ; « Fermer » ou « Fermer le projet » les arrêtent pour de bon.</div>`
      + Object.entries(groupes).map(([proj, ss]) => `<div class="card mb-12"><div class="dev-sec"><span>${hx(proj)} <span class="dev-n">${ss.length}</span></span>
          ${ss[0].pid ? `<button class="btn btn-xs" onclick="openWorkspace(${ss[0].pid})">Ouvrir le projet</button>` : ''}</div>
        ${ss.map(s => `<div class="dev-sess"><span class="dev-sk">${DEV_KIND_ICO[s.kind] || '›_'}</span>
          <span class="dev-sl"><b>${hx(s.label)}</b><span class="dev-ss">${hx(s.repo || s.cwd)}${s.branch ? ' · ' + hx(s.branch) : ''} · ${hx(devDepuis(s.created))}${s.clients ? ' · affichée' : ''}</span></span>
          ${s.pid ? `<button class="btn btn-xs" onclick="sessOuvrir(${s.pid}, '${hx(s.sid)}')">Afficher</button>` : ''}
          <button class="btn btn-xs" onclick="sessFermer('${hx(s.sid)}', '${hx(s.label)}')">Fermer</button></div>`).join('')}</div>`).join('');
}
async function sessOuvrir(pid, sid) {
    await openWorkspace(pid);
    setTimeout(() => wsAttach(sid), 300);
}
async function sessFermer(sid, label) {
    if (!confirm(`Fermer la session « ${label} » ? Ce qui tourne dedans est arrêté.`)) return;
    await apiDel('terminal/sessions/' + encodeURIComponent(sid)).catch(() => {});
    loadSessionsPage();
}

/* ── Paramètres : outils de développement ── */
async function loadDevTools() {
    const s = await api('settings').catch(() => ({}));
    const e = document.getElementById('set-editor-cmd'), c = document.getElementById('set-claude-cmd');
    if (e) e.value = s.editor_cmd || '';
    if (c) c.value = s.claude_cmd || '';
}
async function saveDevTools() {
    await apiPost('settings', {editor_cmd: document.getElementById('set-editor-cmd').value.trim(),
                               claude_cmd: document.getElementById('set-claude-cmd').value.trim()});
    toast('Outils de développement enregistrés');
}

// Real terminal with xterm.js + WebSocket PTY
let xterm = null;
let xtermWs = null;
let fitAddon = null;

function xtermOptions() {
    return {
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
        theme: {
            background: '#0a0a0f', foreground: '#c8c8d4', cursor: '#6d5cff', cursorAccent: '#0a0a0f',
            selectionBackground: 'rgba(109, 92, 255, 0.3)',
            black: '#1e1e2e', red: '#f43f5e', green: '#22d3a7', yellow: '#f59e0b', blue: '#60a5fa',
            magenta: '#a78bfa', cyan: '#38bdf8', white: '#c8c8d4', brightBlack: '#62627a',
            brightRed: '#f43f5e', brightGreen: '#22d3a7', brightYellow: '#fbbf24', brightBlue: '#60a5fa',
            brightMagenta: '#c084fc', brightCyan: '#67e8f9', brightWhite: '#f0f0f5',
        },
        allowProposedApi: true,
    };
}

function terminalWsUrl(params) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    return `${proto}//${location.host}/api/terminal/ws?${q}`;
}

// Session used by a project's terminal: the import session it came from, if any
function projectTermSid(pid) {
    if (!pid) return '';
    try { return localStorage.getItem('dp-term-sid-' + pid) || ('proj-' + pid); } catch (e) { return 'proj-' + pid; }
}

function closeXterm() {
    // detach the old socket first: its late events must not reach the next terminal
    if (xtermWs) { xtermWs.onmessage = xtermWs.onclose = xtermWs.onerror = null; try { xtermWs.close(); } catch(e){} xtermWs = null; }
    if (xterm) { xterm.dispose(); xterm = null; }
}

function startXterm(cwd, pid, sid) {
    closeXterm();

    const container = document.getElementById('ws-xterm');
    container.innerHTML = '';

    // Create xterm instance
    xterm = new Terminal(xtermOptions());

    fitAddon = new FitAddon.FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(container);
    try { fitAddon.fit(); } catch(e) {}           // the real size, sent on connect (a new tmux session starts at it)

    // Fit again after a small delay, once the container is surely sized
    setTimeout(() => {
        try { fitAddon.fit(); } catch(e) {}
    }, 100);

    // Focus terminal on click
    container.addEventListener('click', () => {
        if (xterm) xterm.focus();
    });

    // Connect WebSocket
    const wsUrl = terminalWsUrl({ cwd: cwd, sid: sid || projectTermSid(pid), rows: xterm.rows, cols: xterm.cols });
    xtermWs = new WebSocket(wsUrl);

    xtermWs.onopen = () => {
        console.log('[DevAgent] Terminal WebSocket connected');
        // Send initial size
        const dims = fitAddon.proposeDimensions();
        if (dims) {
            xtermWs.send(`\x1b[RESIZE:${dims.rows},${dims.cols}]`);
        }
        // Focus terminal so keystrokes work immediately
        setTimeout(() => {
            if (xterm) {
                xterm.focus();
                console.log('[DevAgent] Terminal focused');
            }
        }, 300);
    };

    xtermWs.onerror = (err) => {
        console.error('[DevAgent] Terminal WebSocket error:', err);
    };

    const term = xterm;                       // this socket writes only to its own terminal
    xtermWs.onmessage = (e) => { term.write(e.data); };

    xtermWs.onclose = (ev) => {
        console.log('[DevAgent] Terminal WebSocket closed:', ev.code, ev.reason);
        term.write('\r\n\x1b[31m[Terminal deconnecte]\x1b[0m\r\n');
    };

    // Send keystrokes to WebSocket
    xterm.onData((data) => {
        if (xtermWs && xtermWs.readyState === WebSocket.OPEN) {
            xtermWs.send(data);
        }
    });

    // Allow Ctrl+Shift+V for paste, let xterm handle all other keys
    xterm.attachCustomKeyEventHandler((e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'V') return true;
        if (e.ctrlKey && e.shiftKey && e.key === 'C') return true;
        return true;
    });

    // Handle resize
    xterm.onResize(({ rows, cols }) => {
        if (xtermWs && xtermWs.readyState === WebSocket.OPEN) {
            xtermWs.send(`\x1b[RESIZE:${rows},${cols}]`);
        }
    });

    // Resize on window resize
    window._xtermResizeHandler = () => {
        try { if (fitAddon) fitAddon.fit(); } catch(e) {}
    };
    window.addEventListener('resize', window._xtermResizeHandler);
}

// Also run git actions in the real terminal
async function runTermCmd(cmd, dir) {
    // Always run in the project (or chosen repo), even if the terminal was cd'ed elsewhere
    const where = dir || (wsGitRepo && wsGitRepo.path) || wsProjectData?.project?.path;
    if (xterm && xtermWs && xtermWs.readyState === WebSocket.OPEN) {
        xtermWs.send((where ? 'cd ' + shq(where) + ' && ' : '') + cmd + '\n');
        xterm.focus();
    }
}

function wsCommitAll() {
    const msg = prompt('Message du commit :');
    if (!msg || !msg.trim()) return;
    runTermCmd('git add -A && git commit -m ' + shq(msg.trim()));
}

function wsSelectRepo(dir) {
    const root = wsProjectData?.project?.path || '';
    wsGitRepo = (wsProjectData?.repos || []).find(r => r.dir === dir)
             || (dir ? { dir: dir, path: dir === '.' ? root : root + '/' + dir } : null);
    loadWsGit();
}

