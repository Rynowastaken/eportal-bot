const motion = window.NutcMotion;
const moduleGrid = document.querySelector("#moduleGrid");
const portalBackdrop = document.querySelector("#portalBackdrop");
const serverMenu = document.querySelector("#serverMenu");
const serverStatusButton = document.querySelector("#serverStatusButton");
const serverStatusIcon = document.querySelector("#serverStatusIcon");
const serverStatusText = document.querySelector("#serverStatusText");
const serverStatusChevron = document.querySelector("#serverStatusChevron");
const serverStatusMenu = document.querySelector("#serverStatusMenu");
const serverLoginAction = document.querySelector("#serverLoginAction");
const serverLogoutAction = document.querySelector("#serverLogoutAction");
const settingsButton = document.querySelector("#settingsButton");
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
const backgroundUploadDialog = document.querySelector("#backgroundUploadDialog");
const backgroundUploadClose = document.querySelector("#backgroundUploadClose");
const backgroundDropzone = document.querySelector("#backgroundDropzone");
const backgroundChooseFile = document.querySelector("#backgroundChooseFile");
const backgroundUploadPreview = document.querySelector("#backgroundUploadPreview");
const backgroundUploadPreviewImage = document.querySelector("#backgroundUploadPreviewImage");
const backgroundUploadPreviewName = document.querySelector("#backgroundUploadPreviewName");
const backgroundUploadPreviewSource = document.querySelector("#backgroundUploadPreviewSource");
const backgroundUploadStatus = document.querySelector("#backgroundUploadStatus");
const backgroundUploadCancel = document.querySelector("#backgroundUploadCancel");
const backgroundUploadApply = document.querySelector("#backgroundUploadApply");
const debugRestartServer = document.querySelector("#debugRestartServer");
const debugRestartStatus = document.querySelector("#debugRestartStatus");
const debugRestartIcon = document.querySelector("#debugRestartIcon");

let modulesCache = [];
let stagedThemeSettings = null;
let pendingBackgroundFile = null;
let lastStatusIconKind = "";
let initialModulesAnimated = false;

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

function renderThemePreview({ animate = false } = {}) {
  if (!stagedThemeSettings) return;

  const palette =
    window.NutcTheme.previewSettings(stagedThemeSettings);

  themePreview.replaceChildren();

  for (const color of palette) {
    const swatch = document.createElement("span");
    swatch.style.backgroundColor = color;
    themePreview.append(swatch);
  }

  if (animate) {
    void motion?.stagger?.(themePreview.children, {
      step: 28,
      duration: 220,
      y: 0,
      scale: 0.82,
      maxDelay: 112,
    });
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
      renderThemePreview({ animate: true });
      void motion?.emphasize?.(button, { duration: 190 });
    });
    themeSchemeOptions.append(button);
  }
}

async function openThemeDialog() {
  stagedThemeSettings = {
    ...window.NutcTheme.settings(),
  };
  renderThemeSchemes();
  renderThemePreview({ animate: true });
  renderIcons();
  setServerMenuOpen(false);

  await motion?.openDialog?.(
    themeDialog,
    themeDialog.firstElementChild,
    {
      duration: 280,
      y: 14,
      scale: 0.97,
    },
  );

  requestAnimationFrame(() => themeDialogClose.focus());
}

async function closeThemeDialog() {
  if (!themeDialog.open) {
    stagedThemeSettings = null;
    return;
  }

  await motion?.closeDialog?.(
    themeDialog,
    themeDialog.firstElementChild,
    {
      duration: 180,
      y: 10,
      scale: 0.98,
    },
  );

  stagedThemeSettings = null;
}

