/* ═══ Client site: domain + professional email (backend: connections.py) ═══ */
function wsDelegated(need) {
    const ctrl = (window._wsNeeds || {}).controller || wsProjectData?.controller;
    return ctrl && (ctrl.manages || []).includes(need) ? ctrl : null;
}

function delegatedCard(title, ctrl) {
    return `<div class="card mb-8" style="padding:14px"><div class="flex-between"><div>
        <div style="font-size:13px;font-weight:700;color:var(--text-0)">${title}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:3px">Gere par la console <b>${hx(ctrl.name || '')}</b> — rien a saisir ici.</div></div>
        <button class="btn btn-xs btn-primary" onclick="launchProjectConsole(wsProjectId)">Ouvrir la console</button></div></div>`;
}

function dnsRecordsTable(records) {
    if (!records || !records.length) return '';
    return `<div style="overflow-x:auto;margin-top:8px"><table style="font-size:11px"><thead><tr><th>Type</th><th>Nom</th><th>Valeur</th><th>Pourquoi</th></tr></thead><tbody>
        ${records.map(r => `<tr><td class="mono" style="font-weight:700;color:var(--emerald)">${hx(r.type)}${r.priority != null ? ' <span style="color:var(--text-4)">' + r.priority + '</span>' : ''}</td>
            <td class="mono">${hx(r.name)}</td>
            <td class="mono" style="cursor:pointer" title="Copier" onclick="navigator.clipboard.writeText(this.textContent.trim());toast('Copie')">${hx(r.value)}</td>
            <td style="color:var(--text-3)">${hx(r.why || '')}</td></tr>`).join('')}</tbody></table>
        <div style="font-size:10px;color:var(--text-4);margin-top:4px">Clique une valeur pour la copier. Nom « @ » = le domaine lui-meme.</div></div>`;
}

function whenLabel(iso) { return iso ? iso.slice(0, 16).replace('T', ' ') : ''; }

