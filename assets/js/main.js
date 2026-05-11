const menuToggle = document.querySelector("[data-menu-toggle]");
const navLinks = document.querySelector("[data-nav-links]");

if (menuToggle && navLinks) {
  menuToggle.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

document.querySelectorAll("[data-year]").forEach((node) => {
  node.textContent = new Date().getFullYear();
});

const userForm = document.querySelector("[data-user-form]");
const userTable = document.querySelector("[data-user-table]");
const userTableBody = document.querySelector("[data-user-table] tbody");

if (userForm && userTableBody) {
  userForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(userForm);
    const row = document.createElement("tr");
    ["name", "email", "role", "status"].forEach((key) => {
      const cell = document.createElement("td");
      cell.textContent = formData.get(key);
      row.append(cell);
    });
    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.className = "button secondary danger";
    removeButton.type = "button";
    removeButton.dataset.removeUser = "";
    removeButton.textContent = "Remove";
    actionCell.append(removeButton);
    row.append(actionCell);
    userTableBody.append(row);
    userForm.reset();
  });
}

if (userTable) {
  userTable.addEventListener("click", (event) => {
    if (event.target.matches("[data-remove-user]")) {
      event.target.closest("tr")?.remove();
    }
  });
}