function resetBackgroundUploadDialog() {
  pendingBackgroundFile = null;
  backgroundInput.value = "";
  backgroundDropzone.classList.remove(
    "border-[var(--primary)]",
    "bg-[var(--primary-soft)]",
  );
  backgroundUploadPreview.classList.add("hidden");
  backgroundUploadPreviewImage.removeAttribute("src");
  backgroundUploadPreviewName.textContent = "Selected image";
  backgroundUploadPreviewSource.textContent = "Ready to use";
  backgroundUploadStatus.textContent = "";
  backgroundUploadStatus.classList.remove("text-[#f4a0a5]");
  backgroundUploadStatus.classList.add("text-[var(--muted)]");
  backgroundUploadApply.disabled = true;
}

function setBackgroundUploadStatus(message = "", isError = false) {
  backgroundUploadStatus.textContent = message;
  backgroundUploadStatus.classList.toggle("text-[#f4a0a5]", isError);
  backgroundUploadStatus.classList.toggle("text-[var(--muted)]", !isError);
}

async function openBackgroundUploadDialog() {
  await closeThemeDialog();
  resetBackgroundUploadDialog();
  renderIcons();

  await motion?.openDialog?.(
    backgroundUploadDialog,
    backgroundUploadDialog.firstElementChild,
    {
      duration: 220,
      y: 10,
      scale: 0.97,
    },
  );

  requestAnimationFrame(() => backgroundChooseFile.focus());
}

async function closeBackgroundUploadDialog({
  reopenSettings = false,
} = {}) {
  if (backgroundUploadDialog.open) {
    await motion?.closeDialog?.(
      backgroundUploadDialog,
      backgroundUploadDialog.firstElementChild,
      {
        duration: 170,
        y: 8,
        scale: 0.985,
      },
    );
  }

  resetBackgroundUploadDialog();

  if (reopenSettings) {
    await openThemeDialog();
  } else {
    settingsButton.focus();
  }
}