// ── Domain ──
async function loadWsDomain() {
    const box = document.getElementById('ws-domain');
    if (!box || !wsProjectId) return;
    const pid = wsProjectId;
    const ctrl = wsDelegated('domain');
    if (ctrl) { box.innerHTML = delegatedCard('Nom de domaine', ctrl); return; }
    const d = await apiJson('GET', 'projects/' + pid + '/domain');
    if (pid !== wsProjectId || d.success === false) return;
    window._wsDomain = d;
    const c = d.config || {};
    const target = d.expected && d.expected.target;
    const targetTxt = !target ? '<a onclick="wsPickHosting()" style="color:var(--amber);cursor:pointer;text-decoration:underline">pas d\'hebergement : choisis un serveur ou une plateforme</a>'
        : target.kind === 'server' ? 'doit pointer vers <b>' + hx(target.ip || target.host) + '</b> (' + hx(target.name || 'serveur') + ')'
        : 'doit pointer vers <b>' + hx(target.platform) + '</b>';
    if (!c.domain) {
        box.innerHTML = `<div class="card mb-8" style="padding:14px"><div class="flex-between">
            <div><div style="font-size:13px;font-weight:700;color:var(--text-0)">Nom de domaine</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:3px">Le domaine du client, ${targetTxt}.</div></div>
            <button class="btn btn-xs btn-primary" onclick="domForm()">Ajouter le domaine</button></div><div id="dom-form"></div></div>`;
        return;
    }
    const dns = c.dns_result || {};
    const dnsBadge = c.dns_verified ? `<span class="badge badge-emerald" title="verifie le ${hx(whenLabel(c.dns_checked_at))}">DNS OK</span>`
        : c.dns_checked_at ? `<span class="badge" style="background:var(--rose-dim);color:var(--rose)" title="${hx(dns.message || '')}">DNS incorrect</span>`
        : '<span class="badge badge-amber">DNS a verifier</span>';
    const siteBadge = c.site_ok === true ? `<span class="badge badge-emerald" title="verifie le ${hx(whenLabel(c.site_checked_at))}">Site en ligne${c.site_result && c.site_result.https === false ? ' (HTTP)' : ''}</span>`
        : c.site_ok === false ? `<span class="badge" style="background:var(--rose-dim);color:var(--rose)" title="${hx((c.site_result || {}).message || '')}">Site hors ligne</span>` : '';
    const cert = c.site_result && c.site_result.cert_days_left != null ? ` <span style="font-size:10px;color:${c.site_result.cert_days_left < 15 ? 'var(--rose)' : 'var(--text-4)'}">certificat : ${c.site_result.cert_days_left} j</span>` : '';
    box.innerHTML = `<div class="card mb-8" style="padding:14px">
        <div class="flex-between" style="gap:8px;flex-wrap:wrap">
            <div><div style="font-size:13px;font-weight:700;color:var(--text-0)"><a href="https://${hx(c.domain)}" target="_blank" style="color:inherit;text-decoration:none">${hx(c.domain)}</a> ${dnsBadge} ${siteBadge}${cert}</div>
                <div style="font-size:11px;color:var(--text-3);margin-top:3px">${d.registrar_label ? 'Achete chez ' + hx(d.registrar_label) + ' · ' : ''}${targetTxt}</div>
                ${c.dns_checked_at ? `<div style="font-size:11px;color:${c.dns_verified ? 'var(--emerald)' : 'var(--rose)'};margin-top:3px">${hx(dns.message || '')}${dns.www && !dns.www.ok ? ' — www : ' + hx((dns.www.message || 'pas configure')) : ''}</div>` : ''}</div>
            <div class="flex gap-6" style="flex-wrap:wrap">
                <button class="btn btn-xs btn-primary" onclick="domVerify()" ${target ? '' : 'disabled title="Ajoute d\'abord l\'hebergement"'}>Verifier le DNS</button>
                <button class="btn btn-xs" onclick="domSite()">Verifier le site</button>
                ${c.dashboard_url ? `<a class="btn btn-xs" href="${hx(c.dashboard_url)}" target="_blank" style="text-decoration:none">Page DNS (${hx(d.registrar_label || 'registrar')})</a>` : ''}
                <button class="btn btn-xs" onclick="domToggleRecords()">Enregistrements a ajouter</button>
                <button class="btn btn-xs" onclick="domForm()">Modifier</button>
                <button class="btn btn-xs btn-danger" onclick="domRemove()">Retirer</button></div></div>
        <div id="dom-records" style="display:none">${d.expected.records.length ? dnsRecordsTable(d.expected.records) : '<div style="font-size:11px;color:var(--text-4);margin-top:8px">Rien a indiquer tant qu\'il n\'y a ni hebergement ni email pro.</div>'}</div>
        <div id="dom-form"></div></div>`;
}

function domToggleRecords() {
    const el = document.getElementById('dom-records');
    el.style.display = el.style.display === 'none' ? '' : 'none';
}

function domForm() {
    const d = window._wsDomain || { config: {}, registrars: {}, registrars_order: [] };
    const c = d.config || {};
    document.getElementById('dom-form').innerHTML = `<div style="margin-top:10px;padding:10px;border-radius:8px;background:var(--bg-0);border:1px solid var(--border-0)">
        <div class="flex gap-8" style="flex-wrap:wrap">
            <div class="form-group" style="flex:2;min-width:180px"><label>Nom de domaine</label><input class="form-input mono" id="dom-f-name" value="${hx(c.domain || '')}" placeholder="monsite.ma"></div>
            <div class="form-group" style="flex:1;min-width:140px"><label>Achete chez</label><select class="form-input" id="dom-f-reg">${d.registrars_order.map(k => `<option value="${k}" ${c.registrar === k ? 'selected' : ''}>${hx(d.registrars[k])}</option>`).join('')}</select></div>
        </div>
        <div class="form-group"><label>Lien direct vers la page DNS (optionnel)</label><input class="form-input mono" id="dom-f-dash" value="${hx(c.dashboard_url || '')}" placeholder="https://..."></div>
        <div id="dom-f-error" class="alert alert-critical" style="display:none"></div>
        <div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="domSave()">Enregistrer</button><button class="btn btn-xs" onclick="document.getElementById('dom-form').innerHTML=''">Annuler</button></div></div>`;
    document.getElementById('dom-f-name').focus();
}

