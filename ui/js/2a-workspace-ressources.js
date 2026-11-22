/* ═══ Ressources d'un projet : le disque toujours, RAM / CPU / GPU en direct quand il tourne ═══
   Couleurs des parts du disque : ordre fixe (dependances, builds, git, code), validees pour le
   daltonisme sur le fond sombre ; chaque part a aussi son nom et sa taille en legende. */
const RES_COLORS = { deps: '#3987e5', builds: '#d95926', git: '#199e70', code: '#c98500' };
let wsRes = null, wsResTimer = null;

const _wsViewRes = wsView, _wsViewMarkRes = _wsViewMark;
_wsViewMark = function (v) {
    _wsViewMarkRes(v);
    document.getElementById('ws-ressources').style.display = v === 'ressources' ? 'block' : 'none';
};
wsView = function (v) {
    clearTimeout(wsResTimer);
    if (v !== 'ressources') return _wsViewRes(v);
    if (wsPrevOn) _wsToggleViewBase(false);
    document.getElementById('ws-xterm').style.display = 'none';
    _wsViewMark('ressources');
    loadWsRes();
};

async function loadWsRes(remeasure) {
    const pid = wsProjectId;
    clearTimeout(wsResTimer);
    const r = await fetch(`/api/agent/ressources/${pid}${remeasure ? '?remesurer=1' : ''}`).then(x => x.json()).catch(() => null);
    if (pid !== wsProjectId || wsViewCur !== 'ressources') return;
    if (r) { wsRes = r; renderWsRes(); }
    wsResTimer = setTimeout(loadWsRes, 3000);          // live, while the view is open
}

