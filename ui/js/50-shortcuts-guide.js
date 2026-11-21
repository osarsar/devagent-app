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
    const pages = { '1': 'dashboard', '2': 'projects', '3': 'storage', '4': 'caches', '5': 'docker', '6': 'network', '7': 'timeline', '8': 'settings', '9': 'running' };
    if (pages[e.key]) go(pages[e.key]);
    else if (e.key === 'c' || e.key === 'C') go('cloud');
    else if (e.key === 'r' || e.key === 'R') refresh();
    else if (e.key === '?') showModal('help-modal');
    else if (e.key === 'Escape') closeModals();
});

/* ═══════════════════════════════════════════════════════════
   INTERACTIVE GUIDE
   ═══════════════════════════════════════════════════════════ */
function openGuide() { document.getElementById('guide-overlay').classList.add('visible'); loadGuide(); }
function closeGuide() { document.getElementById('guide-overlay').classList.remove('visible'); }

async function loadGuide() {
    const box = document.getElementById('guide-steps');
    box.innerHTML = '';

    // Helper to render one step
    function renderStep(s) {
        const el = document.createElement('div');
        el.className = 'guide-step ' + (s.done ? 'done' : '');
        el.innerHTML = `
            <div class="guide-step-num">${s.done ? '&#10003;' : s.num}</div>
            <div class="guide-step-content">
                <div class="guide-step-title">${s.title}</div>
                <div class="guide-step-desc">${s.desc}</div>
                <div class="guide-step-data">${s.data}</div>
                <div class="guide-step-actions">${s.actions}</div>
            </div>`;
        box.appendChild(el);
    }

    function renderLoading(msg) {
        const el = document.createElement('div');
        el.className = 'guide-step';
        el.id = 'guide-loading';
        el.innerHTML = `<div class="guide-step-content"><div style="display:flex;align-items:center;gap:8px;color:var(--text-3);font-size:12px"><div class="spinner"></div> ${msg}</div></div>`;
        box.appendChild(el);
        return el;
    }

    function removeLoading() { const l = document.getElementById('guide-loading'); if (l) l.remove(); }

    // ─── STEP 1: System (fast) ───
    let loader = renderLoading('Lecture du systeme...');
    const sys = await api('system');
    removeLoading();
    const d = sys.disks.find(x => x.mount === '/') || sys.disks[0];
    renderStep({
        num: 1, done: false,
        title: 'Decouvre ton etat systeme',
        desc: 'Voici un snapshot live de ton PC. Le dashboard le met a jour automatiquement.',
        data: `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;text-align:center">
            <div><div style="font-size:22px;font-weight:800;color:${d.percent>80?'var(--rose)':'var(--text-0)'}">${d.percent}%</div><div style="font-size:10px;color:var(--text-3)">SSD (${d.free_h} libre)</div></div>
            <div><div style="font-size:22px;font-weight:800;color:${sys.ram.percent>80?'var(--rose)':'var(--text-0)'}">${sys.ram.percent}%</div><div style="font-size:10px;color:var(--text-3)">RAM (${sys.ram.used_h})</div></div>
            <div><div style="font-size:22px;font-weight:800">${sys.cpu.percent}%</div><div style="font-size:10px;color:var(--text-3)">CPU</div></div>
            <div><div style="font-size:22px;font-weight:800;color:${sys.trash.size>500*1024*1024?'var(--rose)':'var(--emerald)'}">${sys.trash.size_h}</div><div style="font-size:10px;color:var(--text-3)">Corbeille</div></div>
        </div>`,
        actions: `<button class="btn btn-sm" onclick="closeGuide();go('dashboard')">Voir le Dashboard</button>
                  ${sys.trash.size>100*1024*1024?`<button class="btn btn-sm btn-danger" onclick="guideClean('trash','Vider la corbeille ?')">Vider corbeille (${sys.trash.size_h})</button>`:''}`
    });

    // ─── STEP 2: Projects (fast) ───
    loader = renderLoading('Scan des projets...');
    const [proj, detected] = await Promise.all([api('projects'), api('scan/detect')]);
    projectsCache = proj;
    removeLoading();
    renderStep({
        num: 2, done: detected.length === 0,
        title: 'Importe tes projets',
        desc: `${proj.length} projets dans DevAgent. ${detected.length} nouveaux projets detectes dans tes dossiers.`,
        data: detected.length > 0 ? `<div style="max-height:150px;overflow-y:auto">${detected.slice(0,8).map(p=>`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-0)"><span style="width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0"></span><span style="font-weight:600;flex:1">${p.name}</span><span class="badge badge-violet">${p.manifest}</span><span class="mono text-dim">${p.cache_size_h}</span></div>`).join('')}${detected.length>8?`<div style="color:var(--text-4);font-size:11px;padding:6px 0">+ ${detected.length-8} autres...</div>`:''}</div>` : '<div style="color:var(--emerald)">Tous les projets sont deja importes !</div>',
        actions: detected.length > 0
            ? `<button class="btn btn-sm btn-primary" onclick="guideImportAll()">Importer les ${detected.length} projets</button><button class="btn btn-sm" onclick="closeGuide();go('projects')">Voir les projets</button>`
            : `<button class="btn btn-sm" onclick="closeGuide();go('projects')">Gerer mes projets</button>`
    });

    // ─── STEP 3: Browser Caches (fast) ───
    loader = renderLoading('Analyse des caches navigateur...');
    const br = await api('caches/browser');
    removeLoading();
    const totalBr = br.reduce((s,b)=>s+b.total,0);
    renderStep({
        num: 3, done: totalBr === 0,
        title: 'Nettoie tes caches navigateur',
        desc: 'Tu changes du CSS/JS et le navigateur montre l\'ancienne version ? C\'est ces caches. Les vider force un reload propre.',
        data: br.length > 0 ? `<div style="display:flex;gap:16px;flex-wrap:wrap">${br.map(b=>`<div style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--sky)">${b.total_h}</div><div style="font-size:10px;color:var(--text-3)">${b.label}</div></div>`).join('')}<div style="text-align:center;border-left:1px solid var(--border-0);padding-left:16px"><div style="font-size:20px;font-weight:800;color:var(--rose)">${fmtB(totalBr)}</div><div style="font-size:10px;color:var(--text-3)">Total</div></div></div>` : '<div style="color:var(--emerald)">Aucun cache navigateur</div>',
        actions: totalBr > 0 ? `<button class="btn btn-sm btn-danger" onclick="guideClearBrowsers()">Vider tous (${fmtB(totalBr)})</button><button class="btn btn-sm" onclick="closeGuide();go('caches')">Detail</button>` : ''
    });

    // ─── STEP 4: Project Caches (slow — scan disk) ───
    loader = renderLoading('Scan des caches projets (node_modules, .next, __pycache__...)...');
    const pc = await api('caches/projects');
    removeLoading();
    const totalPc = pc.reduce((s,p)=>s+p.total,0);
    const topPc = pc.slice(0,5);
    renderStep({
        num: 4, done: totalPc === 0,
        title: 'Nettoie les caches de tes projets',
        desc: `${pc.length} projets ont des caches. Tu peux les vider — "npm install" ou "pip install" les recree.`,
        data: topPc.length > 0 ? `<div style="max-height:140px;overflow-y:auto">${topPc.map(p=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-0)"><span style="width:6px;height:24px;border-radius:3px;background:${p.project_color||'var(--violet)'};flex-shrink:0"></span><span style="font-weight:600;flex:1">${p.name}</span><span style="font-size:11px;color:var(--text-3)">${p.caches.map(c=>c.name).join(', ')}</span><span class="mono" style="font-weight:700;color:var(--violet)">${p.total_h}</span></div>`).join('')}${pc.length>5?`<div style="color:var(--text-4);font-size:11px;padding:4px 0">+ ${pc.length-5} autres...</div>`:''}</div><div style="margin-top:8px;font-size:12px;color:var(--text-2)">Total: <b style="color:var(--violet)">${fmtB(totalPc)}</b></div>` : '<div style="color:var(--emerald)">Aucun cache projet</div>',
        actions: totalPc > 0 ? `<button class="btn btn-sm btn-danger" onclick="guideClean('clear_all_pycache','Supprimer tous les __pycache__ ?')">Purge __pycache__</button><button class="btn btn-sm" onclick="closeGuide();go('caches')">Gerer par projet</button>` : ''
    });

    // ─── STEP 5: Global Caches ───
    loader = renderLoading('Analyse des caches globaux...');
    const gc = await api('caches/global');
    removeLoading();
    const totalGc = gc.reduce((s,g)=>s+(g.size||0),0);
    renderStep({
        num: 5, done: totalGc < 100*1024*1024,
        title: 'Nettoie les caches globaux',
        desc: 'npm, pip, Gradle, Flutter... chaque package manager garde un cache qui grossit avec le temps.',
        data: gc.length > 0 ? `<div style="display:flex;gap:12px;flex-wrap:wrap">${gc.map(g=>`<div style="background:var(--bg-2);border:1px solid var(--border-0);border-radius:8px;padding:8px 12px;min-width:110px"><div style="font-weight:700;color:var(--emerald)">${g.size_h}</div><div style="font-size:10px;color:var(--text-3)">${g.label}</div></div>`).join('')}</div><div style="margin-top:8px;font-size:12px;color:var(--text-2)">Total: <b style="color:var(--emerald)">${fmtB(totalGc)}</b></div>` : '<div style="color:var(--emerald)">Aucun cache global significatif</div>',
        actions: gc.length > 0 ? `<button class="btn btn-sm" onclick="closeGuide();go('caches')">Gerer les caches</button>` : ''
    });

    // ─── STEP 6: Docker ───
    loader = renderLoading('Interrogation Docker...');
    const dk = await api('docker');
    removeLoading();
    if (dk.available) {
        const stopped = dk.containers.filter(c => c.state !== 'running');
        renderStep({
            num: 6, done: stopped.length === 0 && dk.volumes.length === 0,
            title: 'Gere tes ressources Docker',
            desc: `${dk.containers.length} containers, ${dk.images.length} images, ${dk.volumes.length} volumes.`,
            data: `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;text-align:center"><div><div style="font-size:20px;font-weight:800">${dk.containers.length}</div><div style="font-size:10px;color:var(--text-3)">Containers (${stopped.length} arretes)</div></div><div><div style="font-size:20px;font-weight:800">${dk.images.length}</div><div style="font-size:10px;color:var(--text-3)">Images</div></div><div><div style="font-size:20px;font-weight:800">${dk.volumes.length}</div><div style="font-size:10px;color:var(--text-3)">Volumes</div></div></div>`,
            actions: `${stopped.length>0?`<button class="btn btn-sm btn-danger" onclick="guideClean('docker_containers','Prune ${stopped.length} containers ?')">Prune containers</button>`:''}<button class="btn btn-sm" onclick="closeGuide();go('docker')">Voir Docker</button>`
        });
    }

    // ─── STEP 7: Ports & Processes ───
    loader = renderLoading('Analyse des processus...');
    const [ports, procs] = await Promise.all([api('ports'), api('processes')]);
    removeLoading();
    const devProcs = procs.filter(p => p.is_dev);
    renderStep({
        num: dk.available ? 7 : 6, done: false,
        title: 'Surveille ports et processus',
        desc: `${ports.length} ports actifs, ${devProcs.length} processus dev en cours.`,
        data: `<div style="max-height:100px;overflow-y:auto">${devProcs.slice(0,5).map(p=>`<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px"><span style="color:var(--sky);font-weight:600;width:100px">${p.name}</span><span class="mono" style="color:${p.memory>300*1024*1024?'var(--rose)':'var(--text-2)'}">${p.memory_h}</span>${p.project_hint?'<span class="badge badge-violet">'+p.project_hint+'</span>':''}</div>`).join('')}</div>`,
        actions: `<button class="btn btn-sm" onclick="closeGuide();go('network')">Voir Reseau</button>`
    });

    // ─── STEP 8: Settings ───
    renderStep({
        num: dk.available ? 8 : 7, done: true,
        title: 'Configure la surveillance',
        desc: 'Le Watcher tourne en arriere-plan et detecte les nouveaux fichiers et events Docker automatiquement.',
        data: `<div style="display:flex;align-items:center;gap:8px"><span class="watcher-dot on" style="width:8px;height:8px"></span><span style="font-size:12px">Watcher: <b style="color:var(--emerald)">actif</b></span></div>`,
        actions: `<button class="btn btn-sm" onclick="closeGuide();go('settings')">Parametres</button>`
    });

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = 'text-align:center;margin-top:24px;padding:20px;background:var(--bg-2);border:1px solid var(--border-0);border-radius:var(--radius)';
    footer.innerHTML = `<div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:4px">Raccourcis: touches 1-8 pour naviguer, R pour rafraichir</div><div style="font-size:11px;color:var(--text-3)">Le dashboard se met a jour en temps reel.</div>`;
    box.appendChild(footer);
}