async function domSave() {
    const body = { domain: document.getElementById('dom-f-name').value, registrar: document.getElementById('dom-f-reg').value, dashboard_url: document.getElementById('dom-f-dash').value };
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/domain', body);
    if (!r.success) return showErr('dom-f-error', r.message);
    toast('Domaine enregistre'); loadWsDomain(); loadWsEmail(); loadWsModel(); refreshPhaseLine();
}

async function domVerify() {
    toast('Verification DNS...', 'info');
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/domain/verify');
    if (!r.success) return toast(r.message, 'error');
    toast(r.result.message, r.result.ok ? undefined : 'error'); loadWsDomain(); loadWsModel(); refreshPhaseLine();
}

async function domSite() {
    toast('Test du site...', 'info');
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/domain/site');
    if (!r.success) return toast(r.message, 'error');
    toast(r.result.message, r.result.ok ? undefined : 'error'); loadWsDomain();
}

async function domRemove() {
    if (!confirm('Retirer le domaine de ce projet ? (rien ne change chez le registrar)')) return;
    const r = await apiJson('DELETE', 'projects/' + wsProjectId + '/connections/domain');
    if (!r.success) return toast(r.message, 'error');
    loadWsDomain(); loadWsEmail(); loadWsModel();
}

// ── Email ──
async function loadWsEmail() {
    const box = document.getElementById('ws-email');
    if (!box || !wsProjectId) return;
    const pid = wsProjectId;
    const ctrl = wsDelegated('email');
    if (ctrl) { box.innerHTML = delegatedCard('Email professionnel', ctrl); return; }
    const d = await apiJson('GET', 'projects/' + pid + '/email');
    if (pid !== wsProjectId || d.success === false) return;
    window._wsEmail = d;
    const c = d.config || {};
    if (!c.provider && !(c.addresses || []).length) {
        box.innerHTML = `<div class="card mb-8" style="padding:14px"><div class="flex-between">
            <div><div style="font-size:13px;font-weight:700;color:var(--text-0)">Email professionnel</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:3px">${d.domain ? 'Des adresses sur <b>' + hx(d.domain) + '</b> (' + d.suggested.map(hx).join(', ') + ')' : 'Ajoute d\'abord le domaine, puis le fournisseur d\'email'}</div></div>
            <button class="btn btn-xs btn-primary" onclick="emailForm()">Configurer</button></div><div id="email-form"></div></div>`;
        return;
    }
    const mx = c.mx_result || {};
    const mxBadge = c.mx_verified ? `<span class="badge badge-emerald" title="verifie le ${hx(whenLabel(c.mx_checked_at))}">MX OK</span>`
        : c.mx_checked_at ? `<span class="badge" style="background:var(--rose-dim);color:var(--rose)" title="${hx((mx.mx || {}).message || '')}">MX incorrects</span>`
        : '<span class="badge badge-amber">MX a verifier</span>';
    const auth = mx.auth || {};
    const authTxt = c.mx_checked_at ? ` <span style="font-size:10px;color:${auth.ok ? 'var(--emerald)' : 'var(--amber)'}">SPF ${auth.spf ? 'OK' : 'absent'} · DMARC ${auth.dmarc ? 'OK' : 'absent'}</span>` : '';
    box.innerHTML = `<div class="card mb-8" style="padding:14px">
        <div class="flex-between" style="gap:8px;flex-wrap:wrap">
            <div><div style="font-size:13px;font-weight:700;color:var(--text-0)">Email pro${d.provider_label ? ' — ' + hx(d.provider_label) : ''} ${mxBadge}${authTxt}</div>
                <div style="font-size:11px;color:var(--text-2);margin-top:3px">${(c.addresses || []).length ? (c.addresses || []).map(a => '<span class="mono">' + hx(a) + '</span>').join(', ') : '<span style="color:var(--text-4)">aucune adresse notee</span>'}</div>
                ${c.mx_checked_at && mx.mx ? `<div style="font-size:11px;color:${c.mx_verified ? 'var(--emerald)' : 'var(--rose)'};margin-top:3px">${hx(mx.mx.message || '')}</div>` : ''}</div>
            <div class="flex gap-6" style="flex-wrap:wrap">
                <button class="btn btn-xs btn-primary" onclick="emailVerify()">Verifier les MX</button>
                ${c.webmail_url ? `<a class="btn btn-xs" href="${hx(c.webmail_url)}" target="_blank" style="text-decoration:none">Webmail</a>` : ''}
                ${c.dashboard_url ? `<a class="btn btn-xs" href="${hx(c.dashboard_url)}" target="_blank" style="text-decoration:none">Admin</a>` : ''}
                <button class="btn btn-xs" onclick="emailForm()">Modifier</button>
                <button class="btn btn-xs btn-danger" onclick="emailRemove()">Retirer</button></div></div>
        <div id="email-form"></div></div>`;
}

