/* ── Local model provider (Stage 5 — an experiment) ────────
   Registers `local` with AIService: a small sentence-embedding model
   that runs on the visitor's own device, with no network call at
   classification time and no data leaving the browser.

   ── This is an experiment, and it is off ──
   `providers.local.enabled` is false in ai-config.js. Nothing here
   downloads, runs or costs anything until someone deliberately turns
   it on. It earns its place in the chain by beating the rules on the
   logged history (see benchmark() and /dashboard/admin/ai/), or it
   does not get one.

   ── It must never block the page ──
   Two rules, and both matter:

   1. classifyProject() returns immediately when the model is not
      loaded. It never triggers a download mid-classification. A
      client waiting 25 MB for an answer the rules already had is a
      worse product than no local model.
   2. The library is imported dynamically, only when load() is
      called. The <script> tag costs nothing but a registration.

   ── What it actually does ──
   Sentence embeddings, not a trained classifier. The part is
   described as a short sentence, each process is described from
   data/processes.json (its name and the materials it accepts), and
   the closest one wins by cosine similarity.

   That is a weak method and it is chosen on purpose: it needs no
   training data, no labelling and no server, and it is honest about
   being a similarity score. A cosine margin is NOT a probability —
   see confidenceFrom() for why that distinction is load-bearing.

   ── Privacy ──
   Inference is local, so the consent gate does not apply: ai.js
   already treats a provider declared `local: true` as one that may
   see the description, because nothing is transmitted.

   The model FILES are fetched from a CDN and from huggingface.co on
   first load. That is a download, not an upload — but it is still a
   third party learning that this browser asked for this model, and
   the opt-in says so rather than burying it. */

