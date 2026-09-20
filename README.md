# GESTALTUNG

The website for **GESTALTUNG** — an engineering studio, manufacturing platform, and product-commerce system based in Doha, Qatar.

Live at **https://mworkqu.github.io**.

## Stack

Static HTML + CSS + vanilla JS. No build step, no framework. Hosted on GitHub Pages.
Bilingual (English + Arabic, RTL). Supabase is the planned backend — the SQL is
written in `supabase/migrations/` but nothing runs it yet; see **Multi-tenancy**.

- **HTML** — one `index.html` per route folder
- **CSS** — single file at `assets/css/styles.css` (machine design system)
- **JS** — small modules in `assets/js/`, loaded as plain scripts
- **Data** — JSON in `data/`, fetched at runtime

## Structure

```
/                         homepage — hero, capability matrix, design space, stats, projects, CTA
/studio/                  design & engineering services + project request form
/manufacturing/           production capabilities + quote form
/shop/                    product catalogue (rendered from data/products.json)
/projects/                selected work (filterable)
/about/                   philosophy & principles
/contact/                 contact details + general enquiry form
/login/                   role selector (client / admin / vendor)
/login/{role}/            per-role sign-in
/dashboard/               role picker
/dashboard/client/                   overview — live counts and project list
/dashboard/client/projects/          project list + new-project form
/dashboard/client/projects/detail/   one project: parts list and quote  ?id=J-2026-0041
/dashboard/client/inventory/         parts the client owns
/dashboard/client/cart/              cart and orders
/dashboard/admin/                    overview + reorder alerts
/dashboard/admin/inventory/          store stock, receive, make a batch, ledger
/dashboard/admin/jobs/               every job, assign a workshop, release
/dashboard/admin/quotes/             client projects to price
/dashboard/admin/quotes/detail/      build and send a quote  ?id=J-2026-0041
/dashboard/admin/users/              user management
/dashboard/vendor/                   assigned jobs — no prices, no client names
/404.html                 custom not-found page
/favicon.svg              site favicon
/robots.txt /sitemap.xml  SEO
```

## Data

Nothing about a product is written in markup. To change a price, a stock
figure or the whole catalogue, edit one file:

| File | Holds |
|---|---|
| `data/products.json` | the shop catalogue — sku, price, `onHand`, `committed`, `reorderPoint` |
| `data/client-inventory.json` | seed data for the demo client's shelf and projects |
| `data/processes.json` | manufacturing processes and the materials each accepts, EN + AR |
| `data/classification-rules.json` | the classifier's thresholds and decision rules — tune without code |
| `data/i18n/en.json` `ar.json` | every translated string, same key set in both |
| `assets/js/product-art.js` | the line drawing for each product, keyed by its `art` field |

Adding a category to `products.json` adds its filter button; adding a product
adds its card. Adding a process or material to `processes.json` adds it to the
quote form and the workspace filter. No HTML to touch.

### Scripts

| File | Does |
|---|---|
| `assets/js/store.js` | loads the catalogue, computes availability, formats money |
| `assets/js/shop.js` | renders the shop grid and the add-to-cart button |
| `assets/js/client-store.js` and `admin-store.js` | the two state layers and the movement rules |
| `assets/js/dash-shell.js` | the sidebar for all three roles, written once |
| `assets/js/client-pages.js` | one section per client dashboard page |
| `assets/js/admin-pages.js` | one section per admin and vendor page |
| `assets/js/main.js` | nav, scroll reveal, form interception, tag filters, stat counters |
| `assets/js/data/store.js` | **the data layer** — the only module that touches persisted state |
| `assets/js/i18n.js` | the EN/AR dictionary, `dir` switching, the language toggle |
| `assets/js/components/cascade.js` | the shared Process → Material control |
| `assets/js/workspace.js` | the panel registry and slot layout |
| `assets/js/workspace-project.js` | the four panels of the project workspace |
| `assets/js/services/ai.js` | **the AI service** — the only door to any classifier or model |
| `assets/js/services/rules-provider.js` | the rule engine, driven by `data/classification-rules.json` |
| `assets/js/services/geometry.js` | measures a CAD file in the browser — nothing is uploaded |
| `assets/js/services/llm-provider.js` | the Gemini / Groq / OpenRouter adapters, via the proxy |
| `proxy/worker.js` | the Cloudflare Worker that holds the API keys |
| `assets/js/services/ai-config.js` | which provider answers, in what order, and what is on |
| `assets/js/components/classification-confirm.js` | shows a suggestion as a question, never as a fact |
| `assets/js/workspace-ai-panel.js` | the "Identify the process" workspace panel |
| `tools/serve.py` | the dev server: `http.server` + `Cache-Control: no-store` |

