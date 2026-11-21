/* Proniver — document generator. An extension: loaded only when enabled. */
PAGE_TITLES.proniver = 'Proniver Documents';

/*  PRONIVER DOCUMENT GENERATOR                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
let pnvCurrentRef = null;

async function loadProniver() {
    const clients = await api('proniver/clients');
    const el = document.getElementById('pnv-clients');
    if (!clients.length) {
        el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-4)">Aucun client. Cliquez <b>+ Nouveau client</b> pour commencer.</div>';
        return;
    }
    const scoringColors = {A:'badge-emerald', B:'badge-amber', C:'badge-muted'};
    el.innerHTML = '<table style="width:100%;font-size:12px"><thead><tr>' +
        '<th style="background:var(--bg-2);color:var(--text-2);padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border-0)">Reference</th>' +
        '<th style="background:var(--bg-2);color:var(--text-2);padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border-0)">Etablissement</th>' +
        '<th style="background:var(--bg-2);color:var(--text-2);padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border-0)">Quartier</th>' +
        '<th style="background:var(--bg-2);color:var(--text-2);padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border-0)">Score</th>' +
        '<th style="background:var(--bg-2);color:var(--text-2);padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border-0)">Pack</th>' +
        '<th style="background:var(--bg-2);color:var(--text-2);padding:8px 10px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border-0)">Statut</th>' +
        '</tr></thead><tbody>' +
        clients.map(c => `<tr style="cursor:pointer;border-bottom:1px solid var(--border-0)" onclick="pnvOpenClient('${c.reference}')" onmouseover="this.style.background='var(--bg-2)'" onmouseout="this.style.background=''">
            <td style="padding:8px 10px;font-family:monospace;font-size:11px;color:var(--sky)">${c.reference}</td>
            <td style="padding:8px 10px;font-weight:600">${c.nom}</td>
            <td style="padding:8px 10px;color:var(--text-3)">${c.quartier || '—'}</td>
            <td style="padding:8px 10px;text-align:center"><span class="badge ${scoringColors[c.scoring] || ''}">${c.scoring}</span></td>
            <td style="padding:8px 10px;text-align:center;font-weight:600">${c.pack}</td>
            <td style="padding:8px 10px;text-align:center"><span class="badge">${c.statut}</span></td>
        </tr>`).join('') +
        '</tbody></table>';
}

async function pnvOpenClient(ref) {
    pnvCurrentRef = ref;
    const data = await api('proniver/clients/' + ref);
    if (data.success === false) { toast(data.message, 'error'); return; }

    document.getElementById('pnv-detail-title').textContent = `${data.reference} — ${data.etablissement?.nom || ''}`;
    document.getElementById('pnv-nom').value = data.etablissement?.nom || '';
    document.getElementById('pnv-quartier').value = data.etablissement?.quartier || '';
    document.getElementById('pnv-tel').value = data.etablissement?.telephone || '';
    document.getElementById('pnv-insta').value = data.etablissement?.instagram || '';
    document.getElementById('pnv-avis').value = data.etablissement?.google_avis || 0;
    document.getElementById('pnv-note').value = data.etablissement?.google_note || 0;
    document.getElementById('pnv-dprenom').value = data.decideur?.prenom || '';
    document.getElementById('pnv-dnom').value = data.decideur?.nom || '';
    document.getElementById('pnv-drole').value = data.decideur?.role || '';
    document.getElementById('pnv-demail').value = data.decideur?.email || '';
    document.getElementById('pnv-scoring').value = data.scoring || 'B';
    document.getElementById('pnv-pack').value = data.pack || 'P2';
    document.getElementById('pnv-probleme').value = data.probleme_client || '';
    document.getElementById('pnv-remise').value = data.remise_percent || 0;
    document.getElementById('pnv-domaine').value = data.domaine || '';

    document.getElementById('pnv-section-clients').style.display = 'none';
    document.getElementById('pnv-detail').style.display = 'block';
    pnvLoadDocs();
}

async function pnvSaveClient() {
    if (!pnvCurrentRef) return;
    const data = {
        etablissement: {
            nom: document.getElementById('pnv-nom').value,
            quartier: document.getElementById('pnv-quartier').value,
            telephone: document.getElementById('pnv-tel').value,
            instagram: document.getElementById('pnv-insta').value,
            google_avis: parseInt(document.getElementById('pnv-avis').value) || 0,
            google_note: parseFloat(document.getElementById('pnv-note').value) || 0,
        },
        decideur: {
            prenom: document.getElementById('pnv-dprenom').value,
            nom: document.getElementById('pnv-dnom').value,
            role: document.getElementById('pnv-drole').value,
            email: document.getElementById('pnv-demail').value,
            telephone: document.getElementById('pnv-tel').value,
        },
        scoring: document.getElementById('pnv-scoring').value,
        pack: document.getElementById('pnv-pack').value,
        probleme_client: document.getElementById('pnv-probleme').value,
        remise_percent: parseInt(document.getElementById('pnv-remise').value) || 0,
        domaine: document.getElementById('pnv-domaine').value,
    };
    const res = await apiPut('proniver/clients/' + pnvCurrentRef, data);
    toast(res.message || 'Sauvegarde', res.success !== false ? 'success' : 'error');
}

async function pnvGenerate(docType) {
    if (!pnvCurrentRef) return;
    toast('Generation en cours...', 'success');
    const res = await apiPost('proniver/generate', { reference: pnvCurrentRef, doc_type: docType });
    if (res.success) {
        const count = res.documents?.length || 0;
        toast(`${count} document(s) genere(s)`, 'success');
        pnvLoadDocs();
    } else {
        toast(res.message || 'Erreur', 'error');
    }
}

async function pnvLoadDocs() {
    if (!pnvCurrentRef) return;
    const docs = await api('proniver/documents/' + pnvCurrentRef);
    const el = document.getElementById('pnv-docs');
    if (!docs.length) {
        el.innerHTML = '<span style="color:var(--text-4);font-size:11px">Aucun document genere</span>';
        return;
    }
    el.innerHTML = docs.map(d => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-0);font-size:11px">
        <div>
            <a href="/api/proniver/download/${pnvCurrentRef}/${d.filename}" target="_blank" style="color:var(--sky);text-decoration:none;font-family:monospace;font-size:10px">${d.filename}</a>
            <span style="color:var(--text-4);margin-left:8px">${d.size_h}</span>
        </div>
        <span style="color:var(--text-4);font-size:10px">${d.modified}</span>
    </div>`).join('');
}

function openNewClientModal() {
    document.getElementById('nc-ref').value = 'PRN-26-';
    document.getElementById('nc-nom').value = '';
    document.getElementById('nc-quartier').value = '';
    document.getElementById('nc-tel').value = '';
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('new-client-modal').style.display = 'block';
}

async function pnvCreateClient() {
    const ref = document.getElementById('nc-ref').value.trim();
    const nom = document.getElementById('nc-nom').value.trim();
    if (!ref || !nom) { toast('Reference et nom requis', 'error'); return; }
    const res = await apiPost('proniver/clients', {
        reference: ref,
        nom: nom,
        quartier: document.getElementById('nc-quartier').value.trim(),
        telephone: document.getElementById('nc-tel').value.trim(),
        scoring: document.getElementById('nc-scoring').value,
        pack: document.getElementById('nc-pack').value,
    });
    closeModals();
    if (res.success) {
        toast('Client cree: ' + ref, 'success');
        loadProniver();
    } else {
        toast(res.message, 'error');
    }
}

/* ═══ TAB SWITCHING ═══ */
function pnvSwitchTab(tab) {
    ['entreprise','clients','maquette'].forEach(t => {
        const sec = document.getElementById('pnv-section-' + t);
        const btn = document.getElementById('pnv-tab-' + t);
        if (sec) sec.style.display = t === tab ? '' : 'none';
        if (btn) { btn.style.opacity = t === tab ? '1' : '0.6'; btn.style.borderBottom = t === tab ? '2px solid var(--violet)' : 'none'; btn.style.fontWeight = t === tab ? '600' : '400'; }
    });
    document.getElementById('pnv-detail').style.display = 'none';
    if (tab === 'clients') loadProniver();
    if (tab === 'entreprise') pnvLoadEntrepriseDocs();
    if (tab === 'maquette') maqLoadList();
}

