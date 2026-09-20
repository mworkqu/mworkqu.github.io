/* ── Project workspace panels ──────────────────────────────
   Four panels registered into the WorkspacePanels slots:

     left    filters   process → material cascade, search, quantity
     center  results   what matched, and the add actions
     right   project   what is on the project now
     right   quote     the quote, once the admin has sent one

   Every write goes through DataStore, never through ClientStore, so
   the day this talks to Supabase none of this file changes.

   ── The add rules (item 2) ──
   In inventory     → one action, "Add to Project". Deducts on the
                      spot; the stock figure in the results list and
                      the row in the project panel both move without
                      a reload.
   Not in inventory → two actions. "Add to Cart" buys it onto the
                      client's own shelf, untagged. "Add to Project"
                      puts it on the project immediately and tags the
                      cart line with the project, so the project
                      panel can flag it as still needing payment.

   ── Optimistic writes ──
   Paint first, call second, undo on failure. Against localStorage
   the call resolves instantly and the optimistic frame is invisible;
   against Supabase it is a round trip and this is what keeps the
   count from lagging the click. Written the slow-backend way now so
   the behaviour does not have to be retrofitted later. */

(function () {

  if (!window.WorkspacePanels) return;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const t = (key, fallback) => {
    const v = window.I18n ? I18n.t(key) : key;
    return v === key ? (fallback || key) : v;
  };

  const tv = (key, vars, fallback) => {
    const v = window.I18n ? I18n.t(key, vars) : key;
    return v === key ? (fallback || key) : v;
  };

  let CURRENCY = 'QAR';
  const money = (n) => (window.I18n ? I18n.money(n, CURRENCY) : `${CURRENCY} ${n}`);

  /* Stock deltas painted before the store has confirmed them. Keyed
     by sku-or-name; cleared as soon as the write settles. */
  const pending = Object.create(null);
  const pendingFor = (key) => pending[key] || 0;

  function paintStock(key, delta) { pending[key] = pendingFor(key) + delta; }
  function clearStock(key, delta) {
    pending[key] = pendingFor(key) - delta;
    if (!pending[key]) delete pending[key];
  }

  async function optimistic(steps) {
    steps.paint();
    let result;
    try {
      result = await steps.commit();
    } catch (err) {
      if (window.console) console.error('[workspace] write failed', err);
      result = { ok: false, error: 'exception' };
    }
    steps.settle();
    if (!result || !result.ok) steps.rollback();
    return result || { ok: false, error: 'unknown' };
  }

  /* ── panel: filters + search ─────────────────────────── */

  WorkspacePanels.register({
    id: 'filters',
    slot: 'left',
    order: 10,
    titleKey: 'workspace.panels.filters',
    title: 'Find parts',

    async mount(body, ctx) {
      body.innerHTML = `
        <div class="panel-field">
          <label for="ws-search" data-i18n="workspace.search.label">${esc(t('workspace.search.label', 'Search'))}</label>
          <input class="text-input" type="search" id="ws-search" data-ws-search
                 data-i18n-placeholder="workspace.search.placeholder"
                 placeholder="${esc(t('workspace.search.placeholder', 'Search your inventory and the shop…'))}">
        </div>
        <div data-ws-cascade></div>
        <div class="panel-field">
          <label for="ws-qty" data-i18n="workspace.quantity">${esc(t('workspace.quantity', 'Quantity'))}</label>
          <input class="qty-input" type="number" id="ws-qty" min="1" value="1" data-ws-qty>
        </div>
        <button class="btn btn-ghost btn-block" type="button" data-ws-clear
                data-i18n="workspace.clearFilters">${esc(t('workspace.clearFilters', 'Clear filters'))}</button>`;

      const searchEl = body.querySelector('[data-ws-search]');
      const qtyEl    = body.querySelector('[data-ws-qty]');

      const cascade = await ProcessCascade.mount(
        body.querySelector('[data-ws-cascade]'),
        { mode: 'filter', idPrefix: 'ws', onChange: publish }
      );

      /* The quantity is read at click time by the results panel
         rather than pushed on every keystroke. */
      ctx.quantity = () => Math.max(1, parseInt(qtyEl.value, 10) || 1);

      function publish() {
        const f = cascade ? cascade.value() : { process: null, material: null };
        ctx.bus.emit('query:change', {
          term: searchEl.value.trim(),
          process: f.process,
          material: f.material
        });
      }

      searchEl.addEventListener('input', publish);
      body.querySelector('[data-ws-clear]').addEventListener('click', () => {
        searchEl.value = '';
        if (cascade) cascade.reset();
        publish();
      });

      publish();
      return { publish: publish };
    }
  });

  /* ── panel: results ──────────────────────────────────── */

  WorkspacePanels.register({
    id: 'results',
    slot: 'center',
    order: 10,
    titleKey: 'workspace.panels.results',
    title: 'Results',

    async mount(body, ctx) {
      const catalogue = await Store.load();
      CURRENCY = catalogue.currency || 'QAR';
      const config = await ProcessCascade.load();

      const procLabel = {};
      const matLabel  = {};
      config.processes.forEach((p) => {
        procLabel[p.key] = p.label;
        (p.materials || []).forEach((m) => { matLabel[p.key + '/' + m.key] = m.label; });
      });

      let query = { term: '', process: null, material: null };

      const tagsFor = (sku) => {
        const p = catalogue.bySku[sku];
        return p ? { process: p.process || null, material: p.material || null } : { process: null, material: null };
      };

      /* A stored line keeps the wording it was saved with, but when the
         SKU is one of ours the catalogue has a translated name and that
         is what should be shown. Parts the client added himself have no
         SKU and keep their own name in whatever language he typed. */
      const displayName = (sku, stored) =>
        (sku && catalogue.bySku[sku]) ? Store.text(catalogue.bySku[sku], 'name') : stored;

      ctx.displayName = displayName;

      function passesFilter(tags) {
        if (query.process && tags.process !== query.process) return false;
        if (query.material && tags.material !== query.material) return false;
        return true;
      }

      /* The search itself is unchanged: shelf first, then catalogue
         minus anything already on the shelf, substring on name or
         SKU, capped at eight. The process/material filter is applied
         as a separate pass on top of it. */
      async function rows() {
        const inv = await DataStore.listInventory();
        const term = query.term.toLowerCase();

        let shelf = inv.map((i) => Object.assign(
          { kind: 'shelf', key: i.sku || i.name, name: displayName(i.sku, i.name),
            sku: i.sku, have: i.qty, price: i.unitPrice || 0 },
          tagsFor(i.sku)
        ));

        let shop = catalogue.products.map((pr) => ({
          kind: 'shop', key: pr.sku, name: Store.text(pr, 'name'), sku: pr.sku,
          have: 0, price: pr.price, process: pr.process, material: pr.material
        }));

        const shelfSkus = new Set(shelf.map((s) => s.sku).filter(Boolean));
        shop = shop.filter((s) => !shelfSkus.has(s.sku));

        if (term) {
          const hit = (r) => r.name.toLowerCase().includes(term)
                          || (r.sku || '').toLowerCase().includes(term);
          shelf = shelf.filter(hit);
          shop  = shop.filter(hit);
        }

        const filtering = !!(query.process || query.material);
        if (filtering) {
          shelf = shelf.filter(passesFilter);
          shop  = shop.filter(passesFilter);
        }

        /* No term and no filter: show the shelf, which is the useful
           default for a workspace. A term keeps the original cap. */
        if (!term && !filtering) return shelf;
        if (!term) return shelf.concat(shop);
        return shelf.concat(shop).slice(0, 8);
      }

      function chips(r) {
        if (!r.process) return '';
        const p = window.I18n ? I18n.pick(procLabel[r.process]) : r.process;
        const m = r.material && matLabel[r.process + '/' + r.material]
          ? (window.I18n ? I18n.pick(matLabel[r.process + '/' + r.material]) : r.material)
          : '';
        return `<span class="ws-chips">
            <span class="ws-chip">${esc(p)}</span>
            ${m ? `<span class="ws-chip">${esc(m)}</span>` : ''}
          </span>`;
      }

      function stockLine(r) {
        const live = r.have + pendingFor(r.key);
        if (r.kind === 'shelf' || live > 0) {
          return `<span class="ws-stock${live <= 0 ? ' is-out' : ''}" data-stock-for="${esc(r.key)}">${
            esc(tv('workspace.inInventory', { n: live }, `${live} in your inventory`))
          }</span>`;
        }
        return `<span class="ws-stock is-shop">${esc(t('workspace.fromShop', 'Shop'))} · ${esc(money(r.price))}</span>`;
      }

      /* In inventory → one action. Not in inventory → two. */
      function actions(r) {
        const live = r.have + pendingFor(r.key);
        const data = `data-name="${esc(r.name)}" data-sku="${esc(r.sku || '')}" `
                   + `data-price="${r.price || 0}" data-key="${esc(r.key)}"`;
        if (live > 0) {
          return `<button class="btn-table primary" type="button" data-add-project ${data}
                    data-i18n="workspace.addToProject">${esc(t('workspace.addToProject', 'Add to Project'))}</button>`;
        }
        return `
          <button class="btn-table" type="button" data-add-cart ${data}
                  data-i18n="workspace.addToCart">${esc(t('workspace.addToCart', 'Add to Cart'))}</button>
          <button class="btn-table primary" type="button" data-add-project ${data}
                  data-i18n="workspace.addToProject">${esc(t('workspace.addToProject', 'Add to Project'))}</button>`;
      }

      async function render() {
        const found = await rows();

        if (!found.length) {
          const term = query.term;
          body.innerHTML = term
            ? `<div class="pick-row">
                 <span class="pick-name">${esc(term)}</span>
                 <span class="pick-have">${esc(t('workspace.noMatch', 'Not in your inventory or the shop'))}</span>
                 <button class="btn-table" type="button" data-pick-supplied="${esc(term)}"
                         data-i18n="workspace.iSupply">${esc(t('workspace.iSupply', 'I supply this'))}</button>
               </div>`
            : `<p class="ws-empty">${esc(t('workspace.noResults', 'Nothing matches these filters.'))}</p>`;
          return;
        }

        body.innerHTML = `<div class="ws-results">${found.map((r) => `
          <div class="ws-result" data-row-key="${esc(r.key)}">
            <div class="ws-result-main">
              <span class="pick-name">${esc(r.name)}${
                r.sku ? `<span class="mono small"> ${esc(r.sku)}</span>` : ''}</span>
              ${chips(r)}
            </div>
            ${stockLine(r)}
            <div class="ws-result-actions">${actions(r)}</div>
          </div>`).join('')}</div>`;

        if (window.I18n) I18n.apply(body);
      }

      /* ── writes ────────────────────────────────────── */

      async function addToProject(btn) {
        const qty  = ctx.quantity();
        const key  = btn.dataset.key;
        const item = {
          sku: btn.dataset.sku || null,
          name: btn.dataset.name,
          unitPrice: Number(btn.dataset.price) || 0
        };

        const stockEl = body.querySelector(`[data-stock-for="${CSS.escape(key)}"]`);
        const before  = stockEl ? stockEl.textContent : null;
        const have    = await DataStore.getStock(key);
        const willTake = Math.min(qty, have);

        const r = await optimistic({
          paint: () => {
            btn.disabled = true;
            if (willTake > 0) {
              paintStock(key, -willTake);
              if (stockEl) {
                stockEl.textContent = tv('workspace.inInventory',
                  { n: have - willTake }, `${have - willTake} in your inventory`);
              }
            }
            ctx.bus.emit('project:pending', { name: item.name, qty: qty });
          },
          commit: () => DataStore.addToProject(ctx.projectId, item, qty),
          settle: () => { if (willTake > 0) clearStock(key, -willTake); },
          rollback: () => {
            btn.disabled = false;
            if (stockEl && before !== null) stockEl.textContent = before;
          }
        });

        ctx.bus.emit('project:change');
        ctx.bus.emit('results:refresh');

        if (!r.ok) {
          ctx.bus.emit('notice', {
            kind: 'error',
            text: r.error === 'insufficient_stock'
              ? tv('workspace.notice.insufficient', { n: r.remaining || 0 },
                   `Only ${r.remaining || 0} left — nothing was taken.`)
              : t('workspace.notice.failed', 'That could not be added. Nothing changed.')
          });
          return;
        }

        /* Three outcomes, three sentences. "0 taken from your
           inventory" is technically true and useless. */
        let text;
        if (!r.taken) {
          text = tv('workspace.notice.forProject', { n: r.shortfall },
                    `${r.shortfall} added to the cart for this project.`);
        } else if (r.shortfall) {
          text = tv('workspace.notice.split', { taken: r.taken, short: r.shortfall },
                    `${r.taken} taken from your inventory — the other ${r.shortfall} added to the cart for this project.`);
        } else {
          text = tv('workspace.notice.taken', { n: r.taken },
                    `${r.taken} taken from your inventory.`);
        }
        ctx.bus.emit('notice', { kind: 'ok', text: text });
      }

      async function addToCart(btn) {
        const qty  = ctx.quantity();
        const item = {
          sku: btn.dataset.sku || null,
          name: btn.dataset.name,
          unitPrice: Number(btn.dataset.price) || 0
        };
        btn.disabled = true;
        const r = await DataStore.addToCart(item, qty);
        btn.disabled = false;
        ctx.bus.emit('notice', r.ok
          ? { kind: 'ok', text: tv('workspace.notice.carted', { n: qty, name: item.name },
              `${qty} × ${item.name} added to your cart.`) }
          : { kind: 'error', text: t('workspace.notice.failed', 'That could not be added. Nothing changed.') });
        ctx.bus.emit('project:change');
      }

      body.addEventListener('click', async (e) => {
        const supplied = e.target.closest('[data-pick-supplied]');
        if (supplied) {
          await DataStore.addSuppliedToProject(
            ctx.projectId, supplied.dataset.pickSupplied, ctx.quantity());
          ctx.bus.emit('notice', { kind: 'ok',
            text: t('workspace.notice.supplied', 'Added as a part you supply.') });
          ctx.bus.emit('project:change');
          return;
        }
        const proj = e.target.closest('[data-add-project]');
        if (proj) return addToProject(proj);
        const cart = e.target.closest('[data-add-cart]');
        if (cart) return addToCart(cart);
      });

      ctx.bus.on('query:change', (e) => { query = e.detail; render(); });
      ctx.bus.on('results:refresh', render);
      ctx.bus.on('i18n:change', render);

      await render();
      return { render: render };
    }
  });

  /* ── panel: the project ──────────────────────────────── */

  WorkspacePanels.register({
    id: 'project',
    slot: 'right',
    order: 10,
    titleKey: 'workspace.panels.project',
    title: 'This project',

    async mount(body, ctx) {
      const badge = {
        inventory: ['ok',      'workspace.status.fromInventory', 'From inventory'],
        cart:      ['warn',    'workspace.status.toPurchase',    'To purchase'],
        ordered:   ['pending', 'workspace.status.ordered',       'Ordered'],
        delivered: ['ok',      'workspace.status.delivered',     'Delivered'],
        supplied:  ['muted',   'workspace.status.supplied',      'You supply']
      };

      function statusCell(source) {
        const b = badge[source] || badge.supplied;
        return `<span class="ws-badge ${b[0]}" data-i18n="${b[1]}">${esc(t(b[1], b[2]))}</span>`;
      }

      async function render() {
        const items = await DataStore.listProjectItems(ctx.projectId);

        if (!items.length) {
          body.innerHTML = `<p class="ws-empty">${esc(
            t('workspace.project.empty', 'No parts yet. Search on the left to add one.'))}</p>`;
          return;
        }

        const total  = items.reduce((n, l) => n + l.qty * (l.unitPrice || 0), 0);
        const unpaid = items.filter((l) => l.paid === false);
        const owed   = unpaid.reduce((n, l) => n + l.qty * (l.unitPrice || 0), 0);

        body.innerHTML = `
          <ul class="ws-items">
            ${items.map((l) => `
              <li class="ws-item${l.paid === false ? ' is-unpaid' : ''}">
                <span class="ws-item-qty mono">${l.qty}×</span>
                <span class="ws-item-name">${esc(
                  ctx.displayName ? ctx.displayName(l.sku, l.name) : l.name)}${
                  l.sku ? `<span class="cell-note mono">${esc(l.sku)}</span>` : ''}</span>
                ${statusCell(l.source)}
                <span class="ws-item-price mono">${l.unitPrice ? esc(money(l.qty * l.unitPrice)) : '—'}</span>
                <button class="btn-table danger" type="button" data-remove-line="${esc(l.lineId)}"
                        data-i18n="workspace.remove">${esc(t('workspace.remove', 'Remove'))}</button>
              </li>`).join('')}
          </ul>
          <div class="parts-total">
            <span data-i18n="workspace.project.subtotal">${esc(t('workspace.project.subtotal', 'Parts subtotal'))}</span>
            <span class="mono">${esc(money(total))}</span>
          </div>
          ${unpaid.length ? `
            <div class="ws-pay-notice" role="status">
              <p class="ws-pay-title">${esc(tv('workspace.project.payTitle', { n: unpaid.length },
                `${unpaid.length} item${unpaid.length === 1 ? '' : 's'} still to pay for`))}</p>
              <p class="ws-pay-text">${esc(t('workspace.project.payText',
                'These are on the project but not yet bought. Check out to have them shipped.'))}</p>
              <a class="btn btn-primary btn-arrow" href="/dashboard/client/cart/">${
                esc(tv('workspace.project.payCta', { amount: money(owed) }, `Pay ${money(owed)}`))}</a>
            </div>` : ''}`;

        if (window.I18n) I18n.apply(body);
      }

      /* Removing returns the quantity to the shelf, so the results
         list has to redraw too. */
      body.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-remove-line]');
        if (!btn) return;
        btn.disabled = true;
        const r = await DataStore.removeFromProject(ctx.projectId, btn.dataset.removeLine);
        await render();
        ctx.bus.emit('results:refresh');
        ctx.bus.emit('notice', r.ok
          ? { kind: 'ok', text: r.restored
              ? tv('workspace.notice.restored', { n: r.restored },
                   `${r.restored} returned to your inventory.`)
              : t('workspace.notice.removed', 'Removed from the project.') }
          : { kind: 'error', text: t('workspace.notice.failed', 'That could not be removed. Nothing changed.') });
      });

      ctx.bus.on('project:change', render);
      ctx.bus.on('i18n:change', render);
      document.addEventListener('clientstore:change', render);

      await render();
      return { render: render };
    }
  });

  /* ── panel: the quote ────────────────────────────────── */

  WorkspacePanels.register({
    id: 'quote',
    slot: 'right',
    order: 20,
    titleKey: 'workspace.panels.quote',
    title: 'Your quote',
    defaultCollapsed: false,

    async mount(body, ctx) {
      async function render() {
        const p = await DataStore.getProject(ctx.projectId);
        const q = p && p.quote;

        if (!q) {
          body.innerHTML = `<p class="ws-empty">${esc(
            t('workspace.quote.none', 'No quote yet. One arrives once the studio has reviewed the brief.'))}</p>`;
          return;
        }

        const design      = q.designHours * q.rate;
        const contingency = Math.round((design + q.production) * q.contingencyPct / 100);
        const approved    = ['APPROVED', 'PRODUCTION', 'READY', 'CLOSED'].indexOf(p.state) !== -1;

        body.innerHTML = `
          <table class="g-table ws-quote">
            <tbody>
              <tr><td data-i18n="workspace.quote.design">${esc(t('workspace.quote.design', 'Design'))}</td>
                  <td class="small">${q.designHours} h</td>
                  <td class="num mono">${esc(money(design))}</td></tr>
              <tr><td data-i18n="workspace.quote.production">${esc(t('workspace.quote.production', 'Production'))}</td>
                  <td class="small"></td>
                  <td class="num mono">${esc(money(q.production))}</td></tr>
              <tr><td data-i18n="workspace.quote.contingency">${esc(t('workspace.quote.contingency', 'Contingency'))}</td>
                  <td class="small">${q.contingencyPct}%</td>
                  <td class="num mono">${esc(money(contingency))}</td></tr>
              <tr><td><strong data-i18n="workspace.quote.toApprove">${esc(t('workspace.quote.toApprove', 'To approve'))}</strong></td>
                  <td class="small">${esc(q.sentAt || '')}</td>
                  <td class="num mono"><strong>${esc(money(q.quoted))}</strong></td></tr>
              <tr><td data-i18n="workspace.quote.alreadyPaid">${esc(t('workspace.quote.alreadyPaid', 'Parts already bought'))}</td>
                  <td class="small"></td>
                  <td class="num mono">${esc(money(q.alreadyPaid))}</td></tr>
              <tr><td><strong data-i18n="workspace.quote.whole">${esc(t('workspace.quote.whole', 'Whole project'))}</strong></td>
                  <td></td>
                  <td class="num mono"><strong>${esc(money(q.total))}</strong></td></tr>
            </tbody>
          </table>
          <div class="dash-actions" style="margin-top:14px">
            ${approved
              ? `<p class="field-note">${esc(tv('workspace.quote.approved',
                  { date: q.approvedAt || '' }, `Approved ${q.approvedAt || ''}.`))}</p>`
              : `<button class="btn btn-primary btn-arrow" type="button" data-approve-quote
                   data-i18n="workspace.quote.approve">${esc(t('workspace.quote.approve', 'Approve this quote'))}</button>`}
          </div>`;

        if (window.I18n) I18n.apply(body);
      }

      body.addEventListener('click', (e) => {
        if (!e.target.closest('[data-approve-quote]')) return;
        ClientStore.approveQuote(ctx.projectId);
        render();
        ctx.bus.emit('project:meta');
      });

      ctx.bus.on('project:change', render);
      ctx.bus.on('i18n:change', render);

      await render();
      return { render: render };
    }
  });

})();
