/* ── Classification proxy (Cloudflare Worker) ──────────────
   GitHub Pages serves static files and cannot hold a secret, so the
   API keys live here and nowhere else. The browser never sees one.

   ── This is NOT a chat proxy ──
   It accepts a STRUCTURED payload — extension, measured features, a
   description, the list of processes — and builds the prompt itself.
   It will not forward an arbitrary prompt. That distinction is the
   whole security model: a worker that relays whatever it is given is
   a free LLM for anyone who finds the URL, billed to us. Everything
   that reaches a model is assembled below, from fields that are
   validated first.

   ── Guards, in order of how much work they do ──
   1. Origin allow-list. The caller is a browser, so Origin is set by
      the browser and cannot be forged by page script. This is the
      guard that actually stops casual abuse.
   2. Payload validation. Unknown fields are dropped, not passed on.
   3. Daily counter in KV, if a KV namespace is bound. Quantitative,
      and optional — without it the cap is advisory and the worker
      says so at /health rather than pretending.

   ── Providers ──
   Groq and OpenRouter are OpenAI-compatible and share one adapter.
   Gemini has its own request shape and its own. Adding a provider is
   a row in PROVIDERS plus a secret.

   Deployment and local testing: see proxy/README.md */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/* The answer shape the browser expects. Kept in step with
   AIService.classifyProject()'s return value. */
const MAX_REASONS = 4;

/* ── providers ─────────────────────────────────────────── */

const PROVIDERS = {
  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-2.0-flash',
    call: callGemini
  },
  groq: {
    keyEnv: 'GROQ_API_KEY',
    modelEnv: 'GROQ_MODEL',
    defaultModel: 'llama-3.3-70b-versatile',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    call: callOpenAICompatible
  },
  openrouter: {
    keyEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    call: callOpenAICompatible
  }
};

/* ── the prompt ────────────────────────────────────────── */

const SYSTEM_PROMPT = [
  'You classify manufacturing jobs for an engineering studio.',
  'You are given measurements taken from a CAD file and, sometimes, a',
  'short description written by the client. Decide which single',
  'manufacturing process fits best.',
  '',
  'Rules you must follow:',
  '- Choose only from the process keys you are given. Never invent one.',
  '- If the evidence does not settle it, return null for "process" and',
  '  list the plausible keys in "alternatives". Saying you do not know',
  '  is a correct answer and is preferred over a confident guess.',
  '- "confidence" is 0 to 1 and must reflect the evidence you were',
  '  actually given, not how fluent your answer sounds.',
  '- Give at most ' + MAX_REASONS + ' reasons. Each reason is one short',
  '  sentence, written in BOTH English and Arabic, and must refer to',
  '  something in the input — a dimension, a material, a tolerance.',
  '  Do not invent measurements that were not provided.',
  '- Reply with JSON only. No prose, no code fences.'
].join('\n');