## Inventory model

There are two separate inventories — the store's and each client's — and a
part is always either on a client's shelf or on one of his projects, never
both. The full rules, including what happens on order, delivery and
cancellation, are in **[docs/inventory-model.md](docs/inventory-model.md)**.

## Design system

"Machine" minimalism: 1px rule lines, warm stone background (`#ECEAE3`) with lighter card surfaces, JetBrains Mono for technical metadata, Inter for body and headlines. Design tokens live in `:root` (`--bg`, `--surface`, `--ink` and its opacity scale, `--rule`, `--px`, `--max`).

## Develop locally

```bash
python -m http.server 4173
```

Then visit http://localhost:4173. A server is required — the pages `fetch()`
their data, which the browser blocks on `file://`.

No build, no install, no dependencies.

## Demo mode

This site is a static prototype.

- Public forms (Studio brief, Manufacturing quote, Contact) intercept submit and show a success panel — no backend.
- Login forms navigate straight to the matching dashboard.
- **Client dashboard state is real but local.** Inventory, cart, projects and orders persist in `localStorage` under `gestaltung.client.v1`, seeded once from `data/client-inventory.json`. Clear that key to start over. Nothing leaves the browser.
- **Store stock is live too.** `data/products.json` is read-only; every change on top of it is a line in a stock ledger kept in `localStorage` under `gestaltung.admin.v1`. A demo purchase reserves stock, a delivery moves it, and a finished batch puts it back.
- Clear both `gestaltung.*` keys to reset everything to the seed.

To wire this to a real backend, replace the `fetch` in `store.js` and the
`localStorage` read/write pairs in `client-store.js` and `admin-store.js`;
everything above them is unchanged.

## The project workspace

`/dashboard/client/projects/detail/?id=J-2026-0041` is a three-panel
workspace rather than a single column: filters and search on one side, results
in the middle, the project and its quote on the other. Every panel collapses,
and a side column that has nothing expanded left in it hands its width back to
the middle. Below 860px it is one column.

The page owns no panel markup. Panels register themselves into a slot:

```js
WorkspacePanels.register({
  id: 'model', slot: 'center', order: 20,
  titleKey: 'workspace.panels.model',
  mount: (body, ctx) => { /* … */ }
});
```

Panels never call each other; they share `ctx`, which carries the project id
and an event bus. Adding a tool later — part modelling, image generation,
schematic capture — is a new file plus one `<script>` tag, with no edit to the
page or to any existing panel. `assets/js/services/ai.js` is the matching
service-side hook, and today it only maps a file extension to a likely
process. **No AI is called anywhere in this repository.**

### Adding a part

- **In your inventory** → one action, *Add to Project*. The quantity comes off
  the shelf immediately and the count updates on screen without a reload.
- **Not in your inventory** → two actions. *Add to Cart* buys it onto your own
  shelf. *Add to Project* puts it on the project straight away and tags the
  cart line with that project, so the project panel can show it as still
  needing payment.
- Asking for more than you own does both: what is there comes off now, the
  remainder goes to the cart.
- **Removing a line returns the quantity to your inventory** — unless it never
  left it, which is the case while it is still in the cart.

## Multi-tenancy

Every inventory row, project, project item and cart line carries a
`tenant_id`. `DataStore` filters every read by it and refuses to deduct from a
row belonging to another tenant.

