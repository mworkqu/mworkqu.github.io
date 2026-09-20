/* ── Classification confirmation ───────────────────────────
   The component that stops the machine deciding on its own.

   It renders a suggestion as a QUESTION, never as a fact: the
   proposed process, how sure the classifier is, the reasons it gave,
   and the alternatives it considered — with Confirm and Change as
   equally available actions. The user is the one who decides; the
   classifier only opens the conversation.

   When confidence is low, or there is no suggestion at all, the panel
   leads with "which of these is it?" instead of presenting a guess to
   be argued with. A confident wrong answer costs more than an honest
   question.

   Pure presentation: it neither classifies nor logs. The caller hands
   it a result and two callbacks.

     ClassificationConfirm.render(host, result, {
       processes,          // [{ key, label:{en,ar} }]
       onConfirm(process), // user accepted the suggestion
       onChange(process)   // user picked a different one
     }); */

window.ClassificationConfirm = (function () {

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const t = (key, fallback, vars) => {
    const v = window.I18n ? I18n.t(key, vars || {}) : key;
    return v === key ? (fallback || key) : v;
  };

  const pick = (pair) => (window.I18n ? I18n.pick(pair) : (pair && pair.en) || '');

  function labelFor(processes, key) {
    const p = (processes || []).find((x) => x.key === key);
    return p ? pick(p.label) : (key || '');
  }

  function bandText(band) {
    if (band === 'high')   return t('ai.confidence.high',   'High confidence');
    if (band === 'medium') return t('ai.confidence.medium', 'Worth checking');
    return t('ai.confidence.low', 'Not sure — please choose');
  }

  function render(host, result, opts) {
    if (!host) return;
    const o          = opts || {};
    const processes  = o.processes || [];
    const suggestion = result && result.process;
    const band       = (result && result.band) || 'low';
    const confident  = !!suggestion && band !== 'low';

    const reasons = (result && result.reasons || [])
      .map((r) => (window.AIService ? AIService.describeReason(r) : ''))
      .filter(Boolean);

    const alternatives = (result && result.alternatives || [])
      .filter((k) => k && k !== suggestion);

    /* The heading is the whole point of the component: a question when
       we are guessing, a checkable claim when we are not. */
    const heading = confident
      ? t('ai.result.think', 'We think this is {process}. Correct?',
          { process: labelFor(processes, suggestion) })
      : t('ai.result.unsure', 'We could not identify this with confidence. Which is it?');

    host.innerHTML = `
      <div class="ai-suggest ai-band-${esc(band)}">

        <div class="ai-suggest-head">
          <p class="ai-suggest-q">${esc(heading)}</p>
          <span class="ai-band" title="${esc(t('ai.confidence.label', 'Confidence'))}">${esc(bandText(band))}</span>
        </div>

        ${result && result.cached ? `
          <p class="ai-cached">${esc(t('ai.cached', 'Read from cache — this file was identified before.'))}</p>` : ''}

        ${reasons.length ? `
          <div class="ai-reasons">
            <p class="ai-reasons-title">${esc(t('ai.reasons', 'Why'))}</p>
            <ul>${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
          </div>` : ''}

        ${alternatives.length ? `
          <div class="ai-alts">
            <p class="ai-reasons-title">${esc(t('ai.alternatives', 'Could also be'))}</p>
            <div class="ai-alt-row">
              ${alternatives.map((k) => `
                <button class="btn-table" type="button" data-ai-pick="${esc(k)}">${
                  esc(labelFor(processes, k))}</button>`).join('')}
            </div>
          </div>` : ''}

        <div class="ai-actions">
          ${confident ? `
            <button class="btn-table primary" type="button" data-ai-confirm>${
              esc(t('ai.confirm', 'Confirm'))}</button>
            <button class="btn-table" type="button" data-ai-toggle-change>${
              esc(t('ai.change', 'Change'))}</button>` : ''}
        </div>

        <div class="ai-change" data-ai-change${confident ? ' hidden' : ''}>
          <label for="ai-change-select">${esc(t('ai.chooseProcess', 'Choose the process'))}</label>
          <select id="ai-change-select" data-ai-select>
            <option value="">${esc(t('ai.selectPrompt', 'Select…'))}</option>
            ${processes.map((p) => `<option value="${esc(p.key)}"${
              p.key === suggestion ? ' selected' : ''}>${esc(pick(p.label))}</option>`).join('')}
          </select>
          <button class="btn-table primary" type="button" data-ai-save>${
            esc(t('ai.save', 'Save choice'))}</button>
        </div>

        <p class="ai-source mono">${esc(
          t('ai.sourceLine', 'Source: {source}', { source: (result && result.source) || '—' }))}</p>
      </div>`;

    /* One listener on the container: the markup above is re-rendered
       wholesale, and per-button listeners would leak with it. */
    host.onclick = (e) => {
      const confirmBtn = e.target.closest('[data-ai-confirm]');
      if (confirmBtn) {
        if (typeof o.onConfirm === 'function') o.onConfirm(suggestion);
        return;
      }

      const toggle = e.target.closest('[data-ai-toggle-change]');
      if (toggle) {
        const box = host.querySelector('[data-ai-change]');
        if (box) box.hidden = !box.hidden;
        return;
      }

      /* An alternative chip is a one-click correction. */
      const alt = e.target.closest('[data-ai-pick]');
      if (alt) {
        if (typeof o.onChange === 'function') o.onChange(alt.dataset.aiPick);
        return;
      }

      const save = e.target.closest('[data-ai-save]');
      if (save) {
        const sel = host.querySelector('[data-ai-select]');
        const val = sel && sel.value;
        if (!val) return;
        if (val === suggestion) {
          if (typeof o.onConfirm === 'function') o.onConfirm(val);
        } else if (typeof o.onChange === 'function') {
          o.onChange(val);
        }
      }
    };
  }

  /* Shown once the decision is recorded, so the user can see that
     their correction actually went somewhere. */
  function renderDecided(host, processes, finalKey, corrected) {
    if (!host) return;
    host.onclick = null;
    const label = labelFor(processes, finalKey);
    host.innerHTML = `
      <div class="ai-suggest ai-decided">
        <p class="ai-suggest-q">${esc(corrected
          ? t('ai.savedCorrected', 'Saved as {process}. Thank you — corrections train the classifier.', { process: label })
          : t('ai.savedConfirmed', 'Saved as {process}.', { process: label }))}</p>
      </div>`;
  }

  return { render: render, renderDecided: renderDecided };

})();
