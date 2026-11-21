/* ═══════════════════════════════════════════════════════════
   GUIDED TOUR — Interactive walkthrough with spotlight
   ═══════════════════════════════════════════════════════════ */

const TOUR_STEPS = [
    {
        id: 'welcome', selector: null, page: null,
        title: 'Bienvenue dans DevAgent',
        body: 'Ce guide interactif va te montrer comment utiliser la plateforme etape par etape. Clique sur <b>Suivant</b> pour commencer.',
        icon: '🚀',
    },
    {
        id: 'sidebar-projects', selector: '[data-page="projects"]', page: null,
        title: 'Page Projets',
        body: 'Clique ici pour voir <b>tous tes projets</b>. C\'est le point d\'entree principal de DevAgent.',
        action: true,
    },
    {
        id: 'new-client', selector: 'button[onclick="openWizard()"]', page: 'projects',
        title: 'Nouveau Client',
        body: 'Ce bouton lance le <b>wizard de creation</b>. 9 etapes pour configurer un projet complet : type, frontend, backend, BDD, stockage, hebergement...',
        hand: 'left',
    },
    {
        id: 'scan-btn', selector: 'button[onclick="scanProjects()"]', page: 'projects',
        title: 'Scanner les projets',
        body: 'Detecte automatiquement les projets sur ton PC (dossiers avec <b>.git</b>, <b>package.json</b>, etc.) et propose de les importer.',
    },
    {
        id: 'from-path', selector: 'button[onclick="openAddProject(\'new\')"]', page: 'projects',
        title: 'Ajouter un projet',
        body: 'Nouveau projet, clone d\'un depot, terminal pour un script d\'installation, ou dossier existant : tout passe par ici. Par defaut tout va dans ~/devpilot/projects.',
    },
    {
        id: 'project-card', selector: '.project-card', page: 'projects',
        title: 'Carte Projet',
        body: 'Chaque projet montre son <b>nom</b>, sa <b>taille</b>, son <b>statut</b> (Actif/Pause/Termine) et son <b>badge profil</b> (Vitrine, SaaS...). Clique dessus pour voir le detail.',
    },
    {
        id: 'filters', selector: '#f-active', page: 'projects',
        title: 'Filtrer par statut',
        body: 'Filtre les projets : <b>Tous</b>, <b>Actifs</b> (en cours), <b>Pauses</b> (en attente), <b>Termines</b> (livres).',
    },
    {
        id: 'sidebar-cloud', selector: '[data-page="cloud"]', page: null,
        title: 'Page Cloud',
        body: 'Vue globale de tes integrations <b>GitHub</b> et <b>Cloudflare R2</b>. Gere tes repos, buckets et syncs depuis ici.',
    },
    {
        id: 'sidebar-terminal', selector: '[data-page="terminal"]', page: null,
        title: 'Terminal',
        body: 'Un <b>terminal bash complet</b> integre dans DevAgent. Pas besoin de changer de fenetre.',
    },
    {
        id: 'sidebar-cleaner', selector: '[data-page="cleaner"]', page: null,
        title: 'Nettoyeur',
        body: 'Analyse les <b>caches</b> de tes projets (node_modules, .next, __pycache__...) et du systeme. Libere de l\'espace en un clic.',
    },
    {
        id: 'sidebar-settings', selector: '[data-page="settings"]', page: null,
        title: 'Parametres',
        body: 'Configure tes <b>tokens GitHub</b>, <b>cles Cloudflare R2</b>, et les options du watcher (surveillance de fichiers).',
    },
    {
        id: 'sidebar-overview', selector: '[data-page="overview"]', page: null,
        title: 'Overview',
        body: 'Dashboard systeme : <b>CPU</b>, <b>RAM</b>, <b>disque</b>, <b>ports actifs</b>, <b>Docker</b>. Vue d\'ensemble de ta machine.',
        action: true,
    },
    {
        id: 'finish', selector: null, page: null,
        title: 'Tu es pret !',
        body: 'Tu connais maintenant les bases de DevAgent. Pour revoir ce guide, clique sur le bouton <b>?</b> en bas a droite.<br><br>💡 <b>Astuce</b> : ouvre un projet et clique <b>Workspace</b> pour voir les onglets adaptatifs (Git, Cloud, Checklist...).',
        icon: '🎉',
        final: true,
    },
];

