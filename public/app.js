const moduleGrid = document.querySelector("#moduleGrid");
const statusDialog = document.querySelector("#statusDialog");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogMessage = document.querySelector("#dialogMessage");
const dialogClose = document.querySelector("#dialogClose");

const icons = {
  "graduation-cap": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-5 9 5-9 5-9-5zM7 11v5c3 2 7 2 10 0v-5M21 9v6"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM22 7l-10 7L2 7"/></svg>`,
  "clipboard-check": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6M9 3h6v4H9zM7 5H5a2 2 0 0 0-2 2v13h18V7a2 2 0 0 0-2-2h-2M8 13l2 2 5-5"/></svg>`,
  route: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h3a4 4 0 0 0 4-4V9a4 4 0 0 1 4-4"/></svg>`,
  "book-open-check": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 5a3 3 0 0 1 3-3h6v18H5a3 3 0 0 0-3 2V5zM22 5a3 3 0 0 0-3-3h-6v18h6a3 3 0 0 1 3 2V5zM15 11l2 2 3-4"/></svg>`,
};

async function api(path) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showDialog(title, message) {
  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  if (typeof statusDialog.showModal === "function") statusDialog.showModal();
}

function renderModules(modules) {
  moduleGrid.replaceChildren();

  for (const module of modules) {
    const card = document.createElement("a");
    card.className = "module-card focus-ring";
    card.href = module.launchPath;
    card.target = "_blank";
    card.rel = "noopener";
    card.style.setProperty("--module-color", module.sourceColor);
    card.setAttribute("aria-label", `在目前瀏覽器開啟 ${module.name}`);

    const icon = document.createElement("span");
    icon.className = "module-icon";
    icon.innerHTML = icons[module.icon] || icons.route;

    const copy = document.createElement("span");
    copy.className = "module-card-copy";

    const title = document.createElement("h3");
    title.textContent = module.shortName;

    const description = document.createElement("p");
    description.textContent = module.description;

    const launch = document.createElement("span");
    launch.className = "module-launch";
    launch.innerHTML = `<span>使用目前瀏覽器的 ePortal session</span><span aria-hidden="true">↗</span>`;

    copy.append(title, description, launch);
    card.append(icon, copy);
    moduleGrid.append(card);
  }
}

async function initialize() {
  try {
    const { modules } = await api("/api/modules");
    renderModules(modules);
  } catch (error) {
    showDialog("載入失敗", error.message);
  }
}

dialogClose.addEventListener("click", () => statusDialog.close());

initialize();
