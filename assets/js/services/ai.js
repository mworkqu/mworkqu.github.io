/* ── AI service ────────────────────────────────────────────
   The single door between this application and anything that
   classifies or generates. No page, panel or component may call a
   provider directly; they call the functions here and read the shape
   that comes back. That is what makes swapping `rules` for a hosted
   model a config edit instead of a rewrite.

     classifyProject({ file, features, description })
       → { process, alternatives[], confidence, reasons[], source }

     generateModel()      ┐
     generateImage()      ├─ declared, not implemented. Each returns a
     generateSchematic()  ┘  clean "not available yet" result and never
                             throws, so a panel can render it today.

   ── What a provider is allowed to see ──
   Never the file. buildPayload() constructs what a provider receives
   — extension, byte length, extracted features, and (from Stage 3,
   with consent) the description. The File object is read in this
   browser to compute a hash and, from Stage 2, geometry; the bytes go
   no further. The check lives here rather than in each adapter,
   because a privacy rule enforced in one place is a rule and enforced
   in five places is a hope.

   ── Provider registry ──
   Stage 3 adds adapters with AIService.registerProvider(name, impl)
   from their own file. Nothing in this one changes.

   ── Logging ──
   classifyProject() writes the suggestion through the data layer
   itself, and returns the row id. Doing it here rather than in the
   caller means no future panel can forget to, which is the only way
   the accuracy numbers in Stage 4 will be worth reading. The caller
   reports the human's decision with DataStore.logCorrection(). */

