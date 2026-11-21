/* ═══════════════════════════════════════════════════════════
   PROJECT SETUP WIZARD
   ═══════════════════════════════════════════════════════════ */
const WIZ_PROFILES = {
    vitrine:     { label: 'Site vitrine',     icon: '🌐', desc: 'Landing page, portfolio, site statique',         components: ['git','deploy'] },
    blog_cms:    { label: 'Blog / CMS',       icon: '📝', desc: 'Blog, site avec contenu dynamique',              components: ['git','database','storage','deploy'] },
    webapp_saas: { label: 'Web App / SaaS',   icon: '🧱', desc: 'Application web avec auth, BDD, cloud',          components: ['git','database','storage','backup','docker','deploy','auth','monitoring','ci_cd','secrets'] },
    api_backend: { label: 'API / Backend',    icon: '⚡', desc: 'API REST/GraphQL, microservices',                components: ['git','database','docker','monitoring','ci_cd','secrets'] },
    mobile:      { label: 'Mobile',           icon: '📱', desc: 'Flutter, React Native...',                       components: ['git','database','storage','ci_cd','secrets'] },
    custom:      { label: 'Personnalise',     icon: '⚙️', desc: 'Choisir les composants manuellement',            components: [] },
};

const WIZ_STEPS = [
    { id: 'profile', title: 'Type de projet', fields: [
        { key: '_profile', label: 'Profil', type: 'profile-cards' },
    ]},
    { id: 'client', title: 'Client & Projet', fields: [
        { key: 'client_name', label: 'Nom du client', type: 'text', placeholder: 'Ex: Restaurant Le Marrakech', required: true },
        { key: 'project_name', label: 'Nom du projet', type: 'text', placeholder: 'Ex: lemarrakech-site', required: true },
        { key: 'project_desc', label: 'Description du site', type: 'textarea', placeholder: 'Decris ce que le client veut : un site vitrine pour son restaurant avec menu, reservations, galerie photos...', required: true },
    ]},
    { id: 'type', title: 'Type de site', fields: [
        { key: 'site_type', label: 'Type', type: 'select', options: [
            ['vitrine', 'Site vitrine (pas de backend)'],
            ['blog', 'Blog / Contenu'],
            ['ecommerce', 'E-commerce'],
            ['saas', 'SaaS / Application web'],
            ['landing', 'Landing page'],
            ['portfolio', 'Portfolio'],
            ['dashboard', 'Dashboard / Admin panel'],
            ['custom', 'Autre'],
        ]},
        { key: 'pages', label: 'Pages principales (une par ligne)', type: 'textarea', placeholder: 'Accueil\nA propos\nMenu\nReservation\nContact' },
        { key: 'multilang', label: 'Multi-langue ?', type: 'select', options: [['no','Non'],['yes','Oui']] },
        { key: 'languages', label: 'Si oui, quelles langues ?', type: 'text', placeholder: 'FR, EN, AR', showIf: 'multilang=yes' },
    ]},
    { id: 'frontend', title: 'Frontend', fields: [
        { key: 'frontend_framework', label: 'Framework', type: 'select', options: [
            ['nextjs', 'Next.js (React)'],
            ['react', 'React (Vite)'],
            ['vue', 'Vue.js'],
            ['nuxt', 'Nuxt (Vue)'],
            ['svelte', 'SvelteKit'],
            ['html', 'HTML/CSS/JS simple'],
            ['astro', 'Astro'],
        ]},
        { key: 'css_framework', label: 'CSS', type: 'select', options: [
            ['tailwind', 'Tailwind CSS'],
            ['bootstrap', 'Bootstrap'],
            ['mui', 'Material UI'],
            ['shadcn', 'shadcn/ui'],
            ['custom', 'CSS custom'],
        ]},
        { key: 'responsive', label: 'Responsive mobile ?', type: 'select', options: [['yes','Oui'],['no','Non']] },
        { key: 'dark_mode', label: 'Dark mode ?', type: 'select', options: [['no','Non'],['yes','Oui']] },
    ]},
    { id: 'backend', title: 'Backend & API', skipUnless: ['_profile=blog_cms','_profile=webapp_saas','_profile=api_backend','_profile=mobile','_profile=custom'], fields: [
        { key: 'needs_backend', label: 'Backend necessaire ?', type: 'select', options: [
            ['yes', 'Oui'],
            ['no', 'Non (site statique)'],
        ]},
        { key: 'backend_framework', label: 'Framework backend', type: 'select', showIf: 'needs_backend=yes', options: [
            ['fastapi', 'FastAPI (Python)'],
            ['flask', 'Flask (Python)'],
            ['express', 'Express (Node.js)'],
            ['nestjs', 'NestJS (Node.js)'],
            ['django', 'Django (Python)'],
            ['laravel', 'Laravel (PHP)'],
        ]},
        { key: 'api_type', label: 'Type API', type: 'select', showIf: 'needs_backend=yes', options: [['rest','REST'],['graphql','GraphQL']] },
        { key: 'auth_type', label: 'Authentification', type: 'select', showIf: 'needs_backend=yes', options: [
            ['none', 'Pas d\'auth'],
            ['email', 'Email / Mot de passe'],
            ['oauth', 'OAuth (Google, GitHub...)'],
            ['magic', 'Magic link'],
        ]},
        { key: 'payments', label: 'Paiements', type: 'select', showIf: 'needs_backend=yes', options: [
            ['none', 'Non'],
            ['stripe', 'Stripe'],
            ['paypal', 'PayPal'],
        ]},
    ]},
    { id: 'database', title: 'Base de Donnees', skipUnless: ['_profile=blog_cms','_profile=webapp_saas','_profile=api_backend','_profile=mobile','_profile=custom'], fields: [
        { key: 'needs_db', label: 'Base de donnees ?', type: 'select', options: [['yes','Oui'],['no','Non']] },
        { key: 'db_type', label: 'Type', type: 'select', showIf: 'needs_db=yes', options: [
            ['postgresql', 'PostgreSQL'],
            ['mongodb', 'MongoDB'],
            ['mysql', 'MySQL'],
            ['sqlite', 'SQLite'],
            ['supabase', 'Supabase (PostgreSQL hosted)'],
        ]},
        { key: 'db_tables', label: 'Tables/Collections principales', type: 'textarea', showIf: 'needs_db=yes', placeholder: 'users\nproducts\norders\nreviews' },
    ]},
    { id: 'storage', title: 'Fichiers & Stockage', skipUnless: ['_profile=blog_cms','_profile=webapp_saas','_profile=mobile','_profile=custom'], fields: [
        { key: 'file_upload', label: 'Upload de fichiers ?', type: 'select', options: [['no','Non'],['yes','Oui']] },
        { key: 'storage_provider', label: 'Ou stocker les fichiers ?', type: 'select', showIf: 'file_upload=yes', options: [
            ['r2', 'Cloudflare R2'],
            ['s3', 'AWS S3'],
            ['local', 'Local (serveur)'],
            ['supabase', 'Supabase Storage'],
        ]},
        { key: 'storage_bucket', label: 'Nom du bucket', type: 'text', showIf: 'file_upload=yes', placeholder: 'mon-projet-uploads' },
        { key: 'storage_account_id', label: 'Account ID (R2/S3)', type: 'text', showIf: 'file_upload=yes', placeholder: 'Optionnel — a remplir plus tard' },
    ]},
    { id: 'hosting', title: 'Hebergement & Domaine', fields: [
        { key: 'frontend_hosting', label: 'Hosting frontend', type: 'select', options: [
            ['vercel', 'Vercel'],
            ['netlify', 'Netlify'],
            ['vps', 'VPS (Docker)'],
            ['cloudflare', 'Cloudflare Pages'],
        ]},
        { key: 'backend_hosting', label: 'Hosting backend', type: 'select', showIf: 'needs_backend=yes', options: [
            ['vps', 'VPS (Docker)'],
            ['railway', 'Railway'],
            ['fly', 'Fly.io'],
            ['render', 'Render'],
        ]},
        { key: 'needs_domain', label: 'Domaine a acheter ?', type: 'select', options: [['no','Non / Deja achete'],['yes','Oui']] },
        { key: 'domain_name', label: 'Nom de domaine', type: 'text', placeholder: 'example.com' },
        { key: 'dns_provider', label: 'Provider DNS', type: 'select', options: [
            ['cloudflare', 'Cloudflare'],
            ['namecheap', 'Namecheap'],
            ['ovh', 'OVH'],
            ['other', 'Autre'],
        ]},
        { key: 'ssl', label: 'SSL', type: 'select', options: [['letsencrypt','Let\'s Encrypt'],['cloudflare','Cloudflare'],['other','Autre']] },
        { key: 'docker_compose', label: 'Docker Compose ?', type: 'select', options: [['yes','Oui'],['no','Non']] },
    ]},
    { id: 'extras', title: 'Backup, SEO & Extras', skipUnless: ['_profile=webapp_saas','_profile=api_backend','_profile=blog_cms','_profile=mobile','_profile=custom'], fields: [
        { key: 'needs_backup', label: 'Backup base de donnees ?', type: 'select', options: [['no','Non'],['yes','Oui']] },
        { key: 'backup_dest', label: 'Destination backup', type: 'select', showIf: 'needs_backup=yes', options: [
            ['r2', 'Cloudflare R2'],
            ['s3', 'AWS S3'],
            ['local', 'Serveur local'],
        ]},
        { key: 'backup_freq', label: 'Frequence', type: 'select', showIf: 'needs_backup=yes', options: [['daily','Quotidien'],['weekly','Hebdomadaire'],['manual','Manuel']] },
        { key: 'backup_bucket', label: 'Bucket backup', type: 'text', showIf: 'needs_backup=yes', placeholder: 'mon-projet-backups' },
        { key: 'seo', label: 'SEO ?', type: 'select', options: [['yes','Oui'],['no','Non']] },
        { key: 'analytics', label: 'Analytics', type: 'select', options: [['none','Non'],['ga','Google Analytics'],['plausible','Plausible'],['umami','Umami']] },
        { key: 'email_service', label: 'Service email (contact, notifications)', type: 'select', options: [['none','Non'],['resend','Resend'],['sendgrid','SendGrid'],['smtp','SMTP custom']] },
        { key: 'cicd', label: 'CI/CD', type: 'select', options: [['github','GitHub Actions'],['none','Non']] },
        { key: 'extra_notes', label: 'Notes supplementaires pour Claude', type: 'textarea', placeholder: 'Design minimaliste, couleurs bleu/blanc, inspiration site X...' },
    ]},
];

