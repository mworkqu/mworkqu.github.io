/* ── Quote form cascade ────────────────────────────────────
   Mounts the shared Process → Material control into the quote form
   on /manufacturing/. Form mode, so the material select stays
   disabled until a process is picked and carries an "Other
   (specify)" option — clients do ask for materials that are not on
   the list, and losing that enquiry would be worse than an
   unrecognised string in the submission.

   The form itself still posts to '#' and is intercepted by the demo
   handler in main.js. */

(function () {

  const host = document.querySelector('[data-mfg-cascade]');
  if (!host || !window.ProcessCascade) return;

  ProcessCascade.mount(host, {
    mode: 'form',
    idPrefix: 'mfg',
    processName: 'process',
    materialName: 'material',
    otherName: 'materialOther'
  }).catch((err) => {
    /* A failed config fetch must not cost a lead: fall back to the
       free-text field the form had before. */
    if (window.console) console.error('[quote-form] cascade failed', err);
    host.innerHTML = `
      <div class="field">
        <label for="mfg-process-fallback">Process</label>
        <input type="text" id="mfg-process-fallback" name="process" placeholder="e.g. CNC Machining">
      </div>
      <div class="field">
        <label for="mfg-material-fallback">Material</label>
        <input type="text" id="mfg-material-fallback" name="material" placeholder="e.g. Aluminium 6061">
      </div>`;
  });

})();
