const statusDot = document.querySelector("#statusDot");
const statusTitle = document.querySelector("#statusTitle");
const statusDetail = document.querySelector("#statusDetail");
const pageCard = document.querySelector("#pageCard");
const pageTitle = document.querySelector("#pageTitle");
const pagePath = document.querySelector("#pagePath");
const messageList = document.querySelector("#messageList");
const imageList = document.querySelector("#imageList");
const fieldList = document.querySelector("#fieldList");
const actionList = document.querySelector("#actionList");
const bridgeForm = document.querySelector("#bridgeForm");
const doneCard = document.querySelector("#doneCard");
const errorCard = document.querySelector("#errorCard");
const errorMessage = document.querySelector("#errorMessage");
const closeButton = document.querySelector("#closeButton");

let token = "";
let lastState = null;
let busy = false;
let startupPollTimer = null;
const objectUrls = new Set();

function setStatus(kind, title, detail) {
  statusDot.className = `status-dot ${kind}`;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function authHeaders(extra = {}) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function bridgeApi(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: authHeaders(options.headers || {}),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Bridge request failed (${response.status}).`);
  }

  return data;
}

function disposeImages() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  imageList.replaceChildren();
}

async function loadImages(images) {
  disposeImages();

  for (const item of images || []) {
    try {
      const response = await fetch(
        `/api/login-bridge/image/${encodeURIComponent(item.key)}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          headers: authHeaders(),
        },
      );

      if (!response.ok) continue;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      objectUrls.add(url);

      const image = document.createElement("img");
      image.className = "bridge-image";
      image.src = url;
      image.alt = item.alt || "ePortal verification image";
      image.width = item.width || 0;
      image.height = item.height || 0;
      imageList.append(image);
    } catch {
      // Optional image; form controls remain usable without it.
    }
  }
}

function inputType(control) {
  const supported = new Set([
    "text",
    "password",
    "email",
    "tel",
    "number",
    "search",
    "url",
    "date",
    "time",
    "datetime-local",
  ]);

  return supported.has(control.type) ? control.type : "text";
}

function makeField(control) {
  const row = document.createElement("div");
  row.className = "field-row";

  if (control.type === "checkbox" || control.type === "radio") {
    const label = document.createElement("label");
    label.className = "check-row";

    const input = document.createElement("input");
    input.type = control.type;
    input.checked = Boolean(control.checked);
    input.disabled = Boolean(control.disabled);
    input.dataset.bridgeKey = control.key;

    const text = document.createElement("span");
    text.textContent = control.label || control.name || control.type;

    label.append(input, text);
    row.append(label);
    return row;
  }

  const label = document.createElement("label");
  label.htmlFor = `bridge-${control.key}`;
  label.textContent = control.label || control.name || "欄位";

  let input;

  if (control.tag === "select") {
    input = document.createElement("select");
    input.className = "bridge-select";

    for (const option of control.options || []) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label || option.value;
      node.selected = Boolean(option.selected);
      input.append(node);
    }
  } else if (control.tag === "textarea") {
    input = document.createElement("textarea");
    input.className = "bridge-textarea";
    input.value = control.value || "";
  } else {
    input = document.createElement("input");
    input.className = "bridge-input";
    input.type = inputType(control);
    input.value = control.value || "";
    input.placeholder = control.placeholder || "";
    if (control.inputMode) input.inputMode = control.inputMode;
    if (control.autocomplete) {
      input.autocomplete = control.autocomplete;
    } else if (control.type === "password") {
      input.autocomplete = "current-password";
    }
  }

  input.id = `bridge-${control.key}`;
  input.dataset.bridgeKey = control.key;
  input.disabled = Boolean(control.disabled);
  input.required = Boolean(control.required);

  if (control.name) input.name = control.name;

  row.append(label, input);
  return row;
}

function makeAction(control, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "bridge-action";
  if (index > 0) button.classList.add("secondary");
  button.dataset.activateKey = control.key;
  button.textContent =
    control.text || control.label || (index === 0 ? "繼續" : "操作");
  button.disabled = Boolean(control.disabled);
  button.addEventListener("click", () => submitAction(control.key));
  return button;
}

function collectFields() {
  const fields = {};

  for (const element of bridgeForm.querySelectorAll("[data-bridge-key]")) {
    const key = element.dataset.bridgeKey;
    if (!key) continue;

    if (element.type === "checkbox" || element.type === "radio") {
      fields[key] = element.checked;
    } else {
      fields[key] = element.value;
    }
  }

  return fields;
}