async function guideClean(action, msg) {
    if (!confirm(msg)) return;
    const loading = document.createElement('div');
    loading.className = 'toast toast-info';
    loading.innerHTML = '<span class="spinner" style="width:12px;height:12px;margin-right:6px;vertical-align:middle"></span> Nettoyage...';
    document.getElementById('toasts').appendChild(loading);
    try {
        const r = await apiPost('clean', { action });
        loading.remove();
        toast(r.success ? r.message : r.message, r.success ? 'success' : 'error');
        setTimeout(() => loadGuide(), 800);
    } catch (e) { loading.remove(); toast('Erreur', 'error'); }
}

async function guideClearBrowsers() {
    if (!confirm('Vider tous les caches navigateur ?\nFerme tes navigateurs pour de meilleurs resultats.')) return;
    const loading = document.createElement('div');
    loading.className = 'toast toast-info';
    loading.innerHTML = '<span class="spinner" style="width:12px;height:12px;margin-right:6px;vertical-align:middle"></span> Nettoyage navigateurs...';
    document.getElementById('toasts').appendChild(loading);
    const browsers = await api('caches/browser');
    for (const b of browsers) { try { await apiPost('clean', { action: 'clear_browser', browser: b.key }); } catch (e) {} }
    loading.remove();
    toast('Caches navigateur vides');
    setTimeout(() => loadGuide(), 800);
}

function guideImportAll() {
    // never bulk-move silently: show the scan list with its move / keep-in-place choice
    closeGuide(); go('projects'); scanProjects();
}

