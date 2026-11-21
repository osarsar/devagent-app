/* The « Agent » entry of the sidebar: how many irreversible actions wait for a confirmation. */
(function agentWaiting() {
    const badge = document.getElementById('agent-waiting');
    if (!badge) return;
    async function refresh() {
        try {
            const s = await (await fetch('/api/agent/state')).json();
            const n = (s.waiting || 0) + (s.todos || 0);
            badge.textContent = n;
            badge.hidden = !n;
            badge.title = (s.todos || 0) + ' chose(s) a faire par toi, ' + (s.waiting || 0) + ' confirmation(s) en attente';
        } catch (e) { /* restarting */ }
    }
    refresh();
    setInterval(refresh, 10000);
})();
