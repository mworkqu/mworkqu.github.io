/* ── Dashboard sidebar ─────────────────────────────────────
   One definition per role, rendered into [data-dash-sidebar].
   Adding a dashboard route means adding a line to NAV, not editing
   every page in the folder. */

(function () {

  const NAV = {

    client: [
      { key: 'overview',  label: 'Overview',      href: '/dashboard/client/' },
      { key: 'projects',  label: 'My projects',   href: '/dashboard/client/projects/' },
      { key: 'inventory', label: 'My inventory',  href: '/dashboard/client/inventory/' },
      { key: 'cart',      label: 'Cart & orders', href: '/dashboard/client/cart/' },
      { key: 'quotes',    label: 'Quotations',    href: '#' },
      { key: 'files',     label: 'Files',         href: '#' },
      { key: 'messages',  label: 'Messages',      href: '#' },
      { key: 'account',   label: 'Account',       href: '#' }
    ],

    admin: [
      { key: 'overview',  label: 'Overview',    href: '/dashboard/admin/' },
      { key: 'inventory', label: 'Store stock', href: '/dashboard/admin/inventory/' },
      { key: 'jobs',      label: 'Jobs',        href: '/dashboard/admin/jobs/' },
      { key: 'quotes',    label: 'Quotes',      href: '/dashboard/admin/quotes/' },
      { key: 'users',     label: 'Users',       href: '/dashboard/admin/users/' },
      { key: 'analytics', label: 'Analytics',   href: '#' }
    ],

    vendor: [
      { key: 'jobs',      label: 'My jobs',   href: '/dashboard/vendor/' },
      { key: 'account',   label: 'Account',   href: '#' }
    ]

  };

  const host = document.querySelector('[data-dash-sidebar]');
  if (!host) return;

  const role   = host.dataset.role || 'client';
  const active = host.dataset.active || '';
  const items  = NAV[role] || [];

  /* Counts that are worth seeing without opening the page. */
  function badgeFor(key) {
    try {
      if (role === 'client' && key === 'cart') {
        return ClientStore.cart().reduce((n, l) => n + l.qty, 0);
      }
      if (role === 'admin' && key === 'jobs') {
        return AdminStore.jobs().filter((j) => j.state !== 'READY').length;
      }
      if (role === 'vendor' && key === 'jobs') {
        return AdminStore.forVendor(window.VENDOR_NAME || 'Workshop A')
          .filter((j) => j.state !== 'READY').length;
      }
    } catch (e) { /* stores not ready yet */ }
    return 0;
  }

  function render() {
    host.innerHTML = `
      <p class="dash-role">${role}</p>
      <nav class="dash-nav">
        ${items.map((item) => {
          const n = badgeFor(item.key);
          return `
          <a class="dash-nav-link${item.key === active ? ' active' : ''}" href="${item.href}">
            <span>${item.label}</span>
            ${n ? `<span class="dash-pill">${n}</span>` : ''}
          </a>`;
        }).join('')}
      </nav>
      <div class="dash-sidebar-foot">
        <a class="link-muted mono" href="/login/">Sign out</a>
      </div>`;
  }

  render();

  /* Draw again once the stores have loaded — the counts are
     unknown until then. */
  const stores = [];
  if (window.ClientStore) stores.push(ClientStore.ready());
  if (window.AdminStore)  stores.push(AdminStore.ready());
  Promise.all(stores).then(render).catch(() => {});

  document.addEventListener('clientstore:change', render);
  document.addEventListener('adminstore:change', render);

})();