/* ═══ COMPANY DOCUMENTS ═══ */
async function pnvGenEntreprise(docType) {
    toast('Generation en cours...', 'success');
    const res = await apiPost('proniver/entreprise/generate', { doc_type: docType });
    if (res.success) {
        toast(`${res.documents?.length || 0} document(s) genere(s)`, 'success');
        pnvLoadEntrepriseDocs();
    } else {
        toast(res.message || 'Erreur', 'error');
    }
}

async function pnvLoadEntrepriseDocs() {
    const docs = await api('proniver/entreprise/documents');
    docs.forEach(d => {
        const btnView = document.getElementById('pnv-btn-' + d.key);
        const btnDl = document.getElementById('pnv-dl-' + d.key);
        if (btnView) { btnView.style.display = ''; }
        if (btnDl) {
            btnDl.style.display = '';
            btnDl.href = '/api/proniver/entreprise/download/' + d.filename;
        }
    });
}

function pnvPreviewEntreprise(filename) {
    const card = document.getElementById('pnv-preview-card');
    const frame = document.getElementById('pnv-preview-frame');
    const title = document.getElementById('pnv-preview-title');
    const label = filename.replace('.pdf','').replace('.html','').replace(/_/g,' ');
    title.textContent = 'Apercu — ' + label;
    frame.src = '/api/proniver/entreprise/preview/' + filename;
    card.style.display = '';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ═══ FIX BACK TO LIST ═══ */
function pnvBackToList() {
    document.getElementById('pnv-detail').style.display = 'none';
    document.getElementById('pnv-section-clients').style.display = '';
    pnvCurrentRef = null;
    loadProniver();
}

/* ═══ MAQUETTE-APPAT — UNIVERSAL BUILDER WITH LIVE PREVIEW ═══ */
let maqPhotos = [];
const BTYPES = {
    'Restaurant':        { icon:'&#127869;', title:'Notre carte',     cta:'Reservez votre table',     badge:'Restaurant' },
    'Cafe':              { icon:'&#9749;',   title:'Notre carte',     cta:'Passez nous voir',         badge:'Cafe' },
    'Salon de coiffure': { icon:'&#9986;',   title:'Nos prestations', cta:'Prenez rendez-vous',       badge:'Salon de coiffure' },
    'Salle de sport':    { icon:'&#128170;', title:'Nos formules',    cta:'Essai gratuit',            badge:'Salle de sport' },
    'Boulangerie':       { icon:'&#129360;', title:'Nos produits',    cta:'Passez nous voir',         badge:'Boulangerie' },
    'Boutique':          { icon:'&#128717;', title:'Nos produits',    cta:'Decouvrez notre boutique', badge:'Boutique' },
    'Autre':             { icon:'&#128205;', title:'Nos services',    cta:'Contactez-nous',           badge:'' },
};

function maqSlug(n){ return (n||'temp').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

/* ─── Template JS ─── */
function buildMaquetteHTML(d) {
    const bt = BTYPES[d.type] || BTYPES['Autre'];
    const pc = d.couleur1 || '#1B2A4A', ac = d.couleur2 || '#D4A853';
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const heroImg = d.photos[0] ? `<img style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0" src="${d.photos[0]}">` : '';
    const svcs = d.services.filter(s=>s.nom);
    const svcIcons = ['&#128736;','&#9881;','&#128247;','&#9989;','&#127775;','&#128640;','&#128161;','&#127919;'];
    const svcHtml = svcs.map((s,i)=>`<div style="display:flex;gap:16px;padding:24px;background:#fff;border-radius:12px;box-shadow:0 2px 15px rgba(0,0,0,.06)"><div style="width:48px;height:48px;border-radius:50%;background:${pc};color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;border:2px solid rgba(255,255,255,.2)">${svcIcons[i%svcIcons.length]}</div><div><div style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${pc}">${esc(s.nom)}</div>${s.prix?`<div style="font-size:13px;color:${ac};font-weight:600;margin-top:4px">${esc(s.prix)} DH</div>`:''}</div></div>`).join('');
    const galHtml = d.photos.slice(0,3).map(u=>`<div style="text-align:center"><img src="${u}" style="width:100%;height:200px;object-fit:cover;border-radius:8px;border:4px solid #fff;box-shadow:0 4px 20px rgba(0,0,0,.1)"><p style="font-size:12px;color:#777;margin-top:12px;line-height:1.5;padding:0 8px">Photo de l'etablissement</p></div>`).join('') + Array.from({length:Math.max(0,3-d.photos.length)},(_,i)=>`<div style="text-align:center"><div style="width:100%;height:200px;border-radius:8px;background:rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.7);font-size:13px;border:2px dashed rgba(255,255,255,.4)">Photo ${d.photos.length+i+1}</div><p style="font-size:12px;color:rgba(255,255,255,.6);margin-top:12px">Votre photo ici</p></div>`).join('');
    const hrHtml = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'].map((j,i)=>{const h=d.horaires[i];return `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee;font-size:14px"><span style="color:#888">${j}</span><span style="font-weight:600">${h&&h.ferme?'<span style=color:#e74c3c>Ferme</span>':(h?h.ouv+' – '+h.fer:'—')}</span></div>`;}).join('');

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.nom)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:15px;scroll-behavior:smooth}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#333;background:#fff}
img{max-width:100%;display:block}
a{text-decoration:none;color:inherit}
.container{max-width:960px;margin:0 auto;padding:0 40px}
.sec{padding:60px 0}
.sec-title{text-align:center;margin-bottom:40px}
.sec-title h2{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:3px;color:${ac};margin-bottom:8px}
.sec-title h3{font-size:24px;font-weight:800;color:${pc}}
.sec-title p{font-size:14px;color:#888;margin-top:8px;max-width:500px;margin-left:auto;margin-right:auto;line-height:1.6}
.grid-2x2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px}
@media(max-width:700px){.grid-2x2,.grid-3{grid-template-columns:1fr}.container{padding:0 20px}.sec{padding:40px 0}}
</style></head><body>

<!-- ═══ NAV ═══ -->
<nav style="background:${pc};padding:0 40px;position:relative;z-index:10">
<div style="max-width:960px;margin:0 auto;display:flex;justify-content:center;gap:32px;padding:16px 0">
<a href="#home" style="color:rgba(255,255,255,.8);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:2px;transition:color .2s">Home</a>
${d.sec_services?'<a href="#services" style="color:rgba(255,255,255,.8);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:2px">Services</a>':''}
${d.sec_galerie?'<a href="#galerie" style="color:rgba(255,255,255,.8);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:2px">Galerie</a>':''}
${d.sec_contact?'<a href="#contact" style="color:rgba(255,255,255,.8);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:2px">Contact</a>':''}
<a href="#about" style="color:rgba(255,255,255,.8);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:2px">A propos</a>
</div></nav>

<!-- ═══ HERO ═══ -->
<div id="home" style="position:relative;min-height:420px;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;background:linear-gradient(135deg,${pc} 0%,${ac}88 100%)">
${heroImg}
<div style="position:absolute;inset:0;background:linear-gradient(135deg,${pc}cc,${ac}66)"></div>
<div style="position:relative;z-index:1;padding:40px 20px;color:#fff">
<div style="width:64px;height:64px;border:2px solid rgba(255,255,255,.5);border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:28px">${bt.icon}</div>
<h1 style="font-size:32px;font-weight:800;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px">${esc(d.nom)||'Nom du projet'}</h1>
<div style="width:50px;height:2px;background:rgba(255,255,255,.5);margin:0 auto 16px"></div>
<p style="font-size:15px;color:rgba(255,255,255,.85);max-width:500px;margin:0 auto;line-height:1.7">${esc(d.description)||'Votre description apparaitra ici. Remplissez le champ description dans le formulaire.'}</p>
${d.quartier?`<p style="margin-top:16px;font-size:13px;color:rgba(255,255,255,.6)">&#128205; ${esc(d.quartier)}${d.ville?', '+esc(d.ville):''}</p>`:''}
</div></div>

<!-- ═══ SERVICES ═══ -->
${d.sec_services?`<div id="services" class="sec" style="background:#f8f9fa"><div class="container"><div class="sec-title"><h2>${bt.title}</h2>${svcs.length?'':'<p>Ajoutez vos services dans le formulaire</p>'}</div>${svcs.length?`<div class="grid-2x2">${svcHtml}</div>`:''}</div></div>`:''}

<!-- ═══ AVIS GOOGLE ═══ -->
${d.sec_avis&&d.google_note?`<div class="sec" style="background:${pc};color:#fff;text-align:center;padding:40px 20px"><div style="font-size:48px;font-weight:800">${esc(d.google_note)}<span style="font-size:20px;opacity:.6">/5</span></div><div style="font-size:24px;color:${ac};margin:8px 0">&#9733;&#9733;&#9733;&#9733;&#9733;</div><div style="font-size:14px;opacity:.7">${esc(d.google_avis)||'—'} avis sur Google</div></div>`:''}

<!-- ═══ GALERIE ═══ -->
${d.sec_galerie?`<div id="galerie" class="sec" style="background:linear-gradient(135deg,${pc},${ac}88);padding:60px 0 50px"><div class="container"><div class="sec-title"><h2 style="color:rgba(255,255,255,.7)">Galerie</h2><h3 style="color:#fff">Nos realisations</h3></div><div class="grid-3">${galHtml}</div><div style="text-align:center;margin-top:30px"><a style="display:inline-block;padding:12px 40px;border:2px solid rgba(255,255,255,.5);border-radius:30px;color:#fff;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Voir plus</a></div></div></div>`:''}

<!-- ═══ HORAIRES ═══ -->
${d.sec_horaires?`<div class="sec" style="background:#f8f9fa"><div class="container" style="max-width:500px"><div class="sec-title"><h2>Horaires</h2><h3>Horaires d'ouverture</h3></div>${hrHtml}</div></div>`:''}

<!-- ═══ LOCALISATION ═══ -->
${d.sec_localisation?`<div class="sec"><div class="container"><div class="sec-title"><h2>Localisation</h2><h3>Nous trouver</h3></div><div style="background:#f0f0f0;border-radius:12px;height:200px;display:flex;align-items:center;justify-content:center;color:#999;font-size:14px">&#128205; Google Maps — ${esc(d.adresse)||esc(d.quartier)+', '+esc(d.ville)}</div></div></div>`:''}

<!-- ═══ CONTACT ═══ -->
${d.sec_contact?`<div id="contact" style="background:#2c2c2c;color:#fff;padding:50px 0"><div class="container"><div style="display:grid;grid-template-columns:1fr 1fr;gap:40px">
<div><h3 style="font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:24px;color:${ac}">Contact</h3>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
${d.adresse?`<div style="display:flex;gap:12px;align-items:flex-start"><div style="width:36px;height:36px;border-radius:50%;border:1px solid #555;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#127968;</div><div><div style="font-size:13px;font-weight:600">Adresse</div><div style="font-size:12px;color:#999">${esc(d.adresse)}</div></div></div>`:''}
${d.instagram?`<div style="display:flex;gap:12px;align-items:flex-start"><div style="width:36px;height:36px;border-radius:50%;border:1px solid #555;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#128172;</div><div><div style="font-size:13px;font-weight:600">Social</div><div style="font-size:12px;color:#999">${esc(d.instagram)}</div></div></div>`:''}
<div style="display:flex;gap:12px;align-items:flex-start"><div style="width:36px;height:36px;border-radius:50%;border:1px solid #555;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#9993;</div><div><div style="font-size:13px;font-weight:600">Email</div><div style="font-size:12px;color:#999">contact@${esc(d.nom).toLowerCase().replace(/\\s+/g,'')}.ma</div></div></div>
${d.telephone?`<div style="display:flex;gap:12px;align-items:flex-start"><div style="width:36px;height:36px;border-radius:50%;border:1px solid #555;display:flex;align-items:center;justify-content:center;flex-shrink:0">&#128222;</div><div><div style="font-size:13px;font-weight:600">Telephone</div><div style="font-size:12px;color:#999">${esc(d.telephone)}</div></div></div>`:''}
</div></div>
<div><h3 style="font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin-bottom:24px;color:${ac}">Envoyer un message</h3>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px"><input style="padding:12px 14px;border:1px solid #444;background:#3a3a3a;color:#fff;border-radius:6px;font-size:13px" placeholder="Nom"><input style="padding:12px 14px;border:1px solid #444;background:#3a3a3a;color:#fff;border-radius:6px;font-size:13px" placeholder="Email"></div>
<textarea style="width:100%;padding:12px 14px;border:1px solid #444;background:#3a3a3a;color:#fff;border-radius:6px;font-size:13px;height:120px;resize:none;margin-bottom:12px" placeholder="Message"></textarea>
<a href="https://wa.me/212${(d.telephone||'').replace(/\\s/g,'').replace(/^0/,'')}" target="_blank" style="display:inline-block;padding:12px 32px;background:${ac};color:${pc};border-radius:6px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">${bt.cta}</a>
</div></div></div></div>`:''}

<!-- ═══ FOOTER ═══ -->
<div style="background:#222;padding:20px;text-align:center;font-size:11px;color:#666">
&copy; ${new Date().getFullYear()} ${esc(d.nom)}. Tous droits reserves. &nbsp;|&nbsp; Apercu cree par <span style="color:${ac}">Proniver</span>
</div>
</body></html>`;
}

/* ─── Data collection ─── */
function maqCollectData() {
    const services = [];
    document.querySelectorAll('.maq-svc').forEach(row => {
        const nom = row.querySelector('[data-f="nom"]')?.value?.trim();
        const prix = row.querySelector('[data-f="prix"]')?.value?.trim();
        if (nom) services.push({ nom, prix });
    });
    const horaires = [];
    document.querySelectorAll('.maq-hr').forEach(row => {
        horaires.push({ ouv: row.querySelector('[data-f="ouv"]')?.value||'', fer: row.querySelector('[data-f="fer"]')?.value||'', ferme: row.querySelector('[data-f="ferme"]')?.checked });
    });
    return {
        nom: document.getElementById('maq-nom').value.trim(),
        type: document.getElementById('maq-type').value,
        quartier: document.getElementById('maq-quartier').value.trim(),
        ville: document.getElementById('maq-ville').value.trim() || 'Casablanca',
        telephone: document.getElementById('maq-tel').value.trim(),
        description: document.getElementById('maq-desc').value.trim(),
        couleur1: document.getElementById('maq-couleur1').value,
        couleur2: document.getElementById('maq-couleur2').value,
        google_note: document.getElementById('maq-note').value,
        google_avis: document.getElementById('maq-avis').value,
        instagram: document.getElementById('maq-instagram').value.trim(),
        adresse: document.getElementById('maq-adresse').value.trim(),
        sec_services: document.getElementById('maq-sec-services').checked,
        sec_galerie: document.getElementById('maq-sec-galerie').checked,
        sec_horaires: document.getElementById('maq-sec-horaires').checked,
        sec_localisation: document.getElementById('maq-sec-localisation').checked,
        sec_avis: document.getElementById('maq-sec-avis').checked,
        sec_contact: document.getElementById('maq-sec-contact').checked,
        services, horaires, photos: maqPhotos,
    };
}

/* ─── Live preview ─── */
let _maqTimer = null;
function maqSchedulePreview() { clearTimeout(_maqTimer); _maqTimer = setTimeout(maqUpdatePreview, 300); }
function maqUpdatePreview() {
    const d = maqCollectData();
    document.getElementById('maq-preview-frame').srcdoc = buildMaquetteHTML(d);
    // Toggle cards visibility based on checkboxes
    document.getElementById('maq-services-card').style.display = d.sec_services ? '' : 'none';
    document.getElementById('maq-horaires-card').style.display = d.sec_horaires ? '' : 'none';
}

/* ─── Init: event delegation + horaires rows ─── */
function maqInit() {
    // Event delegation for live preview
    const sec = document.getElementById('pnv-section-maquette');
    if (sec) { sec.addEventListener('input', maqSchedulePreview); sec.addEventListener('change', maqSchedulePreview); }
    // Build horaires rows
    const days = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
    const hList = document.getElementById('maq-horaires-list');
    if (hList) hList.innerHTML = days.map(d => `<div class="maq-hr flex gap-6 mb-6" style="align-items:center"><span style="width:70px;font-weight:600;font-size:11px">${d}</span><input class="form-input maq-input" data-f="ouv" type="time" value="09:00" style="flex:1"><span style="color:var(--text-4)">—</span><input class="form-input maq-input" data-f="fer" type="time" value="22:00" style="flex:1"><label style="display:flex;align-items:center;gap:3px;font-size:10px;white-space:nowrap"><input type="checkbox" data-f="ferme" class="maq-input" style="accent-color:var(--red)"> Ferme</label></div>`).join('');
}

/* ─── Services ─── */
function maqAddService() {
    const list = document.getElementById('maq-services-list');
    const div = document.createElement('div');
    div.className = 'maq-svc flex gap-6 mb-6';
    div.innerHTML = '<input class="form-input maq-input" placeholder="Nom" style="flex:2" data-f="nom"><input class="form-input maq-input" placeholder="Prix" style="flex:0 0 70px;text-align:right" data-f="prix"><button class="btn btn-xs" onclick="this.parentElement.remove();maqSchedulePreview()" style="color:var(--red)">&times;</button>';
    list.appendChild(div);
}

/* ─── Photos ─── */
async function maqUploadPhotos(files) {
    const slug = maqSlug(document.getElementById('maq-nom').value);
    for (const file of files) {
        if (maqPhotos.length >= 6) break;
        const fd = new FormData(); fd.append('photo', file); fd.append('slug', slug);
        const res = await fetch('/api/proniver/maquette/upload', { method:'POST', body:fd });
        const data = await res.json();
        if (data.success) maqPhotos.push(data.url);
    }
    maqRenderPhotos(); maqSchedulePreview();
}
function maqRenderPhotos() {
    document.getElementById('maq-photos-grid').innerHTML = maqPhotos.map((url,i) => `<div style="position:relative"><img src="${url}" style="width:100%;height:70px;object-fit:cover;border-radius:6px"><button onclick="maqPhotos.splice(${i},1);maqRenderPhotos();maqSchedulePreview()" style="position:absolute;top:2px;right:2px;background:var(--red);color:#fff;border:none;border-radius:50%;width:16px;height:16px;font-size:9px;cursor:pointer">&times;</button>${i===0?'<div style="position:absolute;bottom:2px;left:2px;background:var(--violet);color:#fff;font-size:7px;padding:1px 5px;border-radius:6px">HERO</div>':''}</div>`).join('');
}

/* ─── Download PDF ─── */
async function maqDownloadPDF() {
    const d = maqCollectData();
    if (!d.nom) { toast('Nom requis', 'error'); return; }
    toast('Generation du PDF...', 'success');
    const html = buildMaquetteHTML(d);
    const res = await apiPost('proniver/maquette/generate', { slug: maqSlug(d.nom), nom: d.nom, quartier: d.quartier, type_activite: d.type, html });
    if (res.success) {
        toast('PDF pret !', 'success');
        window.open(res.pdf_url, '_blank');
        maqLoadList();
    } else toast(res.message||'Erreur','error');
}
async function maqSaveLink() {
    const d = maqCollectData();
    if (!d.nom) { toast('Nom requis', 'error'); return; }
    const html = buildMaquetteHTML(d);
    const res = await apiPost('proniver/maquette/generate', { slug: maqSlug(d.nom), nom: d.nom, quartier: d.quartier, type_activite: d.type, html });
    if (res.success) {
        const url = location.origin + res.html_url;
        navigator.clipboard.writeText(url);
        toast('Lien copie: ' + url, 'success');
        maqLoadList();
    } else toast(res.message||'Erreur','error');
}

/* ─── List ─── */
async function maqLoadList() {
    const list = await api('proniver/maquettes');
    const el = document.getElementById('maq-list');
    if (!list.length) { el.innerHTML = '<span style="color:var(--text-4);font-size:11px">Aucune maquette</span>'; return; }
    el.innerHTML = list.map(m => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-0)"><div style="font-size:12px"><strong>${m.nom}</strong> <span style="color:var(--text-4)">${m.quartier||''}</span></div><div class="flex gap-6">${m.has_html?`<button class="btn btn-xs" onclick="document.getElementById('maq-preview-frame').src='/api/proniver/maquette/preview/${m.slug}'">Voir</button>`:''} ${m.has_pdf?`<a class="btn btn-xs" href="/api/proniver/maquette/download/${m.slug}" target="_blank">PDF</a>`:''}</div></div>`).join('');
}

/* Hook into page navigation */
const _origGo = go;
go = function(page) {
    _origGo(page);
    if (page === 'proniver') {
        pnvLoadEntrepriseDocs();
        if (!window._maqInited) { maqInit(); window._maqInited = true; }
    }
};
