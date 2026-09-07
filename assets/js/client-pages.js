/* ── Client dashboard pages ────────────────────────────────
   One file, one section per page. The page announces itself with
   data-client-page on <body>. Every section re-renders on
   clientstore:change, so a movement made anywhere is reflected
   everywhere without manual refresh calls. */

(function () {

  const page = document.body.dataset.clientPage;
  if (!page) return;

  const esc   = Store.escapeHtml;
  const money = (n) => Store.money(n, 'QAR');
  const $     = (sel) => document.querySelector(sel);

  const SOURCE_LABEL = {
    inventory: 'From my inventory',
    cart:      'In cart',
    ordered:   'Ordered',
    delivered: 'Delivered',
    supplied:  'I supply this'
  };

  function partBadge(source) {
    const cls = source === 'inventory' || source === 'delivered' ? ' held'
              : source === 'cart' ? ' pending' : '';
    return `<span class="part-badge${cls}">${esc(SOURCE_LABEL[source] || source)}</span>`;
  }

  function empty(message) {
    return `<p class="dash-empty">${esc(message)}</p>`;
  }

  /* ── Inventory ───────────────────────────────────────── */

  function renderInventory() {
    const host = $('[data-inventory-table]');
    const rows = ClientStore.inventory();
    if (!rows.length) {
      host.innerHTML = empty('Nothing on your shelf yet. Add a part below, or buy from the shop.');
      return;
    }
    host.innerHTML = `
      <table class="g-table">
        <thead>
          <tr><th>Part</th><th>Reference</th><th>Origin</th><th class="num">Quantity</th><th></th></tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.name)}${r.note ? `<div class="cell-note">${esc(r.note)}</div>` : ''}</td>
              <td class="mono small">${r.sku ? esc(r.sku) : '—'}</td>
              <td>${r.origin === 'store' ? 'Bought here' : 'My own'}</td>
              <td class="num mono">${r.qty}</td>
              <td class="num"><button class="btn-table danger" type="button" data-remove-inv="${esc(r.id)}">Remove</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function initInventory() {
    renderInventory();
    document.addEventListener('clientstore:change', renderInventory);

    $('[data-own-part-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const name = form.name_.value.trim();
      const qty  = parseInt(form.qty.value, 10);
      const err  = form.querySelector('[data-error]');
      if (!name || !qty || qty < 1) {
        err.textContent = 'Enter a part name and a quantity of at least 1.';
        return;
      }
      err.textContent = '';
      ClientStore.addOwnPart({ name, qty, note: form.note.value.trim() });
      form.reset();
    });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-inv]');
      if (btn) ClientStore.removeInventoryLine(btn.dataset.removeInv);
    });
  }

  /* ── Overview ────────────────────────────────────────── */

  function renderOverview() {
    const projects  = ClientStore.projects();
    const onShelf   = ClientStore.inventory().reduce((n, i) => n + i.qty, 0);
    const allocated = projects.reduce((n, p) =>
      n + p.parts.filter((l) => l.source === 'inventory' || l.source === 'delivered')
                 .reduce((m, l) => m + l.qty, 0), 0);
    const inCart    = ClientStore.cart().reduce((n, l) => n + l.qty, 0);

    const set = (key, value) => {
      const el = document.querySelector(`[data-metric="${key}"]`);
      if (el) el.textContent = value;
    };
    set('projects',  projects.filter((p) => p.state !== 'CANCELLED').length);
    set('inventory', onShelf);
    set('allocated', allocated);
    set('cart',      inCart);

    renderProjects();
  }

  function initOverview() {
    renderOverview();
    document.addEventListener('clientstore:change', renderOverview);
  }

  /* ── Projects list ───────────────────────────────────── */

  function renderProjects() {
    const host = $('[data-project-list]');
    const rows = ClientStore.projects();
    if (!rows.length) { host.innerHTML = empty('No projects yet.'); return; }
    host.innerHTML = `
      <table class="g-table">
        <thead>
          <tr><th>Reference</th><th>Project</th><th>Type</th><th class="num">Parts</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${rows.map((p) => `
            <tr>
              <td class="mono small">${esc(p.id)}</td>
              <td>${esc(p.title)}</td>
              <td>${p.type === 'design' ? 'Design &amp; build' : 'Make to order'}</td>
              <td class="num mono">${p.parts.length}</td>
              <td><span class="badge${p.state === 'CANCELLED' ? '' : ' active'}">${esc(p.state)}</span></td>
              <td class="num"><a class="btn-table" href="/dashboard/client/projects/detail/?id=${encodeURIComponent(p.id)}">Open</a></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function initProjects() {
    renderProjects();
    document.addEventListener('clientstore:change', renderProjects);

    const form = $('[data-project-form]');
    form.addEventListener('change', () => {
      const type = form.querySelector('[name="type"]:checked');
      form.querySelectorAll('[data-when]').forEach((block) => {
        block.hidden = !type || block.dataset.when !== type.value;
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const err   = form.querySelector('[data-error]');
      const type  = form.querySelector('[name="type"]:checked');
      const title = form.title_.value.trim();
      const brief = form.brief.value.trim();
      if (!type)  { err.textContent = 'Choose what you need first.'; return; }
      if (!title) { err.textContent = 'Give the project a name.'; return; }
      if (!brief) { err.textContent = 'Describe what you are trying to achieve.'; return; }
      err.textContent = '';
      const id = ClientStore.createProject({
        title, brief, type: type.value, targetDate: form.targetDate.value
      });
      window.location.href = '/dashboard/client/projects/detail/?id=' + encodeURIComponent(id);
    });
  }

  /* ── Project detail: the parts list ──────────────────── */

  function initDetail(catalogue) {
    const id = new URLSearchParams(location.search).get('id');
    const p  = ClientStore.project(id);
    const host = $('[data-project-detail]');

    if (!p) {
      host.innerHTML = empty('That project could not be found.');
      return;
    }

    $('[data-project-ref]').textContent   = p.id;
    $('[data-project-title]').textContent = p.title;
    $('[data-project-state]').textContent = p.state;
    $('[data-project-brief]').textContent = p.brief;

    function renderParts() {
      const fresh = ClientStore.project(id);
      const total = fresh.parts.reduce((n, l) => n + l.qty * (l.unitPrice || 0), 0);

      host.innerHTML = !fresh.parts.length
        ? empty('No parts yet. Search below to add one from your inventory, or buy it from the shop.')
        : `<table class="g-table">
            <thead>
              <tr><th class="num">Qty</th><th>Part</th><th>Source</th><th class="num">Line total</th><th></th></tr>
            </thead>
            <tbody>
              ${fresh.parts.map((l) => `
                <tr>
                  <td class="num mono">${l.qty}</td>
                  <td>${esc(l.name)}${l.sku ? `<div class="cell-note mono">${esc(l.sku)}</div>` : ''}</td>
                  <td>${partBadge(l.source)}</td>
                  <td class="num mono">${l.unitPrice ? esc(money(l.qty * l.unitPrice)) : '—'}</td>
                  <td class="num"><button class="btn-table danger" type="button" data-remove-part="${esc(l.lineId)}">Remove</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
          <div class="parts-total">
            <span>Parts subtotal</span>
            <span class="mono">${esc(money(total))}</span>
          </div>`;

      const cancelBtn = $('[data-cancel-project]');
      if (cancelBtn) cancelBtn.hidden = ClientStore.project(id).state === 'CANCELLED';
      $('[data-project-state]').textContent = ClientStore.project(id).state;
    }

    /* The quote the admin sent. The client sees the groups — the
       work, and what he has already spent — not how they were
       arrived at. */
    function renderQuote() {
      const fresh = ClientStore.project(id);
      const host  = $('[data-quote-panel]');
      const q     = fresh.quote;

      if (!q) { host.innerHTML = ''; return; }

      const design      = q.designHours * q.rate;
      const contingency = Math.round((design + q.production) * q.contingencyPct / 100);
      const approved    = fresh.state === 'APPROVED' || fresh.state === 'PRODUCTION'
                       || fresh.state === 'READY'    || fresh.state === 'CLOSED';

      host.innerHTML = `
        <p class="dash-panel-title dash-section-gap">Your quote</p>
        <div class="table-scroll">
          <table class="g-table">
            <tbody>
              <tr><td>Design</td><td class="small">${q.designHours} h</td><td class="num mono">${esc(money(design))}</td></tr>
              <tr><td>Production</td><td class="small">Assembly and finishing</td><td class="num mono">${esc(money(q.production))}</td></tr>
              <tr><td>Contingency</td><td class="small">${q.contingencyPct}%</td><td class="num mono">${esc(money(contingency))}</td></tr>
              <tr><td><strong>To approve</strong></td><td class="small">Sent ${esc(q.sentAt)}</td><td class="num mono"><strong>${esc(money(q.quoted))}</strong></td></tr>
              <tr><td>Parts you have already bought</td><td class="small">Paid at checkout</td><td class="num mono">${esc(money(q.alreadyPaid))}</td></tr>
              <tr><td><strong>Whole project</strong></td><td></td><td class="num mono"><strong>${esc(money(q.total))}</strong></td></tr>
            </tbody>
          </table>
        </div>
        <div class="dash-actions" style="margin-top:16px">
          ${approved
            ? `<p class="field-note">Approved ${esc(q.approvedAt || '')}. Work can start.</p>`
            : '<button class="btn btn-primary btn-arrow" type="button" data-approve-quote>Approve this quote</button>'}
        </div>`;
    }

    renderParts();
    renderQuote();
    document.addEventListener('clientstore:change', () => { renderParts(); renderQuote(); });

    const quotePanel = $('[data-quote-panel]');
    quotePanel.addEventListener('click', (e) => {
      if (e.target.closest('[data-approve-quote]')) ClientStore.approveQuote(id);
    });

    host.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-part]');
      if (btn) ClientStore.removePart(id, btn.dataset.removePart);
    });

    const cancelBtn = $('[data-cancel-project]');
    cancelBtn.addEventListener('click', () => {
      if (cancelBtn.dataset.armed) { ClientStore.cancelProject(id); return; }
      cancelBtn.dataset.armed = '1';
      cancelBtn.textContent = 'Cancel project — parts return to inventory. Click again';
    });

    initPartPicker(id, catalogue);
  }

  /* Search box that offers his shelf first, then the catalogue. */
  function initPartPicker(projectId, catalogue) {
    const box     = $('[data-part-search]');
    const results = $('[data-part-results]');
    const qtyIn   = $('[data-part-qty]');
    const note    = $('[data-part-note]');

    function matches(term) {
      const t = term.toLowerCase();
      const shelf = ClientStore.inventory()
        .filter((i) => i.name.toLowerCase().includes(t) || (i.sku || '').toLowerCase().includes(t))
        .map((i) => ({ kind: 'shelf', key: i.sku || i.name, name: i.name, sku: i.sku, have: i.qty, price: i.unitPrice }));

      const shelfSkus = new Set(shelf.map((s) => s.sku).filter(Boolean));
      const shop = catalogue.products
        .filter((pr) => !shelfSkus.has(pr.sku))
        .filter((pr) => pr.name.toLowerCase().includes(t) || pr.sku.toLowerCase().includes(t))
        .map((pr) => ({ kind: 'shop', key: pr.sku, name: pr.name, sku: pr.sku, have: 0, price: pr.price }));

      return shelf.concat(shop).slice(0, 8);
    }

    function render(term) {
      note.textContent = '';
      if (!term.trim()) { results.innerHTML = ''; return; }
      const found = matches(term.trim());
      if (!found.length) {
        results.innerHTML = `
          <div class="pick-row">
            <span class="pick-name">${esc(term)}</span>
            <span class="pick-have">Not in your inventory or the shop</span>
            <button class="btn-table" type="button" data-pick-supplied="${esc(term)}">I supply this</button>
          </div>`;
        return;
      }
      results.innerHTML = found.map((r) => `
        <div class="pick-row">
          <span class="pick-name">${esc(r.name)}${r.sku ? `<span class="mono small"> ${esc(r.sku)}</span>` : ''}</span>
          <span class="pick-have">${r.kind === 'shelf' ? `${r.have} on your shelf` : 'Shop &middot; ' + esc(money(r.price))}</span>
          <button class="btn-table" type="button"
            data-pick="${esc(r.key)}" data-kind="${r.kind}"
            data-name="${esc(r.name)}" data-sku="${esc(r.sku || '')}" data-price="${r.price || 0}">
            ${r.kind === 'shelf' ? 'Use mine' : 'Add to cart'}
          </button>
        </div>`).join('');
    }

    box.addEventListener('input', () => render(box.value));

    results.addEventListener('click', (e) => {
      const qty = Math.max(1, parseInt(qtyIn.value, 10) || 1);

      const supplied = e.target.closest('[data-pick-supplied]');
      if (supplied) {
        ClientStore.addClientSuppliedPart(projectId, supplied.dataset.pickSupplied, qty);
        note.textContent = `Added ${qty} × ${supplied.dataset.pickSupplied} as a part you supply.`;
        box.value = ''; results.innerHTML = '';
        return;
      }

      const btn = e.target.closest('[data-pick]');
      if (!btn) return;
      const { kind, name, sku, price } = btn.dataset;

      if (kind === 'shelf') {
        const r = ClientStore.addPartFromInventory(projectId, btn.dataset.pick, qty);
        note.textContent = r.shortfall
          ? `Only ${r.taken} ${r.taken === 1 ? 'was' : 'were'} on your shelf — the other ${r.shortfall} went to your cart.`
          : `${r.taken} taken from your inventory.`;
      } else {
        ClientStore.addPartToCart(projectId, sku, name, qty, Number(price));
        note.textContent = `${qty} × ${name} added to your cart for this project.`;
      }
      box.value = ''; results.innerHTML = '';
    });
  }

  /* ── Cart and orders ─────────────────────────────────── */

  function renderCart() {
    const host  = $('[data-cart-table]');
    const lines = ClientStore.cart();

    host.innerHTML = !lines.length
      ? empty('Your cart is empty.')
      : `<table class="g-table">
          <thead>
            <tr><th class="num">Qty</th><th>Item</th><th>For</th><th class="num">Line total</th><th></th></tr>
          </thead>
          <tbody>
            ${lines.map((l) => `
              <tr>
                <td class="num"><input class="qty-input mono" type="number" min="1" value="${l.qty}" data-cart-qty="${esc(l.lineId)}" aria-label="Quantity"></td>
                <td>${esc(l.name)}${l.sku ? `<div class="cell-note mono">${esc(l.sku)}</div>` : ''}</td>
                <td>${l.projectId ? `<span class="mono small">${esc(l.projectId)}</span>` : 'My inventory'}</td>
                <td class="num mono">${esc(money(l.qty * l.unitPrice))}</td>
                <td class="num"><button class="btn-table danger" type="button" data-cart-remove="${esc(l.lineId)}">Remove</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="parts-total">
          <span>Total</span>
          <span class="mono">${esc(money(ClientStore.cartTotal()))}</span>
        </div>`;

    $('[data-place-order]').disabled = !lines.length;
  }

  function renderOrders() {
    const host = $('[data-orders-table]');
    const rows = ClientStore.orders();
    host.innerHTML = !rows.length
      ? empty('No orders yet.')
      : `<table class="g-table">
          <thead>
            <tr><th>Order</th><th>Placed</th><th class="num">Items</th><th class="num">Total</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            ${rows.map((o) => `
              <tr>
                <td class="mono small">${esc(o.id)}</td>
                <td class="mono small">${esc(o.placedAt)}</td>
                <td class="num mono">${o.lines.reduce((n, l) => n + l.qty, 0)}</td>
                <td class="num mono">${esc(money(o.total))}</td>
                <td><span class="badge${o.state === 'delivered' ? ' complete' : ' active'}">${o.state === 'delivered' ? 'Delivered' : 'On its way'}</span></td>
                <td class="num">${o.state === 'delivered' ? '' : `<button class="btn-table" type="button" data-deliver="${esc(o.id)}">Mark delivered</button>`}</td>
              </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function initCart() {
    const draw = () => { renderCart(); renderOrders(); };
    draw();
    document.addEventListener('clientstore:change', draw);

    document.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-cart-remove]');
      if (rm) return ClientStore.removeCartLine(rm.dataset.cartRemove);
      const dv = e.target.closest('[data-deliver]');
      if (dv) return ClientStore.markDelivered(dv.dataset.deliver);
    });

    document.addEventListener('change', (e) => {
      const q = e.target.closest('[data-cart-qty]');
      if (q) ClientStore.updateCartQty(q.dataset.cartQty, parseInt(q.value, 10));
    });

    $('[data-place-order]').addEventListener('click', () => {
      const order = ClientStore.placeOrder();
      if (!order) return;
      const msg      = $('[data-order-note]');
      const tagged   = order.lines.filter((l) => l.projectId).length;
      const untagged = order.lines.length - tagged;

      let where;
      if (!tagged)        where = 'Everything lands in your inventory on delivery.';
      else if (!untagged) where = `${tagged} line${tagged > 1 ? 's go' : ' goes'} straight to its project on delivery.`;
      else                where = `${tagged} line${tagged > 1 ? 's go' : ' goes'} straight to its project on delivery; the other ${untagged} land${untagged > 1 ? '' : 's'} in your inventory.`;

      msg.textContent = `${order.id} placed. ${where}`;
    });
  }

  /* ── Boot ────────────────────────────────────────────── */

  Promise.all([ClientStore.ready(), Store.load()])
    .then(([, catalogue]) => {
      if (page === 'overview')  initOverview();
      if (page === 'inventory') initInventory();
      if (page === 'projects')  initProjects();
      if (page === 'detail')    initDetail(catalogue);
      if (page === 'cart')      initCart();
    })
    .catch((err) => {
      const main = document.querySelector('.dash-main');
      if (main) {
        main.insertAdjacentHTML('afterbegin',
          `<p class="shop-error">This page could not load its data. ${esc(err.message)}<br>
           If you opened the file directly, serve the site instead: <code>python -m http.server 8000</code></p>`);
      }
    });

})();
