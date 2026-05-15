# GESTALTUNG

The website for **GESTALTUNG** — an engineering studio, manufacturing platform, and product-commerce system based in Doha, Qatar.

Live at **https://mworkqu.github.io**.

## Stack

Static HTML + CSS + vanilla JS. No build step, no framework. Hosted on GitHub Pages.

- **HTML** — one `index.html` per route folder
- **CSS** — single file at `assets/css/styles.css` (machine design system)
- **JS** — single file at `assets/js/main.js` (nav, scroll reveal, form interception, tag filters, CAD layer toggle, stat counters)

## Structure

```
/                         homepage — hero, capability matrix, design space, stats, projects, CTA
/studio/                  design & engineering services + project request form
/manufacturing/           production capabilities + quote form
/shop/                    product catalogue (filterable)
/projects/                selected work (filterable)
/about/                   philosophy & principles
/contact/                 contact details + general enquiry form
/login/                   role selector (client / admin / vendor)
/login/{role}/            per-role sign-in
/dashboard/{role}/        per-role dashboard (demo data)
/dashboard/admin/users/   user management table
/404.html                 custom not-found page
/favicon.svg              site favicon
/robots.txt /sitemap.xml  SEO
```

## Design system

"Machine" minimalism: 0.5px rule lines, soft off-white background (`#F5F5F3`) with white card surfaces, JetBrains Mono for technical metadata, Inter 200/300/400 for body and headlines. The only fully dark element per view is `.btn-machine`. Design tokens live in `:root` (`--bg`, `--surface`, `--ink`, `--rule`, `--muted`, `--dim`, `--px`, `--max`).

## Develop locally

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

No build, no install, no dependencies.

## Demo mode

This site is a static prototype. Forms (Studio brief, Manufacturing quote, Contact) intercept submit in JS and show a success panel — no backend is wired up. Login forms navigate straight to the matching dashboard. Dashboards display sample data labelled with a "DEMO" strip.

To wire forms to a real backend, replace the demo handler in `assets/js/main.js` with a `fetch()` to your endpoint (Formspree, Netlify Forms, or your own API).

## License

All rights reserved · GESTALTUNG · Doha, Qatar
