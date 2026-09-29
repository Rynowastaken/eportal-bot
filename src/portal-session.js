import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  EPORTAL_DASHBOARD,
  EPORTAL_HOME,
  moduleById,
  moduleUrl,
} from "./eportal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

export const EPORTAL_PROFILE_DIR = path.join(ROOT, ".eportal-profile");
export const STUDENT_BUTTON_SELECTOR = 'button[onclick*="NUTC_6401"]';

let profileQueue = Promise.resolve();

async function withProfileLock(task) {
  const previous = profileQueue;
  let release;

  profileQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await task();
  } finally {
    release();
  }
}

async function profileExists() {
  try {
    const stat = await fs.stat(EPORTAL_PROFILE_DIR);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function openServerPortalSession({ headless = true } = {}) {
  await fs.mkdir(EPORTAL_PROFILE_DIR, { recursive: true, mode: 0o700 });

  return chromium.launchPersistentContext(EPORTAL_PROFILE_DIR, {
    headless,
    viewport: headless ? { width: 1280, height: 900 } : null,
  });
}

export async function loginServerPortal() {
  const context = await openServerPortalSession({ headless: false });
  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto(EPORTAL_HOME, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    console.log("[+] Server Chromium opened with .eportal-profile/");
    console.log("[+] Log into ePortal normally.");
    console.log("[+] Waiting for the Student Management button...");

    await page.locator(STUDENT_BUTTON_SELECTOR).waitFor({
      state: "attached",
      timeout: 0,
    });

    console.log("[+] ePortal login confirmed.");
    console.log("[+] Persistent profile saved automatically in .eportal-profile/");
  } finally {
    await context.close();
  }
}

export async function checkServerPortalStatus({ timeout = 30_000 } = {}) {
  if (!(await profileExists())) {
    return {
      status: "not-configured",
      configured: false,
      valid: false,
      needsLogin: true,
      checkedAt: new Date().toISOString(),
    };
  }

  let context;

  try {
    context = await openServerPortalSession({ headless: true });
    const page = context.pages()[0] || (await context.newPage());

    await page.goto(EPORTAL_DASHBOARD, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    const current = new URL(page.url());
    const hasStudentButton =
      (await page.locator(STUDENT_BUTTON_SELECTOR).count()) > 0;

    const valid =
      current.protocol === "https:" &&
      current.hostname === "eportal.nutc.edu.tw" &&
      current.pathname.startsWith("/nutc_dashboard/") &&
      hasStudentButton;

    return {
      status: valid ? "valid" : "needs-login",
      configured: true,
      valid,
      needsLogin: !valid,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "error",
      configured: true,
      valid: false,
      needsLogin: false,
      checkedAt: new Date().toISOString(),
      error: error?.message || String(error),
    };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

export async function createModuleHandoff(moduleId, { timeout = 30_000 } = {}) {
  moduleById(moduleId);

  if (!(await profileExists())) {
    const error = new Error(
      "Server ePortal profile is not configured. Run: npm run login",
    );
    error.code = "EPORTAL_LOGIN_REQUIRED";
    throw error;
  }

  return withProfileLock(async () => {
    let context;

    try {
      context = await openServerPortalSession({ headless: true });
      const page = context.pages()[0] || (await context.newPage());

      await page.goto(EPORTAL_DASHBOARD, {
        waitUntil: "domcontentloaded",
        timeout,
      });

      const loggedIn =
        (await page.locator(STUDENT_BUTTON_SELECTOR).count()) > 0;

      if (!loggedIn) {
        const error = new Error(
          "Server ePortal session expired. Run: npm run login",
        );
        error.code = "EPORTAL_LOGIN_REQUIRED";
        throw error;
      }

      const eportalOrigin = new URL(EPORTAL_HOME).origin;
      let currentUrl = moduleUrl(moduleId);
      let referer = EPORTAL_DASHBOARD;

      for (let hop = 0; hop < 10; hop += 1) {
        const response = await context.request.get(currentUrl, {
          headers: { Referer: referer },
          maxRedirects: 0,
          timeout,
          failOnStatusCode: false,
        });

        const status = response.status();
        const location = response.headers().location;

        if (![301, 302, 303, 307, 308].includes(status) || !location) {
          const error = new Error(
            "ePortal did not return a transferable SSO redirect for this module.",
          );
          error.code = "EPORTAL_HANDOFF_UNAVAILABLE";
          throw error;
        }

        const nextUrl = new URL(location, currentUrl);

        if (nextUrl.protocol !== "https:") {
          const error = new Error("Refusing non-HTTPS ePortal handoff.");
          error.code = "EPORTAL_HANDOFF_UNAVAILABLE";
          throw error;
        }

        if (nextUrl.origin !== eportalOrigin) {
          return nextUrl.toString();
        }

        referer = currentUrl;
        currentUrl = nextUrl.toString();
      }

      const error = new Error("Too many internal ePortal redirects.");
      error.code = "EPORTAL_HANDOFF_UNAVAILABLE";
      throw error;
    } finally {
      if (context) await context.close().catch(() => {});
    }
  });
}

export async function openAisWithServerSession({ headless = true } = {}) {
  const context = await openServerPortalSession({ headless });
  const page = context.pages()[0] || (await context.newPage());

  try {
    await page.goto(EPORTAL_DASHBOARD, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const loggedIn =
      (await page.locator(STUDENT_BUTTON_SELECTOR).count()) > 0;

    if (!loggedIn) {
      const error = new Error(
        "Server ePortal session expired. Run: npm run login",
      );
      error.code = "EPORTAL_LOGIN_REQUIRED";
      throw error;
    }

    await page.goto(moduleUrl("ais"), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await page.waitForURL(
      (url) => url.protocol === "https:" && url.hostname === "ais.nutc.edu.tw",
      { timeout: 20_000 },
    );

    return { context, page };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

export async function requireServerPortalSession() {
  const status = await checkServerPortalStatus();

  if (!status.valid) {
    const error = new Error(
      status.status === "not-configured"
        ? "Server ePortal profile is not configured. Run: npm run login"
        : status.status === "needs-login"
          ? "Server ePortal session expired. Run: npm run login"
          : "Server ePortal session could not be verified.",
    );

    error.portalStatus = status;
    throw error;
  }

  return status;
}
