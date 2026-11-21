/* ═══════════════════════════════════════════════════════════
   WORKSPACE
   ═══════════════════════════════════════════════════════════ */
let wsProjectId = null;
let wsProjectData = null;
let wsOpenSeq = 0;          // guards against a slower, older openWorkspace overwriting a newer one
let wsGitRepo = null;       // repo the git actions run in (multi-repo projects)

// Quote for bash: every command sent to the project terminal is anchored with cd
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
let wsSpecs = null;
let wsCmdHistory = [];
let wsCmdIdx = -1;

let wsActiveTabs = ['roadmap','checklist','sessions','git','cloud','info','prompt'];
let wsComponents = [];

function buildWsTabs(components) {
    // Determine which tabs to show based on active components
    const tabs = ['dev', 'roadmap', 'checklist', 'sessions', 'connections'];
    if (!components || components.length === 0) {
        tabs.push('git', 'cloud', 'info', 'prompt');
    } else {
        if (components.includes('git')) tabs.push('git');
        if (components.includes('storage') || components.includes('backup') || components.includes('database')) tabs.push('cloud');
        tabs.push('info', 'prompt');
    }
    wsActiveTabs = tabs;

    const container = document.getElementById('ws-tabs-container');
    container.innerHTML = tabs.map((t, i) =>
        `<div class="ws-tab${i===0?' active':''}" data-tab="${t}" onclick="wsTab('${t}')" title="${hx(WS_TAB_TITLES[t] || t)}">${WS_TAB_ICONS[t] || ''}<span>${WS_TAB_LABELS[t] || t}</span><span class="ws-tab-badge" id="ws-badge-${t}" style="display:none"></span></div>`
    ).join('');
    wsTabsOverflow();

    // Show/hide panels
    document.querySelectorAll('.ws-panel').forEach(p => {
        const id = p.id.replace('ws-','');
        p.style.display = tabs.includes(id) ? '' : 'none';
        p.classList.remove('active');
    });
}

async function openWorkspace(pid) {
    const seq = ++wsOpenSeq;
    wsProjectId = pid;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
    document.getElementById('page-workspace').classList.add('active');
    document.getElementById('page-title').textContent = 'Workspace';
    currentPage = 'workspace';
    window.location.hash = 'workspace:' + pid;

    const [data, specs, comps] = await Promise.all([
        api('projects/' + pid + '/status'),
        api('projects/' + pid + '/specs'),
        api('projects/' + pid + '/components'),
    ]);
    if (seq !== wsOpenSeq) return;          // another project was opened meanwhile
    wsProjectData = data;
    wsSpecs = specs;
    wsComponents = (comps || []).filter(c => c.enabled).map(c => c.component);
    const p = data.project;
    const repos = data.repos || [];
    wsGitRepo = repos.find(r => r.dir === '.') || repos[0] || null;

    // Build profile badge
    const profileBadge = '';   // the type is in the model bar below
    document.getElementById('ws-title').innerHTML = `<span style="color:${p.color}">${p.name}</span>${profileBadge}`;
    document.getElementById('ws-term-title').textContent = p.path || p.name;
    document.getElementById('ws-copy-prompt').style.display = (specs && specs.prompt) ? '' : 'none';

    // Build dynamic tabs
    buildWsTabs(wsComponents);

    // Not linked to GitHub yet (a multi-repo project is linked repo by repo)
    const multi = !!data.github_org || (repos.length && !repos.some(r => r.dir === '.'));
    const linked = multi ? !!data.github_org : !!p.git_remote;
    const banner = document.getElementById('ws-github-banner');
    banner.style.display = (!linked && data.state === 'ok') ? 'flex' : 'none';
    banner.querySelector('span').textContent = multi ? "Ce projet contient plusieurs depots : lie-le a son organisation GitHub."
                                                     : "Ce projet n'est pas encore lie a GitHub.";
    banner.querySelector('button').textContent = 'Lier a GitHub';

    // Show detect banner if no profile set
    const detectBanner = document.getElementById('ws-detect-banner');
    if (detectBanner) {
        detectBanner.style.display = (!p.profile && p.path) ? 'flex' : 'none';
    }

    renderCtrlButton(data.controller);

    // Integrated terminal: always in THIS project's folder, never a fallback dir
    if (data.state === 'ok') {
        startXterm(p.path, pid);
        apiPost('projects/' + pid + '/init-devpilot', {}).catch(() => {});
    } else {
        closeXterm();
        document.getElementById('ws-xterm').innerHTML = `<div class="alert alert-warning" style="margin:16px">
            Le dossier du projet est introuvable (${hx(p.path || 'aucun')}). Le terminal s'ouvrira dans le dossier du projet une fois relocalise.
            <button class="btn btn-xs btn-primary" style="margin-left:8px" onclick="go('projects');openMoveModal(${pid})">Relocaliser</button></div>`;
    }

    devState = null; wsTermSid = null; devSessions = [];
    wsTab('dev');
    loadWsRoadmap();          // ligne de phase sous le titre + badge « Etapes », quel que soit l'onglet affiché
    loadWsModel();
    loadWsRunning();
    loadWsChecklist();
    loadWsInfo();
    loadWsPrompt();
}

