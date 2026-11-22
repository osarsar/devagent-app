/* ═══ Light / dark ═══
   The choice (light, dark, auto = like the system) is kept in localStorage « da-theme ».
   dashboard.html applies it before the first paint; this file keeps the switch in the menu in step. */
(function () {
    const KEY = 'da-theme';
    const media = matchMedia('(prefers-color-scheme: light)');
    const choice = () => localStorage.getItem(KEY) || 'auto';

    function apply() {
        const c = choice();
        const light = c === 'light' || (c === 'auto' && media.matches);
        const root = document.documentElement;
        const next = light ? 'light' : 'dark';
        if (root.dataset.theme !== next) {
            root.classList.add('theme-swap');                  // switch at once, no half-faded frame
            root.dataset.theme = next;
            requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-swap')));
            if (window.Chart) {                                // charts drawn from now on take the new ink
                Chart.defaults.color = light ? '#6f6a8b' : '#42424e';
                Chart.defaults.borderColor = light ? 'rgba(50,36,140,.08)' : 'rgba(255,255,255,.04)';
            }
        }
        document.querySelectorAll('[data-theme-pick]').forEach(b => {
            b.classList.toggle('on', b.dataset.themePick === c);
            b.setAttribute('aria-pressed', b.dataset.themePick === c ? 'true' : 'false');
        });
    }

    window.setTheme = function (c) {
        localStorage.setItem(KEY, c);
        apply();
    };
    document.addEventListener('click', ev => {
        const b = ev.target.closest('[data-theme-pick]');
        if (b) setTheme(b.dataset.themePick);
    });
    media.addEventListener('change', apply);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
})();
