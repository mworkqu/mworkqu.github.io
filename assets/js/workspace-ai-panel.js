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
   a provider may see is decided in ai.js, not here. */

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
        const tolNum = tol && tol.value !== '' ? parseFloat(tol.value) : NaN;
        return {
          materialClass: (mat && mat.value) || null,
          toleranceMm: isFinite(tolNum) && tolNum > 0 ? tolNum : null
        };
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
        if (card) card.insertAdjacentHTML('beforeend', warningsHtml(result) + featuresHtml(result));
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
            description: (ctx.projectBrief || ''),
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

      body.addEventListener('change', (e) => {
        if (e.target.closest('[data-ai-file]')) {
          const input = e.target;
          if (input.files && input.files[0]) handleFile(input.files[0]);
          return;
        }
        /* Changing a hint re-asks the question for the same file. The
           geometry is not measured again — the file hash is unchanged,
           so ai.js answers from its cache. */
        if (e.target.closest('[data-ai-material]') || e.target.closest('[data-ai-tolerance]')) {
          if (lastFile) handleFile(lastFile);
        }
      });

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

        if (lastResult) present(lastResult);
      });

      return { classify: handleFile };
    }
  });

})();
