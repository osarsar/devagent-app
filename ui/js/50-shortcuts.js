/* ═══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ═══════════════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    // Don't intercept when terminal is focused
    if (e.target.closest && e.target.closest('.xterm')) return;
    // Don't intercept when xterm has focus (it uses a hidden textarea)
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.xterm')) return;
    // Don't intercept when we're on the workspace page with terminal active
    if (currentPage === 'workspace' && xterm && document.querySelector('.xterm-helper-textarea:focus')) return;
    const pages = { '1': 'agent:accueil', '2': 'agent:projets', '3': 'agent:chat', '4': 'agent:afaire', '5': 'agent:automatisations', '6': 'agent:acces', '7': 'running', '8': 'settings' };
    if (pages[e.key]) go(pages[e.key]);
    else if (e.key === 'r' || e.key === 'R') refresh();
    else if (e.key === '?') showModal('help-modal');
    else if (e.key === 'Escape') closeModals();
});
