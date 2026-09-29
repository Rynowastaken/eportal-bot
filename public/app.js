const moduleGrid = document.querySelector("#moduleGrid");
const serverStatusButton = document.querySelector("#serverStatusButton");
const serverStatusDot = document.querySelector("#serverStatusDot");
const serverStatusText = document.querySelector("#serverStatusText");
const serverStatusMenu = document.querySelector("#serverStatusMenu");
const serverLoginAction = document.querySelector("#serverLoginAction");
const serverLogoutAction = document.querySelector("#serverLogoutAction");

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
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function setServerStatus(status) {
  const state = status?.status || "error";
  const bridgeActive = Boolean(status?.loginBridge?.active);

  let kind = "invalid";
  let label = "需登入";
  let detail = "Server ePortal 尚未登入";
  let canLogout = false;

  if (bridgeActive || state === "busy") {
    kind = "checking";
    label = "使用中";
    detail = "Server ePortal 正在使用中";
  } else if (state === "valid") {
    kind = "valid";
    label = "已連線";
    detail = "Server ePortal 已登入";
    canLogout = true;
  } else if (state === "error") {
    kind = "invalid";
    label = "重試";
    detail = status?.error || "無法檢查 Server ePortal";
  }

  serverStatusDot.className = `status-dot ${kind}`;
  serverStatusText.textContent = label;
  serverStatusButton.title = detail;
  serverStatusButton.setAttribute("aria-label", detail);

  serverLoginAction.textContent = canLogout ? "重新登入" : "登入";
  serverLogoutAction.classList.toggle("hidden", !canLogout);
}

function openModule(module) {
  window.location.assign(module.launchPath);
}

function renderModules(modules) {
  moduleGrid.replaceChildren();

  for (const module of modules) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "module-card focus-ring";
    button.style.setProperty("--module-color", module.sourceColor);
    button.setAttribute("aria-label", `開啟 ${module.name}`);

    const icon = document.createElement("span");
    icon.className = "module-icon";
    icon.innerHTML = icons[module.icon] || icons.route;

    const copy = document.createElement("span");
    copy.className = "module-copy";

    const title = document.createElement("h3");
    title.textContent = module.shortName;

    const description = document.createElement("p");
    description.textContent = module.description;

    const launch = document.createElement("span");
    launch.className = "module-launch";
    launch.innerHTML = `<span>開啟</span><span aria-hidden="true">→</span>`;

    copy.append(title, description, launch);
    button.append(icon, copy);
    button.addEventListener("click", () => openModule(module));
    moduleGrid.append(button);
  }
}

function showLoadError(message) {
  moduleGrid.replaceChildren();

  const card = document.createElement("div");
  card.className = "load-error";
  card.textContent = message || "校務系統載入失敗。";
  moduleGrid.append(card);
}

function setServerMenuOpen(open) {
  serverStatusMenu.classList.toggle("hidden", !open);
  serverStatusButton.setAttribute("aria-expanded", String(open));
}

serverStatusButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = serverStatusButton.getAttribute("aria-expanded") === "true";
  setServerMenuOpen(!open);
});

serverLoginAction.addEventListener("click", () => {
  window.location.assign("/server-login/");
});

serverLogoutAction.addEventListener("click", async () => {
  if (serverLogoutAction.disabled) return;

  serverLogoutAction.disabled = true;
  serverLogoutAction.textContent = "登出中…";

  try {
    const response = await fetch("/api/portal-logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Logout failed (${response.status})`);
    }

    setServerStatus({
      status: data.status || "needs-login",
      loginBridge: { active: false },
    });
    setServerMenuOpen(false);
  } catch (error) {
    console.error("Server ePortal logout failed:", error);
    serverStatusButton.title = error.message;
  } finally {
    serverLogoutAction.disabled = false;
    serverLogoutAction.textContent = "登出";
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".server-menu")) {
    setServerMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setServerMenuOpen(false);
    serverStatusButton.focus();
  }
});

(async () => {
  const results = await Promise.allSettled([
    api("/api/modules"),
    api("/api/portal-status"),
  ]);

  const [modulesResult, statusResult] = results;

  if (modulesResult.status === "fulfilled") {
    renderModules(modulesResult.value.modules || []);
  } else {
    showLoadError(modulesResult.reason?.message);
  }

  if (statusResult.status === "fulfilled") {
    setServerStatus(statusResult.value);
  } else {
    setServerStatus({ status: "error", error: statusResult.reason?.message });
  }
})();