function readBackgroundImageFile(file, sourceLabel = "Selected from files") {
  if (!file) return;

  if (!String(file.type || "").startsWith("image/")) {
    setBackgroundUploadStatus("請選擇或貼上一張圖片。", true);
    return;
  }

  if (file.size > 25 * 1024 * 1024) {
    setBackgroundUploadStatus("圖片太大，請選擇 25 MB 以下的圖片。", true);
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {
    pendingBackgroundFile = file;
    backgroundUploadPreviewImage.src = String(reader.result || "");
    backgroundUploadPreviewName.textContent =
      file.name || "Pasted image";
    backgroundUploadPreviewSource.textContent = sourceLabel;
    backgroundUploadPreview.classList.remove("hidden");
    void motion?.enter?.(backgroundUploadPreview, {
      duration: 260,
      y: 8,
      scale: 0.985,
    });
    backgroundUploadApply.disabled = false;
    setBackgroundUploadStatus("圖片已準備好，確認預覽後即可套用。");
    renderIcons();
  };

  reader.onerror = () => {
    setBackgroundUploadStatus("無法讀取這張圖片，請換一張再試。", true);
  };

  reader.readAsDataURL(file);
}

function setStatusIcon(kind) {
  const icons = {
    valid:
      '<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="m8.8 12.2 2.1 2.1 4.5-4.7"></path></svg>',
    busy:
      '<svg viewBox="0 0 24 24" class="h-4 w-4 animate-spin" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path></svg>',
    error:
      '<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 8v5"></path><path d="M12 16.5h.01"></path></svg>',
    login:
      '<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5"></path><path d="M15 12H4"></path><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"></path></svg>',
  };

  serverStatusIcon.innerHTML = icons[kind] || icons.login;

  if (kind !== lastStatusIconKind) {
    lastStatusIconKind = kind;
    void motion?.pop?.(serverStatusIcon, { duration: 220 });
  }
}

function setServerStatus(status) {
  const state = status?.status || "error";
  const bridgeActive = Boolean(status?.loginBridge?.active);

  let label = "需登入";
  let detail = "Server ePortal 尚未登入";
  let iconKind = "login";
  let canLogout = false;

  if (bridgeActive || state === "busy") {
    label = "使用中";
    detail = "Server ePortal 正在使用中";
    iconKind = "busy";
  } else if (state === "valid") {
    label = "已連線";
    detail = "Server ePortal 已登入";
    iconKind = "valid";
    canLogout = true;
  } else if (state === "error") {
    label = "重試";
    detail = status?.error || "無法檢查 Server ePortal";
    iconKind = "error";
  }

  setStatusIcon(iconKind);

  const rgba = window.NutcTheme?.rgba || ((color) => color);
  let statusColor = "var(--primary)";
  let statusBackground = "var(--primary-soft)";
  let statusBorder = "var(--primary-ring)";

  if (iconKind === "busy") {
    const accent =
      window.NutcTheme?.palette?.()?.[1] || "#e8b86d";
    statusColor = accent;
    statusBackground = rgba(accent, 0.12);
    statusBorder = rgba(accent, 0.34);
  } else if (iconKind === "error") {
    statusColor = "#f4a0a5";
    statusBackground = "rgba(240,113,120,.10)";
    statusBorder = "rgba(240,113,120,.26)";
  } else if (iconKind === "login") {
    statusColor = "var(--muted)";
    statusBackground = "rgba(255,255,255,.055)";
    statusBorder = "rgba(255,255,255,.12)";
  }

  serverStatusIcon.style.color = statusColor;
  serverStatusIcon.style.backgroundColor = statusBackground;
  serverStatusIcon.style.borderColor = statusBorder;

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

function mixHex(first, second, amount = 0.5) {
  const parse = (value) => {
    const hex = String(value || "").replace("#", "");
    const full =
      hex.length === 3
        ? hex.split("").map((char) => char + char).join("")
        : hex.padEnd(6, "0").slice(0, 6);

    return [
      Number.parseInt(full.slice(0, 2), 16) || 0,
      Number.parseInt(full.slice(2, 4), 16) || 0,
      Number.parseInt(full.slice(4, 6), 16) || 0,
    ];
  };

  const a = parse(first);
  const b = parse(second);
  const mix = Math.min(1, Math.max(0, amount));

  return (
    "#" +
    a
      .map((value, index) =>
        Math.round(value * (1 - mix) + b[index] * mix)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function moduleAccent(module, index) {
  const palette = window.NutcTheme?.palette?.() || [
    "#f0a8c8",
    "#e8b86d",
    "#51314a",
    "#f07178",
  ];
  const roleOrder = [0, 1, 3, 2, 1];
  const themeColor =
    palette[roleOrder[index % roleOrder.length] % palette.length] ||
    palette[0] ||
    "#f0a8c8";
  const sourceColor = module.sourceColor || themeColor;
  const themeBlend = index === 4 ? 0.52 : 0.3;

  return mixHex(sourceColor, themeColor, themeBlend);
}

function renderModules(modules, { animate = false } = {}) {
  modulesCache = modules;
  moduleGrid.replaceChildren();

  modules.forEach((module, index) => {
    const accent = moduleAccent(module, index);
    const rgba = window.NutcTheme?.rgba || ((color) => color);

    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "group relative flex min-h-[108px] w-full items-center gap-4 overflow-hidden rounded-[20px] border p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,.18)] backdrop-blur-[18px] backdrop-saturate-[170%] transition duration-150 ease-soft-out hover:-translate-y-px hover:bg-white/[.075] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--primary-ring)] sm:p-5";
    button.style.borderColor = rgba(accent, 0.24);
    button.style.background =
      `linear-gradient(110deg, ${rgba(accent, 0.095)} 0%, ${rgba(accent, 0.035)} 34%, rgba(22,16,28,.08) 58%, rgba(12,10,14,.34) 100%)`;
    button.setAttribute("aria-label", `開啟 ${module.name}`);

    const tint = document.createElement("span");
    tint.className =
      "pointer-events-none absolute inset-y-0 left-0 w-[3px] opacity-80 transition-opacity duration-150 group-hover:opacity-100";
    tint.style.backgroundColor = accent;

    const icon = document.createElement("span");
    icon.className =
      "relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-[11px] border transition duration-150 group-hover:-translate-y-px";
    icon.style.color = accent;
    icon.style.backgroundColor = rgba(accent, 0.14);
    icon.style.borderColor = rgba(accent, 0.42);
    icon.innerHTML =
      `<i data-lucide="${module.icon || "route"}" class="h-[20px] w-[20px]"></i>`;

    const copy = document.createElement("span");
    copy.className = "relative z-10 min-w-0 flex-1";

    const title = document.createElement("h3");
    title.className =
      "truncate text-base font-semibold tracking-[-0.02em] text-[var(--foreground)] sm:text-[17px]";
    title.textContent = module.shortName;

    const description = document.createElement("p");
    description.className =
      "mt-1 line-clamp-2 text-[13px] font-medium leading-5 text-[var(--muted)]";
    description.textContent = module.description;

    const arrow = document.createElement("span");
    arrow.className =
      "relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition duration-150 group-hover:translate-x-0.5";
    arrow.style.color = accent;
    arrow.style.backgroundColor = rgba(accent, 0.08);
    arrow.style.borderColor = rgba(accent, 0.22);
    arrow.innerHTML =
      '<i data-lucide="arrow-right" class="h-[18px] w-[18px]" aria-hidden="true"></i>';

    copy.append(title, description);
    button.append(tint, icon, copy, arrow);
    button.addEventListener("mouseenter", () => {
      button.style.borderColor = rgba(accent, 0.42);
    });
    button.addEventListener("mouseleave", () => {
      button.style.borderColor = rgba(accent, 0.24);
    });
    button.addEventListener("click", () => openModule(module));
    moduleGrid.append(button);
  });

  renderIcons();

  if (animate) {
    void motion?.stagger?.(moduleGrid.children, {
      step: 48,
      duration: 340,
      y: 10,
      scale: 0.98,
      maxDelay: 220,
    });
  }
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
}

serverStatusButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setServerMenuOpen(
    serverStatusButton.getAttribute("aria-expanded") !== "true",
  );
});

settingsButton.addEventListener("click", () => {
  void motion?.emphasize?.(settingsButton, { duration: 180 });
  void openThemeDialog();
});

serverLoginAction.addEventListener("click", () => {
  window.location.assign("/server-login/");
});

themeDialogClose.addEventListener("click", () => {
  void closeThemeDialog();
});

themeDialog.addEventListener("click", (event) => {
  if (event.target === themeDialog) {
    void closeThemeDialog();
  }
});

themeDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  void closeThemeDialog();
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
  renderThemePreview({ animate: true });
});

themeApply.addEventListener("click", async () => {
  if (!stagedThemeSettings) return;

  window.NutcTheme.applySettings(stagedThemeSettings);
  syncThemeMenu();
  await closeThemeDialog();
});

backgroundAction.addEventListener("click", () => {
  void openBackgroundUploadDialog();
});

backgroundChooseFile.addEventListener("click", () => {
  backgroundInput.value = "";
  backgroundInput.click();
});

backgroundInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  readBackgroundImageFile(file, "從檔案選擇");
});

