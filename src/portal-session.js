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

function safeUrlLabel(raw) {
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function normalizeExternalHandoffUrl(url, eportalOrigin) {
  const target = url instanceof URL ? new URL(url) : new URL(url);

  if (target.origin === eportalOrigin) return null;

  if (target.protocol === "http:") {
    const isNutcHost =
      target.hostname === "nutc.edu.tw" ||
      target.hostname.endsWith(".nutc.edu.tw");

    if (!isNutcHost) return null;
    target.protocol = "https:";
  }

  if (target.protocol !== "https:") return null;
  return target;
}

function getRequestContentType(request) {
  const headers = request.headers();
  return String(headers["content-type"] || "").split(";")[0].trim().toLowerCase();
}

function transferableHandoffFromRequest(request, handoffUrl) {
  const method = request.method().toUpperCase();

  if (method === "GET") {
    return {
      type: "get",
      url: handoffUrl.toString(),
    };
  }

  if (method !== "POST") return null;

  const contentType = getRequestContentType(request);
  if (contentType !== "application/x-www-form-urlencoded") {
    const error = new Error(
      `ePortal generated an external POST handoff using unsupported content type ${contentType || "unknown"}.`,
    );
    error.code = "EPORTAL_HANDOFF_POST_UNSUPPORTED";
    throw error;
  }

  const params = new URLSearchParams(request.postData() || "");

  return {
    type: "post",
    url: handoffUrl.toString(),
    fields: [...params.entries()],
  };
}


function looksSelfContainedGetHandoff(rawUrl) {
  const target = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);

  if (target.search || target.hash) return true;

  return target.pathname
    .split("/")
    .filter(Boolean)
    .some(
      (segment) =>
        segment.length >= 24 &&
        /[A-Za-z]/.test(segment) &&
        /\d/.test(segment),
    );
}