> **This is not a security boundary.** In a static site with no server,
> tenant filtering in JavaScript is a rendering convenience — anyone with a
> console can set `localStorage['gestaltung.tenant']` to another value.
> It exists so the data shape and the UI are already correct when the real
> boundary arrives.

The real boundary is row level security, written and committed but not yet
running:

| File | Enforces |
|---|---|
| `supabase/migrations/0001_schema.sql` | tables, `auth_tenant()`, a `qty >= 0` check constraint |
| `supabase/migrations/0002_rls.sql` | `tenant_id = auth_tenant()` on select, insert, update and delete for every tenant-owned table |
| `supabase/migrations/0003_rpc.sql` | the atomic operations, all `SECURITY INVOKER` so the policies still apply inside them |

What the policies will enforce once Supabase is connected:

- A row is readable only when its `tenant_id` matches the caller's, taken from
  their profile row and therefore from their JWT — never from anything the
  client sends.
- Every write policy has a `with check` as well as a `using`, so a caller
  cannot take a row they legitimately see and reassign it to another tenant.
- `project_items` and `cart_lines` additionally require their parent project to
  belong to the caller's tenant, so a line cannot be hung off someone else's
  project.
- `profiles` has no insert or update policy at all: tenant assignment is a
  service-role operation, because a user who can edit their own `tenant_id` can
  read every other tenant's stock.
- The RPCs are `SECURITY INVOKER`. `SECURITY DEFINER` would run them as the
  owner and silently bypass RLS.

### Atomic stock deduction

Concurrency is handled by one guarded `UPDATE`:

```sql
UPDATE inventory SET qty = qty - p_qty
 WHERE sku = p_sku AND tenant_id = auth_tenant() AND qty >= p_qty
```

Two callers racing for the last unit both run it; Postgres serialises them on
the row lock, the second re-evaluates `qty >= p_qty` against the
already-decremented value, matches no row, and is told there is no stock.
Neither over-draws, with no retry loop.

`localStorage` has no equivalent primitive, so `DataStore.applyDeduction` is
written as a single read-check-write block with no `await` inside it and the
same refusal to go below zero. Callers get the same results and the same error
codes either way — the UI never learns which backend it is on.

Writes are optimistic: the count and the project list repaint before the call
resolves and roll back if it fails. Against `localStorage` that frame is
invisible; against Supabase it is what stops the number lagging the click.

## Bilingual (English / Arabic)

Every string goes through `data/i18n/en.json` and `data/i18n/ar.json`, which
carry identical key sets. `assets/js/i18n.js` loads in `<head>` and sets `lang`
and `dir` at parse time, so the RTL layout is correct on the first frame rather
than snapping after load.

Keys are dotted and namespaced (`workspace.panels.filters`) because that is
what `next-intl` expects — a later migration needs no renaming.

Markup opts in per element:

```html
<a href="/shop/" data-i18n="nav.shop">Shop</a>
<input data-i18n-placeholder="workspace.search.placeholder" placeholder="Search…">
```

Also available: `data-i18n-html`, `-aria-label`, `-title`, `-content`, `-alt`.
JS-rendered strings use `I18n.t('key', { vars })` and always pass an English
literal as the fallback, so a missing key degrades to English rather than to a
raw key name. `{ en, ar }` label pairs — as in `processes.json` — go through
`I18n.pick()`.

RTL is largely free: grid and flex follow `direction`, so the workspace columns
mirror with no extra rule. The handful of places the original stylesheet used a
physical edge are collected under "RTL corrections".

SKUs, prices and tolerances stay in Latin digits and are isolated LTR inside
Arabic text, which is how they are written in Qatari technical documents.

## Testing locally

```bash
npm run serve
```

Then `http://localhost:4173`. A server is required — the pages `fetch()` their
data, which the browser blocks on `file://`.

That script is `tools/serve.py`, which is `http.server` plus
`Cache-Control: no-store`. Plain `python -m http.server` sends no cache
headers at all, so browsers fall back to heuristic freshness and will happily
run a `.js` or `.json` you already edited — on a site with no build step and
no fingerprinted filenames that is the most confusing failure there is. If you
do serve it some other way and a change refuses to appear, that is why.

