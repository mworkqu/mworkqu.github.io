/* ── Dashboard sidebar ─────────────────────────────────────
   One definition per role, rendered into [data-dash-sidebar].
   Adding a dashboard route means adding a line to NAV, not editing
   every page in the folder. */

(function () {

  const NAV = {

    client: [
      { key: 'overview',  label: 'Overview',      k: 'dash.nav.overview',  href: '/dashboard/client/' },
      { key: 'projects',  label: 'My projects',   k: 'dash.nav.projects',  href: '/dashboard/client/projects/' },
      { key: 'inventory', label: 'My inventory',  k: 'dash.nav.inventory', href: '/dashboard/client/inventory/' },
      { key: 'cart',      label: 'Cart & orders', k: 'dash.nav.cart',      href: '/dashboard/client/cart/' },
      { key: 'quotes',    label: 'Quotations',    k: 'dash.nav.quotes',    href: '#' },
      { key: 'files',     label: 'Files',         k: 'dash.nav.files',     href: '#' },
      { key: 'messages',  label: 'Messages',      k: 'dash.nav.messages',  href: '#' },
      { key: 'account',   label: 'Account',       k: 'dash.nav.account',   href: '#' }
    ],

    admin: [
      { key: 'overview',  label: 'Overview',    k: 'dash.nav.overview',   href: '/dashboard/admin/' },
      { key: 'inventory', label: 'Store stock', k: 'dash.nav.storeStock', href: '/dashboard/admin/inventory/' },
      { key: 'jobs',      label: 'Jobs',        k: 'dash.nav.jobs',       href: '/dashboard/admin/jobs/' },
      { key: 'quotes',    label: 'Quotes',      k: 'dash.nav.quotes',     href: '/dashboard/admin/quotes/' },
      { key: 'users',     label: 'Users',       k: 'dash.nav.users',      href: '/dashboard/admin/users/' },
      { key: 'ai',        label: 'AI insight',  k: 'dash.nav.ai',         href: '/dashboard/admin/ai/' },
      { key: 'analytics', label: 'Analytics',   k: 'dash.nav.analytics',  href: '#' }
    ],

    vendor: [
      { key: 'jobs',      label: 'My jobs',   k: 'dash.nav.myJobs',  href: '/dashboard/vendor/' },
      { key: 'account',   label: 'Account',   k: 'dash.nav.account', href: '#' }
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

  /* Falls back to the English literal when i18n has not loaded, so
     the sidebar is never a column of raw key names. */
  function label(item) {
    if (!window.I18n || !item.k) return item.label;
    const v = I18n.t(item.k);
    return v === item.k ? item.label : v;
  }

  function render() {
    const roleLabel = window.I18n ? I18n.t('dash.role.' + role) : role;
    host.innerHTML = `
      <p class="dash-role">${roleLabel.indexOf('dash.role') === 0 ? role : roleLabel}</p>
      <nav class="dash-nav">
        ${items.map((item) => {
          const n = badgeFor(item.key);
          return `
          <a class="dash-nav-link${item.key === active ? ' active' : ''}" href="${item.href}">
            <span>${label(item)}</span>
            ${n ? `<span class="dash-pill">${n}</span>` : ''}
          </a>`;
        }).join('')}
      </nav>
      <div class="dash-sidebar-foot">
        <a class="link-muted mono" href="/login/" data-i18n="dash.nav.signOut">${
          window.I18n ? I18n.t('dash.nav.signOut').replace('dash.nav.signOut', 'Sign out') : 'Sign out'}</a>
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
  document.addEventListener('i18n:ready',  render);
  document.addEventListener('i18n:change', render);

})();