let wizStep = 0;
let wizData = {};

function openWizard() {
    wizStep = 0;
    wizData = {};
    renderWizStep();
    showModal('wizard-modal');
}

// Steps to skip based on profile
function wizGetVisibleSteps() {
    const profile = wizData._profile || '';
    return WIZ_STEPS.filter(step => {
        if (!step.skipUnless) return true;
        return step.skipUnless.some(cond => {
            const [k, v] = cond.split('=');
            return wizData[k] === v;
        });
    });
}

function renderWizStep() {
    const visible = wizGetVisibleSteps();
    const step = visible[wizStep];
    if (!step) return;
    const total = visible.length;
    document.getElementById('wiz-title').textContent = step.title;
    document.getElementById('wiz-progress-bar').style.width = ((wizStep + 1) / total * 100) + '%';
    document.getElementById('wiz-prev').style.display = wizStep > 0 ? '' : 'none';
    document.getElementById('wiz-next').textContent = wizStep === total - 1 ? 'Generer' : 'Suivant';

    // Clickable step indicators
    let stepsHtml = '<div style="display:flex;gap:4px;align-items:center;margin-bottom:14px;flex-wrap:wrap">';
    for (let i = 0; i < total; i++) {
        const s = visible[i];
        const isCurrent = i === wizStep;
        const isPast = i < wizStep;
        stepsHtml += `<div onclick="wizGoStep(${i})" style="cursor:pointer;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:600;
            transition:all .2s;
            background:${isCurrent ? 'var(--violet)' : isPast ? 'rgba(109,92,255,.15)' : 'var(--bg-2)'};
            color:${isCurrent ? '#fff' : isPast ? 'var(--violet)' : 'var(--text-4)'}">${s.title}</div>`;
    }
    stepsHtml += '</div>';

    let html = stepsHtml;
    for (const f of step.fields) {
        if (f.showIf) {
            const [k, v] = f.showIf.split('=');
            if (wizData[k] !== v) continue;
        }

        const val = wizData[f.key] || '';

        // Profile cards
        if (f.type === 'profile-cards') {
            const selected = wizData._profile || '';
            html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
            for (const [key, prof] of Object.entries(WIZ_PROFILES)) {
                const isActive = selected === key;
                html += '<div data-profile="' + key + '" onclick="wizSelectProfile(\'' + key + '\')" '
                    + 'style="padding:14px;border-radius:10px;border:2px solid ' + (isActive ? 'var(--violet)' : 'var(--border-1)') + ';'
                    + 'background:' + (isActive ? 'rgba(109,92,255,.1)' : 'var(--bg-1)') + ';cursor:pointer;transition:all .2s;text-align:center">'
                    + '<div style="font-size:28px;margin-bottom:6px">' + prof.icon + '</div>'
                    + '<div style="font-size:13px;font-weight:700;color:' + (isActive ? 'var(--violet)' : 'var(--text-0)') + ';margin-bottom:4px">' + prof.label + '</div>'
                    + '<div style="font-size:11px;color:var(--text-3);line-height:1.3;margin-bottom:8px">' + prof.desc + '</div>'
                    + '<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center">'
                    + prof.components.map(function(c) { return '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--bg-2);color:var(--text-2)">' + c + '</span>'; }).join('')
                    + (prof.components.length === 0 ? '<span style="font-size:9px;color:var(--text-4)">au choix</span>' : '')
                    + '</div></div>';
            }
            html += '</div>';
            continue;
        }

        // Visual cards for select fields with icons
        if (f.type === 'select' && f.options.length >= 3 && f.options.length <= 12 && !f.showIf) {
            html += '<div class="form-group"><label>' + f.label + (f.required ? ' *' : '') + '</label>';
            html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px">';
            for (const [optVal, optLabel] of f.options) {
                const isActive = val === optVal || (!val && f.options[0][0] === optVal);
                html += '<div class="wiz-card-option" data-key="' + f.key + '" data-val="' + optVal + '" '
                    + 'onclick="wizSelectCard(\'' + f.key + '\',\'' + optVal + '\')" '
                    + 'style="padding:10px 8px;border-radius:8px;border:2px solid ' + (isActive ? 'var(--violet)' : 'var(--border-0)') + ';'
                    + 'background:' + (isActive ? 'rgba(109,92,255,.08)' : 'var(--bg-0)') + ';cursor:pointer;text-align:center;transition:all .15s;font-size:12px;'
                    + 'color:' + (isActive ? 'var(--violet)' : 'var(--text-1)') + ';font-weight:' + (isActive ? '700' : '500') + '">'
                    + optLabel + '</div>';
            }
            html += '</div></div>';
            continue;
        }

        html += '<div class="form-group">';
        html += '<label>' + f.label + (f.required ? ' *' : '') + '</label>';

        if (f.type === 'text') {
            const nameCheck = f.key === 'project_name' ? ' oninput="wizCheckName(this)"' : '';
            html += '<input class="form-input wiz-field" data-key="' + f.key + '" value="' + val + '" placeholder="' + (f.placeholder || '') + '"' + nameCheck + '>';
            if (f.key === 'project_name') {
                html += '<div id="wiz-name-status" style="font-size:11px;margin-top:4px;min-height:16px"></div>';
            }
        } else if (f.type === 'textarea') {
            html += '<textarea class="form-input wiz-field" data-key="' + f.key + '" placeholder="' + (f.placeholder || '') + '" rows="3" style="resize:vertical">' + val + '</textarea>';
        } else if (f.type === 'select') {
            html += '<select class="form-input wiz-field" data-key="' + f.key + '" onchange="wizFieldChanged()">';
            for (const [optVal, optLabel] of f.options) {
                html += '<option value="' + optVal + '" ' + (val === optVal ? 'selected' : '') + '>' + optLabel + '</option>';
            }
            html += '</select>';
        }
        html += '</div>';
    }
    document.getElementById('wiz-content').innerHTML = html;

    // Set default values for selects and card options
    document.querySelectorAll('.wiz-field').forEach(el => {
        if (!wizData[el.dataset.key] && el.tagName === 'SELECT') {
            wizData[el.dataset.key] = el.value;
        }
    });
    // Set defaults for card options
    step.fields.forEach(f => {
        if (f.type === 'select' && !wizData[f.key] && f.options && f.options.length) {
            wizData[f.key] = f.options[0][0];
        }
    });
}

