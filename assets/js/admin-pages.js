/* ── Admin and vendor pages ────────────────────────────────
   One section per page, selected by data-dash-page on <body>.

   The vendor sections deliberately never render a price or a
   client name: a workshop needs the drawing, the quantity and the
   date, and nothing else. */

(function () {

  const page = document.body.dataset.dashPage;
  if (!page) return;

  const esc   = Store.escapeHtml;
  const money = (n) => Store.money(n, 'QAR');
  const $     = (sel) => document.querySelector(sel);
  const num   = (v) => (v === Infinity ? '∞' : String(v));

  let catalogue = null;

  const physical = () => catalogue.products.filter((p) => p.type !== 'digital');

  function empty(message) {
    return `<p class="dash-empty">${esc(message)}</p>`;
  }

  function jobBadge(state) {
    const cls = state === 'READY' ? ' complete' : state === 'PRODUCTION' ? ' active' : '';
    const label = { QUEUED: 'Queued', PRODUCTION: 'In production', READY: 'Ready' }[state] || state;
    return `<span class="badge${cls}">${esc(label)}</span>`;
  }

  /* ── Admin: store stock ──────────────────────────────── */

  function renderStock() {
    const rows = physical();
    $('[data-stock-table]').innerHTML = `
      <table class="g-table">
        <thead>
          <tr>
            <th>Product</th><th>SKU</th>
            <th class="num">On hand</th><th class="num">Committed</th>
            <th class="num">Available</th><th class="num">Reorder at</th>
            <th class="num">On order</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((p) => {
            const av    = AdminStore.available(p);
            const alert = AdminStore.needsReorder(p);
            const oo    = AdminStore.onOrder(p.sku);
            return `
            <tr>
              <td>${esc(p.name)}${alert && !oo ? '<div class="cell-note">Below reorder point</div>' : ''}</td>
              <td class="mono small">${esc(p.sku)}</td>
              <td class="num mono">${AdminStore.onHand(p)}</td>
              <td class="num mono">${AdminStore.committed(p)}</td>
              <td class="num mono${alert ? ' stock-alert' : ''}">${num(av)}</td>
              <td class="num mono">${p.reorderPoint}</td>
              <td class="num mono">${oo || '—'}</td>
              <td class="num">
                ${alert && !oo
                  ? `<button class="btn-table" type="button" data-make="${esc(p.sku)}">Make a batch</button>`
                  : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    const flagged = rows.filter((p) => AdminStore.needsReorder(p) && !AdminStore.onOrder(p.sku));
    const note = $('[data-stock-alert]');
    note.textContent = flagged.length
      ? flagged.length > 1
        ? `${flagged.length} products are at or below their reorder point with nothing on order.`
        : '1 product is at or below its reorder point with nothing on order.'
      : 'Every product is above its reorder point, or already has a batch on order.';
  }

  function renderLedger() {
    const rows = AdminStore.ledger().slice(0, 12);
    $('[data-ledger-table]').innerHTML = !rows.length
      ? empty('No movements recorded yet. Receiving stock or finishing a batch writes a line here.')
      : `<table class="g-table">
          <thead><tr><th>Date</th><th>SKU</th><th class="num">Change</th><th>Reason</th><th>Reference</th></tr></thead>
          <tbody>
            ${rows.map((m) => `
              <tr>
                <td class="mono small">${esc(m.at)}</td>
                <td class="mono small">${esc(m.sku)}</td>
                <td class="num mono">${m.delta > 0 ? '+' : ''}${m.delta}</td>
                <td>${esc({ receive: 'Received', batch: 'Batch finished', adjust: 'Adjustment' }[m.reason] || m.reason)}</td>
                <td class="small">${esc(m.ref)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
  }

  function fillSkuSelects() {
    const options = physical()
      .map((p) => `<option value="${esc(p.sku)}">${esc(p.name)} · ${esc(p.sku)}</option>`).join('');
    document.querySelectorAll('[data-sku-select]').forEach((sel) => {
      const keep = sel.value;
      sel.innerHTML = options;
      if (keep) sel.value = keep;
    });
  }

  function initStock() {
    fillSkuSelects();
    const draw = () => { renderStock(); renderLedger(); };
    draw();
    document.addEventListener('adminstore:change', draw);
    document.addEventListener('clientstore:change', draw);

    $('[data-receive-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const f   = e.target;
      const qty = parseInt(f.qty.value, 10);
      const err = f.querySelector('[data-error]');
      if (!qty || qty < 1) { err.textContent = 'Enter how many arrived.'; return; }
      err.textContent = '';
      AdminStore.receive(f.sku.value, qty, f.ref.value.trim() || 'Delivery booked in');
      f.reset(); fillSkuSelects();
    });

    $('[data-batch-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      const f   = e.target;
      const qty = parseInt(f.qty.value, 10);
      const err = f.querySelector('[data-error]');
      if (!qty || qty < 1) { err.textContent = 'Enter how many to make.'; return; }
      err.textContent = '';
      const product = catalogue.bySku[f.sku.value];
      AdminStore.createBatch({
        sku: product.sku, name: product.name, qty: qty,
        process: f.process.value.trim(), due: f.due.value, vendor: f.vendor.value
      });
      f.reset(); fillSkuSelects();
    });

    /* "Make a batch" on an alert row pre-fills the form rather than
       creating a job behind the user's back. */
    $('[data-stock-table]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-make]');
      if (!btn) return;
      const product = catalogue.bySku[btn.dataset.make];
      const form = $('[data-batch-form]');
      form.sku.value = product.sku;
      form.qty.value = Math.max(product.reorderPoint * 2, 4);
      form.process.value = product.category === 'digital' ? '' : '';
      form.scrollIntoView({ block: 'center' });
      form.qty.focus();
    });
  }

  /* ── Admin: jobs ─────────────────────────────────────── */

  function renderJobs() {
    const rows = AdminStore.jobs();
    $('[data-jobs-table]').innerHTML = !rows.length
      ? empty('No jobs yet.')
      : `<table class="g-table">
          <thead>
            <tr><th>Job</th><th>Making</th><th class="num">Qty</th><th>Vendor</th><th>Due</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            ${rows.map((j) => `
              <tr>
                <td class="mono small">${esc(j.id)}</td>
                <td>${esc(j.name)}${j.process ? `<div class="cell-note">${esc(j.process)}</div>` : ''}</td>
                <td class="num mono">${j.qty}${j.madeQty !== null && j.madeQty !== j.qty ? `<div class="cell-note">made ${j.madeQty}</div>` : ''}</td>
                <td>
                  <select class="mini-select" data-assign="${esc(j.id)}"${j.state === 'READY' ? ' disabled' : ''}>
                    ${['Workshop A', 'Workshop B'].map((v) => `<option${v === j.vendor ? ' selected' : ''}>${v}</option>`).join('')}
                  </select>
                </td>
                <td class="mono small">${esc(j.due || '—')}</td>
                <td>${jobBadge(j.state)}</td>
                <td class="num">${j.state === 'QUEUED' ? `<button class="btn-table" type="button" data-start="${esc(j.id)}">Release</button>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
  }

  function initJobs() {
    renderJobs();
    document.addEventListener('adminstore:change', renderJobs);

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-start]');
      if (btn) AdminStore.start(btn.dataset.start);
    });
    document.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-assign]');
      if (sel) AdminStore.assign(sel.dataset.assign, sel.value);
    });
  }

  /* ── Admin: quotes ───────────────────────────────────── */

  function renderQuoteList() {
    const rows = ClientStore.projects().filter((p) => p.state !== 'CANCELLED');
    $('[data-quote-list]').innerHTML = !rows.length
      ? empty('No client projects yet.')
      : `<table class="g-table">
          <thead><tr><th>Reference</th><th>Project</th><th class="num">Parts</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${rows.map((p) => `
              <tr>
                <td class="mono small">${esc(p.id)}</td>
                <td>${esc(p.title)}</td>
                <td class="num mono">${p.parts.length}</td>
                <td><span class="badge${p.state === 'NEW' ? '' : ' active'}">${esc(p.state)}</span></td>
                <td class="num"><a class="btn-table" href="/dashboard/admin/quotes/detail/?id=${encodeURIComponent(p.id)}">${p.quote ? 'View quote' : 'Build quote'}</a></td>
              </tr>`).join('')}
          </tbody>
        </table>`;
  }

  function initQuoteList() {
    renderQuoteList();
    document.addEventListener('clientstore:change', renderQuoteList);
  }

  /* The quote never re-prices the parts. What the client bought
     from the shop he has already paid for; what he supplies is his.
     The quote covers the work — design and production — and then
     shows the whole project cost so nobody is surprised. */
  function initQuoteDetail() {
    const id = new URLSearchParams(location.search).get('id');
    const p  = ClientStore.project(id);
    const host = $('[data-quote-detail]');

    if (!p) { host.innerHTML = empty('That project could not be found.'); return; }

    $('[data-quote-ref]').textContent   = p.id;
    $('[data-quote-title]').textContent = p.title;

    const form = $('[data-quote-form]');
    if (p.quote) {
      form.designHours.value    = p.quote.designHours;
      form.rate.value           = p.quote.rate;
      form.production.value     = p.quote.production;
      form.contingencyPct.value = p.quote.contingencyPct;
    }

    function figures() {
      const fresh  = ClientStore.project(id);
      const hours  = Number(form.designHours.value) || 0;
      const rate   = Number(form.rate.value) || 0;
      const prod   = Number(form.production.value) || 0;
      const pct    = Number(form.contingencyPct.value) || 0;

      const paid = fresh.parts
        .filter((l) => l.source === 'ordered' || l.source === 'delivered')
        .reduce((n, l) => n + l.qty * (l.unitPrice || 0), 0);
      const fromShelf = fresh.parts
        .filter((l) => l.source === 'inventory')
        .reduce((n, l) => n + l.qty, 0);
      const supplied = fresh.parts
        .filter((l) => l.source === 'supplied')
        .reduce((n, l) => n + l.qty, 0);

      const design      = hours * rate;
      const subtotal    = design + prod;
      const contingency = Math.round(subtotal * pct / 100);
      const quoted      = subtotal + contingency;

      return { hours, rate, prod, pct, paid, fromShelf, supplied, design, subtotal, contingency, quoted };
    }

    function renderQuote() {
      const f = figures();
      const fresh = ClientStore.project(id);
      $('[data-quote-state]').textContent = fresh.state;

      host.innerHTML = `
        <table class="g-table">
          <tbody>
            <tr><td>Design</td><td class="small">${f.hours} h &times; ${esc(money(f.rate))}</td><td class="num mono">${esc(money(f.design))}</td></tr>
            <tr><td>Production</td><td class="small">Assembly and finishing</td><td class="num mono">${esc(money(f.prod))}</td></tr>
            <tr><td>Contingency</td><td class="small">${f.pct}%</td><td class="num mono">${esc(money(f.contingency))}</td></tr>
            <tr><td><strong>Quoted to the client</strong></td><td></td><td class="num mono"><strong>${esc(money(f.quoted))}</strong></td></tr>
          </tbody>
        </table>

        <p class="dash-panel-title dash-section-gap">Parts, for information</p>
        <table class="g-table">
          <tbody>
            <tr><td>Bought from the shop for this project</td><td class="small">Already paid</td><td class="num mono">${esc(money(f.paid))}</td></tr>
            <tr><td>Taken from the client's own stock</td><td class="small">${f.fromShelf} item${f.fromShelf === 1 ? '' : 's'}</td><td class="num mono">—</td></tr>
            <tr><td>Supplied by the client</td><td class="small">${f.supplied} item${f.supplied === 1 ? '' : 's'}</td><td class="num mono">—</td></tr>
            <tr><td><strong>Whole project cost</strong></td><td class="small">Quote plus what he has already spent</td><td class="num mono"><strong>${esc(money(f.quoted + f.paid))}</strong></td></tr>
          </tbody>
        </table>`;
    }

    renderQuote();
    form.addEventListener('input', renderQuote);
    document.addEventListener('clientstore:change', renderQuote);

    $('[data-send-quote]').addEventListener('click', () => {
      const f = figures();
      ClientStore.setQuote(id, {
        designHours: f.hours, rate: f.rate, production: f.prod,
        contingencyPct: f.pct, quoted: f.quoted, alreadyPaid: f.paid,
        total: f.quoted + f.paid
      });
      $('[data-quote-note]').textContent =
        `Quote sent. These figures are now frozen — a later price change will not move them.`;
    });
  }

  /* ── Vendor: the job list ────────────────────────────── */

  function vendorName() {
    return window.VENDOR_NAME || localStorage.getItem('gestaltung.vendor') || 'Workshop A';
  }

  function renderVendorJobs() {
    const rows = AdminStore.forVendor(vendorName());
    const open = rows.filter((j) => j.state !== 'READY');
    const done = rows.filter((j) => j.state === 'READY');

    $('[data-vendor-open]').innerHTML = !open.length
      ? empty('Nothing assigned to you right now.')
      : `<table class="g-table">
          <thead><tr><th>Job</th><th>Make</th><th class="num">Qty</th><th>Due</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${open.map((j) => `
              <tr>
                <td class="mono small">${esc(j.id)}</td>
                <td>${esc(j.name)}${j.process ? `<div class="cell-note">${esc(j.process)}</div>` : ''}</td>
                <td class="num mono">${j.qty}</td>
                <td class="mono small">${esc(j.due || '—')}</td>
                <td>${jobBadge(j.state)}</td>
                <td class="num">
                  ${j.state === 'QUEUED'
                    ? `<button class="btn-table" type="button" data-v-start="${esc(j.id)}">Start</button>`
                    : `<button class="btn-table" type="button" data-v-ready="${esc(j.id)}">Mark ready</button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`;

    $('[data-vendor-done]').innerHTML = !done.length
      ? empty('Nothing finished yet.')
      : `<table class="g-table">
          <thead><tr><th>Job</th><th>Made</th><th class="num">Ordered</th><th class="num">Made</th><th>Note</th></tr></thead>
          <tbody>
            ${done.map((j) => `
              <tr>
                <td class="mono small">${esc(j.id)}</td>
                <td>${esc(j.name)}</td>
                <td class="num mono">${j.qty}</td>
                <td class="num mono">${j.madeQty}</td>
                <td class="small">${esc(j.note || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
  }

  function initVendor() {
    const picker = $('[data-vendor-picker]');
    picker.value = vendorName();
    $('[data-vendor-name]').textContent = vendorName();

    picker.addEventListener('change', () => {
      window.VENDOR_NAME = picker.value;
      try { localStorage.setItem('gestaltung.vendor', picker.value); } catch (e) { /* private mode */ }
      $('[data-vendor-name]').textContent = picker.value;
      renderVendorJobs();
    });

    renderVendorJobs();
    document.addEventListener('adminstore:change', renderVendorJobs);

    document.addEventListener('click', (e) => {
      const s = e.target.closest('[data-v-start]');
      if (s) return AdminStore.start(s.dataset.vStart);

      const r = e.target.closest('[data-v-ready]');
      if (!r) return;

      const job = AdminStore.job(r.dataset.vReady);
      const panel = $('[data-ready-panel]');
      panel.hidden = false;
      panel.dataset.job = job.id;
      $('[data-ready-job]').textContent = `${job.id} · ${job.name}`;
      $('[data-ready-qty]').value = job.qty;
      $('[data-ready-qty]').max = job.qty;
      $('[data-ready-note]').value = '';
      $('[data-ready-error]').textContent = '';
      panel.scrollIntoView({ block: 'center' });
    });

    $('[data-ready-confirm]').addEventListener('click', () => {
      const panel = $('[data-ready-panel]');
      const made  = parseInt($('[data-ready-qty]').value, 10);
      const err   = $('[data-ready-error]');
      if (!made || made < 1) { err.textContent = 'Enter how many you actually made.'; return; }
      err.textContent = '';
      const out = AdminStore.markReady(panel.dataset.job, made, $('[data-ready-note]').value.trim());
      panel.hidden = true;
      $('[data-vendor-note]').textContent = out.short
        ? `Marked ready — ${out.made} made, ${out.short} short. The shortfall stays on the record.`
        : `Marked ready. ${out.made} added to stock.`;
    });

    $('[data-ready-cancel]').addEventListener('click', () => {
      $('[data-ready-panel]').hidden = true;
    });
  }

  /* ── Admin overview ──────────────────────────────────── */

  function renderAdminOverview() {
    const flagged = physical().filter((p) => AdminStore.needsReorder(p) && !AdminStore.onOrder(p.sku));
    const jobs    = AdminStore.jobs();
    const set = (k, v) => { const el = $(`[data-metric="${k}"]`); if (el) el.textContent = v; };

    set('reorder',  flagged.length);
    set('jobs',     jobs.filter((j) => j.state !== 'READY').length);
    set('projects', ClientStore.projects().filter((p) => p.state !== 'CANCELLED').length);
    set('quotes',   ClientStore.projects().filter((p) => p.state === 'QUOTED').length);

    $('[data-reorder-table]').innerHTML = !flagged.length
      ? empty('Nothing needs reordering. Every product is above its reorder point or already on order.')
      : `<table class="g-table">
          <thead><tr><th>Product</th><th class="num">Available</th><th class="num">Reorder at</th><th></th></tr></thead>
          <tbody>
            ${flagged.map((p) => `
              <tr>
                <td>${esc(p.name)}<div class="cell-note mono">${esc(p.sku)}</div></td>
                <td class="num mono stock-alert">${AdminStore.available(p)}</td>
                <td class="num mono">${p.reorderPoint}</td>
                <td class="num"><a class="btn-table" href="/dashboard/admin/inventory/">Open stock</a></td>
              </tr>`).join('')}
          </tbody>
        </table>`;
  }

  function initAdminOverview() {
    renderAdminOverview();
    document.addEventListener('adminstore:change', renderAdminOverview);
    document.addEventListener('clientstore:change', renderAdminOverview);
  }

  /* ── Boot ────────────────────────────────────────────── */

  Promise.all([Store.load(), ClientStore.ready(), AdminStore.ready()])
    .then(([data]) => {
      catalogue = data;
      if (page === 'admin-overview')  initAdminOverview();
      if (page === 'admin-inventory') initStock();
      if (page === 'admin-jobs')      initJobs();
      if (page === 'admin-quotes')    initQuoteList();
      if (page === 'admin-quote')     initQuoteDetail();
      if (page === 'vendor-jobs')     initVendor();
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