window.AIService = (function () {

  const cfg = () => window.AI_CONFIG || {};

  /* Reasons an escalation was skipped that may not hold next time.
     `rules_were_more_certain` is deliberately absent: that one is a
     judgement about the answer itself, and it will still be true. */
  const TRANSIENT_BLOCKS = [
    'consent_missing', 'tenant_daily_cap', 'global_daily_cap',
    'all_providers_failed', 'no_provider'
  ];

  /* ── result shapes ───────────────────────────────────── */

  function unavailable(feature, reason) {
    return {
      ok: false,
      available: false,
      feature: feature,
      reason: reason || 'not_implemented',
      messageKey: 'ai.notAvailable',
      source: null
    };
  }

  function emptyResult(source, reasons) {
    return {
      ok: true,
      process: null,
      alternatives: [],
      confidence: 0,
      reasons: reasons || [],
      source: source || 'rules'
    };
  }

  /* ── file identity ───────────────────────────────────── */

  /* .kicad_pcb is two segments deep; everything else is the last one. */
  function extensionOf(file) {
    const name = typeof file === 'string' ? file : (file && file.name) || '';
    const bits = String(name).toLowerCase().split('.');
    if (bits.length < 2) return '';
    const tail = bits[bits.length - 1];
    return (tail === 'pcb' && bits[bits.length - 2] === 'kicad') ? 'kicad_pcb' : tail;
  }

  /* SHA-256 of the bytes, so the same file is recognised whatever it
     was renamed to. Needs a secure context; localhost counts, file://
     does not. When it is unavailable we return null and the caller
     simply loses caching — never an error the user has to read. */
  async function hashFile(file) {
    if (!file || typeof file === 'string') return null;
    if (!(window.crypto && crypto.subtle && file.arrayBuffer)) return null;
    try {
      const buf    = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (e) {
      if (window.console) console.warn('[ai] hashing unavailable', e);
      return null;
    }
  }

  /* Cheap stable hash of the description, so the cache key can tell
     "same file, same question" from "same file, new brief". Not
     cryptographic and does not need to be. */
  function hashText(text) {
    const s = String(text || '').trim();
    if (!s) return '';
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  /* ── what leaves this module ─────────────────────────── */

  /* The ONLY thing a provider is given. Note what is absent: the File
     and its bytes, always; and its name, for anything that leaves the
     machine. A filename routinely carries a client, a project or a
     customer in it.

     `isLocal` is the one distinction that matters. A local provider
     runs in this browser, so handing it the base name costs nothing
     and lets it spot a board package called "gerber-out.zip". A
     remote provider gets the extension and nothing else, whatever it
     claims to need. Which providers are local is declared in
     ai-config.js, not asserted by the adapter itself. */
  function buildPayload(meta, features, description, isLocal, extras, consented) {
    const payload = {
      ext:        meta.ext || '',
      sizeBytes:  meta.sizeBytes || 0,
      features:   features || {},
      /* A local provider never sends anything anywhere, so it always
         sees the description. A remote one sees it only with consent
         — and that is the consent state resolved for THIS call, not a
         config flag, because a flag cannot be revoked by the person
         whose brief it is. */
      description: (isLocal || consented) ? (description || '') : '',
      processes:  meta.processes || []
    };
    if (isLocal && meta.baseName) payload.baseName = meta.baseName;
    if (extras) {
      if (extras.materialClass) payload.materialClass = extras.materialClass;
      if (typeof extras.toleranceMm === 'number') payload.toleranceMm = extras.toleranceMm;
    }
    return payload;
  }

  /* ── provider registry ───────────────────────────────── */

  const registry = Object.create(null);

  function registerProvider(name, impl) {
    if (!name || !impl || typeof impl.classifyProject !== 'function') {
      throw new Error('A provider needs a name and a classifyProject()');
    }
    registry[name] = impl;
  }

  /* activeProvider first, then the fallback order, skipping anything
     disabled, unimplemented or unregistered. Duplicates are fine —
     the seen set drops them. */
  function providerChain() {
    const c     = cfg();
    const decl  = c.providers || {};
    const order = [c.activeProvider].concat(c.fallbackOrder || []);
    const seen  = Object.create(null);
    const out   = [];

    order.forEach((name) => {
      if (!name || seen[name]) return;
      seen[name] = true;
      const d = decl[name];
      if (!d || !d.enabled || !d.implemented) return;
      if (!registry[name]) return;
      out.push(name);
    });
    return out;
  }


  /* ── reasons, rendered ───────────────────────────────── */

  /* Reasons travel as { key, vars } rather than as sentences, so the
     same result reads correctly in English and Arabic and can be
     re-rendered when the language changes without reclassifying. */
  function describeReason(reason) {
    if (!reason) return '';
    if (typeof reason === 'string') return reason;

    /* A model writes sentences, not i18n keys, so an LLM reason
       arrives as an { en, ar } pair and is picked like any other
       bilingual label. That keeps the guarantee the rule reasons
       give: a stored answer still re-reads in either language on a
       switch, without asking the model again. */
    if (reason.en || reason.ar) {
      return window.I18n ? I18n.pick(reason) : (reason.en || reason.ar);
    }

    if (!reason.key) return '';
    if (!window.I18n) return reason.key;
    const out = I18n.t(reason.key, reason.vars || {});
    return out === reason.key ? reason.key : out;
  }

  function confidenceBand(score) {
    const c = cfg().confidence || { high: 0.75, medium: 0.4 };
    if (score >= c.high)   return 'high';
    if (score >= c.medium) return 'medium';
    return 'low';
  }

  /* ── classify ────────────────────────────────────────── */

  async function classifyProject(input) {
    const opts = input || {};
    const c    = cfg();

    if (!(c.features || {}).classifyProject) {
      return unavailable('classifyProject', 'disabled');
    }

    const file = opts.file || null;
    const meta = {
      ext:       extensionOf(file),
      baseName:  (file && file.name) || '',
      sizeBytes: (file && file.size) || 0,
      hash:      await hashFile(file),
      processes: opts.processes || []
    };
    const description = opts.description || '';

    /* The cache key has to cover the whole QUESTION, not just the
       file. Description, material class and tolerance all change the
       answer — a block is a printed part until the client says it is
       aluminium — so hashing the description alone would serve a
       stale verdict the moment a hint was edited, and the hint fields
       would look broken. */
    const questionHash = hashText([
      description,
      opts.materialClass || '',
      (typeof opts.toleranceMm === 'number' ? opts.toleranceMm : '')
    ].join('\u0000'));

    /* Cache before analysis, as the brief requires: a file already
       answered is never analysed again. The decision is still logged,
       because a decision is an event even when the answer was free. */
    let result = null;
    let cached = false;

    /* A description-only request has no file and therefore no file
       hash. It is still cacheable -- the question is the same
       question -- so the key falls back to the question hash alone. */
    const cacheKey = meta.hash || (questionHash ? 'q:' + questionHash : null);

    if ((c.cache || {}).enabled && cacheKey && window.DataStore) {
      try {
        const prior = await DataStore.findClassification(cacheKey, questionHash);
        if (prior) {
          result = {
            ok: true,
            process: prior.suggested_process,
            alternatives: (prior.alternatives || []).slice(),
            confidence: prior.confidence || 0,
            reasons: (prior.reasons || []).concat([{ key: 'ai.reason.cached' }]),
            source: 'cache'
          };
          cached = true;
        }
      } catch (e) {
        if (window.console) console.warn('[ai] cache lookup failed', e);
      }
    }

    /* Geometry runs only on a cache miss, which is the point of
       hashing first: reading a 40 MB STEP file through a WASM kernel
       is the most expensive thing this page does, and doing it twice
       for the same file would be indefensible.

       It is also entirely local and entirely optional. A blocked CDN,
       an offline client or a corrupt file leaves `features` empty and
       the extension rules answer alone — less precisely, but they
       answer. Geometry improves the result; its absence must never
       degrade the page. */
    let features = opts.features || {};
    let geometry = null;

    /* What happened on the way to the answer, so the panel can say
       "the rules answered this, no model was called" rather than
       leaving the user to guess which it was. */
    const escalation = {
      considered: false, why: null, usedProvider: null,
      skipped: null, attempts: []
    };

    if (!result
        && file
        && !Object.keys(features).length
        && window.GeometryService
        && GeometryService.supports(meta.ext)) {
      const settings = (window.RulesProvider
        ? ((await RulesProvider.config()) || {}).settings
        : null);
      geometry = await GeometryService.extract(file, meta.ext, settings);
      if (geometry && geometry.ok) features = geometry.features;
    }

    if (!result) {
      const decl = (c.providers || {});
      const esc  = c.escalate || {};

      /* Resolved once, before anything is built, because it decides
         what a payload is even allowed to contain. */
      let consented = !(c.privacy || {}).requireConsent;
      if (!consented && window.DataStore) {
        try { consented = (await DataStore.getAiConsent()).granted; }
        catch (e) { consented = false; }
      }

      const payloadFor = (isLocal) => buildPayload(
        meta, features, description, isLocal,
        { materialClass: opts.materialClass, toleranceMm: opts.toleranceMm },
        consented);

      /* -- 1. the rules, always --------------------------
         Free, local and instant. There is never a reason to spend a
         request before hearing what the rules say, and their answer
         is the floor everything below can fall back to. */
      if (registry.rules) {
        try {
          const r = await registry.rules.classifyProject(payloadFor(true));
          if (r && r.ok) result = Object.assign({ source: 'rules' }, r);
        } catch (err) {
          if (window.console) console.warn('[ai] rules provider failed', err);
        }
      }
      if (!result) result = emptyResult('rules', [{ key: 'ai.reason.noProvider' }]);

      /* -- 2. is it worth escalating? --------------------
         Only when the rules are genuinely unsure, or when there is a
         description and nothing measurable to go on -- the one case
         the rules cannot address. Escalating on every file would
         spend a free tier answering questions already answered, and
         would send a client's brief to a third party who did not
         need it. */
      const weak = (result.confidence || 0) < (esc.belowConfidence || 0.5);
      const none = esc.whenNoProcess !== false && !result.process;
      const descOnly = esc.whenDescriptionOnly !== false
        && !features.hasGeometry
        && description.trim().length >= (esc.minDescriptionChars || 12);

      escalation.considered = weak || none || descOnly;
      escalation.why = none ? 'no_process'
        : (descOnly ? 'description_only' : (weak ? 'low_confidence' : null));

      if (escalation.considered) {
        const chain = providerChain().filter(function (n) { return n !== 'rules'; });

        /* Consent and the daily caps are about data LEAVING this
           browser and a free tier being spent. Neither is true of a
           provider that runs on the device, so both are checked per
           provider rather than once for the whole chain.

           Gating a local model on a spend cap would be worse than
           pointless: it disables the one option that costs nothing
           precisely when the paid ones have run out. */
        let remoteBlock;
        async function remoteBlockedBy() {
          if (remoteBlock !== undefined) return remoteBlock;

          if (!consented) { remoteBlock = 'consent_missing'; return remoteBlock; }

          /* Counted from the usage log BEFORE asking, so a limit
             stops the request rather than recording that we went
             over it. Local calls are logged unbillable and are not
             in this count. */
          const lim = c.limits || {};
          remoteBlock = null;
          if (window.DataStore && DataStore.countAiUsage) {
            try {
              if (lim.perTenantPerDay
                  && (await DataStore.countAiUsage({ scope: 'tenant' })) >= lim.perTenantPerDay) {
                remoteBlock = 'tenant_daily_cap';
              } else if (lim.globalPerDay
                  && (await DataStore.countAiUsage({ scope: 'global' })) >= lim.globalPerDay) {
                remoteBlock = 'global_daily_cap';
              }
            } catch (e) { /* a cap we cannot count is a cap we do not apply */ }
          }
          return remoteBlock;
        }

        if (!chain.length) {
          escalation.skipped = 'no_provider';
        } else {
          for (const name of chain) {
            const isLocal = !!(decl[name] && decl[name].local);

            if (!isLocal) {
              const blocked = await remoteBlockedBy();
              if (blocked) {
                /* Recorded, and the loop continues: a later
                   provider may be local and therefore unaffected.
                   Overwriting this with 'all_providers_failed'
                   below would hide WHY nothing was asked. */
                escalation.skipped = blocked;
                continue;
              }
            }

            const started = Date.now();
            let r = null;
            try {
              r = await registry[name].classifyProject(payloadFor(isLocal));
            } catch (err) {
              r = { ok: false, reason: String((err && err.message) || err) };
            }

            /* One row per CALL, not per classification: a request
               that fell through three providers cost three, and
               that is what the free tier was charged for. */
            if (window.DataStore && DataStore.logAiUsage) {
              try {
                await DataStore.logAiUsage({
                  provider: name, feature: 'classifyProject',
                  model: (r && r.model) || null,
                  /* A model on the device spends nothing, so it
                     must not count against a spend cap. Logged all
                     the same — it is still a call that happened. */
                  billable: !isLocal,
                  ok: !!(r && r.ok),
                  status: r && r.status,
                  error: (r && !r.ok) ? (r.reason || 'failed') : null,
                  latencyMs: (r && r.latencyMs) || (Date.now() - started),
                  tokensIn: (r && r.tokensIn) || 0,
                  tokensOut: (r && r.tokensOut) || 0
                });
              } catch (e) { /* logging must never break the answer */ }
            }

            escalation.attempts.push({
              provider: name, ok: !!(r && r.ok),
              reason: (r && !r.ok) ? (r.reason || 'failed') : null
            });

            if (r && r.ok) {
              /* A model wins only by being more certain. A hedging
                 model must not override a confident rule that
                 actually measured the part. */
              if ((r.confidence || 0) >= (result.confidence || 0)) {
                const ruleReasons = (result.reasons || []).slice(0, 2);
                result = Object.assign({ source: name }, r, {
                  reasons: (r.reasons || []).concat(ruleReasons),
                  warnings: result.warnings || [],
                  features: features,
                  supersededRules: true
                });
                escalation.usedProvider = name;
              } else {
                escalation.skipped = 'rules_were_more_certain';
              }
              break;
            }
            /* Otherwise: next provider. A provider being down costs
               precision, never availability. */
          }
          if (!escalation.usedProvider && !escalation.skipped) {
            escalation.skipped = 'all_providers_failed';
          }
      }
      }
    }

    result.cached     = cached;
    result.band       = confidenceBand(result.confidence || 0);
    result.features   = result.features || features;
    result.warnings   = result.warnings || [];
    result.geometry   = geometry
      ? { ok: geometry.ok, reason: geometry.reason || null }
      : { ok: false, reason: cached ? 'cached' : 'not_attempted' };
    result.escalation = escalation;
    result.fileHash   = meta.hash;
    result.fileExt    = meta.ext;
    result.fileSize   = meta.sizeBytes;
    result.questionHash = questionHash;

    /* Logged here, so no caller can skip it. */
    if (window.DataStore && DataStore.logClassification) {
      try {
        const logged = await DataStore.logClassification({
          fileHash:   cacheKey,
          fileExt:    meta.ext,
          fileSize:   meta.sizeBytes,
          questionHash: questionHash,
          description: description,
          features:   result.features || {},
          warnings:   (result.warnings || []).map((w) => w.id || w.key),
          suggested:  result.process,
          alternatives: result.alternatives || [],
          confidence: result.confidence || 0,
          /* The "answered before" marker is about this READING, not
             about the part, so it must not be stored — otherwise the
             next cache hit reads it back and appends another, and the
             reason list grows every time the file is opened. */
          reasons:    (result.reasons || []).filter(
                        (r) => !r || r.key !== 'ai.reason.cached'),

          /* An answer that WANTED to escalate and could not is not a
             final answer — it is the rules speaking while something
             temporary was in the way. Caching it as though it were
             final is why granting consent appeared to do nothing: the
             same question came straight back from the row written
             while consent was still refused. Marked here, skipped by
             findClassification, re-asked once the block lifts. */
          escalationBlocked: TRANSIENT_BLOCKS.indexOf(escalation.skipped) !== -1,
          source:     result.source
        });
        if (logged && logged.ok) result.logId = logged.id;
      } catch (e) {
        if (window.console) console.warn('[ai] logging failed', e);
      }
    }

    return result;
  }

  /* ── declared, not implemented ───────────────────────── */

  async function generateModel()     { return unavailable('generateModel'); }
  async function generateImage()     { return unavailable('generateImage'); }
  async function generateSchematic() { return unavailable('generateSchematic'); }

  return {
    classifyProject:   classifyProject,
    generateModel:     generateModel,
    generateImage:     generateImage,
    generateSchematic: generateSchematic,

    registerProvider:  registerProvider,
    providerChain:     providerChain,
    describeReason:    describeReason,
    confidenceBand:    confidenceBand,
    hashFile:          hashFile,
    hashText:          hashText,
    extensionOf:       extensionOf
  };

})();
