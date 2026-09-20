/* ── Data layer ────────────────────────────────────────────
   The ONLY module that touches persisted state. Every function
   here is async and is named for the Supabase RPC that will
   replace it, so migrating the backend means rewriting this one
   file and nothing above it.

     deductInventory   → rpc('deduct_inventory',    {...})
     restoreInventory  → rpc('restore_inventory',   {...})
     addToProject      → rpc('add_to_project',      {...})
     removeFromProject → rpc('remove_from_project', {...})
     addToCart         → rpc('add_to_cart',         {...})

   See supabase/migrations/ for the SQL those RPCs run.

   ── Atomicity ──
   Postgres gets it from a single guarded UPDATE:

     UPDATE inventory SET qty = qty - p_qty
      WHERE sku = p_sku AND tenant_id = auth_tenant() AND qty >= p_qty

   A row that no longer has the stock simply does not match, so two
   concurrent callers cannot both win. localStorage has no such
   primitive, so applyDeduction below is written as one
   read-check-write block with no await inside it: the check and the
   write cannot be interleaved, and it refuses to go below zero the
   same way the RPC does. Callers see identical results either way,
   which is the point — the UI never learns which backend it is on.

   ── Tenancy ──
   Every inventory row, project and project item carries tenant_id.
   Nothing enforces it here; reads are filtered in JS, which is a
   convenience, NOT a security boundary. Real isolation arrives with
   the RLS policies in supabase/migrations/0002_rls.sql. See the
   "Multi-tenancy" section of README.md. */

