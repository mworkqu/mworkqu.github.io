/* ── Workspace boot ────────────────────────────────────────
   Wires the project page to the panel registry. Everything
   page-specific lives here: the project id, the header, the notice
   line, the cancel button. The panels themselves know none of it
   beyond what ctx carries.

   Load order matters — this must come after every file that calls
   WorkspacePanels.register, because boot() renders whatever is in
   the registry at the moment it runs. A future tool panel is one
   more <script> tag above this one. */

(function () {

  const host = document.querySelector('[data-workspace]');
  if (!host) return;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);

  const t = (key, fallback) => {
    const v = window.I18n ? I18n.t(key) : key;
    return v === key ? (fallback || key) : v;
  };

  const $ = (sel) => document.querySelector(sel);

  async function start() {
    await Promise.all([
      DataStore.ready(),
      window.I18n ? I18n.ready() : Promise.resolve()
    ]);

    const projectId = new URLSearchParams(location.search).get('id');
    const project   = await DataStore.getProject(projectId);

    if (!project) {
      host.innerHTML = `<p class="ws-empty">${esc(
        t('workspace.notFound', 'That project could not be found.'))}</p>`;
      return;
    }

    /* ── header ─────────────────────────────────────── */

    function paintMeta(p) {
      $('[data-project-ref]').textContent   = p.id;
      $('[data-project-title]').textContent = p.title;
      $('[data-project-state]').textContent = p.state;
      $('[data-project-brief]').textContent = p.brief || '';
    }
    paintMeta(project);

    /* ── panels ─────────────────────────────────────── */

    const booted = await WorkspacePanels.boot(host, {
      projectId: projectId,
      /* The brief travels as the classifier's `description`. The rules
         provider ignores it; from Stage 3 it is the main signal. */
      projectBrief: project.brief || ''
    });
    const bus    = booted.ctx.bus;

    /* ── the notice line ────────────────────────────── */

    const notice = $('[data-ws-notice]');
    let noticeTimer = null;

    bus.on('notice', (e) => {
      if (!notice) return;
      const { kind, text } = e.detail;
      notice.textContent = text;
      notice.className = 'ws-notice is-' + (kind === 'error' ? 'error' : 'ok');
      clearTimeout(noticeTimer);
      /* Errors stay put — they usually need reading twice. */
      if (kind !== 'error') {
        noticeTimer = setTimeout(() => {
          notice.textContent = '';
          notice.className = 'ws-notice';
        }, 6000);
      }
    });

    bus.on('project:meta', async () => {
      const fresh = await DataStore.getProject(projectId);
      if (fresh) paintMeta(fresh);
    });
    bus.on('project:change', () => bus.emit('project:meta'));

    /* ── cancel ─────────────────────────────────────── */

    const cancelBtn = $('[data-cancel-project]');
    if (cancelBtn) {
      cancelBtn.hidden = project.state === 'CANCELLED';
      cancelBtn.addEventListener('click', async () => {
        if (!cancelBtn.dataset.armed) {
          cancelBtn.dataset.armed = '1';
          cancelBtn.textContent = t('workspace.cancelConfirm',
            'Cancel project — parts return to inventory. Click again');
          return;
        }
        /* Remove each line through the data layer so every part goes
           back the same way a single removal does. */
        const items = await DataStore.listProjectItems(projectId);
        for (const line of items) {
          await DataStore.removeFromProject(projectId, line.lineId);
        }
        ClientStore.setProjectState(projectId, 'CLOSED');
        const p = await DataStore.getProject(projectId);
        if (p) { p.state = 'CANCELLED'; }
        ClientStore._state().projects.forEach((x) => {
          if (x.id === projectId) x.state = 'CANCELLED';
        });
        ClientStore._write();
        cancelBtn.hidden = true;
        bus.emit('project:change');
        bus.emit('results:refresh');
        bus.emit('notice', { kind: 'ok',
          text: t('workspace.notice.cancelled', 'Project cancelled. Every part went back to your inventory.') });
      });
    }
  }

  start().catch((err) => {
    if (window.console) console.error('[workspace] boot failed', err);
    host.innerHTML = `<p class="ws-empty">${esc(
      t('workspace.bootFailed', 'The workspace could not start.'))}
      <br><code>python -m http.server 4173</code></p>`;
  });

})();