**Reset to seed at any time**, from the browser console:

```js
localStorage.clear(); location.reload();
```

### 1 — Process → Material cascade

**Quote form.** Open `/manufacturing/` and scroll to the quote form.

- Material is **disabled** and reads "Choose a process first".
- Pick **Laser Cutting**; Material enables and offers Acrylic, MDF, Plywood,
  Mild Steel sheet, Stainless sheet — and nothing from another process.
- Pick **Other (specify)**; a free-text field appears.
- Change Process to **PCB Manufacturing**; Material **resets** and now offers
  FR-4, Aluminium core, Flex, Rogers. The free-text field disappears. This is
  what stops "Laser Cutting + Aluminium 7075" being submitted.

**Workspace.** Open `/dashboard/client/projects/detail/?id=J-2026-0041`.

- The same control is in the left panel, in filter mode ("All processes").
- Pick **CNC Machining** → results narrow to CNC items only.
- Add Material **Aluminium 6061** → only the Datum Frame and the Machined Pen.
- **Clear filters** restores everything.

**Config is data.** Add a process to `data/processes.json`:

```json
{ "key": "waterjet",
  "label": { "en": "Waterjet", "ar": "القطع بالماء" },
  "materials": [ { "key": "granite", "label": { "en": "Granite", "ar": "جرانيت" } } ] }
```

Reload. It appears in **both** the quote form and the workspace filter. No code
was changed.

### 2 — Cart / project / inventory

All on `/dashboard/client/projects/detail/?id=J-2026-0041`.

**An item you own — deduction, and the count moving without a reload.**

1. The V-Block Clamping Set shows **"6 in your inventory"** and exactly **one**
   button, *Add to Project*.
2. Click it. Without any reload:
   - the line now reads **"5 in your inventory"**,
   - the project panel gains `1× V-Block Clamping Set` badged **From
     inventory**,
   - the notice reads "1 taken from your inventory."
3. Open `/dashboard/client/inventory/` in a second tab — it also shows 5. The
   deduction is in the store, not just on screen.
4. Back on the workspace, click **Remove**. The count returns to **6** and the
   notice reads "1 returned to your inventory." Removing gives stock back.

**An item you do not own — two actions.**

1. Search `Sine`. The Sine Bar shows **"Shop · QAR 890"** and **two** buttons.
2. *Add to Project* puts it on the project badged **To purchase**, with a
   marker down its edge and a highlighted panel: *"1 still to pay for … Pay QAR
   890"*. It is visible on the project immediately but not yet bought.
3. `/dashboard/client/cart/` shows that line tagged with `J-2026-0041`, so it
   ships to the project rather than to your shelf.
4. *Add to Cart* instead adds an **untagged** line, destined for your own
   shelf.

**The split.** Set Quantity to `5` and add the Machined Pen (you own 1): 1 comes
off the shelf, 4 go to the cart for the project, and the notice says so.

**The guard refuses rather than going negative** — in the console:

```js
await DataStore.getStock('SKU-0301');            // 1
await DataStore.deductInventory('SKU-0301', 99); // insufficient_stock, ok:false
await DataStore.deductInventory('SKU-0301', -3); // invalid_quantity
await DataStore.deductInventory('SKU-NOPE', 1);  // not_found
await DataStore.getStock('SKU-0301');            // still 1 — nothing moved
```

Each is one read-check-write with no `await` between the check and the write,
which is the `localStorage` stand-in for the guarded `UPDATE`.

**Rollback.** Make the write fail and confirm the UI un-paints:

```js
const real = DataStore.addToProject;
DataStore.addToProject = async () => ({ ok: false, error: 'insufficient_stock', remaining: 6 });
// Click Add to Project: the count flickers down and returns, the notice turns
// red, and the project panel does not gain a row.
DataStore.addToProject = real;
```

### 3 — Wide / landscape layout

- At **1400px+**: three columns — filters, results, project. Confirm with
  `[...document.querySelectorAll('.ws-slot')].map(s => s.getBoundingClientRect().width)`
  → roughly `[290, …, 360]`.
