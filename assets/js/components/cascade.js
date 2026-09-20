/* ── Process → Material cascade ────────────────────────────
   One component, two callers: the quote form on /manufacturing/
   and the filter panel in the project workspace. Both read
   data/processes.json, so adding a process or a material is a data
   edit and nothing here changes.

   Material is dependent, never standalone: the second select stays
   disabled until a process is chosen and then offers only that
   process's materials. Changing the process resets it, because a
   material that belonged to the old process is not a valid answer
   for the new one.

   Two modes:
     mode: 'form'   — blank first option, required-ish, and an
                      "Other (specify)" escape hatch that reveals a
                      text input. Clients do ask for odd materials.
     mode: 'filter' — an "All" option on both, no escape hatch.

   Usage:
     const c = await ProcessCascade.mount(el, { mode: 'filter',
                 onChange: ({ process, material }) => redraw() });
     c.value();  // { process, material, materialOther }
     c.reset(); */

window.ProcessCascade = (function () {

  const DATA_URL = '/data/processes.json';
  let cache = null;

  async function load() {
    if (cache) return cache;
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Processes unavailable (${res.status})`);
    cache = await res.json();
    return cache;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  /* Falls back to the raw key when i18n has not loaded, so the
     control is never blank. */
  function t(key, fallback) {
    const v = window.I18n ? I18n.t(key) : key;
    return v === key ? fallback : v;
  }

  const label = (pair) => (window.I18n ? I18n.pick(pair) : (pair.en || ''));

  async function mount(host, opts) {
    if (!host) return null;
    const o        = opts || {};
    const mode     = o.mode === 'form' ? 'form' : 'filter';
    const prefix   = o.idPrefix || 'pc';
    const wrapCls  = o.fieldClass || (mode === 'form' ? 'field' : 'panel-field');
    const data     = await load();
    const byKey    = Object.fromEntries(data.processes.map((p) => [p.key, p]));

    const OTHER = '__other__';

    function processOptions() {
      const head = mode === 'form'
        ? `<option value="">${esc(t('cascade.selectProcess', 'Select process'))}</option>`
        : `<option value="">${esc(t('cascade.allProcesses', 'All processes'))}</option>`;
      return head + data.processes
        .map((p) => `<option value="${esc(p.key)}">${esc(label(p.label))}</option>`)
        .join('');
    }

    function materialOptions(processKey) {
      if (!processKey) {
        return `<option value="">${esc(
          mode === 'form'
            ? t('cascade.chooseProcessFirst', 'Choose a process first')
            : t('cascade.allMaterials', 'All materials')
        )}</option>`;
      }
      const head = mode === 'form'
        ? `<option value="">${esc(t('cascade.selectMaterial', 'Select material'))}</option>`
        : `<option value="">${esc(t('cascade.allMaterials', 'All materials'))}</option>`;

      const list = ((byKey[processKey] || {}).materials || [])
        .map((m) => `<option value="${esc(m.key)}">${esc(label(m.label))}</option>`)
        .join('');

      const other = mode === 'form'
        ? `<option value="${OTHER}">${esc(t('cascade.otherSpecify', 'Other (specify)'))}</option>`
        : '';

      return head + list + other;
    }

    host.innerHTML = `
      <div class="${esc(wrapCls)}">
        <label for="${esc(prefix)}-process" data-i18n="cascade.process">${esc(t('cascade.process', 'Manufacturing Process'))}</label>
        <select id="${esc(prefix)}-process" name="${esc(o.processName || 'process')}" data-cascade-process>
          ${processOptions()}
        </select>
      </div>
      <div class="${esc(wrapCls)}">
        <label for="${esc(prefix)}-material" data-i18n="cascade.material">${esc(t('cascade.material', 'Material'))}</label>
        <select id="${esc(prefix)}-material" name="${esc(o.materialName || 'material')}" data-cascade-material disabled>
          ${materialOptions('')}
        </select>
      </div>
      <div class="${esc(wrapCls)}" data-cascade-other hidden>
        <label for="${esc(prefix)}-other" data-i18n="cascade.otherLabel">${esc(t('cascade.otherLabel', 'Which material?'))}</label>
        <input type="text" id="${esc(prefix)}-other" name="${esc(o.otherName || 'materialOther')}"
               data-cascade-other-input
               data-i18n-placeholder="cascade.otherPlaceholder"
               placeholder="${esc(t('cascade.otherPlaceholder', 'Name the material you need'))}">
      </div>`;

    const processEl  = host.querySelector('[data-cascade-process]');
    const materialEl = host.querySelector('[data-cascade-material]');
    const otherWrap  = host.querySelector('[data-cascade-other]');
    const otherInput = host.querySelector('[data-cascade-other-input]');

    function value() {
      const material = materialEl.value;
      return {
        process:  processEl.value || null,
        material: material && material !== OTHER ? material : null,
        materialOther: material === OTHER ? (otherInput.value.trim() || null) : null
      };
    }

    function syncOther() {
      const on = materialEl.value === OTHER;
      otherWrap.hidden = !on;
      if (!on) otherInput.value = '';
    }

    function emit() {
      if (typeof o.onChange === 'function') o.onChange(value());
    }

    /* A process change always clears the material. Carrying the old
       one over would let you submit "Laser Cutting + Aluminium 7075". */
    processEl.addEventListener('change', () => {
      materialEl.innerHTML = materialOptions(processEl.value);
      materialEl.disabled  = !processEl.value;
      syncOther();
      emit();
    });

    materialEl.addEventListener('change', () => { syncOther(); emit(); });
    otherInput.addEventListener('input', emit);

    function reset() {
      processEl.value      = '';
      materialEl.innerHTML = materialOptions('');
      materialEl.disabled  = true;
      syncOther();
      emit();
    }

    /* Re-label in place on a language switch, keeping the selection. */
    function relabel() {
      const p = processEl.value;
      const m = materialEl.value;
      processEl.innerHTML  = processOptions();
      processEl.value      = p;
      materialEl.innerHTML = materialOptions(p);
      materialEl.value     = m;
      syncOther();
    }
    document.addEventListener('i18n:change', relabel);

    if (window.I18n) I18n.apply(host);

    /* Used by the classifier to pre-select what it identified. The
       user can still change it — a suggestion that silently locks the
       control would be the classifier deciding, which is the one
       thing it must not do. Emits like a real change so any listener
       sees it, but leaves the material cleared for the user. */
    function setProcess(key) {
      if (!key || processEl.value === key) return false;
      const exists = Array.prototype.some.call(
        processEl.options, (o) => o.value === key);
      if (!exists) return false;
      processEl.value = key;
      materialEl.innerHTML = materialOptions(key);
      materialEl.disabled  = false;
      syncOther();
      emit();
      return true;
    }

    return {
      value: value, reset: reset, relabel: relabel, setProcess: setProcess,
      processEl: processEl, materialEl: materialEl,
      data: data
    };
  }

  /* Label lookup for code that renders results rather than controls. */
  async function labelFor(processKey, materialKey) {
    const data = await load();
    const p = data.processes.find((x) => x.key === processKey);
    if (!p) return { process: '', material: '' };
    const m = (p.materials || []).find((x) => x.key === materialKey);
    return { process: label(p.label), material: m ? label(m.label) : '' };
  }

  return { load: load, mount: mount, labelFor: labelFor };

})();
