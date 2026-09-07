/* ── Store stock and jobs ──────────────────────────────────
   The admin side: what is on GESTALTUNG's own shelf, and the jobs
   that put it there.

   onHand is never a number anybody types. It is:

     products.json onHand
       + everything the stock ledger recorded coming in
       − everything delivered to clients

   so a wrong figure can always be traced to the movement that
   caused it. That is the whole point of keeping a ledger rather
   than an editable quantity field.

   Demo mode: state lives in localStorage under
   gestaltung.admin.v1, and client activity is read from whatever
   ClientStore holds in this same browser. */

window.AdminStore = (function () {

  const KEY = 'gestaltung.admin.v1';

  let state   = null;
  let loading = null;

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    document.dispatchEvent(new CustomEvent('adminstore:change'));
  }

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 9);
  }

  async function ready() {
    if (state) return state;
    if (loading) return loading;
    loading = (async () => {
      const saved = read();
      state = saved || { ledger: [], jobs: seedJobs(), counter: 24 };
      if (!saved) write();
      return state;
    })();
    return loading;
  }

  /* Two jobs already on the floor, so the vendor screen is not
     empty on a first visit. */
  function seedJobs() {
    return [
      {
        id: 'B-2026-0019', type: 'batch', sku: 'SKU-0202',
        name: 'Sine Bar — 200 mm', qty: 4,
        process: 'CNC · Ground tool steel', due: '2026-09-19',
        vendor: 'Workshop A', state: 'PRODUCTION', madeQty: null, note: ''
      },
      {
        id: 'B-2026-0021', type: 'batch', sku: 'SKU-0303',
        name: 'Compass Rose — Wall Mount', qty: 6,
        process: 'Waterjet · SS304', due: '2026-09-24',
        vendor: 'Workshop B', state: 'QUEUED', madeQty: null, note: ''
      }
    ];
  }

  /* ── stock ───────────────────────────────────────────── */

  function ledgerFor(sku) {
    return state.ledger.filter((m) => m.sku === sku);
  }

  function onHand(product) {
    const moved = ledgerFor(product.sku).reduce((n, m) => n + m.delta, 0);
    const sold  = (window.ClientStore && window.ClientStore.deliveredQty)
      ? window.ClientStore.deliveredQty(product.sku) : 0;
    return (product.onHand || 0) + moved - sold;
  }

  function committed(product) {
    const held = (window.ClientStore && window.ClientStore.extraCommitted)
      ? window.ClientStore.extraCommitted(product.sku) : 0;
    return (product.committed || 0) + held;
  }

  function available(product) {
    if (product.type === 'digital') return Infinity;
    return onHand(product) - committed(product);
  }

  function needsReorder(product) {
    if (product.type === 'digital') return false;
    return available(product) <= (product.reorderPoint || 0);
  }

  /* Units already on order for this SKU, so a reorder alert does
     not nag about something the workshop is currently making. */
  function onOrder(sku) {
    return state.jobs
      .filter((j) => j.sku === sku && j.state !== 'READY' && j.state !== 'CANCELLED')
      .reduce((n, j) => n + j.qty, 0);
  }

  function move(sku, delta, reason, ref) {
    state.ledger.unshift({
      id: uid('mv'),
      at: new Date().toISOString().slice(0, 10),
      sku: sku, delta: delta, reason: reason, ref: ref || ''
    });
  }

  function receive(sku, qty, ref) {
    if (!qty) return;
    move(sku, qty, 'receive', ref || 'Delivery booked in');
    write();
  }

  function adjust(sku, delta, ref) {
    if (!delta) return;
    move(sku, delta, 'adjust', ref || 'Stock count correction');
    write();
  }

  const ledger = () => state.ledger;

  /* ── jobs ────────────────────────────────────────────── */

  const jobs    = () => state.jobs;
  const job     = (id) => state.jobs.find((j) => j.id === id) || null;
  const forVendor = (vendor) => state.jobs.filter((j) => j.vendor === vendor && j.state !== 'CANCELLED');

  function createBatch(opts) {
    state.counter += 1;
    const id = 'B-2026-' + String(state.counter).padStart(4, '0');
    state.jobs.unshift({
      id: id, type: 'batch', sku: opts.sku, name: opts.name, qty: opts.qty,
      process: opts.process || '', due: opts.due || '',
      vendor: opts.vendor || 'Workshop A',
      state: 'QUEUED', madeQty: null, note: ''
    });
    write();
    return id;
  }

  function assign(id, vendor) {
    const j = job(id);
    if (!j) return;
    j.vendor = vendor;
    write();
  }

  function start(id) {
    const j = job(id);
    if (!j || j.state !== 'QUEUED') return;
    j.state = 'PRODUCTION';
    write();
  }

  /* Marking ready is the moment a batch job becomes stock. A short
     run is recorded as made, not as ordered — the shortfall stays
     visible rather than quietly disappearing. */
  function markReady(id, madeQty, note) {
    const j = job(id);
    if (!j || j.state === 'READY') return;
    const made = Math.max(0, Math.min(madeQty, j.qty));
    j.madeQty = made;
    j.note    = note || '';
    j.state   = 'READY';
    if (j.type === 'batch' && j.sku && made > 0) {
      move(j.sku, made, 'batch', j.id);
    }
    write();
    return { made: made, short: j.qty - made };
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
    state = null; loading = null;
  }

  return {
    ready: ready, onHand: onHand, committed: committed, available: available,
    needsReorder: needsReorder, onOrder: onOrder, receive: receive,
    adjust: adjust, ledger: ledger, ledgerFor: ledgerFor,
    jobs: jobs, job: job, forVendor: forVendor, createBatch: createBatch,
    assign: assign, start: start, markReady: markReady, reset: reset
  };

})();
