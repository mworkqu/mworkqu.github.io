# CLAUDE.md

Working notes for this repository. Read this before assuming a stack.

## What this actually is

**Static HTML + CSS + vanilla JS. No build step, no framework, no
package manager, no server.** Hosted on GitHub Pages from the repo
root. `npm run serve` is a 50-line `http.server` wrapper, nothing more.

There is **no** React, Next.js, `next-intl`, Tailwind, TypeScript, or
bundler here. If a task description assumes one, that assumption is
wrong — check before writing code against it.

State lives in `localStorage`, seeded once from JSON in `data/`.
There is no auth: the `/login/` pages are static mockups and the role
dashboards are reachable directly by URL.

| | |
|---|---|
| HTML | one `index.html` per route folder |
| CSS | one file, `assets/css/styles.css` |
| JS | plain `<script>` tags, IIFEs hanging off `window` |
| Data | JSON in `data/`, fetched at runtime |
| Persistence | `localStorage` |

Asset paths are **not** consistent: root-level pages use relative
(`../assets/…`), dashboard pages use absolute (`/assets/…`). Match
whatever the file you are editing already does. `fetch()` calls in JS
are always absolute (`/data/…`), which is why the site must be served
from a domain root.

## Planned backend: Supabase

Not connected. The SQL that will back it is written and committed:

```
supabase/migrations/0001_schema.sql   tables
supabase/migrations/0002_rls.sql      row level security
supabase/migrations/0003_rpc.sql      atomic operations
```

Nothing runs these yet. They exist so the JS data layer can be
repointed without redesigning anything.

### The one file that changes

`assets/js/data/store.js` (`window.DataStore`) is the only module that
touches persisted state. Every function is async and named for the RPC
that will replace it:

| DataStore | becomes |
|---|---|
| `deductInventory` | `rpc('deduct_inventory')` |
| `restoreInventory` | `rpc('restore_inventory')` |
| `addToProject` | `rpc('add_to_project')` |
| `removeFromProject` | `rpc('remove_from_project')` |
| `addToCart` | `rpc('add_to_cart')` |

Migrating means rewriting that file's internals. Nothing above it —
no panel, no page — should need an edit. **Do not add `localStorage`
access or business rules to page code**; that is what breaks the seam.

`ClientStore._state()` / `_write()` in `assets/js/client-store.js` are
a deliberate temporary bridge so both layers share one state object
while the older dashboard pages still read through `ClientStore`. Both
disappear with the migration. Do not call them from page code.

### Atomicity

`DataStore.applyDeduction` is one read-check-write block with **no
`await` inside it**, and it refuses to drop below zero. That mirrors
the guarded `UPDATE … WHERE qty >= p_qty` in `0003_rpc.sql`, so
callers get the same results and the same error codes (`not_found`,
`insufficient_stock`, `invalid_quantity`) on either backend. Keep it
that way — inserting an `await` between the check and the write
reintroduces exactly the race the RPC exists to prevent.

The RPCs are `SECURITY INVOKER` on purpose. `SECURITY DEFINER` would
bypass RLS and turn "deduct my stock" into "deduct anyone's stock".

### Multi-tenancy

Every inventory row, project, project item and cart line carries
`tenant_id`. **The JS filtering is a rendering convenience, not a
security boundary** — anyone with a console can change
`localStorage['gestaltung.tenant']`. Real isolation is the RLS in
`0002_rls.sql` and arrives with Supabase. See the "Multi-tenancy"
section of `README.md`.

## Configuration as data

`data/processes.json` is the single source of truth for manufacturing
processes and the materials each one accepts, with `en` and `ar`
labels on every entry. Adding a process or material is a **data edit
only** — no code change. It is read by `assets/js/components/cascade.js`,
which both `/manufacturing/` and the project workspace mount.

Do not hardcode a process or material name in a component.

## The project workspace

`/dashboard/client/projects/detail/` is slot-based. The page owns no
panel markup; panels register themselves:

```js
WorkspacePanels.register({
  id: 'model', slot: 'center', order: 20,
  titleKey: 'workspace.panels.model',
  mount: (body, ctx) => { … }
});
```

