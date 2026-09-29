const moduleGrid = document.querySelector("#moduleGrid");
const serverMenu = document.querySelector("#serverMenu");
const serverStatusButton = document.querySelector("#serverStatusButton");
const serverStatusDot = document.querySelector("#serverStatusDot");
const serverStatusText = document.querySelector("#serverStatusText");
const serverStatusChevron = document.querySelector("#serverStatusChevron");
const serverStatusMenu = document.querySelector("#serverStatusMenu");
const serverLoginAction = document.querySelector("#serverLoginAction");
const serverLogoutAction = document.querySelector("#serverLogoutAction");
const settingsMenu = document.querySelector("#settingsMenu");
const settingsButton = document.querySelector("#settingsButton");
const settingsPanel = document.querySelector("#settingsPanel");
const themeSettingsAction = document.querySelector("#themeSettingsAction");
const backgroundAction = document.querySelector("#backgroundAction");
const clearBackgroundAction = document.querySelector("#clearBackgroundAction");
const backgroundInput = document.querySelector("#backgroundInput");
const themeDialog = document.querySelector("#themeDialog");
const themeDialogClose = document.querySelector("#themeDialogClose");
const themeSchemeOptions = document.querySelector("#themeSchemeOptions");
const themePreview = document.querySelector("#themePreview");
const themeColorfulness = document.querySelector("#themeColorfulness");
const themeColorfulnessValue = document.querySelector("#themeColorfulnessValue");
const themeBrightness = document.querySelector("#themeBrightness");
const themeBrightnessValue = document.querySelector("#themeBrightnessValue");
const themeReset = document.querySelector("#themeReset");
const themeApply = document.querySelector("#themeApply");

let modulesCache = [];
let stagedThemeSettings = null;

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

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function syncThemeMenu() {
  const showClearBackground = Boolean(
    window.NutcTheme?.hasBackground?.(),
  );
  clearBackgroundAction.classList.toggle("hidden", !showClearBackground);
  clearBackgroundAction.classList.toggle("flex", showClearBackground);
}

function formatThemeFactor(value) {
  return Number(value)
    .toFixed(2)
    .replace(/\.?0+$/, "");
}

function renderThemePreview() {
  if (!stagedThemeSettings) return;

  const palette =
    window.NutcTheme.previewSettings(stagedThemeSettings);

  themePreview.replaceChildren();

  for (const color of palette) {
    const swatch = document.createElement("span");
    swatch.style.backgroundColor = color;
    themePreview.append(swatch);
  }

  themeColorfulness.value = stagedThemeSettings.colorfulness;
  themeBrightness.value = stagedThemeSettings.brightness;
  themeColorfulnessValue.value = formatThemeFactor(
    stagedThemeSettings.colorfulness,
  );
  themeBrightnessValue.value = formatThemeFactor(
    stagedThemeSettings.brightness,
  );

  for (const button of themeSchemeOptions.querySelectorAll(
    "[data-theme-scheme]",
  )) {
    const selected =
      button.dataset.themeScheme ===
      stagedThemeSettings.colorScheme;

    button.setAttribute("aria-checked", String(selected));
    button.classList.toggle(
      "border-[var(--primary-ring)]",
      selected,
    );
    button.classList.toggle(
      "bg-[var(--primary-soft)]",
      selected,
    );
    button.classList.toggle(
      "text-[var(--foreground)]",
      selected,
    );
    button.classList.toggle("border-white/[.12]", !selected);
    button.classList.toggle("bg-white/[.05]", !selected);
    button.classList.toggle("text-[var(--muted)]", !selected);
  }
}

function renderThemeSchemes() {
  themeSchemeOptions.replaceChildren();

  for (const scheme of window.NutcTheme.schemes()) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "radio";
    button.dataset.themeScheme = scheme.id;
    button.className =
      "min-h-[46px] rounded-xl border px-3 py-2 text-sm font-semibold transition duration-150 hover:-translate-y-px hover:border-white/[.18] hover:bg-white/[.09] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--primary-ring)]";
    button.textContent = scheme.name;
    button.addEventListener("click", () => {
      stagedThemeSettings.colorScheme = scheme.id;
      renderThemePreview();
    });
    themeSchemeOptions.append(button);
  }
}

function openThemeDialog() {
  stagedThemeSettings = {
    ...window.NutcTheme.settings(),
  };
  renderThemeSchemes();
  renderThemePreview();
  renderIcons();
  setSettingsMenuOpen(false);

  if (!themeDialog.open) {
    themeDialog.showModal();
  }
}

