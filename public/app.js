const motion = window.NutcMotion;
const moduleGrid = document.querySelector("#moduleGrid");
const moduleLoadingModules = document.querySelector("#moduleLoadingModules");
const moduleLoadingPortal = document.querySelector("#moduleLoadingPortal");
const moduleLoadingDetail = document.querySelector("#moduleLoadingDetail");
const moduleLoadingElapsed = document.querySelector("#moduleLoadingElapsed");
const classScheduleCard = document.querySelector("#classScheduleCard");
const scheduleGrid = document.querySelector("#scheduleGrid");
const scheduleMeta = document.querySelector("#scheduleMeta");
const scheduleRefreshButton = document.querySelector("#scheduleRefreshButton");
const absenceListContent = document.querySelector("#absenceListContent");
const absenceMeta = document.querySelector("#absenceMeta");
const absenceRefreshButton = document.querySelector("#absenceRefreshButton");
const portalBackdrop = document.querySelector("#portalBackdrop");
const portalHeader = document.querySelector("#portalHeader");
const portalIdentity = document.querySelector("#portalIdentity");
const portalActions = document.querySelector("#portalActions");
const serverMenu = document.querySelector("#serverMenu");
const serverStatusButton = document.querySelector("#serverStatusButton");
const serverStatusIcon = document.querySelector("#serverStatusIcon");
const serverStatusText = document.querySelector("#serverStatusText");
const serverStatusChevron = document.querySelector("#serverStatusChevron");
const serverStatusMenu = document.querySelector("#serverStatusMenu");
const serverLoginAction = document.querySelector("#serverLoginAction");
const serverLogoutAction = document.querySelector("#serverLogoutAction");
const settingsButton = document.querySelector("#settingsButton");
const accountAvatarButton = document.querySelector("#accountAvatarButton");
const accountAvatarImage = document.querySelector("#accountAvatarImage");
const accountAvatarFallback = document.querySelector("#accountAvatarFallback");
const welcomeUsername = document.querySelector("#welcomeUsername");
const accountSettingsAction = document.querySelector("#accountSettingsAction");
const accountDialog = document.querySelector("#accountDialog");
const accountDialogClose = document.querySelector("#accountDialogClose");
const accountAvatarInput = document.querySelector("#accountAvatarInput");
const accountAvatarPreview = document.querySelector("#accountAvatarPreview");
const accountAvatarPreviewFallback = document.querySelector("#accountAvatarPreviewFallback");
const accountAvatarChoose = document.querySelector("#accountAvatarChoose");
const accountAvatarRemove = document.querySelector("#accountAvatarRemove");
const accountUsername = document.querySelector("#accountUsername");
const accountSettingsStatus = document.querySelector("#accountSettingsStatus");
const accountSettingsCancel = document.querySelector("#accountSettingsCancel");
const accountSettingsSave = document.querySelector("#accountSettingsSave");
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
const debugUpdateServer = document.querySelector("#debugUpdateServer");
const debugUpdateStatus = document.querySelector("#debugUpdateStatus");
const debugUpdateIcon = document.querySelector("#debugUpdateIcon");

let modulesCache = [];
let stagedThemeSettings = null;
let pendingBackgroundFile = null;
let lastStatusIconKind = "";
let initialModulesAnimated = false;
let statusPointerInside = false;
let statusFocusInside = false;
let classScheduleData = null;
let absenceListData = null;

const accountNameKey = "nutc-portal-account-name-v1";
const accountAvatarKey = "nutc-portal-account-avatar-v1";
let stagedAccountAvatar = "";
let stagedAccountAvatarChanged = false;
let currentAccountProfile = {
  initialized: false,
  username: "User",
  avatarUrl: "",
};

async function api(path) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.error || `Request failed (${response.status})`,
    );
    error.code = data.code || "";
    error.status = response.status;
    throw error;
  }

  return data;
}

function renderIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function readLocal(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Browser storage is best effort.
  }
}

async function saveServerAccountProfile({
  username,
  avatarDataUrl,
  includeAvatar = false,
}) {
  const body = { username };

  if (includeAvatar) {
    body.avatarDataUrl = avatarDataUrl;
  }

  const response = await fetch("/api/preferences/account", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error || `Unable to save account settings (${response.status}).`,
    );
    error.code = data.code || "";
    throw error;
  }

  return data.account;
}

async function loadServerAccountProfile() {
  try {
    const preferences = await api("/api/preferences");
    let account = preferences.account || {
      initialized: false,
      username: "User",
      avatarUrl: "",
    };

    if (!account.initialized) {
      const legacyUsername = readLocal(accountNameKey, "").trim();
      const legacyAvatar = readLocal(accountAvatarKey, "");

      if (legacyUsername || legacyAvatar) {
        account = await saveServerAccountProfile({
          username: legacyUsername || "User",
          avatarDataUrl: legacyAvatar,
          includeAvatar: Boolean(legacyAvatar),
        });
      }
    }

    writeLocal(accountNameKey, "");
    writeLocal(accountAvatarKey, "");

    currentAccountProfile = {
      initialized: Boolean(account.initialized),
      username: account.username?.trim() || "User",
      avatarUrl: account.avatarUrl || "",
    };
  } catch (error) {
    console.warn(
      "Server account preferences unavailable; using local fallback:",
      error?.message || error,
    );

    currentAccountProfile = {
      initialized: false,
      username: readLocal(accountNameKey, "User").trim() || "User",
      avatarUrl: readLocal(accountAvatarKey, ""),
    };
  }

  return currentAccountProfile;
}

