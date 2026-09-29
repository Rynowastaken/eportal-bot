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

const LEGACY_HTTP_HANDOFF_HOSTS = Object.freeze({
  webmail: ["163.17.131.143"],
  activity: ["163.17.131.167"],
});

function isTrustedLegacyHttpTarget(module, rawUrl) {
  const target = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  const hosts = LEGACY_HTTP_HANDOFF_HOSTS[module.id] || [];

  return target.protocol === "http:" && hosts.includes(target.hostname);
}

function shouldExecuteLegacyTargetInBrowser(module, rawUrl) {
  return (
    module.id === "activity" &&
    isTrustedLegacyHttpTarget(module, rawUrl)
  );
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


function decodeHtmlAttribute(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function htmlAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
  const match = String(tag).match(
    new RegExp(
      `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i",
    ),
  );

  return decodeHtmlAttribute(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function htmlNavigationSignals(html, baseUrl) {
  const title =
    decodeHtmlAttribute(
      String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

  const forms = [];
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let formMatch;

  while ((formMatch = formPattern.exec(html)) && forms.length < 6) {
    const openTag = `<form ${formMatch[1]}>`;
    const body = formMatch[2] || "";
    const actionRaw = htmlAttribute(openTag, "action") || baseUrl.toString();
    const method = (htmlAttribute(openTag, "method") || "GET").toUpperCase();
    const enctype = (
      htmlAttribute(openTag, "enctype") ||
      "application/x-www-form-urlencoded"
    ).toLowerCase();

    let action;
    try {
      action = new URL(actionRaw, baseUrl);
    } catch {
      continue;
    }

    const fields = [];
    let hasInteractive = false;
    const inputPattern = /<input\b[^>]*>/gi;
    let inputMatch;

    while ((inputMatch = inputPattern.exec(body)) && fields.length < 200) {
      const tag = inputMatch[0];
      const type = (htmlAttribute(tag, "type") || "text").toLowerCase();
      const name = htmlAttribute(tag, "name");

      if (!name) continue;

      if (type === "hidden") {
        fields.push([name, htmlAttribute(tag, "value")]);
      } else if (!["submit", "button", "reset", "image"].includes(type)) {
        hasInteractive = true;
      }
    }

    forms.push({
      method,
      action,
      enctype,
      fields,
      hasInteractive,
    });
  }

  let metaRefresh = null;
  const metaPattern = /<meta\b[^>]*>/gi;
  for (const tag of String(html).match(metaPattern) || []) {
    if (htmlAttribute(tag, "http-equiv").toLowerCase() !== "refresh") continue;

    const content = htmlAttribute(tag, "content");
    const match = content.match(/url\s*=\s*(.+)$/i);
    if (!match) continue;

    try {
      metaRefresh = new URL(
        match[1].trim().replace(/^['"]|['"]$/g, ""),
        baseUrl,
      );
    } catch {
      // Ignore malformed refresh targets.
    }
    break;
  }

  const scriptTargets = [];
  const scriptPatterns = [
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/gi,
    /(?:window\.)?location\.replace\(\s*["']([^"']+)["']\s*\)/gi,
    /window\.open\(\s*["']([^"']+)["']/gi,
  ];

  for (const pattern of scriptPatterns) {
    let match;
    while ((match = pattern.exec(html)) && scriptTargets.length < 8) {
      try {
        scriptTargets.push(new URL(decodeHtmlAttribute(match[1]), baseUrl));
      } catch {
        // Ignore malformed JavaScript URL literals.
      }
    }
  }

  return {
    title,
    forms,
    metaRefresh,
    scriptTargets,
  };
}

async function discoverBareExternalGet(
  context,
  module,
  rawUrl,
  eportalOrigin,
) {
  let current = new URL(rawUrl);
  let referer = moduleUrl(module.id);
  let method = "GET";
  let fields = [];
  const visited = new Set();

  const classifyTarget = (target) => {
    const external = normalizeExternalHandoffUrl(target, eportalOrigin);
    if (external) return { kind: "https", url: external };
    if (isTrustedLegacyHttpTarget(module, target)) {
      return { kind: "legacy-http", url: target };
    }
    if (target.origin === eportalOrigin) {
      return { kind: "eportal", url: target };
    }
    return { kind: "unsupported", url: target };
  };

  const continueWith = (target, nextMethod = "GET", nextFields = []) => {
    referer = current.toString();
    current = new URL(target);
    method = nextMethod;
    fields = nextFields;
  };

  for (let step = 0; step < 12; step += 1) {
    const visitKey = `${method} ${current.toString()}`;
    if (visited.has(visitKey)) break;
    visited.add(visitKey);

    const common = {
      maxRedirects: 0,
      failOnStatusCode: false,
      timeout: 12_000,
      headers: {
        Referer: referer,
      },
    };

    const response =
      method === "POST"
        ? await context.request.post(current.toString(), {
            ...common,
            data: new URLSearchParams(fields).toString(),
            headers: {
              ...common.headers,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          })
        : await context.request.get(current.toString(), common);

    const status = response.status();
    console.log(
      `[handoff] follow bare ${module.id}: ${method} ${status} ${safeUrlLabel(current)}`,
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

      const preserveMethod = status === 307 || status === 308;
      const nextMethod = preserveMethod ? method : "GET";
      const nextFields = preserveMethod ? fields : [];
      const classified = classifyTarget(next);

      if (classified.kind === "https") {
        if (nextMethod === "POST") {
          console.log(
            `[handoff] discovered transferable POST redirect for ${module.id}: ${classified.url.hostname}${classified.url.pathname}`,
          );
          return {
            type: "post",
            url: classified.url.toString(),
            fields: nextFields,
            enctype: "application/x-www-form-urlencoded",
          };
        }

        if (looksSelfContainedGetHandoff(classified.url)) {
          console.log(
            `[handoff] discovered transferable redirect for ${module.id}: GET ${classified.url.hostname}${classified.url.pathname}`,
          );
          return {
            type: "get",
            url: classified.url.toString(),
          };
        }
      }

      if (
        classified.kind === "https" ||
        classified.kind === "legacy-http" ||
        classified.kind === "eportal"
      ) {
        if (classified.kind === "legacy-http") {
          console.log(
            `[handoff] following trusted legacy HTTP redirect for ${module.id}: ${classified.url.hostname}${classified.url.pathname}`,
          );
        }

        continueWith(classified.url, nextMethod, nextFields);
        continue;
      }

      break;
    }

    const headers = response.headers();
    const contentType = String(headers["content-type"] || "").toLowerCase();
    const contentLength = Number(headers["content-length"] || 0);
    let htmlSignals = null;

    if (
      contentType.includes("text/html") &&
      (!Number.isFinite(contentLength) || contentLength <= 512 * 1024)
    ) {
      try {
        const html = await response.text();
        htmlSignals = htmlNavigationSignals(html, current);

        const navigationTargets = [
          htmlSignals.metaRefresh,
          ...htmlSignals.scriptTargets,
        ].filter(Boolean);
        let followedHtmlNavigation = false;

        for (const candidate of navigationTargets) {
          const classified = classifyTarget(candidate);

          if (
            classified.kind === "https" &&
            looksSelfContainedGetHandoff(classified.url)
          ) {
            console.log(
              `[handoff] discovered transferable HTML navigation for ${module.id}: GET ${classified.url.hostname}${classified.url.pathname}`,
            );
            return {
              type: "get",
              url: classified.url.toString(),
            };
          }

          if (
            classified.kind === "https" ||
            classified.kind === "legacy-http" ||
            classified.kind === "eportal"
          ) {
            console.log(
              `[handoff] following HTML navigation for ${module.id}: GET ${classified.url.hostname}${classified.url.pathname}`,
            );
            continueWith(classified.url, "GET", []);
            followedHtmlNavigation = true;
            break;
          }
        }

        if (followedHtmlNavigation) {
          continue;
        }

        const autoForms = htmlSignals.forms.filter(
          (form) =>
            !form.hasInteractive &&
            ["GET", "POST"].includes(form.method) &&
            form.enctype === "application/x-www-form-urlencoded",
        );

        if (autoForms.length === 1) {
          const form = autoForms[0];
          const classified = classifyTarget(form.action);

          if (form.method === "GET") {
            const target = new URL(form.action);
            for (const [name, value] of form.fields) {
              target.searchParams.append(name, value);
            }

            const getTarget = classifyTarget(target);

            if (
              getTarget.kind === "https" &&
              looksSelfContainedGetHandoff(getTarget.url)
            ) {
              console.log(
                `[handoff] discovered transferable HTML form for ${module.id}: GET ${getTarget.url.hostname}${getTarget.url.pathname}`,
              );
              return {
                type: "get",
                url: getTarget.url.toString(),
              };
            }

            if (
              getTarget.kind === "https" ||
              getTarget.kind === "legacy-http" ||
              getTarget.kind === "eportal"
            ) {
              console.log(
                `[handoff] following hidden GET form for ${module.id}: ${getTarget.url.hostname}${getTarget.url.pathname}`,
              );
              continueWith(getTarget.url, "GET", []);
              continue;
            }
          }

          if (form.method === "POST") {
            if (classified.kind === "https") {
              console.log(
                `[handoff] discovered transferable HTML form for ${module.id}: POST ${classified.url.hostname}${classified.url.pathname}`,
              );
              return {
                type: "post",
                url: classified.url.toString(),
                fields: form.fields,
                enctype: "application/x-www-form-urlencoded",
              };
            }

            if (
              classified.kind === "legacy-http" ||
              classified.kind === "eportal"
            ) {
              console.log(
                `[handoff] following hidden POST form for ${module.id}: ${classified.url.hostname}${classified.url.pathname}; fields=${form.fields.map(([name]) => name).join(",") || "none"}`,
              );
              continueWith(classified.url, "POST", form.fields);
              continue;
            }
          }
        }

        const absoluteMatches =
          html.match(/https?:\/\/[^"'<>\s]+/gi) || [];

        for (const rawCandidate of absoluteMatches.slice(0, 80)) {
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

          if (external && looksSelfContainedGetHandoff(external)) {
            console.log(
              `[handoff] discovered transferable URL in target HTML for ${module.id}: GET ${external.hostname}${external.pathname}`,
            );
            return {
              type: "get",
              url: external.toString(),
            };
          }
        }
      } catch (error) {
        if (error?.code?.startsWith("EPORTAL_HANDOFF_")) throw error;
        htmlSignals = null;
      }
    }

    const cookieScopes = [
      ...new Set(
        (await context.cookies())
          .map((cookie) => cookie.domain)
          .filter(
            (domain) =>
              domain === current.hostname ||
              domain === `.${current.hostname}` ||
              domain === "nutc.edu.tw" ||
              domain === ".nutc.edu.tw" ||
              domain.endsWith(".nutc.edu.tw"),
          ),
      ),
    ].sort();

    const formSummary =
      htmlSignals?.forms
        ?.map(
          (form) =>
            `${form.method} ${safeUrlLabel(form.action)} [${form.fields.map(([name]) => name).join(",")}]${form.hasInteractive ? " interactive" : ""}`,
        )
        .join("; ") || "none";
    const navSummary = [
      htmlSignals?.metaRefresh,
      ...(htmlSignals?.scriptTargets || []),
    ]
      .filter(Boolean)
      .map((target) => safeUrlLabel(target))
      .join(",") || "none";

    const error = new Error(
      `ePortal reached ${safeUrlLabel(current)} without exposing a transferable SSO URL or form. The captured flow is bound to the server-side browser/session, so redirecting the bare endpoint to the client does not carry authentication.`,
    );
    error.code = "EPORTAL_HANDOFF_SESSION_BOUND";
    error.diagnostics = {
      final: safeUrlLabel(current),
      status,
      title: htmlSignals?.title || "",
      forms: formSummary,
      navigationTargets: navSummary,
      cookieScopes,
    };

    console.log(
      `[handoff] session-bound ${module.id}; final=${error.diagnostics.final}; status=${status}; title=${JSON.stringify(error.diagnostics.title)}; forms=${formSummary}; nav=${navSummary}; cookie-scopes=${cookieScopes.join(",") || "none"}`,
    );

    throw error;
  }

  const error = new Error(
    "ePortal produced a legacy external handoff, but no transferable SSO material was found after following its redirect/form flow.",
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

    // Return as soon as the authenticated marker appears or ePortal redirects
    // away from the dashboard. Keep the old 1.5 s window only as a fallback.
    await Promise.race([
      page
        .locator(STUDENT_BUTTON_SELECTOR)
        .waitFor({ state: "attached", timeout: 1_500 })
        .catch(() => {}),
      page
        .waitForURL(
          (url) =>
            url.hostname !== "eportal.nutc.edu.tw" ||
            !url.pathname.startsWith("/nutc_dashboard/"),
          { timeout: 1_500 },
        )
        .catch(() => {}),
    ]);

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

export async function logoutServerPortalSession() {
  if (!(await profileExists())) {
    return {
      ok: true,
      status: "not-configured",
    };
  }

  return withProfileLock(
    async () => {
      let context;

      try {
        context = await openServerPortalSession({
          headless: true,
          launchTimeout: 15_000,
        });

        await context.clearCookies();

        const page = context.pages()[0] || (await context.newPage());

        await page
          .goto(EPORTAL_HOME, {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          })
          .catch(() => {});

        await page
          .evaluate(async () => {
            try {
              localStorage.clear();
              sessionStorage.clear();
            } catch {
              // Storage can be unavailable on some error/interstitial pages.
            }

            try {
              if ("caches" in globalThis) {
                const keys = await caches.keys();
                await Promise.all(keys.map((key) => caches.delete(key)));
              }
            } catch {
              // Cache cleanup is best effort.
            }
          })
          .catch(() => {});

        console.log("[portal-session] server ePortal session logged out");

        keepaliveState.lastStatus = "needs-login";
        keepaliveState.lastError = null;

        return {
          ok: true,
          status: "needs-login",
        };
      } finally {
        if (context) await context.close().catch(() => {});
      }
    },
    { timeoutMs: 5_000 },
  );
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

    if (isTrustedLegacyHttpTarget(module, next)) {
      console.log(
        `[handoff] probe following trusted legacy HTTP hop for ${module.id}: ${next.hostname}${next.pathname}`,
      );
      current = next;
      continue;
    }

    if (next.origin !== eportalOrigin) return null;
    current = next;
  }

  return null;
}

export async function createModuleHandoff(
  moduleId,
  { timeout = 30_000, onProgress = null } = {},
) {
  const module = moduleById(moduleId);
  const report = (stage, detail) => {
    try {
      onProgress?.({
        stage,
        detail,
        at: new Date().toISOString(),
      });
    } catch {
      // Progress reporting must never interrupt SSO generation.
    }
  };

  report("profile-check", "Checking the persistent ePortal profile.");

  if (!(await profileExists())) {
    const error = new Error(
      "Server ePortal profile is not configured. Use the Server ePortal login bridge first.",
    );
    error.code = "EPORTAL_LOGIN_REQUIRED";
    throw error;
  }

  report(
    "profile-lock",
    "Waiting for exclusive access to the persistent browser profile.",
  );

  return withProfileLock(async () => {
    let context;

    try {
      report(
        "browser-launch",
        "Launching headless Chromium with the saved ePortal profile.",
      );

      context = await openServerPortalSession({
        headless: true,
        launchTimeout: 15_000,
      });

      report(
        "browser-ready",
        "Chromium is running; opening the authenticated ePortal dashboard.",
      );

      const dashboard =
        context.pages()[0] || (await context.newPage());

      report(
        "dashboard-load",
        "Loading the ePortal dashboard and waiting for DOM readiness.",
      );

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

      report(
        "session-valid",
        "Authenticated ePortal session confirmed; locating the selected module.",
      );

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
        report(
          "handoff-probe",
          "Probing the module route for a transferable SSO redirect.",
        );

        const probed = await captureHttpRedirectHandoff(
          context,
          module,
          eportalOrigin,
        );

        if (probed) {
          report(
            "handoff-captured",
            "A transferable SSO handoff was captured from the HTTP redirect flow.",
          );
          return probed;
        }
      }

      report(
        "handoff-browser",
        "HTTP probing was insufficient; switching to browser-level handoff discovery.",
      );

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
          if (shouldExecuteLegacyTargetInBrowser(module, target)) {
            console.log(
              `[handoff] allowing trusted legacy browser navigation for ${module.id}: ${target.hostname}${target.pathname}`,
            );
            await route.continue();
            return;
          }

          if (isTrustedLegacyHttpTarget(module, target)) {
            await route.abort("aborted");

            try {
              const result = await discoverBareExternalGet(
                context,
                module,
                target.toString(),
                eportalOrigin,
              );
              finish(resolveHandoff, result);
            } catch (error) {
              finish(rejectHandoff, error);
            }
            return;
          }

          if (target.protocol === "http:") {
            await route.abort("aborted");

            const error = new Error(
              "Refusing a non-HTTPS external ePortal handoff outside the module-specific legacy allowlist.",
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

      report(
        "module-request",
        "Triggering the selected ePortal module and monitoring its navigation flow.",
      );
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
              if (target.protocol !== "http:" && target.protocol !== "https:") {
                await cdp
                  .send("Fetch.continueRequest", {
                    requestId: event.requestId,
                  })
                  .catch(() => {});
                return;
              }

              if (shouldExecuteLegacyTargetInBrowser(module, target)) {
                console.log(
                  `[handoff] CDP allowing trusted legacy browser navigation for ${module.id}: ${target.hostname}${target.pathname}`,
                );
                await cdp
                  .send("Fetch.continueRequest", {
                    requestId: event.requestId,
                  })
                  .catch(() => {});
                return;
              }

              if (isTrustedLegacyHttpTarget(module, target)) {
                await cdp
                  .send("Fetch.failRequest", {
                    requestId: event.requestId,
                    errorReason: "Aborted",
                  })
                  .catch(() => {});

                try {
                  const result = await discoverBareExternalGet(
                    context,
                    module,
                    target.toString(),
                    eportalOrigin,
                  );
                  finish(resolveHandoff, result);
                } catch (error) {
                  finish(rejectHandoff, error);
                }
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
                  `Refusing external ${target.protocol} handoff outside the module-specific legacy allowlist (${target.hostname || "unknown-host"}).`,
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
        }).catch(() => {
          // Request-stage interception intentionally aborts external document
          // navigations while we inspect the handoff server-side. That abort can
          // race ahead of discoverBareExternalGet(), so do not convert it into a
          // launch failure here. The handoff promise (or its timeout) is the
          // authoritative result.
          if (!settled) {
            console.log(
              `[handoff] launcher navigation interrupted for ${module.id}; waiting for handoff discovery`,
            );
          }
        });

        setTimeout(() => {
          void (async () => {
            if (settled) return;

            try {
              const current = new URL(launcher.url());
              const isEportal = current.origin === eportalOrigin;
              const isLegacyActivity =
                shouldExecuteLegacyTargetInBrowser(module, current);

              if (!isEportal && !isLegacyActivity) return;

              const summary = await launcher.evaluate(() => {
                const targetInfo = (value) => {
                  if (!value) return null;
                  try {
                    const url = new URL(value, location.href);
                    return {
                      href: url.href,
                      host: url.hostname,
                      path: url.pathname,
                    };
                  } catch {
                    return null;
                  }
                };

                const forms = [...document.forms]
                  .map((form) => {
                    const fields = [];
                    let interactive = false;

                    try {
                      for (const [name, value] of new FormData(form).entries()) {
                        if (typeof value === "string") {
                          fields.push([String(name), value]);
                        }
                      }

                      interactive = Boolean(
                        form.querySelector(
                          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select',
                        ),
                      );
                    } catch {
                      interactive = true;
                    }

                    return {
                      method: String(form.method || "GET").toUpperCase(),
                      enctype: String(
                        form.enctype ||
                          "application/x-www-form-urlencoded",
                      ).toLowerCase(),
                      target: targetInfo(form.action || location.href),
                      fields,
                      fieldNames: fields.map(([name]) => name),
                      interactive,
                    };
                  })
                  .slice(0, 6);

                const links = [...document.querySelectorAll("a[href]")]
                  .map((anchor) => targetInfo(anchor.href))
                  .filter(Boolean)
                  .slice(0, 8);

                const meta = document.querySelector(
                  'meta[http-equiv="refresh" i]',
                );

                return {
                  title: document.title.slice(0, 120),
                  forms,
                  links,
                  refresh: meta?.content || "",
                };
              });

              for (const form of summary.forms) {
                if (
                  form.interactive ||
                  !form.target ||
                  form.enctype !== "application/x-www-form-urlencoded"
                ) {
                  continue;
                }

                let target;
                try {
                  target = normalizeExternalHandoffUrl(
                    new URL(form.target.href),
                    eportalOrigin,
                  );
                } catch {
                  continue;
                }

                if (!target) continue;

                if (form.method === "POST") {
                  console.log(
                    `[handoff] runtime discovered transferable form for ${module.id}: POST ${target.hostname}${target.pathname}; fields=${form.fieldNames.join(",") || "none"}`,
                  );
                  finish(resolveHandoff, {
                    type: "post",
                    url: target.toString(),
                    fields: form.fields,
                    enctype: "application/x-www-form-urlencoded",
                  });
                  return;
                }

                if (form.method === "GET") {
                  for (const [name, value] of form.fields) {
                    target.searchParams.append(name, value);
                  }

                  if (looksSelfContainedGetHandoff(target)) {
                    console.log(
                      `[handoff] runtime discovered transferable form for ${module.id}: GET ${target.hostname}${target.pathname}`,
                    );
                    finish(resolveHandoff, {
                      type: "get",
                      url: target.toString(),
                    });
                    return;
                  }
                }
              }

              for (const link of summary.links) {
                let target;
                try {
                  target = normalizeExternalHandoffUrl(
                    new URL(link.href),
                    eportalOrigin,
                  );
                } catch {
                  continue;
                }

                if (target && looksSelfContainedGetHandoff(target)) {
                  console.log(
                    `[handoff] runtime discovered transferable link for ${module.id}: GET ${target.hostname}${target.pathname}`,
                  );
                  finish(resolveHandoff, {
                    type: "get",
                    url: target.toString(),
                  });
                  return;
                }
              }

              const cookieNames = isLegacyActivity
                ? (await context.cookies(current.toString()))
                    .filter(
                      (cookie) =>
                        cookie.domain === current.hostname ||
                        cookie.domain === `.${current.hostname}`,
                    )
                    .map((cookie) => cookie.name)
                    .sort()
                : [];

              console.log(
                `[handoff] runtime inspect ${module.id}: ${safeUrlLabel(launcher.url())}; title=${JSON.stringify(summary.title)}; forms=${JSON.stringify(summary.forms.map((form) => ({ method: form.method, target: form.target ? { host: form.target.host, path: form.target.path } : null, fields: form.fieldNames, interactive: form.interactive })))}; links=${JSON.stringify(summary.links.map((link) => ({ host: link.host, path: link.path })))}; refresh=${JSON.stringify(summary.refresh)}; cookies=${cookieNames.join(",") || "none"}`,
              );

              if (isLegacyActivity && !settled) {
                const error = new Error(
                  `Activity authenticated inside the server-side browser at ${safeUrlLabel(current)}, but no transferable HTTPS SSO URL or hidden form was exposed. The target session is therefore browser-bound; opening the official site in the client would require either a separate client login or an explicit Activity-only relay.`,
                );
                error.code = "EPORTAL_HANDOFF_SESSION_BOUND";
                error.diagnostics = {
                  final: safeUrlLabel(current),
                  title: summary.title,
                  cookieNames,
                };
                finish(rejectHandoff, error);
              }
            } catch (error) {
              if (
                !settled &&
                error?.code?.startsWith("EPORTAL_HANDOFF_")
              ) {
                finish(rejectHandoff, error);
              }
            }
          })();
        }, 2500);
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
        const result = await Promise.race([handoffResult, handoff]);
        report(
          "handoff-captured",
          "Transferable SSO material captured; preparing client handoff.",
        );
        return result;
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
