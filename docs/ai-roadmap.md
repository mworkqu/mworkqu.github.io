# AI: what is built, what it costs, and how to move a feature to paid

This is the operations note for the AI features. It says what exists, how to
switch a feature from free to paid, and which settings stop a bill running
away. It is deliberately specific about what is **not** done.

Nothing in this repository charges anybody today.

---

## Where things stand

| Stage | What | State |
|---|---|---|
| 1 | Service layer, config-picked provider, confirm-before-acting | Built |
| 2 | Rule classifier + in-browser geometry | Built |
| 3 | Escalation to a free LLM through a key-holding proxy | Built, mock ships on |
| 4 | Admin insight, log export, rule drafts from corrections | Built |
| 5 | On-device model | Built, **measured, and left off — it lost to the rules** |
| 6 | Metering and credits | **Meter built. Till not built.** |

Not built, and designed for rather than scaffolded: text-to-3D modelling,
product image generation, schematics, BOM generation. Each is a workspace
panel calling `ai.js`; the service layer already declares
`generateModel` / `generateImage` / `generateSchematic`, which return
`{ ok: false, available: false }` and do not throw.

---

## The one rule that makes any of this switchable

**Every AI call goes through `assets/js/services/ai.js`.** No page, panel or
component ever calls a provider. That is why everything below is a config
edit instead of a refactor.

---

## Switching a feature from free to paid

Five steps, in this order. The order matters: the last one is the only one
that can cost money, and by then everything else is already verified.

### 1. Decide what it costs

`data/ai-plans.json` — a feature price and a provider multiplier. Both are
data; neither is in code.

```json
"features":  { "generateImage": { "credits": 8 } },
"providerMultipliers": { "paid": 4 }
```

An image through the paid provider is then 32 credits. **A price of zero is a
real price**: rules, cache and the on-device model are free to run, so they are
free to use. Charging for them would push a client on a small plan towards the
expensive answer to save their allowance, which is backwards.

### 2. Put the provider in the plans that may use it

```json
{ "key": "studio", "monthlyCredits": 500, "providers": [ … , "paid" ] }
```

A plan without `paid` in its list cannot generate an invoice at all, whatever
else is switched on. That is the `free` tier's real definition.

### 3. Turn the feature on

`assets/js/services/ai-config.js`:

```js
features: { generateImage: true }
```

### 4. Enable the paid provider in the browser

```js
providers: { paid: { enabled: true, implemented: true, local: false, stage: 6 } }
fallbackOrder: ['local', 'gemini', 'groq', 'openrouter', 'paid']
```

**Put `paid` last.** The chain stops at the first provider that answers, so a
free tier that works is never skipped for one that bills.

### 5. Enable it in the worker — the step that spends money

```bash
cd proxy
wrangler secret put ANTHROPIC_API_KEY
# set ENABLE_PAID = "1" in wrangler.toml
wrangler deploy
curl https://…workers.dev/health     # "paidEnabled": true
```

It needs **both** the flag and the key. One switch would have been enough to
make it work, which is exactly why there are two: this is the only provider
that can produce an invoice, and it should not start doing that because
somebody pasted a key while debugging.

---

## The cost-control settings, and what each one actually stops

| Setting | Where | Stops |
|---|---|---|
| `escalate.belowConfidence` | `ai-config.js` | Asking a model a question the rules already answered |
| `cache.enabled` | `ai-config.js` | Paying twice for the same question |
| `limits.perTenantPerDay` | `ai-config.js` | One tenant in a loop |
| `limits.globalPerDay` | `ai-config.js` | Everyone at once |
| `TENANT_DAILY_CAP` / `GLOBAL_DAILY_CAP` | `wrangler.toml` | The same, but for real |
| `plans[].monthlyCredits` | `ai-plans.json` | A month's spend per tenant |
| `plans[].overage` | `ai-plans.json` | Whether hitting the allowance blocks or just flags |
| `billing.enforce` | `ai-config.js` | Whether the allowance refuses anything at all |
| `ENABLE_PAID` | `wrangler.toml` | Any spend whatsoever |

