/* ═══ Roadmap: phases and steps of the project (backend: phases.py) ═══ */
const STEP_ICON = { done: '✓', delegated: '↗', partial: '◐', todo: '○' };
const STEP_COLOR = { done: 'var(--emerald)', delegated: 'var(--sky)', partial: 'var(--amber)', todo: 'var(--text-4)' };

// where each step is done in the workspace
function stepGo(action, need) {
    const delegated = need && wsDelegated(need);
    if (delegated) { wsTab('connections'); return; }
    switch (action) {
        case 'model': return openModelModal(wsProjectId);
        case 'github': return openLinkTerminal(wsProjectId);
        case 'prompt': return wsTab('prompt');
        case 'git': return wsTab('git');
        case 'terminal': if (xterm) xterm.focus(); return;
        case 'hosting': wsTab('connections'); setTimeout(() => { if (!(window._wsServers || []).length) wsPickHosting(); else document.getElementById('ws-servers')?.scrollIntoView({ behavior: 'smooth' }); }, 500); return;
        case 'domain': wsTab('connections'); setTimeout(() => document.getElementById('ws-domain')?.scrollIntoView({ behavior: 'smooth' }), 500); return;
        case 'email': wsTab('connections'); setTimeout(() => document.getElementById('ws-email')?.scrollIntoView({ behavior: 'smooth' }), 500); return;
        default: return wsTab('connections');
    }
}

function phaseStepper(r, compact) {
    return `<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">${r.phases.map((p, i) => {
        const cur = p.state === 'current', done = p.state === 'done';
        return `<span title="${hx(p.desc)} — ${p.done}/${p.total}" style="font-size:${compact ? 11 : 12}px;padding:2px 8px;border-radius:12px;
            ${cur ? 'background:rgba(109,92,255,.18);color:var(--violet);font-weight:700;border:1px solid var(--violet)' : done ? 'color:var(--emerald)' : 'color:var(--text-4)'}">
            ${done ? '✓ ' : ''}${hx(p.label)}</span>${i < r.phases.length - 1 ? '<span style="color:var(--text-4)">›</span>' : ''}`;
    }).join('')}</div>`;
}