function closeThemeDialog() {
  if (themeDialog.open) themeDialog.close();
  stagedThemeSettings = null;
}

function setServerStatus(status) {
  const state = status?.status || "error";
  const bridgeActive = Boolean(status?.loginBridge?.active);

  let label = "需登入";
  let detail = "Server ePortal 尚未登入";
  let dotColor = "#f07178";
  let canLogout = false;

  if (bridgeActive || state === "busy") {
    label = "使用中";
    detail = "Server ePortal 正在使用中";
    dotColor = "var(--accent)";
  } else if (state === "valid") {
    label = "已連線";
    detail = "Server ePortal 已登入";
    dotColor = "#7fd5ad";
    canLogout = true;
  } else if (state === "error") {
    label = "重試";
    detail = status?.error || "無法檢查 Server ePortal";
  }

  serverStatusDot.style.backgroundColor = dotColor;
  serverStatusText.textContent = label;
  serverStatusButton.title = detail;
  serverStatusButton.setAttribute("aria-label", detail);

  serverLoginAction.querySelector("span").textContent =
    canLogout ? "重新登入" : "登入";
  serverLogoutAction.classList.toggle("hidden", !canLogout);
  serverLogoutAction.classList.toggle("flex", canLogout);
}

function openModule(module) {
  window.location.assign(module.launchPath);
}

function moduleAccent(index) {
  const palette = window.NutcTheme?.palette?.() || [
    "#f0a8c8",
    "#e8b86d",
    "#51314a",
  ];

  return palette[index % Math.max(1, Math.min(3, palette.length))] || "#f0a8c8";
}

function renderModules(modules) {
  modulesCache = modules;
  moduleGrid.replaceChildren();

  modules.forEach((module, index) => {
    const accent = moduleAccent(index);
    const rgba = window.NutcTheme?.rgba || ((color) => color);

    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "group relative flex min-h-44 flex-col overflow-hidden rounded-[20px] border border-white/[.12] bg-[rgba(12,10,14,.34)] p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,.18)] backdrop-blur-[18px] backdrop-saturate-[170%] transition duration-200 ease-soft-out hover:-translate-y-0.5 hover:border-white/[.18] hover:bg-white/[.07] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--primary-ring)]";
    button.setAttribute("aria-label", `開啟 ${module.name}`);

    const glow = document.createElement("span");
    glow.className =
      "pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full opacity-20 blur-[44px] transition-opacity duration-200 group-hover:opacity-30";
    glow.style.backgroundColor = accent;

    const icon = document.createElement("span");
    icon.className =
      "relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border shadow-sm";
    icon.style.color = accent;
    icon.style.backgroundColor = rgba(accent, 0.14);
    icon.style.borderColor = rgba(accent, 0.42);
    icon.innerHTML = `<i data-lucide="${module.icon || "route"}" class="h-[21px] w-[21px]"></i>`;

    const copy = document.createElement("span");
    copy.className = "relative z-10 mt-auto block pt-8";

    const title = document.createElement("h3");
    title.className = "text-[17px] font-semibold tracking-[-0.025em]";
    title.textContent = module.shortName;

    const description = document.createElement("p");
    description.className =
      "mt-1.5 text-[13px] font-medium leading-5 text-[var(--muted)]";
    description.textContent = module.description;

    const launch = document.createElement("span");
    launch.className =
      "mt-4 flex items-center justify-between text-xs font-semibold text-[var(--faint)]";
    launch.innerHTML =
      '<span>開啟</span><i data-lucide="arrow-right" class="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true"></i>';
    launch.lastElementChild.style.color = accent;

    copy.append(title, description, launch);
    button.append(glow, icon, copy);
    button.addEventListener("click", () => openModule(module));
    moduleGrid.append(button);
  });

  renderIcons();
}

function showLoadError(message) {
  moduleGrid.replaceChildren();

  const card = document.createElement("div");
  card.className =
    "rounded-[20px] border border-white/[.12] bg-[rgba(12,10,14,.34)] p-4 text-sm font-medium text-[var(--muted)] shadow-sm backdrop-blur-[18px] backdrop-saturate-[170%]";
  card.textContent = message || "校務系統載入失敗。";
  moduleGrid.append(card);
}

