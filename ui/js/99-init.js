// Restore page from URL hash (e.g. #workspace:52)
(function initFromHash() {
    const hash = window.location.hash.slice(1); // remove #
    if (!hash) { loadDashboard(); return; }
    const [page, param] = hash.split(':');
    if (page === 'workspace' && param) {
        openWorkspace(parseInt(param));
    } else if (page && PAGE_TITLES[page]) {
        go(page);
    } else {
        loadDashboard();
    }
})();

/* ═══════════════════════════════════════════════════════════════════════════ */
