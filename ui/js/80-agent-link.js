/* The « Agent » entry of the sidebar: how many irreversible actions wait for a confirmation. */
(function agentWaiting() {
    const badge = document.getElementById('agent-waiting');
    if (!badge) return;
    async function refresh() {
        try {
            const s = await (await fetch('/api/agent/state')).json();
            badge.textContent = s.waiting;
            badge.hidden = !s.waiting;
            badge.title = s.waiting + ' action(s) attendent ta confirmation';
        } catch (e) { /* restarting */ }
    }
    refresh();
    setInterval(refresh, 10000);
})();