let tourStep = -1;
let tourActive = false;

function startTour() {
    tourStep = 0;
    tourActive = true;
    document.getElementById('tour-overlay').classList.add('active');
    renderTourStep();
}

function endTour() {
    tourActive = false;
    tourStep = -1;
    document.getElementById('tour-overlay').classList.remove('active');
    document.getElementById('tour-spotlight').style.display = 'none';
    document.getElementById('tour-hand').style.display = 'none';
    document.getElementById('tour-tooltip').style.display = 'none';
    document.getElementById('tour-tooltip').classList.remove('visible');
    localStorage.setItem('devpilot_tour_done', '1');
}

function tourWelcomeNext() {
    const el = document.getElementById('tour-welcome');
    if (el) el.remove();
    tourNext();
}

function tourNext() {
    const step = TOUR_STEPS[tourStep];
    if (step && step.final) { endTour(); return; }
    if (tourStep < TOUR_STEPS.length - 1) {
        tourStep++;
        renderTourStep();
    }
}

function tourPrev() {
    if (tourStep > 0) {
        tourStep--;
        renderTourStep();
    }
}

function renderTourStep() {
    const step = TOUR_STEPS[tourStep];
    if (!step) return;

    const spotlight = document.getElementById('tour-spotlight');
    const hand = document.getElementById('tour-hand');
    const tooltip = document.getElementById('tour-tooltip');

    tooltip.classList.remove('visible');

    // Navigate to the right page if needed
    if (step.page && currentPage !== step.page) {
        go(step.page);
    }

    // Welcome / centered card (no selector)
    if (!step.selector) {
        spotlight.style.display = 'none';
        hand.style.display = 'none';
        tooltip.style.display = 'none';

        // Show centered welcome/finish card
        let existing = document.getElementById('tour-welcome');
        if (existing) existing.remove();

        const div = document.createElement('div');
        div.id = 'tour-welcome';
        div.className = 'tour-welcome';
        const nextAction = step.final ? 'endTour' : 'tourWelcomeNext';
        const nextLabel = step.final ? 'Terminer' : 'Commencer';
        const prevBtn = tourStep > 0
            ? '<button class="tour-btn" onclick="tourPrev()">Precedent</button>'
            : '<button class="tour-btn" onclick="endTour()">Passer</button>';
        div.innerHTML = '<div class="tour-welcome-card">'
            + '<div style="font-size:56px;margin-bottom:16px">' + (step.icon || '🚀') + '</div>'
            + '<div style="font-size:20px;font-weight:700;color:var(--text-0);margin-bottom:8px">' + step.title + '</div>'
            + '<div style="font-size:13px;color:var(--text-2);line-height:1.6;margin-bottom:24px">' + step.body + '</div>'
            + '<div style="display:flex;gap:8px;justify-content:center">'
            + prevBtn
            + '<button class="tour-btn tour-btn-primary" onclick="' + nextAction + '()">' + nextLabel + '</button>'
            + '</div>'
            + renderTourDots()
            + '</div>';
        document.getElementById('tour-overlay').appendChild(div);
        return;
    }

    // Remove welcome if visible
    document.getElementById('tour-welcome')?.remove();

    // Wait for element to be visible
    setTimeout(() => {
        const el = document.querySelector(step.selector);
        if (!el) {
            // Element not found — skip or show centered
            tourNext();
            return;
        }

        const rect = el.getBoundingClientRect();
        const pad = 6;

        // Position spotlight
        spotlight.style.display = 'block';
        spotlight.style.left = (rect.left - pad) + 'px';
        spotlight.style.top = (rect.top - pad) + 'px';
        spotlight.style.width = (rect.width + pad * 2) + 'px';
        spotlight.style.height = (rect.height + pad * 2) + 'px';

        // Position hand
        const handDir = step.hand || 'top';
        hand.style.display = 'block';
        if (handDir === 'left') {
            hand.textContent = '👈';
            hand.style.left = (rect.right + 12) + 'px';
            hand.style.top = (rect.top + rect.height / 2 - 16) + 'px';
        } else {
            hand.textContent = '👆';
            hand.style.left = (rect.left + rect.width / 2 - 16) + 'px';
            hand.style.top = (rect.bottom + 8) + 'px';
        }

        // Build tooltip
        tooltip.style.display = 'block';
        tooltip.innerHTML = `
            <div class="tour-tooltip-step">
                <div class="tour-tooltip-num">${tourStep + 1}</div>
                <div class="tour-tooltip-title">${step.title}</div>
            </div>
            <div class="tour-tooltip-body">${step.body}</div>
            <div class="tour-tooltip-nav">
                ${renderTourDots()}
                <div class="tour-tooltip-btns">
                    ${tourStep > 0 ? '<button class="tour-btn" onclick="tourPrev()">Precedent</button>' : '<button class="tour-btn" onclick="endTour()">Passer</button>'}
                    ${step.action ? '<button class="tour-btn tour-btn-primary" onclick="tourNext()">Suivant</button>' : '<button class="tour-btn tour-btn-primary" onclick="tourNext()">Suivant</button>'}
                </div>
            </div>`;

        // Position tooltip intelligently
        positionTooltip(tooltip, rect);

        // Fade in
        requestAnimationFrame(() => tooltip.classList.add('visible'));

    }, step.page && currentPage !== step.page ? 400 : 100);
}

