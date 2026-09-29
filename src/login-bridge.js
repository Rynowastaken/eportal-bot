import crypto from "node:crypto";
import { EPORTAL_DASHBOARD, EPORTAL_HOME } from "./eportal.js";
import {
  STUDENT_BUTTON_SELECTOR,
  openLoginBridgeSession,
} from "./portal-session.js";

let active = null;

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function safeEqualHex(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex"),
  );
}

function allowedPageUrl(raw) {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      (url.hostname === "nutc.edu.tw" || url.hostname.endsWith(".nutc.edu.tw"))
    );
  } catch {
    return false;
  }
}

function pageLocation(page) {
  try {
    const url = new URL(page.url());
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "unknown";
  }
}

function bridgeLog(message, page) {
  const location = page ? ` [${pageLocation(page)}]` : "";
  console.log(`[login-bridge] ${message}${location}`);
}

async function closeBrowser(browser) {
  if (!browser) return;

  await Promise.race([
    browser.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

async function navigateForBridge(page, url, label) {
  bridgeLog(`${label}: request started`);

  await page.goto(url, {
    waitUntil: "commit",
    timeout: 15_000,
  });

  bridgeLog(`${label}: response committed`, page);

  await page
    .waitForLoadState("domcontentloaded", { timeout: 8_000 })
    .catch(() => {
      bridgeLog(`${label}: DOMContentLoaded timed out; continuing with current DOM`, page);
    });

  await page.waitForTimeout(250);
}

async function closeActive() {
  if (!active) return;
  const session = active;
  active = null;

  if (session.timer) clearTimeout(session.timer);
  await closeBrowser(session.browser);
}

async function loginComplete(page) {
  const url = new URL(page.url());
  const dashboardUrl = new URL(EPORTAL_DASHBOARD);
  const hasStudentButton =
    (await page.locator(STUDENT_BUTTON_SELECTOR).count()) > 0;

  return (
    url.hostname === dashboardUrl.hostname &&
    url.pathname.startsWith("/nutc_dashboard/") &&
    hasStudentButton
  );
}

async function ensureAllowed(page) {
  if (allowedPageUrl(page.url())) return;

  const error = new Error(
    "The login flow navigated outside an allowed NUTC HTTPS origin.",
  );
  error.code = "EPORTAL_LOGIN_BRIDGE_UNSUPPORTED";
  throw error;
}

async function extractState(page) {
  await ensureAllowed(page);

  const payload = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const clean = (value, max = 240) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);

    const labelFor = (element) => {
      const explicit = element.labels?.[0]?.innerText;
      const aria = element.getAttribute("aria-label");
      const placeholder = element.getAttribute("placeholder");
      const title = element.getAttribute("title");

      if (explicit) return clean(explicit);
      if (aria) return clean(aria);
      if (placeholder) return clean(placeholder);
      if (title) return clean(title);

      let parent = element.parentElement;
      for (let depth = 0; parent && depth < 3; depth += 1) {
        const text = clean(parent.innerText, 120);
        if (text && text !== clean(element.innerText, 120)) return text;
        parent = parent.parentElement;
      }

      return clean(element.getAttribute("name") || element.id || element.tagName);
    };

    const interactive = [
      ...document.querySelectorAll(
        'input:not([type="hidden"]), textarea, select, button, a[role="button"]',
      ),
    ]
      .filter(visible)
      .filter((element) => {
        if (element.tagName.toLowerCase() !== "input") return true;
        const type = String(element.getAttribute("type") || "text").toLowerCase();
        return !["file", "image", "reset", "range", "color"].includes(type);
      });

    document
      .querySelectorAll("[data-nutc-login-bridge-key]")
      .forEach((element) => element.removeAttribute("data-nutc-login-bridge-key"));

    const controls = interactive.slice(0, 40).map((element, index) => {
      const key = `control-${index}`;
      element.setAttribute("data-nutc-login-bridge-key", key);

      const tag = element.tagName.toLowerCase();
      const type =
        tag === "input"
          ? String(element.getAttribute("type") || "text").toLowerCase()
          : tag;

      const base = {
        key,
        tag,
        type,
        label: labelFor(element),
        name: clean(element.getAttribute("name"), 120),
        placeholder: clean(element.getAttribute("placeholder"), 160),
        autocomplete: clean(element.getAttribute("autocomplete"), 80),
        inputMode: clean(element.getAttribute("inputmode"), 40),
        required: Boolean(element.required),
        disabled: Boolean(element.disabled),
      };

      if (tag === "select") {
        return {
          ...base,
          value: element.value,
          options: [...element.options].slice(0, 100).map((option) => ({
            value: option.value,
            label: clean(option.textContent, 160),
            selected: option.selected,
          })),
        };
      }

      if (type === "checkbox" || type === "radio") {
        return {
          ...base,
          checked: Boolean(element.checked),
          value: element.value || "on",
        };
      }

      if (
        tag === "button" ||
        type === "submit" ||
        type === "button" ||
        tag === "a"
      ) {
        return {
          ...base,
          text: clean(element.innerText || element.value || element.textContent, 180),
        };
      }

      return {
        ...base,
        value: type === "password" ? "" : clean(element.value, 500),
      };
    });

    const images = [...document.querySelectorAll("img")]
      .filter(visible)
      .filter((image) => {
        const rect = image.getBoundingClientRect();
        const hint = [
          image.alt,
          image.title,
          image.getAttribute("aria-label"),
          image.currentSrc,
          image.src,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const challengeHint =
          /captcha|verification|verify|security|驗證|驗證碼/.test(hint);
        const compactFormImage =
          Boolean(image.closest("form")) &&
          rect.width >= 60 &&
          rect.height >= 24 &&
          rect.width <= 360 &&
          rect.height <= 140;

        return challengeHint || compactFormImage;
      })
      .slice(0, 2)
      .map((image, index) => {
        const key = `image-${index}`;
        image.setAttribute("data-nutc-login-bridge-image", key);
        const rect = image.getBoundingClientRect();

        return {
          key,
          alt: clean(image.alt || image.getAttribute("aria-label") || "", 160),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });

    const messages = [
      ...document.querySelectorAll(
        "h1, h2, h3, [role='alert'], .alert, .error, .message, .notice, .text-danger",
      ),
    ]
      .filter(visible)
      .map((element) => clean(element.innerText, 300))
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .slice(0, 12);

    return {
      title: clean(document.title, 180),
      controls,
      images,
      messages,
    };
  });

  const url = new URL(page.url());

  return {
    ...payload,
    path: url.pathname,
    hostname: url.hostname,
  };
}

function authorize(token) {
  if (!active || !token) return false;
  return safeEqualHex(hash(token), active.tokenHash);
}

async function buildState() {
  if (!active) {
    return { active: false, complete: false };
  }

  if (active.complete) {
    return {
      active: false,
      complete: true,
      phase: "complete",
      expiresAt: active.expiresAt,
    };
  }

  if (active.error) {
    const error = new Error(active.error.message);
    error.code = active.error.code || "EPORTAL_LOGIN_BRIDGE_START_FAILED";
    throw error;
  }

  if (active.phase !== "ready") {
    return {
      active: true,
      complete: false,
      phase: active.phase,
      expiresAt: active.expiresAt,
    };
  }

  if (await loginComplete(active.page)) {
    active.complete = true;
    active.phase = "complete";
    await closeBrowser(active.browser);
    active.browser = null;
    bridgeLog("login completed; persistent profile saved");

    return {
      active: false,
      complete: true,
      phase: "complete",
      expiresAt: active.expiresAt,
    };
  }

  return {
    active: true,
    complete: false,
    phase: "ready",
    expiresAt: active.expiresAt,
    page: await extractState(active.page),
  };
}

async function initializeLoginBridge(session) {
  const { page } = session;

  try {
    session.phase = "checking-session";
    await navigateForBridge(
      page,
      EPORTAL_DASHBOARD,
      "checking saved ePortal session",
    );

    if (await loginComplete(page)) {
      session.complete = true;
      session.phase = "complete";
      await closeBrowser(session.browser);
      session.browser = null;
      bridgeLog("saved ePortal session is already valid", page);
      return;
    }

    if (!allowedPageUrl(page.url())) {
      session.phase = "opening-login";
      await navigateForBridge(page, EPORTAL_HOME, "opening ePortal login");
    }

    await ensureAllowed(page);

    session.phase = "ready";
    bridgeLog("login form bridge is ready", page);
  } catch (error) {
    session.error = {
      message: error?.message || String(error),
      code: error?.code || "EPORTAL_LOGIN_BRIDGE_START_FAILED",
    };
    session.phase = "error";
    bridgeLog(`startup failed: ${session.error.message}`, page);

    await closeBrowser(session.browser);
    session.browser = null;
  }
}

export async function startLoginBridge({ ttlMinutes = 15 } = {}) {
  bridgeLog("start requested");
  await closeActive();

  bridgeLog("acquiring persistent profile and launching headless Chromium");
  const browser = await openLoginBridgeSession({ timeoutMs: 5_000 });
  const { page } = browser;
  bridgeLog("headless Chromium launched", page);

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + Math.max(5, Number(ttlMinutes) || 15) * 60_000,
  );

  const session = {
    browser,
    page,
    tokenHash: hash(token),
    expiresAt: expiresAt.toISOString(),
    timer: null,
    phase: "starting",
    complete: false,
    error: null,
  };

  active = session;

  active.timer = setTimeout(() => {
    bridgeLog("session expired");
    void closeActive();
  }, expiresAt.getTime() - Date.now());
  active.timer.unref?.();

  void initializeLoginBridge(session);

  return {
    active: true,
    complete: false,
    phase: "starting",
    expiresAt: active.expiresAt,
    launchPath: `/server-login/#token=${encodeURIComponent(token)}`,
  };
}

export async function getLoginBridgeState(token) {
  if (!authorize(token)) {
    const error = new Error("Invalid or expired login bridge token.");
    error.code = "EPORTAL_LOGIN_BRIDGE_UNAUTHORIZED";
    throw error;
  }

  return buildState();
}

export async function applyLoginBridgeAction(token, action = {}) {
  if (!authorize(token)) {
    const error = new Error("Invalid or expired login bridge token.");
    error.code = "EPORTAL_LOGIN_BRIDGE_UNAUTHORIZED";
    throw error;
  }

  if (active.phase !== "ready") {
    return buildState();
  }

  const fields = action?.fields && typeof action.fields === "object"
    ? action.fields
    : {};

  for (const [key, value] of Object.entries(fields)) {
    if (!/^control-\d+$/.test(key)) continue;

    const locator = active.page.locator(
      `[data-nutc-login-bridge-key="${key}"]`,
    );

    if ((await locator.count()) !== 1) continue;

    const tag = await locator.evaluate((element) => element.tagName.toLowerCase());
    const type = await locator.evaluate((element) =>
      String(element.getAttribute("type") || "").toLowerCase(),
    );

    if (tag === "select") {
      await locator.selectOption(String(value ?? ""));
      continue;
    }

    if (type === "checkbox" || type === "radio") {
      await locator.setChecked(Boolean(value));
      continue;
    }

    if (tag === "input" || tag === "textarea") {
      await locator.fill(String(value ?? "").slice(0, 4096));
    }
  }

  if (typeof action.activate === "string" && /^control-\d+$/.test(action.activate)) {
    const locator = active.page.locator(
      `[data-nutc-login-bridge-key="${action.activate}"]`,
    );

    if ((await locator.count()) === 1) {
      await locator.click({ timeout: 8_000 });

      await active.page
        .waitForLoadState("domcontentloaded", { timeout: 5_000 })
        .catch(() => {});
    }
  } else if (action.pressEnter === true) {
    await active.page.keyboard.press("Enter");
  }

  await active.page.waitForTimeout(450);
  await ensureAllowed(active.page);

  return buildState();
}

export async function getLoginBridgeImage(token, key) {
  if (!authorize(token)) {
    const error = new Error("Invalid or expired login bridge token.");
    error.code = "EPORTAL_LOGIN_BRIDGE_UNAUTHORIZED";
    throw error;
  }

  if (!/^image-\d+$/.test(String(key || ""))) {
    const error = new Error("Unknown login bridge image.");
    error.code = "EPORTAL_LOGIN_BRIDGE_NOT_FOUND";
    throw error;
  }

  const locator = active.page.locator(
    `[data-nutc-login-bridge-image="${key}"]`,
  );

  if ((await locator.count()) !== 1) {
    const error = new Error("Login bridge image is no longer available.");
    error.code = "EPORTAL_LOGIN_BRIDGE_NOT_FOUND";
    throw error;
  }

  return locator.screenshot({
    type: "png",
    animations: "disabled",
  });
}

export async function stopLoginBridge(token) {
  if (!authorize(token)) {
    const error = new Error("Invalid or expired login bridge token.");
    error.code = "EPORTAL_LOGIN_BRIDGE_UNAUTHORIZED";
    throw error;
  }

  await closeActive();
  return { ok: true };
}

export function getLoginBridgeSummary() {
  return {
    active: Boolean(active && !active.complete),
    complete: Boolean(active?.complete),
    phase: active?.phase || "idle",
    expiresAt: active?.expiresAt || null,
  };
}