Slots are `left`, `center`, `right`. Panels never call each other —
they share `ctx`, which carries `projectId` and an event bus. Adding a
tool means a new file plus one `<script>` tag above
`workspace-boot.js` in the page. `boot()` renders whatever is
registered when it runs, so load order matters.

## The AI service

`assets/js/services/ai.js` is the **only** door to any classifier or
model. No page, panel or component may call a provider directly — that
rule is what keeps a provider swap down to a config edit.

```js
await AIService.classifyProject({ file, features, description })
// → { process, alternatives[], confidence, reasons[], source, band, logId }
```

`generateModel` / `generateImage` / `generateSchematic` are declared and
return `{ ok:false, available:false }`. **No model is called anywhere in
this repo.** Keep them non-throwing when they gain bodies.

`assets/js/services/ai-config.js` picks the provider and holds the
fallback order and feature flags. It contains **no secrets and never
can** — it is served as plain text. Keys live in the Stage 3 proxy.

Rules that are structural, not stylistic:

- **Never pass the file to a provider.** `buildPayload()` decides what
  leaves: extension, size, features, and (from Stage 3, with consent)
  the description. Not the bytes, not the filename.
- **Never decide silently.** A suggestion is rendered by
  `components/classification-confirm.js` with its confidence, reasons
  and alternatives, and the user confirms or corrects it.
- **Reasons are `{ key, vars }`, not sentences**, so a stored result
  re-reads in Arabic and survives a language switch without
  reclassifying.
- **Logging happens inside `ai.js`**, so no caller can skip it. The
  caller reports the human's choice with `DataStore.logCorrection()`,
  and `corrected` is derived, not passed.
- A failing provider is skipped, never fatal. `rules` is last in the
  chain because it is local and always available.

Row shapes match `supabase/migrations/0004_ai.sql`, which has no delete
policy on purpose. The cache key is `(file_hash, question_hash)`, and
the question hash covers the brief, the material class **and** the
tolerance — hashing the description alone serves a stale verdict the
moment a hint is edited.

### The classifier

`assets/js/services/rules-provider.js` registers itself as `rules`;
`ai.js` never names it. Everything it decides comes from
`data/classification-rules.json`: thresholds, conditions and reason
keys. Conditions are declarative (`eq` `ne` `lt` `lte` `gt` `gte` `in`
`exists`) and there is **no `eval` anywhere** — a data file must never
become an execution path. A malformed rule is skipped, not fatal.

`assets/js/services/geometry.js` measures the file locally. Loaders
load from a CDN on first use and only for the format picked. Every
failure is soft and falls back to the file-type layer.

Two rules that are easy to break by accident:

- **The extension is a prior, not a peer.** When a data rule decides,
  it resolves alone and the extension demotes to an alternative.
  Treating them as equals returns "not sure" for every flat plate
  exported as STL.
- **`ne` is evaluated before the missing-value guard**, because absent
  genuinely is "not equal to". Folding it in with the other operators
  silently disables every negative test on an optional feature, which
  is worse than having no test — it looks like it passed.

### Escalation (Stage 3)

`rules` always runs first and is NOT part of `fallbackOrder`. A model
is asked only when the rules are unsure, produce no process, or there
is a description with no geometry. Even then it wins only by being
more certain. Escalating on every file would spend a free tier on
questions already answered and send a brief to a third party who did
not need it.

- **The keys live in `proxy/`, never here.** That worker builds the
  prompt from a structured payload; it will not forward an arbitrary
  prompt, or it becomes a free LLM for whoever finds the URL.
- **Consent gates the description**, resolved per call in `ai.js` —
  not a config flag, which the client cannot revoke. Off by default.
- **An answer blocked by something transient is not cached.**
  `escalation_blocked` keeps it out of the lookup. Without it,
  ticking the consent box appears to do nothing, because the row
  written while consent was refused comes straight back.
- **Caps are counted before asking**, so a limit stops the request.
  The browser copy is a courtesy; the worker's copy is the control.
- A model's output is untrusted twice over: the worker validates it
  and `llm-provider.js` validates it again. A process key that is not
  ours is dropped rather than rendered.
- `proxy.mock: true` ships on, so a fresh clone works with no key.

### Admin insight (Stage 4)

