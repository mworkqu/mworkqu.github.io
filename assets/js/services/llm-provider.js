/* ── LLM providers (via the proxy) ─────────────────────────
   Registers `gemini`, `groq` and `openrouter` with AIService. All
   three are the same three lines of code: post the structured payload
   to the proxy and hand back what comes out. The differences between
   the APIs live in proxy/worker.js, where the keys are.

   ── Nothing here holds a secret, and nothing here can ──
   This file is served to every visitor as plain text. It knows the
   proxy's public URL and nothing else. If you ever find yourself
   wanting an API key in this file, the answer is a new route on the
   worker instead.

   ── The model's answer is untrusted input ──
   The worker validates it, and so does this file. That is not
   duplication for its own sake: the worker protects the keys, this
   protects the page. A process key that is not one of ours is
   dropped rather than rendered, because a hallucinated
   "laser_cnc_hybrid" reaching the confirmation panel would look
   exactly like a real suggestion.

   ── Local test mode ──
   With `proxy.mock: true` in ai-config.js this answers from a canned
   result without any network at all, so the escalation path, the
   fallback chain and the caps can all be exercised before a proxy
   exists. It is clearly labelled in its own reasons — a test double
   that cannot be told apart from the real thing is a trap. */

(function () {

  if (!window.AIService) return;

  const cfg   = () => (window.AI_CONFIG || {});
  const proxy = () => (cfg().proxy || {});

  const NAMES = ['gemini', 'groq', 'openrouter'];

  /* ── validation, again ───────────────────────────────── */

  function sanitise(raw, allowedProcesses) {
    if (!raw || typeof raw !== 'object') return null;
    const allowed = new Set(allowedProcesses || []);

    let process = raw.process;
    if (process === '' || process === 'null' || process === undefined) process = null;
    if (process !== null && !allowed.has(process)) return null;

    const alternatives = Array.isArray(raw.alternatives)
      ? raw.alternatives.filter((a) => allowed.has(a) && a !== process).slice(0, 4)
      : [];

    let confidence = Number(raw.confidence);
    if (!isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, confidence));

    /* Reasons arrive as { en, ar } pairs rather than i18n keys — a
       model writes sentences, not keys. AIService.describeReason
       renders the pair through I18n.pick, so a stored LLM answer
       still re-reads in either language on a switch, which is the
       same guarantee the rule reasons give. */
    const reasons = (Array.isArray(raw.reasons) ? raw.reasons : [])
      .map((r) => {
        if (!r || typeof r !== 'object') return null;
        const en = typeof r.en === 'string' ? r.en.trim() : '';
        const ar = typeof r.ar === 'string' ? r.ar.trim() : '';
        return (en || ar) ? { en: en || ar, ar: ar || en } : null;
      })
      .filter(Boolean)
      .slice(0, 4);

    return { process, alternatives, confidence, reasons };
  }

  /* ── the mock ────────────────────────────────────────── */

  function mockAnswer(payload) {
    const f    = payload.features || {};
    const text = (payload.description || '').toLowerCase();
    const has  = (s) => text.indexOf(s) !== -1;

    let process = null;
    let confidence = 0.35;

    /* Order matters, and the specific beats the incidental: "an
       enclosure for a sensor board" is an enclosure, not a board.
       Checking for 'board' first would make this double answer PCB
       for a printed box, which is not what a real model would say and
       would make the mock misleading rather than merely crude. */
    if (has('enclosure') || has('housing') || has('waterproof') || has('casing')) {
      process = '3d-printing'; confidence = 0.7;
    } else if (has('pcb') || has('circuit') || has('board')) {
      process = 'pcb-manufacturing'; confidence = 0.8;
    } else if (has('bracket') || has('aluminium') || has('aluminum') || has('metal')) {
      process = 'cnc-machining'; confidence = 0.72;
    } else if (has('panel') || has('sheet') || has('plate') || f.isFlat) {
      process = 'laser-cutting'; confidence = 0.68;
    }

    return {
      process: process,
      alternatives: process ? [] : ['cnc-machining', '3d-printing'],
      confidence: confidence,
      reasons: [{
        en: 'Local mock — no model was called. Turn off proxy.mock in ai-config.js for real answers.',
        ar: 'محاكاة محلية — لم يُستدعَ أي نموذج. عطّل proxy.mock في ai-config.js للحصول على إجابات حقيقية.'
      }]
    };
  }

  /* ── one adapter, three registrations ────────────────── */

  function makeProvider(name) {
    return {
      async classifyProject(payload) {
        const started = Date.now();
        const allowed = payload.processes || [];

        if (proxy().mock) {
          const result = sanitise(mockAnswer(payload), allowed);
          if (!result) return { ok: false, reason: 'invalid_mock' };
          return Object.assign({}, result, {
            ok: true, source: name, model: 'mock',
            latencyMs: Date.now() - started, mocked: true
          });
        }

        const url = proxy().url;
        if (!url) return { ok: false, reason: 'no_proxy_url', status: 0 };

        let res, body;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), proxy().timeoutMs || 20000);
          res = await fetch(url.replace(/\/+$/, '') + '/classify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              provider: name,
              tenant: window.DataStore ? DataStore.tenantId() : null,
              payload: payload
            }),
            signal: controller.signal
          });
          clearTimeout(timer);
          body = await res.json().catch(() => null);
        } catch (err) {
          /* A network failure, a CORS refusal or a timeout. Reported,
             never thrown — ai.js moves to the next provider and, in
             the end, to the rules answer. */
          return {
            ok: false, reason: String((err && err.name === 'AbortError') ? 'timeout' : (err && err.message) || err),
            status: 0, latencyMs: Date.now() - started
          };
        }

        if (!res.ok || !body || !body.ok) {
          return {
            ok: false,
            reason: (body && body.error) || ('http_' + res.status),
            status: res.status,
            latencyMs: Date.now() - started
          };
        }

        const result = sanitise(body.result, allowed);
        if (!result) {
          return { ok: false, reason: 'invalid_model_output', status: 502,
                   latencyMs: Date.now() - started };
        }

        return Object.assign({}, result, {
          ok: true,
          source: name,
          model: body.model || null,
          latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : (Date.now() - started),
          tokensIn: body.tokensIn || 0,
          tokensOut: body.tokensOut || 0,
          retried: !!body.retried
        });
      }
    };
  }

  NAMES.forEach((name) => AIService.registerProvider(name, makeProvider(name)));

  /* Lets the panel and any future admin page report what the proxy
     actually has configured, rather than what config hopes it has. */
  window.LLMProvider = {
    names: () => NAMES.slice(),
    async health() {
      if (proxy().mock) return { ok: true, mock: true, providers: NAMES.slice(), local: true };
      if (!proxy().url) return { ok: false, error: 'no_proxy_url' };
      try {
        const res = await fetch(proxy().url.replace(/\/+$/, '') + '/health');
        return await res.json();
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
      }
    }
  };

})();