async function discoverBareExternalGet(
  context,
  module,
  rawUrl,
  eportalOrigin,
) {
  let current = new URL(rawUrl);
  let referer = moduleUrl(module.id);
  const visited = new Set();

  for (let step = 0; step < 8; step += 1) {
    if (visited.has(current.toString())) break;
    visited.add(current.toString());

    const response = await context.request.get(current.toString(), {
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: 12_000,
      headers: {
        Referer: referer,
      },
    });

    const status = response.status();
    console.log(
      `[handoff] follow bare ${module.id}: ${status} ${safeUrlLabel(current)}`,
    );

    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers().location;
      if (!location) break;

      let next;
      try {
        next = new URL(location, current);
      } catch {
        break;
      }

      if (next.origin !== eportalOrigin) {
        const external = normalizeExternalHandoffUrl(next, eportalOrigin);
        if (!external) break;

        if (looksSelfContainedGetHandoff(external)) {
          console.log(
            `[handoff] discovered transferable redirect for ${module.id}: GET ${external.hostname}${external.pathname}`,
          );
          return {
            type: "get",
            url: external.toString(),
          };
        }

        referer = current.toString();
        current = external;
        continue;
      }

      referer = current.toString();
      current = next;
      continue;
    }

    const headers = response.headers();
    const contentType = String(headers["content-type"] || "").toLowerCase();
    const contentLength = Number(headers["content-length"] || 0);

    if (
      contentType.includes("text/html") &&
      (!Number.isFinite(contentLength) ||
        contentLength <= 512 * 1024)
    ) {
      try {
        const html = await response.text();
        const matches =
          html.match(/https?:\/\/[^"'<>\s]+/gi) || [];

        for (const rawCandidate of matches.slice(0, 80)) {
          let candidate;
          try {
            candidate = new URL(rawCandidate.replaceAll("&amp;", "&"));
          } catch {
            continue;
          }

          const external = normalizeExternalHandoffUrl(
            candidate,
            eportalOrigin,
          );

          if (
            external &&
            looksSelfContainedGetHandoff(external)
          ) {
            console.log(
              `[handoff] discovered transferable URL in target HTML for ${module.id}: GET ${external.hostname}${external.pathname}`,
            );
            return {
              type: "get",
              url: external.toString(),
            };
          }
        }
      } catch {
        // Body inspection is best effort; redirect-chain analysis is primary.
      }
    }

    const cookieScopes = [
      ...new Set(
        (await context.cookies())
          .map((cookie) => cookie.domain)
          .filter(
            (domain) =>
              domain === "nutc.edu.tw" ||
              domain === ".nutc.edu.tw" ||
              domain.endsWith(".nutc.edu.tw"),
          ),
      ),
    ].sort();

    const error = new Error(
      `ePortal reached ${safeUrlLabel(current)} without exposing a transferable SSO URL or form. The captured bare GET is bound to the server-side browser/session flow, so redirecting that URL to the client does not carry authentication.`,
    );
    error.code = "EPORTAL_HANDOFF_SESSION_BOUND";
    error.diagnostics = {
      final: safeUrlLabel(current),
      status,
      cookieScopes,
    };

    console.log(
      `[handoff] bare GET for ${module.id} is not transferable; final=${error.diagnostics.final}; status=${status}; cookie-scopes=${cookieScopes.join(",") || "none"}`,
    );

    throw error;
  }

  const error = new Error(
    "ePortal produced a bare external GET handoff, but no transferable SSO material was found in its redirect chain.",
  );
  error.code = "EPORTAL_HANDOFF_SESSION_BOUND";
  throw error;
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

async function captureHttpRedirectHandoff(context, module, eportalOrigin) {
  let current = new URL(moduleUrl(module.id));
  const visited = new Set();

  for (let step = 0; step < 10; step += 1) {
    if (visited.has(current.toString())) return null;
    visited.add(current.toString());

    const response = await context.request.get(current.toString(), {
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: 12_000,
      headers: {
        Referer: EPORTAL_DASHBOARD,
      },
    });

    const status = response.status();
    const headers = response.headers();
    const location = headers.location;

    console.log(
      `[handoff] probe ${module.id}: ${status} ${safeUrlLabel(current)}`,
    );

    if (![301, 302, 303, 307, 308].includes(status) || !location) {
      return null;
    }

    let next;
    try {
      next = new URL(location, current);
    } catch {
      return null;
    }

    const external = normalizeExternalHandoffUrl(next, eportalOrigin);
    if (external) {
      if (!looksSelfContainedGetHandoff(external)) {
        console.log(
          `[handoff] probe found bare external endpoint for ${module.id}: ${external.hostname}${external.pathname}; deferring to browser-stage discovery`,
        );
        return null;
      }

      console.log(
        `[handoff] probe captured external redirect for ${module.id}: GET ${external.hostname}${external.pathname}`,
      );

      return {
        type: "get",
        url: external.toString(),
      };
    }

    if (next.origin !== eportalOrigin) return null;
    current = next;
  }

  return null;
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
          "The selected ePortal module is not present on the authenticated dashboard.",
        );
        error.code = "EPORTAL_HANDOFF_UNAVAILABLE";
        throw error;
      }

      const eportalOrigin = new URL(EPORTAL_HOME).origin;

      if (module.path.startsWith("/ext_module/")) {
        const probed = await captureHttpRedirectHandoff(
          context,
          module,
          eportalOrigin,
        );

        if (probed) return probed;
      }

      const observed = {
        pages: new Set(),
        navigations: new Set(),
        responses: new Set(),
      };

      const observePage = (page) => {
        observed.pages.add(safeUrlLabel(page.url()));

        page.on("framenavigated", (frame) => {
          if (frame !== page.mainFrame()) return;
          observed.navigations.add(safeUrlLabel(frame.url()));
        });

        page.on("close", () => {
          observed.pages.add("closed");
        });
      };

      for (const existingPage of context.pages()) observePage(existingPage);
      context.on("page", (page) => {
        observePage(page);
        console.log(
          `[handoff] popup opened for ${module.id}: ${safeUrlLabel(page.url())}`,
        );
      });

      context.on("response", (response) => {
        const request = response.request();
        if (!request.isNavigationRequest()) return;

        const label = `${response.status()} ${safeUrlLabel(response.url())}`;
        observed.responses.add(label);

        const responseUrl = new URL(response.url());
        if (responseUrl.origin !== eportalOrigin) return;

        console.log(`[handoff] internal navigation for ${module.id}: ${label}`);

        if (![301, 302, 303, 307, 308].includes(response.status())) return;

        const location = response.headers().location;
        if (!location) return;

        try {
          const redirected = new URL(location, response.url());
          const handoffUrl = normalizeExternalHandoffUrl(
            redirected,
            eportalOrigin,
          );

          if (!handoffUrl) return;

          const preserveMethod =
            response.status() === 307 || response.status() === 308;

          let result;
          if (preserveMethod) {
            result = transferableHandoffFromRequest(
              response.request(),
              handoffUrl,
            );
          } else {
            result = {
              type: "get",
              url: handoffUrl.toString(),
            };
          }

          if (!result) return;

          if (
            result.type === "get" &&
            !looksSelfContainedGetHandoff(result.url)
          ) {
            console.log(
              `[handoff] saw bare external redirect for ${module.id}: ${handoffUrl.hostname}${handoffUrl.pathname}; waiting for request-stage discovery`,
            );
            return;
          }

          console.log(
            `[handoff] captured external redirect for ${module.id}: ${result.type.toUpperCase()} ${handoffUrl.hostname}${handoffUrl.pathname}`,
          );
          finish(resolveHandoff, result);
        } catch {
          // Ignore malformed Location values.
        }
      });

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
          error.diagnostics = {
            pages: [...observed.pages].slice(-8),
            navigations: [...observed.navigations].slice(-8),
            responses: [...observed.responses].slice(-8),
          };

          console.log(
            `[handoff] timeout for ${module.id}; pages=${error.diagnostics.pages.join(",") || "none"}; nav=${error.diagnostics.navigations.join(",") || "none"}; responses=${error.diagnostics.responses.join(",") || "none"}`,
          );

          reject(error);
        }, timeout);
      });

      // Event callbacks may settle either promise before createModuleHandoff()
      // reaches the final Promise.race(). Attach handlers immediately so newer
      // Node versions do not treat that short window as an unhandled rejection.
      void handoff.catch(() => {});

      let resolveHandoff;
      let rejectHandoff;

      const handoffResult = new Promise((resolve, reject) => {
        resolveHandoff = resolve;
        rejectHandoff = reject;
      });
      void handoffResult.catch(() => {});

      const finish = (fn, value) => {
        if (settled) return false;
        settled = true;
        clearTimeout(timeoutId);
        fn(value);
        return true;
      };

      await context.exposeBinding(
        "__nutcCaptureHandoff",
        async (_source, payload) => {
          if (settled || !payload || typeof payload !== "object") return false;

          try {
            const handoffUrl = normalizeExternalHandoffUrl(
              new URL(String(payload.url || "")),
              eportalOrigin,
            );

            if (!handoffUrl) return false;

            const method = String(payload.method || "GET").toUpperCase();
            let result;

            if (method === "GET") {
              result = {
                type: "get",
                url: handoffUrl.toString(),
              };
            } else if (method === "POST") {
              const fields = Array.isArray(payload.fields)
                ? payload.fields
                    .filter(
                      (entry) =>
                        Array.isArray(entry) &&
                        entry.length === 2 &&
                        typeof entry[0] === "string" &&
                        typeof entry[1] === "string",
                    )
                    .slice(0, 200)
                : [];

              result = {
                type: "post",
                url: handoffUrl.toString(),
                fields,
                enctype:
                  payload.enctype === "multipart/form-data"
                    ? "multipart/form-data"
                    : "application/x-www-form-urlencoded",
              };
            } else {
              return false;
            }

            if (
              result.type === "get" &&
              !looksSelfContainedGetHandoff(result.url)
            ) {
              result = await discoverBareExternalGet(
                context,
                module,
                result.url,
                eportalOrigin,
              );
            }

            console.log(
              `[handoff] captured page-side handoff for ${module.id}: ${result.type.toUpperCase()} ${handoffUrl.hostname}${handoffUrl.pathname}`,
            );

            finish(resolveHandoff, result);
            return true;
          } catch (error) {
            if (error?.code?.startsWith("EPORTAL_HANDOFF_")) {
              finish(rejectHandoff, error);
            }
            return false;
          }
        },
      );

      await context.addInitScript(() => {
        const binding = "__nutcCaptureHandoff";

        const externalTarget = (raw) => {
          try {
            const target = new URL(String(raw || ""), location.href);

            if (!/^https?:$/.test(target.protocol)) return null;
            if (target.origin === location.origin) return null;

            return target;
          } catch {
            return null;
          }
        };

        const notify = (payload) => {
          try {
            const fn = window[binding];
            if (typeof fn === "function") void fn(payload);
          } catch {
            // Best effort. Network interception remains as a fallback.
          }
        };

        const formPayload = (form, submitter = null) => {
          const target = externalTarget(form.action || location.href);
          if (!target) return null;

          const method = String(form.method || "GET").toUpperCase();
          const enctype = String(
            form.enctype || "application/x-www-form-urlencoded",
          ).toLowerCase();

          const fields = [];
          let hasFiles = false;

          try {
            const data = new FormData(form);

            if (
              submitter &&
              submitter.name &&
              !submitter.disabled
            ) {
              data.append(submitter.name, submitter.value || "");
            }

            for (const [name, value] of data.entries()) {
              if (typeof value !== "string") {
                hasFiles = true;
                continue;
              }

              fields.push([String(name), value]);
            }
          } catch {
            return null;
          }

          if (hasFiles) return null;

          if (method === "GET") {
            for (const [name, value] of fields) {
              target.searchParams.append(name, value);
            }

            return {
              method: "GET",
              url: target.href,
              fields: [],
              enctype,
            };
          }

          if (method !== "POST") return null;

          return {
            method: "POST",
            url: target.href,
            fields,
            enctype,
          };
        };

        const nativeOpen = window.open;

        window.open = function patchedOpen(url, target, features) {
          const external = externalTarget(url);

          if (external) {
            notify({
              method: "GET",
              url: external.href,
            });

            return null;
          }

          return nativeOpen.call(window, url, target, features);
        };

        const nativeSubmit = HTMLFormElement.prototype.submit;

        HTMLFormElement.prototype.submit = function patchedSubmit() {
          const payload = formPayload(this);

          if (payload) {
            notify(payload);
            return;
          }

          return nativeSubmit.call(this);
        };

        document.addEventListener(
          "submit",
          (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement)) return;

            const payload = formPayload(form, event.submitter || null);
            if (!payload) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            notify(payload);
          },
          true,
        );
      });

      await context.route("**/*", async (route) => {
        const request = route.request();

        let target;
        try {
          target = new URL(request.url());
        } catch {
          await route.continue();
          return;
        }

        if (!request.isNavigationRequest()) {
          if (
            target.protocol === "https:" &&
            target.origin !== eportalOrigin
          ) {
            const label =
              `${request.method()} ${request.resourceType()} ${target.hostname}${target.pathname}`;

            if (!observed.responses.has(`external ${label}`)) {
              observed.responses.add(`external ${label}`);
              console.log(
                `[handoff] external subrequest for ${module.id}: ${label}`,
              );
            }
          }

          await route.continue();
          return;
        }

        if (target.origin === eportalOrigin) {
          await route.continue();
          return;
        }

        const handoffUrl = normalizeExternalHandoffUrl(
          target,
          eportalOrigin,
        );

        if (!handoffUrl) {
          if (target.protocol === "http:") {
            await route.abort("aborted");

            const error = new Error(
              "Refusing a non-HTTPS external ePortal handoff outside NUTC domains.",
            );
            error.code = "EPORTAL_HANDOFF_UNAVAILABLE";
            finish(rejectHandoff, error);
            return;
          }

          await route.continue();
          return;
        }

        // The external SSO material is bearer-equivalent. Capture it only in
        // memory, abort the server-side navigation before the target consumes it,
        // and never log the URL query or POST body.
        await route.abort("aborted");

        let result;
        try {
          result = transferableHandoffFromRequest(request, handoffUrl);
        } catch (error) {
          finish(rejectHandoff, error);
          return;
        }

        if (!result) {
          const error = new Error(
            `ePortal generated an unsupported external ${request.method()} handoff.`,
          );
          error.code = "EPORTAL_HANDOFF_UNAVAILABLE";
          finish(rejectHandoff, error);
          return;
        }

        if (
          result.type === "get" &&
          !looksSelfContainedGetHandoff(result.url)
        ) {
          try {
            result = await discoverBareExternalGet(
              context,
              module,
              result.url,
              eportalOrigin,
            );
          } catch (error) {
            finish(rejectHandoff, error);
            return;
          }
        }

        console.log(
          `[handoff] captured external navigation for ${module.id}: ${result.type.toUpperCase()} ${handoffUrl.hostname}${handoffUrl.pathname}`,
        );
        finish(resolveHandoff, result);
      });

      console.log(`[handoff] triggering module ${module.id}`);

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

      // ePortal's openModule() ultimately performs window.open(moduleUrl).
      // Create that popup page ourselves so request interception is installed
      // before its very first navigation. This prevents the server Chromium
      // from consuming a one-time external SSO hop (for example WebMail's
      // /cgi-bin/login.sso) before we can hand it to the client browser.
      const launcher = await context.newPage();
      notePage(launcher);

      let cdp = null;

      if (module.path.startsWith("/ext_module/")) {
        cdp = await context.newCDPSession(launcher);

        cdp.on("Fetch.requestPaused", (event) => {
          void (async () => {
            const request = event.request || {};
            let target;

            try {
              target = new URL(String(request.url || ""));
            } catch {
              await cdp
                .send("Fetch.continueRequest", {
                  requestId: event.requestId,
                })
                .catch(() => {});
              return;
            }

            if (target.origin === eportalOrigin) {
              await cdp
                .send("Fetch.continueRequest", {
                  requestId: event.requestId,
                })
                .catch(() => {});
              return;
            }

            const handoffUrl = normalizeExternalHandoffUrl(
              target,
              eportalOrigin,
            );

            if (!handoffUrl) {
              // Chromium can pause synthetic/non-network documents such as
              // about:blank when a new page is created. Those are not SSO hops.
              // Let them proceed instead of treating them as hostile handoffs.
              if (target.protocol !== "http:" && target.protocol !== "https:") {
                await cdp
                  .send("Fetch.continueRequest", {
                    requestId: event.requestId,
                  })
                  .catch(() => {});
                return;
              }

              await cdp
                .send("Fetch.failRequest", {
                  requestId: event.requestId,
                  errorReason: "Aborted",
                })
                .catch(() => {});

              if (!settled) {
                const error = new Error(
                  `Refusing external ${target.protocol} handoff outside the allowed NUTC HTTPS flow (${target.hostname || "unknown-host"}).`,
                );
                error.code = "EPORTAL_HANDOFF_UNAVAILABLE";
                finish(rejectHandoff, error);
              }
              return;
            }

            const method = String(request.method || "GET").toUpperCase();
            let result;

            if (method === "GET") {
              result = {
                type: "get",
                url: handoffUrl.toString(),
              };
            } else if (method === "POST") {
              const headers = request.headers || {};
              const contentTypeEntry = Object.entries(headers).find(
                ([name]) => name.toLowerCase() === "content-type",
              );
              const contentType = String(contentTypeEntry?.[1] || "")
                .split(";")[0]
                .trim()
                .toLowerCase();

              if (
                contentType !== "application/x-www-form-urlencoded" &&
                contentType !== "multipart/form-data"
              ) {
                await cdp
                  .send("Fetch.failRequest", {
                    requestId: event.requestId,
                    errorReason: "Aborted",
                  })
                  .catch(() => {});

                const error = new Error(
                  `ePortal generated an external POST handoff using unsupported content type ${contentType || "unknown"}.`,
                );
                error.code = "EPORTAL_HANDOFF_POST_UNSUPPORTED";
                finish(rejectHandoff, error);
                return;
              }

              if (contentType === "multipart/form-data") {
                await cdp
                  .send("Fetch.failRequest", {
                    requestId: event.requestId,
                    errorReason: "Aborted",
                  })
                  .catch(() => {});

                const error = new Error(
                  "ePortal generated a multipart POST handoff that cannot be safely reconstructed from Chromium request data.",
                );
                error.code = "EPORTAL_HANDOFF_POST_UNSUPPORTED";
                finish(rejectHandoff, error);
                return;
              }

              const params = new URLSearchParams(request.postData || "");
              result = {
                type: "post",
                url: handoffUrl.toString(),
                fields: [...params.entries()],
                enctype: "application/x-www-form-urlencoded",
              };
            } else {
              await cdp
                .send("Fetch.failRequest", {
                  requestId: event.requestId,
                  errorReason: "Aborted",
                })
                .catch(() => {});

              const error = new Error(
                `ePortal generated an unsupported external ${method} handoff.`,
              );
              error.code = "EPORTAL_HANDOFF_UNAVAILABLE";
              finish(rejectHandoff, error);
              return;
            }

            await cdp
              .send("Fetch.failRequest", {
                requestId: event.requestId,
                errorReason: "Aborted",
              })
              .catch(() => {});

            if (
              result.type === "get" &&
              !looksSelfContainedGetHandoff(result.url)
            ) {
              try {
                result = await discoverBareExternalGet(
                  context,
                  module,
                  result.url,
                  eportalOrigin,
                );
              } catch (error) {
                finish(rejectHandoff, error);
                return;
              }
            }

            console.log(
              `[handoff] captured preflight document for ${module.id}: ${result.type.toUpperCase()} ${handoffUrl.hostname}${handoffUrl.pathname}`,
            );
            finish(resolveHandoff, result);
          })();
        });

        await cdp.send("Fetch.enable", {
          patterns: [
            {
              urlPattern: "*",
              resourceType: "Document",
              requestStage: "Request",
            },
          ],
        });
      }

      try {
        await launcher.goto(moduleUrl(module.id), {
          waitUntil: "commit",
          timeout: 10_000,
          referer: EPORTAL_DASHBOARD,
        }).catch((error) => {
          // An intercepted external navigation is expected to abort goto().
          if (!settled) throw error;
        });

        setTimeout(() => {
          void (async () => {
            if (settled) return;

            try {
              const current = new URL(launcher.url());
              if (current.origin !== eportalOrigin) return;

              const summary = await launcher.evaluate(() => {
                const externalish = (value) => {
                  if (!value) return null;
                  try {
                    const url = new URL(value, location.href);
                    return url.origin === location.origin
                      ? null
                      : { host: url.hostname, path: url.pathname };
                  } catch {
                    return null;
                  }
                };

                const forms = [...document.forms]
                  .map((form) => ({
                    method: String(form.method || "GET").toUpperCase(),
                    target: externalish(form.action),
                  }))
                  .filter((entry) => entry.target)
                  .slice(0, 4);

                const links = [...document.querySelectorAll("a[href]")]
                  .map((anchor) => externalish(anchor.href))
                  .filter(Boolean)
                  .slice(0, 4);

                return {
                  title: document.title.slice(0, 120),
                  forms,
                  links,
                };
              });

              console.log(
                `[handoff] launcher inspect ${module.id}: ${safeUrlLabel(launcher.url())}; title=${JSON.stringify(summary.title)}; forms=${JSON.stringify(summary.forms)}; links=${JSON.stringify(summary.links)}`,
              );
            } catch {
              // Launcher may close or be replaced while being inspected.
            }
          })();
        }, 1200);
      } catch (error) {
        if (!settled) {
          const launchError = new Error(
            "Could not launch the selected ePortal module.",
          );
          launchError.code = "EPORTAL_HANDOFF_UNAVAILABLE";
          finish(rejectHandoff, launchError);
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