["dragenter", "dragover"].forEach((eventName) => {
  backgroundDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    backgroundDropzone.classList.add(
      "border-[var(--primary)]",
      "bg-[var(--primary-soft)]",
    );
  });
});

["dragleave", "drop"].forEach((eventName) => {
  backgroundDropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    backgroundDropzone.classList.remove(
      "border-[var(--primary)]",
      "bg-[var(--primary-soft)]",
    );
  });
});

backgroundDropzone.addEventListener("drop", (event) => {
  const file = [...(event.dataTransfer?.files || [])].find((entry) =>
    String(entry.type || "").startsWith("image/"),
  );

  if (!file) {
    setBackgroundUploadStatus("請拖曳圖片檔案到這裡。", true);
    return;
  }

  readBackgroundImageFile(file, "拖曳到上傳視窗");
});

backgroundUploadDialog.addEventListener("paste", (event) => {
  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find((item) =>
    String(item.type || "").startsWith("image/"),
  );
  const file = imageItem?.getAsFile();

  if (!file) {
    setBackgroundUploadStatus("剪貼簿裡沒有圖片。", true);
    return;
  }

  event.preventDefault();
  readBackgroundImageFile(file, "從剪貼簿貼上");
});

backgroundUploadApply.addEventListener("click", async () => {
  if (!pendingBackgroundFile) return;

  backgroundUploadApply.disabled = true;
  backgroundChooseFile.disabled = true;
  setBackgroundUploadStatus("正在處理並套用背景…");

  try {
    await window.NutcTheme.setBackgroundFile(pendingBackgroundFile);
    syncThemeMenu();
    void motion?.fade?.(portalBackdrop, {
      duration: 320,
      from: 0.55,
      to: 1,
    });
    await closeBackgroundUploadDialog({ reopenSettings: true });
  } catch (error) {
    backgroundUploadApply.disabled = false;
    setBackgroundUploadStatus(
      "無法套用背景：" + (error?.message || String(error)),
      true,
    );
  } finally {
    backgroundChooseFile.disabled = false;
  }
});

