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

  /* The ONLY thing a provider is given. Note what is absent: the File,
     its bytes, and its name. A filename can carry a client's project
     or customer in it, so providers get the extension alone. */
  function buildPayload(meta, features, description) {
    const p = cfg().privacy || {};
    return {
      ext:        meta.ext || '',
      sizeBytes:  meta.sizeBytes || 0,
      features:   features || {},
      description: p.sendDescription ? (description || '') : '',
      processes:  meta.processes || []
    };
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

  /* ── the rules provider (interim) ────────────────────────
     Extension mapping only. It is deliberately shallow: Stage 2
     replaces it with geometry analysis and an editable rule file. It
     stays honest in the meantime by saying so in its reasons and by
     refusing to guess when the extension cannot decide — a solid model
     could go to a mill or a printer, and "I do not know, here are the
     two candidates" is a better answer than a coin toss. */

  const BY_EXTENSION = {
    stl:   { process: '3d-printing',       confidence: 0.80, reason: 'mesh' },
    '3mf': { process: '3d-printing',       confidence: 0.80, reason: 'mesh' },
    obj:   { process: '3d-printing',       confidence: 0.60, reason: 'mesh' },
    gcode: { process: '3d-printing',       confidence: 0.90, reason: 'gcode' },

    dxf:   { process: 'laser-cutting',     confidence: 0.70, reason: 'flat' },
    svg:   { process: 'laser-cutting',     confidence: 0.60, reason: 'flat' },
    ai:    { process: 'laser-cutting',     confidence: 0.50, reason: 'flat' },

    gbr:        { process: 'pcb-manufacturing', confidence: 0.90, reason: 'gerber' },
    gbl:        { process: 'pcb-manufacturing', confidence: 0.90, reason: 'gerber' },
    gtl:        { process: 'pcb-manufacturing', confidence: 0.90, reason: 'gerber' },
    drl:        { process: 'pcb-manufacturing', confidence: 0.85, reason: 'gerber' },
    brd:        { process: 'pcb-manufacturing', confidence: 0.80, reason: 'pcb' },
    sch:        { process: 'pcb-manufacturing', confidence: 0.70, reason: 'pcb' },
    kicad_pcb:  { process: 'pcb-manufacturing', confidence: 0.95, reason: 'kicad' }
  };

  /* A solid model carries no clue about which machine should make it. */
  const AMBIGUOUS = {
    step:   ['cnc-machining', '3d-printing'],
    stp:    ['cnc-machining', '3d-printing'],
    iges:   ['cnc-machining', '3d-printing'],
    igs:    ['cnc-machining', '3d-printing'],
    sldprt: ['cnc-machining', '3d-printing'],
    ipt:    ['cnc-machining', '3d-printing'],
    f3d:    ['cnc-machining', '3d-printing']
  };

  const rulesProvider = {
    async classifyProject(payload) {
      const ext = payload.ext;

      if (!ext) {
        return emptyResult('rules', [{ key: 'ai.reason.noExtension' }]);
      }

      if (BY_EXTENSION[ext]) {
        const hit = BY_EXTENSION[ext];
        return {
          ok: true,
          process: hit.process,
          alternatives: [],
          confidence: hit.confidence,
          reasons: [
            { key: 'ai.reason.' + hit.reason, vars: { ext: ext } },
            { key: 'ai.reason.extensionOnly' }
          ],
          source: 'rules'
        };
      }

      if (AMBIGUOUS[ext]) {
        return {
          ok: true,
          process: null,
          alternatives: AMBIGUOUS[ext].slice(),
          confidence: 0,
          reasons: [
            { key: 'ai.reason.ambiguous', vars: { ext: ext } },
            { key: 'ai.reason.extensionOnly' }
          ],
          source: 'rules'
        };
      }

      return emptyResult('rules', [
        { key: 'ai.reason.unknown', vars: { ext: ext } },
        { key: 'ai.reason.extensionOnly' }
      ]);
    }
  };

  registerProvider('rules', rulesProvider);

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
      sizeBytes: (file && file.size) || 0,
      hash:      await hashFile(file),
      processes: opts.processes || []
    };
    const description = opts.description || '';
    const descHash    = hashText(description);

    /* Cache before analysis, as the brief requires: a file already
       answered is never analysed again. The decision is still logged,
       because a decision is an event even when the answer was free. */
    let result = null;
    let cached = false;

    if ((c.cache || {}).enabled && meta.hash && window.DataStore) {
      try {
        const prior = await DataStore.findClassification(meta.hash, descHash);
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

    if (!result) {
      const payload = buildPayload(meta, opts.features, description);

      /* Belt and braces. buildPayload cannot leak the file, but if a
         future edit makes it possible, refuse rather than send. */
      if (payload.file || payload.bytes || payload.name) {
        throw new Error('[ai] payload must never carry the file itself');
      }

      const chain  = providerChain();
      const errors = [];

      for (const name of chain) {
        try {
          const r = await registry[name].classifyProject(payload);
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
    result.fileHash   = meta.hash;
    result.fileExt    = meta.ext;
    result.fileSize   = meta.sizeBytes;
    result.descHash   = descHash;

    /* Logged here, so no caller can skip it. */
    if (window.DataStore && DataStore.logClassification) {
      try {
        const logged = await DataStore.logClassification({
          fileHash:   meta.hash,
          fileExt:    meta.ext,
          fileSize:   meta.sizeBytes,
          descHash:   descHash,
          description: description,
          features:   opts.features || {},
          suggested:  result.process,
          alternatives: result.alternatives || [],
          confidence: result.confidence || 0,
          reasons:    result.reasons || [],
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