function buildUserPrompt(payload) {
  const lines = ['Processes you may choose from:'];
  (payload.processes || []).forEach((p) => {
    const mats = (payload.materials && payload.materials[p]) || [];
    lines.push('- ' + p + (mats.length ? ' (materials: ' + mats.join(', ') + ')' : ''));
  });

  lines.push('', 'File type: ' + (payload.ext ? '.' + payload.ext : 'none given'));

  const f = payload.features || {};
  if (f.hasGeometry) {
    lines.push('Measured geometry (millimetres):');
    if (f.boundingBoxXMm !== undefined) {
      lines.push('- bounding box: ' + f.boundingBoxXMm + ' x ' + f.boundingBoxYMm + ' x ' + f.boundingBoxZMm);
    }
    if (f.volumeMm3        !== undefined) lines.push('- volume: ' + f.volumeMm3 + ' mm3');
    if (f.surfaceAreaMm2   !== undefined) lines.push('- surface area: ' + f.surfaceAreaMm2 + ' mm2');
    if (f.minDimensionMm   !== undefined) lines.push('- smallest dimension: ' + f.minDimensionMm);
    if (f.isFlat           !== undefined) lines.push('- flat part: ' + (f.isFlat ? 'yes' : 'no'));
    if (f.constantThickness!== undefined) lines.push('- constant thickness: ' + (f.constantThickness ? 'yes' : 'no'));
    if (f.thicknessMm) lines.push('- thickness: ' + f.thicknessMm);
    if (f.bodyCount)   lines.push('- separate bodies: ' + f.bodyCount);
    if (f.unitsAssumed) lines.push('- NOTE: this format carries no units; millimetres were assumed.');
  } else {
    lines.push('No geometry was measured. Decide from the description and file type alone,');
    lines.push('and lower your confidence accordingly.');
  }

  if (payload.materialClass) lines.push('', 'Client says the material is: ' + payload.materialClass);
  if (payload.toleranceMm)   lines.push('Client needs a tolerance of: ' + payload.toleranceMm + ' mm');
  if (payload.description)   lines.push('', 'Client description: ' + payload.description);

  lines.push('', 'Reply with exactly this JSON shape:');
  lines.push('{"process": "<key or null>", "alternatives": ["<key>"],');
  lines.push(' "confidence": 0.0,');
  lines.push(' "reasons": [{"en": "...", "ar": "..."}]}');

  return lines.join('\n');
}

/* ── validation ────────────────────────────────────────── */

/* The model's output is untrusted. Shape, ranges and — most
   importantly — the process keys are all checked here, so a
   hallucinated "laser_cnc_hybrid" never reaches the browser. */
function validateResult(raw, allowedProcesses) {
  if (!raw || typeof raw !== 'object') return null;

  const allowed = new Set(allowedProcesses || []);

  let process = raw.process;
  if (process === undefined || process === '' || process === 'null') process = null;
  if (process !== null && !allowed.has(process)) return null;

  const alternatives = Array.isArray(raw.alternatives)
    ? raw.alternatives.filter((a) => allowed.has(a) && a !== process).slice(0, 4)
    : [];

  let confidence = Number(raw.confidence);
  if (!isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  /* A process with zero confidence is incoherent; so is no process
     with high confidence. Rather than argue with the model, take the
     safer reading: no answer. */
  if (process === null && confidence > 0.4) confidence = 0.3;
  if (process !== null && confidence === 0)  return null;

  const reasons = (Array.isArray(raw.reasons) ? raw.reasons : [])
    .map((r) => {
      if (!r || typeof r !== 'object') return null;
      const en = typeof r.en === 'string' ? r.en.trim().slice(0, 240) : '';
      const ar = typeof r.ar === 'string' ? r.ar.trim().slice(0, 240) : '';
      return (en || ar) ? { en: en || ar, ar: ar || en } : null;
    })
    .filter(Boolean)
    .slice(0, MAX_REASONS);

  return { process, alternatives, confidence, reasons };
}

function parseJSONLoose(text) {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch (e) { /* fall through */ }
  /* Some models still wrap JSON in prose or fences despite being told
     not to. One salvage attempt, then give up. */
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (e) { return null; }
}

/* ── adapters ──────────────────────────────────────────── */

async function callOpenAICompatible(spec, env, payload, model) {
  const res = await fetch(spec.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + env[spec.keyEnv],
      /* OpenRouter asks for these; harmless elsewhere. */
      'HTTP-Referer': env.SITE_URL || 'https://example.invalid',
      'X-Title': 'Gestaltung classifier'
    },
    body: JSON.stringify({
      model: model,
      temperature: 0,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: buildUserPrompt(payload) }
      ]
    })
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, status: res.status, error: (body && body.error && body.error.message) || 'provider_error' };
  }
  const text = body && body.choices && body.choices[0] && body.choices[0].message
    ? body.choices[0].message.content : '';
  return {
    ok: true,
    parsed: parseJSONLoose(text),
    tokensIn:  (body && body.usage && body.usage.prompt_tokens) || 0,
    tokensOut: (body && body.usage && body.usage.completion_tokens) || 0
  };
}