**Only the worker's copies are controls.** The browser's caps and credits stop
*us* from asking; anyone can open a console and edit them. Both exist because
they stop different things: the browser's saves a round trip and gives the
client a truthful number, the worker's is what holds when the client is
hostile.

The escalation policy is the cheapest control of the lot and it is easy to
overlook: **the rules answer first, always, and a model is asked only when they
are unsure.** A confident rule answer costs nothing. You can watch it —
classify a flat plate and `DataStore.countAiUsage({ scope: 'global' })` stays
where it was.

---

## The credit system

**Cost = ceil(feature credits × provider multiplier).** Both numbers come from
`data/ai-plans.json`, which becomes `ai_feature_prices` and
`ai_provider_multipliers` in `supabase/migrations/0008_billing.sql`.

The period is the calendar month, because that is what a subscription line
reads as and what a client will check it against.

### What is metered

One row per provider **call**, not per classification: a request that fell
through three providers cost three, and that is what the free tier was charged.
Each row carries the feature, the provider, the model, the tokens, the latency
and the credits.

Local calls are logged `billable: false` and excluded from every count. A model
on the client's device spends nothing.

### Estimated tokens are marked as estimated

When a provider reports no usage — the mock, an API that omits it — the tokens
are estimated from the payload and the row is flagged `tokens_estimated`. The
admin page reports estimated rows separately and never adds them into a
measured total. An estimate and a measurement are different evidence.

### The part that is not finished, and must be before anyone is charged

**Today the browser computes the price and posts it.** `billing.authority` in
`ai-config.js` says `'client'`, which is an accurate description of a meter
that is fine for counting and unacceptable for billing: a client that can post
its own price is not metered.

`0008_billing.sql` already contains the fix — `ai_usage_price()`, a trigger
that recomputes `credits` from the price rows on insert and discards whatever
arrived. Flipping `billing.authority` to `'server'` is meaningful only once
that trigger is actually running in Postgres.

Also missing before this could bill:

- a payment processor, and an invoice anybody could dispute;
- somewhere for `overage: 'notify'` to notify (it currently just does not
  block);
- a grace path — "your allowance ran out" needs to tell the client what to do
  next, and right now the feature would simply stop.

---

## Enforcement, when you do turn it on

```js
billing: { enforce: true }
```

`ai.js` then checks the allowance before a provider call, in the same place and
for the same reason as the daily caps: so a limit stops the request rather than
recording that it went over. A refusal returns `credits_exhausted` or
`provider_not_in_plan` through the usual escalation reason, and the panel says
so — it does not go quiet.

Free providers are never refused. `check()` returns early when the price is
zero, so running out of credits leaves a client with the rules, the cache and
(if they loaded it) the on-device model. **The free answer must survive the
paid one being cut off**, or an allowance becomes an outage.

---

## Adding a paid vendor that is not Anthropic

One row in `PROVIDERS` in `proxy/worker.js` plus an adapter function, the same
way `callOpenAICompatible` serves both Groq and OpenRouter. The browser already
has a provider called `paid` and does not know or care which vendor is behind
it, so changing vendor never reaches a page.

Keep the shape: the worker builds the prompt from a structured payload and
validates what comes back. **It must never forward an arbitrary prompt**, or it
becomes a free LLM for whoever finds the URL — billed, now, to a paid account.

---

## Privacy does not change because a provider is paid

The same rules apply, and none of them are relaxed for a vendor with a
contract:

- **The CAD file never leaves the browser.** `buildPayload()` in `ai.js` decides
  what goes, and it cannot include the bytes. Not the filename either — a
  filename routinely carries a client or a project name.
- **The description goes only with consent**, resolved per call, off by default.
- **Keys live in the worker.** Everything under `assets/` is downloadable plain
  text, so a key there is a published key.

---

## If you are reading this because the bill was a surprise

In order:

1. `curl …/health` — is `paidEnabled` true? It ships false.
2. `/dashboard/admin/ai/` — credits this month, per tenant, and which provider
   answered how often.
3. Export the JSON from that page. It carries the thresholds that produced it,
   so the log can be read months later without guessing what the settings were.
4. `ENABLE_PAID = "0"` and redeploy the worker. That stops all spending
   immediately and leaves the rules, the cache and the free tiers working.