function applyAccountProfile(profile = currentAccountProfile) {
  const username = profile?.username?.trim() || "User";
  const avatar = profile?.avatarUrl || "";

  welcomeUsername.textContent = username;

  if (avatar) {
    accountAvatarImage.src = avatar;
    accountAvatarImage.classList.remove("hidden");
    accountAvatarFallback.classList.add("hidden");
  } else {
    accountAvatarImage.removeAttribute("src");
    accountAvatarImage.classList.add("hidden");
    accountAvatarFallback.classList.remove("hidden");
  }
}

function setAccountPreview(avatar) {
  if (avatar) {
    accountAvatarPreview.src = avatar;
    accountAvatarPreview.classList.remove("hidden");
    accountAvatarPreviewFallback.classList.add("hidden");
    accountAvatarRemove.disabled = false;
    accountAvatarRemove.classList.remove("opacity-45", "cursor-not-allowed");
  } else {
    accountAvatarPreview.removeAttribute("src");
    accountAvatarPreview.classList.add("hidden");
    accountAvatarPreviewFallback.classList.remove("hidden");
    accountAvatarRemove.disabled = true;
    accountAvatarRemove.classList.add("opacity-45", "cursor-not-allowed");
  }
}

function setAccountSettingsStatus(message = "", isError = false) {
  accountSettingsStatus.textContent = message;
  accountSettingsStatus.classList.toggle("text-[#f4a0a5]", isError);
  accountSettingsStatus.classList.toggle("text-[var(--muted)]", !isError);
}

function prepareAccountAvatar(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const size = 320;
      const sourceSize = Math.min(image.width, image.height);
      const sx = Math.max(0, (image.width - sourceSize) / 2);
      const sy = Math.max(0, (image.height - sourceSize) / 2);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");

      ctx.drawImage(
        image,
        sx,
        sy,
        sourceSize,
        sourceSize,
        0,
        0,
        size,
        size,
      );

      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };

    image.onerror = () => reject(new Error("無法讀取這張圖片。"));
    image.src = dataUrl;
  });
}

async function readAccountAvatarFile(file) {
  if (!file) return;

  if (!String(file.type || "").startsWith("image/")) {
    setAccountSettingsStatus("請選擇圖片檔案。", true);
    return;
  }

  if (file.size > 12 * 1024 * 1024) {
    setAccountSettingsStatus("圖片太大，請選擇 12 MB 以下的圖片。", true);
    return;
  }

  accountAvatarChoose.disabled = true;
  setAccountSettingsStatus("正在處理圖片…");

  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("無法讀取這張圖片。"));
      reader.readAsDataURL(file);
    });

    stagedAccountAvatar = await prepareAccountAvatar(dataUrl);
    stagedAccountAvatarChanged = true;
    setAccountPreview(stagedAccountAvatar);
    setAccountSettingsStatus("圖片已準備好，按 Save 套用。");
  } catch (error) {
    setAccountSettingsStatus(
      error?.message || "無法處理這張圖片。",
      true,
    );
  } finally {
    accountAvatarChoose.disabled = false;
  }
}

async function openAccountDialog() {
  setServerMenuOpen(false);

  accountUsername.value =
    currentAccountProfile.username?.trim() || "User";
  stagedAccountAvatar = currentAccountProfile.avatarUrl || "";
  stagedAccountAvatarChanged = false;
  setAccountPreview(stagedAccountAvatar);
  setAccountSettingsStatus("");
  renderIcons();

  await motion?.openDialog?.(
    accountDialog,
    accountDialog.firstElementChild,
    {
      duration: 260,
      y: 12,
      scale: 0.97,
    },
  );

  requestAnimationFrame(() => accountUsername.focus());
}

async function closeAccountDialog() {
  if (!accountDialog.open) return;

  await motion?.closeDialog?.(
    accountDialog,
    accountDialog.firstElementChild,
    {
      duration: 170,
      y: 8,
      scale: 0.985,
    },
  );

  stagedAccountAvatar = "";
  stagedAccountAvatarChanged = false;
  accountAvatarInput.value = "";
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
  updateStatusButtonExpansion();
  serverStatusButton.title = detail;
  serverStatusButton.setAttribute("aria-label", detail);

  serverLoginAction.querySelector("span").textContent =
    canLogout ? "重新登入" : "登入";
  serverLogoutAction.classList.toggle("hidden", !canLogout);
  serverLogoutAction.classList.toggle("flex", canLogout);
}

function taipeiNowParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function taipeiDayIndex() {
  return {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  }[taipeiNowParts().weekday] ?? 0;
}

function taipeiMinutesNow() {
  const parts = taipeiNowParts();
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
}