- **Collapse** the Find Parts panel with the chevron. It narrows to a 46px rail
  with a vertical title, and the results column **grows** to take the space.
  Expand to restore.
- Collapse state **survives a reload**
  (`localStorage['gestaltung.workspace.collapsed']`).
- At **≤1180px** the project panel drops under the results.
- At **≤860px** everything is one column with no horizontal scroll.

### 4 — RTL and the panel registry

- Click **العربية** in the nav. `<html>` becomes `lang="ar" dir="rtl"`, every
  label translates, and the whole workspace **mirrors**: the filter column
  moves to the right, the project panel to the left, the sidebar to the right.
  Confirm the mirroring is real, not just text alignment:

  ```js
  [...document.querySelectorAll('.ws-slot')].map(s => [s.dataset.slot, s.getBoundingClientRect().x | 0])
  // ltr → left ≈ 210,  right ≈ 1090
  // rtl → left ≈ 984,  right ≈ 34
  ```

- The choice persists across pages and reloads. **EN** switches back.
- Panels are registered, not hardcoded:

  ```js
  WorkspacePanels.registered();  // ['filters','results','project','quote']
  ```

- The AI service is reachable and its unbuilt features say so:

  ```js
  AIService.providerChain();        // ['rules']
  await AIService.generateModel();  // { ok:false, available:false, … }
  ```

  See **The AI service** below for classification.

### 5 — Tenant scoping

With the caveat above — this demonstrates the **data shape**, not enforcement.

```js
(await DataStore.listInventory()).map(i => i.name);  // the five seeded parts

DataStore.setTenantId('tenant_other');
await DataStore.listInventory();                     // []  — sees nothing
await DataStore.listProjects();                      // []
await DataStore.deductInventory('SKU-0201', 1);      // { ok:false, error:'not_found' }

DataStore.setTenantId('tenant_meridian');
await DataStore.getStock('SKU-0201');                // unchanged
```

Another tenant cannot see or deduct Meridian's stock through the data layer.

**That check passing locally does not mean tenants are isolated.** The second
tenant is imaginary and the boundary is a JavaScript filter. Real isolation is
only testable against Supabase with two signed-in accounts, once
`supabase/migrations/` has been applied:

```bash
supabase db push
```

Then sign in as a user in each tenant and repeat the reads. The `not_found`
comes from the RLS policy rather than from a filter, and no client-side change
can defeat it.

## The AI service

Every classification — and later every generation — goes through
`assets/js/services/ai.js`. **No page, panel or component may call a provider
directly.** That single rule is what makes swapping the rule-based classifier
for a hosted model a config edit rather than a rewrite.

```js
const r = await AIService.classifyProject({ file, features, description });
// → { process, alternatives[], confidence, reasons[], source, band, logId }
```

`generateModel()`, `generateImage()` and `generateSchematic()` are declared and
return a clean `{ ok:false, available:false }`. They never throw, so a panel
can render them today and gain behaviour later without changing.

### Which provider answers

`assets/js/services/ai-config.js` holds `activeProvider`, a `fallbackOrder`
tried until one responds, and a per-provider `enabled` / `implemented` flag. A
provider that is unimplemented or unregistered is skipped rather than throwing,
and `rules` sits last in the chain on purpose: it is local, free and always
available, so the chain can never fall through to nothing. A provider being
down must never break the page.

`rules` measures the file in the browser and decides from
`data/classification-rules.json` — see **The rule-based classifier** below. It
is not one of the chain: it always runs first, and the chain escalates to a
model only when it is unsure. See **Escalating to an AI service**.

### The machine never decides silently

A suggestion is always shown with its confidence, its reasons and its
alternatives, and the user confirms or corrects it. Below the `medium`
threshold the UI leads with *"Which is it?"* instead of presenting a guess to
be argued with — a confident wrong answer costs more than an honest question.

Reasons travel as `{ key, vars }` rather than as finished sentences, so a
stored result re-reads correctly in Arabic and can be redrawn on a language
switch without reclassifying.

### What a provider is allowed to see

