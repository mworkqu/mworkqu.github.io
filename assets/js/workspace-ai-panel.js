/* ── Workspace panel: identify the process ─────────────────
   Registered like any other panel — one file, one script tag, no edit
   to the page or to the panels beside it. The modelling, image and
   schematic panels arrive the same way.

   What it does: take a file plus two optional hints, hand them to
   AIService, and put the answer in front of the user as a question.
   It does not classify and it does not decide. The rules live in
   data/classification-rules.json, the measuring in geometry.js, and
   the decision belongs to the person reading the screen.

   ── The two hints ──
   Material class and tolerance are asked for because the rules need
   them and the file cannot supply them: no STL knows it is going to
   be aluminium, and no mesh carries a tolerance. Both are optional —
   a rule that reads a missing feature simply does not fire, so
   leaving them blank costs precision and never correctness.

   They are deliberately NOT the Process → Material cascade. That
   control needs a process to offer materials, and the process is
   what we are trying to work out; asking there would be circular.

   ── The file never leaves the browser ──
   It is read here to compute a SHA-256 and to measure geometry. What
   a provider may see is decided in ai.js, not here.

   ── The consent toggle (Stage 3) ──
   Default off, and nothing reaches a remote model until it is on.
   The notice says exactly what would be sent — measurements and the
   description, never the file — because consent to something
   unnamed is not consent. It is stored per tenant rather than read
   off a checkbox, so "did this client agree" has an answer later. */

