# Classification proxy

GitHub Pages serves static files and **cannot hold a secret**. Everything under
`assets/` is downloadable plain text, so an API key placed there is a published
API key. This worker exists so the keys have somewhere else to live.

The browser calls this; this calls Gemini, Groq or OpenRouter.

## It is not a chat proxy

`/classify` takes a **structured payload** — file extension, measured geometry,
an optional description, the list of processes — and builds the prompt itself.
It will not forward an arbitrary prompt, and it drops any field it does not
recognise.

That is the whole security model. A worker that relays whatever it is handed is
a free LLM for anyone who finds the URL, billed to you.

## You do not need this to test

`assets/js/services/ai-config.js` ships with `proxy.mock: true`. That answers
from a canned local result with no network at all, so the escalation path, the
fallback chain, the consent gate and the daily caps can all be exercised before
this worker exists. The mock labels itself in its own reasons — a test double
you cannot tell apart from the real thing is a trap.

Deploy this when you want real answers.

## Deploying

```bash
npm install -g wrangler     # once
cd proxy
wrangler login
```

**1. Get at least one free key.** Any one works; more means the fallback chain
has somewhere to fall.

| Provider | Where | Free tier |
|---|---|---|
| Google AI Studio (Gemini) | `aistudio.google.com/apikey` | generous, no card |
| Groq | `console.groq.com/keys` | fast, rate limited per minute |
| OpenRouter | `openrouter.ai/keys` | free models, `:free` suffix |

**2. Store them as secrets.** Never in `wrangler.toml` — that file is committed.

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put OPENROUTER_API_KEY
```

**3. Set the origin allow-list.** In `wrangler.toml`, `ALLOWED_ORIGINS` must
list exactly the sites allowed to call this. The caller is a browser, so
`Origin` is set by the browser and cannot be forged by page script — this is
the guard that actually stops someone else spending your quota.

Leaving it empty allows every origin. Do not leave it empty.

**4. Optional but recommended — a counter for the caps.**

```bash
wrangler kv namespace create RATE_KV
```

Paste the printed id into the `[[kv_namespaces]]` block in `wrangler.toml`.
Without it `GLOBAL_DAILY_CAP` and `TENANT_DAILY_CAP` are advisory, and
`/health` says so rather than implying a cap that does not exist.

**5. Deploy, and point the site at it.**

```bash
wrangler deploy
```

Then in `assets/js/services/ai-config.js`:

```js
proxy: {
  url: 'https://gestaltung-classifier.<your-subdomain>.workers.dev',
  mock: false,
  timeoutMs: 20000
}
```

## Checking it

```bash
curl https://gestaltung-classifier.<subdomain>.workers.dev/health
```

```json
{ "ok": true, "mock": false, "providers": ["gemini"],
  "capEnforced": true, "allowedOrigins": ["https://mworkqu.github.io"] }
```

`providers` lists what is actually configured, not what you hoped was. A
provider with no key is reported missing here and returns `501` from
`/classify`, which the browser treats as "try the next one" rather than as an
outage.

## Running it locally

```bash
cd proxy
wrangler dev            # http://localhost:8787
```

`wrangler dev` reads secrets from `.dev.vars` (git-ignored — create it
yourself, never commit it):

```
GEMINI_API_KEY=...
```

To exercise the worker with no key at all, set `MOCK = "1"` in `wrangler.toml`
and restart. Then point the site at it:

```js
proxy: { url: 'http://localhost:8787', mock: false }
```

`http://localhost:4173` is already in the default `ALLOWED_ORIGINS`.

## The paid slot

There is one provider here that can produce an invoice, and it is switched off
twice: it needs `ENABLE_PAID = "1"` in `wrangler.toml` **and**
`ANTHROPIC_API_KEY` as a secret. Either one alone does nothing.

One switch would have been enough to make it work, which is the reason there
are two — a key pasted while debugging should not start a bill.

```bash
wrangler secret put ANTHROPIC_API_KEY
# ENABLE_PAID = "1" in wrangler.toml
wrangler deploy
curl https://…/health      # "paidEnabled": true
```

`/health` reports `paidEnabled` on its own line, because "the paid provider is
off" is the single most important thing this endpoint can say.

A caller that reaches `/classify` with `provider: "paid"` while it is disabled
gets `501 provider_not_enabled` — the same shape as "not configured", so the
browser's fallback chain moves on and nothing about the site's billing
arrangements is announced to someone who was not supposed to be there.

Switching vendor is one row in `PROVIDERS` plus an adapter, the way
`callOpenAICompatible` already serves both Groq and OpenRouter. The browser
calls it `paid` and never learns who answered.

Full walkthrough: **[../docs/ai-roadmap.md](../docs/ai-roadmap.md)**.

## Two caps, and why both

The browser counts its own usage before asking, and this worker counts again
before spending. Both are needed and neither is redundant: **a browser cap is a
courtesy, not a control** — anyone can open a console and edit it. The worker's
copy is the one that holds.

## What reaches a model

Measured geometry, the file extension, the material class and tolerance the
client typed, and the client's description — and only once they have ticked the
consent box, which is off by default.

**Never the file.** `buildPayload()` in `assets/js/services/ai.js` constructs
what leaves the browser, and cannot include the bytes. Not the filename either:
a filename routinely carries a client or a project name, so remote providers
get the extension alone.

## Cost

Zero, by construction. Every provider listed is a free tier, the caps keep you
inside it, the answer is cached by question, and a model is only asked when the
local rules are genuinely unsure. If every provider is down, unconfigured, over
quota or refused consent, the rules still answer — the page has no dependency
on any of this being up.