function setFloatingMenuOpen(button, panel, open) {
  button.setAttribute("aria-expanded", String(open));
  panel.setAttribute("aria-hidden", String(!open));

  panel.classList.toggle("pointer-events-none", !open);
  panel.classList.toggle("invisible", !open);
  panel.classList.toggle("opacity-0", !open);
  panel.classList.toggle("-translate-y-2", !open);
  panel.classList.toggle("scale-[.97]", !open);

  panel.classList.toggle("pointer-events-auto", open);
  panel.classList.toggle("visible", open);
  panel.classList.toggle("opacity-100", open);
  panel.classList.toggle("translate-y-0", open);
  panel.classList.toggle("scale-100", open);
}

function setServerMenuOpen(open) {
  serverStatusChevron.classList.toggle("rotate-180", open);
  setFloatingMenuOpen(serverStatusButton, serverStatusMenu, open);

  if (open) setSettingsMenuOpen(false);
}

function setSettingsMenuOpen(open) {
  setFloatingMenuOpen(settingsButton, settingsPanel, open);

  if (open) setServerMenuOpen(false);
}

serverStatusButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setServerMenuOpen(
    serverStatusButton.getAttribute("aria-expanded") !== "true",
  );
});

settingsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setSettingsMenuOpen(
    settingsButton.getAttribute("aria-expanded") !== "true",
  );
});

serverLoginAction.addEventListener("click", () => {
  window.location.assign("/server-login/");
});

themeSettingsAction.addEventListener("click", () => {
  openThemeDialog();
});

themeDialogClose.addEventListener("click", () => {
  closeThemeDialog();
});

themeDialog.addEventListener("click", (event) => {
  if (event.target === themeDialog) {
    closeThemeDialog();
  }
});

themeDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeThemeDialog();
});

themeColorfulness.addEventListener("input", () => {
  if (!stagedThemeSettings) return;
  stagedThemeSettings.colorfulness = Number(themeColorfulness.value);
  renderThemePreview();
});

themeBrightness.addEventListener("input", () => {
  if (!stagedThemeSettings) return;
  stagedThemeSettings.brightness = Number(themeBrightness.value);
  renderThemePreview();
});

themeReset.addEventListener("click", () => {
  stagedThemeSettings = {
    ...window.NutcTheme.defaultSettings(),
  };
  renderThemePreview();
});

themeApply.addEventListener("click", () => {
  if (!stagedThemeSettings) return;

  window.NutcTheme.applySettings(stagedThemeSettings);
  renderModules(modulesCache);
  syncThemeMenu();
  closeThemeDialog();
});

backgroundAction.addEventListener("click", () => {
  backgroundInput.click();
});

backgroundInput.addEventListener("change", async () => {
  const file = backgroundInput.files?.[0];
  backgroundInput.value = "";
  if (!file) return;

  backgroundAction.disabled = true;

  try {
    await window.NutcTheme.setBackgroundFile(file);
    syncThemeMenu();
    renderModules(modulesCache);
    setSettingsMenuOpen(false);
  } catch (error) {
    console.error("Background update failed:", error);
  } finally {
    backgroundAction.disabled = false;
  }
});

clearBackgroundAction.addEventListener("click", () => {
  window.NutcTheme.clearBackground();
  syncThemeMenu();
  renderModules(modulesCache);
  setSettingsMenuOpen(false);
});

serverLogoutAction.addEventListener("click", async () => {
  if (serverLogoutAction.disabled) return;

  serverLogoutAction.disabled = true;
  serverLogoutAction.querySelector("span").textContent = "登出中…";

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
    serverLogoutAction.querySelector("span").textContent = "登出";
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#serverMenu")) {
    setServerMenuOpen(false);
  }

  if (!event.target.closest("#settingsMenu")) {
    setSettingsMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const settingsWasOpen =
      settingsButton.getAttribute("aria-expanded") === "true";

    setServerMenuOpen(false);
    setSettingsMenuOpen(false);

    if (settingsWasOpen) settingsButton.focus();
    else serverStatusButton.focus();
  }
});

window.addEventListener("nutc-theme-change", () => {
  syncThemeMenu();
  if (modulesCache.length) renderModules(modulesCache);
});

(async () => {
  await window.NutcTheme.init();
  syncThemeMenu();
  renderIcons();

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
    setServerStatus({
      status: "error",
      error: statusResult.reason?.message,
    });
  }
})();