function taipeiWeekDates() {
  const parts = taipeiNowParts();
  const today = new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      12,
    ),
  );
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - taipeiDayIndex());

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(
      date.getUTCDate(),
    ).padStart(2, "0")}`;
  });
}

function clockMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function sameScheduleCourse(left, right) {
  return (
    left?.name === right?.name &&
    left?.teacher === right?.teacher &&
    left?.room === right?.room
  );
}

function scheduleCourseHash(course) {
  const value = [course?.name, course?.teacher, course?.room]
    .filter(Boolean)
    .join("|");

  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

function scheduleCourseTheme(course) {
  const palette = window.NutcTheme?.palette?.() || [
    "#f0a8c8",
    "#e8b86d",
    "#51314a",
    "#f07178",
    "#151018",
  ];
  const rgba = window.NutcTheme?.rgba || ((color) => color);
  const usable = [palette[0], palette[1], palette[2]].filter(Boolean);
  const hash = scheduleCourseHash(course);
  const accent = usable[hash % usable.length] || palette[0] || "#f0a8c8";

  return {
    accent,
    background:
      `linear-gradient(120deg, ${rgba(accent, 0.1)} 0%, rgba(255,255,255,.025) 72%)`,
    border: rgba(accent, 0.2),
    glow: rgba(accent, 0.1),
  };
}

function weeklyScheduleBlocks(periods) {
  const blocks = [];

  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    let periodIndex = 0;

    while (periodIndex < periods.length) {
      const course = periods[periodIndex]?.days?.[dayIndex] || {};

      if (!course.name && !course.teacher && !course.room) {
        periodIndex += 1;
        continue;
      }

      let endPeriodIndex = periodIndex;

      while (
        endPeriodIndex + 1 < periods.length &&
        sameScheduleCourse(
          course,
          periods[endPeriodIndex + 1]?.days?.[dayIndex] || {},
        )
      ) {
        endPeriodIndex += 1;
      }

      const startPeriod = periods[periodIndex];
      const endPeriod = periods[endPeriodIndex];
      const [startTime = ""] = String(startPeriod.time || "").split("~");
      const [, endTime = ""] = String(endPeriod.time || "").split("~");

      blocks.push({
        ...course,
        dayIndex,
        startPeriodIndex: periodIndex,
        endPeriodIndex,
        startSlot: startPeriod.slot,
        endSlot: endPeriod.slot,
        startTime,
        endTime,
      });

      periodIndex = endPeriodIndex + 1;
    }
  }

  return blocks;
}

function setScheduleMessage(message, { kind = "info" } = {}) {
  if (!scheduleGrid) return;

  scheduleGrid.setAttribute("aria-busy", String(kind === "loading"));
  scheduleGrid.replaceChildren();

  const card = document.createElement("div");
  card.className =
    "flex min-h-[180px] items-center justify-center gap-3 px-4 text-center text-sm font-medium text-[var(--muted)]";

  const icon = document.createElement("i");
  icon.dataset.lucide =
    kind === "loading"
      ? "loader-circle"
      : kind === "error"
        ? "circle-alert"
        : kind === "login"
          ? "log-in"
          : "calendar-days";
  icon.className =
    "h-4 w-4 shrink-0 " + (kind === "loading" ? "animate-spin" : "");

  const text = document.createElement("span");
  text.textContent = message;

  card.append(icon, text);
  scheduleGrid.append(card);
  renderIcons();
}

function renderScheduleGrid() {
  if (!scheduleGrid || !classScheduleData?.periods) return;

  const periods = classScheduleData.periods;
  const blocks = weeklyScheduleBlocks(periods);
  const dayIndices = [...new Set(blocks.map((block) => block.dayIndex))].sort(
    (left, right) => left - right,
  );

  if (!blocks.length || !dayIndices.length) {
    setScheduleMessage("目前沒有可顯示的課表資料。");
    return;
  }

  const dayLabels = classScheduleData.dayLabels || [
    "週一",
    "週二",
    "週三",
    "週四",
    "週五",
    "週六",
    "週日",
  ];
  const weekDates = taipeiWeekDates();
  const today = taipeiDayIndex();
  const nowMinutes = taipeiMinutesNow();
  const palette = window.NutcTheme?.palette?.() || ["#f0a8c8"];
  const rgba = window.NutcTheme?.rgba || ((color) => color);
  const primary = palette[0] || "#f0a8c8";

  scheduleGrid.setAttribute("aria-busy", "false");
  scheduleGrid.replaceChildren();

  const board = document.createElement("div");
  board.className =
    "grid gap-3 p-3 sm:p-4 md:grid-cols-2";

  dayIndices.forEach((dayIndex) => {
    const dayBlocks = blocks
      .filter((block) => block.dayIndex === dayIndex)
      .sort(
        (left, right) =>
          left.startPeriodIndex - right.startPeriodIndex,
      );
    const isToday = dayIndex === today;

    const dayCard = document.createElement("section");
    dayCard.className =
      "min-w-0 rounded-[16px] border border-white/[.08] bg-white/[.025] p-3 shadow-sm backdrop-blur-[12px] sm:p-3.5";
    if (isToday) {
      dayCard.style.borderColor = rgba(primary, 0.28);
      dayCard.style.background =
        `linear-gradient(145deg, ${rgba(primary, 0.075)} 0%, rgba(255,255,255,.025) 70%)`;
    }

    const header = document.createElement("header");
    header.className =
      "mb-3 flex items-center justify-between gap-3 border-b border-white/[.07] pb-2.5";

    const heading = document.createElement("div");
    heading.className = "min-w-0";

    const headingRow = document.createElement("div");
    headingRow.className = "flex min-w-0 items-center gap-2";

    const day = document.createElement("strong");
    day.className =
      "truncate text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]";
    day.textContent = dayLabels[dayIndex] || `週${dayIndex + 1}`;

    headingRow.append(day);

    if (isToday) {
      const todayBadge = document.createElement("span");
      todayBadge.className =
        "shrink-0 rounded-full border border-[var(--primary-ring)] bg-[var(--primary-soft)] px-2 py-0.5 text-[9px] font-semibold text-[var(--primary)]";
      todayBadge.textContent = "今天";
      headingRow.append(todayBadge);
    }

    const date = document.createElement("p");
    date.className =
      "mt-0.5 text-[10px] font-medium text-[var(--faint)]";
    date.textContent = weekDates[dayIndex] || "";

    heading.append(headingRow, date);

    const count = document.createElement("span");
    count.className =
      "shrink-0 rounded-full border border-white/[.08] bg-white/[.035] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]";
    count.textContent = `${dayBlocks.length} 堂`;

    header.append(heading, count);
    dayCard.append(header);

    const list = document.createElement("div");
    list.className = "grid gap-2";

    dayBlocks.forEach((block) => {
      const theme = scheduleCourseTheme(block);
      const startMinutes = clockMinutes(block.startTime);
      const endMinutes = clockMinutes(block.endTime);
      const isNow =
        isToday &&
        startMinutes !== null &&
        endMinutes !== null &&
        nowMinutes >= startMinutes &&
        nowMinutes <= endMinutes;

      const course = document.createElement("article");
      course.className =
        "relative overflow-hidden rounded-[14px] border p-3 transition duration-150 hover:-translate-y-px hover:bg-white/[.04]";
      course.style.borderColor = isNow
        ? rgba(primary, 0.42)
        : theme.border;
      course.style.background = theme.background;
      course.style.boxShadow = isNow
        ? `inset 3px 0 0 ${rgba(primary, 0.95)}, 0 8px 24px ${theme.glow}`
        : `inset 3px 0 0 ${rgba(theme.accent, 0.68)}, 0 4px 14px ${theme.glow}`;
      course.title = [
        block.name,
        block.room,
        block.teacher,
        `${block.startTime}–${block.endTime}`,
      ]
        .filter(Boolean)
        .join(" · ");

      const row = document.createElement("div");
      row.className =
        "flex min-w-0 items-start gap-3";

      const timeColumn = document.createElement("div");
      timeColumn.className =
        "w-[68px] shrink-0 border-r border-white/[.08] pr-3";

      const time = document.createElement("strong");
      time.className =
        "block text-[11px] font-semibold tabular-nums leading-4 text-[var(--foreground)]";
      time.textContent = block.startTime || "—";

      const endTime = document.createElement("span");
      endTime.className =
        "block text-[10px] font-medium tabular-nums leading-4 text-[var(--faint)]";
      endTime.textContent = block.endTime || "";

      const slot = document.createElement("span");
      slot.className =
        "mt-1.5 inline-flex rounded-full border border-white/[.08] bg-black/10 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--muted)]";
      slot.textContent =
        block.startSlot === block.endSlot
          ? `第 ${block.startSlot} 節`
          : `第 ${block.startSlot}–${block.endSlot} 節`;

      timeColumn.append(time);
      if (endTime.textContent) timeColumn.append(endTime);
      timeColumn.append(slot);

      const content = document.createElement("div");
      content.className = "min-w-0 flex-1";

      const titleRow = document.createElement("div");
      titleRow.className =
        "flex min-w-0 items-start justify-between gap-2";

      const title = document.createElement("strong");
      title.className =
        "min-w-0 break-words text-[13px] font-semibold leading-5 tracking-[-0.015em] text-[var(--foreground)] sm:text-sm";
      title.textContent = block.name || "未命名課程";

      titleRow.append(title);

      if (isNow) {
        const badge = document.createElement("span");
        badge.className =
          "shrink-0 rounded-full border border-[var(--primary-ring)] bg-[var(--primary-soft)] px-2 py-0.5 text-[9px] font-semibold text-[var(--primary)]";
        badge.textContent = "現在";
        titleRow.append(badge);
      }

      const meta = document.createElement("p");
      meta.className =
        "mt-1 text-[10px] font-medium leading-4 text-[var(--muted)] sm:text-[11px]";
      meta.textContent = [block.room, block.teacher].filter(Boolean).join(" · ");

      content.append(titleRow);
      if (meta.textContent) content.append(meta);

      row.append(timeColumn, content);
      course.append(row);
      list.append(course);
    });

    dayCard.append(list);
    board.append(dayCard);
  });

  scheduleGrid.append(board);
}

function updateScheduleMeta(data) {
  if (!scheduleMeta) return;

  const fetched = data?.fetchedAt
    ? new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(data.fetchedAt))
    : "";

  const parts = [];
  if (data?.termLabel) parts.push(data.termLabel);
  parts.push(data?.stale ? "顯示快取" : "NUTC AIS");
  if (fetched) parts.push(`更新 ${fetched}`);

  scheduleMeta.textContent = parts.join(" · ");
  scheduleMeta.title = data?.refreshError || "";
}

async function loadClassSchedule({ force = false } = {}) {
  if (!scheduleRefreshButton) return;

  const refreshIcon = scheduleRefreshButton.querySelector("svg");
  scheduleRefreshButton.disabled = true;
  refreshIcon?.classList.add("animate-spin");

  if (!classScheduleData) {
    setScheduleMessage("正在從 AIS 載入課表…", { kind: "loading" });
    scheduleMeta.textContent = "正在連線 NUTC AIS";
  } else {
    scheduleMeta.textContent = "正在更新課表…";
  }

  try {
    const data = await api(
      force ? "/api/class-schedule?refresh=1" : "/api/class-schedule",
    );

    if (!Array.isArray(data?.periods)) {
      throw new Error("AIS 課表資料格式不正確。");
    }

    classScheduleData = data;
    renderScheduleGrid();
    updateScheduleMeta(data);
  } catch (error) {
    if (classScheduleData) {
      scheduleMeta.textContent = "更新失敗，保留目前課表";
      scheduleMeta.title = error?.message || "";
      renderScheduleGrid();
      return;
    }

    if (error?.status === 401 || error?.code === "EPORTAL_LOGIN_REQUIRED") {
      scheduleMeta.textContent = "需要 Server ePortal 登入";
      setScheduleMessage("請先從右上角登入 Server ePortal，再載入課表。", {
        kind: "login",
      });
    } else if (error?.status === 409) {
      scheduleMeta.textContent = "Server ePortal 使用中";
      setScheduleMessage("Server ePortal 正在執行其他操作，稍後按更新重試。");
    } else {
      scheduleMeta.textContent = "課表載入失敗";
      scheduleMeta.title = error?.message || "";
      setScheduleMessage(error?.message || "無法載入 AIS 課表。", {
        kind: "error",
      });
    }
  } finally {
    scheduleRefreshButton.disabled = false;
    scheduleRefreshButton.querySelector("svg")?.classList.remove("animate-spin");
  }
}

function resetClassScheduleForLoggedOutState() {
  classScheduleData = null;
  scheduleMeta.textContent = "需要 Server ePortal 登入";
  scheduleMeta.title = "";
  setScheduleMessage("請先從右上角登入 Server ePortal，再載入課表。", {
    kind: "login",
  });
}

scheduleRefreshButton?.addEventListener("click", () => {
  void loadClassSchedule({ force: true });
});

function absenceItemAccent(item, index) {
  const palette = window.NutcTheme?.palette?.() || [
    "#f0a8c8",
    "#e8b86d",
    "#51314a",
    "#f07178",
  ];
  const usable = palette.slice(0, 4).filter(Boolean);
  const source = [
    item?.status,
    item?.course,
    item?.className,
    index,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join("|");

  let hash = 0;
  for (const char of source) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }

  return usable[Math.abs(hash) % Math.max(1, usable.length)] || "#f0a8c8";
}

function setAbsenceMessage(message, { kind = "info" } = {}) {
  if (!absenceListContent) return;

  absenceListContent.setAttribute("aria-busy", String(kind === "loading"));
  absenceListContent.replaceChildren();

  const card = document.createElement("div");
  card.className =
    "flex min-h-[150px] items-center justify-center gap-3 px-3 text-center text-sm font-medium text-[var(--muted)]";

  const icon = document.createElement("i");
  icon.dataset.lucide =
    kind === "loading"
      ? "loader-circle"
      : kind === "error"
        ? "circle-alert"
        : kind === "login"
          ? "log-in"
          : "clipboard-list";
  icon.className =
    "h-4 w-4 shrink-0 " + (kind === "loading" ? "animate-spin" : "");

  const text = document.createElement("span");
  text.textContent = message;

  card.append(icon, text);
  absenceListContent.append(card);
  renderIcons();
}

function renderAbsenceList() {
  if (!absenceListContent || !absenceListData) return;

  const items = Array.isArray(absenceListData.items)
    ? absenceListData.items
    : [];

  if (!items.length) {
    setAbsenceMessage(
      absenceListData.emptyMessage || "目前沒有缺曠紀錄。",
    );
    return;
  }

  const rgba = window.NutcTheme?.rgba || ((color) => color);
  absenceListContent.setAttribute("aria-busy", "false");
  absenceListContent.replaceChildren();

  const summaryEntries = Object.entries(absenceListData.summary || {}).filter(
    ([, count]) => Number(count) > 0,
  );

  if (summaryEntries.length) {
    const summary = document.createElement("div");
    summary.className =
      "mb-3 flex flex-wrap gap-1.5 rounded-[14px] border border-white/[.08] bg-white/[.025] p-2.5";

    summaryEntries.forEach(([label, count], index) => {
      const accent = absenceItemAccent(
        { status: label, course: label },
        index,
      );
      const chip = document.createElement("span");
      chip.className =
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold";
      chip.style.color = accent;
      chip.style.borderColor = rgba(accent, 0.28);
      chip.style.backgroundColor = rgba(accent, 0.1);
      chip.textContent = `${label} ${count}`;
      summary.append(chip);
    });

    absenceListContent.append(summary);
  }

  const list = document.createElement("div");
  list.className = "grid gap-2.5";

  items.forEach((item, index) => {
    const accent = absenceItemAccent(item, index);
    const row = document.createElement("article");
    row.className =
      "rounded-[16px] border p-3 shadow-sm backdrop-blur-[12px]";
    row.style.borderColor = rgba(accent, 0.18);
    row.style.background =
      `linear-gradient(115deg, ${rgba(accent, 0.07)} 0%, rgba(255,255,255,.025) 78%)`;

    const course = document.createElement("strong");
    course.className =
      "block break-words text-sm font-semibold leading-5 text-[var(--foreground)]";
    course.textContent = item.course || "未命名課程";

    const meta = document.createElement("p");
    meta.className =
      "mt-1 text-[11px] font-medium leading-4 text-[var(--muted)]";
    meta.textContent = [
      item.className,
      item.teacher,
      item.credits,
      item.required,
    ]
      .filter(Boolean)
      .join(" · ");

    row.append(course);
    if (meta.textContent) row.append(meta);

    const statuses = Array.isArray(item.statusLines) && item.statusLines.length
      ? item.statusLines
      : item.status
        ? [item.status]
        : [];

    if (statuses.length) {
      const statusWrap = document.createElement("div");
      statusWrap.className = "mt-2.5 flex flex-wrap gap-1.5";

      statuses.forEach((statusText, statusIndex) => {
        const statusAccent = absenceItemAccent(
          {
            ...item,
            status: statusText,
          },
          index + statusIndex,
        );
        const badge = document.createElement("span");
        badge.className =
          "inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold leading-none";
        badge.style.color = statusAccent;
        badge.style.borderColor = rgba(statusAccent, 0.32);
        badge.style.backgroundColor = rgba(statusAccent, 0.11);
        badge.textContent = statusText;
        statusWrap.append(badge);
      });

      row.append(statusWrap);
    }

    list.append(row);
  });

  absenceListContent.append(list);
}

function updateAbsenceMeta(data) {
  if (!absenceMeta) return;

  const fetched = data?.fetchedAt
    ? new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(data.fetchedAt))
    : "";

  const parts = [];
  if (data?.termLabel) parts.push(data.termLabel);
  parts.push(`${Number(data?.total || 0)} 筆`);
  if (data?.stale) parts.push("顯示快取");
  if (fetched) parts.push(`更新 ${fetched}`);

  absenceMeta.textContent = parts.join(" · ");
  absenceMeta.title = data?.refreshError || "";
}

async function loadAbsenceList({ force = false } = {}) {
  if (!absenceRefreshButton) return;

  const refreshIcon = absenceRefreshButton.querySelector("svg");
  absenceRefreshButton.disabled = true;
  refreshIcon?.classList.add("animate-spin");

  if (!absenceListData) {
    setAbsenceMessage("正在從 AIS 載入缺曠紀錄…", { kind: "loading" });
    absenceMeta.textContent = "正在連線 NUTC AIS";
  } else {
    absenceMeta.textContent = "正在更新缺曠紀錄…";
  }

  try {
    const data = await api(
      force ? "/api/absence-list?refresh=1" : "/api/absence-list",
    );

    if (!Array.isArray(data?.items)) {
      throw new Error("AIS 缺曠資料格式不正確。");
    }

    absenceListData = data;
    renderAbsenceList();
    updateAbsenceMeta(data);
  } catch (error) {
    if (absenceListData) {
      absenceMeta.textContent = "更新失敗，保留目前紀錄";
      absenceMeta.title = error?.message || "";
      renderAbsenceList();
      return;
    }

    if (error?.status === 401 || error?.code === "EPORTAL_LOGIN_REQUIRED") {
      absenceMeta.textContent = "需要 Server ePortal 登入";
      setAbsenceMessage("請先登入 Server ePortal，再載入缺曠紀錄。", {
        kind: "login",
      });
    } else if (error?.status === 409) {
      absenceMeta.textContent = "Server ePortal 使用中";
      setAbsenceMessage("Server ePortal 正在執行其他操作，稍後按更新重試。");
    } else {
      absenceMeta.textContent = "缺曠紀錄載入失敗";
      absenceMeta.title = error?.message || "";
      setAbsenceMessage(error?.message || "無法載入 AIS 缺曠紀錄。", {
        kind: "error",
      });
    }
  } finally {
    absenceRefreshButton.disabled = false;
    absenceRefreshButton.querySelector("svg")?.classList.remove("animate-spin");
  }
}

function resetAbsenceListForLoggedOutState() {
  absenceListData = null;
  absenceMeta.textContent = "需要 Server ePortal 登入";
  absenceMeta.title = "";
  setAbsenceMessage("請先登入 Server ePortal，再載入缺曠紀錄。", {
    kind: "login",
  });
}

absenceRefreshButton?.addEventListener("click", () => {
  void loadAbsenceList({ force: true });
});

function openModule(module) {
  window.location.assign(module.launchPath);
}

function moduleAccent(index) {
  const palette = window.NutcTheme?.palette?.() || [
    "#f0a8c8",
    "#e8b86d",
    "#c79af4",
    "#7cc9ff",
    "#151018",
  ];

  const order = [0, 1, 2, 3, 1];
  return palette[order[index % order.length]] || palette[0] || "#f0a8c8";
}

function renderModules(modules, { animate = false } = {}) {
  modulesCache = modules;
  moduleGrid.replaceChildren();

  modules.forEach((module, index) => {
    const accent = moduleAccent(index);
    const rgba = window.NutcTheme?.rgba || ((color) => color);

    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "group relative flex min-h-[108px] w-full items-center gap-4 overflow-hidden rounded-[20px] border p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,.18)] backdrop-blur-[18px] backdrop-saturate-[170%] transition duration-150 ease-soft-out hover:-translate-y-px hover:bg-white/[.075] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--primary-ring)] sm:p-5";
    button.style.borderColor = rgba(accent, 0.18);
    button.style.background =
      `linear-gradient(110deg, ${rgba(accent, 0.06)} 0%, rgba(22,16,28,.08) 42%, rgba(12,10,14,.34) 100%)`;
    button.setAttribute("aria-label", `開啟 ${module.name}`);

    const icon = document.createElement("span");
    icon.className =
      "relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-[11px] border transition duration-150 group-hover:-translate-y-px";
    icon.style.color = accent;
    icon.style.backgroundColor = rgba(accent, 0.12);
    icon.style.borderColor = rgba(accent, 0.3);
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
    arrow.style.backgroundColor = rgba(accent, 0.07);
    arrow.style.borderColor = rgba(accent, 0.18);
    arrow.innerHTML =
      '<i data-lucide="arrow-right" class="h-[18px] w-[18px]" aria-hidden="true"></i>';

    copy.append(title, description);
    button.append(icon, copy, arrow);
    button.addEventListener("mouseenter", () => {
      button.style.borderColor = rgba(accent, 0.3);
    });
    button.addEventListener("mouseleave", () => {
      button.style.borderColor = rgba(accent, 0.18);
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

function setStatusButtonExpanded(expanded) {
  serverStatusButton.dataset.statusExpanded = String(expanded);

  serverStatusButton.classList.toggle("gap-2", expanded);
  serverStatusButton.classList.toggle("px-2.5", expanded);
  serverStatusButton.classList.toggle("pr-3", expanded);
  serverStatusButton.classList.toggle("gap-0", !expanded);
  serverStatusButton.classList.toggle("px-1.5", !expanded);

  serverStatusText.classList.toggle("max-w-[8rem]", expanded);
  serverStatusText.classList.toggle("opacity-100", expanded);
  serverStatusText.classList.toggle("max-w-0", !expanded);
  serverStatusText.classList.toggle("opacity-0", !expanded);

  serverStatusChevron.classList.toggle("w-4", expanded);
  serverStatusChevron.classList.toggle("opacity-100", expanded);
  serverStatusChevron.classList.toggle("ml-0.5", expanded);
  serverStatusChevron.classList.toggle("w-0", !expanded);
  serverStatusChevron.classList.toggle("opacity-0", !expanded);
  serverStatusChevron.classList.toggle("ml-0", !expanded);
}

function statusButtonHasRoom() {
  if (!portalHeader || !portalIdentity || !portalActions) return false;

  const headerWidth = portalHeader.getBoundingClientRect().width;
  const settingsWidth = settingsButton.getBoundingClientRect().width;
  const avatarWidth = accountAvatarButton.getBoundingClientRect().width;
  const identityText = portalIdentity.querySelector("div");
  const identityTextWidth = Math.min(
    330,
    Math.max(150, identityText?.scrollWidth || 150),
  );
  const identityNeeded = avatarWidth + 12 + identityTextWidth;

  const statusNeeded =
    28 +
    Math.min(128, Math.max(38, serverStatusText.scrollWidth)) +
    16 +
    16 +
    22;

  const outerGap = window.innerWidth >= 640 ? 12 : 8;
  const actionGap = 8;

  return (
    headerWidth >=
    identityNeeded +
      outerGap +
      statusNeeded +
      actionGap +
      settingsWidth
  );
}

function updateStatusButtonExpansion() {
  const menuOpen =
    serverStatusButton.getAttribute("aria-expanded") === "true";
  const forced =
    statusPointerInside ||
    statusFocusInside ||
    menuOpen;

  setStatusButtonExpanded(forced || statusButtonHasRoom());
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
  updateStatusButtonExpansion();
}

serverStatusButton.addEventListener("pointerenter", () => {
  statusPointerInside = true;
  updateStatusButtonExpansion();
});

serverStatusButton.addEventListener("pointerleave", () => {
  statusPointerInside = false;
  updateStatusButtonExpansion();
});

serverStatusButton.addEventListener("focusin", () => {
  statusFocusInside = true;
  updateStatusButtonExpansion();
});

serverStatusButton.addEventListener("focusout", () => {
  statusFocusInside = false;
  requestAnimationFrame(updateStatusButtonExpansion);
});

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

accountAvatarButton.addEventListener("click", () => {
  void motion?.emphasize?.(accountAvatarButton, { duration: 180 });
  void openAccountDialog();
});

accountSettingsAction.addEventListener("click", () => {
  void openAccountDialog();
});

accountDialogClose.addEventListener("click", () => {
  void closeAccountDialog();
});

accountSettingsCancel.addEventListener("click", () => {
  void closeAccountDialog();
});

accountDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  void closeAccountDialog();
});

accountDialog.addEventListener("click", (event) => {
  if (event.target === accountDialog) {
    void closeAccountDialog();
  }
});

accountAvatarChoose.addEventListener("click", () => {
  accountAvatarInput.value = "";
  accountAvatarInput.click();
});

accountAvatarInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  void readAccountAvatarFile(file);
});

accountAvatarRemove.addEventListener("click", () => {
  stagedAccountAvatar = "";
  stagedAccountAvatarChanged = true;
  setAccountPreview("");
  setAccountSettingsStatus("帳號圖片會在儲存後移除。");
});

accountSettingsSave.addEventListener("click", async () => {
  const username = accountUsername.value.trim();

  if (!username) {
    setAccountSettingsStatus("請輸入 Username。", true);
    accountUsername.focus();
    return;
  }

  accountSettingsSave.disabled = true;
  accountAvatarChoose.disabled = true;
  setAccountSettingsStatus("正在儲存到 Server…");

  try {
    const account = await saveServerAccountProfile({
      username,
      avatarDataUrl: stagedAccountAvatar,
      includeAvatar: stagedAccountAvatarChanged,
    });

    currentAccountProfile = {
      initialized: true,
      username: account.username?.trim() || "User",
      avatarUrl: account.avatarUrl || "",
    };

    writeLocal(accountNameKey, "");
    writeLocal(accountAvatarKey, "");
    applyAccountProfile();
    setAccountSettingsStatus("已儲存到 Server。");
    await motion?.emphasize?.(accountSettingsSave, { duration: 180 });
    await closeAccountDialog();
  } catch (error) {
    setAccountSettingsStatus(
      "儲存失敗：" + (error?.message || String(error)),
      true,
    );
  } finally {
    accountSettingsSave.disabled = false;
    accountAvatarChoose.disabled = false;
  }
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

clearBackgroundAction.addEventListener("click", async () => {
  clearBackgroundAction.disabled = true;

  try {
    await window.NutcTheme.clearBackground();
    syncThemeMenu();
    void motion?.fade?.(portalBackdrop, {
      duration: 280,
      from: 0.55,
      to: 1,
    });
  } catch (error) {
    console.error("Could not clear server background:", error);
  } finally {
    clearBackgroundAction.disabled = false;
  }
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

debugUpdateServer.addEventListener("click", async () => {
  if (debugUpdateServer.disabled) return;

  debugUpdateServer.disabled = true;
  debugRestartServer.disabled = true;
  debugUpdateIcon.classList.add("animate-spin");
  debugUpdateStatus.textContent = "正在檢查最新 GitHub Release…";
  debugUpdateStatus.classList.remove("text-[#f4a0a5]");
  debugUpdateStatus.classList.add("text-[var(--muted)]");

  try {
    const before = await api("/api/server/status");
    const response = await fetch("/api/debug/update", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `Update failed (${response.status})`,
      );
    }

    if (!data.updated) {
      debugUpdateStatus.textContent = data.aheadOfRelease
        ? `目前版本比最新 Release（${data.release?.name || data.release?.tag || "latest"}）更新。`
        : `已是最新版本：${data.release?.name || data.release?.tag || "latest"}`;
      debugUpdateServer.disabled = false;
      debugRestartServer.disabled = false;
      debugUpdateIcon.classList.remove("animate-spin");
      return;
    }

    debugUpdateStatus.textContent =
      `已更新到 ${data.release?.name || data.release?.tag || "latest"}，正在重新啟動…`;

    const restarted = await waitForServerRestart(before.instanceId);

    if (!restarted) {
      throw new Error("更新完成，但 Server 沒有在 15 秒內重新上線。");
    }

    debugUpdateStatus.textContent = "更新完成，正在重新載入…";
    await motion?.emphasize?.(debugUpdateServer, {
      duration: 180,
    });
    window.location.reload();
  } catch (error) {
    debugUpdateServer.disabled = false;
    debugRestartServer.disabled = false;
    debugUpdateIcon.classList.remove("animate-spin");
    debugUpdateStatus.textContent =
      "更新失敗：" + (error?.message || String(error));
    debugUpdateStatus.classList.remove("text-[var(--muted)]");
    debugUpdateStatus.classList.add("text-[#f4a0a5]");
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
    resetClassScheduleForLoggedOutState();
    resetAbsenceListForLoggedOutState();
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
    !backgroundUploadDialog.open &&
    !accountDialog.open
  ) {
    setServerMenuOpen(false);
    serverStatusButton.focus();
  }
});

window.addEventListener("nutc-theme-change", () => {
  syncThemeMenu();
  if (modulesCache.length) renderModules(modulesCache, { animate: false });
  if (classScheduleData) renderScheduleGrid();
  if (absenceListData) renderAbsenceList();
});

if (typeof ResizeObserver !== "undefined") {
  const statusLayoutObserver = new ResizeObserver(() => {
    updateStatusButtonExpansion();
  });
  statusLayoutObserver.observe(portalHeader);
  statusLayoutObserver.observe(portalIdentity);
} else {
  window.addEventListener("resize", updateStatusButtonExpansion);
}

(async () => {
  await Promise.all([
    window.NutcTheme.init(),
    loadServerAccountProfile(),
  ]);
  applyAccountProfile();
  syncThemeMenu();
  renderIcons();
  updateStatusButtonExpansion();

  const loadingStartedAt = performance.now();
  const loadingTimer = window.setInterval(() => {
    if (!moduleLoadingElapsed?.isConnected) {
      window.clearInterval(loadingTimer);
      return;
    }

    moduleLoadingElapsed.textContent =
      ((performance.now() - loadingStartedAt) / 1000).toFixed(1) + "s";
  }, 100);

  const modulesRequest = api("/api/modules").then(
    (value) => {
      if (moduleLoadingModules?.isConnected) {
        const count = Array.isArray(value.modules) ? value.modules.length : 0;
        moduleLoadingModules.textContent = `received ${count} module${count === 1 ? "" : "s"}`;
        moduleLoadingModules.classList.remove("text-[var(--accent)]");
        moduleLoadingModules.classList.add("text-[var(--primary)]");
      }
      return value;
    },
    (error) => {
      if (moduleLoadingModules?.isConnected) {
        moduleLoadingModules.textContent = "failed";
        moduleLoadingModules.classList.remove("text-[var(--accent)]");
        moduleLoadingModules.classList.add("text-[#f4a0a5]");
      }
      throw error;
    },
  );

  const statusRequest = api("/api/portal-status").then(
    (value) => {
      if (moduleLoadingPortal?.isConnected) {
        moduleLoadingPortal.textContent = value.status || "received";
        moduleLoadingPortal.classList.remove("text-[var(--accent)]");
        moduleLoadingPortal.classList.add("text-[var(--primary)]");
      }
      return value;
    },
    (error) => {
      if (moduleLoadingPortal?.isConnected) {
        moduleLoadingPortal.textContent = "failed";
        moduleLoadingPortal.classList.remove("text-[var(--accent)]");
        moduleLoadingPortal.classList.add("text-[#f4a0a5]");
      }
      throw error;
    },
  );

  if (moduleLoadingDetail?.isConnected) {
    moduleLoadingDetail.textContent =
      "Waiting for /api/modules and /api/portal-status to finish before rendering the dashboard.";
  }

  const results = await Promise.allSettled([
    modulesRequest,
    statusRequest,
  ]);

  window.clearInterval(loadingTimer);

  if (moduleLoadingElapsed?.isConnected) {
    moduleLoadingElapsed.textContent =
      ((performance.now() - loadingStartedAt) / 1000).toFixed(1) + "s";
  }

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

    if (statusResult.value.status === "valid") {
      void (async () => {
        await loadClassSchedule();
        await loadAbsenceList();
      })();
    } else if (statusResult.value.status === "busy") {
      scheduleMeta.textContent = "Server ePortal 使用中";
      setScheduleMessage("Server ePortal 正在執行其他操作，稍後按更新載入課表。");
      absenceMeta.textContent = "Server ePortal 使用中";
      setAbsenceMessage("Server ePortal 正在執行其他操作，稍後按更新載入缺曠紀錄。");
    } else {
      resetClassScheduleForLoggedOutState();
      resetAbsenceListForLoggedOutState();
    }
  } else {
    setServerStatus({
      status: "error",
      error: statusResult.reason?.message,
    });
    scheduleMeta.textContent = "無法確認 Server ePortal 狀態";
    setScheduleMessage("目前無法確認登入狀態，稍後按更新重試。", {
      kind: "error",
    });
    absenceMeta.textContent = "無法確認 Server ePortal 狀態";
    setAbsenceMessage("目前無法確認登入狀態，稍後按更新重試。", {
      kind: "error",
    });
  }
})();
