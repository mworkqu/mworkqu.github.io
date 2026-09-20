/* ── Store data layer ──────────────────────────────────────
   Single source of truth for the catalogue. The shop grid, the
   client inventory page, and the cart all read through here so
   a price or stock figure is only ever written in one place:
   data/products.json.

   Availability rule (see docs/inventory-model.md):
     available = onHand - committed
   `committed` is stock that is sold or reserved but not yet
   shipped. The shop offers `available`, never `onHand` — that
   is what stops the same unit being promised twice. */

window.Store = (function () {

  const DATA_URL = '/data/products.json';
  let cache = null;

  async function load() {
    if (cache) return cache;
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Catalogue unavailable (${res.status})`);
    const data = await res.json();
    data.bySku = Object.fromEntries(data.products.map((p) => [p.sku, p]));
    cache = data;
    return cache;
  }

  /* Digital goods have no stock ceiling. */
  function available(product) {
    if (product.type === 'digital') return Infinity;
    /* Demo mode: anything this browser has in its cart, or in an
       order that has not arrived yet, counts as reserved too — so
       the shop reacts to buying without writing to products.json. */
    const held = (window.ClientStore && window.ClientStore.extraCommitted)
      ? window.ClientStore.extraCommitted(product.sku) : 0;
    return (product.onHand || 0) - (product.committed || 0) - held;
  }

  /* Drives the label, the button, and whether an order becomes a
     stock pick or a production job. */
  function stockState(product) {
    if (product.type === 'digital') return 'digital';
    const av = available(product);
    if (av <= 0) return 'made-to-order';
    if (av <= (product.reorderPoint || 0)) return 'low';
    return 'in-stock';
  }

  function stockLabel(product) {
    switch (stockState(product)) {
      case 'digital':
        return t('stock.instant', 'Instant download');
      case 'made-to-order':
        return t('stock.madeToOrder', 'Made to order · {n} days')
          .replace('{n}', product.leadTimeDays || 21);
      case 'low':
        return t('stock.only', 'Only {n} left').replace('{n}', available(product));
      default:
        return t('stock.inStock', '{n} in stock').replace('{n}', available(product));
    }
  }

  function money(amount, currency) {
    if (window.I18n) return I18n.money(amount, currency);
    return `${currency || 'QAR'} ${Number(amount).toLocaleString('en-US')}`;
  }

  /* Catalogue rows carry parallel *_ar fields rather than { en, ar }
     pairs, because cart lines and project items store the product NAME
     as a plain string: changing the shape would make a saved line
     retranslate itself, and a stored record should keep the wording it
     was created with. Falls back to English when the Arabic is absent. */
  function text(row, field) {
    if (!row) return '';
    if (window.I18n && I18n.lang() === 'ar' && row[field + '_ar']) return row[field + '_ar'];
    return row[field] || '';
  }

  function t(key, fallback) {
    const v = window.I18n ? I18n.t(key) : key;
    return v === key ? fallback : v;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function art(id) {
    const paths = (window.PRODUCT_ART || {})[id];
    if (!paths) return '';
    return `<svg width="100" height="100" viewBox="0 0 100 100" fill="none" aria-hidden="true">${paths}</svg>`;
  }

  return { load, available, stockState, stockLabel, money, escapeHtml, art, text };

})();
