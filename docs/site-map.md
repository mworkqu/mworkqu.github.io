# GESTALTUNG Website Map

This project is intentionally split into simple folders so future debugging and scaling stays easy.

## Current Structure

```txt
/
|-- index.html
|-- package.json
|-- data/
|   |-- products.json            shop catalogue: price, stock, reorder point
|   `-- client-inventory.json    seed data for the demo client
|-- assets/
|   |-- css/styles.css
|   |-- js/main.js               nav, reveal, filters, form interception
|   |-- js/store.js              catalogue loader + availability
|   |-- js/product-art.js        per-product line drawings
|   |-- js/shop.js               shop grid
|   |-- js/client-store.js       client inventory, cart, projects, orders
|   |-- js/admin-store.js        store stock ledger and jobs
|   |-- js/dash-shell.js         sidebar for all three roles
|   |-- js/client-pages.js       client dashboard page logic
|   |-- js/admin-pages.js        admin and vendor page logic
|   `-- img/hero-workshop.svg
|-- studio/index.html
|-- manufacturing/index.html
|-- shop/index.html
|-- projects/index.html
|-- about/index.html
|-- contact/index.html
|-- faq/index.html
|-- login/index.html
|-- login/client/index.html
|-- login/admin/index.html
|-- login/vendor/index.html
`-- dashboard/
    |-- index.html
    |-- client/index.html                    overview
    |-- client/projects/index.html           project list + new project
    |-- client/projects/detail/index.html    parts list  (?id=J-2026-0041)
    |-- client/inventory/index.html          parts the client owns
    |-- client/cart/index.html               cart and orders
    |-- admin/index.html                     overview + reorder alerts
    |-- admin/inventory/index.html           stock, receive, batches, ledger
    |-- admin/jobs/index.html                every job
    |-- admin/quotes/index.html              projects to price
    |-- admin/quotes/detail/index.html       build a quote  (?id=J-2026-0041)
    |-- admin/users/index.html
    `-- vendor/index.html                    assigned jobs only
```

## Where things live

- Shared visual styling goes in `assets/css/styles.css`.
- Shared navigation behaviour and small interactions go in `assets/js/main.js`.
- **Product facts go in `data/products.json`, never in markup.** The shop grid,
  the client's part picker and the cart all read from it.
- Client pages carry `data-client-page` on `<body>`; admin and vendor pages
  carry `data-dash-page`. The matching section in `client-pages.js` or
  `admin-pages.js` takes over from there.
- All three sidebars are defined once in `assets/js/dash-shell.js`. Add a
  dashboard route by adding it to that role's `NAV` array.
- Store `onHand` is derived from a ledger, never typed. Write movements with
  `AdminStore.receive` / `markReady`, not by editing a quantity.
- Keep forms as front-end HTML until the backend is chosen.
- Future backend candidates: static hosting plus form service, Next.js, Laravel, Django, or a headless CMS.

## The inventory rules

See **[inventory-model.md](inventory-model.md)** for the store/client split,
the three stock numbers, and what moves on order, delivery and cancellation.

## Future URL Expansion

```txt
/studio/product-design
/studio/cad-modeling
/studio/reverse-engineering
/manufacturing/3d-printing
/manufacturing/cnc-machining
/manufacturing/upload
/shop/checkout
```
