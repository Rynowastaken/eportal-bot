const EPORTAL_ORIGIN = "https://eportal.nutc.edu.tw";
const EPORTAL_CHECK = "https://eportal.nutc.edu.tw/nutc_dashboard/";
const USERSCRIPT_SOURCE = "nutc-portal-userscript";

const moduleGrid = document.querySelector("#moduleGrid");
const loginButton = document.querySelector("#loginButton");
const sessionLoginButton = document.querySelector("#sessionLoginButton");
const portalStatusDot = document.querySelector("#portalStatusDot");
const portalStatusTitle = document.querySelector("#portalStatusTitle");
const portalStatusDetail = document.querySelector("#portalStatusDetail");

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

let authWindow = null;
let authWindowTimer = null;
let pendingNonce = null;
let authState = "unknown";

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

function setAuthState(state, detail) {
  authState = state;
  portalStatusDot.className = `status-dot ${state}`;

  if (state === "valid") {
    portalStatusTitle.textContent = "ePortal 已確認登入";
    portalStatusDetail.textContent =
      detail || "目前瀏覽器已完成官方 ePortal 登入，可直接使用各系統。";
    sessionStorage.setItem("nutcPortalVerifiedAt", String(Date.now()));
    return;
  }

  if (state === "checking") {
    portalStatusTitle.textContent = "正在檢查 ePortal";
    portalStatusDetail.textContent =
      detail || "若 session 還有效會立即確認；失效時才需要在官方頁面重新登入。";
    return;
  }

  if (state === "invalid") {
    portalStatusTitle.textContent = "ePortal 登入未完成";
    portalStatusDetail.textContent =
      detail || "重新點擊「檢查 / 登入 ePortal」即可再試一次。";
    return;
  }

  portalStatusTitle.textContent = "ePortal 尚未檢查";
  portalStatusDetail.textContent =
    detail || "可直接開啟系統；若想確認登入狀態，再按「檢查 / 登入 ePortal」。";
}

function closeAuthTracking() {
  if (authWindowTimer) {
    clearInterval(authWindowTimer);
    authWindowTimer = null;
  }
}

function startAuthWindowWatch() {
  closeAuthTracking();

  authWindowTimer = setInterval(() => {
    if (!authWindow) return;

    if (authWindow.closed) {
      closeAuthTracking();
      authWindow = null;

      if (authState !== "valid") {
        setAuthState(
          "invalid",
          "檢查視窗已關閉，但 Dashboard 沒有收到成功通知。請確認 NUTC Portal Userscript 已啟用。",
        );
      }
    }
  }, 500);
}

function createNonce() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function buildCheckUrl(nonce) {
  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.delete("eportalAuth");
  returnUrl.searchParams.delete("nonce");

  const checkUrl = new URL(EPORTAL_CHECK);
  checkUrl.hash = new URLSearchParams({
    "nutc-portal-bridge": "login",
    "nutc-portal-nonce": nonce,
    "nutc-portal-return": returnUrl.toString(),
  }).toString();

  return checkUrl.toString();
}

function openAuthFlow() {
  pendingNonce = createNonce();

  setAuthState(
    "checking",
    "正在確認目前瀏覽器的 ePortal session；只有失效時才需要重新登入。",
  );

  authWindow = window.open(
    buildCheckUrl(pendingNonce),
    "nutcEportalAuth",
    "popup=yes,width=1100,height=820,resizable=yes,scrollbars=yes",
  );

  if (!authWindow) {
    pendingNonce = null;
    setAuthState("unknown");
    showDialog(
      "瀏覽器阻擋了檢查視窗",
      "請允許這個 Dashboard 開啟 popup，然後再點一次「檢查 / 登入 ePortal」。",
    );
    return;
  }

  authWindow.focus();
  startAuthWindowWatch();
}

function finishAuthCheck() {
  pendingNonce = null;

  if (authWindow && !authWindow.closed) {
    authWindow.close();
  }

  authWindow = null;
  closeAuthTracking();
}

function handleBridgeMessage(event) {
  if (event.origin !== EPORTAL_ORIGIN) return;
  if (!event.data || event.data.source !== USERSCRIPT_SOURCE) return;
  if (event.data.type !== "auth-status" || event.data.loggedIn !== true) return;
  if (!pendingNonce || event.data.nonce !== pendingNonce) return;

  setAuthState("valid", "Userscript 已確認目前瀏覽器的 ePortal session 仍有效。");
  finishAuthCheck();
}

function consumeMobileReturn() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("eportalAuth") !== "ok") return false;

  url.searchParams.delete("eportalAuth");
  url.searchParams.delete("nonce");
  history.replaceState(null, "", url.pathname + url.search + url.hash);

  setAuthState(
    "valid",
    "Userscript 已確認手機瀏覽器的 ePortal session 仍有效。",
  );

  return true;
}

function openModule(module) {
  // Do not preflight through the login page. The official module entry is the
  // authoritative session check: valid sessions SSO immediately; expired
  // sessions are sent to the official login flow and then continue onward.
  const opened = window.open(module.launchPath, "_blank", "noopener");

  if (!opened) {
    showDialog(
      "瀏覽器阻擋了新分頁",
      "請允許這個 Dashboard 開啟新分頁，再重新點一次系統卡片。",
    );
  }
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
    copy.className = "module-card-copy";

    const title = document.createElement("h3");
    title.textContent = module.shortName;

    const description = document.createElement("p");
    description.textContent = module.description;

    const launch = document.createElement("span");
    launch.className = "module-launch";
    launch.innerHTML =
      `<span>直接使用目前的 ePortal session</span><span aria-hidden="true">↗</span>`;

    copy.append(title, description, launch);
    button.append(icon, copy);
    button.addEventListener("click", () => openModule(module));
    moduleGrid.append(button);
  }
}

loginButton.addEventListener("click", openAuthFlow);
sessionLoginButton.addEventListener("click", openAuthFlow);
window.addEventListener("message", handleBridgeMessage);
dialogClose.addEventListener("click", () => statusDialog.close());

(async () => {
  try {
    const { modules } = await api("/api/modules");
    renderModules(modules);

    if (consumeMobileReturn()) return;

    const lastVerified = Number(sessionStorage.getItem("nutcPortalVerifiedAt") || 0);
    if (lastVerified && Date.now() - lastVerified < 30 * 60 * 1000) {
      setAuthState(
        "valid",
        "這個 Dashboard 分頁最近已確認過登入；系統卡片會直接使用目前 session。",
      );
    } else {
      setAuthState("unknown");
    }
  } catch (error) {
    showDialog("載入失敗", error.message);
  }
})();
