const motion = window.NutcMotion;
const statusDot = document.querySelector("#statusDot");
const statusTitle = document.querySelector("#statusTitle");
const pageCard = document.querySelector("#pageCard");
const pageTitle = document.querySelector("#pageTitle");
const messageList = document.querySelector("#messageList");
const imageList = document.querySelector("#imageList");
const fieldList = document.querySelector("#fieldList");
const actionList = document.querySelector("#actionList");
const bridgeForm = document.querySelector("#bridgeForm");
const errorCard = document.querySelector("#errorCard");
const errorMessage = document.querySelector("#errorMessage");
const closeButton = document.querySelector("#closeButton");

let token = "";
let lastState = null;
let busy = false;
let startupPollTimer = null;
let completionPollTimer = null;
let completionPollUntil = 0;
const objectUrls = new Set();
let lastStatusKind = "";
let lastStatusTitle = "";
let pageCardShown = false;

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function setStatus(kind, title) {
  const colors = {
    checking: "var(--accent)",
    valid: "#7fd5ad",
    invalid: "#f07178",
  };

  const changed =
    kind !== lastStatusKind ||
    title !== lastStatusTitle;

  statusDot.style.backgroundColor = colors[kind] || "var(--accent)";
  statusTitle.textContent = title;

  if (changed) {
    lastStatusKind = kind;
    lastStatusTitle = title;
    void motion?.pop?.(statusDot, { duration: 180 });
    void motion?.enter?.(statusTitle, {
      duration: 190,
      y: 4,
      scale: 0.995,
    });
  }
}

function clearCompletionPolling() {
  if (completionPollTimer) {
    clearTimeout(completionPollTimer);
    completionPollTimer = null;
  }
  completionPollUntil = 0;
}

function isLoginSubmitAction(activate, pressEnter) {
  if (pressEnter) return true;
  if (!activate) return false;

  const control = lastState?.page?.controls?.find(
    (item) => item.key === activate,
  );

  if (!control) return false;

  const text = [control.text, control.label, control.name]
    .filter(Boolean)
    .join(" ");

  return (
    control.type === "submit" ||
    /登入|login|sign\s*in/i.test(text)
  );
}

