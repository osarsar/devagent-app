/* Carte — the map of a project: connections, repos, services, machines, automations. */
DA.page({
  id: 'carte', title: 'Carte du projet', icon: '🗺', order: 40,
  async render(root, ctx) {
    const { h, api } = DA;
    if (!ctx.project) { root.append(h('div', { class: 'empty card' }, 'Choisis un projet (en haut a gauche) pour voir sa carte.')); return; }
    const out = await api(`/api/agent/map/${ctx.project}`);
    if (!out.ok) { root.append(h('div', { class: 'empty card' }, out.message)); return; }
    const m = out.result;
    const NS = 'http://www.w3.org/2000/svg';
    const s = (tag, attrs, ...kids) => {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
      for (const k of kids) el.append(k.nodeType ? k : document.createTextNode(k));
      return el;
    };
    const W = 210, H = 46, GX = 70, GY = 14, TOP = 44, LEFT = 20;
    const pos = {};
    let maxRows = 0;
    m.columns.forEach((c, ci) => {
      maxRows = Math.max(maxRows, c.nodes.length);
      c.nodes.forEach((n, ri) => { pos[n.id] = { x: LEFT + ci * (W + GX), y: TOP + ri * (H + GY), n }; });
    });
    const width = LEFT * 2 + m.columns.length * (W + GX) - GX;
    const height = TOP + maxRows * (H + GY) + 20;
    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
      'aria-label': `Carte du projet ${m.project}` });

    const edgeEls = [];
    for (const e of m.edges) {
      const a = pos[e.from], b = pos[e.to];
      if (!a || !b) continue;
      let d;
      if (a.x === b.x) {                       // same column: curve on the right side
        const x = a.x + W, bend = 26 + Math.min(40, Math.abs(a.y - b.y) / 6);
        d = `M${x},${a.y + H / 2} C${x + bend},${a.y + H / 2} ${x + bend},${b.y + H / 2} ${x},${b.y + H / 2}`;
      } else {
        const [l, r] = a.x < b.x ? [a, b] : [b, a];
        const x1 = l.x + W, x2 = r.x, mid = (x1 + x2) / 2;
        d = `M${x1},${l.y + H / 2} C${mid},${l.y + H / 2} ${mid},${r.y + H / 2} ${x2},${r.y + H / 2}`;
      }
      const p = s('path', { d, class: 'map-edge' + (e.dashed ? ' dashed' : '') });
      if (e.label) p.append(s('title', {}, e.label));
      svg.append(p);
      edgeEls.push({ p, e });
    }
    m.columns.forEach((c, ci) => svg.append(s('text', { x: LEFT + ci * (W + GX), y: 24, class: 'map-col' }, c.label)));

    const clip = t => (t && t.length > 30 ? t.slice(0, 29) + '…' : t || '');
    const nodeEls = {};
    const detail = h('div', { class: 'card', hidden: true });
    function focus(id) {
      const linked = new Set([id]);
      for (const { p, e } of edgeEls) {
        const on = id && (e.from === id || e.to === id);
        p.classList.toggle('hl', !!on);
        if (on) { linked.add(e.from); linked.add(e.to); }
      }
      for (const [nid, g] of Object.entries(nodeEls)) g.classList.toggle('dim', !!id && !linked.has(nid));
      if (!id) { detail.hidden = true; return; }
      const n = pos[id].n;
      const deps = m.edges.filter(e => e.from === id).map(e => (pos[e.to] ? pos[e.to].n.label : e.to) + (e.label ? ` (${e.label})` : ''));
      const used = m.edges.filter(e => e.to === id).map(e => (pos[e.from] ? pos[e.from].n.label : e.from));
      detail.hidden = false;
      detail.replaceChildren(
        h('div', { class: 'spread' }, h('h2', {}, n.label), DA.pill(n.kind, n.state)),
        n.sub ? h('div', { class: 'muted' }, n.sub) : null,
        n.detail ? h('p', {}, n.detail) : null,
        deps.length ? h('div', { class: 'small' }, h('b', {}, 'Depend de : '), deps.join(', ')) : null,
        used.length ? h('div', { class: 'small' }, h('b', {}, 'Utilise par : '), used.join(', ')) : null);
    }
    let selected = null;
    for (const { x, y, n } of Object.values(pos)) {
      const g = s('g', { class: 'map-node ' + (n.state || ''), transform: `translate(${x},${y})`, tabindex: 0, role: 'button' },
        s('rect', { width: W, height: H, rx: 8 }),
        s('text', { x: 12, y: n.sub ? 19 : 28 }, clip(n.label)),
        s('text', { x: 12, y: 35, class: 'sub' }, clip(n.sub)),
        s('title', {}, [n.label, n.sub, n.detail].filter(Boolean).join('\n')));
      const pick = () => { selected = selected === n.id ? null : n.id; focus(selected); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
      nodeEls[n.id] = g;
      svg.append(g);
    }

    root.append(
      h('p', { class: 'muted' }, `Ce que contient « ${m.project} » et comment les parties sont liees. `,
        m.services_source ? `Services lus dans ${m.services_source}. ` : 'Aucun service trouve (ni manifeste, ni docker-compose). ',
        'Clique une case pour voir ses liens. ',
        DA.pill('ok', 'ok'), ' ', DA.pill('a regarder', 'warn'), ' ', DA.pill('manquant / en panne', 'bad')),
      ...(m.note ? [h('div', { class: 'card' }, m.note)] : []),
      h('div', { class: 'map-wrap' }, svg), h('div', { style: 'height:14px' }), detail);
  }
});