function resAgo(seconds) {
    if (seconds === undefined || seconds === null) return '';
    const m = Math.round(seconds / 60);
    return m < 1 ? 'a l\'instant' : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`;
}

/* a small curve, one series: 2px line, light area, the last value marked; hover shows the value */
function resSpark(points, max, fmt, key) {
    const w = 220, h = 44;
    if (points.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"></svg>`;
    const top = Math.max(max || 0, ...points.map(p => p[1])) || 1;
    const xy = points.map((p, i) => [i * w / (points.length - 1), h - 3 - (p[1] / top) * (h - 8)]);
    const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const [lx, ly] = xy[xy.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" data-key="${key}"
                onmousemove="resSparkHover(event, this)" onmouseleave="resSparkHover(null, this)">
        <polygon points="0,${h} ${line} ${w},${h}" class="spark-area"/>
        <polyline points="${line}" class="spark-line" vector-effect="non-scaling-stroke"/>
        <line class="spark-cross" x1="0" x2="0" y1="0" y2="${h}" vector-effect="non-scaling-stroke" style="display:none"/>
        <circle cx="${lx}" cy="${ly}" r="3" class="spark-dot" vector-effect="non-scaling-stroke"/></svg>`;
}
function resSparkHover(ev, svg) {
    const tile = svg.closest('.res-tile'), out = tile.querySelector('.res-hover'), cross = svg.querySelector('.spark-cross');
    const key = svg.dataset.key, hist = (wsRes && wsRes.live.historique) || [];
    if (!ev || hist.length < 2) { out.textContent = ''; cross.style.display = 'none'; return; }
    const r = svg.getBoundingClientRect(), i = Math.round((ev.clientX - r.left) / r.width * (hist.length - 1));
    const p = hist[Math.max(0, Math.min(hist.length - 1, i))];
    const x = (i / (hist.length - 1)) * 220;
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.style.display = '';
    const v = { cpu: p[1].toFixed(1).replace('.', ',') + ' %', ram: octets(p[2]), gpu: octets(p[3]) }[key];
    out.textContent = `${new Date(p[0] * 1000).toLocaleTimeString('fr-FR')} · ${v}`;
}

function renderWsRes() {
    const el = document.getElementById('ws-ressources'), r = wsRes;
    if (!el || !r) return;
    const d = r.disque, l = r.live, m = r.machine;
    const q = t => hx(JSON.stringify(t));

    /* ── disk ── */
    let disk;
    if (!d) disk = '<div class="st-sub">Le dossier du projet est introuvable sur ce PC.</div>';
    else if (!d.total) disk = `<div class="st-sub"><span class="dev-spin"></span> mesure en cours… (une grosse base de donnees peut prendre une minute)</div>`;
    else {
        const parts = d.parts.filter(p => p.taille > 0);
        const seg = parts.map(p => `<i style="flex:${Math.max(p.taille / d.total, 0.004)};background:${RES_COLORS[p.cle]}"
                title="${hx(p.nom)} : ${octets(p.taille)} (${Math.round(p.taille * 100 / d.total)} %)"></i>`).join('');
        const legend = d.parts.map(p => `<div class="res-leg"><span class="res-sw" style="background:${RES_COLORS[p.cle]}"></span>
                <span class="res-leg-name">${hx(p.nom)}${p.dossiers > 1 ? ` <span class="st-sub">· ${p.dossiers} dossiers</span>` : ''}</span>
                <b>${octets(p.taille)}</b><span class="st-sub res-pct">${Math.round(p.taille * 100 / d.total)} %</span></div>`).join('');
        const big = (d.plus_gros || []);
        const bigMax = Math.max(...big.map(b => b.taille), 1);
        const bigRows = big.map(b => `<div class="res-big"><span class="res-big-name mono">${hx(b.chemin)}</span>
                <span class="res-big-bar"><i style="width:${(b.taille / bigMax * 100).toFixed(1)}%"></i></span><b>${octets(b.taille)}</b></div>`).join('');
        const vols = (d.docker || []).filter(v => v.taille > 0);
        disk = `<div class="res-total"><span class="res-big-num">${octets(d.total)}</span>
                  <span class="st-sub">sur le disque · mesure ${resAgo(d.age_s)}${d.en_cours ? ' · <span class="dev-spin"></span> nouvelle mesure' : ''}</span></div>
            <div class="res-bar" role="img" aria-label="Repartition du disque">${seg}</div>
            <div class="res-legend">${legend}</div>
            ${big.length ? `<div class="res-sub-title">Les plus gros dossiers</div>${bigRows}` : ''}
            ${vols.length ? `<div class="res-sub-title">Volumes Docker <span class="st-sub">(en plus du dossier)</span></div>` + vols.map(v =>
                `<div class="res-big"><span class="res-big-name mono">${hx(v.nom)}</span><span></span><b>${octets(v.taille)}</b></div>`).join('') : ''}
            <div class="todo-actions" style="padding:10px 0 0">
              <button class="btn btn-xs btn-primary" onclick="showCleanupPreview(${wsProjectId})">Liberer de la place</button>
              <button class="btn btn-xs" onclick="wsAsk(${q('Aide-moi a liberer de la place sur ce projet : que puis-je supprimer sans risque ? Regarde projet_ressources.')})">${uiIcon('spark', 11)} Demander a l'agent</button>
            </div>`;
    }

    /* ── live ── */
    let live;
    if (!l.en_marche) {
        live = `<div class="res-off"><span class="st-dot off"></span><div><b>Ne tourne pas en ce moment</b>
            <div class="st-sub">Lance-le (vue Etat) et sa consommation s'affiche ici, en direct.</div></div>
            <button class="btn btn-xs" onclick="wsView('etat')">Voir l'etat</button></div>`;
    } else {
        const h = l.historique || [];
        const tiles = [
            ['cpu', 'CPU', l.cpu.toFixed(1).replace('.', ',') + ' %', `du PC (${m.coeurs} coeurs)`, 100],
            ['ram', 'RAM', octets(l.ram), `sur ${octets(m.ram)}`, m.ram],
            ['gpu', 'Memoire GPU', octets(l.gpu), m.gpu ? `sur ${octets(m.gpu.memoire)} · ${hx(m.gpu.nom)}` : 'pas de GPU', m.gpu ? m.gpu.memoire : 0],
        ].map(([k, label, val, sub, max], i) => `<div class="res-tile">
            <div class="eyebrow">${label}</div><div class="res-val">${val}</div><div class="st-sub">${sub}</div>
            ${resSpark(h.map(p => [p[0], p[i + 1]]), k === 'cpu' ? 0 : 0, null, k)}
            <div class="res-hover st-sub"></div></div>`).join('');
        const rows = [...l.conteneurs.map(c => ({ ...c, kind: 'conteneur' })), ...l.processus.map(p => ({ ...p, kind: 'processus' }))]
            .sort((a, b) => b.ram - a.ram).slice(0, 10);
        live = `<div class="res-tiles">${tiles}</div>
            <div class="res-sub-title">Ce qui consomme</div>
            <table class="res-table"><thead><tr><th>Nom</th><th>Type</th><th class="num">RAM</th><th class="num">CPU</th><th class="num">GPU</th></tr></thead><tbody>
            ${rows.map(x => `<tr><td class="mono">${hx(x.nom)}${x.pid ? ` <span class="st-sub">${x.pid}</span>` : ''}</td><td class="st-sub">${x.kind}</td>
                <td class="num">${octets(x.ram)}</td><td class="num">${String(x.cpu).replace('.', ',')} %</td><td class="num">${x.gpu ? octets(x.gpu) : '—'}</td></tr>`).join('')}
            </tbody></table>
            ${l.processus.length + l.conteneurs.length > 10 ? `<div class="st-sub">et ${l.processus.length + l.conteneurs.length - 10} autre(s)</div>` : ''}
            <div class="todo-actions" style="padding:10px 0 0">
              <button class="btn btn-xs" onclick="wsAsk(${q('Regarde ce qui tourne pour ce projet (projet_ressources) et arrete ce qui ne sert pas.')})">${uiIcon('spark', 11)} Demander a l'agent d'arreter ce qui ne sert pas</button></div>`;
    }

    el.innerHTML = `<div class="st-card"><div class="st-head"><h4>${uiIcon('pulse', 12)} En direct</h4>
            ${l.en_marche ? '<span class="res-live"><span class="st-dot ok"></span> mis a jour toutes les 3 s</span>' : ''}</div>${live}</div>
        <div class="st-card"><div class="st-head"><h4>${uiIcon('disk', 12)} Sur le disque</h4>
            <button class="icon-btn" title="Remesurer maintenant" onclick="loadWsRes(true)">${uiIcon('reload')}</button></div>${disk}</div>`;
}
