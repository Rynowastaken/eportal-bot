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
let runtime = {
  platform: "unknown",
  arch: "unknown",
  loginUiMode: "host",
  noVncEnabled: false,
};

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

  if (loggedIn) {
    portalStatusDetail.textContent = "persistent Chromium session 可直接產生新的 SSO。";
  } else if (runtime.noVncEnabled) {
    portalStatusDetail.textContent = "可直接在 Dashboard 內開啟官方 ePortal 登入畫面。";
  } else {
    portalStatusDetail.textContent = "登入會開在主機桌面；可設定 noVNC bridge 取得內嵌遠端畫面。";
  }

  browserStatusDot.className = `status-dot ${loggedIn ? "valid" : "invalid"}`;
  browserStatusText.textContent = loggedIn
    ? "已偵測到 ePortal 登入狀態。"
    : "請在 Chromium 中完成官方 ePortal 登入。";
}

async function refreshPortalStatus() {
  try {
    const status = await api("/api/browser/status");
    applyPortalStatus(status);
  } catch {
    portalStatusDot.className = "status-dot invalid";
    portalStatusTitle.textContent = "無法讀取 ePortal session";
    portalStatusDetail.textContent = "請先執行 npm run doctor 檢查目前系統環境。";
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

function hostLoginMessage() {
  const names = {
    darwin: "macOS",
    win32: "Windows",
    linux: "Linux",
  };
  const platformName = names[runtime.platform] || runtime.platform;
  return `官方 ePortal 已開在 ${platformName} 主機上的 persistent Chromium。完成登入後，這個 session 會同時給 SSO 與背景抓取使用。若要從遠端直接操作登入畫面，設定 PORTAL_NOVNC_TARGET 或使用支援的 noVNC runtime。`;
}

async function openIntegratedLogin() {
  try {
    const result = await api("/api/browser/open", {
      method: "POST",
      body: "{}",
    });

    applyPortalStatus(result);

    if (!runtime.noVncEnabled) {
      showDialog("ePortal 已在主機上開啟", hostLoginMessage());
      return;
    }

    novncLoading.classList.remove("hidden");
    browserStatusDot.className = "status-dot checking";
    browserStatusText.textContent = "正在連線到 persistent Chromium…";

    if (typeof browserDialog.showModal === "function" && !browserDialog.open) {
      browserDialog.showModal();
    }

    const nextSrc = noVncUrl();
    if (novncFrame.getAttribute("src") !== nextSrc) {
      novncFrame.src = nextSrc;
    }

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
    const result = await api("/api/browser/open", { method: "POST", body: "{}" });
    applyPortalStatus(result);
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
    const [{ modules }, serverStatus] = await Promise.all([
      api("/api/modules"),
      api("/api/server/status"),
    ]);

    runtime = { ...runtime, ...serverStatus };
    renderModules(modules);
    await refreshPortalStatus();
  } catch (error) {
    showDialog("載入失敗", error.message);
  }
})();
