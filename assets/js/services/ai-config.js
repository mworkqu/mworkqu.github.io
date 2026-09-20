/* ── AI configuration ──────────────────────────────────────
   Which provider answers, in what order, and what is switched on.
   Changing a provider is a change HERE — never in a page, never in a
   panel, never in ai.js itself.

   ── There are no secrets in this file, and there never can be ──
   It is served to every visitor as plain text. An API key placed here
   is a published API key. From Stage 3 the browser talks to a small
   serverless proxy that holds the keys; the only thing that appears
   in this file is that proxy's public URL.

   Stage 1 implements `rules` and nothing else. The other entries are
   declared so the shape of the decision is visible now, and each one
   says which stage fills it in. An unimplemented provider is skipped
   by the fallback chain rather than throwing. */

window.AI_CONFIG = {

  /* `rules` ALWAYS runs, and runs first. It is local, free and
     instant, so there is never a reason to pay for an answer before
     hearing the free one. It is not part of the chain below — it is
     the floor underneath it. */

  /* Tried in order, and only when the rules result is weak enough to
     be worth escalating (see `escalate`). The first provider that
     returns a valid answer wins; if every one fails, the rules answer
     stands. A provider being down can therefore cost precision, and
     can never cost availability. */
  /* `local` is first because a model running on the visitor's own
     device sends nothing anywhere and costs nothing — if it is
     loaded and it is any good, there is no argument for asking a
     remote service before it. It is disabled below, so in practice
     this chain starts at gemini until someone turns the experiment
     on. */
  fallbackOrder: ['local', 'gemini', 'groq', 'openrouter'],

  providers: {
    rules:      { enabled: true,  implemented: true,  local: true,  stage: 1 },
    gemini:     { enabled: true,  implemented: true,  local: false, stage: 3 },
    groq:       { enabled: true,  implemented: true,  local: false, stage: 3 },
    openrouter: { enabled: true,  implemented: true,  local: false, stage: 3 },
    local:      { enabled: false, implemented: true,  local: true,  stage: 5 },
    paid:       { enabled: false, implemented: false, local: false, stage: 6 }
  },

  /* Where the keys live. Never a key in this file — see
     assets/js/services/llm-provider.js and proxy/README.md.

     `mock: true` answers from a canned local result with no network
     at all, so the escalation path, the fallback chain and the caps
     can be exercised before a proxy exists. It ships ON so a fresh
     clone works out of the box; set it false once `url` points at a
     deployed worker. */
  proxy: {
    url: null,
    mock: true,
    timeoutMs: 20000
  },

  /* When is a paid-ish answer worth asking for at all?

     Escalating on every file would burn a free tier on questions the
     rules already answered well, and would send a description to a
     third party when nobody needed it to. So: only when the rules are
     genuinely unsure, or when there is a description and no geometry
     to go on — which is precisely the case the rules cannot handle. */
  escalate: {
    belowConfidence: 0.5,
    whenNoProcess: true,
    whenDescriptionOnly: true,
    minDescriptionChars: 12
  },

  /* A feature that is off returns a clean "not available yet" result.
     It never throws, and a panel can render that result as-is. */
  features: {
    classifyProject:   true,
    generateModel:     false,   // future
    generateImage:     false,   // future
    generateSchematic: false    // future
  },

  /* Identical work is never paid for twice. Keyed on the file hash
     plus the description, because the same file with a different
     brief is a different question. */
  cache: {
    enabled: true
  },

  /* Turns a 0–1 score into the band the UI shows. Tunable without
     touching the classifier. Below `medium` the UI leads with the
     question rather than the answer. */
  confidence: {
    high:   0.75,
    medium: 0.40
  },

  /* Hard privacy switches, checked by ai.js before a provider is
     handed anything.

     sendRawFiles must stay false. A client's CAD file is their
     intellectual property and it never leaves this browser — a
     provider is given extracted features and an extension, nothing
     more. ai.js enforces this rather than trusting each adapter.

     requireConsent means no remote provider is called at all until
     the client has said yes, in the panel, where the notice is. It is
     not a config convenience; turning it off would send a client's
     brief to a third party without telling them. */
  privacy: {
    sendRawFiles:    false,
    requireConsent:  true,
    consentDefault:  false
  },

  /* ── The in-browser model (Stage 5) — an experiment, and off ──
     A small sentence-embedding model running on the visitor's own
     device. Nothing downloads, runs or costs anything until someone
     turns it on deliberately; `providers.local.enabled` above is the
     switch, and assets/js/services/local-model-provider.js refuses to
     download during a classification no matter what.

     It stays off until it is shown to beat the rules on the logged
     history — that is what the benchmark on /dashboard/admin/ai/ is
     for. An experiment that ships on because it is interesting is
     just a regression with a good story.

     confidenceCap is the load-bearing number. This model scores
     similarity, not probability, so its confidence is derived from
     how far ahead the winner is — and capped below the hand-written
     rules, which actually measured the part. */
  localModel: {
    enabled:          false,
    lib:              'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2',
    model:            'Xenova/all-MiniLM-L6-v2',
    quantized:        true,
    approxDownloadMB: 25,
    confidenceCap:    0.6,
    marginScale:      4,
    minConfidence:    0.12
  },

  /* How much evidence before a repeated correction is worth showing
     to an admin as a draft rule (Stage 4).

     Both numbers are deliberately unforgiving. Two corrections is a
     coincidence, and a pattern that only holds 60% of the time is a
     rule that will be wrong twice a week. The draft is shown, never
     applied: data/classification-rules.json is edited by a person,
     and a classifier that rewrites its own rules learns whatever its
     users were confused about that week. */
  learning: {
    minEvidence:  3,
    minAgreement: 0.7
  },

  /* Free-tier guard rails, counted locally from the usage log before
     a request is made. The worker enforces its own copy — these stop
     us asking, that stops anyone else. Both are needed: a browser cap
     is a courtesy, not a control. */
  limits: {
    perTenantPerDay: 25,
    globalPerDay:    200
  }

};