async function loadWsRoadmap() {
    const el = document.getElementById('ws-roadmap');
    if (!el || !wsProjectId) return;
    const pid = wsProjectId;
    const r = await apiJson('GET', 'projects/' + pid + '/roadmap');
    if (pid !== wsProjectId) return;
    if (r.success === false) { el.innerHTML = `<div class="alert alert-warning">${hx(r.message)}</div>`; return; }
    window._wsRoadmap = r;
    renderPhaseLine(r);
    wsBadge('roadmap', r.total ? (r.total - r.done) : null, false);
    if (!r.phases.length) {
        el.innerHTML = `<div class="card" style="padding:16px"><div style="font-size:12px;color:var(--text-3)">Choisis d'abord le type du projet : la feuille de route en decoule.</div>
            <button class="btn btn-sm btn-primary mt-8" onclick="openModelModal(wsProjectId)">Type &amp; besoins</button></div>`;
        return;
    }
    const nextBox = r.next ? `<div class="card mb-8" style="padding:12px 14px;border-color:var(--violet);background:rgba(109,92,255,.06)">
            <div style="font-size:11px;color:var(--violet);font-weight:700;text-transform:uppercase;letter-spacing:.3px">Prochaine etape · ${hx(r.current_label)}</div>
            <div class="flex-between" style="gap:8px;flex-wrap:wrap;margin-top:4px">
                <div><div style="font-size:13px;font-weight:700;color:var(--text-0)">${hx(r.next.label)}</div><div style="font-size:11px;color:var(--text-3)">${hx(r.next.hint || '')}${r.next.detail ? ' — ' + hx(r.next.detail) : ''}</div></div>
                <div class="flex gap-6">${r.next.manual ? `<button class="btn btn-xs btn-primary" onclick="stepMark('${r.next.key}', true)">C'est fait</button>` : ''}
                    ${r.next.action ? `<button class="btn btn-xs btn-primary" onclick="stepGo('${r.next.action}', ${r.next.need ? "'" + r.next.need + "'" : 'null'})">Aller</button>` : ''}
                    <button class="btn btn-xs" onclick="stepSkip('${r.next.key}', true)">Plus tard</button></div></div></div>`
        : `<div class="card mb-8" style="padding:12px 14px;border-color:var(--emerald)"><div style="font-size:13px;font-weight:700;color:var(--emerald)">Feuille de route terminee — le site est en production</div>
            <div style="font-size:11px;color:var(--text-3)">Une modification ? Le cycle reprend : developpement → push → deploiement. Ajoute une etape si besoin.</div></div>`;
    el.innerHTML = nextBox + r.phases.map(p => `<div class="card mb-8" style="padding:12px 14px;${p.state === 'current' ? 'border-color:var(--violet)' : ''}">
        <div class="flex-between" style="margin-bottom:6px">
            <div><span style="font-size:13px;font-weight:700;color:${p.state === 'done' ? 'var(--emerald)' : p.state === 'current' ? 'var(--violet)' : 'var(--text-0)'}">${p.state === 'done' ? '✓ ' : ''}${hx(p.label)}</span>
                <span style="font-size:11px;color:var(--text-4);margin-left:6px">${p.done}/${p.total}</span>
                ${p.state === 'current' ? '<span class="badge badge-violet" style="margin-left:6px">en cours</span>' : ''}</div>
            <button class="btn btn-xs" onclick="stepAddCustom('${p.key}')" title="Une etape propre a ce projet">+ Etape</button></div>
        <div style="font-size:10px;color:var(--text-4);margin-bottom:6px">${hx(p.desc)}</div>
        ${p.steps.map(s => stepRow(s)).join('')}</div>`).join('');
}

function stepRow(s) {
    const c = s.skipped ? 'var(--text-4)' : STEP_COLOR[s.state] || 'var(--text-4)';
    const icon = s.skipped ? '→' : (STEP_ICON[s.state] || '○');
    const canTick = (s.manual || s.custom) && s.state !== 'delegated';
    return `<div class="step-row" data-key="${hx(s.key)}" style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px solid var(--border-0);${s.skipped ? 'opacity:.55' : ''}">
        ${canTick ? `<input type="checkbox" ${s.state === 'done' ? 'checked' : ''} onchange="stepMark('${hx(s.key)}', this.checked)" style="accent-color:var(--emerald);margin-top:3px" title="Cocher quand c'est fait">`
                  : `<span style="color:${c};font-weight:700;width:14px;text-align:center;margin-top:1px" title="${hx(s.state)}">${icon}</span>`}
        <div style="flex:1;min-width:0">
            <div style="font-size:12px;color:${s.state === 'done' ? 'var(--text-3)' : 'var(--text-0)'};${s.state === 'done' && !s.custom ? 'text-decoration:line-through' : ''}">${hx(s.label)}${s.custom ? ' <span class="badge" style="font-size:9px">perso</span>' : ''}${s.skipped ? ' <span class="badge badge-amber" style="font-size:9px">plus tard</span>' : ''}${s.state === 'delegated' ? ' <span class="badge badge-sky" style="font-size:9px">via console</span>' : ''}</div>
            <div style="font-size:10px;color:${s.state === 'partial' ? 'var(--amber)' : 'var(--text-4)'}">${hx(s.detail || s.hint || '')}</div></div>
        <div class="flex gap-4" style="flex-shrink:0">
            ${s.action && s.state !== 'done' && s.state !== 'delegated' ? `<button class="btn btn-xs" onclick="stepGo('${s.action}', ${s.need ? "'" + s.need + "'" : 'null'})">Aller</button>` : ''}
            ${s.state !== 'done' && s.state !== 'delegated' ? (s.skipped ? `<button class="btn btn-xs" onclick="stepSkip('${hx(s.key)}', false)">Reprendre</button>` : `<button class="btn btn-xs" onclick="stepSkip('${hx(s.key)}', true)" title="Ne bloque pas : a faire plus tard">Plus tard</button>`) : ''}
            ${s.custom ? `<button class="btn btn-xs btn-danger" onclick="stepRemove('${hx(s.key)}')" title="Supprimer cette etape">×</button>` : ''}</div></div>`;
}

function renderPhaseLine(r) {
    const line = document.getElementById('ws-phase-line');
    if (!line) return;
    if (!r.phases.length) { line.style.display = 'none'; return; }
    line.style.display = 'flex';
    line.className = 'phase2';
    const seg = r.phases.map(p => {
        const pct = p.state === 'done' ? 100 : p.total ? Math.round(p.done * 100 / p.total) : 0;
        return `<div class="ph ${hx(p.state)}" title="${hx(p.desc)} — ${p.done}/${p.total}">
            <div class="ph-bar"><i style="width:${pct}%"></i></div>
            <span>${p.state === 'done' ? '✓ ' : ''}${hx(p.label)}</span></div>`;
    }).join('');
    line.innerHTML = `<div class="ph-steps">${seg}</div>
        <div class="ph-next">${r.next
            ? `<span class="eyebrow">Prochaine etape</span><b>${hx(r.next.label)}</b>`
            : '<b style="color:var(--emerald)">En production</b>'}</div>
        <button class="btn btn-xs" onclick="wsAsk('Montre-moi la feuille de route de ce projet et ce qui reste a faire.')">${uiIcon('spark', 11)} Feuille de route</button>`;
}

async function refreshPhaseLine() {
    if (!wsProjectId) return;
    const r = await apiJson('GET', 'projects/' + wsProjectId + '/roadmap');
    if (r.success !== false) { window._wsRoadmap = r; renderPhaseLine(r); wsBadge('roadmap', r.total ? (r.total - r.done) : null, false); }
}

async function stepSkip(key, later) {
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/roadmap/skip', { key: key, later: later });
    if (!r.success) return toast(r.message, 'error');
    toast(later ? 'Etape mise de cote (a faire plus tard)' : 'Etape reprise'); loadWsRoadmap(); loadProjects();
}

async function stepMark(key, done) {
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/roadmap/mark', { key: key, done: done });
    if (!r.success) { toast(r.message, 'error'); loadWsRoadmap(); return; }
    loadWsRoadmap(); loadProjects();
}

async function stepAddCustom(phase) {
    const label = prompt('Nom de l\'etape a ajouter dans cette phase :');
    if (!label || !label.trim()) return;
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/roadmap/custom', { phase: phase, label: label.trim() });
    if (!r.success) return toast(r.message, 'error');
    loadWsRoadmap();
}

async function stepRemove(key) {
    const r = await apiJson('DELETE', 'projects/' + wsProjectId + '/roadmap/custom/' + encodeURIComponent(key));
    if (!r.success) return toast(r.message, 'error');
    loadWsRoadmap();
}

/* ═══ Project type & needs (backend: model.py) ═══ */
let modelMeta = null;          // {profiles, needs}
let modelEditing = null;       // {pid, profile, needs}
const NEED_STATE = {
    ok: { cls: 'badge-emerald', dot: 'var(--emerald)', label: 'OK' },
    delegated: { cls: 'badge-sky', dot: 'var(--sky)', label: 'via console' },
    partial: { cls: 'badge-amber', dot: 'var(--amber)', label: 'a verifier' },
    missing: { cls: '', dot: 'var(--text-4)', label: 'manque' },
};
// where each need is handled in the workspace
const NEED_GO = {
    github: () => openLinkTerminal(wsProjectId),
    domain: () => { wsTab('connections'); setTimeout(() => document.getElementById('ws-domain')?.scrollIntoView({ behavior: 'smooth' }), 500); },
    email: () => { wsTab('connections'); setTimeout(() => document.getElementById('ws-email')?.scrollIntoView({ behavior: 'smooth' }), 500); },
    hosting: () => { wsTab('connections'); setTimeout(() => wsPickHosting(), 400); },
    controller: () => wsTab('connections'),
};

async function modelLoadMeta() {
    if (!modelMeta) modelMeta = await api('model/profiles');
    return modelMeta;
}

function needChip(x, clickable) {
    const st = NEED_STATE[x.state] || NEED_STATE.missing;
    const title = hx((x.detail ? x.label + ' — ' + x.detail : x.label));
    const onclick = clickable ? ` onclick="needGo('${x.need}')" style="cursor:pointer"` : '';
    return `<span class="badge ${st.cls}" title="${title}"${onclick}><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${st.dot};margin-right:4px"></span>${hx(x.label)}</span>`;
}