function startCompletionPolling() {
  clearCompletionPolling();
  completionPollUntil = Date.now() + 8_000;

  const poll = async () => {
    if (Date.now() >= completionPollUntil) {
      clearCompletionPolling();
      await refresh();
      return;
    }

    try {
      const state = await bridgeApi("/api/login-bridge/state");

      if (state.complete || !state.active) {
        clearCompletionPolling();
        render(state);
        return;
      }

      completionPollTimer = setTimeout(poll, 500);
    } catch (error) {
      clearCompletionPolling();
      showError(error.message);
    }
  };

  completionPollTimer = setTimeout(poll, 350);
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
    throw new Error(
      data.error || `Bridge request failed (${response.status}).`,
    );
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
      image.className =
        "max-h-40 max-w-full rounded-xl border border-white/[.12] bg-white p-1 object-contain shadow-sm";
      image.src = url;
      image.alt = item.alt || "ePortal verification image";
      image.width = item.width || 0;
      image.height = item.height || 0;
      imageList.append(image);
      void motion?.enter?.(image, {
        duration: 240,
        y: 6,
        scale: 0.985,
      });
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
  row.className = "grid gap-1.5";

  if (control.type === "checkbox" || control.type === "radio") {
    const label = document.createElement("label");
    label.className =
      "flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-white/[.12] bg-white/[.06] px-3 py-2.5 text-sm font-semibold transition hover:border-white/[.18] hover:bg-white/[.09]";

    const input = document.createElement("input");
    input.type = control.type;
    input.checked = Boolean(control.checked);
    input.disabled = Boolean(control.disabled);
    input.dataset.bridgeKey = control.key;
    input.className =
      "h-5 w-5 shrink-0 accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--primary-ring)]";

    const text = document.createElement("span");
    text.textContent = control.label || control.name || control.type;

    label.append(input, text);
    row.append(label);
    return row;
  }

  const label = document.createElement("label");
  label.htmlFor = `bridge-${control.key}`;
  label.className = "text-sm font-semibold text-[var(--muted)]";
  label.textContent = control.label || control.name || "欄位";

  let input;

  if (control.tag === "select") {
    input = document.createElement("select");

    for (const option of control.options || []) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label || option.value;
      node.selected = Boolean(option.selected);
      input.append(node);
    }
  } else if (control.tag === "textarea") {
    input = document.createElement("textarea");
    input.value = control.value || "";
    input.classList.add("min-h-28", "resize-y");
  } else {
    input = document.createElement("input");
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

  input.className +=
    " min-h-12 w-full rounded-xl border border-white/[.12] bg-black/20 px-3 py-2.5 text-base font-semibold text-[var(--foreground)] outline-none transition placeholder:text-white/35 focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary-soft)] disabled:cursor-not-allowed disabled:opacity-50";
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
  button.dataset.activateKey = control.key;
  button.textContent =
    control.text || control.label || (index === 0 ? "繼續" : "操作");
  button.disabled = Boolean(control.disabled);

  button.className =
    index === 0
      ? "min-h-[46px] rounded-xl border border-[var(--control-border)] bg-[var(--control-bg)] px-4 text-sm font-semibold text-[var(--control-text)] shadow-sm transition duration-150 hover:-translate-y-px hover:border-[var(--control-hover-border)] hover:bg-[var(--control-hover-bg)] hover:text-[var(--control-hover-text)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--primary-ring)] disabled:cursor-wait disabled:opacity-50"
      : "min-h-[46px] rounded-xl border border-white/[.12] bg-white/[.07] px-4 text-sm font-semibold text-[var(--foreground)] shadow-sm transition duration-150 hover:-translate-y-px hover:border-white/[.18] hover:bg-white/[.10] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--primary-ring)] disabled:cursor-wait disabled:opacity-50";

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

function leaveLoginPage() {
  setTimeout(() => {
    if (window.opener && !window.opener.closed) {
      window.close();

      setTimeout(() => {
        if (!window.closed) location.replace("/");
      }, 120);
      return;
    }

    location.replace("/");
  }, 250);
}

function render(state) {
  lastState = state;

  if (startupPollTimer) {
    clearTimeout(startupPollTimer);
    startupPollTimer = null;
  }

  if (state.complete) {
    clearCompletionPolling();
    errorCard.classList.add("hidden");
    setStatus("valid", "登入完成");
    disposeImages();

    if (!pageCard.classList.contains("hidden")) {
      void motion?.exit?.(pageCard, {
        duration: 180,
        y: 8,
        scale: 0.985,
      });
    }

    leaveLoginPage();
    return;
  }

  if (state.active && !state.page) {
    pageCard.classList.add("hidden");
    errorCard.classList.add("hidden");

    const phaseText = {
      starting: "準備登入…",
      "checking-session": "檢查登入狀態…",
      "opening-login": "載入登入頁…",
    };

    setStatus(
      "checking",
      phaseText[state.phase] || "準備登入…",
    );

    startupPollTimer = setTimeout(() => {
      void refresh();
    }, 650);
    return;
  }

  if (!state.active || !state.page) {
    throw new Error("Login bridge 已結束或過期。");
  }

  errorCard.classList.add("hidden");
  const firstReveal = !pageCardShown;
  pageCard.classList.remove("hidden");
  pageCardShown = true;
  pageTitle.textContent = state.page.title || "ePortal";

  if (firstReveal) {
    void motion?.enter?.(pageCard, {
      duration: 320,
      y: 12,
      scale: 0.98,
    });
  }

  messageList.replaceChildren();

  for (const message of state.page.messages || []) {
    const important =
      message.length <= 180 ||
      /錯誤|失敗|驗證|密碼|error|invalid|warning/i.test(message);

    if (!important) continue;

    const item = document.createElement("div");
    item.className =
      "rounded-xl border border-white/[.10] bg-white/[.06] px-3 py-2.5 text-sm font-medium leading-6 text-[var(--muted)]";
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
    enter.className =
      "min-h-[46px] rounded-xl border border-[var(--control-border)] bg-[var(--control-bg)] px-4 text-sm font-semibold text-[var(--control-text)] shadow-sm transition duration-150 hover:-translate-y-px hover:border-[var(--control-hover-border)] hover:bg-[var(--control-hover-bg)] hover:text-[var(--control-text)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--primary-ring)]";
    enter.textContent = "繼續";
    actionList.append(enter);
  }

  if (firstReveal) {
    void motion?.stagger?.(
      [...fieldList.children, ...actionList.children],
      {
        step: 42,
        duration: 300,
        y: 8,
        scale: 0.99,
        maxDelay: 210,
      },
    );
  }

  void loadImages(state.page.images || []);
  setStatus("valid", "請完成登入");

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
  const watchForCompletion = isLoginSubmitAction(activate, pressEnter);

  for (const button of actionList.querySelectorAll("button")) {
    button.disabled = true;
  }

  setStatus("checking", "正在提交…");

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

    if (watchForCompletion && !state.complete) {
      startCompletionPolling();
    }
  } catch (error) {
    showError(error.message);
  } finally {
    busy = false;
  }
}

function showError(message) {
  clearCompletionPolling();

  if (startupPollTimer) {
    clearTimeout(startupPollTimer);
    startupPollTimer = null;
  }

  pageCard.classList.add("hidden");
  errorCard.classList.remove("hidden");
  errorMessage.textContent = message;
  void motion?.enter?.(errorCard, {
    duration: 260,
    y: 10,
    scale: 0.985,
  });
  setStatus("invalid", "登入失敗");
  disposeImages();
  renderIcons();
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
  clearCompletionPolling();

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
  await window.NutcTheme.init();
  renderIcons();

  void motion?.stagger?.(
    document.querySelectorAll("main > header, main > section"),
    {
      step: 55,
      duration: 320,
      y: 8,
      scale: 0.99,
      maxDelay: 165,
    },
  );

  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  token = fragment.get("token") || "";
  history.replaceState(null, "", location.pathname + location.search);

  try {
    if (!token) {
      setStatus("checking", "準備登入…");

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
        throw new Error(
          state.error ||
            `Unable to start Login Bridge (${response.status}).`,
        );
      }

      if (state.complete) {
        render(state);
        return;
      }

      if (!state.launchPath) {
        throw new Error("Login Bridge did not return a launch path.");
      }

      const launchUrl = new URL(state.launchPath, location.origin);
      const launchFragment = new URLSearchParams(
        launchUrl.hash.replace(/^#/, ""),
      );
      token = launchFragment.get("token") || "";

      if (!token) {
        throw new Error("Login Bridge did not return a usable token.");
      }

      history.replaceState(null, "", "/server-login/");
      await refresh();
      return;
    }

    await refresh();
  } catch (error) {
    showError(error.message);
  }
})();
