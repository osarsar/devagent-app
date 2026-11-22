// Restore page from URL hash (e.g. #workspace:52)
(function initFromHash() {
    const hash = window.location.hash.slice(1); // remove #
    DA.init();
    if (!hash) { go('agent:accueil'); return; }          // the app opens on what matters now
    const [page, param] = hash.split(':');
    if (page === 'workspace' && param) {
        openWorkspace(parseInt(param));
    } else if (page === 'agent' || PAGE_TITLES[page]) {
        go(hash);
    } else {
        go('agent:accueil');
    }
})();

/* ═══════════════════════════════════════════════════════════════════════════ */