backgroundUploadClose.addEventListener("click", () => {
  void closeBackgroundUploadDialog({ reopenSettings: true });
});

backgroundUploadCancel.addEventListener("click", () => {
  void closeBackgroundUploadDialog({ reopenSettings: true });
});

backgroundUploadDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  void closeBackgroundUploadDialog({ reopenSettings: true });
});

backgroundUploadDialog.addEventListener("click", (event) => {
  if (event.target !== backgroundUploadDialog) return;
  void closeBackgroundUploadDialog({ reopenSettings: true });
});

clearBackgroundAction.addEventListener("click", () => {
  window.NutcTheme.clearBackground();
  syncThemeMenu();
  void motion?.fade?.(portalBackdrop, {
    duration: 280,
    from: 0.55,
    to: 1,
  });
});

function setDebugRestartStatus(message, isError = false) {
  debugRestartStatus.textContent = message;
  debugRestartStatus.classList.toggle("text-[#f4a0a5]", isError);
  debugRestartStatus.classList.toggle("text-[var(--muted)]", !isError);
}

async function waitForServerRestart(previousInstanceId) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 450));

    try {
      const response = await fetch("/api/server/status", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) continue;

      const status = await response.json();

      if (
        status.instanceId &&
        status.instanceId !== previousInstanceId
      ) {
        return true;
      }
    } catch {
      // Temporary failures are expected while the server restarts.
    }
  }

  return false;
}

debugRestartServer.addEventListener("click", async () => {
  if (debugRestartServer.disabled) return;

  debugRestartServer.disabled = true;
  debugRestartIcon.classList.add("animate-spin");
  setDebugRestartStatus("正在重新啟動 Server…");

  try {
    const before = await api("/api/server/status");

    const response = await fetch("/api/debug/restart", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `Restart failed (${response.status})`,
      );
    }

    const restarted = await waitForServerRestart(before.instanceId);

    if (!restarted) {
      throw new Error("Server 沒有在 15 秒內重新上線。");
    }

    setDebugRestartStatus("Server 已重新啟動，正在重新載入…");
    await motion?.emphasize?.(debugRestartServer, {
      duration: 180,
    });

    window.location.reload();
  } catch (error) {
    debugRestartServer.disabled = false;
    debugRestartIcon.classList.remove("animate-spin");
    setDebugRestartStatus(
      "重新啟動失敗：" + (error?.message || String(error)),
      true,
    );
  }
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
});

document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    !themeDialog.open &&
    !backgroundUploadDialog.open
  ) {
    setServerMenuOpen(false);
    serverStatusButton.focus();
  }
});

window.addEventListener("nutc-theme-change", () => {
  syncThemeMenu();
  if (modulesCache.length) renderModules(modulesCache, { animate: false });
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
    renderModules(modulesResult.value.modules || [], {
      animate: !initialModulesAnimated,
    });
    initialModulesAnimated = true;
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