function needGo(need) {
    const fn = NEED_GO[need];
    if (fn) return fn();
    wsTab('connections');
}

// Workspace: the bar under the title
async function loadWsModel() {
    const bar = document.getElementById('ws-model-bar');
    if (!bar || !wsProjectId) return;
    const pid = wsProjectId;
    const st = await apiJson('GET', 'projects/' + pid + '/needs');
    if (pid !== wsProjectId || st.success === false) return;
    window._wsNeeds = st;
    wsBadge('connections', st.missing.length, true);
    const typ = st.profile ? `<b>${hx(st.label)}</b>` : '<span style="color:var(--amber)">Type non defini</span>';
    const ctrl = st.controller ? ` · <span class="badge badge-sky" title="Ce projet a sa propre console">${hx(st.controller.name || 'console')}</span>` : '';
    const chips = st.needs.length ? st.needs.map(x => needChip(x, true)).join(' ') : '<span style="font-size:11px;color:var(--text-4)">aucun besoin defini</span>';
    const miss = st.missing.length ? `<span style="font-size:11px;color:var(--amber);margin-left:6px">Il manque : ${st.missing.map(x => hx(x.label)).join(', ')}</span>` : (st.total ? '<span style="font-size:11px;color:var(--emerald);margin-left:6px">Projet complet</span>' : '');
    bar.style.display = 'flex';
    bar.innerHTML = `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px">
            <span>${typ}${ctrl}</span><span style="color:var(--text-4)">${st.done}/${st.total}</span>${chips}${miss}</div>
        <button class="btn btn-xs" onclick="openModelModal(${pid})">Type &amp; besoins</button>`;
}

