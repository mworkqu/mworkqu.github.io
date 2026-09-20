/* ── Admin: AI insight and the learning loop ───────────────
   Reads the classification log, the usage log and the rule drafts,
   and renders them. It writes exactly one kind of row — an admin's
   decision on a rule draft — and nothing else.

   Two things this page is careful about, because both are easy to
   get wrong in a way that flatters the classifier:

   1. Accuracy counts only decisions a human actually closed. A
      suggestion nobody confirmed is not a correct suggestion; it is
      an unknown, and it is reported separately rather than quietly
      rolled into the denominator.

   2. Generated demo rows are counted and labelled as generated.
      A statistic you cannot tell apart from a real one is worse
      than no statistic at all.

   It never edits data/classification-rules.json. See "promote to
   rule" below — the evidence is automatic, the decision is not. */

(function () {

  if (document.body.dataset.dashPage !== 'admin-ai') return;

  const esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);

  const t = (key, fallback) => {
    const v = window.I18n ? I18n.t(key) : key;
    return v === key ? (fallback || key) : v;
  };

  const $ = (sel) => document.querySelector(sel);

  /* Thresholds live in ai-config.js with the rest of the tuning, so
     "how much evidence before we suggest a rule" is a config edit. */
  const learning = () => (window.AI_CONFIG && AI_CONFIG.learning) || {};
  const limits   = () => (window.AI_CONFIG && AI_CONFIG.limits)   || {};

  const state = {
    rows: [], usage: [], saved: [], labels: {},
    range: '30', tenant: 'all'
  };

  /* ── helpers ─────────────────────────────────────────── */

  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

  function processLabel(key) {
    if (!key) return t('adminAi.noAnswer', 'no answer');
    return state.labels[key] || key;
  }

  function cutoff() {
    if (state.range === 'all') return '';
    const days = parseInt(state.range, 10) || 30;
    return new Date(Date.now() - days * 864e5).toISOString();
  }

  function inScope(r) {
    if (state.tenant !== 'all' && r.tenant_id !== state.tenant) return false;
    const c = cutoff();
    return !c || (r.created_at || '') >= c;
  }

  const rows  = () => state.rows.filter(inScope);
  const calls = () => state.usage.filter(inScope);

  const today = () => new Date().toISOString().slice(0, 10);

  function tenantList() {
    const seen = {};
    state.rows.forEach((r) => { seen[r.tenant_id] = true; });
    state.usage.forEach((r) => { seen[r.tenant_id] = true; });
    return Object.keys(seen).sort();
  }

  /* ── accuracy ────────────────────────────────────────── */

  /* `decided` is the honest denominator: rows where a human chose.
     Everything else is an open question, not a silent success. */
  function accuracy(list) {
    const decided = list.filter((r) => r.decided_at);
    const agreed  = decided.filter((r) => !r.corrected);
    return {
      total: list.length,
      decided: decided.length,
      undecided: list.length - decided.length,
      agreed: agreed.length,
      corrected: decided.length - agreed.length,
      rate: pct(agreed.length, decided.length)
    };
  }

  function renderSummary() {
    const list = rows();
    const a    = accuracy(list);
    const demo = list.filter((r) => r.demo).length;
    const byAi = list.filter((r) => r.source && r.source !== 'rules' && r.source !== 'cache').length;

    $('[data-ai-summary]').innerHTML = `
      <div class="metric-card">
        <strong>${a.total}</strong>
        <span class="metric-label">${esc(t('adminAi.m.decisions', 'Classifications'))}</span>
      </div>
      <div class="metric-card">
        <strong>${a.decided ? a.rate + '%' : '—'}</strong>
        <span class="metric-label">${esc(t('adminAi.m.accuracy', 'Confirmed as suggested'))}</span>
      </div>
      <div class="metric-card">
        <strong>${a.corrected}</strong>
        <span class="metric-label">${esc(t('adminAi.m.corrections', 'Corrected by the client'))}</span>
      </div>
      <div class="metric-card">
        <strong>${a.total ? pct(byAi, a.total) + '%' : '—'}</strong>
        <span class="metric-label">${esc(t('adminAi.m.escalated', 'Answered by an AI service'))}</span>
      </div>`;

    const notes = [];
    if (a.undecided) {
      notes.push(t('adminAi.note.undecided',
        '{n} suggestions were never confirmed or corrected, and are left out of the accuracy figure — an unanswered question is not a correct answer.')
        .replace('{n}', a.undecided));
    }
    if (demo) {
      notes.push(t('adminAi.note.demo',
        '{n} of these rows are generated samples.').replace('{n}', demo));
    }
    $('[data-ai-caveat]').innerHTML = notes.map((n) => `<p>${esc(n)}</p>`).join('');
  }

  /* ── where answers came from ─────────────────────────── */

  function renderSources() {
    const list = rows();
    const by   = {};
    list.forEach((r) => {
      const k = r.source || 'rules';
      const b = by[k] || (by[k] = { n: 0, decided: 0, agreed: 0, conf: 0 });
      b.n++;
      b.conf += r.confidence || 0;
      if (r.decided_at) { b.decided++; if (!r.corrected) b.agreed++; }
    });

    const keys = Object.keys(by).sort((x, y) => by[y].n - by[x].n);
    if (!keys.length) {
      $('[data-ai-sources]').innerHTML =
        `<p class="dash-empty">${esc(t('adminAi.empty', 'Nothing logged in this period yet.'))}</p>`;
      return;
    }

    $('[data-ai-sources]').innerHTML = `
      <table class="g-table">
        <thead><tr>
          <th>${esc(t('adminAi.th.source', 'Answered by'))}</th>
          <th class="num">${esc(t('adminAi.th.count', 'Answers'))}</th>
          <th class="num">${esc(t('adminAi.th.decided', 'Confirmed or corrected'))}</th>
          <th class="num">${esc(t('adminAi.th.accuracy', 'Accuracy'))}</th>
          <th class="num">${esc(t('adminAi.th.confidence', 'Mean confidence'))}</th>
        </tr></thead>
        <tbody>
          ${keys.map((k) => {
            const b = by[k];
            return `<tr>
              <td>${esc(sourceName(k))}</td>
              <td class="num mono">${b.n}</td>
              <td class="num mono">${b.decided}</td>
              <td class="num mono">${b.decided ? pct(b.agreed, b.decided) + '%' : '—'}</td>
              <td class="num mono">${(b.conf / b.n).toFixed(2)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  function sourceName(key) {
    if (key === 'rules') return t('adminAi.src.rules', 'Local rules');
    if (key === 'cache') return t('adminAi.src.cache', 'Cache');
    /* A provider name is a proper noun — not translated, and not
       dressed up as something friendlier than it is. */
    return key;
  }

  /* ── most-corrected cases ────────────────────────────── */

  /* Grouped by what was suggested and what the client chose
     instead. That pair is the unit of a mistake: "3D printing when
     it should have been CNC" is a fixable rule, "wrong sometimes"
     is not. */
  function corrections(list) {
    const by = {};
    list.filter((r) => r.corrected && r.decided_at).forEach((r) => {
      const key = (r.suggested_process || '∅') + '→' + (r.final_process || '∅');
      const g = by[key] || (by[key] = {
        key: key, from: r.suggested_process || null, to: r.final_process || null,
        rows: []
      });
      g.rows.push(r);
    });
    return Object.keys(by).map((k) => by[k]).sort((a, b) => b.rows.length - a.rows.length);
  }

  function renderCorrections() {
    const groups = corrections(rows());
    const host   = $('[data-ai-corrections]');
    if (!groups.length) {
      host.innerHTML = `<p class="dash-empty">${esc(
        t('adminAi.noCorrections', 'No corrections in this period — the suggestions were accepted as made.'))}</p>`;
      return;
    }
    host.innerHTML = `
      <table class="g-table">
        <thead><tr>
          <th>${esc(t('adminAi.th.suggested', 'Suggested'))}</th>
          <th>${esc(t('adminAi.th.chosen', 'Client chose'))}</th>
          <th class="num">${esc(t('adminAi.th.times', 'Times'))}</th>
          <th>${esc(t('adminAi.th.shared', 'What they had in common'))}</th>
        </tr></thead>
        <tbody>
          ${groups.map((g) => {
            const shared = sharedFeatures(g.rows);
            const bits   = Object.keys(shared).map((k) => `${k} = ${shared[k]}`);
            return `<tr>
              <td>${esc(processLabel(g.from))}</td>
              <td>${esc(processLabel(g.to))}</td>
              <td class="num mono">${g.rows.length}</td>
              <td class="small mono">${bits.length ? esc(bits.join(', ')) : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  /* ── promote to rule ─────────────────────────────────── */

  /* Only categorical features, and only when every row in the group
     agrees on the value. A numeric feature averaged across a handful
     of corrections produces a threshold that fits this sample and
     nothing else. */
  const CATEGORICAL = [
    'fileKind', 'extension', 'materialClass',
    'isFlat', 'constantThickness', 'profileOnly', 'hasGeometry'
  ];

  function sharedFeatures(list) {
    const out = {};
    CATEGORICAL.forEach((f) => {
      const vals = list.map((r) => (r.features || {})[f]);
      if (vals.some((v) => v === undefined || v === null)) return;
      const first = vals[0];
      if (vals.every((v) => v === first)) out[f] = first;
    });
    return out;
  }

  /* A tolerance is the one number worth generalising, because it is
     a stated requirement rather than a measurement: if every
     corrected part was tighter than X, "tighter than X" is a real
     condition and not a coincidence of this sample. */
  function toleranceBound(list) {
    const vals = list.map((r) => (r.features || {}).toleranceMm)
      .filter((v) => typeof v === 'number');
    if (vals.length !== list.length || !vals.length) return null;
    const max = Math.max.apply(null, vals);
    return Math.ceil(max * 100) / 100;
  }

  function draftFor(group) {
    const shared = sharedFeatures(group.rows);
    const clauses = Object.keys(shared).map((f) => ({ feature: f, eq: shared[f] }));

    const tol = toleranceBound(group.rows);
    if (tol !== null) clauses.push({ feature: 'toleranceMm', lte: tol });

    /* A rule with no conditions matches every part ever uploaded.
       Refusing to draft one is the whole safety margin here. */
    if (!clauses.length) return null;

    const agreement = group.rows.length /
      Math.max(1, group.rows.length + disagreeing(group).length);

    return {
      signature: group.key + '|' + clauses.map((c) =>
        c.feature + ':' + (c.eq !== undefined ? c.eq : 'lte' + c.lte)).join(','),
      agreement: agreement,
      rule: {
        id: 'learned-' + (group.to || 'unknown') + '-' + clauses.length + 'c',
        when: { all: clauses },
        then: {
          process: group.to,
          alternatives: group.from ? [group.from] : [],
          /* Evidence, not optimism: the observed agreement rate,
             capped below the hand-written rules so a learned rule
             never outranks a measured one on its first day. */
          confidence: Math.min(0.8, Math.round(agreement * 100) / 100)
        },
        reason: 'ai.reason.rule.learned',
        note: 'Drafted from ' + group.rows.length +
              ' corrections observed in the admin insight page. Reviewed by a human before it was added.'
      }
    };
  }

  /* Rows matching the same shared features that were NOT corrected
     this way. Without this the agreement rate is 100% by
     construction, which is how a learning loop convinces itself. */
  function disagreeing(group) {
    const shared = sharedFeatures(group.rows);
    const keys   = Object.keys(shared);
    if (!keys.length) return [];
    return rows().filter((r) => {
      if (!r.decided_at) return false;
      if ((r.final_process || null) === (group.to || null)) return false;
      return keys.every((f) => (r.features || {})[f] === shared[f]);
    });
  }

  function candidates() {
    const min = learning().minEvidence || 3;
    const out = [];
    corrections(rows()).forEach((g) => {
      if (g.rows.length < min) return;
      const d = draftFor(g);
      if (!d) return;
      if (d.agreement < (learning().minAgreement || 0.7)) return;
      const saved = state.saved.find((s) => s.signature === d.signature);
      out.push({
        group: g, draft: d,
        status: saved ? saved.status : 'pending',
        savedId: saved ? saved.id : null
      });
    });
    return out;
  }

  function renderProposals() {
    const list = candidates();
    const host = $('[data-ai-proposals]');
    const min  = learning().minEvidence || 3;

    if (!list.length) {
      host.innerHTML = `<p class="dash-empty">${esc(t('adminAi.noProposals',
        'Nothing to propose yet. A pattern needs {n} matching corrections with a feature in common before it is worth a rule.')
        .replace('{n}', min))}</p>`;
      return;
    }

    host.innerHTML = list.map((c) => {
      const json = JSON.stringify(c.draft.rule, null, 2);
      const badge = c.status === 'accepted'
        ? `<span class="badge complete">${esc(t('adminAi.st.accepted', 'Approved'))}</span>`
        : c.status === 'dismissed'
          ? `<span class="badge">${esc(t('adminAi.st.dismissed', 'Dismissed'))}</span>`
          : `<span class="badge active">${esc(t('adminAi.st.pending', 'Awaiting review'))}</span>`;

      return `
        <article class="ins-draft" data-sig="${esc(c.draft.signature)}">
          <header class="ins-draft-head">
            <div>
              <strong>${esc(t('adminAi.became', '{from} became {to}')
                .replace('{from}', processLabel(c.group.from))
                .replace('{to}', processLabel(c.group.to)))}</strong>
              <p class="ins-draft-sub">${esc(t('adminAi.evidence',
                '{n} corrections · {a}% of comparable parts went this way')
                .replace('{n}', c.group.rows.length)
                .replace('{a}', Math.round(c.draft.agreement * 100)))}</p>
            </div>
            ${badge}
          </header>
          <pre class="ins-json"><code>${esc(json)}</code></pre>
          <div class="ins-actions">
            <button class="btn-table" type="button" data-copy>${esc(t('adminAi.copy', 'Copy the rule'))}</button>
            ${c.status !== 'accepted'
              ? `<button class="btn-table" type="button" data-approve>${esc(t('adminAi.approve', 'Approve'))}</button>` : ''}
            ${c.status !== 'dismissed'
              ? `<button class="btn-table danger" type="button" data-dismiss>${esc(t('adminAi.dismiss', 'Dismiss'))}</button>` : ''}
          </div>
          <p class="ins-draft-foot">${esc(t('adminAi.pasteNote',
            'Approving records your decision. It does not change the classifier — paste this block into data/classification-rules.json to make it live.'))}</p>
        </article>`;
    }).join('');
  }

  /* ── usage against the caps ──────────────────────────── */

  function renderUsage() {
    const day    = today();
    const todays = state.usage.filter((r) =>
      (r.created_at || '') >= day
      && r.error !== 'consent_missing' && r.error !== 'cap_reached');
    const lim    = limits();

    const perTenant = {};
    todays.forEach((r) => { perTenant[r.tenant_id] = (perTenant[r.tenant_id] || 0) + 1; });
    const busiest = Object.keys(perTenant).sort((a, b) => perTenant[b] - perTenant[a]);

    const bar = (used, cap) => {
      const p = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
      return `<div class="ins-bar"><span style="width:${p}%"></span></div>`;
    };

    $('[data-ai-usage]').innerHTML = `
      <div class="ins-cap">
        <div class="ins-cap-row">
          <span>${esc(t('adminAi.globalCap', 'All tenants today'))}</span>
          <span class="mono">${todays.length} / ${lim.globalPerDay || '∞'}</span>
        </div>
        ${bar(todays.length, lim.globalPerDay)}
      </div>
      ${busiest.length ? `
        <table class="g-table">
          <thead><tr>
            <th>${esc(t('adminAi.th.tenant', 'Tenant'))}</th>
            <th class="num">${esc(t('adminAi.th.callsToday', 'Calls today'))}</th>
            <th class="num">${esc(t('adminAi.th.tenantCap', 'Daily cap'))}</th>
          </tr></thead>
          <tbody>${busiest.map((id) => `
            <tr>
              <td class="mono small">${esc(id)}</td>
              <td class="num mono">${perTenant[id]}</td>
              <td class="num mono">${lim.perTenantPerDay || '∞'}</td>
            </tr>`).join('')}
          </tbody>
        </table>`
      : `<p class="dash-empty">${esc(t('adminAi.noCallsToday', 'No AI service has been called today.'))}</p>`}`;

    /* Provider health over the selected range, not just today —
       one bad afternoon is what you are usually looking for. */
    const by = {};
    calls().forEach((r) => {
      const b = by[r.provider] || (by[r.provider] = { n: 0, ok: 0, ms: 0, tin: 0, tout: 0 });
      b.n++;
      if (r.ok) b.ok++;
      b.ms   += r.latency_ms || 0;
      b.tin  += r.tokens_in  || 0;
      b.tout += r.tokens_out || 0;
    });
    const provs = Object.keys(by).sort((a, b) => by[b].n - by[a].n);

    $('[data-ai-providers]').innerHTML = provs.length ? `
      <table class="g-table">
        <thead><tr>
          <th>${esc(t('adminAi.th.provider', 'Provider'))}</th>
          <th class="num">${esc(t('adminAi.th.calls', 'Calls'))}</th>
          <th class="num">${esc(t('adminAi.th.failed', 'Failed'))}</th>
          <th class="num">${esc(t('adminAi.th.latency', 'Mean latency'))}</th>
          <th class="num">${esc(t('adminAi.th.tokens', 'Tokens in / out'))}</th>
        </tr></thead>
        <tbody>${provs.map((p) => {
          const b = by[p];
          return `<tr>
            <td>${esc(p)}</td>
            <td class="num mono">${b.n}</td>
            <td class="num mono${b.n - b.ok ? ' ins-flag' : ''}">${b.n - b.ok}</td>
            <td class="num mono">${Math.round(b.ms / b.n)} ms</td>
            <td class="num mono">${b.tin} / ${b.tout}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`
      : `<p class="dash-empty">${esc(t('adminAi.noProviderCalls', 'No provider calls in this period.'))}</p>`;
  }

  /* ── export ──────────────────────────────────────────── */

  /* A field containing a comma, a quote or a newline has to survive
     the round trip, or the export is only good for eyeballing. */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(cols, list) {
    const lines = [cols.join(',')];
    list.forEach((r) => lines.push(cols.map((c) => csvCell(r[c])).join(',')));
    /* A BOM, because these exports carry Arabic descriptions and
       Excel reads a UTF-8 file as cp1252 without one. */
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime + ';charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const STAMP = () => new Date().toISOString().slice(0, 10);

  const CLS_COLS = [
    'id', 'created_at', 'decided_at', 'tenant_id', 'demo', 'file_ext', 'file_size',
    'source', 'suggested_process', 'final_process', 'corrected', 'confidence',
    'escalation_blocked', 'features', 'warnings', 'reasons'
  ];

  const USE_COLS = [
    'id', 'created_at', 'tenant_id', 'demo', 'provider', 'feature', 'model',
    'ok', 'http_status', 'error', 'latency_ms', 'tokens_in', 'tokens_out',
    'classification_id'
  ];

  function exportCsv() {
    download('ai-classifications-' + STAMP() + '.csv',
      toCsv(CLS_COLS, rows()), 'text/csv');
    download('ai-usage-' + STAMP() + '.csv',
      toCsv(USE_COLS, calls()), 'text/csv');
  }

  function exportJson() {
    /* Self-describing: a log exported without the thresholds that
       produced it cannot be interpreted six months later. */
    download('ai-log-' + STAMP() + '.json', JSON.stringify({
      exported_at: new Date().toISOString(),
      range_days: state.range,
      tenant: state.tenant,
      config: {
        escalate:   (window.AI_CONFIG || {}).escalate,
        confidence: (window.AI_CONFIG || {}).confidence,
        limits:     limits(),
        learning:   learning()
      },
      rules_version: state.rulesVersion || null,
      classifications: rows(),
      usage: calls(),
      rule_proposals: state.saved
    }, null, 2), 'application/json');
  }

  /* ── wiring ──────────────────────────────────────────── */

  function renderAll() {
    renderSummary();
    renderSources();
    renderCorrections();
    renderProposals();
    renderUsage();
  }

  async function reload() {
    state.rows  = await DataStore.listClassifications({ scope: 'all' });
    state.usage = await DataStore.listAiUsage({ scope: 'all' });
    state.saved = await DataStore.listRuleProposals();
    renderTenantFilter();
    renderAll();
  }

  function renderTenantFilter() {
    const sel = $('[data-ai-tenant]');
    if (!sel) return;
    const ids = tenantList();
    sel.innerHTML = `<option value="all">${esc(t('adminAi.allTenants', 'All tenants'))}</option>`
      + ids.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join('');
    sel.value = ids.indexOf(state.tenant) === -1 ? 'all' : state.tenant;
    state.tenant = sel.value;
  }

  function bind() {
    $('[data-ai-range]').addEventListener('change', (e) => {
      state.range = e.target.value;
      renderAll();
    });
    $('[data-ai-tenant]').addEventListener('change', (e) => {
      state.tenant = e.target.value;
      renderAll();
    });
    $('[data-ai-export-csv]').addEventListener('click', exportCsv);
    $('[data-ai-export-json]').addEventListener('click', exportJson);

    $('[data-ai-seed]').addEventListener('click', async () => {
      await DataStore.seedAiDemoData({ count: 24, days: 7 });
      await reload();
    });
    $('[data-ai-clear]').addEventListener('click', async () => {
      await DataStore.clearAiDemoData();
      await reload();
    });

    $('[data-ai-proposals]').addEventListener('click', async (e) => {
      const card = e.target.closest('[data-sig]');
      if (!card) return;
      const sig  = card.dataset.sig;
      const c    = candidates().find((x) => x.draft.signature === sig);
      if (!c) return;

      if (e.target.closest('[data-copy]')) {
        const text = JSON.stringify(c.draft.rule, null, 2);
        try { await navigator.clipboard.writeText(text); }
        catch (err) {
          /* Clipboard access can be refused; selecting the block is
             a worse experience but not a dead end. */
          const range = document.createRange();
          range.selectNodeContents(card.querySelector('code'));
          const sel = window.getSelection();
          sel.removeAllRanges(); sel.addRange(range);
        }
        return;
      }

      const status = e.target.closest('[data-approve]') ? 'accepted'
        : e.target.closest('[data-dismiss]') ? 'dismissed' : null;
      if (!status) return;

      const saved = await DataStore.saveRuleProposal({
        signature: sig,
        fromProcess: c.group.from,
        toProcess: c.group.to,
        evidenceCount: c.group.rows.length,
        agreement: c.draft.agreement,
        draft: c.draft.rule,
        sampleIds: c.group.rows.slice(0, 20).map((r) => r.id)
      });
      await DataStore.decideRuleProposal(saved.id, status);
      state.saved = await DataStore.listRuleProposals();
      renderProposals();
    });

    /* Process labels are {en, ar} pairs, so a language switch has
       to re-pick them before repainting or the table repaints in
       the old language. */
    document.addEventListener('i18n:change', async () => {
      await loadLabels();
      renderAll();
    });
  }

  /* Process labels come from processes.json like everywhere else —
     a label hardcoded here would drift from the cascade's. */
  async function loadLabels() {
    try {
      const data = await ProcessCascade.load();
      data.processes.forEach((p) => {
        state.labels[p.key] = window.I18n ? I18n.pick(p.label) : p.label.en;
      });
    } catch (e) { /* the keys read well enough on their own */ }
  }

  async function start() {
    await Promise.all([
      DataStore.ready(),
      window.I18n ? I18n.ready() : Promise.resolve()
    ]);

    await loadLabels();

    try {
      const res = await fetch('/data/classification-rules.json', { cache: 'no-cache' });
      if (res.ok) state.rulesVersion = (await res.json()).version;
    } catch (e) { /* only used to stamp the export */ }

    bind();
    await reload();
  }

  start();

})();
