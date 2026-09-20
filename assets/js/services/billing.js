/* ── Billing: the meter, not the till (Stage 6) ────────────
   Turns "which feature, through which provider" into a credit cost,
   and reads the usage log back as a monthly total.

   ── It does not charge anybody ──
   There is no payment here and no invoice. Stage 6 was asked to
   PREPARE a subscription, not to launch one, and the difference is
   deliberate: a meter can be wrong for a month and be fixed, while a
   bill that is wrong for a month has to be refunded and explained.

   Enforcement is off by default (`billing.enforce` in ai-config.js).
   With it on, ai.js refuses a provider call that would take a tenant
   past their allowance, exactly the way the daily caps already work.

   ── Prices are data ──
   data/ai-plans.json holds the feature prices, the provider
   multipliers and the plans. Adding a tier or repricing a feature is
   a data edit. In Postgres these become rows in ai_plans and
   ai_feature_prices (0008_billing.sql), and — this is the part that
   matters — the credit cost of a usage row is computed THERE, from
   those rows. A client that can post its own price is not metered.

   ── A price of zero is a real price ──
   The rules, the cache and an on-device model cost nothing to run, so
   they cost nothing to use. Charging for them would push a client on
   a small plan towards the expensive answer to save their allowance,
   which is exactly backwards. */

window.Billing = (function () {

  const DATA_URL = '/data/ai-plans.json';
  let cache = null;

  async function load() {
    if (cache) return cache;
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Plans unavailable (${res.status})`);
    cache = await res.json();
    return cache;
  }

  /* ── pricing ─────────────────────────────────────────── */

  /* A missing feature or a missing provider prices at zero and says
     so to the console. Guessing a price for something unpriced is
     how a meter quietly invents charges; not counting it is at worst
     an undercount that shows up as a free feature nobody sells. */
  function costOf(plans, feature, provider) {
    const f = (plans.features || {})[feature];
    const m = (plans.providerMultipliers || {})[provider];

    if (!f) {
      if (window.console) console.warn('[billing] no price for feature', feature);
      return 0;
    }
    if (m === undefined) {
      if (window.console) console.warn('[billing] no multiplier for provider', provider);
      return 0;
    }
    return Math.ceil((f.credits || 0) * m);
  }

  async function cost(feature, provider) {
    return costOf(await load(), feature, provider);
  }

  /* When a provider reports no token usage — the mock, a local
     model, an API that omits it — the log would otherwise read as
     zero tokens for a call that plainly used some. An estimate is
     marked as an estimate so the two are never added up as if they
     were the same kind of number. */
  async function estimateTokens(feature, payload) {
    const plans = await load();
    const f = (plans.features || {})[feature] || {};
    const chars = JSON.stringify(payload || {}).length;
    return {
      /* ~4 characters per token is the usual rule of thumb for
         English; the fixed part of the prompt is added on top. */
      tokensIn:  Math.max(f.estTokensIn || 0, Math.round(chars / 4)),
      tokensOut: f.estTokensOut || 0,
      estimated: true
    };
  }

  /* ── plans ───────────────────────────────────────────── */

  async function plans() {
    return (await load()).plans || [];
  }

  async function planFor(key) {
    const p = await load();
    const list = p.plans || [];
    return list.find((x) => x.key === key)
        || list.find((x) => x.key === p.defaultPlan)
        || list[0] || null;
  }

  /* The billing period. Calendar month, because that is what a
     subscription line reads as and what a client will check it
     against. */
  function periodStart(now) {
    const d = now || new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  }

  /* ── what has been used ──────────────────────────────── */

  async function used(opts) {
    const o     = opts || {};
    const since = o.since || periodStart();
    const rows  = await DataStore.listAiUsage(
      o.scope === 'all' ? { scope: 'all' } : undefined);

    const mine = o.tenant
      ? rows.filter((r) => r.tenant_id === o.tenant)
      : rows;

    const inPeriod = mine.filter((r) =>
      (r.created_at || '') >= since && r.billable !== false);

    let credits = 0, tokensIn = 0, tokensOut = 0, estimatedRows = 0;
    const byFeature = {};

    inPeriod.forEach((r) => {
      const c = typeof r.credits === 'number' ? r.credits : 0;
      credits   += c;
      tokensIn  += r.tokens_in  || 0;
      tokensOut += r.tokens_out || 0;
      if (r.tokens_estimated) estimatedRows++;
      const k = r.feature || 'classifyProject';
      const b = byFeature[k] || (byFeature[k] = { calls: 0, credits: 0 });
      b.calls++;
      b.credits += c;
    });

    return {
      since: since,
      calls: inPeriod.length,
      credits: credits,
      tokensIn: tokensIn,
      tokensOut: tokensOut,
      /* Reported separately, never merged: a measured token count and
         an estimated one are not the same evidence. */
      estimatedRows: estimatedRows,
      byFeature: byFeature
    };
  }

  /* ── the check ai.js makes ───────────────────────────── */

  /* Returns null when the call may proceed, or a reason when it may
     not. Reasons are strings for the same purpose as the cap
     reasons: so the panel can say WHY, rather than going quiet. */
  async function check(feature, provider, opts) {
    const c = (window.AI_CONFIG || {}).billing || {};
    if (!c.enforce) return null;

    const o     = opts || {};
    const plans = await load();
    const plan  = await planFor(o.plan || (await currentPlan()));
    if (!plan) return null;

    if ((plan.providers || []).indexOf(provider) === -1) {
      return 'provider_not_in_plan';
    }

    const price = costOf(plans, feature, provider);
    if (price <= 0) return null;          /* free is free */

    const u = await used({ tenant: o.tenant });
    if (u.credits + price > (plan.monthlyCredits || 0)) {
      /* 'notify' keeps working and marks it; there is deliberately
         no option that charges past the allowance. */
      return plan.overage === 'block' ? 'credits_exhausted' : null;
    }
    return null;
  }

  async function currentPlan() {
    try { return (await DataStore.getTenantPlan()).plan; }
    catch (e) { return (await load()).defaultPlan; }
  }

  return {
    load: load,
    cost: cost,
    estimateTokens: estimateTokens,
    plans: plans,
    planFor: planFor,
    currentPlan: currentPlan,
    periodStart: periodStart,
    used: used,
    check: check
  };

})();
