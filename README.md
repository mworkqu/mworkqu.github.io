# GESTALTUNG

The website for **GESTALTUNG** — an engineering studio, manufacturing platform, and product-commerce system based in Doha, Qatar.

Live at **https://mworkqu.github.io**.

## Stack

Static HTML + CSS + vanilla JS. No build step, no framework. Hosted on GitHub Pages.

- **HTML** — one `index.html` per route folder
- **CSS** — single file at `assets/css/styles.css` (machine design system)
- **JS** — small modules in `assets/js/`, loaded as plain scripts
- **Data** — JSON in `data/`, fetched at runtime

## Structure

```
/                         homepage — hero, capability matrix, design space, stats, projects, CTA
/studio/                  design & engineering services + project request form
/manufacturing/           production capabilities + quote form
/shop/                    product catalogue (rendered from data/products.json)
/projects/                selected work (filterable)
/about/                   philosophy & principles
/contact/                 contact details + general enquiry form
/login/                   role selector (client / admin / vendor)
/login/{role}/            per-role sign-in
/dashboard/               role picker
/dashboard/client/                   overview — live counts and project list
/dashboard/client/projects/          project list + new-project form
/dashboard/client/projects/detail/   one project: parts list and quote  ?id=J-2026-0041
/dashboard/client/inventory/         parts the client owns
/dashboard/client/cart/              cart and orders
/dashboard/admin/                    overview + reorder alerts
/dashboard/admin/inventory/          store stock, receive, make a batch, ledger
/dashboard/admin/jobs/               every job, assign a workshop, release
/dashboard/admin/quotes/             client projects to price
/dashboard/admin/quotes/detail/      build and send a quote  ?id=J-2026-0041
/dashboard/admin/users/              user management
/dashboard/vendor/                   assigned jobs — no prices, no client names
/404.html                 custom not-found page
/favicon.svg              site favicon
/robots.txt /sitemap.xml  SEO
```

## Data

Nothing about a product is written in markup. To change a price, a stock
figure or the whole catalogue, edit one file:

| File | Holds |
|---|---|
| `data/products.json` | the shop catalogue — sku, price, `onHand`, `committed`, `reorderPoint` |
| `data/client-inventory.json` | seed data for the demo client's shelf and projects |
| `assets/js/product-art.js` | the line drawing for each product, keyed by its `art` field |

Adding a category to `products.json` adds its filter button; adding a product
adds its card. No HTML to touch.

### Scripts

| File | Does |
|---|---|
| `assets/js/store.js` | loads the catalogue, computes availability, formats money |
| `assets/js/shop.js` | renders the shop grid and the add-to-cart button |
| `assets/js/client-store.js` and `admin-store.js` | the two state layers and the movement rules |
| `assets/js/dash-shell.js` | the sidebar for all three roles, written once |
| `assets/js/client-pages.js` | one section per client dashboard page |
| `assets/js/admin-pages.js` | one section per admin and vendor page |
| `assets/js/main.js` | nav, scroll reveal, form interception, tag filters, stat counters |

## Inventory model

There are two separate inventories — the store's and each client's — and a
part is always either on a client's shelf or on one of his projects, never
both. The full rules, including what happens on order, delivery and
cancellation, are in **[docs/inventory-model.md](docs/inventory-model.md)**.

## Design system

"Machine" minimalism: 1px rule lines, warm stone background (`#ECEAE3`) with lighter card surfaces, JetBrains Mono for technical metadata, Inter for body and headlines. Design tokens live in `:root` (`--bg`, `--surface`, `--ink` and its opacity scale, `--rule`, `--px`, `--max`).

## Develop locally

```bash
python -m http.server 8000
```

Then visit http://localhost:8000. A server is required — the pages `fetch()`
their data, which the browser blocks on `file://`.

No build, no install, no dependencies.

## Demo mode

This site is a static prototype.

- Public forms (Studio brief, Manufacturing quote, Contact) intercept submit and show a success panel — no backend.
- Login forms navigate straight to the matching dashboard.
- **Client dashboard state is real but local.** Inventory, cart, projects and orders persist in `localStorage` under `gestaltung.client.v1`, seeded once from `data/client-inventory.json`. Clear that key to start over. Nothing leaves the browser.
- **Store stock is live too.** `data/products.json` is read-only; every change on top of it is a line in a stock ledger kept in `localStorage` under `gestaltung.admin.v1`. A demo purchase reserves stock, a delivery moves it, and a finished batch puts it back.
- Clear both `gestaltung.*` keys to reset everything to the seed.

To wire this to a real backend, replace the `fetch` in `store.js` and the
`localStorage` read/write pairs in `client-store.js` and `admin-store.js`;
everything above them is unchanged.

## License

All rights reserved · GESTALTUNG · Doha, Qatar
