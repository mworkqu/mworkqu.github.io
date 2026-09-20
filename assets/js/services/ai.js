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
  function buildPayload(meta, features, description, isLocal, extras) {
    const p = cfg().privacy || {};
    const payload = {
      ext:        meta.ext || '',
      sizeBytes:  meta.sizeBytes || 0,
      features:   features || {},
      description: (isLocal || p.sendDescription) ? (description || '') : '',
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
    ].join(' '));

    /* Cache before analysis, as the brief requires: a file already
       answered is never analysed again. The decision is still logged,
       because a decision is an event even when the answer was free. */
    let result = null;
    let cached = false;

    if ((c.cache || {}).enabled && meta.hash && window.DataStore) {
      try {
        const prior = await DataStore.findClassification(meta.hash, questionHash);
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
      const decl    = (c.providers || {});
      const payload = buildPayload(
        meta, features, description,
        false,                      /* per-provider below */
        { materialClass: opts.materialClass, toleranceMm: opts.toleranceMm });

      /* Belt and braces. buildPayload cannot leak the file, but if a
         future edit makes it possible, refuse rather than send. */
      if (payload.file || payload.bytes || payload.name) {
        throw new Error('[ai] payload must never carry the file itself');
      }

      const chain  = providerChain();
      const errors = [];

      for (const name of chain) {
        try {
          /* Rebuilt per provider: a local one may see the base name,
             a remote one may not, and that must be decided by config
             rather than by the adapter asking nicely. */
          const forProvider = buildPayload(
            meta, features, description,
            !!(decl[name] && decl[name].local),
            { materialClass: opts.materialClass, toleranceMm: opts.toleranceMm });

          const r = await registry[name].classifyProject(forProvider);
          if (r && r.ok) { result = Object.assign({ source: name }, r); break; }
          errors.push({ provider: name, reason: (r && r.reason) || 'no_result' });
        } catch (err) {
          /* A provider being down must never break the page. Note it
             and try the next one. */
          errors.push({ provider: name, reason: String((err && err.message) || err) });
          if (window.console) console.warn('[ai] provider failed: ' + name, err);
        }
      }

      if (!result) {
        result = emptyResult('none', [{ key: 'ai.reason.noProvider' }]);
        result.errors = errors;
      }
    }

    result.cached     = cached;
    result.band       = confidenceBand(result.confidence || 0);
    result.features   = result.features || features;
    result.warnings   = result.warnings || [];
    result.geometry   = geometry
      ? { ok: geometry.ok, reason: geometry.reason || null }
      : { ok: false, reason: cached ? 'cached' : 'not_attempted' };
    result.fileHash   = meta.hash;
    result.fileExt    = meta.ext;
    result.fileSize   = meta.sizeBytes;
    result.questionHash = questionHash;

    /* Logged here, so no caller can skip it. */
    if (window.DataStore && DataStore.logClassification) {
      try {
        const logged = await DataStore.logClassification({
          fileHash:   meta.hash,
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
