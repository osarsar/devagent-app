/* Documents — the documents of a company (logo, business card, brochures in each language):
   find one, look at it, download it, print it, or ask the agent to change it. */
DA.page({
  id: 'documents', title: 'Documents', icon: '▤', order: 3, global: true,
  async render(root) {
    const { h, api, act, toast } = DA;
    const { projets } = await api('/api/agent/documents');
    if (!projets.length) {
      root.append(h('div', { class: 'empty card' }, 'Aucun projet n\'a encore de liste de documents. ',
        'Demande a l\'agent : « range les documents de mon entreprise (logo, carte de visite, brochures) ».'));
      return;
    }
    let pid = Number(localStorage.getItem('da.docs.projet')) || projets[0].id;
    if (!projets.some(p => p.id === pid)) pid = projets[0].id;
    let lang = localStorage.getItem('da.docs.langue') || 'fr', query = '', data = null;

    const ico = (name, n) => { const s = h('span', { class: 'ico-wrap' }); s.innerHTML = uiIcon(name, n || 15); return s; };
    const fileUrl = (f, dl) => `/api/agent/documents/${pid}/fichier/${encodeURIComponent(f.nom)}?f=${encodeURIComponent(f.chemin)}${dl ? '&dl=1' : ''}`;
    const thumbUrl = f => `/api/agent/documents/${pid}/apercu?f=${encodeURIComponent(f.chemin)}&v=${f.modifie || 0}`;
    const meta = f => [f.type === 'pdf' ? 'PDF' : f.type === 'image' ? f.nom.split('.').pop().toUpperCase() : f.type,
      f.pages ? `${f.pages} page${f.pages > 1 ? 's' : ''}` : null, f.taille ? octets(f.taille) : null].filter(Boolean).join(' · ');
    const LANG = { fr: 'Francais', en: 'English' };

    /* the agent takes the request: its conversation opens in the project */
    async function ask(btn, body) {
      return act(btn, async () => {
        const r = await api(`/api/agent/documents/${pid}/agent`, body);
        if (r && r.ok === false) throw new Error(r.message);
        toast('L\'agent s\'en occupe : tu le suis dans la conversation.', 'ok');
        DA.state.chat = r.chat;
        DA.setProject(pid);
        openWorkspace(pid).then(() => wsTab('agent'));
      });
    }

    /* print without leaving the page: the file in a hidden frame, the browser's print dialog */
    function print(f) {
      const fr = h('iframe', { class: 'doc-print-frame', 'aria-hidden': 'true' });
      if (f.type === 'image') {
        fr.srcdoc = `<!doctype html><html><head><style>@page{margin:10mm}html,body{margin:0;height:100%}body{display:grid;place-items:center}
          img{max-width:100%;max-height:100%}</style></head><body><img src="${fileUrl(f)}" onload="setTimeout(()=>print(),150)"></body></html>`;
      } else {
        fr.src = fileUrl(f);
        fr.onload = () => setTimeout(() => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { window.open(fileUrl(f), '_blank'); } }, 400);
      }
      document.body.append(fr);
      setTimeout(() => fr.remove(), 120000);
    }

    /* the viewer: the whole file, big, with the same actions */
    function view(title, f) {
      const close = () => { back.remove(); document.removeEventListener('keydown', esc, true); };
      const esc = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
      const body = f.type === 'image' ? h('div', { class: 'doc-view-img' }, h('img', { src: fileUrl(f), alt: title }))
        : h('iframe', { class: 'doc-view-frame', src: fileUrl(f), title });
      const back = h('div', { class: 'doc-view-back', onclick: ev => { if (ev.target === back) close(); } },
        h('div', { class: 'doc-view' },
          h('div', { class: 'doc-view-head' },
            h('div', { class: 'grow' }, h('b', {}, title), h('div', { class: 'small muted' }, f.nom, ' · ', meta(f))),
            h('a', { class: 'btn sm', href: fileUrl(f, true) }, ico('download'), ' Telecharger'),
            h('button', { class: 'btn sm', type: 'button', onclick: () => print(f) }, ico('print'), ' Imprimer'),
            h('button', { class: 'icon-btn', type: 'button', title: 'Fermer (Echap)', onclick: close }, ico('close', 16))),
          body));
      document.body.append(back);
      document.addEventListener('keydown', esc, true);
    }

    function fileButtons(title, f) {
      return [
        h('button', { class: 'icon-btn', type: 'button', title: 'Voir', onclick: () => view(title, f) }, ico('eye')),
        h('a', { class: 'icon-btn', href: fileUrl(f, true), title: 'Telecharger' }, ico('download')),
        h('button', { class: 'icon-btn', type: 'button', title: 'Imprimer', onclick: () => print(f) }, ico('print'))];
    }

    function card(d) {
      const langs = d.langues;
      let cur = langs.length ? (langs.includes(lang) ? lang : langs[0]) : '';
      const f = () => d.fichiers[cur];
      const thumb = h('button', { class: 'doc-thumb', type: 'button', title: 'Voir le document' });
      const info = h('div', { class: 'small muted' });
      const actions = h('div', { class: 'doc-actions' });
      const seg = langs.length > 1 ? h('div', { class: 'doc-lang' }) : null;
      function paint() {
        const file = f();
        thumb.replaceChildren(file.existe ? h('img', { src: thumbUrl(file), alt: '', loading: 'lazy' })
          : h('span', { class: 'doc-missing' }, 'Fichier introuvable : ', file.chemin));
        thumb.onclick = () => file.existe && view(d.titre + (cur ? ` (${LANG[cur] || cur})` : ''), file);
        info.textContent = [d.format, file.existe ? (/page/.test(d.format || '') ? meta({ ...file, pages: null }) : meta(file)) : null].filter(Boolean).join(' · ');
        actions.replaceChildren(
          h('button', { class: 'btn sm primary', type: 'button', disabled: !file.existe, onclick: () => view(d.titre, file) }, ico('eye'), ' Voir'),
          h('a', { class: 'btn sm', href: file.existe ? fileUrl(file, true) : null }, ico('download'), ' Telecharger'),
          h('button', { class: 'btn sm', type: 'button', disabled: !file.existe, onclick: () => print(file) }, ico('print'), ' Imprimer'),
          editBtn);
        if (seg) seg.replaceChildren(...langs.map(l => h('button', { type: 'button', class: l === cur ? 'on' : '',
          onclick: () => { cur = l; paint(); } }, l.toUpperCase())));
      }
      /* « Modifier » : a box in the card, the request goes to the agent */
      const box = h('textarea', { rows: 2, placeholder: `Que veux-tu changer ? Ex. « remplace le telephone par … », « ajoute une page sur … »` });
      const send = h('button', { class: 'send-mini', type: 'button', title: 'Envoyer a l\'agent (Ctrl+Entree)' });
      send.innerHTML = uiIcon('up', 16);
      const go = () => box.value.trim() ? ask(send, { doc: d.id, demande: box.value.trim() }) : box.focus();
      send.onclick = go;
      box.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); go(); } });
      const editor = h('div', { class: 'doc-edit', hidden: true },
        h('div', { class: 'todo-reply' }, box, send),
        h('div', { class: 'small muted' }, langs.length > 1 ? 'L\'agent change les sources et refait le fichier dans toutes les langues.'
          : 'L\'agent change les sources et refait le fichier.'));
      const editBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => { editor.hidden = !editor.hidden; if (!editor.hidden) box.focus(); } },
        ico('edit'), ' Modifier');
      const more = d.variantes.length ? h('details', { class: 'doc-more' },
        h('summary', {}, `Autres fichiers (${d.variantes.length})`),
        ...d.variantes.map(v => h('div', { class: 'doc-var' },
          h('div', { class: 'grow' }, h('div', {}, v.label || v.nom), h('div', { class: 'small muted' }, v.existe ? meta(v) : 'introuvable')),
          v.existe ? fileButtons(v.label || d.titre, v) : null))) : null;
      paint();
      return h('div', { class: 'card doc-card', 'data-search': `${d.titre} ${d.categorie} ${d.usage} ${d.variantes.map(v => v.label).join(' ')}`.toLowerCase() },
        thumb,
        h('div', { class: 'doc-title' }, h('h3', {}, d.titre), seg),
        info,
        d.usage ? h('div', { class: 'doc-usage' }, d.usage) : null,
        actions, editor, more);
    }

    function todoCard(a) {
      const box = h('textarea', { rows: 2, placeholder: 'Des precisions ? (facultatif)' });
      const btn = h('button', { class: 'btn sm primary', type: 'button' }, ico('spark'), ' Creer avec l\'agent');
      btn.onclick = () => ask(btn, { creer: a.titre, demande: box.value.trim() });
      const extra = h('div', { class: 'todo-reply doc-todo-box', hidden: true }, box);
      return h('div', { class: 'card doc-todo' },
        h('div', { class: 'doc-todo-mark' }, ico('plus', 16)),
        h('div', { class: 'grow stack tight' }, h('b', {}, a.titre), h('div', { class: 'small muted' }, a.pourquoi), extra),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { extra.hidden = !extra.hidden; if (!extra.hidden) box.focus(); } }, 'Preciser'),
          btn));
    }

    /* ── the page ── */
    const picker = projets.length > 1 ? h('div', { class: 'seg' }) : null;
    const search = h('input', { class: 'input search', type: 'search', placeholder: 'Chercher un document…' });
    const langSeg = h('div', { class: 'seg' });
    const askBox = h('input', { class: 'ask-input', placeholder: 'Demande sur les documents… ex. « fais une version anglaise de la brochure »' });
    const askSend = h('button', { class: 'ask-send', type: 'button', title: 'Envoyer a l\'agent' }, '↑');
    const askGo = () => askBox.value.trim() ? ask(askSend, { demande: askBox.value.trim() }) : askBox.focus();
    askSend.onclick = askGo;
    askBox.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); askGo(); } });
    const list = h('div', { class: 'stack' });
    const heading = h('h1', {});
    root.append(
      h('div', { class: 'docs-hero' }, heading,
        h('div', { class: 'ask' }, h('span', { class: 'ask-mark' }, '✦'), askBox, askSend)),
      h('div', { class: 'phead row spread' },
        h('div', { class: 'row' }, picker, search),
        h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Langue'), langSeg)),
      list);

    function paintLang() {
      langSeg.replaceChildren(...['fr', 'en'].map(l => h('button', { type: 'button', class: l === lang ? 'on' : '',
        onclick: () => { lang = l; localStorage.setItem('da.docs.langue', l); paintLang(); draw(); } }, LANG[l])));
    }
    function paintPicker() {
      if (!picker) return;
      picker.replaceChildren(...projets.map(p => h('button', { type: 'button', class: p.id === pid ? 'on' : '',
        onclick: () => { pid = p.id; localStorage.setItem('da.docs.projet', pid); paintPicker(); load(); } },
        p.entreprise, h('span', { class: 'seg-n' }, p.nb))));
    }
    function draw() {
      if (!data) return;
      heading.replaceChildren('Les documents de ', h('em', {}, data.entreprise));
      const q = query.trim().toLowerCase();
      const groups = {};
      for (const d of data.documents) (groups[d.categorie || 'Autres'] ||= []).push(d);
      const out = [];
      for (const [cat, docs] of Object.entries(groups)) {
        const cards = docs.map(card).filter(c => !q || c.dataset.search.includes(q));
        if (cards.length) out.push(h('section', {}, h('div', { class: 'eyebrow doc-cat' }, cat, ' · ', cards.length), h('div', { class: 'doc-grid' }, cards)));
      }
      if (!out.length) out.push(h('div', { class: 'empty card' }, q ? `Aucun document pour « ${query} ».` : 'Aucun document dans la liste.'));
      const todo = data.a_creer.filter(a => !q || `${a.titre} ${a.pourquoi}`.toLowerCase().includes(q));
      if (todo.length) out.push(h('section', {}, h('div', { class: 'eyebrow doc-cat' }, 'A creer · ', todo.length),
        h('p', { class: 'small muted', style: 'margin:-4px 0 10px' }, 'Les documents dont l\'entreprise a encore besoin. L\'agent les fabrique dans le meme style, en francais et en anglais.'),
        h('div', { class: 'doc-todos' }, todo.map(todoCard))));
      if (data.erreur) out.unshift(h('div', { class: 'note-line' }, data.erreur));
      list.replaceChildren(...out);
    }
    async function load() {
      list.replaceChildren(h('div', { class: 'empty' }, 'Chargement…'));
      data = await api(`/api/agent/documents/${pid}`);
      draw();
    }
    search.addEventListener('input', () => { query = search.value; draw(); });
    paintLang(); paintPicker();
    await load();
  }
});
