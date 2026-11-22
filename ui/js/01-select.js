/* ═══ Modern dropdowns, everywhere ═══
   Every <select> of the app gets a styled button and list. The native <select> stays in the page,
   hidden: the code keeps reading .value, setting .value, listening to « change » as before.
   - options added or renamed later (innerHTML, appendChild): the list follows (MutationObserver)
   - .value or .selectedIndex set by code: the button follows (patched on the element)
   - keyboard: Enter / Space / arrows open; arrows move; Enter picks; Escape closes; typing jumps
   A <select data-native> is left alone. */
(function () {
    const OPEN = { sel: null, menu: null, btn: null };

    function label(sel) {
        const o = sel.options[sel.selectedIndex];
        return o ? o.textContent : '';
    }

    function refresh(sel) {
        const ui = sel._fancy;
        if (!ui) return;
        ui.text.textContent = label(sel) || '—';
        ui.btn.disabled = sel.disabled;
        ui.btn.title = sel.title || label(sel);
        if (OPEN.sel === sel) renderMenu(sel);
    }

    function close() {
        if (!OPEN.menu) return;
        OPEN.menu.remove();
        OPEN.btn.setAttribute('aria-expanded', 'false');
        OPEN.btn.classList.remove('open');
        OPEN.sel = OPEN.menu = OPEN.btn = null;
    }

    function pick(sel, i) {
        if (i < 0 || i >= sel.options.length || sel.options[i].disabled) return;
        const changed = sel.selectedIndex !== i;
        sel.selectedIndex = i;
        close();
        sel._fancy.btn.focus({ preventScroll: true });
        if (changed) {
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function renderMenu(sel) {
        const menu = OPEN.menu;
        const q = (menu._q || '').toLowerCase();
        const list = menu.querySelector('.fs-list');
        list.innerHTML = '';
        [...sel.options].forEach((o, i) => {
            if (q && !o.textContent.toLowerCase().includes(q)) return;
            const it = document.createElement('div');
            it.className = 'fs-opt' + (i === sel.selectedIndex ? ' on' : '') + (o.disabled ? ' off' : '') + (i === menu._active ? ' active' : '');
            it.setAttribute('role', 'option');
            it.setAttribute('aria-selected', i === sel.selectedIndex ? 'true' : 'false');
            it.dataset.i = i;
            const check = document.createElement('span');
            check.className = 'fs-check';
            check.innerHTML = i === sel.selectedIndex ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' : '';
            const t = document.createElement('span');
            t.className = 'fs-opt-text';
            t.textContent = o.textContent || '—';
            it.append(check, t);
            it.addEventListener('mousedown', ev => ev.preventDefault());
            it.addEventListener('click', () => pick(sel, i));
            it.addEventListener('mousemove', () => { if (menu._active !== i) { menu._active = i; mark(menu); } });
            list.append(it);
        });
        if (!list.children.length) {
            const e = document.createElement('div');
            e.className = 'fs-empty';
            e.textContent = 'Aucun resultat';
            list.append(e);
        }
    }

    function mark(menu) {
        menu.querySelectorAll('.fs-opt').forEach(el => el.classList.toggle('active', Number(el.dataset.i) === menu._active));
        const a = menu.querySelector('.fs-opt.active'), list = menu.querySelector('.fs-list');
        if (a && list) {                                    // scroll the list only, never the page
            if (a.offsetTop < list.scrollTop) list.scrollTop = a.offsetTop;
            else if (a.offsetTop + a.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = a.offsetTop + a.offsetHeight - list.clientHeight;
        }
    }

    function place(menu, btn) {
        const r = btn.getBoundingClientRect();
        const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
        const up = below < 220 && above > below;
        menu.style.minWidth = Math.max(r.width, 200) + 'px';
        menu.style.maxWidth = Math.max(r.width, 420) + 'px';
        menu.style.left = Math.min(r.left, window.innerWidth - Math.max(r.width, 200) - 8) + 'px';
        menu.style.maxHeight = Math.min(360, up ? above : below) + 'px';
        if (up) { menu.style.top = ''; menu.style.bottom = (window.innerHeight - r.top + 6) + 'px'; }
        else { menu.style.bottom = ''; menu.style.top = (r.bottom + 6) + 'px'; }
    }

    function open(sel) {
        if (OPEN.sel === sel) return close();
        close();
        const btn = sel._fancy.btn;
        btn.scrollIntoView({ block: 'nearest' });           // fully visible first: the list opens next to it
        const menu = document.createElement('div');
        menu.className = 'fs-menu';
        menu.setAttribute('role', 'listbox');
        menu._active = sel.selectedIndex;
        menu._q = '';
        if (sel.options.length > 8) {                      // a long list gets a search field
            const s = document.createElement('input');
            s.className = 'fs-search';
            s.placeholder = 'Chercher…';
            s.addEventListener('input', () => { menu._q = s.value; renderMenu(sel); });
            s.addEventListener('keydown', ev => keys(ev, sel));
            menu.append(s);
        }
        const list = document.createElement('div');
        list.className = 'fs-list';
        menu.append(list);
        document.body.append(menu);
        OPEN.sel = sel; OPEN.menu = menu; OPEN.btn = btn;
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('open');
        renderMenu(sel);
        place(menu, btn);
        (menu.querySelector('.fs-search') || btn).focus({ preventScroll: true });
        mark(menu);
    }

    function keys(ev, sel) {
        const isOpen = OPEN.sel === sel;
        const visible = isOpen ? [...OPEN.menu.querySelectorAll('.fs-opt:not(.off)')].map(e => Number(e.dataset.i)) : [];
        if (!isOpen && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(ev.key)) { ev.preventDefault(); open(sel); return; }
        if (!isOpen) return;
        if (ev.key === 'Escape') { ev.preventDefault(); close(); sel._fancy.btn.focus({ preventScroll: true }); return; }
        if (ev.key === 'Tab') { close(); return; }
        if (ev.key === 'Enter') { ev.preventDefault(); pick(sel, OPEN.menu._active); return; }
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            if (!visible.length) return;
            const k = visible.indexOf(OPEN.menu._active);
            OPEN.menu._active = visible[ev.key === 'ArrowDown' ? Math.min(visible.length - 1, k + 1) : Math.max(0, k - 1)] ?? visible[0];
            mark(OPEN.menu);
            return;
        }
        if (ev.key.length === 1 && !OPEN.menu.querySelector('.fs-search')) {   // type a letter: jump to it
            const c = ev.key.toLowerCase();
            const hit = [...sel.options].findIndex(o => !o.disabled && o.textContent.trim().toLowerCase().startsWith(c));
            if (hit >= 0) { OPEN.menu._active = hit; mark(OPEN.menu); }
        }
    }

    function enhance(sel) {
        if (sel._fancy || sel.multiple || sel.size > 1 || sel.hasAttribute('data-native')) return;
        const wrap = document.createElement('span');
        wrap.className = 'fs';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fs-btn ' + (sel.className || '');
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        if (sel.id) btn.dataset.for = sel.id;
        if (sel.getAttribute('style')) btn.setAttribute('style', sel.getAttribute('style'));
        const text = document.createElement('span');
        text.className = 'fs-text';
        const chev = document.createElement('span');
        chev.className = 'fs-chev';
        chev.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
        btn.append(text, chev);
        sel.parentNode.insertBefore(wrap, sel);
        wrap.append(btn, sel);
        sel.classList.add('fs-native');
        sel.tabIndex = -1;
        sel.setAttribute('aria-hidden', 'true');
        sel._fancy = { wrap, btn, text };
        btn.addEventListener('click', () => open(sel));
        btn.addEventListener('keydown', ev => keys(ev, sel));
        sel.addEventListener('change', () => refresh(sel));
        new MutationObserver(() => refresh(sel)).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
        for (const prop of ['value', 'selectedIndex']) {    // code that sets the value directly
            const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
            Object.defineProperty(sel, prop, { configurable: true, get() { return d.get.call(this); },
                set(v) { d.set.call(this, v); refresh(this); } });
        }
        const lbl = sel.id && document.querySelector(`label[for="${sel.id}"]`);
        if (lbl) lbl.addEventListener('click', ev => { ev.preventDefault(); btn.focus(); });
        refresh(sel);
    }

    function scan(root) {
        if (root.tagName === 'SELECT') enhance(root);
        else if (root.querySelectorAll) root.querySelectorAll('select').forEach(enhance);
    }

    document.addEventListener('mousedown', ev => {
        if (OPEN.menu && !OPEN.menu.contains(ev.target) && !OPEN.btn.contains(ev.target)) close();
    });
    window.addEventListener('resize', close);
    document.addEventListener('scroll', ev => {             // the page moves: the list follows its button
        if (!OPEN.menu || OPEN.menu.contains(ev.target)) return;
        const r = OPEN.btn.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) close();
        else place(OPEN.menu, OPEN.btn);
    }, true);

    function start() {
        scan(document.body);
        new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) scan(n); })))
            .observe(document.body, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    window.fancySelect = enhance;
})();
