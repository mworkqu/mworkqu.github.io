/* ── i18n ──────────────────────────────────────────────────
   English and Arabic, from data/i18n/{en,ar}.json.

   Key shape is dotted and namespaced — nav.studio, workspace.
   filters.process — which is exactly what next-intl expects. Moving
   to it later is `useTranslations('workspace.filters')` plus
   `t('process')`, with no key renaming.

   Markup opts in per element:

     data-i18n="nav.studio"                 → textContent
     data-i18n-html="footer.legal"          → innerHTML, for strings
                                              carrying inline markup
     data-i18n-placeholder="form.namePh"    → placeholder attribute
     data-i18n-aria-label="nav.menu"        → aria-label attribute
     data-i18n-title="..." / -content="..." → title / content

   Anything without one of those attributes is left alone, so
   untranslated pages keep working.

   Load this in <head>, before the stylesheet paints: it sets lang
   and dir synchronously from localStorage so the RTL layout is
   correct on the first frame rather than snapping after load. */

window.I18n = (function () {

  const KEY       = 'gestaltung.lang';
  const SUPPORTED = ['en', 'ar'];
  const RTL       = ['ar'];
  const FALLBACK  = 'en';

  let lang    = FALLBACK;
  let dict    = {};
  let loading = null;

  /* ── language choice ─────────────────────────────────── */

  function saved() {
    try {
      const v = localStorage.getItem(KEY);
      return SUPPORTED.indexOf(v) !== -1 ? v : null;
    } catch (e) { return null; }
  }

  function preferred() {
    const s = saved();
    if (s) return s;
    const nav = (navigator.language || '').slice(0, 2).toLowerCase();
    return SUPPORTED.indexOf(nav) !== -1 ? nav : FALLBACK;
  }

  const isRtl = (l) => RTL.indexOf(l || lang) !== -1;

  /* Runs at parse time, before first paint. The document ships in
     English, so an Arabic reader would otherwise see a frame of the
     wrong language in the wrong direction — hide the body until the
     dictionary has been applied, and only in that case. */
  function applyDirection(next) {
    const el = document.documentElement;
    el.setAttribute('lang', next);
    el.setAttribute('dir', isRtl(next) ? 'rtl' : 'ltr');
  }

  lang = preferred();
  applyDirection(lang);
  if (lang !== FALLBACK) document.documentElement.classList.add('i18n-pending');

  /* ── dictionary ──────────────────────────────────────── */

  function lookup(source, path) {
    return path.split('.').reduce(
      (node, part) => (node && typeof node === 'object' ? node[part] : undefined),
      source
    );
  }

  /* Missing keys return the key itself. Loud in the UI, harmless in
     production, and easy to grep for. */
  function t(path, vars) {
    let out = lookup(dict, path);
    if (typeof out !== 'string') return path;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
      });
    }
    return out;
  }

  /* Pick the right half of a { en, ar } pair, the shape the process
     and material labels in data/processes.json use. */
  function pick(pair) {
    if (!pair) return '';
    if (typeof pair === 'string') return pair;
    return pair[lang] || pair[FALLBACK] || '';
  }

  /* Western digits in both languages: SKUs, prices and tolerances
     are written that way in Qatari technical documents, and mixing
     numeral systems across a bilingual page reads badly. */
  function number(value) {
    return Number(value).toLocaleString('en-US');
  }

  function money(amount, currency) {
    const c = currency || 'QAR';
    return isRtl() ? `${number(amount)} ${c}` : `${c} ${number(amount)}`;
  }

  /* ── applying to the DOM ─────────────────────────────── */

  const ATTR_MAP = {
    'data-i18n-placeholder': 'placeholder',
    'data-i18n-aria-label':  'aria-label',
    'data-i18n-title':       'title',
    'data-i18n-content':     'content',
    'data-i18n-value':       'value',
    'data-i18n-alt':         'alt'
  };

  function apply(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = lookup(dict, el.getAttribute('data-i18n'));
      if (typeof v === 'string') el.textContent = v;
    });

    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const v = lookup(dict, el.getAttribute('data-i18n-html'));
      if (typeof v === 'string') el.innerHTML = v;
    });

    Object.keys(ATTR_MAP).forEach((dataAttr) => {
      scope.querySelectorAll('[' + dataAttr + ']').forEach((el) => {
        const v = lookup(dict, el.getAttribute(dataAttr));
        if (typeof v === 'string') el.setAttribute(ATTR_MAP[dataAttr], v);
      });
    });

    document.documentElement.classList.remove('i18n-pending');
  }

  async function load(next) {
    const res = await fetch(`/data/i18n/${next}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Locale ${next} unavailable (${res.status})`);
    return res.json();
  }

  async function ready() {
    if (loading) return loading;
    loading = (async () => {
      try {
        dict = await load(lang);
      } catch (e) {
        /* A missing Arabic file must not take the page down — fall
           back to the English already in the markup. */
        dict = {};
        document.documentElement.classList.remove('i18n-pending');
      }
      apply();
      document.dispatchEvent(new CustomEvent('i18n:ready', { detail: { lang: lang } }));
      return lang;
    })();
    return loading;
  }

  async function setLanguage(next) {
    if (SUPPORTED.indexOf(next) === -1 || next === lang) return lang;
    try { localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
    lang = next;
    applyDirection(lang);
    try { dict = await load(lang); } catch (e) { dict = {}; }
    apply();
    renderToggles();
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: lang } }));
    return lang;
  }

  /* ── the toggle ──────────────────────────────────────── */

  /* One button per page, marked with [data-lang-toggle]. It always
     names the language you would switch TO, in that language, which
     is the one label a reader of either language can understand. */
  function renderToggles() {
    document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
      const other = lang === 'ar' ? 'en' : 'ar';
      btn.textContent = other === 'ar' ? 'العربية' : 'EN';
      btn.setAttribute('lang', other);
      btn.setAttribute('aria-label',
        other === 'ar' ? 'التبديل إلى العربية' : 'Switch to English');
    });
  }

  function bindToggles() {
    renderToggles();
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lang-toggle]');
      if (!btn) return;
      e.preventDefault();
      setLanguage(lang === 'ar' ? 'en' : 'ar');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bindToggles(); ready(); });
  } else {
    bindToggles();
    ready();
  }

  return {
    t: t, pick: pick, money: money, number: number,
    apply: apply, ready: ready, setLanguage: setLanguage,
    lang: () => lang, isRtl: () => isRtl(), supported: () => SUPPORTED.slice()
  };

})();
