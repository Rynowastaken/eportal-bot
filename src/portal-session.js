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
export const EPORTAL_PROFILE_LOCK_FILE = path.join(ROOT, "data", "eportal-profile.lock");
export const STUDENT_BUTTON_SELECTOR = 'button[onclick*="NUTC_6401"]';

let profileQueue = Promise.resolve();
let keepaliveTimer = null;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireProfileFileLock({ timeoutMs = 120_000 } = {}) {
  await fs.mkdir(path.dirname(EPORTAL_PROFILE_LOCK_FILE), {
    recursive: true,
    mode: 0o700,
  });

  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      const handle = await fs.open(EPORTAL_PROFILE_LOCK_FILE, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        }),
      );
      await handle.close();

      let released = false;
      return async () => {
        if (released) return;
        released = true;

        try {
          const raw = await fs.readFile(EPORTAL_PROFILE_LOCK_FILE, "utf8");
          const state = JSON.parse(raw);
          if (state?.pid !== process.pid) return;
        } catch (error) {
          if (error?.code === "ENOENT") return;
        }

        await fs.unlink(EPORTAL_PROFILE_LOCK_FILE).catch(() => {});
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      let stale = false;

      try {
        const raw = await fs.readFile(EPORTAL_PROFILE_LOCK_FILE, "utf8");
        const state = JSON.parse(raw);
        stale = !isProcessAlive(Number(state?.pid));
      } catch {
        stale = true;
      }

      if (stale) {
        await fs.unlink(EPORTAL_PROFILE_LOCK_FILE).catch(() => {});
        continue;
      }

      if (Date.now() >= deadline) {
        const busy = new Error(
          "The persistent ePortal browser profile is currently in use.",
        );
        busy.code = "EPORTAL_PROFILE_BUSY";
        throw busy;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function acquireProfileAccess(options = {}) {
  const previous = profileQueue;
  let releaseQueue;

  profileQueue = new Promise((resolve) => {
    releaseQueue = resolve;
  });

  await previous;

  let releaseFile;
  try {
    releaseFile = await acquireProfileFileLock(options);
  } catch (error) {
    releaseQueue();
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;

    try {
      await releaseFile();
    } finally {
      releaseQueue();
    }
  };
}
let keepaliveState = {
  enabled: false,
  intervalMinutes: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastStatus: "idle",
  lastError: null,
};

async function withProfileLock(task, options = {}) {
  const release = await acquireProfileAccess(options);

  try {
    return await task();
  } finally {
    await release();
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

export async function openServerPortalSession({
  headless = true,
  viewport = headless ? { width: 1280, height: 900 } : null,
  launchTimeout = 30_000,
} = {}) {
  await fs.mkdir(EPORTAL_PROFILE_DIR, { recursive: true, mode: 0o700 });

  return chromium.launchPersistentContext(EPORTAL_PROFILE_DIR, {
    headless,
    viewport,
    timeout: launchTimeout,
  });
}

export async function loginServerPortal({
  loginTimeout = 0,
  viewport = null,
} = {}) {
  return withProfileLock(
    async () => {
      const context = await openServerPortalSession({
        headless: false,
        viewport,
      });
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
          timeout: loginTimeout,
        });

        console.log("[+] ePortal login confirmed.");
        console.log("[+] Persistent profile saved automatically in .eportal-profile/");
      } finally {
        await context.close();
      }
    },
    { timeoutMs: 10_000 },
  );
}

async function inspectServerPortalSession({ timeout = 30_000 } = {}) {
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

    // Give ePortal a short window to run any normal page-load refresh logic.
    await page.waitForTimeout(1500);

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

export async function checkServerPortalStatus(options = {}) {
  try {
    return await withProfileLock(
      () => inspectServerPortalSession(options),
      { timeoutMs: 2_000 },
    );
  } catch (error) {
    if (error?.code === "EPORTAL_PROFILE_BUSY") {
      return {
        status: "busy",
        configured: await profileExists(),
        valid: false,
        needsLogin: false,
        checkedAt: new Date().toISOString(),
      };
    }
    throw error;
  }
}

export function getPortalKeepaliveState() {
  return structuredClone(keepaliveState);
}

export function startPortalKeepalive({ intervalMinutes = 10 } = {}) {
  const parsed = Number(intervalMinutes);
  const minutes = Number.isFinite(parsed) ? Math.max(0, parsed) : 10;

  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }

  keepaliveState = {
    enabled: minutes > 0,
    intervalMinutes: minutes,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastStatus: minutes > 0 ? "scheduled" : "disabled",
    lastError: null,
  };

  if (minutes <= 0) {
    return getPortalKeepaliveState();
  }

  const run = async () => {
    keepaliveState.lastAttemptAt = new Date().toISOString();

    try {
      const status = await checkServerPortalStatus({ timeout: 30_000 });
      keepaliveState.lastStatus = status.status;
      keepaliveState.lastError = status.error || null;

      if (status.valid) {
        keepaliveState.lastSuccessAt = status.checkedAt;
      }
    } catch (error) {
      keepaliveState.lastStatus = "error";
      keepaliveState.lastError = error?.message || String(error);
    }
  };

  // Refresh shortly after startup, then on the configured cadence.
  const initialTimer = setTimeout(() => {
    void run();
  }, 15_000);
  initialTimer.unref?.();

  keepaliveTimer = setInterval(() => {
    void run();
  }, minutes * 60_000);
  keepaliveTimer.unref?.();

  return getPortalKeepaliveState();
}

export async function createModuleHandoff(moduleId, { timeout = 30_000 } = {}) {
  const module = moduleById(moduleId);

  if (!(await profileExists())) {
    const error = new Error(
      "Server ePortal profile is not configured. Use the Server ePortal login bridge first.",
    );
    error.code = "EPORTAL_LOGIN_REQUIRED";
    throw error;
  }

  return withProfileLock(async () => {
    let context;

    try {
      context = await openServerPortalSession({
        headless: true,
        launchTimeout: 15_000,
      });

      const dashboard =
        context.pages()[0] || (await context.newPage());

      await dashboard.goto(EPORTAL_DASHBOARD, {
        waitUntil: "domcontentloaded",
        timeout,
      });

      const loggedIn =
        (await dashboard.locator(STUDENT_BUTTON_SELECTOR).count()) > 0;

      if (!loggedIn) {
        const error = new Error(
          "Server ePortal session expired. Use the Server ePortal login bridge.",
        );
        error.code = "EPORTAL_LOGIN_REQUIRED";
        throw error;
      }

      const button = dashboard.locator(
        `button[data-item-uuid="${module.uuid}"]`,
      );

      if ((await button.count()) !== 1) {
        const error = new Error(
          "The selected ePortal module button was not found on the authenticated dashboard.",
        );
        error.code = "EPORTAL_HANDOFF_UNAVAILABLE";
        throw error;
      }

      const eportalOrigin = new URL(EPORTAL_HOME).origin;
      let settled = false;
      let timeoutId;

      const handoff = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;

          const error = new Error(
            "Timed out waiting for ePortal to generate an external SSO handoff.",
          );
          error.code = "EPORTAL_HANDOFF_UNAVAILABLE";
          reject(error);
        }, timeout);
      });

      let resolveHandoff;
      let rejectHandoff;

      const handoffResult = new Promise((resolve, reject) => {
        resolveHandoff = resolve;
        rejectHandoff = reject;
      });

      const finish = (fn, value) => {
        if (settled) return false;
        settled = true;
        clearTimeout(timeoutId);
        fn(value);
        return true;
      };

      await context.route("**/*", async (route) => {
        const request = route.request();

        if (!request.isNavigationRequest()) {
          await route.continue();
          return;
        }

        let target;
        try {
          target = new URL(request.url());
        } catch {
          await route.continue();
          return;
        }

        if (
          target.protocol !== "https:" ||
          target.origin === eportalOrigin
        ) {
          await route.continue();
          return;
        }

        // The external SSO URL is bearer material. Capture it only in memory,
        // abort the server-side navigation before the target system consumes it,
        // and never log the URL itself.
        await route.abort("aborted");

        if (request.method() !== "GET") {
          const error = new Error(
            "ePortal generated an external SSO POST handoff, which cannot be transferred with an HTTP redirect.",
          );
          error.code = "EPORTAL_HANDOFF_POST_REQUIRED";
          finish(rejectHandoff, error);
          return;
        }

        finish(resolveHandoff, target.toString());
      });

      const pageErrors = [];
      const notePage = (page) => {
        page.on("pageerror", (error) => {
          if (pageErrors.length < 4) {
            pageErrors.push(error?.message || String(error));
          }
        });
      };

      for (const page of context.pages()) notePage(page);
      context.on("page", notePage);

      try {
        await button.click({ timeout: 10_000 });
      } catch (error) {
        if (!settled) {
          const clickError = new Error(
            "Could not trigger the selected ePortal module from the authenticated dashboard.",
          );
          clickError.code = "EPORTAL_HANDOFF_UNAVAILABLE";
          finish(rejectHandoff, clickError);
        }
      }

      // Race the actual capture against the timeout promise. The timeout promise
      // intentionally carries no URL/token material.
      try {
        return await Promise.race([handoffResult, handoff]);
      } catch (error) {
        if (
          error?.code === "EPORTAL_HANDOFF_UNAVAILABLE" &&
          pageErrors.length
        ) {
          error.diagnostics = {
            pageErrorCount: pageErrors.length,
          };
        }
        throw error;
      }
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }, { timeoutMs: 5_000 });
}

export async function openLoginBridgeSession({ timeoutMs = 5_000 } = {}) {
  const release = await acquireProfileAccess({ timeoutMs });
  let context;

  try {
    context = await openServerPortalSession({
      headless: true,
      viewport: { width: 430, height: 860 },
      launchTimeout: 15_000,
    });

    const page = context.pages()[0] || (await context.newPage());
    let closed = false;

    return {
      context,
      page,
      async close() {
        if (closed) return;
        closed = true;

        try {
          await context.close();
        } finally {
          await release();
        }
      },
    };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    await release();
    throw error;
  }
}

export async function openAisWithServerSession({ headless = true } = {}) {
  const release = await acquireProfileAccess({ timeoutMs: 30_000 });
  let context;

  try {
    context = await openServerPortalSession({ headless });
    const page = context.pages()[0] || (await context.newPage());

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

    const managedContext = new Proxy(context, {
      get(target, property) {
        if (property === "close") {
          return async (...args) => {
            try {
              return await target.close(...args);
            } finally {
              await release();
            }
          };
        }

        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    return { context: managedContext, page };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    await release();
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
