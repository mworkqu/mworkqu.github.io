/* ── Workspace shell ───────────────────────────────────────
   A slot-based layout plus a panel registry. The page itself owns
   no panel markup: it provides three slots and a context object,
   and panels register themselves into a slot.

   This exists so the tools this page is meant to grow — part
   modelling, image generation, schematic capture — arrive as

     WorkspacePanels.register({
       id: 'model', slot: 'center', order: 20,
       titleKey: 'workspace.panels.model',
       mount: (body, ctx) => { ... }
     });

   in their own file, with no edit to the page, the layout, or any
   other panel. Nothing AI-related is registered today; see
   assets/js/services/ai.js for the service-side hook.

   Panels never call each other. They share `ctx`, which carries the
   project id and a small event bus, so adding a panel cannot break
   one that already works.

   RTL: the grid container inherits dir from <html>, and CSS Grid
   orders columns along the inline axis, so the left slot renders on
   the right in Arabic with no separate stylesheet. */

window.WorkspacePanels = (function () {

  const SLOTS        = ['left', 'center', 'right'];
  const COLLAPSE_KEY = 'gestaltung.workspace.collapsed';

  const registry = [];

  function register(panel) {
    if (!panel || !panel.id) throw new Error('A workspace panel needs an id');
    if (SLOTS.indexOf(panel.slot) === -1) {
      throw new Error(`Unknown slot "${panel.slot}" for panel "${panel.id}"`);
    }
    if (registry.some((p) => p.id === panel.id)) return;   /* idempotent */
    registry.push(Object.assign({ order: 50, collapsible: true }, panel));
  }

  const forSlot = (slot) =>
    registry.filter((p) => p.slot === slot).sort((a, b) => a.order - b.order);

  /* ── collapse state ──────────────────────────────────── */

  function readCollapsed() {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function writeCollapsed(map) {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(map)); }
    catch (e) { /* private mode */ }
  }

  function isCollapsed(id, fallback) {
    const map = readCollapsed();
    return Object.prototype.hasOwnProperty.call(map, id) ? !!map[id] : !!fallback;
  }

  function setCollapsed(id, on) {
    const map = readCollapsed();
    map[id] = !!on;
    writeCollapsed(map);
  }

  /* ── event bus ───────────────────────────────────────── */

  function makeBus() {
    const target = new EventTarget();
    return {
      on:   (name, fn) => target.addEventListener(name, fn),
      off:  (name, fn) => target.removeEventListener(name, fn),
      emit: (name, detail) => target.dispatchEvent(new CustomEvent(name, { detail: detail }))
    };
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  function t(key, fallback) {
    const v = window.I18n ? I18n.t(key) : key;
    return v === key ? (fallback || key) : v;
  }

  /* ── rendering ───────────────────────────────────────── */

  function panelShell(panel) {
    const collapsed = panel.collapsible && isCollapsed(panel.id, panel.defaultCollapsed);
    const title     = t(panel.titleKey, panel.title || panel.id);

    const el = document.createElement('section');
    el.className = 'ws-panel' + (collapsed ? ' is-collapsed' : '');
    el.dataset.panelId = panel.id;

    el.innerHTML = `
      <div class="ws-panel-head">
        <h2 class="ws-panel-title"${panel.titleKey ? ` data-i18n="${esc(panel.titleKey)}"` : ''}>${esc(title)}</h2>
        ${panel.collapsible ? `
          <button class="ws-collapse" type="button"
                  aria-expanded="${collapsed ? 'false' : 'true'}"
                  data-panel-toggle="${esc(panel.id)}">
            <span class="ws-chevron" aria-hidden="true"></span>
            <span class="sr-only">${esc(t('workspace.togglePanel', 'Collapse or expand this panel'))}</span>
          </button>` : ''}
      </div>
      <div class="ws-panel-body" data-panel-body${collapsed ? ' hidden' : ''}></div>`;

    return el;
  }

  async function boot(host, context) {
    if (!host) return null;

    const ctx = Object.assign({ bus: makeBus() }, context || {});

    host.classList.add('ws-grid');
    host.innerHTML = SLOTS.map(
      (slot) => `<div class="ws-slot ws-slot-${slot}" data-slot="${slot}"></div>`
    ).join('');

    const mounted = [];

    for (const slot of SLOTS) {
      const column = host.querySelector(`[data-slot="${slot}"]`);
      const panels = forSlot(slot);
      if (!panels.length) { column.hidden = true; continue; }

      for (const panel of panels) {
        const shell = panelShell(panel);
        column.append(shell);
        const body = shell.querySelector('[data-panel-body]');
        try {
          /* One panel throwing must not take the workspace with it —
             the others are independent and should still come up. */
          const api = await panel.mount(body, ctx);
          mounted.push({ panel: panel, el: shell, body: body, api: api || {} });
        } catch (err) {
          body.innerHTML = `<p class="ws-panel-error">${esc(
            t('workspace.panelFailed', 'This panel could not load.'))}</p>`;
          if (window.console) console.error(`[workspace] panel "${panel.id}" failed`, err);
        }
      }
    }

    host.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-panel-toggle]');
      if (!btn) return;
      const shell = btn.closest('.ws-panel');
      const body  = shell.querySelector('[data-panel-body]');
      const next  = !shell.classList.contains('is-collapsed');
      shell.classList.toggle('is-collapsed', next);
      body.hidden = next;
      btn.setAttribute('aria-expanded', String(!next));
      setCollapsed(btn.dataset.panelToggle, next);
    });

    /* Re-title on a language switch without remounting: panel bodies
       hold their own state and must survive it. */
    document.addEventListener('i18n:change', () => {
      if (window.I18n) I18n.apply(host);
      ctx.bus.emit('i18n:change');
    });

    if (window.I18n) I18n.apply(host);

    return { ctx: ctx, panels: mounted };
  }

  return {
    register: register, boot: boot, slots: () => SLOTS.slice(),
    registered: () => registry.map((p) => p.id)
  };

})();