function emailForm() {
    const d = window._wsEmail || { config: {}, providers: {}, providers_order: [], suggested: [] };
    const c = d.config || {};
    document.getElementById('email-form').innerHTML = `<div style="margin-top:10px;padding:10px;border-radius:8px;background:var(--bg-0);border:1px solid var(--border-0)">
        <div class="form-group"><label>Fournisseur</label><select class="form-input" id="em-f-prov"><option value="">— choisir —</option>${d.providers_order.map(k => `<option value="${k}" ${c.provider === k ? 'selected' : ''}>${hx(d.providers[k])}</option>`).join('')}</select></div>
        <div class="form-group"><label>Adresses creees (separees par des virgules)</label><input class="form-input mono" id="em-f-addr" value="${hx((c.addresses || []).join(', '))}" placeholder="${hx(d.suggested.join(', ') || 'contact@monsite.ma')}"></div>
        <div class="flex gap-8" style="flex-wrap:wrap">
            <div class="form-group" style="flex:1;min-width:160px"><label>Webmail (optionnel)</label><input class="form-input mono" id="em-f-web" value="${hx(c.webmail_url || '')}"></div>
            <div class="form-group" style="flex:1;min-width:160px"><label>Admin (optionnel)</label><input class="form-input mono" id="em-f-admin" value="${hx(c.dashboard_url || '')}"></div></div>
        <div id="em-f-error" class="alert alert-critical" style="display:none"></div>
        <div class="flex gap-6"><button class="btn btn-xs btn-primary" onclick="emailSave()">Enregistrer</button><button class="btn btn-xs" onclick="document.getElementById('email-form').innerHTML=''">Annuler</button></div></div>`;
}

async function emailSave() {
    const body = { provider: document.getElementById('em-f-prov').value, addresses: document.getElementById('em-f-addr').value,
                   webmail_url: document.getElementById('em-f-web').value, dashboard_url: document.getElementById('em-f-admin').value };
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/email', body);
    if (!r.success) return showErr('em-f-error', r.message);
    toast('Email pro enregistre'); loadWsEmail(); loadWsDomain(); loadWsModel(); refreshPhaseLine();
}

async function emailVerify() {
    toast('Verification des MX...', 'info');
    const r = await apiJson('POST', 'projects/' + wsProjectId + '/email/verify');
    if (!r.success) return toast(r.message, 'error');
    toast(r.result.mx.message, r.result.ok ? undefined : 'error'); loadWsEmail(); loadWsModel(); refreshPhaseLine();
}

async function emailRemove() {
    if (!confirm('Retirer l\'email pro de ce projet ?')) return;
    const r = await apiJson('DELETE', 'projects/' + wsProjectId + '/connections/email');
    if (!r.success) return toast(r.message, 'error');
    loadWsEmail(); loadWsDomain(); loadWsModel();
}

