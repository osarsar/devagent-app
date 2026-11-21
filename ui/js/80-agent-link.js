/* One menu for the whole application: the agent's screens (A faire, Chat, Acces...) are listed in
   the sidebar, with what waits for the user. The list comes from the server, so a new agent
   screen appears here without touching this file. */
(async function agentNav() {
    const group = document.getElementById('agent-nav');
    if (!group) return;
    const badges = {};
    function projectQuery() {                      // on a project's page: open the agent on that project
        const m = location.hash.match(/^#workspace:(\d+)/);
        return m ? '?projet=' + m[1] : '';
    }
    try {
        const { pages } = await (await fetch('/api/agent/pages')).json();
        for (const p of pages) {
            const a = document.createElement('a');
            a.className = 'sidebar-item';
            a.style.textDecoration = 'none';
            a.href = '/agent#' + p.id;
            a.addEventListener('click', () => { a.href = '/agent' + projectQuery() + '#' + p.id; });
            const icon = document.createElement('span');
            icon.className = 'icon';
            icon.textContent = p.icon;
            a.append(icon, document.createTextNode(' ' + p.title + ' '));
            if (p.id === 'afaire' || p.id === 'confirmations') {
                const b = document.createElement('span');
                b.className = 'hotkey';
                b.style.cssText = 'background:#f43f5e;color:#fff';
                b.hidden = true;
                a.append(b);
                badges[p.id] = b;
            }
            group.append(a);
        }
    } catch (e) { return; }
    async function refresh() {
        try {
            const s = await (await fetch('/api/agent/state')).json();
            for (const [id, n] of [['afaire', s.todos || 0], ['confirmations', s.waiting || 0]]) {
                if (badges[id]) { badges[id].textContent = n; badges[id].hidden = !n; }
            }
        } catch (e) { /* restarting */ }
    }
    refresh();
    setInterval(refresh, 10000);
})();