(function () {

  if (!window.WorkspacePanels) return;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const t = (key, fallback, vars) => {
    const v = window.I18n ? I18n.t(key, vars || {}) : key;
    return v === key ? (fallback || key) : v;
  };

  const MATERIAL_CLASSES = [
    ['',          'ai.material.unsure',    'Not sure yet'],
    ['metal',     'ai.material.metal',     'Metal'],
    ['plastic',   'ai.material.plastic',   'Plastic'],
    ['wood',      'ai.material.wood',      'Wood or board'],
    ['composite', 'ai.material.composite', 'Composite']
  ];

  WorkspacePanels.register({
    id: 'classify',
    slot: 'center',
    order: 5,                  /* above the results list */
    titleKey: 'ai.panel.title',
    title: 'Identify the process',

    async mount(body, ctx) {
      const config    = await ProcessCascade.load();
      const processes = config.processes.map((p) => ({ key: p.key, label: p.label }));

      let lastResult = null;
      let lastFile   = null;

      function shell() {
        body.innerHTML = `
          <p class="ai-privacy">${esc(t('ai.privacy.local',
            'Your file is read and measured in this browser only. Nothing is uploaded and nothing is sent to any AI service.'))}</p>

          <div class="panel-field">
            <label for="ai-file">${esc(t('ai.upload.label', 'Project file'))}</label>
            <input type="file" id="ai-file" data-ai-file>
          </div>

          <div class="ai-hints">
            <div class="panel-field">
              <label for="ai-material">${esc(t('ai.material.label', 'Material, if you know it'))}</label>
              <select id="ai-material" data-ai-material>
                ${MATERIAL_CLASSES.map(([v, k, f]) =>
                  `<option value="${esc(v)}">${esc(t(k, f))}</option>`).join('')}
              </select>
            </div>
            <div class="panel-field">
              <label for="ai-tol">${esc(t('ai.tolerance.label', 'Tightest tolerance (mm)'))}</label>
              <input type="number" id="ai-tol" step="0.005" min="0" data-ai-tolerance
                     placeholder="${esc(t('ai.tolerance.placeholder', 'e.g. 0.05'))}">
            </div>
          </div>

          <!-- Describing the job in words is a request in its own
               right: with no file there is no geometry, which is
               exactly the case the rules cannot answer. -->
          <div class="panel-field">
            <label for="ai-desc">${esc(t('ai.describe.label', 'Or describe it in words'))}</label>
            <textarea id="ai-desc" rows="2" data-ai-description
                      placeholder="${esc(t('ai.describe.placeholder',
                        'e.g. a waterproof enclosure for a sensor board'))}"></textarea>
            <button class="btn-table" type="button" data-ai-ask
                    style="margin-top:6px">${esc(t('ai.describe.ask', 'Identify from the description'))}</button>
          </div>

          <div class="ai-consent" data-ai-consent-block>
            <label class="ai-consent-row">
              <input type="checkbox" data-ai-consent>
              <span data-ai-consent-text>${esc(t('ai.consent.label',
                'Allow measurements and my description to be sent to an AI service when the rules are unsure'))}</span>
            </label>
            <p class="ai-consent-note" data-ai-consent-note>${esc(t('ai.consent.note',
              'Your CAD file is never sent — only the dimensions measured here and any text you write. Off by default.'))}</p>
          </div>

          <p class="field-note" data-ai-status role="status" aria-live="polite"></p>
          <div data-ai-result></div>`;
      }

      shell();

      const statusEl = () => body.querySelector('[data-ai-status]');
      const resultEl = () => body.querySelector('[data-ai-result]');

      function say(key, fallback, vars) {
        const el = statusEl();
        if (el) el.textContent = key ? t(key, fallback, vars) : '';
      }

      function hints() {
        const mat = body.querySelector('[data-ai-material]');
        const tol = body.querySelector('[data-ai-tolerance]');
        const dsc = body.querySelector('[data-ai-description]');
        const tolNum = tol && tol.value !== '' ? parseFloat(tol.value) : NaN;
        const typed = (dsc && dsc.value.trim()) || '';
        return {
          materialClass: (mat && mat.value) || null,
          toleranceMm: isFinite(tolNum) && tolNum > 0 ? tolNum : null,
          /* What the client typed wins over the project brief: they
             wrote it here, about this part, just now. */
          description: typed || (ctx.projectBrief || '')
        };
      }

      /* ── where the answer came from ────────────────────
         Never left to inference. "The rules answered this, no model
         was called" and "a model answered this" are different facts
         about how much to trust the number, and the user is told
         which one they are looking at. */
      function sourceHtml(result) {
        const e = result.escalation || {};
        let line;

        if (result.cached) {
          line = t('ai.source.cached', 'Answered earlier for this same question');
        } else if (e.usedProvider) {
          line = t('ai.source.model', 'An AI service answered ({provider})',
                   { provider: e.usedProvider });
        } else if (e.skipped === 'consent_missing') {
          line = t('ai.source.noConsent',
                   'The rules answered. An AI service was not asked, because you have not allowed it.');
        } else if (e.skipped === 'tenant_daily_cap' || e.skipped === 'global_daily_cap') {
          line = t('ai.source.capped',
                   'The rules answered. The daily AI limit has been reached, so no model was asked.');
        } else if (e.skipped === 'all_providers_failed') {
          line = t('ai.source.failed',
                   'The rules answered. Every AI service was unreachable.');
        } else if (e.skipped === 'rules_were_more_certain') {
          line = t('ai.source.rulesWon',
                   'The rules answered, and were more certain than the AI service.');
        } else if (e.considered && e.skipped === 'no_provider') {
          line = t('ai.source.noProvider', 'The rules answered. No AI service is configured.');
        } else {
          line = t('ai.source.rules', 'The rules answered — no AI service was called.');
        }

        const failed = (e.attempts || []).filter((a) => !a.ok);
        const detail = failed.length
          ? ' ' + t('ai.source.tried', '({n} tried and failed)', { n: failed.length })
          : '';

        return `<p class="ai-origin">${esc(line + detail)}</p>`;
      }

      /* ── what was measured ─────────────────────────────
         Shown because a number the user can check is worth more than
         a verdict they cannot. If the bounding box is wrong by 25.4
         they will spot it here, long before the quote is wrong. */
      function featuresHtml(result) {
        const f = result.features || {};
        if (!f.hasGeometry) {
          const why = (result.geometry && result.geometry.reason) || '';
          if (why === 'not_attempted' || why === 'cached') return '';
          return `<p class="ai-nogeo">${esc(
            t('ai.geometry.failed',
              'The geometry could not be read, so this is based on the file type alone.'))}</p>`;
        }

        const rows = [];
        const num  = (v) => (window.I18n ? I18n.number(v) : v);

        if (f.boundingBoxMaxMm) {
          rows.push([t('ai.feature.size', 'Size'),
            `${num(f.boundingBoxXMm)} × ${num(f.boundingBoxYMm)} × ${num(f.boundingBoxZMm)} mm`]);
        }
        if (f.volumeMm3)  rows.push([t('ai.feature.volume', 'Volume'), num(f.volumeMm3) + ' mm³']);
        if (f.thicknessMm) rows.push([t('ai.feature.thickness', 'Thickness'), num(f.thicknessMm) + ' mm']);
        if (f.isFlat !== undefined) {
          rows.push([t('ai.feature.flat', 'Flat part'),
            f.isFlat ? t('ai.yes', 'Yes') : t('ai.no', 'No')]);
        }
        if (f.bodyCount) rows.push([t('ai.feature.bodies', 'Separate bodies'), num(f.bodyCount)]);
        if (f.triangleCount) rows.push([t('ai.feature.triangles', 'Triangles'), num(f.triangleCount)]);

        if (!rows.length) return '';

        return `
          <details class="ai-features">
            <summary>${esc(t('ai.feature.title', 'What was measured'))}</summary>
            <dl>${rows.map(([k, v]) =>
              `<dt>${esc(k)}</dt><dd class="mono">${esc(String(v))}</dd>`).join('')}</dl>
          </details>`;
      }

      function warningsHtml(result) {
        const list = result.warnings || [];
        if (!list.length) return '';
        return `<ul class="ai-warnings">${list.map((w) => `
          <li class="ai-warning is-${esc(w.severity || 'warn')}">${
            esc(AIService.describeReason({ key: w.key, vars: w.vars }))}</li>`).join('')}</ul>`;
      }

      /* ── recording the decision ────────────────────────
         logClassification already happened inside ai.js when the
         suggestion was produced. This closes that same row with what
         the human chose, so one decision is one row and the Stage 4
         accuracy figures mean something. */
      async function decide(processKey, wasSuggestion) {
        if (!lastResult) return;

        if (lastResult.logId && window.DataStore) {
          try {
            await DataStore.logCorrection(lastResult.logId, processKey);
          } catch (e) {
            if (window.console) console.warn('[ai-panel] logging the decision failed', e);
          }
        }

        ClassificationConfirm.renderDecided(
          resultEl(), processes, processKey, !wasSuggestion);
        say('', '');

        /* Only now — after a human agreed — does anything else on the
           page react. See the listener in workspace-project.js. */
        ctx.bus.emit('classification:decided', {
          process: processKey,
          corrected: !wasSuggestion,
          logId: lastResult.logId || null,
          fileHash: lastResult.fileHash || null
        });
      }

      function present(result) {
        lastResult = result;
        say('', '');

        const host = resultEl();
        ClassificationConfirm.render(host, result, {
          processes: processes,
          onConfirm: (key) => decide(key, true),
          onChange:  (key) => decide(key, false)
        });

        /* Measurements and warnings sit under the question, not above
           it: the decision is the point, the evidence supports it. */
        const card = host.querySelector('.ai-suggest');
        if (card) {
          card.insertAdjacentHTML('beforeend',
            sourceHtml(result) + warningsHtml(result) + featuresHtml(result));
        }
      }

      /* A description with no file. There is nothing to measure, so
         the rules have almost nothing to work with — this is the case
         Stage 3 exists for. */
      async function askFromDescription() {
        const h = hints();
        if (!h.description || h.description.trim().length < 3) {
          say('ai.describe.tooShort', 'Write a sentence about the part first.');
          return;
        }
        lastFile = null;
        resultEl().innerHTML = '';
        say('ai.thinking', 'Working it out…');

        let result;
        try {
          result = await AIService.classifyProject({
            file: null,
            description: h.description,
            processes: processes.map((p) => p.key),
            materialClass: h.materialClass,
            toleranceMm: h.toleranceMm
          });
        } catch (err) {
          if (window.console) console.error('[ai-panel] classify failed', err);
          say('ai.failed', 'That could not be worked out. Nothing was changed.');
          return;
        }
        present(result);
      }

      async function handleFile(file) {
        if (!file) return;
        lastFile = file;
        resultEl().innerHTML = '';

        const heavy = window.GeometryService && GeometryService.supports(
          AIService.extensionOf(file));
        say(heavy ? 'ai.measuring' : 'ai.reading',
            heavy ? 'Measuring the geometry…' : 'Reading the file…');

        let result;
        try {
          const h = hints();
          result = await AIService.classifyProject({
            file: file,
            description: h.description,
            processes: processes.map((p) => p.key),
            materialClass: h.materialClass,
            toleranceMm: h.toleranceMm
          });
        } catch (err) {
          if (window.console) console.error('[ai-panel] classify failed', err);
          say('ai.failed', 'That file could not be read. Nothing was changed.');
          return;
        }

        if (!result || result.available === false) {
          say('ai.notAvailable', 'Not available yet.');
          return;
        }

        present(result);
      }

      body.addEventListener('change', async (e) => {
        if (e.target.closest('[data-ai-file]')) {
          const input = e.target;
          if (input.files && input.files[0]) handleFile(input.files[0]);
          return;
        }

        /* Consent is recorded the moment it is given or withdrawn,
           not when the next classification happens. */
        const consentBox = e.target.closest('[data-ai-consent]');
        if (consentBox) {
          if (window.DataStore) await DataStore.setAiConsent(consentBox.checked);
          /* Re-ask, because the answer may genuinely change now: the
             same question that the rules could not settle may reach a
             model this time. */
          if (lastFile) handleFile(lastFile);
          else if (lastResult) askFromDescription();
          return;
        }

        /* Changing a hint re-asks the question. The geometry is not
           measured again — the file hash is unchanged, so only the
           question hash moved. */
        if (e.target.closest('[data-ai-material]') || e.target.closest('[data-ai-tolerance]')) {
          if (lastFile) handleFile(lastFile);
        }
      });

      body.addEventListener('click', (e) => {
        if (e.target.closest('[data-ai-ask]')) askFromDescription();
      });

      /* Reflect the stored consent rather than assuming the default:
         it is per tenant and survives a reload. */
      (async () => {
        if (!window.DataStore || !DataStore.getAiConsent) return;
        try {
          const c = await DataStore.getAiConsent();
          const box = body.querySelector('[data-ai-consent]');
          if (box) box.checked = !!c.granted;
        } catch (e) { /* default stays off, which is the safe side */ }
      })();

      /* Re-render the last answer in the new language without asking
         the classifier again — the reasons travel as keys, not as
         sentences, which is the whole reason they are shaped that way.
         Only the result is redrawn; the file input is left alone,
         because replacing it would silently clear the user's choice. */
      ctx.bus.on('i18n:change', () => {
        const el = body.querySelector('.ai-privacy');
        if (el) {
          el.textContent = t('ai.privacy.local',
            'Your file is read and measured in this browser only. Nothing is uploaded and nothing is sent to any AI service.');
        }
        const label = body.querySelector('label[for="ai-file"]');
        if (label) label.textContent = t('ai.upload.label', 'Project file');

        /* Re-label the hints in place, keeping what the user chose —
           rebuilding the selects would silently discard it. */
        const matLabel = body.querySelector('label[for="ai-material"]');
        if (matLabel) matLabel.textContent = t('ai.material.label', 'Material, if you know it');

        const mat = body.querySelector('[data-ai-material]');
        if (mat) {
          const keep = mat.value;
          Array.prototype.forEach.call(mat.options, (opt) => {
            const row = MATERIAL_CLASSES.find(([v]) => v === opt.value);
            if (row) opt.textContent = t(row[1], row[2]);
          });
          mat.value = keep;
        }

        const tolLabel = body.querySelector('label[for="ai-tol"]');
        if (tolLabel) tolLabel.textContent = t('ai.tolerance.label', 'Tightest tolerance (mm)');

        const tol = body.querySelector('[data-ai-tolerance]');
        if (tol) tol.placeholder = t('ai.tolerance.placeholder', 'e.g. 0.05');

        const dscLabel = body.querySelector('label[for="ai-desc"]');
        if (dscLabel) dscLabel.textContent = t('ai.describe.label', 'Or describe it in words');

        const dsc = body.querySelector('[data-ai-description]');
        if (dsc) {
          dsc.placeholder = t('ai.describe.placeholder',
            'e.g. a waterproof enclosure for a sensor board');
        }

        const ask = body.querySelector('[data-ai-ask]');
        if (ask) ask.textContent = t('ai.describe.ask', 'Identify from the description');

        const consentText = body.querySelector('[data-ai-consent-text]');
        if (consentText) {
          consentText.textContent = t('ai.consent.label',
            'Allow measurements and my description to be sent to an AI service when the rules are unsure');
        }
        const consentNote = body.querySelector('[data-ai-consent-note]');
        if (consentNote) {
          consentNote.textContent = t('ai.consent.note',
            'Your CAD file is never sent — only the dimensions measured here and any text you write. Off by default.');
        }

        if (lastResult) present(lastResult);
      });

      return { classify: handleFile, ask: askFromDescription };
    }
  });

})();
