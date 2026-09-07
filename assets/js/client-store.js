/* ── Client state ──────────────────────────────────────────
   Inventory, cart, projects and orders for the signed-in client.

   Demo mode: there is no backend, so state lives in localStorage
   seeded once from data/client-inventory.json. Swap the read/write
   pair for fetch() calls and everything above them is unchanged.

   The rule the whole thing enforces (docs/inventory-model.md):
   a part is either in his inventory or on a project, never both
   and never neither. */

window.ClientStore = (function () {

  const KEY      = 'gestaltung.client.v1';
  const SEED_URL = '/data/client-inventory.json';

  let state   = null;
  let loading = null;

  /* ── persistence ─────────────────────────────────────── */

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    document.dispatchEvent(new CustomEvent('clientstore:change'));
  }

  async function ready() {
    if (state) return state;
    if (loading) return loading;
    loading = (async () => {
      const saved = read();
      if (saved) { state = saved; return state; }
      const res  = await fetch(SEED_URL, { cache: 'no-cache' });
      const seed = await res.json();
      state = {
        client:    seed.client,
        inventory: seed.inventory.map((i) => Object.assign({}, i, { id: uid('inv') })),
        projects:  seed.projects.map((p) => Object.assign({}, p, { parts: p.parts || [] })),
        cart:      [],
        orders:    [],
        counter:   41
      };
      write();
      return state;
    })();
    return loading;
  }

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 9);
  }

  /* ── reads ───────────────────────────────────────────── */

  const inventory = () => state.inventory;
  const cart      = () => state.cart;
  const projects  = () => state.projects;
  const orders    = () => state.orders;
  const project   = (id) => state.projects.find((p) => p.id === id) || null;

  /* Matched on SKU for catalogue items, on name for parts he
     added himself. */
  function invLine(key) {
    return state.inventory.find((i) => (i.sku ? i.sku === key : i.name === key)) || null;
  }

  function invQty(key) {
    const line = invLine(key);
    return line ? line.qty : 0;
  }

  /* Units reserved from store stock but not yet received. The shop
     subtracts these on top of the catalogue committed figure, so a
     demo purchase visibly reduces what is available. */
  function extraCommitted(sku) {
    let n = 0;
    state.cart.forEach((l) => { if (l.sku === sku) n += l.qty; });
    state.orders.forEach((o) => {
      if (o.state === 'placed') o.lines.forEach((l) => { if (l.sku === sku) n += l.qty; });
    });
    return n;
  }

  /* Units that have actually left the store's shelf: delivered
     orders. The admin stock page subtracts these from onHand, so a
     sale shows up on both sides of the same movement. */
  function deliveredQty(sku) {
    let n = 0;
    state.orders.forEach((o) => {
      if (o.state !== 'delivered') return;
      o.lines.forEach((l) => { if (l.sku === sku) n += l.qty; });
    });
    return n;
  }

  /* ── quotes and job state ────────────────────────────── */

  const STATES = ['NEW', 'REVIEW', 'QUOTED', 'APPROVED', 'PRODUCTION', 'READY', 'CLOSED'];

  function setProjectState(id, next) {
    const p = project(id);
    if (!p || STATES.indexOf(next) === -1) return;
    p.state = next;
    write();
  }

  /* Written by the admin, read by the client. Storing the figures
     rather than recomputing them is deliberate: a sent quote is a
     snapshot and must not move when a price does. */
  function setQuote(id, quote) {
    const p = project(id);
    if (!p) return;
    p.quote = Object.assign({ sentAt: new Date().toISOString().slice(0, 10) }, quote);
    p.state = 'QUOTED';
    write();
  }

  function approveQuote(id) {
    const p = project(id);
    if (!p || !p.quote) return;
    p.quote.approvedAt = new Date().toISOString().slice(0, 10);
    p.state = 'APPROVED';
    write();
  }

  /* ── inventory in ────────────────────────────────────── */

  function addOwnPart(opts) {
    const line = invLine(opts.name);
    if (line && !line.sku) {
      line.qty += opts.qty;
    } else {
      state.inventory.push({
        id: uid('inv'), sku: null, name: opts.name, qty: opts.qty,
        origin: 'own', unitPrice: 0, note: opts.note || ''
      });
    }
    write();
  }

  function receive(opts) {
    const line = opts.sku ? invLine(opts.sku) : invLine(opts.name);
    if (line) {
      line.qty += opts.qty;
    } else {
      state.inventory.push({
        id: uid('inv'), sku: opts.sku || null, name: opts.name, qty: opts.qty,
        origin: 'store', unitPrice: opts.unitPrice || 0
      });
    }
  }

  function removeInventoryLine(id) {
    state.inventory = state.inventory.filter((i) => i.id !== id);
    write();
  }

  /* ── projects ────────────────────────────────────────── */

  function createProject(opts) {
    state.counter += 1;
    const id = 'J-2026-' + String(state.counter).padStart(4, '0');
    state.projects.unshift({
      id: id,
      title: opts.title,
      brief: opts.brief,
      type: opts.type,
      targetDate: opts.targetDate || '',
      state: 'NEW',
      createdAt: new Date().toISOString().slice(0, 10),
      parts: []
    });
    write();
    return id;
  }

  /* Adding a part from his shelf deducts it there and then. If he
     asks for more than he owns the line splits: what he has comes
     off the shelf now, the rest goes to the cart tagged with this
     project. */
  function addPartFromInventory(projectId, key, qty) {
    const p    = project(projectId);
    const line = invLine(key);
    if (!p) return { taken: 0, shortfall: qty };

    const taken = Math.min(qty, line ? line.qty : 0);
    if (taken > 0) {
      line.qty -= taken;
      if (line.qty === 0) state.inventory = state.inventory.filter((i) => i !== line);
      p.parts.push({
        lineId: uid('pt'), sku: line.sku, name: line.name,
        qty: taken, source: 'inventory', unitPrice: line.unitPrice || 0
      });
    }

    const shortfall = qty - taken;
    if (shortfall > 0 && line && line.sku) {
      addPartToCart(projectId, line.sku, line.name, shortfall, line.unitPrice);
    } else {
      write();
    }
    return { taken: taken, shortfall: shortfall };
  }

  function addPartToCart(projectId, sku, name, qty, unitPrice) {
    /* Adding the same item again tops up the line it is already on,
       the way any shopping cart behaves. Lines for different
       projects stay separate — that tag decides where the parts go
       on delivery. */
    const existing = state.cart.find((c) =>
      c.sku && c.sku === sku && (c.projectId || null) === (projectId || null));
    if (existing) {
      updateCartQty(existing.lineId, existing.qty + qty);
      return existing.lineId;
    }

    const lineId = uid('pt');
    state.cart.push({
      lineId: lineId, sku: sku, name: name, qty: qty,
      unitPrice: unitPrice || 0, projectId: projectId || null
    });
    if (projectId) {
      const p = project(projectId);
      if (p) {
        p.parts.push({
          lineId: lineId, sku: sku, name: name, qty: qty,
          source: 'cart', unitPrice: unitPrice || 0
        });
      }
    }
    write();
    return lineId;
  }

  function addClientSuppliedPart(projectId, name, qty) {
    const p = project(projectId);
    if (!p) return;
    p.parts.push({ lineId: uid('pt'), sku: null, name: name, qty: qty, source: 'supplied', unitPrice: 0 });
    write();
  }

  /* Removing a line puts the part back on his shelf — unless it
     never left, which is the case while it is still in the cart. */
  function removePart(projectId, lineId, opts) {
    const silent = opts && opts.silent;
    const p = project(projectId);
    if (!p) return;
    const i = p.parts.findIndex((l) => l.lineId === lineId);
    if (i === -1) return;
    const line = p.parts.splice(i, 1)[0];

    if (line.source === 'cart') {
      state.cart = state.cart.filter((c) => c.lineId !== lineId);
    } else if (line.source !== 'supplied') {
      receive({ sku: line.sku, name: line.name, qty: line.qty, unitPrice: line.unitPrice });
    }
    if (!silent) write();
  }

  function cancelProject(id) {
    const p = project(id);
    if (!p) return;
    p.parts.slice().forEach((l) => removePart(id, l.lineId, { silent: true }));
    p.state = 'CANCELLED';
    write();
  }

  /* ── cart and orders ─────────────────────────────────── */

  function updateCartQty(lineId, qty) {
    const line = state.cart.find((c) => c.lineId === lineId);
    if (!line) return;
    if (qty <= 0) return removeCartLine(lineId);
    line.qty = qty;
    if (line.projectId) {
      const p = project(line.projectId);
      const part = p && p.parts.find((l) => l.lineId === lineId);
      if (part) part.qty = qty;
    }
    write();
  }

  function removeCartLine(lineId) {
    const line = state.cart.find((c) => c.lineId === lineId);
    state.cart = state.cart.filter((c) => c.lineId !== lineId);
    if (line && line.projectId) {
      const p = project(line.projectId);
      if (p) p.parts = p.parts.filter((l) => l.lineId !== lineId);
    }
    write();
  }

  function cartTotal() {
    return state.cart.reduce((n, l) => n + l.qty * (l.unitPrice || 0), 0);
  }

  /* Checkout. Project-tagged lines move to ordered on their
     project; untagged lines are destined for his shelf. */
  function placeOrder() {
    if (!state.cart.length) return null;
    const order = {
      id: 'SO-' + String(state.orders.length + 1).padStart(4, '0'),
      placedAt: new Date().toISOString().slice(0, 10),
      lines: state.cart.map((l) => Object.assign({}, l)),
      total: cartTotal(),
      state: 'placed'
    };
    order.lines.forEach((l) => {
      if (!l.projectId) return;
      const p = project(l.projectId);
      const part = p && p.parts.find((x) => x.lineId === l.lineId);
      if (part) part.source = 'ordered';
    });
    state.orders.unshift(order);
    state.cart = [];
    write();
    return order;
  }

  /* Delivery. Tagged lines land on their project, untagged lines
     land on his shelf. */
  function markDelivered(orderId) {
    const order = state.orders.find((o) => o.id === orderId);
    if (!order || order.state === 'delivered') return;
    order.lines.forEach((l) => {
      if (l.projectId) {
        const p = project(l.projectId);
        const part = p && p.parts.find((x) => x.lineId === l.lineId);
        if (part) part.source = 'delivered';
      } else {
        receive({ sku: l.sku, name: l.name, qty: l.qty, unitPrice: l.unitPrice });
      }
    });
    order.state = 'delivered';
    write();
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
    state = null; loading = null;
  }

  return {
    ready: ready, inventory: inventory, cart: cart, projects: projects,
    orders: orders, project: project, invLine: invLine, invQty: invQty,
    extraCommitted: extraCommitted, deliveredQty: deliveredQty,
    setProjectState: setProjectState, setQuote: setQuote,
    approveQuote: approveQuote, addOwnPart: addOwnPart,
    removeInventoryLine: removeInventoryLine, createProject: createProject,
    cancelProject: cancelProject, addPartFromInventory: addPartFromInventory,
    addPartToCart: addPartToCart, addClientSuppliedPart: addClientSuppliedPart,
    removePart: removePart, updateCartQty: updateCartQty,
    removeCartLine: removeCartLine, cartTotal: cartTotal,
    placeOrder: placeOrder, markDelivered: markDelivered, reset: reset
  };

})();
