/* ── Workspace panel: identify the process ─────────────────
   The first AI panel, and the surface Stage 1 is tested through.
   Registered like any other panel — one file, one script tag, no edit
   to the page or to the panels beside it. The modelling, image and
   schematic panels arrive the same way.

   What it does: take a file, hash it locally, ask AIService, and put
   the answer in front of the user as a question. It does not classify
   and it does not decide. The rules live in the service; the decision
   belongs to the person reading the screen.

   The file never leaves the browser. It is read here only to compute
   a SHA-256, and from Stage 2 to measure geometry. What a provider
   may be shown is decided in ai.js, not here. */

(function () {

  if (!window.WorkspacePanels) return;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const t = (key, fallback, vars) => {
    const v = window.I18n ? I18n.t(key, vars || {}) : key;
    return v === key ? (fallback || key) : v;
  };

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

      function shell() {
        body.innerHTML = `
          <p class="ai-privacy">${esc(t('ai.privacy.local',
            'Your file is read in this browser only. Nothing is uploaded and nothing is sent to any AI service.'))}</p>

          <div class="panel-field">
            <label for="ai-file">${esc(t('ai.upload.label', 'Project file'))}</label>
            <input type="file" id="ai-file" data-ai-file>
          </div>

          <p class="field-note" data-ai-status role="status" aria-live="polite"></p>
          <div data-ai-result></div>`;
      }

      shell();

      const statusEl = () => body.querySelector('[data-ai-status]');
      const resultEl = () => body.querySelector('[data-ai-result]');

      function say(key, fallback, vars) {
        const el = statusEl();
        if (el) el.textContent = t(key, fallback, vars);
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

        /* Announced rather than applied. Stage 2e is what wires the
           confirmed process into the filter; until then other panels
           may listen without this one reaching into them. */
        ctx.bus.emit('classification:decided', {
          process: processKey,
          corrected: !wasSuggestion,
          logId: lastResult.logId || null,
          fileHash: lastResult.fileHash || null
        });
      }

      async function handleFile(file) {
        if (!file) return;
        resultEl().innerHTML = '';
        say('ai.reading', 'Reading the file…');

        let result;
        try {
          result = await AIService.classifyProject({
            file: file,
            features: {},                       /* geometry arrives in Stage 2 */
            description: (ctx.projectBrief || ''),
            processes: processes.map((p) => p.key)
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

        lastResult = result;
        say('', '');

        ClassificationConfirm.render(resultEl(), result, {
          processes: processes,
          onConfirm: (key) => decide(key, true),
          onChange:  (key) => decide(key, false)
        });
      }

      body.addEventListener('change', (e) => {
        const input = e.target.closest('[data-ai-file]');
        if (input && input.files && input.files[0]) handleFile(input.files[0]);
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
            'Your file is read in this browser only. Nothing is uploaded and nothing is sent to any AI service.');
        }
        const label = body.querySelector('label[for="ai-file"]');
        if (label) label.textContent = t('ai.upload.label', 'Project file');

        if (lastResult) {
          ClassificationConfirm.render(resultEl(), lastResult, {
            processes: processes,
            onConfirm: (key) => decide(key, true),
            onChange:  (key) => decide(key, false)
          });
        }
      });

      return { classify: handleFile };
    }
  });

})();
