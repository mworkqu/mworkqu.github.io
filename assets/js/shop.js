/* ── Shop grid ─────────────────────────────────────────────
   Renders the catalogue from data/products.json. The filter bar is
   built from the categories in that file too, so adding a category
   there is enough — no markup to touch.

   Buying here adds an untagged cart line, which lands in the
   client's own inventory on delivery. Cart lines added from inside
   a project carry that project's id and go to it instead. */

(function () {

  const grid    = document.querySelector('[data-filter-target="shop"]');
  const bar     = document.querySelector('[data-filter-group="shop"]');
  const counter = document.querySelector('[data-filter-count="shop"]');
  const cartLink = document.querySelector('[data-cart-link]');
  if (!grid) return;

  const esc = Store.escapeHtml;

  /* Falls back to the English literal, so a missing key degrades to
     English rather than to a raw key name. */
  const t = (key, fallback) => {
    const v = window.I18n ? I18n.t(key) : key;
    return v === key ? fallback : v;
  };
  let categories = [];
  let catalogue  = null;

  const labelFor = (key) =>
    Store.text(categories.find((c) => c.key === key), 'label') || key;

  function card(product, currency) {
    const state       = Store.stockState(product);
    const isDigital   = state === 'digital';
    const madeToOrder = state === 'made-to-order';
    const action      = isDigital
      ? t('shopGrid.download', 'Download')
      : t('shopGrid.addToCart', 'Add to cart');

    return `
      <article class="product-card" data-tags="${esc(product.category)}" data-sku="${esc(product.sku)}">
        <div class="product-img">${Store.art(product.art)}</div>
        <div class="product-body">
          <p class="product-category">${esc(labelFor(product.category))}</p>
          <h3 class="product-name">${esc(Store.text(product, 'name'))}</h3>
          <p class="product-desc">${esc(Store.text(product, 'description'))}</p>
          <p class="product-stock${state === 'low' ? ' low' : ''}${madeToOrder ? ' out' : ''}">
            ${esc(Store.stockLabel(product))}
          </p>
          <div class="product-foot">
            <span class="product-price">${esc(Store.money(product.price, currency))}</span>
            <button class="btn btn-ghost" style="padding:8px 16px;font-size:9px"
                    data-add="${esc(product.sku)}"${isDigital ? ' disabled' : ''}>${action}</button>
          </div>
        </div>
      </article>`;
  }

  function renderFilters() {
    if (!bar) return;
    bar.innerHTML = [
      `<button class="tag" data-filter="all" aria-pressed="true">${esc(t('shopGrid.all', 'All'))}</button>`,
      ...categories.map(
        (c) => `<button class="tag" data-filter="${esc(c.key)}" aria-pressed="false">${esc(Store.text(c, 'label'))}</button>`
      )
    ].join('');
  }

  /* Redrawn after every purchase so the stock lines reflect what is
     now reserved. Keeps the active filter. */
  function renderGrid() {
    grid.innerHTML = catalogue.products.map((p) => card(p, catalogue.currency)).join('');
    const active = bar && bar.querySelector('[aria-pressed="true"]');
    if (active && active.dataset.filter !== 'all') active.click();
    else if (counter) counter.textContent =
      t('shopGrid.count', '{n} items').replace('{n}', catalogue.products.length);
  }

  function renderCartLink() {
    if (!cartLink || !window.ClientStore) return;
    let n = 0;
    try { n = ClientStore.cart().reduce((sum, l) => sum + l.qty, 0); } catch (e) { return; }
    cartLink.innerHTML = n
      ? `<a href="/dashboard/client/cart/">${esc(t('shopGrid.inCart', '{n} in cart').replace('{n}', n))} &rarr;</a>`
      : '';
  }

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn || !window.ClientStore) return;
    const product = catalogue.bySku[btn.dataset.add];
    /* Out-of-stock items are still orderable — they just become a
       production job rather than a stock pick. */
    if (!product) return;

    ClientStore.addPartToCart(null, product.sku, product.name, 1, product.price);
    btn.textContent = t('shopGrid.added', 'Added');
    setTimeout(() => { renderGrid(); }, 900);
  });

  document.addEventListener('clientstore:change', renderCartLink);
  /* 'i18n:ready' as well as 'i18n:change': the catalogue fetch can
     finish before the dictionary does, so the first grid is drawn
     while t() is still falling back to English. */
  document.addEventListener('i18n:change', () => {
    if (catalogue) { renderFilters(); renderGrid(); renderCartLink(); }
  });

  Promise.all([Store.load(), window.ClientStore ? ClientStore.ready() : null])
    .then(([data]) => {
      catalogue  = data;
      categories = data.categories;
      renderFilters();
      renderGrid();
      renderCartLink();
      /* The catalogue and the dictionary are separate fetches; repaint
         once the dictionary has landed. */
      if (window.I18n) I18n.ready().then(() => { renderFilters(); renderGrid(); renderCartLink(); });
    })
    .catch((err) => {
      grid.innerHTML = `
        <p class="shop-error">
          The catalogue could not be loaded. ${esc(err.message)}
          <br>If you opened this file directly, serve the site instead: <code>python -m http.server 8000</code>
        </p>`;
      if (counter) counter.textContent = '';
    });

})();
