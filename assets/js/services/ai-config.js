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

  /* The provider tried first. */
  activeProvider: 'rules',

  /* Tried in order until one answers. `rules` is last on purpose: it
     is local, free and always available, so it is the floor the chain
     can never fall through. From Stage 3 this becomes something like
     ['gemini', 'groq', 'openrouter', 'rules']. */
  fallbackOrder: ['rules'],

  providers: {
    rules:      { enabled: true,  implemented: true,  local: true,  stage: 1 },
    gemini:     { enabled: false, implemented: false, local: false, stage: 3 },
    groq:       { enabled: false, implemented: false, local: false, stage: 3 },
    openrouter: { enabled: false, implemented: false, local: false, stage: 3 },
    local:      { enabled: false, implemented: false, local: true,  stage: 5 },
    paid:       { enabled: false, implemented: false, local: false, stage: 6 }
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

     sendDescription flips to true in Stage 3, behind the visible
     consent toggle that stage adds. Until then nothing at all leaves
     the browser, because `rules` is local. */
  privacy: {
    sendRawFiles:    false,
    sendDescription: false
  },

  /* Free-tier guard rails. null means "not enforced yet" — the caps
     start being counted in Stage 3, when there is a metered provider
     to count. */
  limits: {
    perTenantPerDay: null,
    globalPerDay:    null
  }

};