(function () {

  if (!window.AIService) return;

  const cfg  = () => (window.AI_CONFIG || {});
  const conf = () => (cfg().localModel || {});

  let state    = 'idle';        /* idle | loading | ready | failed */
  let extractor = null;
  let labelVecs = null;
  let lastError = null;
  let loadedAt  = null;

  /* ── loading ─────────────────────────────────────────── */

  /* Pinned. A floating version would let a CDN update change what
     runs on a client's machine without a commit here. */
  function libUrl() {
    return conf().lib || 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
  }

  async function load(onProgress) {
    if (state === 'ready')   return { ok: true, cached: true };
    if (state === 'loading') return { ok: false, reason: 'already_loading' };

    state = 'loading';
    lastError = null;
    const started = Date.now();

    try {
      const mod = await import(/* webpackIgnore: true */ libUrl());

      /* No local model server, and no attempt to reach one: without
         this the library probes a /models/ path on this origin first
         and every load eats a 404 round trip. */
      if (mod.env) {
        mod.env.allowLocalModels = false;
        mod.env.useBrowserCache  = true;
      }

      extractor = await mod.pipeline(
        'feature-extraction',
        conf().model || 'Xenova/all-MiniLM-L6-v2',
        {
          quantized: conf().quantized !== false,
          progress_callback: (p) => {
            if (typeof onProgress === 'function') {
              try { onProgress(p); } catch (e) { /* a reporter must not break a load */ }
            }
          }
        }
      );

      labelVecs = await buildLabelVectors();
      if (!labelVecs || !labelVecs.length) throw new Error('no process labels to compare against');

      state = 'ready';
      loadedAt = Date.now();
      return { ok: true, ms: Date.now() - started, labels: labelVecs.length };

    } catch (err) {
      /* A blocked CDN, an offline device, a browser without the WASM
         features the runtime needs. All of them are "no local model
         today", never an exception into a caller. */
      state = 'failed';
      extractor = null;
      labelVecs = null;
      lastError = String((err && err.message) || err);
      return { ok: false, reason: lastError };
    }
  }

  function unload() {
    extractor = null;
    labelVecs = null;
    state = 'idle';
    lastError = null;
    loadedAt = null;
  }

  /* ── embedding ───────────────────────────────────────── */

  async function embed(text) {
    const out = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }

  /* Both vectors are normalised, so the dot product IS the cosine. */
  function cosine(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  /* The processes describe themselves, out of data/processes.json —
     name plus the materials each one accepts. Hardcoding a sentence
     per process here would put a second, drifting copy of the
     configuration in a service file. */
  async function buildLabelVectors() {
    const data = await ProcessCascade.load();
    const out = [];
    for (const p of data.processes) {
      const materials = (p.materials || []).slice(0, 8)
        .map((m) => m.label.en).join(', ');
      const text = p.label.en + '. Manufacturing process'
        + (materials ? '. Typical materials: ' + materials : '') + '.';
      out.push({ key: p.key, text: text, vec: await embed(text) });
    }
    return out;
  }

  /* ── the part, as a sentence ─────────────────────────── */

  /* The same payload the remote providers get, turned into prose.
     Written as plain language rather than as a feature dump because
     the model was trained on sentences, and "a flat 3 mm aluminium
     part" is closer to its training distribution than
     "isFlat=true;thicknessMm=3". */
  function describePart(payload) {
    const f     = payload.features || {};
    const bits  = [];

    if (payload.description) bits.push(payload.description.trim());

    if (payload.materialClass) bits.push('Made of ' + payload.materialClass + '.');
    if (f.materialClass && !payload.materialClass) bits.push('Made of ' + f.materialClass + '.');

    if (f.profileOnly || f.fileKind === 'profile') {
      bits.push('A flat two-dimensional outline with no thickness.');
    } else if (f.isFlat) {
      bits.push('A flat plate'
        + (typeof f.thicknessMm === 'number' ? ' about ' + f.thicknessMm.toFixed(1) + ' mm thick' : '')
        + '.');
    }

    if (f.fileKind === 'pcb') bits.push('A printed circuit board.');
    if (f.fileKind === 'solid') bits.push('A solid CAD model.');
    if (f.fileKind === 'mesh' && !f.isFlat) bits.push('A three-dimensional shaped part.');

    if (typeof f.boundingBoxMaxMm === 'number') {
      bits.push('About ' + Math.round(f.boundingBoxMaxMm) + ' mm across.');
    }
    if (typeof payload.toleranceMm === 'number') {
      bits.push('Tolerance ' + payload.toleranceMm + ' mm.');
    } else if (typeof f.toleranceMm === 'number') {
      bits.push('Tolerance ' + f.toleranceMm + ' mm.');
    }
    if (payload.ext) bits.push('Supplied as a ' + payload.ext.toUpperCase() + ' file.');

    return bits.join(' ').trim();
  }

  /* ── similarity → confidence ─────────────────────────── */

  /* A cosine similarity is not a probability, and presenting one as
     a probability is the whole failure mode of this kind of model:
     the top label always has *some* similarity, so a number near 1
     appears for a part the model knows nothing about.

     So confidence comes from the MARGIN over the runner-up — how
     much more like laser cutting than like anything else — and it is
     capped below the hand-written rules' own scores. A local model
     that has not been shown to beat the rules does not get to
     outrank them. */
  function confidenceFrom(top, second) {
    const c      = conf();
    const cap    = typeof c.confidenceCap === 'number' ? c.confidenceCap : 0.6;
    const scale  = typeof c.marginScale   === 'number' ? c.marginScale   : 4;
    const margin = Math.max(0, top - second);
    return Math.max(0, Math.min(cap, Math.round(margin * scale * 100) / 100));
  }

  async function rank(payload) {
    const text = describePart(payload);
    if (text.length < 8) return { ok: false, reason: 'nothing_to_describe' };

    const vec = await embed(text);
    const allowed = payload.processes && payload.processes.length
      ? new Set(payload.processes) : null;

    const scored = labelVecs
      .filter((l) => !allowed || allowed.has(l.key))
      .map((l) => ({ key: l.key, score: cosine(vec, l.vec) }))
      .sort((a, b) => b.score - a.score);

    if (!scored.length) return { ok: false, reason: 'no_candidates' };
    return { ok: true, scored: scored, text: text };
  }

  /* ── the provider ────────────────────────────────────── */

  const provider = {
    async classifyProject(payload) {
      const started = Date.now();

      /* Never downloads here. An unloaded model is a provider that
         is not available right now, exactly like one that is down,
         and ai.js moves on to the next. */
      if (state !== 'ready') {
        return { ok: false, reason: state === 'failed' ? 'model_failed' : 'model_not_loaded' };
      }

      let r;
      try {
        r = await rank(payload);
      } catch (err) {
        return { ok: false, reason: String((err && err.message) || err) };
      }
      if (!r.ok) return { ok: false, reason: r.reason };

      const top    = r.scored[0];
      const second = r.scored[1] ? r.scored[1].score : 0;
      const confidence = confidenceFrom(top.score, second);

      /* Below the floor it has nothing useful to say, and saying it
         anyway is how an experiment starts costing accuracy. */
      const floor = typeof conf().minConfidence === 'number' ? conf().minConfidence : 0.12;
      if (confidence < floor) {
        return { ok: false, reason: 'below_floor' };
      }

      return {
        ok: true,
        source: 'local',
        model: conf().model || 'Xenova/all-MiniLM-L6-v2',
        process: top.key,
        alternatives: r.scored.slice(1, 3).map((s) => s.key),
        confidence: confidence,
        reasons: [{
          en: 'A small model running on this device found this the closest match ('
              + top.score.toFixed(2) + ' against ' + second.toFixed(2) + ' for the next).',
          ar: 'نموذج صغير يعمل على هذا الجهاز وجد هذا أقرب تطابق ('
              + top.score.toFixed(2) + ' مقابل ' + second.toFixed(2) + ' للتالي).'
        }],
        latencyMs: Date.now() - started,
        /* Nothing was sent anywhere, so nothing was spent. */
        tokensIn: 0, tokensOut: 0
      };
    }
  };

  AIService.registerProvider('local', provider);

  /* ── benchmark ───────────────────────────────────────── */

  /* Does it actually beat the rules? Run both over the same logged
     rows and compare against what the human chose.

     Only rows the RULES answered are eligible, because only for
     those is `suggested_process` the rules' own prediction — for a
     row a remote provider answered, the rules' answer was overwritten
     and is not recoverable from the log. Scoring the model against a
     mixed bag and calling the result "versus the rules" would be
     comparing it to something that is not the rules. */
  async function benchmark(rows, onTick) {
    if (state !== 'ready') return { ok: false, reason: 'model_not_loaded' };

    const eligible = (rows || []).filter((r) =>
      r.decided_at && r.final_process && r.source === 'rules');

    if (!eligible.length) return { ok: false, reason: 'no_eligible_rows' };

    let modelRight = 0, rulesRight = 0, modelAnswered = 0, skipped = 0;
    const demo = eligible.filter((r) => r.demo).length;
    const disagreements = [];

    for (let i = 0; i < eligible.length; i++) {
      const row = eligible[i];
      const payload = {
        ext: row.file_ext || '',
        features: row.features || {},
        description: row.description || '',
        processes: labelVecs.map((l) => l.key)
      };

      if ((row.suggested_process || null) === row.final_process) rulesRight++;

      let out = null;
      try { out = await provider.classifyProject(payload); } catch (e) { out = null; }

      if (!out || !out.ok) {
        skipped++;
      } else {
        modelAnswered++;
        if (out.process === row.final_process) modelRight++;
        else disagreements.push({
          id: row.id, chose: row.final_process,
          model: out.process, rules: row.suggested_process,
          confidence: out.confidence
        });
      }

      if (typeof onTick === 'function' && i % 5 === 0) {
        try { onTick(i + 1, eligible.length); } catch (e) { /* reporter */ }
      }
    }

    return {
      ok: true,
      rows: eligible.length,
      demoRows: demo,
      modelAnswered: modelAnswered,
      skipped: skipped,
      /* Two denominators on purpose. Scoring the model only on the
         rows it chose to answer flatters it — a model that answers
         one question and gets it right is not 100% accurate. */
      modelAccuracyAnswered: modelAnswered ? modelRight / modelAnswered : 0,
      modelAccuracyAll: modelRight / eligible.length,
      rulesAccuracy: rulesRight / eligible.length,
      modelRight: modelRight,
      rulesRight: rulesRight,
      disagreements: disagreements.slice(0, 25)
    };
  }

  window.LocalModel = {
    status: () => ({
      state: state,
      error: lastError,
      model: conf().model || 'Xenova/all-MiniLM-L6-v2',
      approxMB: conf().approxDownloadMB || 25,
      loadedAt: loadedAt,
      enabled: !!((cfg().providers || {}).local || {}).enabled
    }),
    load: load,
    unload: unload,
    benchmark: benchmark,
    describePart: describePart,

    /* Flips the provider on for this session. Persisting the choice
       is the caller's business (DataStore.setLocalModelOptIn) — this
       function only decides whether the chain may use it. */
    setEnabled(on) {
      const c = cfg();
      if (!c.providers || !c.providers.local) return false;
      c.providers.local.enabled = !!on;
      return true;
    }
  };

})();
