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
    dashboard: 'Dashboard', projects: 'Projets', storage: 'Stockage',
    caches: 'Caches', docker: 'Docker', network: 'Reseau', running: 'En cours',
    timeline: 'Timeline', settings: 'Parametres', cloud: 'Cloud Sync', sessions: 'Sessions'
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
function go(page) {
    document.body.classList.remove('nav-open');          // narrow window: the menu folds after a choice
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    const navItem = document.querySelector(`.sidebar-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');
    document.getElementById('page-title').textContent = PAGE_TITLES[page] || page;
    currentPage = page;
    window.location.hash = page;
    loadPage(page);
}

function loadPage(p) {
    const loaders = {
        dashboard: loadDashboard, projects: loadProjects, storage: loadStorage,
        caches: loadCaches, docker: loadDocker, network: loadNetwork, running: loadRunning,
        timeline: () => loadTimeline(24), settings: () => { loadSettings(); loadDevTools(); }, cloud: loadCloudOverview,
        sessions: loadSessionsPage
    };
    (loaders[p] || (() => {}))();
}

function refresh() { loadPage(currentPage); toast('Rafraichi', 'info'); }

/* ═══ TOPBAR LIVE STATS ═══ */
async function updateTopbar() {
    try {
        const s = await api('system');
        const d = s.disks.find(d => d.mount === '/') || s.disks[0];
        const cpuCls = s.cpu.percent > 80 ? 'danger' : s.cpu.percent > 60 ? 'warn' : '';
        const ramCls = s.ram.percent > 80 ? 'danger' : s.ram.percent > 60 ? 'warn' : '';
        document.getElementById('topbar-stats').innerHTML = `
            <div class="topbar-stat">CPU <b class="${cpuCls}">${s.cpu.percent}%</b></div>
            <div class="topbar-stat">RAM <b class="${ramCls}">${s.ram.percent}%</b> <span style="color:var(--text-4)">${s.ram.used_h}</span></div>
            <div class="topbar-stat">SSD <b>${d?.percent || 0}%</b> <span style="color:var(--text-4)">${d?.free_h || ''} libre</span></div>
            ${s.trash.size > 100 * 1024 * 1024 ? '<div class="topbar-stat"><b class="danger">' + s.trash.size_h + '</b> trash</div>' : ''}`;
    } catch (e) {}
}

/* ═══ WATCHER ═══ */
async function checkWatcher() {
    try {
        const r = await api('watcher/status');
        document.getElementById('watcher-dot').className = 'watcher-dot ' + (r.running ? 'on' : 'off');
        document.getElementById('watcher-label').textContent = r.running ? 'Watcher actif' : 'Watcher inactif';
    } catch (e) {}
}

setInterval(checkWatcher, 15000); checkWatcher();
setInterval(updateTopbar, 8000); updateTopbar();

// Poll events
setInterval(async () => {
    try {
        const ev = await api('events/poll');
        if (ev.length > 0) {
            toast(ev[0].resource_name + ' — ' + ev[0].type, 'info');
            if (currentPage === 'dashboard') loadDashboard();
            if (currentPage === 'timeline') loadTimeline(24);
        }
    } catch (e) {}
}, 5000);