function wizSelectCard(key, val) {
    wizData[key] = val;
    renderWizStep();
}

let _wizNameTimer = null;
async function wizCheckName(input) {
    const name = input.value.trim();
    const el = document.getElementById('wiz-name-status');
    if (!el) return;
    if (!name) { el.innerHTML = ''; return; }
    clearTimeout(_wizNameTimer);
    _wizNameTimer = setTimeout(async () => {
        try {
            const projects = await api('projects');
            const exists = projects.find(p => p.name.toLowerCase() === name.toLowerCase());
            if (exists) {
                el.innerHTML = '<span style="color:var(--rose)">Ce nom existe deja — choisis un autre</span>';
                input.style.borderColor = 'var(--rose)';
            } else {
                el.innerHTML = '<span style="color:var(--emerald)">Disponible</span>';
                input.style.borderColor = 'var(--emerald)';
            }
        } catch(e) { el.innerHTML = ''; }
    }, 400);
}

function wizGoStep(idx) {
    saveWizFields();
    wizStep = idx;
    renderWizStep();
}

function wizSelectProfile(key) {
    wizData._profile = key;
    renderWizStep();
}

function wizFieldChanged() {
    // Save current values and re-render to handle showIf
    saveWizFields();
    renderWizStep();
}

function saveWizFields() {
    document.querySelectorAll('.wiz-field').forEach(el => {
        wizData[el.dataset.key] = el.value;
    });
}

