const EPORTAL_ORIGIN = "https://eportal.nutc.edu.tw";
const EPORTAL_LOGIN = "https://eportal.nutc.edu.tw/login_main.php";
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
let pendingModulePath = null;
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
    portalStatusTitle.textContent = "正在等待 ePortal";
    portalStatusDetail.textContent =
      detail || "請在剛開啟的官方 ePortal 視窗完成登入。";
    return;
  }

  if (state === "invalid") {
    portalStatusTitle.textContent = "ePortal 登入未完成";
    portalStatusDetail.textContent =
      detail || "重新點擊登入或系統卡片即可再試一次。";
    return;
  }

  portalStatusTitle.textContent = "ePortal 尚未檢查";
  portalStatusDetail.textContent =
    detail || "點登入或任一系統卡片即可檢查。";
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
        pendingModulePath = null;
        setAuthState(
          "invalid",
          "登入視窗已關閉，但 Dashboard 沒有收到成功通知。請確認 NUTC Portal Userscript 已啟用。",
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

function buildLoginUrl(modulePath, nonce) {
  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.delete("eportalAuth");
  returnUrl.searchParams.delete("nonce");
  returnUrl.searchParams.delete("eportalModule");

  if (modulePath) {
    returnUrl.searchParams.set("eportalModule", modulePath);
  }

  const loginUrl = new URL(EPORTAL_LOGIN);
  const bridge = new URLSearchParams({
    "nutc-portal-bridge": "login",
    "nutc-portal-nonce": nonce,
    "nutc-portal-return": returnUrl.toString(),
  });

  loginUrl.hash = bridge.toString();
  return loginUrl.toString();
}

function openAuthFlow(modulePath = null) {
  pendingModulePath = modulePath;
  pendingNonce = createNonce();

  setAuthState(
    "checking",
    modulePath
      ? "先確認 ePortal 登入；成功後會自動繼續開啟你剛才選的系統。"
      : "請在官方 ePortal 視窗完成登入；成功後狀態會自動更新。",
  );

  authWindow = window.open(
    buildLoginUrl(modulePath, pendingNonce),
    "nutcEportalAuth",
    "popup=yes,width=1100,height=820,resizable=yes,scrollbars=yes",
  );

  if (!authWindow) {
    pendingModulePath = null;
    setAuthState("unknown");
    showDialog(
      "瀏覽器阻擋了登入視窗",
      "請允許這個 Dashboard 開啟 popup，然後再點一次「檢查 / 登入 ePortal」。",
    );
    return;
  }

  authWindow.focus();
  startAuthWindowWatch();
}

function continueAfterLogin() {
  const targetPath = pendingModulePath;
  pendingModulePath = null;
  pendingNonce = null;

  if (targetPath && authWindow && !authWindow.closed) {
    const targetUrl = new URL(targetPath, window.location.origin).toString();
    authWindow.location.href = targetUrl;
    authWindow = null;
    closeAuthTracking();
    return;
  }

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

  setAuthState("valid", "Userscript 已確認目前瀏覽器的 ePortal 登入狀態。");
  continueAfterLogin();
}

function consumeMobileReturn() {
  const url = new URL(window.location.href);
  const success = url.searchParams.get("eportalAuth") === "ok";
  if (!success) return false;

  const modulePath = url.searchParams.get("eportalModule") || "";

  url.searchParams.delete("eportalAuth");
  url.searchParams.delete("nonce");
  url.searchParams.delete("eportalModule");
  history.replaceState(null, "", url.pathname + url.search + url.hash);

  setAuthState(
    "valid",
    "Userscript 已確認手機瀏覽器的 ePortal 登入狀態。",
  );

  if (/^\/go\/[a-z0-9-]+$/.test(modulePath)) {
    location.replace(modulePath);
  }

  return true;
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
      `<span>使用目前瀏覽器的 ePortal session</span><span aria-hidden="true">↗</span>`;

    copy.append(title, description, launch);
    button.append(icon, copy);

    button.addEventListener("click", () => {
      // Always verify the current client-browser ePortal session first.
      // If already logged in, the Bridge responds immediately and this same
      // popup continues to the requested module.
      openAuthFlow(module.launchPath);
    });

    moduleGrid.append(button);
  }
}

loginButton.addEventListener("click", () => openAuthFlow());
sessionLoginButton.addEventListener("click", () => openAuthFlow());
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
        "unknown",
        "這個 Dashboard 分頁最近曾確認登入；重新點擊卡片時會在需要時再次走官方登入。",
      );
    } else {
      setAuthState("unknown");
    }
  } catch (error) {
    showDialog("載入失敗", error.message);
  }
})();