**Never the file.** `buildPayload()` in `ai.js` constructs exactly what a
provider receives: the extension, the byte length, extracted features, and —
from Stage 3, behind a consent toggle — the description. The bytes are read in
the browser to compute a SHA-256 and, later, to measure geometry; they go no
further. Not the filename either, since a filename routinely carries a client
or project name.

That check lives in `ai.js` rather than in each adapter, because a privacy rule
enforced in one place is a rule, and enforced in five places is a hope.

There are **no API keys in any browser file, and there cannot be** —
everything under `assets/` is served as plain text. From Stage 3 the keys live
in a serverless proxy, and the only thing `ai-config.js` holds is that proxy's
public URL.

### Caching and the log

Before any analysis, `classifyProject()` hashes the file and asks the data
layer whether this exact file with this exact description has been answered
before. A cache hit skips the analysis but is **still logged** — a decision is
an event even when the answer was free, and otherwise the accuracy figures
would quietly exclude every repeat.

`DataStore.logClassification()` is called inside `ai.js`, not by the caller, so
no future panel can forget it. The caller reports the human's decision with
`DataStore.logCorrection(logId, finalProcess)`, and `corrected` is derived by
comparing the two rather than trusted from the caller.

Rows match `supabase/migrations/0004_ai.sql` field for field. That table has no
delete policy: the log is both the training data and a record of what the
machine told a client, and a tenant erasing a suggestion they disagreed with is
exactly what must not be possible.

### The rule-based classifier

`rules` is the only implemented provider, it runs entirely in the browser, and
it is free forever. It answers in two layers.

**File type.** Gerber, KiCad and drill files only exist for one process, so the
extension is not a guess there. A `.dxf` is a 2D profile. A `.stl` is a hint
about the exporter, not about the part. A `.step` deliberately yields *no*
process — a solid model says nothing about which machine should make it.

**Geometry**, measured locally by `assets/js/services/geometry.js`: bounding
box, volume, surface area, smallest dimension, flatness, whether the section is
constant, triangle count and how many separate bodies there are. Loaders come
from a CDN on first use and only for the format actually picked, so a client
who only uploads STLs never downloads the STEP kernel. STL and OBJ are parsed
here directly; 3MF uses the three.js loader, STEP and IGES use OpenCascade
compiled to WebAssembly, DXF uses dxf-parser.

Every one of those loaders can fail — blocked CDN, offline client, corrupt
file — and every failure is soft. The classifier drops back to the file-type
layer and says so in its reasons. **Geometry makes the answer better; its
absence must never make the page worse.**

### The extension is a prior, not a peer

A flat 3 mm plate exported as STL is a laser job, even though it is an STL.
Weighing "the extension says printing" equally against "the measured section is
a constant 3 mm" would return *"the rules disagree, you decide"* for every
plate anyone ever exported — the classifier refusing the one job it exists for.

So when any rule from the data file decides, those rules resolve it alone and
the extension's opinion demotes to an alternative, with a reason saying it was
overruled. Only when no rule fires does the extension answer. Conflict then
means genuine disagreement between *measurements*, which is worth asking about.

A flat **metal** plate is exactly that case: geometry says laser, the material
you stated says CNC. It comes back as "not sure" with both offered, and that is
correct — nothing in the file can settle it.

### Tuning it without touching code

`data/classification-rules.json` holds every threshold, condition and reason
key. Conditions are declarative — a feature name, an operator (`eq` `ne` `lt`
`lte` `gt` `gte` `in` `exists`) and a value — never expressions. There is no
`eval` anywhere: a data file cannot become an execution path, a malformed rule
is skipped, and a malformed file leaves the file-type layer still answering.
The worst a bad edit can do is make the classifier less certain.

Warnings are separate from decisions, because a warning never changed the
answer and Stage 4 counts the two differently.

Two honest limits, both recorded in the file itself:

- **Constant thickness is an approximation.** Volume ÷ footprint should come
  back to the smallest dimension; when it does not, the section varies. It is a
  good plate detector, not a feature recogniser.