async function openModelModal(pid) {
    const meta = await modelLoadMeta();
    const m = await apiJson('GET', 'projects/' + pid + '/model');
    if (m.success === false) return toast(m.message, 'error');
    modelEditing = { pid: pid, profile: m.profile, needs: [...m.needs] };
    showErr('model-error', '');
    modelRender();
    showModal('model-modal');
}

function modelRender() {
    const meta = modelMeta, e = modelEditing;
    document.getElementById('model-profiles').innerHTML = meta.profiles_order.map(k => [k, meta.profiles[k]]).map(([k, p]) => `
        <div class="card" data-k="${k}" onclick="modelPick(this.dataset.k)" style="padding:10px 12px;cursor:pointer;${e.profile === k ? 'border-color:var(--violet);background:rgba(109,92,255,.08)' : ''}">
            <div style="font-size:13px;font-weight:700;color:var(--text-0)">${p.icon} ${hx(p.label)}</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">${hx(p.desc)}</div></div>`).join('');
    document.getElementById('model-needs').innerHTML = meta.needs_order.map(k => [k, meta.needs[k]]).map(([k, n]) => `
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;padding:4px 0;cursor:pointer">
            <input type="checkbox" class="model-need" data-k="${k}" ${e.needs.includes(k) ? 'checked' : ''} style="accent-color:var(--violet);margin-top:2px">
            <span><b>${hx(n.label)}</b><br><span style="font-size:10px;color:var(--text-4)">${hx(n.desc)}</span></span></label>`).join('');
}

function modelPick(k) {
    modelEditing.profile = k;
    modelEditing.needs = [...modelMeta.profiles[k].needs];
    modelRender();
}

async function modelSave() {
    const needs = [...document.querySelectorAll('.model-need:checked')].map(x => x.dataset.k);
    const r = await apiJson('PUT', 'projects/' + modelEditing.pid + '/model', { profile: modelEditing.profile, needs: needs });
    if (!r.success) return showErr('model-error', r.message);
    closeModals();
    toast('Type et besoins enregistres');
    if (currentPage === 'workspace' && wsProjectId === modelEditing.pid) { loadWsModel(); refreshPhaseLine(); if (document.getElementById('ws-roadmap').classList.contains('active')) loadWsRoadmap(); }
    loadProjects();
}