async function callGemini(spec, env, payload, model) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
            + encodeURIComponent(model) + ':generateContent?key='
            + encodeURIComponent(env[spec.keyEnv]);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(payload) }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 700,
        responseMimeType: 'application/json'
      }
    })
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, status: res.status, error: (body && body.error && body.error.message) || 'provider_error' };
  }
  const text = body && body.candidates && body.candidates[0]
            && body.candidates[0].content && body.candidates[0].content.parts
    ? body.candidates[0].content.parts.map((p) => p.text || '').join('')
    : '';
  const usage = (body && body.usageMetadata) || {};
  return {
    ok: true,
    parsed: parseJSONLoose(text),
    tokensIn:  usage.promptTokenCount || 0,
    tokensOut: usage.candidatesTokenCount || 0
  };
}

/* ── mock, for local testing without a key ─────────────── */

/* Enabled with MOCK=1. Deterministic, so the four Stage 3 checks in
   proxy/README.md can be run before any key exists. It is a canned
   answer, not a model, and says so in its reasons. */
function mockResult(payload) {
  const f = payload.features || {};
  const has = (s) => (payload.description || '').toLowerCase().includes(s);
  let process = null;
  let confidence = 0.35;

  /* Same ordering as the browser-side mock in llm-provider.js, and
     for the same reason: the specific beats the incidental, so "an
     enclosure for a sensor board" is an enclosure. */
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
      en: 'Mock provider — no model was called. Set MOCK=0 and add a key for real answers.',
      ar: 'مزوّد تجريبي — لم يُستدعَ أي نموذج. اضبط MOCK=0 وأضف مفتاحاً للحصول على إجابات حقيقية.'
    }]
  };
}

/* ── daily cap ─────────────────────────────────────────── */

/* Optional. Without a KV binding the worker still runs and still
   answers, but says at /health that the cap is not enforced — which
   is more useful than a cap that silently does nothing. */
async function checkAndCountCap(env, tenant) {
  const globalCap = parseInt(env.GLOBAL_DAILY_CAP || '0', 10);
  const tenantCap = parseInt(env.TENANT_DAILY_CAP || '0', 10);
  if (!env.RATE_KV || (!globalCap && !tenantCap)) {
    return { enforced: false, ok: true };
  }

  const day = new Date().toISOString().slice(0, 10);
  const keys = [];
  if (globalCap) keys.push(['g:' + day, globalCap]);
  if (tenantCap) keys.push(['t:' + (tenant || 'anon') + ':' + day, tenantCap]);

  for (const [key, cap] of keys) {
    const n = parseInt((await env.RATE_KV.get(key)) || '0', 10);
    if (n >= cap) return { enforced: true, ok: false, key: key, cap: cap, used: n };
  }
  /* Incremented after the check, not atomically — two requests in the
     same millisecond can both pass at the boundary. For a free-tier
     guard that is an acceptable overshoot of one; the alternative is
     a Durable Object for a counter that guards a free quota. */
  for (const [key] of keys) {
    const n = parseInt((await env.RATE_KV.get(key)) || '0', 10);
    await env.RATE_KV.put(key, String(n + 1), { expirationTtl: 172800 });
  }
  return { enforced: true, ok: true };
}

