/* ═══════════════════════════════════════════════════════════
   PAGE: DASHBOARD
   ═══════════════════════════════════════════════════════════ */
async function loadDashboard() {
    const [sys, home, sug, proj] = await Promise.all([api('system'), api('home'), api('suggestions'), api('projects')]);
    projectsCache = proj;
    const d = sys.disks.find(x => x.mount === '/') || sys.disks[0];

    // Alerts
    document.getElementById('dash-alerts').innerHTML = sug.filter(s => s.priority === 'critical').map(s =>
        `<div class="alert alert-critical"><span>${s.msg}</span>${s.action.startsWith('nav:')
            ? `<button class="btn btn-sm" onclick="go('${s.action.slice(4)}')">Voir</button>`
            : `<button class="btn btn-sm btn-danger" onclick="cleanConfirm('${s.action}','${s.msg}')">Nettoyer</button>`
        }</div>`
    ).join('');

    // Stats
    const pctColor = (p) => p > 85 ? 'var(--rose)' : p > 70 ? 'var(--amber)' : 'var(--text-0)';
    const fillClass = (p) => p > 85 ? 'fill-rose' : p > 70 ? 'fill-amber' : 'fill-violet';

    document.getElementById('dash-stats').innerHTML = `
        <div class="card metric-card">
            <div class="accent-bar accent-violet"></div>
            <div class="card-label">Disque SSD</div>
            <div class="card-value" style="color:${pctColor(d?.percent||0)}">${d?.percent || 0}<span style="font-size:14px;font-weight:400;color:var(--text-3)">%</span></div>
            <div class="card-sub">${d?.free_h || '—'} libre sur ${d?.total_h || '—'}</div>
            <div class="progress"><div class="progress-fill ${fillClass(d?.percent||0)}" style="width:${d?.percent||0}%"></div></div>
        </div>
        <div class="card metric-card">
            <div class="accent-bar accent-sky"></div>
            <div class="card-label">RAM</div>
            <div class="card-value" style="color:${pctColor(sys.ram.percent)}">${sys.ram.percent}<span style="font-size:14px;font-weight:400;color:var(--text-3)">%</span></div>
            <div class="card-sub">${sys.ram.used_h} / ${sys.ram.total_h}</div>
            <div class="progress"><div class="progress-fill fill-sky" style="width:${sys.ram.percent}%"></div></div>
        </div>
        <div class="card metric-card">
            <div class="accent-bar accent-emerald"></div>
            <div class="card-label">Ressources suivies</div>
            <div class="card-value" style="color:var(--text-0)">${sys.stats.total_resources}</div>
            <div class="card-sub">${sys.stats.total_projects} projets &middot; ${sys.stats.total_temporary} temp &middot; ${sys.stats.total_expired} expires</div>
        </div>
        <div class="card metric-card">
            <div class="accent-bar ${sys.trash.size > 1073741824 ? 'accent-rose' : 'accent-emerald'}"></div>
            <div class="card-label">Corbeille</div>
            <div class="card-value" style="color:${sys.trash.size > 1073741824 ? 'var(--rose)' : 'var(--emerald)'}">${sys.trash.size_h}</div>
            ${sys.trash.size > 100 * 1024 * 1024 ? '<button class="btn btn-sm btn-danger mt-8" onclick="cleanConfirm(\'trash\',\'Vider la corbeille ?\')">Vider</button>' : '<div class="card-sub" style="color:var(--emerald)">Propre</div>'}
        </div>`;

    // Disk chart
    destroyChart('chart-disk');
    charts['chart-disk'] = window.Chart && new Chart(document.getElementById('chart-disk'), {
        type: 'doughnut',
        data: {
            labels: sys.disks.map(dk => dk.mount === '/' ? 'SSD (/)' : dk.mount),
            datasets: [
                { data: sys.disks.map(dk => dk.used), backgroundColor: CHART_COLORS, borderWidth: 0, spacing: 3, borderRadius: 4 },
                { data: sys.disks.map(dk => dk.free), backgroundColor: CHART_COLORS.map(c => c + '18'), borderWidth: 0, spacing: 3, borderRadius: 4 }
            ]
        },
        options: { ...DOUGHNUT_OPTS, plugins: { ...DOUGHNUT_OPTS.plugins, tooltip: { ...DOUGHNUT_OPTS.plugins.tooltip, callbacks: { label: ctx => { const dk = sys.disks[ctx.dataIndex]; return ctx.datasetIndex === 0 ? 'Utilise: ' + dk.used_h : 'Libre: ' + dk.free_h; } } } } }
    });

    // Home chart
    destroyChart('chart-home');
    const topH = home.slice(0, 8);
    const catColors = { system: '#8b5cf6', cache: '#fbbf24', downloads: '#fb7185', sdk: '#38bdf8', projects: '#34d399', project: '#a78bfa', personal: '#60a5fa' };
    charts['chart-home'] = window.Chart && new Chart(document.getElementById('chart-home'), {
        type: 'bar',
        data: {
            labels: topH.map(h => h.name.length > 14 ? h.name.slice(0, 14) + '..' : h.name),
            datasets: [{ data: topH.map(h => h.size / (1024 ** 3)), backgroundColor: topH.map(h => catColors[h.category] || '#8b5cf6'), borderRadius: 4, borderSkipped: false, barThickness: 16 }]
        },
        options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { ...DOUGHNUT_OPTS.plugins.tooltip, callbacks: { label: ctx => topH[ctx.dataIndex].size_h } } }, scales: { x: { title: { display: true, text: 'GB', font: { size: 9 } }, ticks: { font: { size: 9 } }, grid: { color: 'rgba(39,39,42,.3)' } }, y: { ticks: { font: { family: 'monospace', size: 9 } }, grid: { display: false } } } }
    });

    // Project chart
    destroyChart('chart-projects');
    // real size of each project's folder (computed in the background: "calcul..." until known)
    const pj = proj.filter(p => p.disk_size > 0);
    const canvas = document.getElementById('chart-projects'), empty = document.getElementById('chart-projects-empty');
    canvas.style.display = pj.length ? '' : 'none';
    empty.style.display = pj.length ? 'none' : '';
    empty.textContent = proj.length ? 'Taille des projets en cours de calcul...' : 'Aucun projet';
    if (pj.length) {
        charts['chart-projects'] = window.Chart && new Chart(canvas, {
            type: 'doughnut',
            data: { labels: pj.map(p => p.name), datasets: [{ data: pj.map(p => p.disk_size), backgroundColor: pj.map(p => p.color), borderWidth: 0, spacing: 3, borderRadius: 4 }] },
            options: { ...DOUGHNUT_OPTS, plugins: { ...DOUGHNUT_OPTS.plugins, tooltip: { ...DOUGHNUT_OPTS.plugins.tooltip, callbacks: { label: ctx => pj[ctx.dataIndex].name + ': ' + fmtB(pj[ctx.dataIndex].disk_size) } } } }
        });
    }

    // Events
    const events = await api('events?limit=8&hours=24');
    const evColors = { created: 'var(--emerald)', deleted: 'var(--rose)', cleaned: 'var(--sky)', expired: 'var(--amber)' };
    document.getElementById('dash-events').innerHTML = events.length
        ? events.map(e => `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-0);font-size:11px"><span style="color:${evColors[e.type] || 'var(--text-4)'}">&#9679;</span><span class="ellipsis" style="flex:1">${e.resource_name}</span><span style="font-size:9px;color:var(--text-4);white-space:nowrap">${e.created_at?.slice(11, 16) || ''}</span></div>`).join('')
        : '<div style="text-align:center;padding:60px 0;color:var(--text-4);font-size:12px">Aucun evenement recent</div>';
}

