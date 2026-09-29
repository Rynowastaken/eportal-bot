const statusDot = document.querySelector("#statusDot");
const statusTitle = document.querySelector("#statusTitle");
const statusDetail = document.querySelector("#statusDetail");
const tokenPanel = document.querySelector("#tokenPanel");
const tokenForm = document.querySelector("#tokenForm");
const tokenInput = document.querySelector("#tokenInput");
const viewerPlaceholder = document.querySelector("#viewerPlaceholder");
const xpraFrame = document.querySelector("#xpraFrame");
const bandwidthSelect = document.querySelector("#bandwidthSelect");
const reloadButton = document.querySelector("#reloadButton");

let currentStatus = null;
let frameStarted = false;

function setStatus(state, title, detail) {
  statusDot.className = `status-dot ${state}`;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

async function fetchStatus() {
  const response = await fetch("/remote-login/status.json", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Remote login status failed (${response.status}).`);
  }

  return response.json();
}

async function authorize(token) {
  const response = await fetch("/api/remote-login/authorize", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ token }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Remote login authorization failed.");
  }

  return data;
}

function frameUrl() {
  const kbps = Number(bandwidthSelect.value || currentStatus?.bandwidthKbps || 512);
  const bps = Math.max(128, kbps) * 1000;
  const params = new URLSearchParams({
    bandwidth_limit: String(bps),
    reconnect: "true",
    submit: "false",
  });

  return `/remote-login/xpra/?${params.toString()}`;
}

function startFrame(force = false) {
  if (!currentStatus?.active || !currentStatus?.authorized) return;
  if (frameStarted && !force) return;

  frameStarted = true;
  viewerPlaceholder.classList.add("hidden");
  xpraFrame.classList.remove("hidden");
  xpraFrame.src = frameUrl();
}

function renderStatus(status) {
  currentStatus = status;

  if (!status.active) {
    frameStarted = false;
    xpraFrame.src = "about:blank";
    xpraFrame.classList.add("hidden");
    viewerPlaceholder.classList.remove("hidden");
    tokenPanel.classList.add("hidden");
    setStatus(
      "invalid",
      "Remote Login 尚未啟動",
      "在 Server SSH 終端執行 npm run login:remote。",
    );
    return;
  }

  if (!status.authorized) {
    frameStarted = false;
    xpraFrame.src = "about:blank";
    xpraFrame.classList.add("hidden");
    viewerPlaceholder.classList.remove("hidden");
    tokenPanel.classList.remove("hidden");
    bandwidthSelect.value = String(status.bandwidthKbps || 512);
    setStatus(
      "checking",
      "Remote Login 已啟動",
      "輸入 SSH 終端顯示的短效 token 後即可控制 Server Chromium。",
    );
    return;
  }

  tokenPanel.classList.add("hidden");
  bandwidthSelect.value = String(status.bandwidthKbps || bandwidthSelect.value || 512);
  setStatus(
    "valid",
    "Remote Login 已連線",
    `Session 到期時間：${new Date(status.expiresAt).toLocaleString()}`,
  );
  startFrame();
}

async function refreshStatus() {
  try {
    renderStatus(await fetchStatus());
  } catch (error) {
    setStatus("invalid", "Remote Login 無法連線", error.message);
  }
}

async function consumeFragmentToken() {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const token = fragment.get("token");
  if (!token) return false;

  history.replaceState(null, "", location.pathname + location.search);

  try {
    await authorize(token);
    tokenInput.value = "";
    return true;
  } catch (error) {
    tokenPanel.classList.remove("hidden");
    setStatus("invalid", "Token 無效或已過期", error.message);
    return false;
  }
}

tokenForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (!token) return;

  try {
    setStatus("checking", "正在驗證 token", "只會建立這次 Remote Login 的臨時授權。");
    await authorize(token);
    tokenInput.value = "";
    await refreshStatus();
  } catch (error) {
    setStatus("invalid", "Token 驗證失敗", error.message);
  }
});

bandwidthSelect.addEventListener("change", () => {
  if (currentStatus?.authorized) startFrame(true);
});

reloadButton.addEventListener("click", async () => {
  await refreshStatus();
  if (currentStatus?.authorized) startFrame(true);
});

(async () => {
  await consumeFragmentToken();
  await refreshStatus();
})();
