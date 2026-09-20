/* ── Rule-based classifier ─────────────────────────────────
   Free forever, offline, and the floor the provider chain can never
   fall through. Registers itself as `rules`, so ai.js does not know
   this file exists beyond the name in its config.

   ── Everything it decides comes from data ──
   data/classification-rules.json holds the conditions, the thresholds
   and the reason keys. Tuning the classifier is editing that file.

   Conditions are declarative — a feature name, an operator and a
   value — never expressions. No eval, no Function(), nothing that
   turns a data file into an execution path. A malformed rule is
   skipped and logged; a malformed file leaves the extension rules
   working on their own. The worst a bad edit can do is make the
   classifier less sure, never break the page.

   ── How conflicts resolve ──
   Every matching rule is collected rather than the first one winning.
   If they agree on a process, that is the answer and agreement raises
   the confidence slightly. If they disagree, the answer becomes "not
   sure" with the candidates listed, because the honest output of a
   tie is a question. A silently broken tie is how a classifier earns
   distrust, and one wrong confident answer costs more trust than ten
   honest questions. */

(function () {

  if (!window.AIService) return;

  const RULES_URL = '/data/classification-rules.json';

  /* Extension mapping stays here: it needs no geometry, it answers
     instantly, and for a Gerber or a KiCad board it is not a guess —
     the format only exists for one process. */
  const BY_EXTENSION = {
    gbr:       { process: 'pcb-manufacturing', confidence: 0.95, reason: 'gerber', kind: 'pcb' },
    gbl:       { process: 'pcb-manufacturing', confidence: 0.95, reason: 'gerber', kind: 'pcb' },
    gtl:       { process: 'pcb-manufacturing', confidence: 0.95, reason: 'gerber', kind: 'pcb' },
    gts:       { process: 'pcb-manufacturing', confidence: 0.95, reason: 'gerber', kind: 'pcb' },
    gbs:       { process: 'pcb-manufacturing', confidence: 0.95, reason: 'gerber', kind: 'pcb' },
    gto:       { process: 'pcb-manufacturing', confidence: 0.95, reason: 'gerber', kind: 'pcb' },
    drl:       { process: 'pcb-manufacturing', confidence: 0.9,  reason: 'gerber', kind: 'pcb' },
    kicad_pcb: { process: 'pcb-manufacturing', confidence: 0.95, reason: 'kicad',  kind: 'pcb' },
    brd:       { process: 'pcb-manufacturing', confidence: 0.8,  reason: 'pcb',    kind: 'pcb' },
    sch:       { process: 'pcb-manufacturing', confidence: 0.7,  reason: 'pcb',    kind: 'pcb' },

    dxf: { process: 'laser-cutting', confidence: 0.7, reason: 'flat', kind: 'flat2d' },
    svg: { process: 'laser-cutting', confidence: 0.6, reason: 'flat', kind: 'flat2d' },
    ai:  { process: 'laser-cutting', confidence: 0.5, reason: 'flat', kind: 'flat2d' },

    stl:   { process: '3d-printing', confidence: 0.6, reason: 'mesh',  kind: 'mesh' },
    '3mf': { process: '3d-printing', confidence: 0.6, reason: 'mesh',  kind: 'mesh' },
    obj:   { process: '3d-printing', confidence: 0.5, reason: 'mesh',  kind: 'mesh' },
    gcode: { process: '3d-printing', confidence: 0.9, reason: 'gcode', kind: 'unknown' },

    /* A solid model says nothing about the machine that should make
       it, so the extension deliberately yields no process. The
       geometry decides, or the user does. */
    step:   { process: null, confidence: 0, reason: 'ambiguous', kind: 'solid',
              alternatives: ['cnc-machining', '3d-printing'] },
    stp:    { process: null, confidence: 0, reason: 'ambiguous', kind: 'solid',
              alternatives: ['cnc-machining', '3d-printing'] },
    iges:   { process: null, confidence: 0, reason: 'ambiguous', kind: 'solid',
              alternatives: ['cnc-machining', '3d-printing'] },
    igs:    { process: null, confidence: 0, reason: 'ambiguous', kind: 'solid',
              alternatives: ['cnc-machining', '3d-printing'] },
    sldprt: { process: null, confidence: 0, reason: 'ambiguous', kind: 'solid',
              alternatives: ['cnc-machining', '3d-printing'] },
    ipt:    { process: null, confidence: 0, reason: 'ambiguous', kind: 'solid',
              alternatives: ['cnc-machining', '3d-printing'] },
    f3d:    { process: null, confidence: 0, reason: 'ambiguous', kind: 'solid',
              alternatives: ['cnc-machining', '3d-printing'] }
  };

  /* A .zip that carries Gerbers is a board, and it is the commonest
     way a client sends one. Decided by name because reading the
     archive would mean another dependency for one hint. */
  const GERBER_ZIP = /(gerber|fabrication|fab[-_ ]?out|cam)/i;

  let cache = null;

  async function config() {
    if (cache) return cache;
    try {
      const res = await fetch(RULES_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      cache = await res.json();
    } catch (err) {
      /* No rule file, no crash: the extension table alone still
         answers, just with less nuance. */
      if (window.console) console.warn('[rules] classification-rules.json unavailable', err);
      cache = { settings: {}, rules: [], warnings: [], degraded: true };
    }
    return cache;
  }

  /* ── the condition evaluator ─────────────────────────── */

  /* One clause: { feature, <operator>: value }. Unknown operators and
     unknown features return false rather than throwing, so a typo in
     the data file costs a rule, not the page. */
  function testClause(clause, features) {
    if (!clause || typeof clause.feature !== 'string') return false;
    const actual = features[clause.feature];

    if ('exists' in clause) {
      const present = actual !== undefined && actual !== null && actual !== '';
      return clause.exists ? present : !present;
    }

    /* `ne` is answered BEFORE the missing-value guard, because absent
       genuinely is "not equal to". Folding it in with the others made
       "profileOnly ne true" fail on every mesh — a mesh has no such
       flag — which silently disabled the thin-wall warning on exactly
       the parts it exists to catch. A negative test that cannot fire
       is worse than no test, because it looks like it passed. */
    if ('ne' in clause) return actual !== clause.ne;

    /* Every other comparison needs a value. Treating absent as zero
       would make "tolerance under 0.1" fire on every file where the
       client never stated one. */
    if (actual === undefined || actual === null) return false;

    if ('eq'  in clause) return actual === clause.eq;
    if ('in'  in clause) return Array.isArray(clause.in) && clause.in.indexOf(actual) !== -1;

    if ('lt'  in clause) return typeof actual === 'number' && actual <  clause.lt;
    if ('lte' in clause) return typeof actual === 'number' && actual <= clause.lte;
    if ('gt'  in clause) return typeof actual === 'number' && actual >  clause.gt;
    if ('gte' in clause) return typeof actual === 'number' && actual >= clause.gte;

    return false;
  }

  function testWhen(when, features) {
    if (!when) return false;
    if (Array.isArray(when.all)) return when.all.every((c) => testClause(c, features));
    if (Array.isArray(when.any)) return when.any.some((c) => testClause(c, features));
    return false;
  }

  /* ── classify ────────────────────────────────────────── */

  async function classifyProject(payload) {
    const cfg      = await config();
    const settings = cfg.settings || {};
    const ext      = payload.ext || '';
    const hint     = BY_EXTENSION[ext];

    /* The features a rule may read: what the geometry measured, plus
       what the client told us, plus the file's own identity. */
    const features = Object.assign({
      hasGeometry: false,
      bodyCount: null,
      materialClass: null,
      toleranceMm: null
    }, payload.features || {}, {
      extension: ext,
      fileKind: (hint && hint.kind)
        || (window.GeometryService ? GeometryService.kindOf(ext) : 'unknown')
    });

    if (payload.materialClass) features.materialClass = payload.materialClass;
    if (typeof payload.toleranceMm === 'number') features.toleranceMm = payload.toleranceMm;

    /* A zip named like a fabrication package is a board. */
    if (ext === 'zip' && GERBER_ZIP.test(payload.baseName || '')) {
      features.fileKind = 'pcb';
    }

    const reasons = [];
    const matched = [];

    /* ── the extension's own opinion ── */
    if (hint) {
      if (hint.process) {
        matched.push({
          kind: 'prior',
          id: 'ext-' + ext,
          process: hint.process,
          alternatives: hint.alternatives || [],
          confidence: hint.confidence,
          reasonKey: 'ai.reason.' + hint.reason
        });
      }
      reasons.push({ key: 'ai.reason.' + hint.reason, vars: { ext: ext } });
    } else if (features.fileKind === 'pcb') {
      matched.push({
        kind: 'prior',
        id: 'ext-zip-gerber', process: 'pcb-manufacturing',
        alternatives: [], confidence: 0.75, reasonKey: 'ai.reason.gerberZip'
      });
      reasons.push({ key: 'ai.reason.gerberZip' });
    } else if (!ext) {
      reasons.push({ key: 'ai.reason.noExtension' });
    } else {
      reasons.push({ key: 'ai.reason.unknown', vars: { ext: ext } });
    }

    /* ── the data-driven rules ── */
    (cfg.rules || []).forEach((rule) => {
      if (!rule || !rule.when || !rule.then) return;
      if (!testWhen(rule.when, features)) return;
      matched.push({
        kind: 'rule',
        id: rule.id,
        process: rule.then.process,
        alternatives: rule.then.alternatives || [],
        confidence: typeof rule.then.confidence === 'number' ? rule.then.confidence : 0.5,
        reasonKey: rule.reason
      });
      if (rule.reason) reasons.push({ key: rule.reason, vars: features });
    });

    /* ── warnings, which never change the process ── */
    const warnings = [];
    (cfg.warnings || []).forEach((w) => {
      if (!w || !w.when) return;
      if (!testWhen(w.when, features)) return;
      warnings.push({ id: w.id, key: w.reason, severity: w.severity || 'warn', vars: features });
    });

    /* ── resolve ──────────────────────────────────────────
       The extension is a PRIOR, not a peer. ".stl" says something
       about the exporter the client used; a measured 3 mm constant
       section says something about the part. Weighing those equally
       would mean every flat plate exported as STL came back as "the
       rules disagree, you decide" — which is the classifier refusing
       to do the one job Stage 2 exists for.

       So: if any rule from the data file decided, those rules alone
       resolve it, and the extension's opinion demotes to an
       alternative. Only when no rule fired does the prior answer.
       Conflict detection then means genuine disagreement between
       measurements, which is worth asking about. */
    const deciding = matched.filter((m) => m.process);
    const fromRules = deciding.filter((m) => m.kind === 'rule');
    const fromPrior = deciding.filter((m) => m.kind !== 'rule');
    const pool      = fromRules.length ? fromRules : fromPrior;
    const overruled = fromRules.length && fromPrior.length
      ? fromPrior[0].process
      : null;

    if (!deciding.length) {
      /* Nothing decided. Offer whatever the extension thought
         plausible so the user is choosing, not typing. */
      return {
        ok: true,
        process: null,
        alternatives: (hint && hint.alternatives) || [],
        confidence: 0,
        reasons: reasons.concat(
          features.hasGeometry ? [] : [{ key: 'ai.reason.noGeometry' }]),
        warnings: warnings,
        features: features,
        source: 'rules'
      };
    }

    const processes = Array.from(new Set(pool.map((m) => m.process)));

    if (processes.length > 1) {
      /* Genuine disagreement between measurements. Say so. */
      const byConf = pool.slice().sort((a, b) => b.confidence - a.confidence);
      return {
        ok: true,
        process: null,
        alternatives: processes,
        confidence: settings.conflictConfidence || 0.2,
        reasons: reasons.concat([{
          key: 'ai.reason.conflict',
          vars: { count: processes.length }
        }]),
        warnings: warnings,
        features: features,
        matchedRules: byConf.map((m) => m.id),
        source: 'rules'
      };
    }

    /* Unanimous. Several independent rules reaching the same
       conclusion is weak evidence, so the bonus is small. */
    const best  = pool.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    const bonus = pool.length > 1 ? (settings.agreementConfidenceBonus || 0.05) : 0;

    /* What the extension thought becomes the second opinion, which is
       exactly what an alternative is for. It may have been overruled
       by a measurement or by something the client told us — the
       reason key stays neutral about which, because both happen. */
    const alternatives = Array.from(new Set(
      pool.reduce((acc, m) => acc.concat(m.alternatives || []), [])
          .concat(overruled ? [overruled] : [])
    )).filter((p) => p !== best.process);

    if (overruled) reasons.push({ key: 'ai.reason.geometryOverrides' });

    return {
      ok: true,
      process: best.process,
      alternatives: alternatives,
      confidence: Math.min(0.99, best.confidence + bonus),
      reasons: reasons,
      warnings: warnings,
      features: features,
      matchedRules: pool.map((m) => m.id),
      overruledPrior: overruled,
      source: 'rules'
    };
  }

  AIService.registerProvider('rules', { classifyProject: classifyProject });

  /* Exposed so the panel can read thresholds, and so a tuning session
     can reload the file without a page refresh. */
  window.RulesProvider = {
    config: config,
    reload: () => { cache = null; return config(); },
    extensions: () => Object.keys(BY_EXTENSION)
  };

})();
