const moduleGrid = document.querySelector("#moduleGrid");
const portalStatusDot = document.querySelector("#portalStatusDot");
const portalStatusTitle = document.querySelector("#portalStatusTitle");
const portalStatusDetail = document.querySelector("#portalStatusDetail");

const browserDialog = document.querySelector("#browserDialog");
const browserStatusDot = document.querySelector("#browserStatusDot");
const browserStatusText = document.querySelector("#browserStatusText");
const browserHome = document.querySelector("#browserHome");
const browserClose = document.querySelector("#browserClose");
const browserDone = document.querySelector("#browserDone");
const novncFrame = document.querySelector("#novncFrame");
const novncLoading = document.querySelector("#novncLoading");

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

let browserStatusTimer = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function showDialog(title, message) {
  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  if (typeof statusDialog.showModal === "function") statusDialog.showModal();
}

function applyPortalStatus(status) {
  const loggedIn = Boolean(status?.loggedIn);

  portalStatusDot.className = `status-dot ${loggedIn ? "valid" : "invalid"}`;
  portalStatusTitle.textContent = loggedIn ? "ePortal 已登入" : "ePortal 尚未登入";
  portalStatusDetail.textContent = loggedIn
    ? "persistent Chromium session 可直接產生新的 SSO。"
    : "開啟整合式登入，在官方 ePortal 完成登入即可。";

  browserStatusDot.className = `status-dot ${loggedIn ? "valid" : "invalid"}`;
  browserStatusText.textContent = loggedIn
    ? "已偵測到 ePortal 登入狀態。可關閉此視窗並使用下方模組。"
    : "請在下方 Chromium 畫面完成官方 ePortal 登入。";
}

async function refreshPortalStatus() {
  try {
    const status = await api("/api/browser/status");
    applyPortalStatus(status);
  } catch {
    portalStatusDot.className = "status-dot invalid";
    portalStatusTitle.textContent = "無法讀取 ePortal session";
    portalStatusDetail.textContent = "請確認 Chromium / noVNC 服務是否正常。";
  }
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
    card.setAttribute("aria-label", `開啟 ${module.name}`);

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
    launch.innerHTML = `<span>由共用 ePortal session 產生 SSO</span><span aria-hidden="true">↗</span>`;

    copy.append(title, description, launch);
    card.append(icon, copy);
    moduleGrid.append(card);
  }
}

function noVncUrl() {
  const params = new URLSearchParams({
    autoconnect: "true",
    reconnect: "true",
    resize: "scale",
    path: "novnc/websockify",
  });
  return `/novnc/vnc.html?${params.toString()}`;
}

async function openIntegratedLogin() {
  try {
    novncLoading.classList.remove("hidden");
    browserStatusDot.className = "status-dot checking";
    browserStatusText.textContent = "正在將 persistent Chromium 導向官方 ePortal…";

    if (typeof browserDialog.showModal === "function" && !browserDialog.open) {
      browserDialog.showModal();
    }

    await api("/api/browser/open", {
      method: "POST",
      body: "{}",
    });

    const nextSrc = noVncUrl();
    if (novncFrame.getAttribute("src") !== nextSrc) {
      novncFrame.src = nextSrc;
    }

    await refreshPortalStatus();

    clearInterval(browserStatusTimer);
    browserStatusTimer = setInterval(refreshPortalStatus, 2000);
  } catch (error) {
    showDialog("無法開啟 ePortal", error.message);
    if (browserDialog.open) browserDialog.close();
  }
}

function closeIntegratedLogin() {
  clearInterval(browserStatusTimer);
  browserStatusTimer = null;
  if (browserDialog.open) browserDialog.close();
  refreshPortalStatus();
}

for (const button of document.querySelectorAll("[data-open-eportal]")) {
  button.addEventListener("click", openIntegratedLogin);
}

browserHome.addEventListener("click", async () => {
  try {
    browserStatusDot.className = "status-dot checking";
    browserStatusText.textContent = "正在重新開啟官方 ePortal…";
    await api("/api/browser/open", { method: "POST", body: "{}" });
    await refreshPortalStatus();
  } catch (error) {
    showDialog("無法重新開啟 ePortal", error.message);
  }
});

browserClose.addEventListener("click", closeIntegratedLogin);
browserDone.addEventListener("click", closeIntegratedLogin);

novncFrame.addEventListener("load", () => {
  novncLoading.classList.add("hidden");
});

dialogClose.addEventListener("click", () => statusDialog.close());

(async () => {
  try {
    const { modules } = await api("/api/modules");
    renderModules(modules);
    await refreshPortalStatus();
  } catch (error) {
    showDialog("載入失敗", error.message);
  }
})();
