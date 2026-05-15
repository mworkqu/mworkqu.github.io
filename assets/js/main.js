/* ── Nav scroll shadow ─────────────────────────────────── */
const nav = document.querySelector(".g-nav");
if (nav) {
  window.addEventListener("scroll", () => {
    nav.classList.toggle("scrolled", window.scrollY > 8);
  }, { passive: true });
}

/* ── Mobile menu toggle ────────────────────────────────── */
const menuToggle = document.querySelector("[data-menu-toggle]");
const navLinks   = document.querySelector("[data-nav-links]");
if (menuToggle && navLinks) {
  menuToggle.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

/* ── Year injection ────────────────────────────────────── */
document.querySelectorAll("[data-year]").forEach((n) => {
  n.textContent = new Date().getFullYear();
});

/* ── Scroll reveal ─────────────────────────────────────── */
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }),
  { threshold: 0.08 }
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

/* ── Stat counter (animate up on scroll) ───────────────── */
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

document.querySelectorAll('.stat-value').forEach((el) => {
  if (prefersReducedMotion) return;

  // The number text lives as a direct text node before the .stat-unit child.
  // Find that text node, parse its number, and animate it without disturbing the unit.
  const textNode = Array.from(el.childNodes).find(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()
  );
  if (!textNode) return;

  const raw = textNode.textContent;
  const m   = raw.match(/^(\D*)(-?\d+(?:\.\d+)?)(.*)$/s);
  if (!m) return;
  const [, prefix, numStr, suffix] = m;
  const target   = parseFloat(numStr);
  const decimals = (numStr.split('.')[1] || '').length;
  const format   = (v) => `${prefix}${v.toFixed(decimals)}${suffix}`;

  textNode.textContent = format(0);

  const obs = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const duration = 1400;
      const start    = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        textNode.textContent = format(target * eased);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      obs.disconnect();
    });
  }, { threshold: 0.3 });
  obs.observe(el);
});

/* ── CAD layer toggles (Design Space demo) ─────────────── */
document.querySelectorAll('.cad-layer').forEach((row) => {
  row.setAttribute('role', 'button');
  row.setAttribute('tabindex', '0');
  const toggle = () => {
    const off = row.classList.toggle('dim');
    const eye = row.querySelector('.layer-eye');
    if (eye) {
      eye.classList.toggle('off', off);
      eye.textContent = off ? '○' : '●';
    }
  };
  row.addEventListener('click', toggle);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
});

/* ── Tag filtering (Shop / Projects) ───────────────────── */
document.querySelectorAll('[data-filter-group]').forEach((group) => {
  const groupName = group.dataset.filterGroup;
  const target    = document.querySelector(`[data-filter-target="${groupName}"]`);
  const counter   = document.querySelector(`[data-filter-count="${groupName}"]`);
  if (!target) return;

  const cards = Array.from(target.children);
  const total = cards.length;

  group.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;

    group.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');

    const filter = btn.dataset.filter;
    let shown = 0;
    cards.forEach((card) => {
      const tags = (card.dataset.tags || '').split(/\s+/);
      const match = filter === 'all' || tags.includes(filter);
      card.style.display = match ? '' : 'none';
      if (match) shown++;
    });
    if (counter) counter.textContent = `${shown} of ${total}`;
  });
});

/* ── Demo form interception ────────────────────────────── */
/* Public forms (studio brief / manufacturing quote / contact) post to '#'.
   Until a real backend is wired up, swap them for a success panel so the
   user gets clear feedback and we don't lose leads silently. */
document.querySelectorAll('form.g-form').forEach((form) => {
  if (form.hasAttribute('data-user-form')) return;          // admin user CRUD
  if (form.getAttribute('action') !== '#') return;          // login forms etc.

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name  = form.querySelector('[name="name"]')?.value?.trim();
    const email = form.querySelector('[name="email"]')?.value?.trim();

    const panel = document.createElement('div');
    panel.className = 'form-success';
    panel.setAttribute('role', 'status');
    panel.innerHTML = `
      <p class="form-success-label"><span class="dot-live"></span> Received</p>
      <h4>Thank you${name ? ', ' + escapeHtml(name) : ''} — your message is queued.</h4>
      <p>A senior engineer will review your brief and respond${email ? ' to <strong>' + escapeHtml(email) + '</strong>' : ''} within 24 hours, working days.</p>
      <p class="form-success-note">Demo mode · static prototype · no email was actually sent</p>
    `;
    form.replaceWith(panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

/* ── User management table (admin/users) ───────────────── */
const userForm      = document.querySelector("[data-user-form]");
const userTable     = document.querySelector("[data-user-table]");
const userTableBody = document.querySelector("[data-user-table] tbody");

if (userForm && userTableBody) {
  userForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd  = new FormData(userForm);
    const row = document.createElement("tr");
    ["name","email","role","status"].forEach((k) => {
      const td = document.createElement("td");
      if (k === "status") {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = fd.get(k);
        td.append(badge);
      } else {
        td.textContent = fd.get(k);
      }
      row.append(td);
    });
    const actionTd = document.createElement("td");
    const btn = document.createElement("button");
    btn.className   = "btn-table danger";
    btn.type        = "button";
    btn.dataset.removeUser = "";
    btn.textContent = "Remove";
    actionTd.append(btn);
    row.append(actionTd);
    userTableBody.append(row);
    userForm.reset();
  });
}

if (userTable) {
  userTable.addEventListener("click", (e) => {
    if (e.target.matches("[data-remove-user]")) {
      e.target.closest("tr")?.remove();
    }
  });
}