function wizPrev() {
    saveWizFields();
    if (wizStep > 0) { wizStep--; renderWizStep(); }
}

function wizNext() {
    saveWizFields();
    const visible = wizGetVisibleSteps();
    const step = visible[wizStep];
    if (!step) return;

    // Validate profile selection
    if (step.id === 'profile' && !wizData._profile) {
        toast('Choisis un type de projet', 'error');
        return;
    }

    // Validate required fields
    for (const f of step.fields) {
        if (f.showIf) {
            const [k, v] = f.showIf.split('=');
            if (wizData[k] !== v) continue;
        }
        if (f.required && !wizData[f.key]?.trim()) {
            toast(f.label + ' est requis', 'error');
            return;
        }
    }

    // Check name availability before advancing from client step
    if (step.id === 'client' && wizData.project_name) {
        const nameEl = document.getElementById('wiz-name-status');
        if (nameEl && nameEl.textContent.includes('existe deja')) {
            toast('Ce nom de projet existe deja, change-le', 'error');
            return;
        }
    }

    if (wizStep < visible.length - 1) {
        wizStep++;
        renderWizStep();
    } else {
        generateResult();
    }
}

async function generateResult() {
    closeModals();
    const d = wizData;

    // ─── Generate Checklist ───
    const tasks = [];
    tasks.push({ done: false, text: `Creer le repo GitHub : ${d.project_name}` });

    if (d.needs_domain === 'yes') {
        tasks.push({ done: false, text: `Acheter le domaine : ${d.domain_name || '???'}` });
    }
    if (d.domain_name) {
        tasks.push({ done: false, text: `Configurer DNS (${d.dns_provider || 'Cloudflare'}) pour ${d.domain_name}` });
        tasks.push({ done: false, text: `Configurer SSL (${d.ssl || "Let's Encrypt"})` });
    }
    if (d.file_upload === 'yes') {
        tasks.push({ done: false, text: `Creer le bucket ${d.storage_provider?.toUpperCase() || 'R2'} : ${d.storage_bucket || d.project_name + '-uploads'}` });
        if (d.storage_provider === 'r2') {
            tasks.push({ done: false, text: `Generer API keys R2 (Access Key + Secret)` });
        }
    }
    if (d.needs_backup === 'yes') {
        tasks.push({ done: false, text: `Creer le bucket backup ${d.backup_dest?.toUpperCase() || 'R2'} : ${d.backup_bucket || d.project_name + '-backups'}` });
    }
    if (d.needs_backend === 'yes') {
        if (d.backend_hosting === 'vps') {
            tasks.push({ done: false, text: `Provisionner VPS pour le backend` });
        } else {
            tasks.push({ done: false, text: `Creer le projet sur ${d.backend_hosting || 'Railway'}` });
        }
    }
    if (d.frontend_hosting === 'vercel') {
        tasks.push({ done: false, text: `Connecter le repo a Vercel` });
    } else if (d.frontend_hosting === 'vps') {
        tasks.push({ done: false, text: `Configurer Nginx/Caddy sur le VPS pour le frontend` });
    }
    if (d.analytics && d.analytics !== 'none') {
        tasks.push({ done: false, text: `Creer le compte ${d.analytics} et recuperer le tracking ID` });
    }
    if (d.email_service && d.email_service !== 'none') {
        tasks.push({ done: false, text: `Configurer ${d.email_service} (API key, domaine email)` });
    }
    if (d.payments && d.payments !== 'none') {
        tasks.push({ done: false, text: `Creer le compte ${d.payments} et recuperer les cles API` });
    }
    if (d.auth_type === 'oauth') {
        tasks.push({ done: false, text: `Configurer OAuth (Google Console / GitHub OAuth App)` });
    }
    if (d.docker_compose === 'yes') {
        tasks.push({ done: false, text: `Verifier Docker et Docker Compose installes sur le serveur` });
    }
    tasks.push({ done: false, text: `Lancer Claude avec le prompt genere` });
    tasks.push({ done: false, text: `Tester le site en local` });
    tasks.push({ done: false, text: `Deployer en production` });
    tasks.push({ done: false, text: `Verifier SSL, SEO, performance` });

    // ─── Generate Claude Prompt ───
    let prompt = `Construis un site web complet pour mon client.\n\n`;
    prompt += `## Informations Projet\n`;
    prompt += `- Client : ${d.client_name}\n`;
    prompt += `- Projet : ${d.project_name}\n`;
    prompt += `- Type : ${d.site_type}\n`;
    prompt += `- Description : ${d.project_desc}\n\n`;

    if (d.pages) {
        prompt += `## Pages\n`;
        d.pages.split('\n').filter(p=>p.trim()).forEach(p => { prompt += `- ${p.trim()}\n`; });
        prompt += `\n`;
    }

    prompt += `## Frontend\n`;
    prompt += `- Framework : ${d.frontend_framework}\n`;
    prompt += `- CSS : ${d.css_framework}\n`;
    prompt += `- Responsive : ${d.responsive === 'yes' ? 'Oui' : 'Non'}\n`;
    prompt += `- Dark mode : ${d.dark_mode === 'yes' ? 'Oui' : 'Non'}\n`;
    if (d.multilang === 'yes') prompt += `- Multi-langue : ${d.languages || 'FR, EN'}\n`;
    prompt += `\n`;

    if (d.needs_backend === 'yes') {
        prompt += `## Backend\n`;
        prompt += `- Framework : ${d.backend_framework}\n`;
        prompt += `- API : ${d.api_type}\n`;
        if (d.auth_type !== 'none') prompt += `- Auth : ${d.auth_type}\n`;
        if (d.payments !== 'none') prompt += `- Paiements : ${d.payments}\n`;
        prompt += `\n`;
    }

    if (d.needs_db === 'yes') {
        prompt += `## Base de Donnees\n`;
        prompt += `- Type : ${d.db_type}\n`;
        if (d.db_tables) {
            prompt += `- Tables :\n`;
            d.db_tables.split('\n').filter(t=>t.trim()).forEach(t => { prompt += `  - ${t.trim()}\n`; });
        }
        prompt += `\n`;
    }

    if (d.file_upload === 'yes') {
        prompt += `## Stockage Fichiers\n`;
        prompt += `- Provider : ${d.storage_provider}\n`;
        prompt += `- Bucket : ${d.storage_bucket || d.project_name + '-uploads'}\n`;
        prompt += `\n`;
    }

    prompt += `## Hebergement\n`;
    prompt += `- Frontend : ${d.frontend_hosting}\n`;
    if (d.needs_backend === 'yes') prompt += `- Backend : ${d.backend_hosting}\n`;
    if (d.domain_name) prompt += `- Domaine : ${d.domain_name}\n`;
    prompt += `- SSL : ${d.ssl}\n`;
    if (d.docker_compose === 'yes') prompt += `- Docker Compose : Oui (genere le docker-compose.yml)\n`;
    prompt += `\n`;

    if (d.needs_backup === 'yes') {
        prompt += `## Backup\n`;
        prompt += `- Destination : ${d.backup_dest}\n`;
        prompt += `- Frequence : ${d.backup_freq}\n`;
        prompt += `- Bucket : ${d.backup_bucket || d.project_name + '-backups'}\n`;
        prompt += `- Cree un script de backup automatique pour la base de donnees\n\n`;
    }

    const extras = [];
    if (d.seo === 'yes') extras.push('SEO (meta tags, sitemap.xml, robots.txt, Open Graph)');
    if (d.analytics && d.analytics !== 'none') extras.push(`Analytics : ${d.analytics}`);
    if (d.email_service && d.email_service !== 'none') extras.push(`Service email : ${d.email_service}`);
    if (d.cicd === 'github') extras.push('CI/CD : GitHub Actions (lint, test, deploy)');

    if (extras.length) {
        prompt += `## Extras\n`;
        extras.forEach(e => { prompt += `- ${e}\n`; });
        prompt += `\n`;
    }

    if (d.extra_notes) {
        prompt += `## Notes\n${d.extra_notes}\n\n`;
    }

    prompt += `## Infrastructure\n`;
    prompt += `Lis le fichier CLAUDE.md a la racine du projet pour connaitre les connexions configurees.\n`;
    prompt += `Tu y trouveras :\n`;
    prompt += `- Le repo GitHub ou pusher le code source\n`;
    if (d.frontend_hosting) prompt += `- Le compte ${d.frontend_hosting} ou deployer le site (avec le token configure)\n`;
    if (d.needs_db === 'yes') prompt += `- La base de donnees (host, port, nom, connection string)\n`;
    if (d.file_upload === 'yes') prompt += `- Le bucket de stockage pour les fichiers uploades\n`;
    if (d.needs_backup === 'yes') prompt += `- La destination des backups\n`;
    prompt += `- Utilise ces connexions directement, elles sont deja configurees par l'utilisateur\n`;
    prompt += `- Si une connexion manque, demande a l'utilisateur de la configurer dans DevAgent > Connections\n`;
    prompt += `- Quand tu crees un service (repo, BDD, deploy), ecris les infos dans .devpilot/connections.json\n\n`;

    prompt += `## Consignes\n`;
    prompt += `- Structure le projet proprement avec des dossiers clairs\n`;
    prompt += `- Ecris du code production-ready, pas de placeholders\n`;
    prompt += `- Ajoute un README avec les instructions d'installation et de deploiement\n`;
    prompt += `- Ajoute un .env.example avec toutes les variables d'environnement necessaires\n`;
    if (d.docker_compose === 'yes') prompt += `- Le docker-compose.yml doit inclure tous les services (app, db, reverse proxy)\n`;
    if (d.needs_backend === 'yes') prompt += `- Ajoute la validation des inputs et la gestion d'erreurs\n`;
    if (d.auth_type !== 'none' && d.needs_backend === 'yes') prompt += `- Securise les routes qui necessitent une authentification\n`;

    // ─── Show Result ───
    document.getElementById('wiz-result-checklist').innerHTML = `
        <div class="card-label">Checklist — taches manuelles a faire</div>
        <div style="max-height:250px;overflow-y:auto">
            ${tasks.map((t, i) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-0);font-size:12px">
                <input type="checkbox" id="task-${i}" style="accent-color:var(--violet);width:14px;height:14px;flex-shrink:0">
                <label for="task-${i}" style="cursor:pointer;flex:1">${t.text}</label>
            </div>`).join('')}
        </div>`;

    document.getElementById('wiz-result-prompt').textContent = prompt;
    window._generatedPrompt = prompt;
    window._generatedChecklist = tasks;

    // Show result — in creation mode
    window._wizardMode = 'create';
    document.getElementById('wiz-finish-btn').textContent = 'Creer le projet';
    document.getElementById('wiz-finish-btn').style.display = '';
    showModal('wizard-result-modal');

    // Save happens when user clicks "Creer le projet" button
}

async function finishWizard() {
    if (window._wizardMode !== 'create') { closeSpecsModal(); return; }

    const d = wizData;
    const tasks = window._generatedChecklist;
    const prompt = window._generatedPrompt;
    const btn = document.getElementById('wiz-finish-btn');
    btn.disabled = true;
    btn.textContent = 'Creation...';

    try {
        // Check if name already exists — go back to name step instead of blocking
        const allProj = await api('projects');
        const existing = allProj.find(p => p.name.toLowerCase() === d.project_name.toLowerCase());
        if (existing) {
            toast('Le projet "' + d.project_name + '" existe deja — modifie le nom', 'error');
            btn.disabled = false;
            btn.textContent = 'Creer le projet';
            closeModals();
            // Go back to client step (step index 1 in visible steps)
            const visible = wizGetVisibleSteps();
            wizStep = visible.findIndex(s => s.id === 'client');
            if (wizStep < 0) wizStep = 1;
            renderWizStep();
            showModal('wizard-modal');
            // Focus and highlight the name field
            setTimeout(() => {
                const nameInput = document.querySelector('[data-key="project_name"]');
                if (nameInput) { nameInput.focus(); nameInput.select(); nameInput.style.borderColor = 'var(--rose)'; }
            }, 200);
            return;
        }

        // Create project
        const r = await apiPost('projects', {
            name: d.project_name,
            color: '#6d5cff',
            description: `Client: ${d.client_name} — ${d.site_type}`,
        });

        if (!r.success) {
            toast(r.message || 'Erreur creation', 'error');
            btn.disabled = false;
            btn.textContent = 'Creer le projet';
            return;
        }

        // Save specs
        await apiPost('projects/' + r.id + '/specs', {
            wizard_data: d,
            checklist: tasks,
            prompt: prompt,
        });

        // Apply profile and components (+ the project model: type → needs)
        if (d._profile) {
            await apiPost('projects/' + r.id + '/apply-profile', { profile: d._profile });
            await apiJson('PUT', 'projects/' + r.id + '/model', { profile: d._profile });
        }

        window._specsPid = r.id;
        btn.textContent = 'Projet cree';
        btn.style.background = 'var(--emerald)';
        toast('Projet "' + d.project_name + '" cree avec succes');

        setTimeout(async () => {
            closeModals();
            await loadProjects();
            openWorkspace(r.id);          // same as "Nouveau": straight into its space (then: Lier a GitHub)
        }, 1000);

    } catch (e) {
        toast('Erreur: ' + e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Creer le projet';
    }
}

/* ═══ COMPONENT DETECTION ═══ */
async function wsDetectComponents() {
    if (!wsProjectId) return;
    toast('Detection en cours...');
    try {
        const result = await apiPost('projects/' + wsProjectId + '/detect', {});
        const detected = result.detected || {};
        const suggested = result.suggested_profile || 'custom';
        const scores = result.match_scores || {};

        // Build detection modal content
        let html = `<div style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:6px">Profil suggere</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">`;
        for (const [key, prof] of Object.entries(WIZ_PROFILES)) {
            if (key === 'custom') continue;
            const isSuggested = key === suggested;
            const score = scores[key] || 0;
            html += `<div onclick="document.querySelectorAll('.detect-profile').forEach(e=>e.style.border='2px solid var(--border-1)');this.style.border='2px solid var(--violet)';window._detectProfile='${key}'"
                class="detect-profile" style="padding:10px;border-radius:8px;border:2px solid ${isSuggested ? 'var(--violet)' : 'var(--border-1)'};
                background:${isSuggested ? 'rgba(109,92,255,.1)' : 'var(--bg-1)'};cursor:pointer;text-align:center;min-width:90px">
                <div style="font-size:20px">${prof.icon}</div>
                <div style="font-size:11px;font-weight:600;color:var(--text-0)">${prof.label}</div>
                <div style="font-size:10px;color:var(--text-4)">${Math.round(score*100)}%</div>
            </div>`;
        }
        html += `</div></div>`;

        html += `<div style="font-size:13px;font-weight:700;color:var(--text-0);margin-bottom:8px">Composants detectes</div>`;
        const allComps = ['git','database','storage','backup','docker','deploy','auth','monitoring','ci_cd','secrets'];
        const COMP_LABELS = {git:'Git',database:'Base de donnees',storage:'Stockage cloud',backup:'Backups',docker:'Docker',deploy:'Deploiement',auth:'Auth',monitoring:'Monitoring',ci_cd:'CI/CD',secrets:'Secrets/.env'};
        for (const comp of allComps) {
            const det = detected[comp];
            const checked = det ? 'checked' : '';
            const evidence = det ? det.evidence.slice(0, 2).join(', ') : '';
            html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-0)">
                <input type="checkbox" class="detect-comp" data-comp="${comp}" ${checked} style="accent-color:var(--violet);width:14px;height:14px">
                <span style="font-size:12px;font-weight:600;color:var(--text-0);min-width:110px">${COMP_LABELS[comp] || comp}</span>
                <span style="font-size:11px;color:${det ? 'var(--emerald)' : 'var(--text-4)'};flex:1">${det ? evidence : 'non detecte'}</span>
            </div>`;
        }

        window._detectProfile = suggested;
        const modalEl = document.createElement('div');
        modalEl.id = 'detect-modal';
        modalEl.className = 'modal active';
        modalEl.innerHTML = `<div class="modal-content" style="max-width:560px">
            <div class="flex-between mb-12"><h3 style="font-size:14px;font-weight:700;color:var(--text-0);margin:0">Configurer les composants</h3>
            <button class="btn btn-sm" onclick="this.closest('.modal').remove()">&times;</button></div>
            ${html}
            <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
                <button class="btn btn-sm" onclick="this.closest('.modal').remove()">Annuler</button>
                <button class="btn btn-primary btn-sm" onclick="wsApplyDetection()">Appliquer</button>
            </div>
        </div>`;
        document.body.appendChild(modalEl);
    } catch (e) {
        toast('Erreur detection: ' + e.message, 'error');
    }
}

async function wsApplyDetection() {
    const profile = window._detectProfile || 'custom';
    const checked = [];
    document.querySelectorAll('.detect-comp:checked').forEach(cb => checked.push(cb.dataset.comp));

    await apiPost('projects/' + wsProjectId + '/apply-profile', {
        profile: profile,
        components: checked,
    });

    // Remove modal and banner
    document.getElementById('detect-modal')?.remove();
    const banner = document.getElementById('ws-detect-banner');
    if (banner) banner.style.display = 'none';

    toast('Profil "' + profile + '" applique avec ' + checked.length + ' composants');

    // Refresh workspace to update tabs
    openWorkspace(wsProjectId);
}

function copyPrompt() {
    if (!window._generatedPrompt) return;
    navigator.clipboard.writeText(window._generatedPrompt).then(() => {
        toast('Prompt copie dans le presse-papier');
    }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = window._generatedPrompt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast('Prompt copie');
    });
}