- **The thin-wall check catches a globally thin part, not a thin rib inside a
  thick one.** Real minimum-wall analysis is a different and much heavier job.

STL and OBJ carry no units. Everything is read as millimetres and the part is
flagged as such, because being silently wrong by a factor of 25.4 is the worst
outcome available.

### After you confirm

Confirming pre-selects that process in the Process → Material filter. It
listens for the **decision**, not the suggestion — acting on the suggestion
would be the classifier quietly steering the page, which is the behaviour the
confirmation step exists to prevent. The select stays editable afterwards.

### Escalating to an AI service

The rules **always** run, and run first. They are local, free and instant, so
there is never a reason to spend a request before hearing the free answer. An
AI service is an *escalation*, not an alternative, and it is asked only when:

- the rules came back below `escalate.belowConfidence` (0.5), or
- the rules produced no process at all, or
- there is a description and **no geometry** to measure — the one case the
  rules genuinely cannot address.

A confident rule answer costs nothing and calls nobody. You can watch that:
classify a flat plate and `DataStore.countAiUsage({scope:'global'})` stays at 0.

Even then the model only wins **by being more certain**. A hedging model does
not get to override a confident rule that actually measured the part.

### The keys are not in this repository, and cannot be

Everything under `assets/` is downloadable plain text, so a key there is a
published key. `proxy/` is a Cloudflare Worker that holds them —
see **[proxy/README.md](proxy/README.md)** for deployment.

The worker is **not a chat proxy**. It accepts a structured payload and builds
the prompt itself; it will not forward an arbitrary prompt and drops any field
it does not recognise. A worker that relays whatever it is handed is a free LLM
for anyone who finds the URL, billed to you.

**You do not need the worker to test any of this.** `proxy.mock: true` in
`ai-config.js` answers from a canned local result with no network at all, which
is what ships. The mock labels itself in its own reasons — a test double you
cannot tell apart from the real thing is a trap.

### Consent, and what actually gets sent

Off by default. Until the client ticks the box, no remote provider is called at
all, and the panel says so rather than silently degrading.

What is sent, once they agree: the measured geometry, the file extension, the
material class and tolerance they typed, and their description.

**Never the file, and never the filename.** `buildPayload()` in `ai.js` builds
what leaves the browser and gates the description on the *consent state
resolved for that call* — not on a config flag, because a flag cannot be
revoked by the person whose brief it is.

Consent is stored per tenant, not read off a checkbox that happens to still be
on screen. "Did this client agree that their brief could leave our servers" is
a question that may have to be answered months later, and UI state cannot
answer it. `supabase/migrations/0005_ai_consent.sql` also records *which
wording* was agreed to, because consent is to a specific statement.

### When a provider is down

`fallbackOrder` is tried in order. A 429, a 500, a timeout or a CORS refusal
moves to the next one; if every provider fails, **the rules answer stands**.
A provider being down costs precision and can never cost availability.

Every attempt is logged to `ai_usage` — one row per *call*, not per
classification, because a request that fell through three providers cost three.

### Two caps, and why both

`limits.perTenantPerDay` and `limits.globalPerDay` are counted from the usage
log **before** a request is made, so a limit stops the request rather than
recording that it was exceeded. The global one is separate on purpose: one busy
tenant must not exhaust the free tier for everyone.

The worker enforces its own copy. Both are needed — **a browser cap is a
courtesy, not a control**, since anyone can open a console and edit it.

### One thing that is easy to get wrong

An answer that *wanted* to escalate and could not — no consent yet, a cap
reached, every provider down — is **not cached**. It is logged, because it is
still a decision the user was shown, but `escalation_blocked` keeps it out of
the cache lookup.

Without that, ticking the consent box appeared to do nothing: the same question
came straight back from the row written while consent was still refused.

### Adding a panel or a provider

A provider registers itself from its own file with
`AIService.registerProvider(name, impl)`, and `ai.js` does not change. A panel
registers with `WorkspacePanels.register` and is one `<script>` tag. The
classification panel is the worked example of both.

## License

All rights reserved · GESTALTUNG · Doha, Qatar