const WS_TAB_LABELS = { dev: 'Développer', roadmap: 'Etapes', checklist: 'Checklist', sessions: 'Notes', connections: 'Connexions', git: 'Git', cloud: 'Cloud', info: 'Infos', prompt: 'Prompt' };
const WS_TAB_TITLES = { dev: 'Dépôts, branches : où travailler, avec Claude, VS Code ou un terminal', roadmap: 'Feuille de route : phases et prochaine etape', checklist: 'Taches du projet', sessions: 'Notes de session', connections: 'GitHub, serveurs, domaine, email...', git: 'Depots, synchronisation', cloud: 'Sauvegardes et stockage', info: 'Informations du projet', prompt: 'Brief / prompt pour Claude' };
const _svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const WS_TAB_ICONS = {
    dev: _svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><path d="M14 4l-4 16"/>'),
    roadmap: _svg('<path d="M4 4h16v4H4z"/><path d="M4 12h10"/><path d="M4 18h7"/><circle cx="18" cy="16" r="3"/>'),
    checklist: _svg('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
    sessions: _svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    connections: _svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    git: _svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7"/><path d="M18 10.5c0 4-12 2-12 5"/>'),
    cloud: _svg('<path d="M17.5 19a4.5 4.5 0 0 0 .5-9 7 7 0 0 0-13.5 2A4 4 0 0 0 6 19z"/>'),
    info: _svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>'),
    prompt: _svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z"/>'),
};

function wsTabsOverflow() {
    const strip = document.getElementById('ws-tabs-container'), wrap = document.getElementById('ws-tabs-wrap');
    if (!strip || !wrap) return;
    wrap.classList.toggle('has-more', strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 4);
}
document.addEventListener('DOMContentLoaded', () => {
    const strip = document.getElementById('ws-tabs-container');
    if (strip) strip.addEventListener('scroll', wsTabsOverflow);
    window.addEventListener('resize', wsTabsOverflow);
});

function wsBadge(tab, value, warn) {
    const el = document.getElementById('ws-badge-' + tab);
    if (!el) return;
    if (value === null || value === undefined || value === '' || value === 0) { el.style.display = 'none'; return; }
    el.style.display = ''; el.textContent = value; el.classList.toggle('warn', !!warn);
}

function wsTab(tab) {
    document.querySelectorAll('.ws-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ws-panel').forEach(p => p.classList.remove('active'));
    const btn = document.querySelector('.ws-tab[data-tab="' + tab + '"]');
    if (btn) { btn.classList.add('active'); btn.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    const panel = document.getElementById('ws-' + tab);
    if (panel) panel.classList.add('active');
    if (tab === 'dev') loadWsDev();
    if (tab === 'roadmap') loadWsRoadmap();
    if (tab === 'sessions') loadWsSessions();
    if (tab === 'connections') loadWsConnections();
    if (tab === 'git') loadWsGit();
    if (tab === 'cloud') loadWsCloud();
}

function loadWsChecklist() {
    const el = document.getElementById('ws-checklist');
    if (!wsSpecs || !wsSpecs.checklist || !wsSpecs.checklist.length) {
        el.innerHTML = '<div class="card" style="padding:16px"><div style="color:var(--text-4);font-size:12px;text-align:center;padding:20px">Pas de checklist</div></div>';
        return;
    }
    const tasks = wsSpecs.checklist;
    const doneCount = tasks.filter(t => t.done).length;
    wsBadge('checklist', tasks.length - doneCount, false);
    const pct = tasks.length ? Math.round(doneCount / tasks.length * 100) : 0;
    el.innerHTML = `<div class="card" style="padding:14px">
        <div class="flex-between mb-8"><span style="font-size:12px;font-weight:700;color:var(--text-0)">Checklist</span><span style="font-size:11px;color:${pct===100?'var(--emerald)':'var(--text-3)'};font-weight:600">${doneCount}/${tasks.length}</span></div>
        <div class="progress mb-12" style="height:3px"><div class="progress-fill ${pct===100?'fill-emerald':'fill-violet'}" style="width:${pct}%"></div></div>
        ${tasks.map((t, i) => `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-0)">
            <input type="checkbox" class="ws-check" data-idx="${i}" ${t.done ? 'checked' : ''} onchange="saveWsChecklist()" style="accent-color:var(--emerald);width:14px;height:14px;flex-shrink:0;cursor:pointer;margin-top:1px">
            <span style="font-size:12px;line-height:1.4;${t.done ? 'text-decoration:line-through;color:var(--text-4)' : 'color:var(--text-1)'}">${t.text}</span>
        </div>`).join('')}
    </div>`;
}

async function saveWsChecklist() {
    if (!wsSpecs || !wsProjectId) return;
    document.querySelectorAll('.ws-check').forEach(cb => {
        const idx = parseInt(cb.dataset.idx);
        if (wsSpecs.checklist[idx]) {
            wsSpecs.checklist[idx].done = cb.checked;
            const label = cb.nextElementSibling;
            if (label) { label.style.textDecoration = cb.checked ? 'line-through' : 'none'; label.style.color = cb.checked ? 'var(--text-4)' : 'var(--text-1)'; }
        }
    });
    await apiPost('projects/' + wsProjectId + '/checklist', { checklist: wsSpecs.checklist });
    loadWsChecklist();
}

function loadWsInfo() {
    const el = document.getElementById('ws-info');
    if (!wsProjectData) return;
    const d = wsProjectData; const p = d.project; const g = d.git; const wd = wsSpecs?.wizard_data || {};
    let h = '';
    h += `<div class="card mb-8" style="padding:14px"><div class="card-label">Projet</div><div style="display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px">
        <span class="text-dim">Nom</span><span style="font-weight:600">${p.name}</span>
        ${wd.client_name ? '<span class="text-dim">Client</span><span>' + wd.client_name + '</span>' : ''}
        ${wd.site_type ? '<span class="text-dim">Type</span><span>' + wd.site_type + '</span>' : ''}
        ${wd.domain_name ? '<span class="text-dim">Domaine</span><span class="mono">' + wd.domain_name + '</span>' : ''}
        <span class="text-dim">Chemin</span><span class="mono" style="font-size:10px">${p.path || '—'}</span>
    </div></div>`;
    h += `<div class="card mb-8" style="padding:14px"><div class="card-label">Ressources</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><span style="font-size:18px;font-weight:800">${d.disk_total_h}</span><div class="card-sub">Disque</div></div>
        <div><span style="font-size:18px;font-weight:800;color:var(--sky)">${d.total_cache_h}</span><div class="card-sub">Caches</div></div>
        <div><span style="font-size:18px;font-weight:800">${d.resources.length}</span><div class="card-sub">Fichiers</div></div>
        <div><span style="font-size:18px;font-weight:800">${d.ports.length}</span><div class="card-sub">Ports</div></div>
    </div></div>`;
    if (g) { h += `<div class="card mb-8" style="padding:14px"><div class="card-label">Git</div><div style="display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px">
        <span class="text-dim">Branche</span><span style="font-weight:600">${g.branch}</span>
        <span class="text-dim">Status</span><span>${g.is_clean ? '<span class="badge badge-emerald">Clean</span>' : g.modified + ' mod, ' + g.untracked + ' untracked'}</span>
        <span class="text-dim">Commit</span><span>${g.last_commit}</span></div></div>`; }
    if (d.caches.length) { h += `<div class="card" style="padding:14px"><div class="card-label">Caches</div>${d.caches.map(c => `<div class="flex-between" style="font-size:11px;padding:2px 0"><span>${c.name}</span><span class="mono">${c.size_h}</span></div>`).join('')}</div>`; }
    el.innerHTML = h;
}

async function loadWsSessions() {
    const el = document.getElementById('ws-sessions');
    if (!wsProjectId) return;
    const sessions = await api('projects/' + wsProjectId + '/sessions');
    const ppath = wsProjectData?.project?.path || '';
    const projName = wsProjectData?.project?.name || '';

    // Group sessions by date
    const grouped = {};
    sessions.forEach(s => {
        const date = s.modified.split(' ')[0];
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(s);
    });
    const dates = Object.keys(grouped).sort().reverse();

    el.innerHTML = `
        <!-- New session form -->
        <div class="card mb-8" style="padding:16px">
            <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Nouvelle session</div>
            <input class="form-input mb-8" id="ws-sess-title" placeholder="Titre : setup-backend, fix-auth, deploy-v1..." style="font-size:12px">
            <textarea class="form-input mb-8" id="ws-sess-content" rows="4" placeholder="Resume ou tu en es :&#10;&#10;- Ce que j'ai fait&#10;- Ce qui reste a faire&#10;- Problemes rencontres&#10;&#10;Claude lira ce fichier pour reprendre." style="font-size:12px;resize:vertical;line-height:1.5"></textarea>
            <div class="flex-between">
                <button class="btn btn-sm btn-primary" onclick="saveWsSession()">Sauvegarder</button>
                <span style="font-size:10px;color:var(--text-4)">ou dis a Claude : "sauvegarde la session"</span>
            </div>
        </div>

        <!-- Claude command hint -->
        ${ppath ? `<div class="card mb-8" style="padding:12px;border-color:rgba(56,189,248,.15);background:rgba(56,189,248,.03)">
            <div style="font-size:10px;font-weight:600;color:var(--sky);margin-bottom:6px">POUR REPRENDRE AVEC CLAUDE</div>
            <div class="mono" style="font-size:11px;color:var(--text-1);user-select:all;cursor:text;background:var(--bg-0);padding:8px 10px;border-radius:var(--radius-xs);border:1px solid var(--border-0)">cd ${ppath} && claude "lis la derniere session et reprends"</div>
        </div>` : ''}

        <!-- Session history -->
        <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Historique <span style="font-weight:500;color:var(--text-3)">(${sessions.length})</span></div>

        ${sessions.length ? dates.map(date => `
            <div style="margin-bottom:12px">
                <div style="font-size:10px;font-weight:700;color:var(--text-4);text-transform:uppercase;letter-spacing:1px;padding:6px 0;border-bottom:1px solid var(--border-0);margin-bottom:4px">${date}</div>
                ${grouped[date].map((s, i) => `
                    <div class="card mb-8" style="padding:12px;border-left:2px solid var(--violet)">
                        <div class="flex-between" style="margin-bottom:4px">
                            <div style="font-weight:600;font-size:13px;color:var(--text-0)">${s.title}</div>
                            <span style="font-size:10px;color:var(--text-4)">${s.modified.split(' ')[1] || ''}</span>
                        </div>
                        <div class="mono" style="font-size:9px;color:var(--text-4);margin-bottom:8px">${s.filename}</div>
                        <div class="flex gap-6">
                            <button class="btn btn-xs" onclick="viewSession('${s.name}')">Lire</button>
                            <button class="btn btn-xs" onclick="navigator.clipboard.writeText('${s.path}');toast('Path copie')">Copier path</button>
                            <button class="btn btn-xs btn-danger" onclick="deleteSession('${s.name}')">Supprimer</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `).join('') : `
            <div class="card" style="padding:24px;text-align:center">
                <div style="font-size:24px;margin-bottom:8px;opacity:.3">&#9776;</div>
                <div style="color:var(--text-4);font-size:12px">Aucune session sauvegardee</div>
                <div style="color:var(--text-4);font-size:11px;margin-top:4px">Sauvegarde ton avancement ci-dessus ou dis a Claude "save session"</div>
            </div>
        `}`;
}

async function saveWsSession() {
    const title = document.getElementById('ws-sess-title').value.trim();
    const content = document.getElementById('ws-sess-content').value.trim();
    if (!title || !content) { toast('Titre et contenu requis', 'error'); return; }
    const r = await apiPost('projects/' + wsProjectId + '/sessions', { title, content });
    if (r.success) {
        toast(r.message);
        document.getElementById('ws-sess-title').value = '';
        document.getElementById('ws-sess-content').value = '';
        loadWsSessions();
    } else { toast(r.message, 'error'); }
}

async function viewSession(name) {
    const r = await api('projects/' + wsProjectId + '/sessions/' + name);
    if (r.content) {
        showModal('session-view-modal');
        document.getElementById('session-view-title').textContent = name;
        document.getElementById('session-view-content').textContent = r.content;
        document.getElementById('session-view-path').textContent = r.path || '';
    }
}

async function deleteSession(name) {
    if (!confirm('Supprimer la session "' + name + '" ?')) return;
    await apiDel('projects/' + wsProjectId + '/sessions/' + name);
    toast('Session supprimee');
    loadWsSessions();
}

function loadWsPrompt() {
    const el = document.getElementById('ws-prompt');
    // Always editable: a new project starts with an empty prompt (saved to .devpilot/prompt.md)
    if (!wsSpecs) wsSpecs = { wizard_data: {}, checklist: [], prompt: '' };
    const prompt = wsSpecs.prompt || '';
    el.innerHTML = '<div class="card" style="padding:14px"><div class="flex-between mb-8"><div class="card-label" style="margin-bottom:0">Prompt Claude</div><div class="flex gap-6">'
        + '<button class="btn btn-xs" id="ws-prompt-save" onclick="wsSavePrompt()" style="display:none;background:var(--emerald);border-color:var(--emerald);color:#fff">Sauvegarder</button>'
        + '<button class="btn btn-xs" onclick="wsCopyPrompt()">Copier</button>'
        + '<button class="btn btn-xs btn-primary" onclick="sendPromptToTerminal()">Envoyer au terminal</button>'
        + '</div></div>'
        + '<textarea id="ws-prompt-editor" class="mono" placeholder="Ecris ici le prompt du projet (enregistre dans .devpilot/prompt.md)" oninput="document.getElementById(\'ws-prompt-save\').style.display=\'\'" style="width:100%;font-size:10px;color:var(--text-2);background:var(--bg-0);padding:12px;border-radius:var(--radius-xs);border:1px solid var(--border-0);min-height:300px;max-height:calc(100vh - 250px);resize:vertical;line-height:1.5;font-family:inherit">'
        + hx(prompt)
        + '</textarea></div>';
}

function wsCopyPrompt() {
    const editor = document.getElementById('ws-prompt-editor');
    const text = editor ? editor.value : (wsSpecs?.prompt || '');
    navigator.clipboard.writeText(text);
    toast('Prompt copie');
}

async function wsSavePrompt() {
    const editor = document.getElementById('ws-prompt-editor');
    if (!editor || !wsProjectId) return;
    const newPrompt = editor.value;
    wsSpecs.prompt = newPrompt;
    await apiPost('projects/' + wsProjectId + '/specs', {
        wizard_data: wsSpecs.wizard_data || {},
        checklist: wsSpecs.checklist || [],
        prompt: newPrompt,
    });
    // the server writes .devpilot/prompt.md in the project folder
    document.getElementById('ws-prompt-save').style.display = 'none';
    toast('Prompt sauvegarde');
}

async function sendPromptToTerminal() {
    if (!wsProjectId) return;
    const editor = document.getElementById('ws-prompt-editor');
    const prompt = editor ? editor.value : (wsSpecs?.prompt || '');
    if (!prompt) { toast('Pas de prompt', 'error'); return; }
    const project = wsProjectData?.project;
    if (!project?.path) { toast('Pas de chemin projet', 'error'); return; }

    // Save current editor content first
    wsSpecs.prompt = prompt;
    await wsSavePrompt();

    // wsSavePrompt wrote .devpilot/prompt.md; launch claude from the project folder
    try {
        if (xterm && xtermWs && xtermWs.readyState === WebSocket.OPEN) {
            xtermWs.send('cd ' + shq(project.path) + ' && cat .devpilot/prompt.md | claude\n');
            toast('Prompt envoye a Claude');
            xterm.focus();
        } else {
            toast('Prompt sauvegarde dans .devpilot/prompt.md — lance: cat .devpilot/prompt.md | claude');
        }
    } catch(e) {
        toast('Erreur: ' + e.message, 'error');
    }
}

/* ═══ CONNECTIONS TAB ═══ */

const CONN_ICONS = {
    github:     {emoji:'🔗', bg:'rgba(139,92,246,.12)'},
    source:     {emoji:'📁', bg:'rgba(98,98,122,.12)'},
    storage:    {emoji:'☁️', bg:'rgba(56,189,248,.12)'},
    database:   {emoji:'🗄️', bg:'rgba(34,211,167,.12)'},
    deploy:     {emoji:'🚀', bg:'rgba(245,158,11,.12)'},
    domain:     {emoji:'🌐', bg:'rgba(96,165,250,.12)'},
    server:     {emoji:'🖥️', bg:'rgba(251,191,36,.12)'},
    backup:     {emoji:'🛡️', bg:'rgba(34,211,167,.12)'},
    auth:       {emoji:'🔒', bg:'rgba(167,139,250,.12)'},
    monitoring: {emoji:'📊', bg:'rgba(244,63,94,.12)'},
    docker:     {emoji:'🐳', bg:'rgba(56,189,248,.12)'},
    ci_cd:      {emoji:'⚙️', bg:'rgba(245,158,11,.12)'},
    email:      {emoji:'📧', bg:'rgba(96,165,250,.12)'},
};
const CONN_STATUS = {
    connected:     {label:'Connecte',      cls:'badge-emerald'},
    configured:    {label:'Configure',     cls:'badge-amber'},
    a_configurer:  {label:'A configurer',  cls:'badge-amber'},
    detecte:       {label:'Detecte',       cls:'badge-sky'},
    detected:      {label:'Detecte',       cls:'badge-sky'},
    non_connecte:  {label:'Non connecte',  cls:'badge-rose'},
    missing:       {label:'Manquant',      cls:'badge-rose'},
};
// Hosting platforms (no SSH: a token + the site URL). Keys lowercase: the DNS
// records and the dashboards are keyed on them (cloud_routes.PLATFORMS).
const DEPLOY_PLATFORMS = [
    {key:'vercel',     label:'Vercel',            icon:'▲', tokenUrl:'https://vercel.com/account/tokens'},
    {key:'netlify',    label:'Netlify',           icon:'◆', tokenUrl:'https://app.netlify.com/user/applications#personal-access-tokens'},
    {key:'railway',    label:'Railway',           icon:'🚂', tokenUrl:'https://railway.app/account/tokens'},
    {key:'render',     label:'Render',            icon:'▸', tokenUrl:'https://dashboard.render.com/settings#api-keys'},
    {key:'cloudflare', label:'Cloudflare Pages',  icon:'☁️', tokenUrl:'https://dash.cloudflare.com/profile/api-tokens'},
];
function deployPlatform(key) { return DEPLOY_PLATFORMS.find(function(p) { return p.key === key; }) || null; }
function deployTokenUrl(key) { return (deployPlatform(key) || {}).tokenUrl || '#'; }

async function loadWsConnections() {
    const el = document.getElementById('ws-connections');
    if (!wsProjectId) { el.innerHTML = ''; return; }

    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-4)">Chargement...</div>';

    try {
        const data = await api('projects/' + wsProjectId + '/connections');
        // servers and GitHub have their own flows (Serveurs section, "Lier a GitHub")
        const conns = (data.connections || []).filter(c => !['server', 'github', 'domain', 'email'].includes(c.type));

        if (!conns.length) {
            el.innerHTML = '<div id="ws-controller"></div><div id="ws-github-conn"></div><div id="ws-servers"></div><div id="ws-domain"></div><div id="ws-email"></div><div class="card" style="padding:24px;text-align:center">'
                + '<div style="color:var(--text-3);font-size:12px;margin-bottom:10px">Autres connexions : base de donnees, stockage, sauvegardes, plateforme de deploiement...</div>'
                + '<button class="btn btn-sm" onclick="wsShowAddConnection()">+ Ajouter une connexion</button>'
                + '</div>';
            modelLoadMeta().then(m => { window._needLabels = Object.fromEntries(Object.entries(m.needs).map(([k, v]) => [k, v.label])); loadWsController(); });
            renderWsGithubConn();
            loadWsServers();
            loadWsDomain();
            loadWsEmail();
            return;
        }

        let html = '';
        for (const c of conns) {
            const icon = CONN_ICONS[c.type] || {emoji:'🔌', bg:'var(--bg-2)'};
            const st = CONN_STATUS[c.status] || {label:c.status, cls:''};
            const hasUrl = c.url && c.url.startsWith('http');

            // Build details rows
            let details = '';
            if (c.details) {
                for (const [k, v] of Object.entries(c.details)) {
                    if (!v || v === false || k === 'has_migrations') continue;
                    const label = {branch:'Branche',last_push:'Dernier push',files:'Fichiers',
                        bucket:'Bucket',objects:'Objets',size:'Taille',last_backup:'Dernier backup',
                        type:'Type',host:'Host',port:'Port',name:'Nom BDD',
                        platform:'Plateforme',last_deploy:'Dernier deploy',provider:'Provider'}[k] || k;
                    let val = v;
                    if (k === 'size' && typeof v === 'number') val = (v / 1048576).toFixed(1) + ' MB';
                    if (typeof v === 'string' && v.includes('T')) val = v.slice(0, 16).replace('T', ' ');
                    details += '<span style="color:var(--text-4)">' + label + '</span><span style="color:var(--text-1)">' + val + '</span>';
                }
            }

            // Action buttons — support single action OR multiple actions
            const actions = c.actions || (c.action ? [c.action] : []);
            let actionBtns = '';
            for (const act of actions) {
                if (act.action_type === 'clone_repo' || act.action_type === 'link_repo') {
                    actionBtns += '<button class="btn btn-xs btn-primary" onclick="wsGitAction(\'' + act.action_type + '\')" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'create_and_push') {
                    actionBtns += '<button class="btn btn-xs btn-primary" onclick="wsGitAction(\'create_and_push\')" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'pick_hosting_account') {
                    actionBtns += '<button class="btn btn-xs btn-primary" onclick="wsPickHostingAccount()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'regen_token') {
                    actionBtns += '<button class="btn btn-xs" onclick="wsRegenToken(\'' + (act.url || '') + '\')" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'enter_site_url') {
                    actionBtns += '<button class="btn btn-xs btn-primary" onclick="wsEnterSiteUrl()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'change_hosting_account') {
                    actionBtns += '<button class="btn btn-xs" onclick="wsChangeHostingAccount()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'setup_deploy') {
                    actionBtns += '<button class="btn btn-xs btn-primary" onclick="wsSetupDeploy()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'setup_database') {
                    actionBtns += '<button class="btn btn-xs" onclick="wsSetupDatabase()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'setup_storage') {
                    actionBtns += '<button class="btn btn-xs" onclick="wsSetupStorage()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'setup_server' || act.action_type === 'add_server') {
                    actionBtns += '<button class="btn btn-xs btn-primary" onclick="wsSetupServer()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'setup_backup') {
                    actionBtns += '<button class="btn btn-xs" onclick="wsSetupBackup()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'setup_email') {
                    actionBtns += '<button class="btn btn-xs btn-primary" onclick="wsSetupEmail()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'setup_domain' || act.action_type === 'edit_domain') {
                    actionBtns += '<button class="btn btn-xs btn-primary" onclick="wsSetupDomain()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.action_type === 'show_dns') {
                    actionBtns += '<button class="btn btn-xs" onclick="wsShowDns()" style="flex-shrink:0">' + act.label + '</button>';
                } else if (act.url) {
                    actionBtns += '<button class="btn btn-xs btn-primary" onclick="wsConnAction(\'' + c.type + '\',\'' + act.url + '\')" style="flex-shrink:0">' + act.label + '</button>';
                } else {
                    actionBtns += '<button class="btn btn-xs btn-primary" onclick="wsShowAddConnection(\'' + c.type + '\')" style="flex-shrink:0">' + act.label + '</button>';
                }
            }

            // Edit button for connected services
            const editBtn = (c.status === 'connected' && c.type !== 'source') ? '<button class="btn btn-xs" onclick="wsEditConnection(\'' + c.type + '\')" title="Modifier" style="flex-shrink:0">✏️</button>' : '';

            // Color based on status
            const borderColor = st.cls.includes('emerald') ? 'var(--emerald)' : st.cls.includes('rose') ? '#f43f5e' : st.cls.includes('amber') ? '#f59e0b' : 'var(--bg-3)';

            html += '<div class="card mb-8" id="conn-card-' + c.type + '" style="padding:14px;border-left:3px solid ' + borderColor + '">'
                + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:' + (details || actionBtns ? '10' : '0') + 'px">'
                + '<div style="width:36px;height:36px;border-radius:8px;background:' + icon.bg + ';display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">' + icon.emoji + '</div>'
                + '<div style="flex:1;min-width:0">'
                + '<div style="font-size:13px;font-weight:700;color:var(--text-0)">' + c.label + '</div>'
                + (hasUrl ? '<a href="' + c.url + '" target="_blank" onclick="event.stopPropagation()" style="font-size:11px;color:var(--violet);text-decoration:none;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + c.url + '</a>' : '')
                + '</div>'
                + '<span class="badge ' + st.cls + '">' + st.label + '</span>'
                + (hasUrl ? '<button class="btn btn-xs" onclick="window.open(\'' + c.url + '\',\'_blank\')" style="flex-shrink:0">Ouvrir</button>' : '')
                + editBtn
                + '</div>';

            if (details) {
                html += '<div style="display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:11px;padding-left:46px">' + details + '</div>';
            }

            // Action buttons row (below details for non-connected)
            if (actionBtns) {
                html += '<div style="display:flex;gap:6px;padding-left:46px;margin-top:8px">' + actionBtns + '</div>';
            }

            // Input zone for git actions
            html += '<div id="conn-paste-' + c.type + '" style="display:none;margin-top:10px;padding-left:46px"></div>';

            html += '</div>';
        }

        html += '<div style="text-align:center;margin-top:12px">'
            + '<button class="btn btn-sm" onclick="wsShowAddConnection()">+ Ajouter une connexion</button>'
            + '</div>';

        el.innerHTML = '<div id="ws-controller"></div><div id="ws-github-conn"></div><div id="ws-servers"></div><div id="ws-domain"></div><div id="ws-email"></div>' + html;
        modelLoadMeta().then(m => { window._needLabels = Object.fromEntries(Object.entries(m.needs).map(([k, v]) => [k, v.label])); loadWsController(); });
        renderWsGithubConn();
        loadWsServers();
        loadWsDomain();
        loadWsEmail();
    } catch(e) {
        el.innerHTML = '<div class="card" style="padding:16px;color:var(--rose)">Erreur: ' + e.message + '</div>';
    }
}

// Git-specific actions
function wsGitAction(actionType) {
    const pasteEl = document.getElementById('conn-paste-github');
    if (!pasteEl) return;

    let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:12px">';

    if (actionType === 'clone_repo') {
        html += '<div style="font-size:12px;font-weight:600;color:var(--violet);margin-bottom:8px">Cloner un repo existant</div>'
            + '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Le repo sera clone dans le dossier du projet</div>'
            + '<div class="form-group" style="margin-bottom:8px"><label style="font-size:11px">URL du repo GitHub</label>'
            + '<input class="form-input" id="git-clone-url" placeholder="https://github.com/user/repo" style="font-size:12px;padding:6px 8px"></div>'
            + '<div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="wsGitClone()">Cloner</button>'
            + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-github\').style.display=\'none\'">Annuler</button></div>';

    } else if (actionType === 'link_repo') {
        html += '<div style="font-size:12px;font-weight:600;color:var(--violet);margin-bottom:8px">Lier a un repo GitHub</div>'
            + '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Ajoute le remote origin et fait un pull</div>'
            + '<div class="form-group" style="margin-bottom:8px"><label style="font-size:11px">URL du repo GitHub</label>'
            + '<input class="form-input" id="git-link-url" placeholder="https://github.com/user/repo" style="font-size:12px;padding:6px 8px"></div>'
            + '<div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="wsGitLink()">Lier</button>'
            + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-github\').style.display=\'none\'">Annuler</button></div>';

    } else if (actionType === 'create_and_push') {
        html += '<div style="font-size:12px;font-weight:600;color:var(--violet);margin-bottom:8px">Creer un repo et pusher le code</div>'
            + '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">1. Cree le repo sur GitHub → 2. Colle l\'URL ici</div>'
            + '<div class="flex gap-6" style="margin-bottom:8px"><button class="btn btn-xs" onclick="window.open(\'https://github.com/new\',\'_blank\')">Ouvrir GitHub</button></div>'
            + '<div class="form-group" style="margin-bottom:8px"><label style="font-size:11px">URL du repo cree</label>'
            + '<input class="form-input" id="git-push-url" placeholder="https://github.com/user/mon-nouveau-repo" style="font-size:12px;padding:6px 8px"></div>'
            + '<div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="wsGitCreateAndPush()">Lier et pusher</button>'
            + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-github\').style.display=\'none\'">Annuler</button></div>';
    }

    html += '</div>';
    pasteEl.innerHTML = html;
    pasteEl.style.display = 'block';
    setTimeout(function() { pasteEl.querySelector('input')?.focus(); }, 100);
}

async function wsGitClone() {
    const url = document.getElementById('git-clone-url')?.value.trim();
    if (!url) { toast('Entre l\'URL du repo', 'error'); return; }
    toast('Clonage en cours...');
    const r = await apiPost('projects/' + wsProjectId + '/connections', {type: 'github', config: {url: url}});
    if (r.success) {
        const gitInfo = r.git || {};
        if (gitInfo.action === 'cloned') {
            toast('Repo clone avec succes !');
        } else if (gitInfo.action === 'clone_failed') {
            toast('Erreur clone: ' + (gitInfo.message || ''), 'error');
        } else {
            toast('Repo lie');
        }
        loadWsConnections();
    } else {
        toast(r.message || 'Erreur', 'error');
    }
}

async function wsGitLink() {
    const url = document.getElementById('git-link-url')?.value.trim();
    if (!url) { toast('Entre l\'URL du repo', 'error'); return; }
    toast('Liaison en cours...');
    const r = await apiPost('projects/' + wsProjectId + '/connections', {type: 'github', config: {url: url}});
    if (r.success) {
        toast(r.git?.message || 'Repo lie');
        loadWsConnections();
    } else {
        toast(r.message || 'Erreur', 'error');
    }
}

async function wsGitCreateAndPush() {
    const url = document.getElementById('git-push-url')?.value.trim();
    if (!url) { toast('Entre l\'URL du repo cree', 'error'); return; }
    toast('Liaison et push en cours...');
    const r = await apiPost('projects/' + wsProjectId + '/connections', {type: 'github', config: {url: url}});
    if (r.success) {
        toast(r.git?.message || 'Repo lie — utilise Claude pour faire le premier push');
        loadWsConnections();
    } else {
        toast(r.message || 'Erreur', 'error');
    }
}

// Pick a hosting account for deploy
// The guided hosting forms are written inside the deploy card. When the project
// has no hosting at all there is no such card yet, so the holder is created
// under the Hebergement section instead of the buttons doing nothing.
function deployPasteEl() {
    let el = document.getElementById('conn-paste-deploy');
    if (el) return el;
    const panel = document.getElementById('ws-connections');
    if (!panel) return null;
    el = document.createElement('div');
    el.id = 'conn-paste-deploy';
    el.style.marginBottom = '8px';
    const after = document.getElementById('ws-servers');
    if (after) after.insertAdjacentElement('afterend', el); else panel.appendChild(el);
    return el;
}

// Hosting = a server over SSH, or a platform. Both ways in, in one place: the
// need chip and the roadmap step land here instead of on the SSH form only.
function wsPickHosting() {
    const el = deployPasteEl();
    if (!el) return;
    const col = 'flex-direction:column;align-items:flex-start;gap:2px;padding:10px 12px;height:auto;text-align:left';
    el.innerHTML = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:14px">'
        + '<div style="font-size:13px;font-weight:700;color:var(--violet)">Ou le site est-il heberge ?</div>'
        + '<div style="font-size:11px;color:var(--text-3);margin:3px 0 10px">C\'est cet hebergement que le domaine visera.</div>'
        + '<div style="display:grid;gap:6px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">'
        + '<button class="btn btn-primary" onclick="wsSetupDeploy()" style="' + col + '">'
        + '<span>▲ Une plateforme</span>'
        + '<span style="font-size:10px;font-weight:400;opacity:.85">Vercel, Netlify, Railway, Render, Cloudflare</span></button>'
        + '<button class="btn" onclick="srvOpen()" style="' + col + '">'
        + '<span>🖥️ Un serveur (SSH)</span>'
        + '<span style="font-size:10px;font-weight:400;color:var(--text-4)">VPS OVH, Hetzner, DigitalOcean...</span></button>'
        + '</div>'
        + '<div style="margin-top:8px"><button class="btn btn-xs" onclick="this.closest(\'#conn-paste-deploy\').style.display=\'none\'">Annuler</button></div>'
        + '</div>';
    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function wsPickHostingAccount() {
    const pasteEl = deployPasteEl();
    if (!pasteEl) return;

    // Fetch available accounts
    const accounts = await api('hosting/accounts');

    let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:12px">';
    html += '<div style="font-size:12px;font-weight:600;color:var(--violet);margin-bottom:10px">Choisir un compte d\'hebergement</div>';

    if (accounts.length === 0) {
        html += '<div style="font-size:11px;color:var(--text-3);margin-bottom:10px">Aucun compte enregistre. Ajoute-en un d\'abord.</div>';
    } else {
        for (const a of accounts) {
            const icon = (deployPlatform(a.platform) || {}).icon || '🌐';
        html += '<div onclick="wsSelectHostingAccount(\'' + a.id + '\')" style="padding:10px;border:1px solid var(--border-1);border-radius:8px;margin-bottom:6px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:all .15s" onmouseover="this.style.borderColor=\'var(--violet)\'" onmouseout="this.style.borderColor=\'var(--border-1)\'">'
                + '<div style="font-size:20px">' + icon + '</div>'
                + '<div style="flex:1">'
                + '<div style="font-size:12px;font-weight:600;color:var(--text-0)">' + (a.email || a.name) + '</div>'
                + '<div style="font-size:10px;color:var(--text-3)">' + a.platform + (a.username ? ' @' + a.username : '') + (a.projects?.length ? ' — ' + a.projects.length + ' projet(s)' : '') + '</div>'
                + '</div>'
                + '<span style="font-size:10px;color:' + (a.token_set ? 'var(--emerald)' : 'var(--rose)') + '">' + (a.token_set ? 'Token OK' : 'Expire') + '</span>'
                + '</div>';
        }
    }

    html += '<div style="margin-top:8px;border-top:1px solid var(--border-0);padding-top:8px">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px">Ajouter un nouveau compte</div>'
        + '<div style="font-size:10px;color:var(--text-4);margin-bottom:6px">1. Choisis la plateforme → 2. Genere un token → 3. Colle-le ici</div>'
        + '<div style="display:flex;gap:6px;margin-bottom:6px">'
        + '<select class="form-input" id="ha-platform" style="font-size:11px;padding:5px 8px;flex:1" onchange="document.getElementById(\'ha-token-link\').href=deployTokenUrl(this.value)">'
        + DEPLOY_PLATFORMS.map(function(p) { return '<option value="' + p.key + '">' + p.label + '</option>'; }).join('') + '</select>'
        + '<a id="ha-token-link" href="' + deployTokenUrl(DEPLOY_PLATFORMS[0].key) + '" target="_blank" class="btn btn-xs" style="flex-shrink:0;text-decoration:none">Generer un token</a>'
        + '</div>'
        + '<input class="form-input" id="ha-token" type="password" placeholder="Colle le token ici" style="font-size:11px;padding:5px 8px;margin-bottom:6px">'
        + '<div id="ha-status" style="font-size:10px;min-height:14px;margin-bottom:4px"></div>'
        + '<div class="flex gap-6">'
        + '<button class="btn btn-xs btn-primary" onclick="wsAddHostingAccount()">Verifier et ajouter</button>'
        + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-deploy\').style.display=\'none\'">Fermer</button>'
        + '</div></div></div>';

    pasteEl.innerHTML = html;
    pasteEl.style.display = 'block';
}

async function wsAddHostingAccount() {
    const platform = document.getElementById('ha-platform')?.value;
    const token = document.getElementById('ha-token')?.value.trim();
    const statusEl = document.getElementById('ha-status');
    if (!token) { toast('Colle le token', 'error'); return; }
    statusEl.innerHTML = '<span style="color:var(--text-3)">Verification du token...</span>';
    const r = await apiPost('hosting/accounts', {platform, token});
    if (r.success) {
        statusEl.innerHTML = '<span style="color:var(--emerald)">Compte verifie: ' + (r.email || r.name || '') + '</span>';
        toast('Compte "' + (r.name || r.email) + '" ajoute sur ' + platform);
        setTimeout(function() { wsPickHostingAccount(); }, 1000);
    } else {
        statusEl.innerHTML = '<span style="color:var(--rose)">' + (r.message || 'Erreur') + '</span>';
    }
}

async function wsSelectHostingAccount(accountId) {
    toast('Liaison en cours...');
    const r = await apiPost('projects/' + wsProjectId + '/hosting', {account_id: accountId});
    if (r.success) {
        toast('Projet lie au compte "' + r.account + '" sur ' + r.platform);
        loadWsConnections();
    } else {
        toast(r.message || 'Erreur', 'error');
    }
}

// Change hosting account — show picker to switch to a different account
function wsChangeHostingAccount() {
    wsSetupDeploy();
}

// Guided deploy setup — platform + account + URLs
async function wsSetupDeploy() {
    const pasteEl = deployPasteEl();
    if (!pasteEl) return;

    const platforms = DEPLOY_PLATFORMS;

    // Fetch current data + accounts in parallel
    const [connData, accounts] = await Promise.all([
        api('projects/' + wsProjectId + '/connections'),
        api('hosting/accounts')
    ]);
    const deploy = (connData.connections || []).find(function(c) { return c.type === 'deploy'; });
    const currentPlatform = deploy?.details?.plateforme || deploy?.details?.platform || '';
    const currentAccountId = deploy?.details?.account_id || '';
    const currentSiteUrl = deploy?.details?.site || '';
    const currentDashUrl = deploy?.details?.dashboard || '';

    // Also get account_id from component
    const comps = await api('projects/' + wsProjectId + '/components');
    const deployComp = (comps || []).find(function(c) { return c.component === 'deploy'; });
    const acctId = deployComp?.config?.account_id || currentAccountId;

    let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:14px">'
        + '<div style="font-size:13px;font-weight:700;color:var(--violet);margin-bottom:12px">Configurer le deploiement</div>';

    // Step 1: Platform
    html += '<div style="margin-bottom:12px">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:6px">1. Plateforme</div>'
        + '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px">';
    for (const p of platforms) {
        const sel = p.key === currentPlatform ? 'border:2px solid var(--violet)' : 'border:1px solid var(--border-1)';
        html += '<div onclick="wsDeployPickPlatform(\'' + p.key + '\')" class="deploy-plat" data-plat="' + p.key + '" '
            + 'style="padding:8px 4px;border-radius:6px;' + sel + ';cursor:pointer;text-align:center;transition:all .15s">'
            + '<div style="font-size:18px">' + p.icon + '</div>'
            + '<div style="font-size:10px;font-weight:600;color:var(--text-0)">' + p.label + '</div></div>';
    }
    html += '</div><input type="hidden" id="deploy-platform" value="' + currentPlatform + '"></div>';

    // Step 2: Account
    html += '<div style="margin-bottom:12px">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:6px">2. Compte</div>'
        + '<div id="deploy-accounts-list">';
    const filtered = accounts.filter(function(a) { return !currentPlatform || a.platform === currentPlatform; });
    if (filtered.length > 0) {
        for (const a of filtered) {
            const isCurrent = a.id === acctId;
            html += '<div onclick="document.querySelectorAll(\'.deploy-acct\').forEach(function(e){e.style.border=\'1px solid var(--border-1)\'});this.style.border=\'2px solid var(--violet)\';document.getElementById(\'deploy-account-id\').value=\'' + a.id + '\'" '
                + 'class="deploy-acct" style="padding:8px 10px;border-radius:6px;' + (isCurrent ? 'border:2px solid var(--violet)' : 'border:1px solid var(--border-1)') + ';cursor:pointer;margin-bottom:4px;display:flex;align-items:center;gap:8px;transition:all .15s">'
                + '<div style="flex:1"><div style="font-size:11px;font-weight:600;color:var(--text-0)">' + (a.email || a.name) + '</div>'
                + '<div style="font-size:9px;color:var(--text-4)">' + a.platform + (a.username ? ' @' + a.username : '') + '</div></div>'
                + '<span style="font-size:9px;color:' + (a.token_set ? 'var(--emerald)' : 'var(--rose)') + '">' + (a.token_set ? 'Token OK' : 'Expire') + '</span>'
                + '</div>';
        }
    } else {
        html += '<div style="font-size:10px;color:var(--text-4);margin-bottom:6px">Aucun compte pour cette plateforme</div>';
    }
    html += '</div><input type="hidden" id="deploy-account-id" value="' + acctId + '">'
        + '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-0)">'
        + '<div style="font-size:10px;font-weight:600;color:var(--text-3);margin-bottom:4px">Ajouter un nouveau compte</div>'
        + '<div style="display:flex;gap:4px">'
        + '<input class="form-input" id="deploy-new-token" type="password" placeholder="Coller le token" style="font-size:11px;padding:5px 8px;flex:1">'
        + '<button class="btn btn-xs" id="deploy-gen-link" onclick="window.open(deployTokenUrl(document.getElementById(\'deploy-platform\').value),\'_blank\')">Generer</button>'
        + '<button class="btn btn-xs btn-primary" onclick="wsDeployAddAccount()">Ajouter</button>'
        + '</div><div id="deploy-add-status" style="font-size:10px;min-height:14px;margin-top:4px"></div></div></div>';

    // Step 3: URLs
    html += '<div style="margin-bottom:12px">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">3. URLs</div>'
        + '<input class="form-input" id="deploy-site-url" value="' + (currentSiteUrl || '') + '" placeholder="https://mon-site.vercel.app" style="font-size:11px;padding:5px 8px;margin-bottom:4px">'
        + '<input class="form-input" id="deploy-dash-url" value="' + (currentDashUrl || '') + '" placeholder="https://vercel.com/user/projet (dashboard)" style="font-size:11px;padding:5px 8px">'
        + '</div>';

    html += '<div class="flex gap-6">'
        + '<button class="btn btn-xs btn-primary" onclick="wsSaveDeploy()">Enregistrer</button>'
        + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-deploy\').style.display=\'none\'">Annuler</button>'
        + '</div></div>';

    pasteEl.innerHTML = html;
    pasteEl.style.display = 'block';
    window._deployPlatforms = platforms;
    window._deployAccounts = accounts;
}

function wsDeployPickPlatform(plat) {
    document.querySelectorAll('.deploy-plat').forEach(function(e) { e.style.border = '1px solid var(--border-1)'; });
    var el = document.querySelector('.deploy-plat[data-plat="' + plat + '"]');
    if (el) el.style.border = '2px solid var(--violet)';
    document.getElementById('deploy-platform').value = plat;
    // Filter accounts by platform
    var accounts = window._deployAccounts || [];
    var filtered = accounts.filter(function(a) { return a.platform === plat; });
    var listEl = document.getElementById('deploy-accounts-list');
    var html = '';
    if (filtered.length > 0) {
        for (var i = 0; i < filtered.length; i++) {
            var a = filtered[i];
            html += '<div onclick="document.querySelectorAll(\'.deploy-acct\').forEach(function(e){e.style.border=\'1px solid var(--border-1)\'});this.style.border=\'2px solid var(--violet)\';document.getElementById(\'deploy-account-id\').value=\'' + a.id + '\'" '
                + 'class="deploy-acct" style="padding:8px 10px;border-radius:6px;border:1px solid var(--border-1);cursor:pointer;margin-bottom:4px;display:flex;align-items:center;gap:8px;transition:all .15s">'
                + '<div style="flex:1"><div style="font-size:11px;font-weight:600;color:var(--text-0)">' + (a.email || a.name) + '</div>'
                + '<div style="font-size:9px;color:var(--text-4)">' + a.platform + (a.username ? ' @' + a.username : '') + '</div></div>'
                + '<span style="font-size:9px;color:' + (a.token_set ? 'var(--emerald)' : 'var(--rose)') + '">' + (a.token_set ? 'Token OK' : 'Expire') + '</span>'
                + '</div>';
        }
    } else {
        html += '<div style="font-size:10px;color:var(--text-4);margin-bottom:6px">Aucun compte pour ' + plat + '</div>';
    }
    listEl.innerHTML = html;
    document.getElementById('deploy-account-id').value = '';
}

async function wsDeployAddAccount() {
    var platform = document.getElementById('deploy-platform').value;
    var token = document.getElementById('deploy-new-token').value.trim();
    var statusEl = document.getElementById('deploy-add-status');
    if (!platform) { toast('Choisis une plateforme', 'error'); return; }
    if (!token) { toast('Colle le token', 'error'); return; }
    statusEl.innerHTML = '<span style="color:var(--text-3)">Verification...</span>';
    var r = await apiPost('hosting/accounts', {platform: platform, token: token});
    if (r.success) {
        statusEl.innerHTML = '<span style="color:var(--emerald)">Compte verifie: ' + (r.email || r.name || '') + '</span>';
        toast('Compte ajoute');
        setTimeout(function() { wsSetupDeploy(); }, 800);
    } else {
        statusEl.innerHTML = '<span style="color:var(--rose)">' + (r.message || 'Token invalide') + '</span>';
    }
}

async function wsSaveDeploy() {
    var platform = document.getElementById('deploy-platform').value;
    var accountId = document.getElementById('deploy-account-id').value;
    var siteUrl = document.getElementById('deploy-site-url').value.trim();
    var dashUrl = document.getElementById('deploy-dash-url').value.trim();
    if (!platform) { toast('Choisis une plateforme', 'error'); return; }

    // Link account if selected
    if (accountId) {
        await apiPost('projects/' + wsProjectId + '/hosting', {account_id: accountId, site_url: siteUrl, project_url: dashUrl});
    }
    // Save URLs + platform
    await apiPost('projects/' + wsProjectId + '/connections', {
        type: 'deploy',
        config: {platform: platform, site_url: siteUrl, project_url: dashUrl}
    });
    toast('Deploiement configure');
    document.getElementById('conn-paste-deploy').style.display = 'none';
    loadWsConnections();
}

// Regen token — open token page then show paste input for new token
function wsRegenToken(tokenPageUrl) {
    if (tokenPageUrl) window.open(tokenPageUrl, '_blank');
    const pasteEl = deployPasteEl();
    if (!pasteEl) return;
    pasteEl.innerHTML = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:12px">'
        + '<div style="font-size:12px;font-weight:600;color:var(--violet);margin-bottom:6px">Coller le nouveau token</div>'
        + '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Genere un token sur la page qui vient de s\'ouvrir, puis colle-le ici</div>'
        + '<input class="form-input" id="regen-token-input" type="password" placeholder="Coller le nouveau token ici" style="font-size:12px;padding:6px 8px;margin-bottom:8px">'
        + '<div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="wsSaveRegenToken()">Enregistrer</button>'
        + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-deploy\').style.display=\'none\'">Annuler</button></div></div>';
    pasteEl.style.display = 'block';
    setTimeout(function() { document.getElementById('regen-token-input')?.focus(); }, 100);
}

async function wsSaveRegenToken() {
    const token = document.getElementById('regen-token-input')?.value.trim();
    if (!token) { toast('Colle le token', 'error'); return; }
    // Get the account_id from the deploy component
    const conns = await api('projects/' + wsProjectId + '/connections');
    const deploy = (conns.connections || []).find(function(c) { return c.type === 'deploy'; });
    if (!deploy) { toast('Pas de compte lie', 'error'); return; }
    // Find account_id from project component
    const comps = await api('projects/' + wsProjectId + '/components');
    const deployComp = comps.find(function(c) { return c.component === 'deploy'; });
    const accountId = deployComp?.config?.account_id;
    if (!accountId) { toast('Pas de compte lie', 'error'); return; }
    // Update the account token
    await apiJson('PUT', 'hosting/accounts/' + accountId, {token: token});
    toast('Token mis a jour');
    document.getElementById('conn-paste-deploy').style.display = 'none';
    loadWsConnections();
}

// Enter site URL after deploying on the platform
function wsEnterSiteUrl() {
    const pasteEl = deployPasteEl();
    if (!pasteEl) return;
    pasteEl.innerHTML = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:12px">'
        + '<div style="font-size:12px;font-weight:600;color:var(--violet);margin-bottom:6px">Entrer l\'URL du site deploye</div>'
        + '<input class="form-input" id="site-url-input" placeholder="https://mon-site.vercel.app" style="font-size:12px;padding:6px 8px;margin-bottom:6px">'
        + '<input class="form-input" id="project-url-input" placeholder="https://vercel.com/user/projet (dashboard, optionnel)" style="font-size:12px;padding:6px 8px;margin-bottom:8px">'
        + '<div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="wsSaveSiteUrl()">Enregistrer</button>'
        + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-deploy\').style.display=\'none\'">Annuler</button></div></div>';
    pasteEl.style.display = 'block';
    setTimeout(function() { document.getElementById('site-url-input')?.focus(); }, 100);
}

async function wsSaveSiteUrl() {
    const siteUrl = document.getElementById('site-url-input')?.value.trim();
    const projectUrl = document.getElementById('project-url-input')?.value.trim();
    if (!siteUrl) { toast('Entre l\'URL du site', 'error'); return; }
    const config = {site_url: siteUrl};
    if (projectUrl) config.project_url = projectUrl;
    await apiPost('projects/' + wsProjectId + '/connections', {type: 'deploy', config: config});
    toast('URL du site enregistree');
    loadWsConnections();
}

// Setup server
function wsSetupServer() {
    const pasteEl = document.getElementById('conn-paste-server');
    if (!pasteEl) return;

    const providers = [
        {key:'ovh', label:'OVH / OVHcloud', dashboard:'https://www.ovh.com/manager/#/dedicated/vps'},
        {key:'digitalocean', label:'DigitalOcean', dashboard:'https://cloud.digitalocean.com/droplets'},
        {key:'hetzner', label:'Hetzner', dashboard:'https://console.hetzner.cloud/'},
        {key:'contabo', label:'Contabo', dashboard:'https://my.contabo.com/'},
        {key:'scaleway', label:'Scaleway', dashboard:'https://console.scaleway.com/'},
        {key:'aws', label:'AWS EC2', dashboard:'https://console.aws.amazon.com/ec2/'},
        {key:'other', label:'Autre', dashboard:''},
    ];

    // Pre-fill from existing config
    api('projects/' + wsProjectId + '/connections').then(function(data) {
        const srv = (data.connections || []).find(function(c) { return c.type === 'server'; });
        const d = srv?.details || {};

        let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:14px">'
            + '<div style="font-size:13px;font-weight:700;color:var(--violet);margin-bottom:12px">Configurer le serveur</div>'

            // IP
            + '<div style="margin-bottom:10px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">Adresse IP du serveur</div>'
            + '<input class="form-input" id="srv-ip" value="' + (d.IP || '') + '" placeholder="203.0.113.10" style="font-size:12px;padding:6px 8px">'
            + '</div>'

            // Provider
            + '<div style="margin-bottom:10px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">Provider</div>'
            + '<select class="form-input" id="srv-provider" style="font-size:12px;padding:6px 8px">';
        for (const p of providers) {
            html += '<option value="' + p.key + '"' + ((d.provider || '').toLowerCase() === p.key ? ' selected' : '') + '>' + p.label + '</option>';
        }
        html += '</select></div>'

            // SSH user
            + '<div style="margin-bottom:10px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">Utilisateur SSH</div>'
            + '<input class="form-input" id="srv-ssh" value="' + (d.SSH ? d.SSH.split('@')[0] : '') + '" placeholder="root ou ubuntu" style="font-size:12px;padding:6px 8px">'
            + '</div>'

            // SSH Key selector
            + '<div style="margin-bottom:10px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">Cle SSH</div>'
            + '<select class="form-input" id="srv-key" style="font-size:12px;padding:6px 8px">'
            + '<option value="">Automatique</option></select>'
            + '</div>'

            // Dashboard URL
            + '<div style="margin-bottom:10px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">Lien direct vers le dashboard du serveur</div>'
            + '<input class="form-input" id="srv-dashboard" value="' + (srv?.url || '') + '" placeholder="https://www.ovh.com/manager/#/dedicated/vps/..." style="font-size:11px;padding:5px 8px">'
            + '</div>'

            // Status
            + '<div id="srv-status" style="font-size:11px;min-height:16px;margin-bottom:10px"></div>'

            // Quick links
            + '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">';
        for (const p of providers) {
            if (p.dashboard) html += '<button class="btn btn-xs" onclick="window.open(\'' + p.dashboard + '\',\'_blank\')" style="font-size:9px">' + p.label + '</button>';
        }
        html += '</div>'

            + '<div class="flex gap-6">'
            + '<button class="btn btn-xs btn-primary" onclick="wsSaveServer()">Tester et enregistrer</button>'
            + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-server\').style.display=\'none\'">Annuler</button>'
            + '</div></div>';

        pasteEl.innerHTML = html;
        pasteEl.style.display = 'block';

        // Load SSH keys into selector
        api('server/keys').then(function(keys) {
            const sel = document.getElementById('srv-key');
            if (!sel) return;
            const savedKey = (srv?.details?.ssh_key) || '';
            for (const k of keys) {
                const opt = document.createElement('option');
                opt.value = k.path;
                opt.textContent = k.name + ' (' + k.path + ')';
                if (k.path === savedKey) opt.selected = true;
                sel.appendChild(opt);
            }
        });

        setTimeout(function() { document.getElementById('srv-ip')?.focus(); }, 100);
    });
}

async function wsSaveServer() {
    const ip = document.getElementById('srv-ip')?.value.trim();
    if (!ip) { toast('Entre l\'adresse IP', 'error'); return; }
    const provider = document.getElementById('srv-provider')?.value || '';
    const ssh_user = document.getElementById('srv-ssh')?.value.trim() || 'root';
    const ssh_key = document.getElementById('srv-key')?.value || '';
    const dashboard = document.getElementById('srv-dashboard')?.value.trim() || '';

    // Test SSH first
    const statusEl = document.getElementById('srv-status');
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-3)">Test de connexion SSH...</span>';

    const test = await apiPost('server/test', {ip: ip, ssh_user: ssh_user, ssh_key: ssh_key});

    if (test.success) {
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--emerald)">Connecte — ' + (test.hostname || ip) + (test.uptime ? ' (' + test.uptime + ')' : '') + '</span>';

        await apiPost('projects/' + wsProjectId + '/connections', {
            type: 'server',
            config: {ip: ip, provider: provider, ssh_user: ssh_user, ssh_key: ssh_key, dashboard_url: dashboard, ssh_verified: true, hostname: test.hostname || ''}
        });
        toast('Serveur ' + ip + ' connecte');
        setTimeout(function() { loadWsConnections(); }, 1500);
    } else {
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--rose)">' + (test.message || 'Connexion echouee') + '</span>';
        // Save anyway but mark as not verified
        const saveAnyway = confirm('La connexion SSH a echoue. Enregistrer quand meme les infos ?');
        if (saveAnyway) {
            await apiPost('projects/' + wsProjectId + '/connections', {
                type: 'server',
                config: {ip: ip, provider: provider, ssh_user: ssh_user, ssh_key: ssh_key, dashboard_url: dashboard, ssh_verified: false}
            });
            toast('Serveur enregistre (non verifie)');
            loadWsConnections();
        }
    }
}

// Setup email
function wsSetupEmail() {
    const pasteEl = document.getElementById('conn-paste-email');
    if (!pasteEl) return;

    const providers = [
        {key:'google', label:'Google Workspace', price:'6€/mois', buy:'https://workspace.google.com/pricing'},
        {key:'zoho', label:'Zoho Mail', price:'Gratuit (1 user)', buy:'https://www.zoho.com/mail/zohomail-pricing.html'},
        {key:'ovh', label:'OVH Email', price:'~1€/mois', buy:'https://www.ovh.com/fr/emails/'},
        {key:'infomaniak', label:'Infomaniak', price:'~1.5€/mois', buy:'https://www.infomaniak.com/fr/hebergement/service-mail'},
        {key:'protonmail', label:'Proton Mail', price:'4€/mois', buy:'https://proton.me/business'},
    ];

    // Get domain for suggestion
    let domainSuffix = '';
    api('projects/' + wsProjectId + '/connections').then(function(data) {
        const dom = (data.connections || []).find(function(c) { return c.type === 'domain' && c.status !== 'non_connecte'; });
        if (dom) domainSuffix = dom.label;
        const emailConn = (data.connections || []).find(function(c) { return c.type === 'email'; });

        let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:14px">'
            + '<div style="font-size:13px;font-weight:700;color:var(--violet);margin-bottom:12px">Configurer email professionnel</div>';

        // Step 1: Provider
        html += '<div style="margin-bottom:10px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:6px">1. Chez quel provider ?</div>'
            + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">';
        for (const p of providers) {
            html += '<div onclick="document.querySelectorAll(\'.email-prov\').forEach(e=>e.style.border=\'1px solid var(--border-1)\');this.style.border=\'2px solid var(--violet)\';document.getElementById(\'email-provider\').value=\'' + p.key + '\'" '
                + 'class="email-prov" style="padding:8px;border-radius:6px;border:1px solid var(--border-1);cursor:pointer;text-align:center;transition:all .15s">'
                + '<div style="font-size:11px;font-weight:600;color:var(--text-0)">' + p.label + '</div>'
                + '<div style="font-size:9px;color:var(--text-4)">' + p.price + '</div></div>';
        }
        html += '</div><input type="hidden" id="email-provider" value="' + (emailConn?.details?.provider || '') + '"></div>';

        // Step 2: Email addresses
        html += '<div style="margin-bottom:10px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">2. Adresses email creees</div>'
            + '<input class="form-input" id="email-addresses" value="' + (emailConn?.details?.adresses || '') + '" placeholder="contact@' + (domainSuffix || 'example.com') + ', info@' + (domainSuffix || 'example.com') + '" style="font-size:12px;padding:6px 8px">'
            + '<div style="font-size:9px;color:var(--text-4);margin-top:2px">Separe par des virgules</div></div>';

        // Step 3: Dashboard URL
        html += '<div style="margin-bottom:10px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">3. Liens de gestion</div>'
            + '<input class="form-input" id="email-dashboard" placeholder="URL dashboard admin" style="font-size:11px;padding:5px 8px;margin-bottom:4px">'
            + '<input class="form-input" id="email-webmail" placeholder="URL webmail (pour lire les emails)" style="font-size:11px;padding:5px 8px">'
            + '</div>';

        // Step 4: MX records
        html += '<div style="margin-bottom:10px;padding:8px;background:var(--bg-1);border-radius:6px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">4. Records MX dans le DNS</div>'
            + '<div style="font-size:10px;color:var(--text-3);margin-bottom:4px">Pour recevoir les emails, ajoute les records MX dans la page DNS de ton domaine</div>'
            + '<div style="display:flex;align-items:center;gap:6px">'
            + '<input type="checkbox" id="email-mx-ok" style="accent-color:var(--emerald)">'
            + '<label for="email-mx-ok" style="font-size:11px;color:var(--text-2);cursor:pointer">MX configures dans le DNS</label>'
            + '</div></div>';

        // Buttons to open providers
        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">';
        for (const p of providers) {
            html += '<button class="btn btn-xs" onclick="window.open(\'' + p.buy + '\',\'_blank\')" style="font-size:9px">' + p.label + '</button>';
        }
        html += '</div>';

        html += '<div class="flex gap-6">'
            + '<button class="btn btn-xs btn-primary" onclick="wsSaveEmail()">Enregistrer</button>'
            + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-email\').style.display=\'none\'">Annuler</button>'
            + '</div></div>';

        pasteEl.innerHTML = html;
        pasteEl.style.display = 'block';
    });
}

async function wsSaveEmail() {
    const provider = document.getElementById('email-provider')?.value || '';
    const addresses = document.getElementById('email-addresses')?.value.trim() || '';
    const dashboard = document.getElementById('email-dashboard')?.value.trim() || '';
    const webmail = document.getElementById('email-webmail')?.value.trim() || '';
    const mxOk = document.getElementById('email-mx-ok')?.checked || false;

    if (!provider) { toast('Choisis un provider', 'error'); return; }

    await apiPost('projects/' + wsProjectId + '/connections', {
        type: 'email',
        config: {provider: provider, addresses: addresses, dashboard_url: dashboard, webmail_url: webmail, mx_configured: mxOk}
    });
    toast('Email configure');
    loadWsConnections();
}

// Setup domain name
function wsSetupDomain() {
    const pasteEl = document.getElementById('conn-paste-domain');
    if (!pasteEl) return;

    const registrars = [
        {key:'cloudflare', label:'Cloudflare', dns_hint:'dash.cloudflare.com/ACCOUNT_ID/DOMAINE/dns'},
        {key:'namecheap', label:'Namecheap', dns_hint:'ap.www.namecheap.com/domains/domaincontrolpanel/DOMAINE/advancedns'},
        {key:'ovh', label:'OVH / OVHcloud', dns_hint:'www.ovh.com/manager/#/web/domain/DOMAINE/zone'},
        {key:'godaddy', label:'GoDaddy', dns_hint:'dcc.godaddy.com/manage/DOMAINE/dns'},
        {key:'google', label:'Google Domains', dns_hint:'domains.google.com/registrar/DOMAINE/dns'},
        {key:'ionos', label:'IONOS', dns_hint:'my.ionos.com/domains/DOMAINE'},
        {key:'other', label:'Autre'},
    ];

    let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:14px">'
        + '<div style="font-size:13px;font-weight:700;color:var(--violet);margin-bottom:12px">Configurer le nom de domaine</div>'

        // Step 1: Domain name
        + '<div style="margin-bottom:12px">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">1. Nom de domaine</div>'
        + '<input class="form-input" id="dom-name" placeholder="mon-client.ma" style="font-size:12px;padding:6px 8px">'
        + '</div>'

        // Step 2: Registrar
        + '<div style="margin-bottom:12px">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">2. Achete chez quel registrar ?</div>'
        + '<select class="form-input" id="dom-registrar" onchange="wsUpdateDnsDashHint()" style="font-size:12px;padding:6px 8px">';
    for (const r of registrars) {
        html += '<option value="' + r.key + '">' + r.label + '</option>';
    }
    html += '</select></div>'

        // Step 3: Direct DNS link
        + '<div style="margin-bottom:12px">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">3. Lien direct vers la page DNS du domaine</div>'
        + '<div style="font-size:10px;color:var(--text-3);margin-bottom:4px" id="dom-dns-hint">Ouvre ton registrar → va sur la page DNS de ton domaine → copie l\'URL de cette page</div>'
        + '<input class="form-input" id="dom-dashboard" placeholder="https://..." style="font-size:12px;padding:6px 8px">'
        + '<div style="font-size:9px;color:var(--text-4);margin-top:2px">Ce lien te ramenera directement a la page DNS pour modifier les records</div>'
        + '</div>'

        // Step 4: SSL
        + '<div style="margin-bottom:12px">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">4. SSL</div>'
        + '<select class="form-input" id="dom-ssl" style="font-size:12px;padding:6px 8px">'
        + '<option value="auto">Automatique (via hosting)</option>'
        + '<option value="letsencrypt">Let\'s Encrypt</option>'
        + '<option value="cloudflare">Cloudflare (proxy)</option>'
        + '</select></div>'

        // Step 5: DNS status
        + '<div style="margin-bottom:12px;padding:10px;border-radius:6px;background:var(--bg-1);border:1px solid var(--border-0)">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:6px">5. DNS configure ?</div>'
        + '<div style="display:flex;gap:8px">'
        + '<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-2);cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid var(--border-1)">'
        + '<input type="radio" name="dom-dns-status" value="no" checked style="accent-color:var(--violet)"> Pas encore</label>'
        + '<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text-2);cursor:pointer;padding:4px 10px;border-radius:6px;border:1px solid var(--border-1)">'
        + '<input type="radio" name="dom-dns-status" value="yes" style="accent-color:var(--emerald)"> Oui, DNS pointe vers le hosting</label>'
        + '</div></div>'

        + '<div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="wsSaveDomain()">Enregistrer</button>'
        + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-domain\').style.display=\'none\'">Annuler</button></div></div>';

    pasteEl.innerHTML = html;
    pasteEl.style.display = 'block';
    window._domRegistrars = registrars;

    // Pre-fill if domain exists
    api('projects/' + wsProjectId + '/connections').then(function(data) {
        const dom = (data.connections || []).find(function(c) { return c.type === 'domain'; });
        if (dom && dom.details) {
            const nameEl = document.getElementById('dom-name');
            if (nameEl && dom.label && dom.label !== 'Nom de domaine') nameEl.value = dom.label;
            const regEl = document.getElementById('dom-registrar');
            if (regEl && dom.details.registrar && dom.details.registrar !== 'non renseigne') {
                for (const opt of regEl.options) { if (opt.value === dom.details.registrar) opt.selected = true; }
            }
            const dashEl = document.getElementById('dom-dashboard');
            if (dashEl && dom.details.dashboard_url) dashEl.value = dom.details.dashboard_url;
        }
        wsUpdateDnsDashHint();
    });
    setTimeout(function() { document.getElementById('dom-name')?.focus(); }, 100);
}

function wsUpdateDnsDashHint() {
    const regSel = document.getElementById('dom-registrar');
    const hintEl = document.getElementById('dom-dns-hint');
    const dashEl = document.getElementById('dom-dashboard');
    if (!regSel || !hintEl) return;
    const reg = (window._domRegistrars || []).find(function(r) { return r.key === regSel.value; });
    if (reg && reg.dns_hint) {
        const domain = document.getElementById('dom-name')?.value.trim() || 'DOMAINE';
        const example = reg.dns_hint.replace(/DOMAINE/g, domain);
        hintEl.innerHTML = 'Ouvre <b>' + reg.label + '</b> → va sur la page DNS de ton domaine → copie l\'URL<br>'
            + '<span style="color:var(--text-4)">Exemple: https://' + example + '</span>';
        if (!dashEl.value) dashEl.placeholder = 'https://' + example;
    } else {
        hintEl.textContent = 'Ouvre ton registrar → va sur la page DNS de ton domaine → copie l\'URL';
    }
}

async function wsSaveDomain() {
    const domain = document.getElementById('dom-name')?.value.trim();
    if (!domain) { toast('Entre le nom de domaine', 'error'); return; }
    const registrar = document.getElementById('dom-registrar')?.value || '';
    const ssl = document.getElementById('dom-ssl')?.value || '';
    const dashboard = document.getElementById('dom-dashboard')?.value.trim() || '';
    const dnsStatus = document.querySelector('input[name="dom-dns-status"]:checked')?.value || 'no';

    await apiPost('projects/' + wsProjectId + '/connections', {
        type: 'domain',
        config: {domain: domain, registrar: registrar, ssl: ssl, dashboard_url: dashboard, dns_configured: dnsStatus === 'yes'}
    });
    toast('Domaine "' + domain + '" enregistre');
    loadWsConnections();
}

// Guided database setup
function wsSetupDatabase() {
    const pasteEl = document.getElementById('conn-paste-database');
    if (!pasteEl) return;

    const providers = [
        {key:'supabase', label:'Supabase', port:'5432', hint:'db.xyz.supabase.co', buy:'https://supabase.com/dashboard'},
        {key:'neon', label:'Neon', port:'5432', hint:'ep-xxx.us-east-2.aws.neon.tech', buy:'https://console.neon.tech/'},
        {key:'planetscale', label:'PlanetScale', port:'3306', hint:'aws.connect.psdb.cloud', buy:'https://app.planetscale.com/'},
        {key:'railway', label:'Railway', port:'5432', hint:'roundhouse.proxy.rlwy.net', buy:'https://railway.app/'},
        {key:'postgres', label:'PostgreSQL local', port:'5432', hint:'localhost'},
        {key:'mysql', label:'MySQL local', port:'3306', hint:'localhost'},
        {key:'sqlite', label:'SQLite', port:'', hint:''},
    ];

    api('projects/' + wsProjectId + '/connections').then(function(data) {
        const dbConn = (data.connections || []).find(function(c) { return c.type === 'database'; });
        const cur = dbConn?.details || {};

        let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:14px">'
            + '<div style="font-size:13px;font-weight:700;color:var(--violet);margin-bottom:12px">Configurer la base de donnees</div>';

        // Step 1: Provider
        html += '<div style="margin-bottom:12px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:6px">1. Provider</div>'
            + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px">';
        for (const p of providers) {
            const sel = (cur.type === p.key || cur.provider === p.key) ? 'border:2px solid var(--violet)' : 'border:1px solid var(--border-1)';
            html += '<div onclick="wsDbPickProvider(\'' + p.key + '\')" class="db-prov" data-prov="' + p.key + '" '
                + 'style="padding:8px 4px;border-radius:6px;' + sel + ';cursor:pointer;text-align:center;transition:all .15s">'
                + '<div style="font-size:11px;font-weight:600;color:var(--text-0)">' + p.label + '</div></div>';
        }
        html += '</div><input type="hidden" id="db-provider" value="' + (cur.type || cur.provider || '') + '"></div>';

        // Step 2: Connection
        html += '<div id="db-fields" style="margin-bottom:12px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">2. Connexion</div>'
            + '<div style="display:grid;grid-template-columns:3fr 1fr;gap:4px;margin-bottom:4px">'
            + '<input class="form-input" id="db-host" value="' + (cur.host || '') + '" placeholder="Host" style="font-size:11px;padding:5px 8px">'
            + '<input class="form-input" id="db-port" value="' + (cur.port || '') + '" placeholder="Port" style="font-size:11px;padding:5px 8px">'
            + '</div>'
            + '<input class="form-input" id="db-name" value="' + (cur.nom || cur.name || '') + '" placeholder="Nom de la base" style="font-size:11px;padding:5px 8px;margin-bottom:4px">'
            + '<input class="form-input" id="db-connstring" type="password" placeholder="Connection string (optionnel)" style="font-size:11px;padding:5px 8px">'
            + '</div>';

        // Step 3: Dashboard
        html += '<div style="margin-bottom:12px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">3. Dashboard (optionnel)</div>'
            + '<input class="form-input" id="db-dashboard" placeholder="https://supabase.com/dashboard/..." style="font-size:11px;padding:5px 8px">'
            + '</div>';

        html += '<div class="flex gap-6">'
            + '<button class="btn btn-xs btn-primary" onclick="wsSaveDatabase()">Enregistrer</button>'
            + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-database\').style.display=\'none\'">Annuler</button>'
            + '</div></div>';

        pasteEl.innerHTML = html;
        pasteEl.style.display = 'block';
        window._dbProviders = providers;
    });
}

function wsDbPickProvider(prov) {
    document.querySelectorAll('.db-prov').forEach(function(e) { e.style.border = '1px solid var(--border-1)'; });
    var el = document.querySelector('.db-prov[data-prov="' + prov + '"]');
    if (el) el.style.border = '2px solid var(--violet)';
    document.getElementById('db-provider').value = prov;
    var p = (window._dbProviders || []).find(function(x) { return x.key === prov; });
    if (p) {
        var hostEl = document.getElementById('db-host');
        var portEl = document.getElementById('db-port');
        if (!hostEl.value) hostEl.placeholder = p.hint || 'Host';
        if (!portEl.value && p.port) portEl.value = p.port;
        if (p.buy) {
            var dashEl = document.getElementById('db-dashboard');
            if (!dashEl.value) dashEl.placeholder = p.buy + '/...';
        }
    }
    // Hide fields for SQLite
    var fieldsEl = document.getElementById('db-fields');
    if (prov === 'sqlite') {
        fieldsEl.innerHTML = '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">2. Fichier</div>'
            + '<input class="form-input" id="db-host" placeholder="./data/database.sqlite" style="font-size:11px;padding:5px 8px">'
            + '<input type="hidden" id="db-port" value=""><input type="hidden" id="db-name" value=""><input type="hidden" id="db-connstring" value="">';
    }
}

async function wsSaveDatabase() {
    var provider = document.getElementById('db-provider').value;
    if (!provider) { toast('Choisis un provider', 'error'); return; }
    var host = document.getElementById('db-host').value.trim();
    var port = document.getElementById('db-port').value.trim();
    var name = document.getElementById('db-name').value.trim();
    var connStr = document.getElementById('db-connstring').value.trim();
    var dashboard = document.getElementById('db-dashboard').value.trim();

    await apiPost('projects/' + wsProjectId + '/connections', {
        type: 'database',
        config: {type: provider, provider: provider, host: host, port: port, name: name, connection_string: connStr || undefined, dashboard_url: dashboard || undefined}
    });
    toast('Base de donnees configuree');
    document.getElementById('conn-paste-database').style.display = 'none';
    loadWsConnections();
}

// Guided storage setup
function wsSetupStorage() {
    const pasteEl = document.getElementById('conn-paste-storage');
    if (!pasteEl) return;

    const providers = [
        {key:'r2', label:'Cloudflare R2', buy:'https://dash.cloudflare.com/'},
        {key:'s3', label:'AWS S3', buy:'https://s3.console.aws.amazon.com/'},
        {key:'other', label:'Autre'},
    ];

    api('projects/' + wsProjectId + '/connections').then(function(data) {
        const storageConn = (data.connections || []).find(function(c) { return c.type === 'storage'; });
        const cur = storageConn?.details || {};

        let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:14px">'
            + '<div style="font-size:13px;font-weight:700;color:var(--violet);margin-bottom:12px">Configurer le stockage</div>';

        // Step 1: Provider
        html += '<div style="margin-bottom:12px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:6px">1. Provider</div>'
            + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">';
        for (const p of providers) {
            html += '<div onclick="document.querySelectorAll(\'.storage-prov\').forEach(function(e){e.style.border=\'1px solid var(--border-1)\'});this.style.border=\'2px solid var(--violet)\';document.getElementById(\'storage-provider\').value=\'' + p.key + '\'" '
                + 'class="storage-prov" style="padding:10px 4px;border-radius:6px;border:1px solid var(--border-1);cursor:pointer;text-align:center;transition:all .15s">'
                + '<div style="font-size:11px;font-weight:600;color:var(--text-0)">' + p.label + '</div></div>';
        }
        html += '</div><input type="hidden" id="storage-provider" value=""></div>';

        // Step 2: Bucket
        html += '<div style="margin-bottom:12px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">2. Nom du bucket</div>'
            + '<input class="form-input" id="storage-bucket" value="' + (cur.bucket || '') + '" placeholder="mon-projet-uploads" style="font-size:12px;padding:6px 8px">'
            + '</div>';

        // Step 3: Dashboard
        html += '<div style="margin-bottom:12px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">3. Dashboard (optionnel)</div>'
            + '<input class="form-input" id="storage-dashboard" placeholder="https://dash.cloudflare.com/..." style="font-size:11px;padding:5px 8px">'
            + '</div>';

        html += '<div class="flex gap-6">'
            + '<button class="btn btn-xs btn-primary" onclick="wsSaveStorage()">Enregistrer</button>'
            + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-storage\').style.display=\'none\'">Annuler</button>'
            + '</div></div>';

        pasteEl.innerHTML = html;
        pasteEl.style.display = 'block';
    });
}

async function wsSaveStorage() {
    var bucket = document.getElementById('storage-bucket').value.trim();
    var dashboard = document.getElementById('storage-dashboard').value.trim();
    if (!bucket) { toast('Entre le nom du bucket', 'error'); return; }
    await apiPost('projects/' + wsProjectId + '/connections', {
        type: 'storage',
        config: {bucket: bucket, dashboard_url: dashboard || undefined}
    });
    toast('Stockage configure');
    document.getElementById('conn-paste-storage').style.display = 'none';
    loadWsConnections();
}

// Guided backup setup
function wsSetupBackup() {
    const pasteEl = document.getElementById('conn-paste-backup');
    if (!pasteEl) return;

    api('projects/' + wsProjectId + '/connections').then(function(data) {
        const backupConn = (data.connections || []).find(function(c) { return c.type === 'backup'; });
        const cur = backupConn?.details || {};

        let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:14px">'
            + '<div style="font-size:13px;font-weight:700;color:var(--violet);margin-bottom:12px">Configurer les backups</div>';

        // Step 1: Destination
        html += '<div style="margin-bottom:12px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:6px">1. Destination</div>'
            + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">';
        for (const d of [{key:'r2',label:'Cloudflare R2'},{key:'s3',label:'AWS S3'},{key:'local',label:'Local'}]) {
            html += '<div onclick="document.querySelectorAll(\'.backup-dest\').forEach(function(e){e.style.border=\'1px solid var(--border-1)\'});this.style.border=\'2px solid var(--violet)\';document.getElementById(\'backup-destination\').value=\'' + d.key + '\';document.getElementById(\'backup-bucket-row\').style.display=\'' + (d.key==='local'?'none':'block') + '\'" '
                + 'class="backup-dest" style="padding:10px 4px;border-radius:6px;border:1px solid var(--border-1);cursor:pointer;text-align:center;transition:all .15s">'
                + '<div style="font-size:11px;font-weight:600;color:var(--text-0)">' + d.label + '</div></div>';
        }
        html += '</div><input type="hidden" id="backup-destination" value=""></div>';

        // Step 2: Bucket
        html += '<div id="backup-bucket-row" style="margin-bottom:12px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:4px">2. Bucket</div>'
            + '<input class="form-input" id="backup-bucket" value="' + (cur.bucket || '') + '" placeholder="mon-projet-backups" style="font-size:12px;padding:6px 8px">'
            + '</div>';

        // Step 3: Frequency
        html += '<div style="margin-bottom:12px">'
            + '<div style="font-size:11px;font-weight:600;color:var(--text-1);margin-bottom:6px">3. Frequence</div>'
            + '<div style="display:flex;gap:6px">';
        for (const f of [{key:'daily',label:'Quotidien'},{key:'weekly',label:'Hebdomadaire'},{key:'manual',label:'Manuel'}]) {
            const sel = cur.frequence === f.key ? 'border:2px solid var(--violet)' : 'border:1px solid var(--border-1)';
            html += '<div onclick="document.querySelectorAll(\'.backup-freq\').forEach(function(e){e.style.border=\'1px solid var(--border-1)\'});this.style.border=\'2px solid var(--violet)\';document.getElementById(\'backup-frequency\').value=\'' + f.key + '\'" '
                + 'class="backup-freq" style="padding:6px 14px;border-radius:6px;' + sel + ';cursor:pointer;font-size:11px;font-weight:600;color:var(--text-0);transition:all .15s">' + f.label + '</div>';
        }
        html += '</div><input type="hidden" id="backup-frequency" value="' + (cur.frequence || '') + '"></div>';

        html += '<div class="flex gap-6">'
            + '<button class="btn btn-xs btn-primary" onclick="wsSaveBackup()">Enregistrer</button>'
            + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-backup\').style.display=\'none\'">Annuler</button>'
            + '</div></div>';

        pasteEl.innerHTML = html;
        pasteEl.style.display = 'block';
    });
}

async function wsSaveBackup() {
    var dest = document.getElementById('backup-destination').value;
    var bucket = document.getElementById('backup-bucket').value.trim();
    var freq = document.getElementById('backup-frequency').value;
    if (!dest) { toast('Choisis une destination', 'error'); return; }
    await apiPost('projects/' + wsProjectId + '/connections', {
        type: 'backup',
        config: {destination: dest, bucket: bucket || undefined, frequency: freq || undefined}
    });
    toast('Backup configure');
    document.getElementById('conn-paste-backup').style.display = 'none';
    loadWsConnections();
}

function wsShowDns() {
    const pasteEl = document.getElementById('conn-paste-domain');
    if (!pasteEl) return;

    // Get hosting platform from connections
    const dnsRecords = {
        vercel: {type:'CNAME', name:'@', value:'cname.vercel-dns.com', alt:'A record: 76.76.21.21', www:'CNAME → cname.vercel-dns.com'},
        netlify: {type:'CNAME', name:'@', value:'<ton-site>.netlify.app', alt:'', www:'CNAME → <ton-site>.netlify.app'},
        cloudflare: {type:'CNAME', name:'@', value:'<ton-site>.pages.dev', alt:'', www:'CNAME → <ton-site>.pages.dev'},
        railway: {type:'CNAME', name:'@', value:'Voir ton dashboard Railway > Settings > Domains', alt:'', www:''},
        render: {type:'CNAME', name:'@', value:'Voir ton dashboard Render > Settings > Custom Domains', alt:'', www:''},
    };

    // Detect platform
    let platform = '';
    if (wsProjectData?.project) {
        api('projects/' + wsProjectId + '/connections').then(function(data) {
            const deploy = (data.connections || []).find(function(c) { return c.type === 'deploy'; });
            const dom = (data.connections || []).find(function(c) { return c.type === 'domain'; });
            platform = deploy?.details?.plateforme || '';
            const rec = dnsRecords[platform] || {};
            const registrar = dom?.details?.registrar || '';
            const registrarUrls = {cloudflare:'https://dash.cloudflare.com/',namecheap:'https://ap.www.namecheap.com/domains/list',ovh:'https://www.ovh.com/manager/',godaddy:'https://dcc.godaddy.com/domains'};
            const dashUrl = registrarUrls[registrar] || '';

            let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:14px">'
                + '<div style="font-size:13px;font-weight:700;color:var(--violet);margin-bottom:10px">Configuration DNS requise</div>'
                + '<div style="font-size:11px;color:var(--text-2);margin-bottom:12px;line-height:1.5">'
                + 'Va dans le dashboard de ton registrar <b>(' + (registrar || '?') + ')</b> et ajoute ces records DNS :'
                + '</div>';

            if (rec.type) {
                html += '<div style="background:var(--bg-1);border:1px solid var(--border-1);border-radius:6px;padding:10px;margin-bottom:8px;font-family:monospace;font-size:11px">'
                    + '<div style="display:grid;grid-template-columns:60px 60px 1fr;gap:4px;margin-bottom:4px">'
                    + '<span style="color:var(--text-4)">Type</span><span style="color:var(--text-4)">Name</span><span style="color:var(--text-4)">Value</span>'
                    + '<span style="color:var(--emerald);font-weight:700">' + rec.type + '</span><span style="color:var(--text-1)">' + rec.name + '</span>'
                    + '<span style="color:var(--violet);cursor:pointer" onclick="navigator.clipboard.writeText(\'' + rec.value + '\');toast(\'Copie\')" title="Cliquer pour copier">' + rec.value + ' 📋</span>'
                    + '</div>';
                if (rec.www) {
                    html += '<div style="display:grid;grid-template-columns:60px 60px 1fr;gap:4px">'
                        + '<span style="color:var(--emerald);font-weight:700">CNAME</span><span style="color:var(--text-1)">www</span>'
                        + '<span style="color:var(--violet)">' + rec.www + '</span></div>';
                }
                html += '</div>';
                if (rec.alt) {
                    html += '<div style="font-size:10px;color:var(--text-3);margin-bottom:8px">Alternative: ' + rec.alt + '</div>';
                }
            } else {
                html += '<div style="font-size:11px;color:var(--text-3);margin-bottom:8px">Consulte le dashboard de <b>' + (platform || 'ton hosting') + '</b> pour les records DNS a ajouter.</div>';
            }

            html += '<div style="display:flex;gap:6px;align-items:center;margin-top:10px">';
            if (dashUrl) {
                html += '<button class="btn btn-xs btn-primary" onclick="window.open(\'' + dashUrl + '\',\'_blank\')">Ouvrir ' + registrar + '</button>';
            }
            html += '<button class="btn btn-xs" onclick="wsDnsConfirm()">J\'ai configure le DNS</button>'
                + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-domain\').style.display=\'none\'">Fermer</button>'
                + '</div></div>';

            pasteEl.innerHTML = html;
            pasteEl.style.display = 'block';
        });
    }
}

async function wsDnsConfirm() {
    await apiPost('projects/' + wsProjectId + '/connections', {type:'domain', config:{dns_configured:true}});
    toast('DNS marque comme configure');
    loadWsConnections();
}

// Open external service then show paste input
function wsConnAction(type, url) {
    if (url) window.open(url, '_blank');
    // Show paste input under the card
    const pasteEl = document.getElementById('conn-paste-' + type);
    if (!pasteEl) return;

    const PASTE_FIELDS = {
        github: [{k:'url', l:'Coller l\'URL du repo'}],
        deploy: [{k:'site_url', l:'Coller l\'URL du site'}, {k:'project_url', l:'URL dashboard (optionnel)'}],
        database: [{k:'host', l:'Host'}, {k:'port', l:'Port'}, {k:'name', l:'Nom BDD'}, {k:'connection_string', l:'Connection string'}],
        storage: [{k:'bucket', l:'Nom du bucket'}],
        server: [{k:'ip', l:'Adresse IP du serveur'}],
    };
    const fields = PASTE_FIELDS[type] || [{k:'url', l:'Coller l\'URL'}];
    let html = '<div style="background:var(--bg-0);border:1px solid var(--violet);border-radius:8px;padding:10px">';
    html += '<div style="font-size:11px;font-weight:600;color:var(--violet);margin-bottom:8px">Revenu du service ? Colle les infos ici :</div>';
    for (const f of fields) {
        html += '<div class="form-group" style="margin-bottom:6px"><label style="font-size:11px">' + f.l + '</label>'
            + '<input class="form-input conn-paste-field" data-key="' + f.k + '" style="font-size:12px;padding:6px 8px"></div>';
    }
    html += '<div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="wsConnPasteSave(\'' + type + '\')">Enregistrer</button>'
        + '<button class="btn btn-xs" onclick="document.getElementById(\'conn-paste-' + type + '\').style.display=\'none\'">Annuler</button></div></div>';
    pasteEl.innerHTML = html;
    pasteEl.style.display = 'block';
    // Focus first input
    setTimeout(function() { pasteEl.querySelector('input')?.focus(); }, 100);
}

async function wsConnPasteSave(type) {
    const config = {};
    document.querySelectorAll('#conn-paste-' + type + ' .conn-paste-field').forEach(function(el) {
        const v = el.value.trim();
        if (v) config[el.dataset.key] = v;
    });
    if (Object.keys(config).length === 0) { toast('Remplis au moins un champ', 'error'); return; }
    await apiPost('projects/' + wsProjectId + '/connections', {type: type, config: config});
    toast('Connexion enregistree');
    loadWsConnections();
}

// Edit an existing connection — dispatch to the right guided form
async function wsEditConnection(type) {
    if (type === 'email') return wsSetupEmail();
    if (type === 'domain') return wsSetupDomain();
    if (type === 'deploy') return wsSetupDeploy();
    if (type === 'database') return wsSetupDatabase();
    if (type === 'storage') return wsSetupStorage();
    if (type === 'backup') return wsSetupBackup();
    // Fallback for unknown types
    const data = await api('projects/' + wsProjectId + '/connections');
    const conn = (data.connections || []).find(function(c) { return c.type === type; });
    wsShowAddConnection(type, conn ? (conn.details || {}) : {});
}

function wsShowAddConnection(preselect, prefill) {
    const types = [
        {key:'github', label:'GitHub', fields:[{k:'url',l:'URL du repo',p:'https://github.com/user/repo'}]},
        {key:'deploy', label:'Deploiement', fields:[
            {k:'platform',l:'Plateforme',o:[['','— choisir —']].concat(DEPLOY_PLATFORMS.map(function(x) { return [x.key, x.label]; }))},
            {k:'site_url',l:'URL du site',p:'https://mon-site.vercel.app'},
            {k:'project_url',l:'URL dashboard',p:'https://vercel.com/user/projet'},
            {k:'domain',l:'Domaine',p:'example.com'},
            {k:'dns',l:'Provider DNS',p:'cloudflare, namecheap, ovh'},
            {k:'ssl',l:'SSL',p:'letsencrypt, cloudflare'},
        ]},
        {key:'database', label:'Base de donnees', fields:[
            {k:'provider',l:'Provider',p:'supabase, neon, planetscale, local'},
            {k:'host',l:'Host',p:'db.xyz.supabase.co'},
            {k:'port',l:'Port',p:'5432'},
            {k:'name',l:'Nom de la BDD',p:'postgres'},
            {k:'user',l:'Utilisateur',p:'postgres'},
            {k:'connection_string',l:'Connection string',p:'postgresql://user:pass@host:5432/db',s:true},
            {k:'dashboard_url',l:'URL dashboard',p:'https://supabase.com/dashboard/project/xyz'},
        ]},
        {key:'storage', label:'Stockage R2/S3', fields:[
            {k:'bucket',l:'Nom du bucket',p:'mon-projet-uploads'},
            {k:'dashboard_url',l:'URL dashboard',p:'https://dash.cloudflare.com/...'},
        ]},
        {key:'backup', label:'Backup', fields:[
            {k:'destination',l:'Destination',p:'r2, s3, local'},
            {k:'bucket',l:'Bucket',p:'mon-projet-backups'},
            {k:'frequency',l:'Frequence',p:'daily, weekly, manual'},
        ]},
        {key:'server', label:'Serveur', fields:[
            {k:'ip',l:'Adresse IP',p:'12.34.56.78'},
            {k:'provider',l:'Provider',p:'OVH, DigitalOcean, Hetzner'},
            {k:'ssh_user',l:'Utilisateur SSH',p:'root'},
            {k:'dashboard_url',l:'URL dashboard',p:'https://cloud.digitalocean.com/...'},
        ]},
        {key:'domain', label:'Domaine', fields:[
            {k:'domain',l:'Domaine',p:'example.com'},
            {k:'registrar',l:'Registrar',p:'cloudflare, namecheap, ovh'},
            {k:'dashboard_url',l:'URL dashboard',p:'https://dash.cloudflare.com/...'},
        ]},
    ];
    prefill = prefill || {};

    let html = '<div class="card" style="padding:14px;border:2px solid var(--violet)">'
        + '<div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:12px">Ajouter une connexion</div>'
        + '<div class="form-group"><label>Type</label>'
        + '<select class="form-input" id="conn-type-sel" onchange="wsConnTypeChanged()">';
    for (const t of types) {
        html += '<option value="' + t.key + '"' + (preselect === t.key ? ' selected' : '') + '>' + t.label + '</option>';
    }
    html += '</select></div>'
        + '<div id="conn-fields"></div>'
        + '<div class="flex gap-6" style="margin-top:10px">'
        + '<button class="btn btn-primary btn-sm" onclick="wsSaveConnection()">Enregistrer</button>'
        + '<button class="btn btn-sm" onclick="loadWsConnections()">Annuler</button>'
        + '</div></div>';

    // Append to connections panel
    const el = document.getElementById('ws-connections');
    const existing = el.querySelector('.card[style*="border:2px solid var(--violet)"]');
    if (existing) existing.remove();
    el.insertAdjacentHTML('beforeend', html);
    window._connTypes = types;
    window._connPrefill = prefill;
    wsConnTypeChanged();
}

function wsConnTypeChanged() {
    const sel = document.getElementById('conn-type-sel');
    if (!sel) return;
    const type = sel.value;
    const typeDef = window._connTypes.find(function(t) { return t.key === type; });
    if (!typeDef) return;
    const prefill = window._connPrefill || {};

    let html = '';
    for (const f of typeDef.fields) {
        const val = prefill[f.k] || '';
        if (f.o) {                                        // a known list (platforms...): no typo possible
            html += '<div class="form-group"><label style="font-size:11px">' + f.l + '</label>'
                + '<select class="form-input conn-field" data-key="' + f.k + '" style="font-size:12px;padding:6px 8px">'
                + f.o.map(function(o) { return '<option value="' + o[0] + '"' + (val === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
                + '</select></div>';
            continue;
        }
        const inputType = f.s ? 'password' : 'text';
        html += '<div class="form-group"><label style="font-size:11px">' + f.l + '</label>'
            + '<input class="form-input conn-field" data-key="' + f.k + '" type="' + inputType + '" value="' + (val.startsWith && val.startsWith('****') ? '' : val) + '" placeholder="' + f.p + '" style="font-size:12px;padding:6px 8px"></div>';
    }
    document.getElementById('conn-fields').innerHTML = html;
}

async function wsSaveConnection() {
    const type = document.getElementById('conn-type-sel').value;
    const config = {};
    document.querySelectorAll('.conn-field').forEach(function(el) {
        const v = el.value.trim();
        if (v) config[el.dataset.key] = v;
    });

    if (Object.keys(config).length === 0) {
        toast('Remplis au moins un champ', 'error');
        return;
    }

    await apiPost('projects/' + wsProjectId + '/connections', {type: type, config: config});
    toast('Connexion ajoutee');
    loadWsConnections();
}

function loadWsGit() {
    const el = document.getElementById('ws-git');
    if (!wsProjectData) { el.innerHTML = ''; return; }
    const p = wsProjectData.project;
    const g = wsProjectData.git;
    const remote = p.git_remote || g?.remote || '';

    let repoUrl = '';
    if (remote) {
        repoUrl = remote.replace('git@github.com:', 'https://github.com/').replace('git@gitlab.com:', 'https://gitlab.com/').replace(/\.git$/, '');
    }

    let html = '';

    // Several repos in the project (e.g. md_console + md_infra): choose where git runs
    const repos = wsProjectData.repos || [];
    if (wsProjectData.github_org) {
        html += '<div id="ws-org"></div>';
    } else if (repos.length > 1 || (repos.length === 1 && repos[0].dir !== '.')) {
        html += `<div class="card mb-8" style="padding:14px">
            <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:8px">Depots du projet</div>
            ${repos.map(r => {
                const st = r.state || {};
                const dirty = (st.modified || 0) + (st.untracked || 0);
                const on = wsGitRepo && wsGitRepo.dir === r.dir;
                return `<div class="flex-between" data-dir="${hx(r.dir)}" onclick="wsSelectRepo(this.dataset.dir)"
                    style="padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px;${on ? 'background:rgba(109,92,255,.15);' : ''}">
                    <span class="mono" style="${on ? 'color:var(--violet);font-weight:700' : ''}">${hx(r.dir)}</span>
                    <span style="color:var(--text-3)">${hx(st.branch || '')} ${dirty ? '<span class="badge badge-amber">' + dirty + ' modif</span>' : ''}${st.unpushed ? ' <span class="badge" style="background:var(--rose-dim);color:var(--rose)">' + st.unpushed + ' non pousse(s)</span>' : ''}</span>
                </div>`;
            }).join('')}
            <div style="font-size:10px;color:var(--text-4);margin-top:6px">Les actions rapides s'executent dans le depot selectionne.</div>
        </div>`;
    }

    html += '<div id="ws-sync"></div>';

    // Single-repo project: its repository + status. A multi-repo project shows the table above instead
    // (no org-level links, and never an "Initialiser Git" that would wrap the repos in a new one).
    if (!wsIsMultiRepo()) {
        // Repository
        html += `<div class="card mb-8" style="padding:14px">
            <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Repository</div>
            ${repoUrl ? `<a href="${repoUrl}" target="_blank" style="color:var(--sky);text-decoration:none;font-size:12px;font-family:monospace;word-break:break-all">${repoUrl}</a>
                <div class="flex gap-6 mt-8">
                    <a href="${repoUrl}" target="_blank" class="btn btn-xs" style="text-decoration:none">GitHub</a>
                    <a href="${repoUrl}/issues" target="_blank" class="btn btn-xs" style="text-decoration:none">Issues</a>
                    <a href="${repoUrl}/pulls" target="_blank" class="btn btn-xs" style="text-decoration:none">Pull Requests</a>
                    <a href="${repoUrl}/actions" target="_blank" class="btn btn-xs" style="text-decoration:none">Actions</a>
                </div>` : `<div style="color:var(--text-4);font-size:12px">Pas de remote configure</div>
                <button class="btn btn-xs btn-primary mt-8" onclick="openLinkTerminal(${p.id})">Lier a GitHub</button>`}
        </div>`;

        // Status
        if (g) {
            html += `<div class="card mb-8" id="ws-git-status" style="padding:14px">
                <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Status</div>
                <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12px;align-items:center">
                    <span class="text-dim">Branche</span><span style="font-weight:600;color:var(--text-0)">${g.branch}</span>
                    <span class="text-dim">Etat</span><span>${g.is_clean ? '<span class="badge badge-emerald">Clean</span>' : '<span class="badge badge-amber">' + (g.modified + g.untracked + g.staged) + ' changements</span>'}</span>
                    ${g.modified ? '<span class="text-dim">Modifies</span><span style="color:var(--amber)">' + g.modified + ' fichiers</span>' : ''}
                    ${g.untracked ? '<span class="text-dim">Non suivis</span><span style="color:var(--rose)">' + g.untracked + ' fichiers</span>' : ''}
                    ${g.staged ? '<span class="text-dim">Stages</span><span style="color:var(--emerald)">' + g.staged + ' fichiers</span>' : ''}
                    <span class="text-dim">Dernier commit</span><span>${g.last_commit}</span>
                </div>
            </div>`;
        } else {
            html += `<div class="card mb-8" style="padding:14px">
                <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Status</div>
                <div style="color:var(--text-4);font-size:12px">Pas un repo git</div>
                <button class="btn btn-xs btn-primary mt-8" onclick="openLinkTerminal(${p.id})">Lier a GitHub</button>
            </div>`;
        }
    }

    // Actions rapides
    html += `<div class="card" style="padding:14px">
        <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:10px">Actions rapides</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
            <button class="btn btn-xs" onclick="runTermCmd('git status')" style="justify-content:flex-start">git status</button>
            <button class="btn btn-xs" onclick="runTermCmd('git log --oneline -5')" style="justify-content:flex-start">git log</button>
            <button class="btn btn-xs" onclick="runTermCmd('git diff --stat')" style="justify-content:flex-start">git diff</button>
            <button class="btn btn-xs" onclick="runTermCmd('git pull')" style="justify-content:flex-start">git pull</button>
            <button class="btn btn-xs" onclick="runTermCmd('git push -u origin HEAD')" style="justify-content:flex-start">git push</button>
            <button class="btn btn-xs btn-primary" onclick="wsCommitAll()" style="justify-content:flex-start;grid-column:1/-1">Commit de tous les changements…</button>
            <button class="btn btn-xs" onclick="runTermCmd('git branch -a')" style="justify-content:flex-start">git branch</button>
        </div>
    </div>`;

    el.innerHTML = html;
    loadWsSync();
    if (wsProjectData.github_org) loadWsOrg();
}


