/* ── Product line art ──────────────────────────────────────
   Keyed by the `art` field in data/products.json. Kept out of
   the data file so prices and stock stay easy to read and edit.
   Every drawing is a 100×100 viewBox on the card's stone panel. */

window.PRODUCT_ART = {

  'setting-blocks': `
    <rect x="20" y="42" width="60" height="16" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <rect x="42" y="20" width="16" height="60" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <circle cx="50" cy="50" r="6" stroke="rgba(25,23,20,.35)" stroke-width=".7" fill="none"/>
    <line x1="50" y1="20" x2="50" y2="42" stroke="rgba(25,23,20,.2)" stroke-width=".5" stroke-dasharray="3 2"/>
    <line x1="50" y1="58" x2="50" y2="80" stroke="rgba(25,23,20,.2)" stroke-width=".5" stroke-dasharray="3 2"/>`,

  'datum-frame': `
    <rect x="30" y="30" width="40" height="40" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <line x1="30" y1="50" x2="70" y2="50" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <line x1="50" y1="30" x2="50" y2="70" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <circle cx="50" cy="50" r="4" stroke="rgba(25,23,20,.3)" stroke-width=".6" fill="none"/>
    <rect x="20" y="46" width="10" height="8" stroke="rgba(25,23,20,.25)" stroke-width=".6"/>
    <rect x="70" y="46" width="10" height="8" stroke="rgba(25,23,20,.25)" stroke-width=".6"/>`,

  'taper-gauge': `
    <line x1="50" y1="20" x2="50" y2="80" stroke="rgba(25,23,20,.4)" stroke-width="1"/>
    <line x1="30" y1="30" x2="70" y2="30" stroke="rgba(25,23,20,.3)" stroke-width=".7"/>
    <line x1="35" y1="40" x2="65" y2="40" stroke="rgba(25,23,20,.2)" stroke-width=".6"/>
    <line x1="40" y1="50" x2="60" y2="50" stroke="rgba(25,23,20,.2)" stroke-width=".6"/>
    <line x1="44" y1="60" x2="56" y2="60" stroke="rgba(25,23,20,.15)" stroke-width=".5"/>
    <circle cx="50" cy="20" r="3" stroke="rgba(25,23,20,.3)" stroke-width=".6" fill="none"/>`,

  'v-block': `
    <rect x="25" y="55" width="50" height="12" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <rect x="32" y="35" width="36" height="20" stroke="rgba(25,23,20,.35)" stroke-width=".7"/>
    <rect x="38" y="25" width="24" height="10" stroke="rgba(25,23,20,.3)" stroke-width=".6"/>
    <line x1="25" y1="67" x2="20" y2="75" stroke="rgba(25,23,20,.25)" stroke-width=".6"/>
    <line x1="75" y1="67" x2="80" y2="75" stroke="rgba(25,23,20,.25)" stroke-width=".6"/>
    <circle cx="42" cy="45" r="3" stroke="rgba(25,23,20,.3)" stroke-width=".6" fill="none"/>
    <circle cx="58" cy="45" r="3" stroke="rgba(25,23,20,.3)" stroke-width=".6" fill="none"/>`,

  'sine-bar': `
    <rect x="22" y="60" width="56" height="8" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <line x1="30" y1="60" x2="30" y2="30" stroke="rgba(25,23,20,.35)" stroke-width=".7"/>
    <line x1="70" y1="60" x2="70" y2="30" stroke="rgba(25,23,20,.35)" stroke-width=".7"/>
    <line x1="30" y1="30" x2="70" y2="30" stroke="rgba(25,23,20,.3)" stroke-width=".7"/>
    <line x1="50" y1="60" x2="50" y2="30" stroke="rgba(25,23,20,.15)" stroke-width=".5" stroke-dasharray="4 3"/>
    <circle cx="30" cy="30" r="3" stroke="rgba(25,23,20,.25)" stroke-width=".6" fill="none"/>
    <circle cx="70" cy="30" r="3" stroke="rgba(25,23,20,.25)" stroke-width=".6" fill="none"/>`,

  'flat-square': `
    <rect x="28" y="28" width="44" height="44" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <rect x="36" y="36" width="28" height="28" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <circle cx="50" cy="50" r="8" stroke="rgba(25,23,20,.35)" stroke-width=".7" fill="none"/>
    <circle cx="36" cy="36" r="2" fill="rgba(25,23,20,.3)"/>
    <circle cx="64" cy="36" r="2" fill="rgba(25,23,20,.3)"/>
    <circle cx="36" cy="64" r="2" fill="rgba(25,23,20,.3)"/>
    <circle cx="64" cy="64" r="2" fill="rgba(25,23,20,.3)"/>`,

  'machined-pen': `
    <rect x="30" y="25" width="40" height="50" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <line x1="30" y1="35" x2="70" y2="35" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <circle cx="50" cy="60" r="10" stroke="rgba(25,23,20,.3)" stroke-width=".6" fill="none"/>
    <circle cx="50" cy="60" r="3" fill="rgba(25,23,20,.25)"/>
    <rect x="38" y="25" width="6" height="10" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <rect x="56" y="25" width="6" height="10" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>`,

  'card-stand': `
    <rect x="25" y="65" width="50" height="8" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <rect x="32" y="40" width="14" height="25" stroke="rgba(25,23,20,.35)" stroke-width=".7"/>
    <rect x="54" y="40" width="14" height="25" stroke="rgba(25,23,20,.35)" stroke-width=".7"/>
    <line x1="32" y1="52" x2="68" y2="52" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <rect x="38" y="30" width="24" height="10" stroke="rgba(25,23,20,.3)" stroke-width=".6"/>`,

  'compass-rose': `
    <circle cx="50" cy="50" r="26" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <circle cx="50" cy="50" r="18" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <circle cx="50" cy="50" r="4" fill="rgba(25,23,20,.35)"/>
    <line x1="50" y1="24" x2="50" y2="32" stroke="rgba(25,23,20,.3)" stroke-width="1"/>
    <line x1="50" y1="68" x2="50" y2="76" stroke="rgba(25,23,20,.3)" stroke-width="1"/>
    <line x1="24" y1="50" x2="32" y2="50" stroke="rgba(25,23,20,.3)" stroke-width="1"/>
    <line x1="68" y1="50" x2="76" y2="50" stroke="rgba(25,23,20,.3)" stroke-width="1"/>`,

  'dfm-checklist': `
    <rect x="22" y="28" width="56" height="44" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <line x1="22" y1="40" x2="78" y2="40" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <line x1="34" y1="28" x2="34" y2="40" stroke="rgba(25,23,20,.15)" stroke-width=".5"/>
    <line x1="46" y1="28" x2="46" y2="40" stroke="rgba(25,23,20,.15)" stroke-width=".5"/>
    <rect x="30" y="48" width="18" height="14" stroke="rgba(25,23,20,.25)" stroke-width=".6"/>
    <rect x="52" y="48" width="18" height="14" stroke="rgba(25,23,20,.25)" stroke-width=".6"/>
    <line x1="30" y1="70" x2="70" y2="70" stroke="rgba(25,23,20,.15)" stroke-width=".5"/>`,

  'drawing-template': `
    <rect x="30" y="25" width="40" height="50" stroke="rgba(25,23,20,.4)" stroke-width=".8"/>
    <line x1="36" y1="38" x2="64" y2="38" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <line x1="36" y1="46" x2="64" y2="46" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <line x1="36" y1="54" x2="54" y2="54" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <line x1="36" y1="62" x2="58" y2="62" stroke="rgba(25,23,20,.2)" stroke-width=".5"/>
    <rect x="56" y="20" width="12" height="14" stroke="rgba(25,23,20,.25)" stroke-width=".6"/>
    <line x1="60" y1="20" x2="60" y2="34" stroke="rgba(25,23,20,.15)" stroke-width=".5"/>`,

  'bracket-library': `
    <polygon points="50,20 80,65 20,65" stroke="rgba(25,23,20,.4)" stroke-width=".8" fill="none"/>
    <polygon points="50,34 69,64 31,64" stroke="rgba(25,23,20,.2)" stroke-width=".5" fill="none"/>
    <line x1="50" y1="20" x2="50" y2="65" stroke="rgba(25,23,20,.12)" stroke-width=".5" stroke-dasharray="4 3"/>
    <line x1="20" y1="65" x2="80" y2="65" stroke="rgba(25,23,20,.3)" stroke-width=".7"/>
    <text x="50" y="80" text-anchor="middle" font-family="monospace" font-size="8" fill="rgba(25,23,20,.3)">STEP &#183; IGES</text>`

};
