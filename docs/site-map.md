# GESTALTUNG Website Map

This project is intentionally split into simple folders so future debugging and scaling stays easy.

## Current Structure

```txt
/
|-- index.html
|-- package.json
|-- assets/
|   |-- css/styles.css
|   |-- js/main.js
|   `-- img/hero-workshop.svg
|-- studio/index.html
|-- manufacturing/index.html
|-- shop/index.html
|-- projects/index.html
|-- about/index.html
|-- contact/index.html
|-- login/index.html
|-- login/client/index.html
|-- login/admin/index.html
|-- login/vendor/index.html
`-- dashboard/
    |-- index.html
    |-- client/index.html
    |-- admin/index.html
    |-- admin/users/index.html
    `-- vendor/index.html
```

## Scaling Notes

- Put shared visual styling in `assets/css/styles.css`.
- Put shared navigation behavior and small interactions in `assets/js/main.js`.
- Add route folders with their own `index.html` files, for example `studio/cad-modeling/index.html`.
- Keep forms as front-end HTML until the backend is chosen.
- Future backend candidates: static hosting plus form service, Next.js, Laravel, Django, or a headless CMS.

## Future URL Expansion

```txt
/studio/product-design
/studio/cad-modeling
/studio/reverse-engineering
/studio/consultation
/studio/start-project
/manufacturing/3d-printing
/manufacturing/cnc-machining
/manufacturing/laser-cutting
/manufacturing/upload
/shop/products
/shop/digital-files
/shop/educational-kits
/shop/customizable-products
/shop/cart
/shop/checkout
```
