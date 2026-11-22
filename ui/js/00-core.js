/* ═══ STATE ═══ */
let currentPage = 'dashboard';
let pendingAction = null;
let pendingExtra = null;
let pendingLinkId = null;
let editingProjId = null;
let selectedColor = '#6d5cff';
let projectsCache = [];
let charts = {};

const PAGE_TITLES = {
    dashboard: 'Ce PC', projects: 'Projets', storage: 'Stockage',
    caches: 'Caches', docker: 'Docker', network: 'Reseau', running: 'En cours',
    settings: 'Preferences', sessions: 'Terminaux ouverts'
};   // an extension adds its own page here (ex. extensions/proniver)

const COLORS = ['#6d5cff','#06b6d4','#22d3a7','#f472b6','#f59e0b','#f43f5e','#60a5fa','#fb923c','#2dd4bf'];

/* ═══ CHART DEFAULTS ═══ */
Chart.defaults.color = '#42424e';
Chart.defaults.borderColor = 'rgba(255,255,255,.04)';
Chart.defaults.font.family = "'Inter', sans-serif";

const CHART_COLORS = ['#6d5cff','#38bdf8','#22d3a7','#f472b6','#f59e0b','#f43f5e','#60a5fa','#fb923c','#2dd4bf'];
const DOUGHNUT_OPTS = {
    responsive: true, maintainAspectRatio: false, cutout: '68%',
    plugins: {
        legend: { position: 'bottom', labels: { padding: 14, usePointStyle: true, pointStyleWidth: 6, font: { size: 10, weight: 500 } } },
        tooltip: { backgroundColor: 'rgba(15,15,18,.95)', borderColor: 'rgba(113,113,122,.2)', borderWidth: 1, cornerRadius: 8, titleFont: { weight: 600 }, padding: 10 }
    }
};

/* ═══ HELPERS ═══ */
const api = async (u) => (await fetch('/api/' + u)).json();
const apiPost = async (u, d) => (await fetch('/api/' + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })).json();
const apiPut = async (u, d) => (await fetch('/api/' + u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })).json();
const apiDel = async (u) => (await fetch('/api/' + u, { method: 'DELETE' })).json();

function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function fmtB(b) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
    return b.toFixed(1) + ' ' + units[i];
}

function esc(s) { return s.replace(/'/g, "\\'"); }
function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
function toggleNav(open) {
    const on = open === undefined ? !document.body.classList.contains('nav-open') : !!open;
    document.body.classList.toggle('nav-open', on);
}
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.classList.remove('visible')); document.getElementById('overlay').classList.remove('visible'); pendingAction = null; pendingExtra = null; }
function showModal(id) { document.getElementById('overlay').classList.add('visible'); document.getElementById(id).classList.add('visible'); }
function cleanConfirm(action, msg, extra) { pendingAction = action; pendingExtra = extra || {}; document.getElementById('confirm-msg').textContent = msg; showModal('confirm-modal'); }

async function executeClean() {
    if (!pendingAction) return;
    const action = pendingAction, extra = pendingExtra || {};
    closeModals();
    const loading = document.createElement('div');
    loading.className = 'toast toast-info';
    loading.innerHTML = '<span class="spinner" style="width:12px;height:12px;margin-right:6px;vertical-align:middle"></span> Nettoyage...';
    document.getElementById('toasts').appendChild(loading);
    try {
        const r = await apiPost('clean', { action, ...extra });
        loading.remove();
        toast(r.success ? r.message : 'Erreur: ' + r.message, r.success ? 'success' : 'error');
        if (r.navigate) go(r.navigate);
        else if (r.success) setTimeout(() => loadPage(currentPage), 700);
    } catch (e) { loading.remove(); toast('Erreur reseau', 'error'); }
}

async function deleteFile(path, name) {
    if (!confirm('Supprimer "' + name + '" ?')) return;
    try {
        const r = await apiPost('clean', { action: 'delete_file', path });
        toast(r.success ? r.message : r.message, r.success ? 'success' : 'error');
        if (r.success) setTimeout(() => loadPage(currentPage), 500);
    } catch (e) { toast('Erreur', 'error'); }
}

/* ═══ NAVIGATION ═══ */
/* small line icons for buttons (no emoji: they look different on every system) */
const UI_ICONS = {
    reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    spark: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
    up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
};
function uiIcon(name, size) {
    const n = size || 14;
    return `<svg class="ui-ico" width="${n}" height="${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${UI_ICONS[name] || ''}</svg>`;
}

function go(page) {
    if (page === 'projects') page = 'agent:projets';     // the agent's Projets screen replaced the old page
    document.body.classList.remove('nav-open');          // narrow window: the menu folds after a choice
    const base = page.split(':')[0];                     // 'agent:chat' lives in the #page-agent container
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
    document.getElementById('page-' + base).classList.add('active');
    const navItem = document.querySelector(`.sidebar-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');
    document.getElementById('page-title').textContent = PAGE_TITLES[page] || page;
    currentPage = page;
    if (window.location.hash.slice(1) !== page) window.location.hash = page;
    loadPage(page);
}

/* a link written as href="#agent:chat" (or the browser's back button) changes the page too */
window.addEventListener('hashchange', () => {
    const hash = window.location.hash.slice(1);
    if (!hash || hash === currentPage || hash.startsWith('workspace')) return;
    if (hash.startsWith('agent:') || PAGE_TITLES[hash]) go(hash);
});

function loadPage(p) {
    if (p.startsWith('agent:')) {                        // one of the agent's screens (devagent/web/pages/)
        const title = DA.open(p.split(':')[1]);
        if (title) document.getElementById('page-title').textContent = title;
        return;
    }
    const loaders = {
        dashboard: loadDashboard, projects: loadProjects, storage: loadStorage,
        caches: loadCaches, docker: loadDocker, network: loadNetwork, running: loadRunning,
        settings: () => { loadSettings(); loadDevTools(); }, 
        sessions: loadSessionsPage
    };
    (loaders[p] || (() => {}))();
}

function refresh() { loadPage(currentPage); toast('Rafraichi', 'info'); }

/* ═══ TOPBAR LIVE STATS ═══ */
function updateTopbar() {}           // the figures moved to « Ce PC »; kept for old callers

// Poll events
setInterval(async () => {
    try {
        const ev = await api('events/poll');
        if (ev.length > 0) {
            toast(ev[0].resource_name + ' — ' + ev[0].type, 'info');
            if (currentPage === 'dashboard') loadDashboard();
        }
    } catch (e) {}
}, 5000);