function render(state) {
  lastState = state;

  if (startupPollTimer) {
    clearTimeout(startupPollTimer);
    startupPollTimer = null;
  }

  if (state.complete) {
    pageCard.classList.add("hidden");
    errorCard.classList.add("hidden");
    doneCard.classList.remove("hidden");
    setStatus(
      "valid",
      "Server ePortal 登入完成",
      "Persistent profile 已更新；不再需要這個登入頁。",
    );
    disposeImages();
    return;
  }

  if (state.active && !state.page) {
    pageCard.classList.add("hidden");
    doneCard.classList.add("hidden");
    errorCard.classList.add("hidden");

    const phaseText = {
      starting: ["正在啟動 Login Bridge", "Server 正在準備 headless Chromium…"],
      "checking-session": [
        "正在檢查 Server ePortal session",
        "Server Chromium 正在開啟 ePortal，確認是否真的需要重新登入…",
      ],
      "opening-login": [
        "正在開啟 ePortal 登入頁",
        "已確認需要登入，正在準備原生表單控制項…",
      ],
    };

    const [title, detail] =
      phaseText[state.phase] || [
        "正在準備登入頁",
        "等待 Server 上的 ePortal 頁面可供操作…",
      ];

    setStatus("checking", title, detail);

    startupPollTimer = setTimeout(() => {
      void refresh();
    }, 650);
    return;
  }

  if (!state.active || !state.page) {
    throw new Error("Login bridge 已結束或過期。");
  }

  doneCard.classList.add("hidden");
  errorCard.classList.add("hidden");
  pageCard.classList.remove("hidden");

  pageTitle.textContent = state.page.title || "ePortal";
  pagePath.textContent = `${state.page.hostname}${state.page.path}`;

  messageList.replaceChildren();
  for (const message of state.page.messages || []) {
    const item = document.createElement("div");
    item.className = "bridge-message";
    item.textContent = message;
    messageList.append(item);
  }

  fieldList.replaceChildren();
  actionList.replaceChildren();

  const fields = [];
  const actions = [];

  for (const control of state.page.controls || []) {
    const isAction =
      control.tag === "button" ||
      control.tag === "a" ||
      control.type === "submit" ||
      control.type === "button";

    if (isAction) actions.push(control);
    else fields.push(control);
  }

  for (const control of fields) {
    fieldList.append(makeField(control));
  }

  actions.forEach((control, index) => {
    actionList.append(makeAction(control, index));
  });

  if (!actions.length && fields.length) {
    const enter = document.createElement("button");
    enter.type = "submit";
    enter.className = "bridge-action";
    enter.textContent = "繼續";
    actionList.append(enter);
  }

  void loadImages(state.page.images || []);

  setStatus(
    "valid",
    "已連接 Server 上的 ePortal 頁面",
    "這裡是本機瀏覽器原生表單；提交後由 Server Playwright 操作真實頁面。",
  );

  const firstEditable = fieldList.querySelector(
    'input:not([type="checkbox"]):not([type="radio"]), select, textarea',
  );
  firstEditable?.focus({ preventScroll: true });
}

async function refresh() {
  try {
    render(await bridgeApi("/api/login-bridge/state"));
  } catch (error) {
    showError(error.message);
  }
}

async function submitAction(activate = null, pressEnter = false) {
  if (busy) return;
  busy = true;

  for (const button of actionList.querySelectorAll("button")) {
    button.disabled = true;
  }

  setStatus("checking", "正在提交", "等待 ePortal 回應…");

  try {
    const state = await bridgeApi("/api/login-bridge/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: collectFields(),
        activate,
        pressEnter,
      }),
    });

    render(state);
  } catch (error) {
    showError(error.message);
  } finally {
    busy = false;
  }
}

function showError(message) {
  if (startupPollTimer) {
    clearTimeout(startupPollTimer);
    startupPollTimer = null;
  }

  pageCard.classList.add("hidden");
  doneCard.classList.add("hidden");
  errorCard.classList.remove("hidden");
  errorMessage.textContent = message;
  setStatus("invalid", "登入橋接停止", message);
  disposeImages();
}

bridgeForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const primary = lastState?.page?.controls?.find(
    (control) =>
      control.type === "submit" ||
      control.tag === "button",
  );

  if (primary) void submitAction(primary.key);
  else void submitAction(null, true);
});

closeButton.addEventListener("click", async () => {
  try {
    if (token) {
      await bridgeApi("/api/login-bridge/stop", { method: "POST" });
    }
  } catch {
    // The bridge may already have completed.
  }

  location.assign("/");
});

(async () => {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  token = fragment.get("token") || "";
  history.replaceState(null, "", location.pathname + location.search);

  try {
    if (!token) {
      setStatus("checking", "正在啟動 Login Bridge", "Server 正在開啟 headless ePortal 登入頁…");

      const response = await fetch("/api/login-bridge/start", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      const state = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(state.error || `Unable to start Login Bridge (${response.status}).`);
      }

      if (state.complete) {
        render(state);
        return;
      }

      if (!state.launchPath) {
        throw new Error("Login Bridge did not return a launch path.");
      }

      location.replace(state.launchPath);
      return;
    }

    await refresh();
  } catch (error) {
    showError(error.message);
  }
})();
