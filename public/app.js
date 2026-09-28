const authScreen = document.querySelector("#authScreen");
const appShell = document.querySelector("#appShell");
const loginForm = document.querySelector("#loginForm");
const accessCode = document.querySelector("#accessCode");
const rememberLogin = document.querySelector("#rememberLogin");
const authMessage = document.querySelector("#authMessage");
const moduleGrid = document.querySelector("#moduleGrid");
const refreshSession = document.querySelector("#refreshSession");
const logoutButton = document.querySelector("#logoutButton");
const sessionDot = document.querySelector("#sessionDot");
const sessionTitle = document.querySelector("#sessionTitle");
const sessionDetail = document.querySelector("#sessionDetail");
const stateFileStatus = document.querySelector("#stateFileStatus");
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showAuth() {
  authScreen.classList.remove("hidden");
  appShell.classList.add("hidden");
  requestAnimationFrame(() => accessCode.focus());
}

function showApp() {
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
}

function setSessionState(state, detail = "") {
  sessionDot.className = `status-dot ${state}`;
  if (state === "valid") {
    sessionTitle.textContent = "ePortal 登入有效";
    sessionDetail.textContent = detail || "可以產生新的 SSO ticket。";
    return;
  }
  if (state === "invalid") {
    sessionTitle.textContent = "需要重新登入 ePortal";
    sessionDetail.textContent = detail || "請在樹莓派執行 npm run login。";
    return;
  }
  sessionTitle.textContent = "正在檢查 ePortal";
  sessionDetail.textContent = detail || "正在驗證 storage state…";
}

function showDialog(title, message) {
  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  if (typeof statusDialog.showModal === "function") statusDialog.showModal();
}

function submitLaunchForm(popup, launch) {
  const doc = popup.document;
  doc.open();
  doc.write("<!doctype html><html><head><title>Opening…</title></head><body></body></html>");
  doc.close();

  const form = doc.createElement("form");
  form.method = "POST";
  form.action = launch.url;

  for (const [name, value] of launch.fields || []) {
    const input = doc.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }

  doc.body.append(form);
  form.submit();
}

async function launchModule(module, button) {
  const popup = window.open("about:blank", "_blank");
  if (!popup) {
    showDialog("瀏覽器阻擋了新視窗", "請允許這個 Dashboard 開啟新分頁，再重新點一次模組。");
    return;
  }

  popup.document.title = "Preparing NUTC SSO…";
  popup.document.body.innerHTML = `<p style="font-family:system-ui;padding:2rem">正在向 ePortal 取得新的短效 SSO ticket…</p>`;
  button.disabled = true;

  try {
    const launch = await api(`/api/modules/${encodeURIComponent(module.id)}/launch`, {
      method: "POST",
      body: "{}",
    });

    if (launch.kind === "url") {
      popup.location.replace(launch.url);
    } else if (launch.kind === "form") {
      submitLaunchForm(popup, launch);
    } else {
      throw new Error("Unknown SSO launch format.");
    }
  } catch (error) {
    popup.close();
    if (error.status === 401) {
      showAuth();
      return;
    }
    if (error.status === 409) setSessionState("invalid");
    showDialog("無法開啟模組", error.message);
  } finally {
    button.disabled = false;
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
    launch.innerHTML = `<span>由 ePortal 產生新 SSO</span><span aria-hidden="true">↗</span>`;

    copy.append(title, description, launch);
    button.append(icon, copy);
    button.addEventListener("click", () => launchModule(module, button));
    moduleGrid.append(button);
  }
}

async function checkSession() {
  setSessionState("checking");
  refreshSession.disabled = true;
  try {
    const status = await api("/api/eportal/check", {
      method: "POST",
      body: "{}",
    });
    stateFileStatus.textContent = status.reason === "missing-state" ? "不存在" : "已建立";
    setSessionState(status.valid ? "valid" : "invalid");
  } catch (error) {
    if (error.status === 401) {
      showAuth();
      return;
    }
    setSessionState("invalid", "檢查失敗，請確認 Playwright / Chromium 是否可用。");
  } finally {
    refreshSession.disabled = false;
  }
}

async function initializeApp() {
  showApp();
  try {
    const [{ modules }, state] = await Promise.all([
      api("/api/modules"),
      api("/api/eportal/status"),
    ]);
    renderModules(modules);
    stateFileStatus.textContent = state.stateExists ? "已建立" : "不存在";
    await checkSession();
  } catch (error) {
    if (error.status === 401) showAuth();
    else showDialog("載入失敗", error.message);
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        code: accessCode.value,
        remember: rememberLogin.checked,
      }),
    });
    accessCode.value = "";
    await initializeApp();
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

refreshSession.addEventListener("click", checkSession);

dialogClose.addEventListener("click", () => statusDialog.close());

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
  showAuth();
});

(async () => {
  try {
    const status = await api("/api/server/status");
    if (status.authenticated) await initializeApp();
    else showAuth();
  } catch (error) {
    authMessage.textContent = `無法連線到 Dashboard server：${error.message}`;
    showAuth();
  }
})();
