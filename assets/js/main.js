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