/* ── http ──────────────────────────────────────────────── */

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.length === 0 || (origin && allowed.indexOf(origin) !== -1);
  return {
    ok: ok,
    headers: {
      'access-control-allow-origin': ok && origin ? origin : 'null',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'Origin'
    }
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({}, JSON_HEADERS, extra || {})
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors   = corsHeaders(env, origin);
    const url    = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors.headers });
    }

    if (url.pathname === '/health') {
      const mock = env.MOCK === '1';
      return json({
        ok: true,
        mock: mock,
        providers: Object.keys(PROVIDERS).filter((p) => mock || !!env[PROVIDERS[p].keyEnv]),
        capEnforced: !!env.RATE_KV && !!(env.GLOBAL_DAILY_CAP || env.TENANT_DAILY_CAP),
        allowedOrigins: (env.ALLOWED_ORIGINS || '(any — set ALLOWED_ORIGINS)').split(',')
      }, 200, cors.headers);
    }

    if (url.pathname !== '/classify' || request.method !== 'POST') {
      return json({ ok: false, error: 'not_found' }, 404, cors.headers);
    }

    /* The browser is the only intended caller, so a disallowed origin
       is refused before anything is spent. */
    if (!cors.ok) {
      return json({ ok: false, error: 'origin_not_allowed' }, 403, cors.headers);
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ ok: false, error: 'bad_json' }, 400, cors.headers); }

    const name = body && body.provider;
    const spec = PROVIDERS[name];
    if (!spec) return json({ ok: false, error: 'unknown_provider' }, 400, cors.headers);

    const mock = env.MOCK === '1';
    if (!mock && !env[spec.keyEnv]) {
      /* Not configured is a 501, not a 500: the browser's fallback
         chain should move to the next provider, not treat it as an
         outage worth retrying. */
      return json({ ok: false, error: 'provider_not_configured' }, 501, cors.headers);
    }

    /* Only these fields are ever forwarded. Anything else the caller
       sends is dropped here rather than reaching a model. */
    const p = (body && body.payload) || {};
    const payload = {
      ext: typeof p.ext === 'string' ? p.ext.slice(0, 16) : '',
      features: (p.features && typeof p.features === 'object') ? p.features : {},
      description: typeof p.description === 'string' ? p.description.slice(0, 2000) : '',
      materialClass: typeof p.materialClass === 'string' ? p.materialClass.slice(0, 32) : '',
      toleranceMm: typeof p.toleranceMm === 'number' ? p.toleranceMm : null,
      processes: Array.isArray(p.processes) ? p.processes.filter((x) => typeof x === 'string').slice(0, 24) : [],
      materials: (p.materials && typeof p.materials === 'object') ? p.materials : {}
    };

    if (!payload.processes.length) {
      return json({ ok: false, error: 'no_processes_given' }, 400, cors.headers);
    }

    const cap = await checkAndCountCap(env, body.tenant);
    if (!cap.ok) {
      return json({ ok: false, error: 'daily_cap_reached', cap: cap.cap, used: cap.used },
                  429, cors.headers);
    }

    const model = env[spec.modelEnv] || spec.defaultModel;
    const t0 = Date.now();

    if (mock) {
      const result = validateResult(mockResult(payload), payload.processes);
      return json({ ok: true, provider: name, model: 'mock', result: result,
                    latencyMs: Date.now() - t0, tokensIn: 0, tokensOut: 0 },
                  200, cors.headers);
    }

    /* One retry, and only for invalid JSON. A 429 or a 500 is the
       provider saying no; retrying it here would burn the same quota
       twice when the browser already has another provider to try. */
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let call;
      try {
        call = await spec.call(spec, env, payload, model);
      } catch (err) {
        last = { error: String((err && err.message) || err), status: 502 };
        break;
      }

      if (!call.ok) { last = { error: call.error, status: call.status || 502 }; break; }

      const result = validateResult(call.parsed, payload.processes);
      if (result) {
        return json({
          ok: true, provider: name, model: model, result: result,
          latencyMs: Date.now() - t0,
          tokensIn: call.tokensIn, tokensOut: call.tokensOut,
          retried: attempt > 0
        }, 200, cors.headers);
      }
      last = { error: 'invalid_model_output', status: 502 };
    }

    return json({
      ok: false, provider: name, error: last ? last.error : 'unknown',
      latencyMs: Date.now() - t0
    }, (last && last.status) || 502, cors.headers);
  }
};