function positionTooltip(tooltip, targetRect) {
    const margin = 16;
    const gap = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Temporarily show to measure
    tooltip.style.left = '0';
    tooltip.style.top = '0';
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;

    let left, top;

    // Try bottom
    if (targetRect.bottom + gap + th < vh - margin) {
        top = targetRect.bottom + gap;
        left = Math.max(margin, Math.min(targetRect.left + targetRect.width / 2 - tw / 2, vw - tw - margin));
    }
    // Try top
    else if (targetRect.top - gap - th > margin) {
        top = targetRect.top - gap - th;
        left = Math.max(margin, Math.min(targetRect.left + targetRect.width / 2 - tw / 2, vw - tw - margin));
    }
    // Try right
    else if (targetRect.right + gap + tw < vw - margin) {
        left = targetRect.right + gap;
        top = Math.max(margin, Math.min(targetRect.top, vh - th - margin));
    }
    // Fallback: left
    else {
        left = Math.max(margin, targetRect.left - gap - tw);
        top = Math.max(margin, Math.min(targetRect.top, vh - th - margin));
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function renderTourDots() {
    const total = TOUR_STEPS.length;
    let html = '<div class="tour-dots" style="margin-top:12px;justify-content:center;display:flex">';
    for (let i = 0; i < total; i++) {
        html += `<div class="tour-dot${i === tourStep ? ' active' : ''}"></div>`;
    }
    html += '</div>';
    return html;
}

// Handle overlay clicks — allow clicking through to the target in action steps
document.getElementById('tour-overlay').addEventListener('click', function(e) {
    if (!tourActive) return;
    const step = TOUR_STEPS[tourStep];
    if (!step) return;

    // If clicking outside tooltip/welcome, advance or close
    if (!e.target.closest('.tour-tooltip') && !e.target.closest('.tour-welcome-card') && !e.target.closest('.tour-btn')) {
        if (step.selector) {
            tourNext();
        }
    }
});

// Keyboard support
document.addEventListener('keydown', function(e) {
    if (!tourActive) return;
    if (e.key === 'Escape') { endTour(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { document.getElementById('tour-welcome')?.remove(); tourNext(); }
    else if (e.key === 'ArrowLeft') { document.getElementById('tour-welcome')?.remove(); tourPrev(); }
});

// Auto-start on first visit
if (!localStorage.getItem('devpilot_tour_done')) {
    setTimeout(() => startTour(), 1500);
}

/* ═══ INIT ═══ */