`/dashboard/admin/ai/` + `assets/js/admin-ai.js`. It reads the two AI logs and
writes one row type: an admin's decision on a rule draft.

- **Accuracy's denominator is `decided_at`, not row count.** An unconfirmed
  suggestion is an unknown and is reported separately. Folding it in turns
  abandonment into agreement.
- **`demo: true` rows are labelled wherever they are counted.** `seedAiDemoData`
  lives in the data layer, not the page — "page code does not touch persisted
  state" has no test-only exception.
- **Nothing reads `aiRuleProposals` at classification time.** A draft is shown
  to a human who pastes it into `classification-rules.json`. Wiring a proposal
  straight into the classifier is the one change this feature exists to avoid.
- A draft needs `learning.minEvidence` corrections, `learning.minAgreement`
  measured against the parts that matched the same features and went elsewhere,
  and at least one condition. All three are load-bearing; the last one stops a
  rule that matches every part ever uploaded.
- `scope: 'all'` on the two list functions is a rendering convenience. The
  boundary is the staff `SELECT` policy in `0006_ai_insight.sql` — select only,
  because a correction log an operator can edit is not evidence.

### The on-device model (Stage 5) — an experiment that lost

`assets/js/services/local-model-provider.js`. Off by default and staying off:
measured on the logged history it scored 29% against the rules' 59%, and its
cosine margins were 0.00–0.04. Details in README.md. The code stays so the
question can be re-asked when there is real correction data.

- **Never download during a classification.** `classifyProject()` returns
  `model_not_loaded` immediately. A client waiting 25 MB for an answer the
  rules already had is a worse product than no local model.
- **Confidence is a margin over the runner-up, capped below the rules.** A
  cosine similarity is always positive; presenting it as a probability shows
  high confidence for a part the model has never seen.
- **Consent and caps are per provider, not per chain** (`remoteBlockedBy()` in
  `ai.js`). A local provider sends nothing and spends nothing. Gating it on a
  spend cap disables the free option exactly when the paid ones ran out.
- Local usage rows are `billable: false` and are excluded from `countAiUsage`.
  The default is `true`, because the failure that matters is undercounting what
  a free tier was charged.
- The benchmark scores only rows whose `source` is `rules` — elsewhere the
  rules' own prediction was overwritten and is not in the log.

## i18n

English and Arabic, `data/i18n/{en,ar}.json`, applied by
`assets/js/i18n.js`. Keys are dotted and namespaced (`workspace.
panels.filters`) precisely because that is what `next-intl` expects,
so a later migration needs no renaming.

- `assets/js/i18n.js` must load in `<head>`; it sets `lang` and `dir`
  at parse time so RTL is right on the first frame.
- Markup opts in per element: `data-i18n`, `data-i18n-html`,
  `data-i18n-placeholder`, `data-i18n-aria-label`, `data-i18n-title`.
- JS-rendered strings use `I18n.t('key', { vars })`, always with an
  English literal as the fallback — a missing key returns the key, and
  a screen of raw key names is worse than untranslated English.
- `{ en, ar }` label pairs (as in `processes.json`) go through
  `I18n.pick()`.
- Both locale files must carry exactly the same key set.

RTL is mostly free: grid and flex follow `direction`. The places that
needed help are collected under "RTL corrections" in the stylesheet —
they are all spots where the original CSS used a physical edge
(`border-left`) instead of a logical one.

## Conventions worth keeping

- Comments explain **why**, not what. The existing files do this well;
  match them.
- `escapeHtml` everything interpolated into a template string.
- Data drives markup. The shop filter bar is built from
  `products.json`'s categories; the material list from
  `processes.json`. Adding a row to the data should be enough.
- `onHand` is never typed by a human — it is derived from the ledger
  (`docs/inventory-model.md`).

## Testing

No test runner. Verification is manual in a browser:

```bash
npm run serve
```

then `http://localhost:4173`. That is `tools/serve.py` — `http.server` plus
`Cache-Control: no-store`, because the plain module sends no cache headers and
browsers then serve a stale `.js` for minutes after you edit it. If a change
will not appear, check you are on this server and not `python -m http.server`.

`README.md` has the step-by-step checks for the workspace, the cascade, the
inventory deduction and the tenant scoping.