window.DataStore = (function () {

  const TENANT_KEY     = 'gestaltung.tenant';
  const DEFAULT_TENANT = 'tenant_meridian';

  /* The seam. ClientStore still owns seeding and persistence for the
     pages that have not moved onto this layer yet, so both read one
     state object rather than two that can drift. Both of these go
     away when Supabase lands. */
  const raw    = () => window.ClientStore._state();
  const commit = () => window.ClientStore._write();

  let started = null;

  /* ── tenancy ─────────────────────────────────────────── */

  function tenantId() {
    try { return localStorage.getItem(TENANT_KEY) || DEFAULT_TENANT; }
    catch (e) { return DEFAULT_TENANT; }
  }

  /* Test hook. In production the tenant comes from the JWT, never
     from the client — switching it is exactly the attack the RLS
     policies exist to stop. */
  function setTenantId(id) {
    try { localStorage.setItem(TENANT_KEY, id || DEFAULT_TENANT); } catch (e) { /* private mode */ }
    document.dispatchEvent(new CustomEvent('tenant:change'));
  }

  /* Rows seeded before tenancy existed are adopted by the default
     tenant on first load, so an existing demo browser keeps its data. */
  function backfillTenants() {
    const s = raw();
    let touched = false;
    const stamp = (row) => {
      if (!row.tenant_id) { row.tenant_id = DEFAULT_TENANT; touched = true; }
    };
    s.inventory.forEach(stamp);
    s.projects.forEach((p) => { stamp(p); (p.parts || []).forEach(stamp); });
    (s.cart || []).forEach(stamp);

    /* Added in Stage 1, so a browser seeded before it has no such
       collection. Create it rather than letting every read guard. */
    if (!s.aiClassifications) { s.aiClassifications = []; touched = true; }
    s.aiClassifications.forEach(stamp);

    /* Stage 3: one row per provider call, and the consent record. */
    if (!s.aiUsage)    { s.aiUsage = [];    touched = true; }
    if (!s.aiSettings) { s.aiSettings = {}; touched = true; }
    s.aiUsage.forEach(stamp);

    if (touched) commit();
  }

  async function ready() {
    if (started) return started;
    started = (async () => {
      await window.ClientStore.ready();
      backfillTenants();
      return true;
    })();
    return started;
  }

  /* ── reads (tenant-scoped) ───────────────────────────── */

  const mine = (row) => row.tenant_id === tenantId();

  async function listInventory() {
    return raw().inventory.filter(mine).map((r) => Object.assign({}, r));
  }

  async function listProjects() {
    return raw().projects.filter(mine).map((r) => Object.assign({}, r));
  }

  async function getProject(projectId) {
    const p = raw().projects.find((x) => x.id === projectId && mine(x));
    return p ? Object.assign({}, p, { parts: (p.parts || []).slice() }) : null;
  }

  async function listProjectItems(projectId) {
    const p = raw().projects.find((x) => x.id === projectId && mine(x));
    return p ? (p.parts || []).filter(mine).map((r) => Object.assign({}, r)) : [];
  }

  async function listCart() {
    return (raw().cart || []).filter(mine).map((r) => Object.assign({}, r));
  }

  function findLine(key) {
    return raw().inventory.find((i) => mine(i) && (i.sku ? i.sku === key : i.name === key)) || null;
  }

  /* Live stock for one key, which is what the workspace redraws
     after every add. Catalogue items match on SKU, hand-added parts
     on name — the same rule the rest of the app uses. */
  async function getStock(key) {
    const line = findLine(key);
    return line ? line.qty : 0;
  }

  /* ── the atomic primitives ───────────────────────────── */

  /* One read-check-write block. No await inside: nothing can run
     between the check and the write. Mirrors the guarded UPDATE. */
  function applyDeduction(key, qty) {
    const line = findLine(key);
    if (!line)          return { ok: false, error: 'not_found',          remaining: 0 };
    if (qty <= 0)       return { ok: false, error: 'invalid_quantity',   remaining: line.qty };
    if (line.qty < qty) return { ok: false, error: 'insufficient_stock', remaining: line.qty };

    line.qty -= qty;
    const snapshot = {
      sku: line.sku, name: line.name,
      unitPrice: line.unitPrice || 0, origin: line.origin || 'store'
    };
    if (line.qty === 0) {
      const s = raw();
      s.inventory = s.inventory.filter((i) => i !== line);
    }
    return { ok: true, remaining: line.qty, line: snapshot };
  }

  function applyRestore(item, qty) {
    const line = findLine(item.sku || item.name);
    if (line) {
      line.qty += qty;
      return { ok: true, remaining: line.qty };
    }
    raw().inventory.push({
      id: uid('inv'), tenant_id: tenantId(),
      sku: item.sku || null, name: item.name, qty: qty,
      origin: item.origin || 'store', unitPrice: item.unitPrice || 0
    });
    return { ok: true, remaining: qty };
  }

  /* ── public writes ───────────────────────────────────── */

  async function deductInventory(key, qty) {
    const r = applyDeduction(key, qty);
    if (r.ok) commit();
    return r;
  }

  async function restoreInventory(item, qty) {
    const r = applyRestore(item, qty);
    if (r.ok) commit();
    return r;
  }

  /* Put an item on a project.

     In stock     → deducted now, lands as source 'inventory'.
     Not in stock → a cart line tagged with this project, source
     'cart'. It shows on the project immediately so the user can see
     what the build needs, flagged unpaid until checkout ships it.
     Asking for more than is on the shelf does both: what is there
     comes off now, the remainder goes to the cart. */
  async function addToProject(projectId, item, qty) {
    const s = raw();
    const p = s.projects.find((x) => x.id === projectId && mine(x));
    if (!p)       return { ok: false, error: 'project_not_found' };
    if (qty <= 0) return { ok: false, error: 'invalid_quantity' };

    const key   = item.sku || item.name;
    const have  = (findLine(key) || {}).qty || 0;
    const taken = Math.min(qty, have);
    const short = qty - taken;
    const added = [];

    if (taken > 0) {
      const d = applyDeduction(key, taken);
      if (!d.ok) return { ok: false, error: d.error, remaining: d.remaining };
      const part = {
        lineId: uid('pt'), tenant_id: tenantId(),
        sku: d.line.sku, name: d.line.name, qty: taken,
        source: 'inventory', unitPrice: d.line.unitPrice, paid: true
      };
      p.parts.push(part);
      added.push(part);
    }

    if (short > 0) {
      const lineId = uid('pt');
      const part = {
        lineId: lineId, tenant_id: tenantId(),
        sku: item.sku || null, name: item.name, qty: short,
        source: 'cart', unitPrice: item.unitPrice || 0, paid: false
      };
      p.parts.push(part);
      s.cart.push({
        lineId: lineId, tenant_id: tenantId(),
        sku: item.sku || null, name: item.name, qty: short,
        unitPrice: item.unitPrice || 0, projectId: projectId
      });
      added.push(part);
    }

    commit();
    return {
      ok: true, taken: taken, shortfall: short,
      remaining: await getStock(key), lines: added
    };
  }

  /* A part the client sources himself. Never touches stock. */
  async function addSuppliedToProject(projectId, name, qty) {
    const p = raw().projects.find((x) => x.id === projectId && mine(x));
    if (!p) return { ok: false, error: 'project_not_found' };
    p.parts.push({
      lineId: uid('pt'), tenant_id: tenantId(),
      sku: null, name: name, qty: qty,
      source: 'supplied', unitPrice: 0, paid: true
    });
    commit();
    return { ok: true };
  }

  /* Removing returns the quantity to the shelf — unless it never
     left it, which is the case while the line is still in the cart
     or is something the client supplies himself. */
  async function removeFromProject(projectId, lineId) {
    const s = raw();
    const p = s.projects.find((x) => x.id === projectId && mine(x));
    if (!p) return { ok: false, error: 'project_not_found' };

    const i = p.parts.findIndex((l) => l.lineId === lineId);
    if (i === -1) return { ok: false, error: 'line_not_found' };
    const line = p.parts.splice(i, 1)[0];

    let restored = 0;
    if (line.source === 'cart') {
      s.cart = s.cart.filter((c) => c.lineId !== lineId);
    } else if (line.source !== 'supplied') {
      applyRestore(line, line.qty);
      restored = line.qty;
    }

    commit();
    return {
      ok: true, restored: restored, line: line,
      remaining: await getStock(line.sku || line.name)
    };
  }

  /* ── AI classification log ───────────────────────────────
     Mirrors supabase/migrations/0004_ai.sql, field for field, so the
     move to Postgres is a change of storage and not of shape.

     Two rows are never written for one decision: logClassification
     records the suggestion, logCorrection closes the same row with
     what the human actually chose. `corrected` is derived rather
     than passed, because whether the user overrode the machine is a
     fact about the two values, not an opinion of the caller — and
     Stage 4's accuracy figures are only as honest as that flag. */

  async function logClassification(entry) {
    const s = raw();
    const row = {
      id:         uid('cls'),
      tenant_id:  tenantId(),
      file_hash:  entry.fileHash || null,
      file_ext:   entry.fileExt || '',
      file_size:  entry.fileSize || 0,
      question_hash: entry.questionHash || '',
      description: entry.description || '',
      features:   entry.features || {},
      warnings:   entry.warnings || [],
      /* True when the answer was cut short by something temporary —
         no consent, a daily cap, every provider down. Such a row is
         logged (it is still a decision the user was shown) but must
         never be served from cache, or lifting the block would
         change nothing. */
      escalation_blocked: !!entry.escalationBlocked,
      suggested_process: entry.suggested || null,
      alternatives: entry.alternatives || [],
      confidence: entry.confidence || 0,
      reasons:    entry.reasons || [],
      source:     entry.source || 'rules',
      final_process: null,
      corrected:  null,
      created_at: new Date().toISOString(),
      decided_at: null
    };
    s.aiClassifications.unshift(row);
    commit();
    return { ok: true, id: row.id };
  }

  async function logCorrection(id, finalProcess) {
    const row = raw().aiClassifications.find((r) => r.id === id && mine(r));
    if (!row) return { ok: false, error: 'not_found' };
    row.final_process = finalProcess || null;
    row.corrected     = (finalProcess || null) !== (row.suggested_process || null);
    row.decided_at    = new Date().toISOString();
    commit();
    return { ok: true, corrected: row.corrected, id: row.id };
  }

  /* The cache lookup ai.js makes before any analysis. Matched on the
     file hash AND the question hash — the same file asked about with
     a different brief, material or tolerance is a different question
     and deserves a fresh answer. */
  async function findClassification(fileHash, questionHash) {
    if (!fileHash) return null;
    const row = raw().aiClassifications.find((r) =>
      mine(r)
      && r.file_hash === fileHash
      && (r.question_hash || '') === (questionHash || '')
      && !r.escalation_blocked
      && r.suggested_process !== undefined);
    return row ? Object.assign({}, row) : null;
  }

  async function listClassifications() {
    return raw().aiClassifications.filter(mine).map((r) => Object.assign({}, r));
  }

  /* ── AI usage and consent (Stage 3) ──────────────────────
     Mirrors ai_usage in supabase/migrations/0004_ai.sql and the
     consent table in 0005. One row per provider CALL, not per
     classification: a request that fell through three providers is
     three rows, because that is what the free tier was actually
     charged for and what Stage 4 needs to see. */

  async function logAiUsage(entry) {
    const s = raw();
    const row = {
      id:         uid('use'),
      tenant_id:  tenantId(),
      provider:   entry.provider || 'unknown',
      feature:    entry.feature || 'classifyProject',
      model:      entry.model || null,
      ok:         !!entry.ok,
      http_status: typeof entry.status === 'number' ? entry.status : null,
      error:      entry.error || null,
      latency_ms: typeof entry.latencyMs === 'number' ? Math.round(entry.latencyMs) : null,
      tokens_in:  entry.tokensIn || 0,
      tokens_out: entry.tokensOut || 0,
      classification_id: entry.classificationId || null,
      created_at: new Date().toISOString()
    };
    s.aiUsage.unshift(row);
    commit();
    return { ok: true, id: row.id };
  }

  /* Counted before a request is made, so a cap stops us asking rather
     than recording that we asked too much. `scope: 'global'` ignores
     the tenant — it is the ceiling on the whole free tier, and one
     busy tenant must not be able to exhaust it for everyone.

     Only rows that reached a provider count. A refusal for consent or
     for the cap itself is not usage, and counting it would make the
     cap ratchet itself shut. */
  async function countAiUsage(opts) {
    const o     = opts || {};
    const since = o.since || new Date().toISOString().slice(0, 10);
    const rows  = raw().aiUsage.filter((r) =>
      (r.created_at || '') >= since
      && r.error !== 'consent_missing'
      && r.error !== 'cap_reached');
    return (o.scope === 'global' ? rows : rows.filter(mine)).length;
  }

  async function listAiUsage() {
    return raw().aiUsage.filter(mine).map((r) => Object.assign({}, r));
  }

  /* Consent is per tenant and defaults to withheld. It is stored, not
     inferred from a checkbox still being on screen, because "did this
     client agree to their brief leaving our servers" is a question we
     may have to answer later. */
  async function getAiConsent() {
    const rec = (raw().aiSettings || {})[tenantId()];
    return rec ? { granted: !!rec.granted, at: rec.at || null } : { granted: false, at: null };
  }

  async function setAiConsent(granted) {
    const s = raw();
    if (!s.aiSettings) s.aiSettings = {};
    s.aiSettings[tenantId()] = {
      tenant_id: tenantId(),
      granted: !!granted,
      at: new Date().toISOString()
    };
    commit();
    return { ok: true, granted: !!granted };
  }

  /* A standalone purchase: untagged, so it lands on the client's own
     shelf on delivery rather than on a project. */
  async function addToCart(item, qty) {
    const s = raw();
    const existing = s.cart.find((c) =>
      mine(c) && c.sku && c.sku === item.sku && !c.projectId);
    if (existing) {
      existing.qty += qty;
      commit();
      return { ok: true, lineId: existing.lineId, qty: existing.qty };
    }
    const lineId = uid('pt');
    s.cart.push({
      lineId: lineId, tenant_id: tenantId(),
      sku: item.sku || null, name: item.name, qty: qty,
      unitPrice: item.unitPrice || 0, projectId: null
    });
    commit();
    return { ok: true, lineId: lineId, qty: qty };
  }

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 9);
  }

  return {
    ready: ready,
    tenantId: tenantId, setTenantId: setTenantId,
    listInventory: listInventory, listProjects: listProjects,
    getProject: getProject, listProjectItems: listProjectItems,
    listCart: listCart, getStock: getStock,
    deductInventory: deductInventory, restoreInventory: restoreInventory,
    addToProject: addToProject, addSuppliedToProject: addSuppliedToProject,
    removeFromProject: removeFromProject, addToCart: addToCart,

    /* AI classification log — see supabase/migrations/0004_ai.sql */
    logClassification: logClassification, logCorrection: logCorrection,
    findClassification: findClassification, listClassifications: listClassifications,

    /* AI usage, caps and consent — 0004_ai.sql and 0005_ai_consent.sql */
    logAiUsage: logAiUsage, countAiUsage: countAiUsage, listAiUsage: listAiUsage,
    getAiConsent: getAiConsent, setAiConsent: setAiConsent
  };

})();
