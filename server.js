import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { EPORTAL_ORIGIN, publicModules } from "./src/eportal.js";
import {
  clearActivityRelaySessions,
  proxyActivityRelay,
  startActivityRelay,
} from "./src/activity-relay.js";
import {
  applyLoginBridgeAction,
  getLoginBridgeImage,
  getLoginBridgeState,
  getLoginBridgeSummary,
  shutdownLoginBridge,
  startLoginBridge,
  stopLoginBridge,
} from "./src/login-bridge.js";
import { createCloudflareAccessGuard } from "./src/cloudflare-access.js";
import { DashboardPreferenceStore } from "./src/dashboard-preferences.js";
import { PreferenceStore } from "./src/preference-store.js";
import {
  checkServerPortalStatus,
  createModuleHandoff,
  getPortalKeepaliveState,
  logoutServerPortalSession,
  startPortalKeepalive,
} from "./src/portal-session.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4174);
const serverInstanceId =
  crypto.randomUUID?.() || crypto.randomBytes(16).toString("hex");
const serverStartedAt = Date.now();
let restartScheduled = false;
const preferenceStore = new PreferenceStore();
const dashboardPreferenceStore = new DashboardPreferenceStore();
const launchJobs = new Map();
const launchJobTtlMs = 2 * 60_000;
const keepaliveMinutes = Number(process.env.EPORTAL_KEEPALIVE_MINUTES ?? 10);
const loginBridgeTtlMinutes = Number(
  process.env.EPORTAL_LOGIN_BRIDGE_TTL_MINUTES ?? 15,
);
const cloudflareAccess = createCloudflareAccessGuard({
  enforce: /^(1|true|yes)$/i.test(
    String(process.env.CLOUDFLARE_ACCESS_ENFORCE || ""),
  ),
  teamDomain: process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN || "",
  audience: process.env.CLOUDFLARE_ACCESS_AUD || "",
});

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

function sendError(res, status, message, code) {
  sendJson(res, status, {
    error: message,
    ...(code ? { code } : {}),
  });
}

function sendPng(res, body) {
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": body.length,
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function sendBinaryImage(res, image) {
  res.writeHead(200, {
    "Content-Type": image.contentType,
    "Content-Length": image.body.length,
    "Cache-Control": "private, max-age=300",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(image.body);
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      throw Object.assign(new Error("Request body is too large."), {
        statusCode: 413,
      });
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), {
      statusCode: 400,
    });
  }
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store, private",
    Pragma: "no-cache",
    Expires: "0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end();
}

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sendPostHandoff(res, handoff) {
  const target = new URL(handoff.url);
  const nonce = crypto.randomBytes(18).toString("base64url");

  const fields = (handoff.fields || [])
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtmlAttribute(name)}" value="${escapeHtmlAttribute(value)}">`,
    )
    .join("\n");

  const body = Buffer.from(`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connecting…</title>
</head>
<body>
  <form id="handoff" method="post" enctype="${escapeHtmlAttribute(
    handoff.enctype || "application/x-www-form-urlencoded",
  )}" action="${escapeHtmlAttribute(target.toString())}">
    ${fields}
    <noscript><button type="submit">Continue</button></noscript>
  </form>
  <script nonce="${nonce}">document.getElementById("handoff").submit();</script>
</body>
</html>`);

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store, private",
    Pragma: "no-cache",
    Expires: "0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${target.origin}; base-uri 'none'; frame-ancestors 'none'`,
  });
  res.end(body);
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

async function serveStatic(res, pathname) {
  const relative =
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(publicDir, relative);

  if (
    resolved !== publicDir &&
    !resolved.startsWith(`${publicDir}${path.sep}`)
  ) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) throw new Error("Not a file");

    const body = await fsp.readFile(resolved);
    res.writeHead(200, {
      "Content-Type": contentType(resolved),
      "Content-Length": body.length,
      "Cache-Control":
        path.extname(resolved).toLowerCase() === ".html"
          ? "no-cache"
          : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(body);
  } catch {
    sendError(res, 404, "Not found.");
  }
}

function handleBridgeError(res, error) {
  if (error?.code === "EPORTAL_LOGIN_BRIDGE_UNAUTHORIZED") {
    sendError(res, 401, error.message, error.code);
    return true;
  }

  if (error?.code === "EPORTAL_LOGIN_BRIDGE_NOT_FOUND") {
    sendError(res, 404, error.message, error.code);
    return true;
  }

  if (error?.code === "EPORTAL_LOGIN_BRIDGE_UNSUPPORTED") {
    sendError(res, 422, error.message, error.code);
    return true;
  }

  if (error?.code === "EPORTAL_PROFILE_BUSY") {
    sendError(res, 409, error.message, error.code);
    return true;
  }

  return false;
}

function moduleForLaunch(moduleId) {
  return publicModules().find((entry) => entry.id === moduleId) || null;
}

function updateLaunchJob(job, stage, detail) {
  job.stage = stage;
  job.detail = detail;
  job.updatedAt = new Date().toISOString();
}

function launchTargetLabel(rawUrl) {
  try {
    const target = new URL(rawUrl, "http://local.invalid");
    if (target.hostname === "local.invalid") return "local relay";
    return target.hostname;
  } catch {
    return "target system";
  }
}

function serializeLaunchJob(job) {
  return {
    id: job.id,
    state: job.state,
    stage: job.stage,
    detail: job.detail,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    elapsedMs: Math.max(0, Date.now() - job.startedAtMs),
    module: job.module,
    ...(job.target ? { target: job.target } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

async function buildModuleLaunch(moduleId, onProgress) {
  const handoff = await createModuleHandoff(moduleId, {
    onProgress,
  });

  if (moduleId === "activity") {
    onProgress?.({
      stage: "activity-relay",
      detail: "Preparing the local Activity relay for the captured handoff.",
    });
    const relay = await startActivityRelay(handoff);
    return {
      type: "get",
      url: relay.launchPath,
      target: "Activity relay",
    };
  }

  if (handoff?.type === "get") {
    return {
      type: "get",
      url: handoff.url,
      target: launchTargetLabel(handoff.url),
    };
  }

  if (handoff?.type === "post") {
    return {
      type: "post",
      url: handoff.url,
      fields: handoff.fields || [],
      enctype:
        handoff.enctype || "application/x-www-form-urlencoded",
      target: launchTargetLabel(handoff.url),
    };
  }

  throw Object.assign(
    new Error("ePortal returned an unsupported handoff type."),
    { code: "EPORTAL_HANDOFF_UNAVAILABLE" },
  );
}

function startModuleLaunchJob(moduleId) {
  const module = moduleForLaunch(moduleId);
  if (!module) {
    const error = new Error("Unknown ePortal module.");
    error.statusCode = 404;
    throw error;
  }

  const id = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const job = {
    id,
    module: {
      id: module.id,
      shortName: module.shortName,
      name: module.name,
      description: module.description,
      icon: module.icon,
    },
    state: "running",
    stage: "queued",
    detail: "Launch request accepted by the Dashboard server.",
    startedAt: now,
    updatedAt: now,
    startedAtMs: Date.now(),
    result: null,
    target: null,
    error: null,
  };

  launchJobs.set(id, job);

  const expiry = setTimeout(() => {
    launchJobs.delete(id);
  }, launchJobTtlMs);
  expiry.unref?.();

  void (async () => {
    try {
      const result = await buildModuleLaunch(moduleId, (progress) => {
        if (!launchJobs.has(id)) return;
        updateLaunchJob(
          job,
          progress?.stage || "working",
          progress?.detail || "Server-side launch work is in progress.",
        );
      });

      if (!launchJobs.has(id)) return;
      job.result = result;
      job.target = result.target || "target system";
      job.state = "ready";
      updateLaunchJob(
        job,
        "ready",
        "SSO handoff is ready. Transferring it to this browser.",
      );
    } catch (error) {
      if (!launchJobs.has(id)) return;
      job.state = "error";
      job.error = {
        message: error?.message || "Module launch failed.",
        code: error?.code || "MODULE_LAUNCH_FAILED",
      };
      updateLaunchJob(
        job,
        "error",
        error?.message || "Module launch failed.",
      );
    }
  })();

  return job;
}

function restartServerProcess() {
  const restartMode = String(
    process.env.EPORTAL_RESTART_MODE || "self",
  )
    .trim()
    .toLowerCase();

  let finished = false;

  function finishRestart() {
    if (finished) return;
    finished = true;

    if (restartMode === "exit") {
      process.exit(0);
      return;
    }

    try {
      const child = spawn(
        process.execPath,
        process.argv.slice(1),
        {
          cwd: __dirname,
          env: process.env,
          detached: true,
          stdio: "inherit",
        },
      );

      child.unref();
      setTimeout(() => process.exit(0), 60).unref();
    } catch (error) {
      restartScheduled = false;
      console.error("Could not restart NUTC Portal server:", error);

      if (!server.listening) {
        server.listen(port, host);
      }
    }
  }

  console.log("[debug] server restart requested");

  server.close(finishRestart);
  server.closeIdleConnections?.();

  setTimeout(() => {
    server.closeAllConnections?.();
  }, 1200).unref();

  setTimeout(finishRestart, 2500).unref();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );

  try {
    if (
      req.method === "GET" &&
      (url.pathname === "/login" || url.pathname === "/login/")
    ) {
      await serveStatic(res, "/access-login.html");
      return;
    }

    const accessResult = await cloudflareAccess.verify(req);

    if (!accessResult.ok) {
      console.warn(
        `[access] rejected ${req.method} ${url.pathname}: ${accessResult.code}`,
      );

      if (
        !url.pathname.startsWith("/api/") &&
        cloudflareAccess.wantsHtml(req)
      ) {
        redirect(res, "/login");
      } else {
        sendError(
          res,
          accessResult.status || 401,
          accessResult.message || "Cloudflare Access authentication is required.",
          accessResult.code || "CF_ACCESS_REQUIRED",
        );
      }
      return;
    }

    req.cloudflareAccess = accessResult.payload;

    if (req.method === "GET" && url.pathname === "/auth/start") {
      redirect(res, "/");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/access/session") {
      const payload = req.cloudflareAccess || {};
      sendJson(res, 200, {
        enforced: cloudflareAccess.enabled,
        authenticated: Boolean(req.cloudflareAccess),
        email:
          typeof payload.email === "string" ? payload.email : null,
        subject:
          typeof payload.sub === "string" ? payload.sub : null,
      });
      return;
    }

    if (url.pathname.startsWith("/activity-relay/")) {
      try {
        await proxyActivityRelay(req, res, url);
      } catch (error) {
        console.error(
          "Activity relay failed:",
          error?.message || error,
        );

        if (!res.headersSent) {
          sendError(
            res,
            502,
            error?.message || "Activity relay failed.",
            error?.code || "ACTIVITY_RELAY_UNAVAILABLE",
          );
        } else {
          res.end();
        }
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/server/status") {
      sendJson(res, 200, {
        instanceId: serverInstanceId,
        startedAt: serverStartedAt,
        restartScheduled,
        platform: process.platform,
        arch: process.arch,
        authMode: cloudflareAccess.enabled
          ? "cloudflare-access-jwt"
          : "cloudflare-access-delegated",
        cloudflareAccess: cloudflareAccess.publicInfo(),
        eportalSessionMode: "server-playwright-and-client-browser",
        eportalOrigin: EPORTAL_ORIGIN,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/debug/restart") {
      if (restartScheduled) {
        sendJson(res, 202, {
          ok: true,
          restarting: true,
          instanceId: serverInstanceId,
        });
        return;
      }

      await shutdownLoginBridge();
      clearActivityRelaySessions();

      restartScheduled = true;
      sendJson(res, 202, {
        ok: true,
        restarting: true,
        instanceId: serverInstanceId,
      });

      res.once("finish", () => {
        setTimeout(restartServerProcess, 120).unref();
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/portal-status") {
      const status = await checkServerPortalStatus();
      sendJson(res, 200, {
        ...status,
        keepalive: getPortalKeepaliveState(),
        loginBridge: getLoginBridgeSummary(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/portal-logout") {
      try {
        const result = await logoutServerPortalSession();
        clearActivityRelaySessions();
        sendJson(res, 200, result);
      } catch (error) {
        if (error?.code === "EPORTAL_PROFILE_BUSY") {
          sendError(
            res,
            409,
            "Server ePortal is busy. Try again after the current operation finishes.",
            error.code,
          );
          return;
        }

        throw error;
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/login-bridge/status") {
      sendJson(res, 200, getLoginBridgeSummary());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login-bridge/start") {
      try {
        sendJson(
          res,
          200,
          await startLoginBridge({
            ttlMinutes: loginBridgeTtlMinutes,
          }),
        );
      } catch (error) {
        if (handleBridgeError(res, error)) return;
        throw error;
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/login-bridge/state") {
      try {
        sendJson(res, 200, await getLoginBridgeState(bearerToken(req)));
      } catch (error) {
        if (handleBridgeError(res, error)) return;
        throw error;
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login-bridge/action") {
      try {
        const body = await readJsonBody(req, 32 * 1024);
        sendJson(
          res,
          200,
          await applyLoginBridgeAction(bearerToken(req), body),
        );
      } catch (error) {
        if (handleBridgeError(res, error)) return;
        throw error;
      }
      return;
    }

    const bridgeImageMatch =
      req.method === "GET" &&
      url.pathname.match(/^\/api\/login-bridge\/image\/(image-\d+)$/);

    if (bridgeImageMatch) {
      try {
        sendPng(
          res,
          await getLoginBridgeImage(
            bearerToken(req),
            bridgeImageMatch[1],
          ),
        );
      } catch (error) {
        if (handleBridgeError(res, error)) return;
        throw error;
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login-bridge/stop") {
      try {
        sendJson(res, 200, await stopLoginBridge(bearerToken(req)));
      } catch (error) {
        if (handleBridgeError(res, error)) return;
        throw error;
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/modules") {
      sendJson(res, 200, { modules: publicModules() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/preferences") {
      sendJson(res, 200, dashboardPreferenceStore.get());
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/preferences/account"
    ) {
      const body = await readJsonBody(req, 3 * 1024 * 1024);
      const saved = await dashboardPreferenceStore.setAccount(body);
      sendJson(res, 200, {
        ok: true,
        ...saved,
      });
      return;
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/preferences/background"
    ) {
      const body = await readJsonBody(req, 9 * 1024 * 1024);
      const saved = await dashboardPreferenceStore.setBackground(body);
      sendJson(res, 200, {
        ok: true,
        ...saved,
      });
      return;
    }

    if (
      req.method === "GET" &&
      url.pathname === "/api/preferences/avatar"
    ) {
      const image = await dashboardPreferenceStore.readAvatar();
      if (!image) {
        sendError(res, 404, "Account picture not configured.");
        return;
      }
      sendBinaryImage(res, image);
      return;
    }

    if (
      req.method === "GET" &&
      url.pathname === "/api/preferences/background"
    ) {
      const image = await dashboardPreferenceStore.readBackground();
      if (!image) {
        sendError(res, 404, "Background not configured.");
        return;
      }
      sendBinaryImage(res, image);
      return;
    }

    const launchStartMatch =
      req.method === "POST" &&
      url.pathname.match(/^\/api\/launch\/([a-z0-9-]+)$/);

    if (launchStartMatch) {
      const job = startModuleLaunchJob(launchStartMatch[1]);
      sendJson(res, 202, {
        ok: true,
        job: serializeLaunchJob(job),
      });
      return;
    }

    const launchStatusMatch =
      req.method === "GET" &&
      url.pathname.match(/^\/api\/launch-job\/([a-f0-9]{32})$/);

    if (launchStatusMatch) {
      const job = launchJobs.get(launchStatusMatch[1]);
      if (!job) {
        sendError(res, 404, "Launch job not found or expired.");
        return;
      }

      sendJson(res, 200, {
        ok: true,
        job: serializeLaunchJob(job),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/sync") {
      sendJson(res, 200, preferenceStore.get());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sync") {
      const body = await readJsonBody(req);
      const saved = await preferenceStore.set(body);
      sendJson(res, 200, {
        ok: true,
        updatedAt: saved.updatedAt,
      });
      return;
    }

    const launchContinueMatch =
      req.method === "GET" &&
      url.pathname.match(/^\/launch-job\/([a-f0-9]{32})\/continue$/);

    if (launchContinueMatch) {
      const job = launchJobs.get(launchContinueMatch[1]);

      if (!job) {
        sendError(res, 404, "Launch job not found or expired.");
        return;
      }

      if (job.state === "error") {
        sendError(
          res,
          502,
          job.error?.message || "Module launch failed.",
          job.error?.code,
        );
        return;
      }

      if (job.state !== "ready" || !job.result) {
        sendError(res, 409, "Launch handoff is not ready yet.");
        return;
      }

      const handoff = job.result;
      res.once("finish", () => {
        launchJobs.delete(job.id);
      });

      if (handoff.type === "get") {
        redirect(res, handoff.url);
        return;
      }

      if (handoff.type === "post") {
        sendPostHandoff(res, handoff);
        return;
      }

      launchJobs.delete(job.id);
      sendError(res, 502, "Unsupported launch handoff type.");
      return;
    }

    const goMatch =
      req.method === "GET" &&
      url.pathname.match(/^\/go\/([a-z0-9-]+)$/);

    if (goMatch) {
      if (!moduleForLaunch(goMatch[1])) {
        sendError(res, 404, "Unknown ePortal module.");
        return;
      }

      await serveStatic(res, "/launch.html");
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendError(res, 404, "API route not found.");
      return;
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/server-login" ||
        url.pathname === "/server-login/")
    ) {
      await serveStatic(res, "/server-login.html");
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error("Request failed:", error?.message || error);

    if (!res.headersSent) {
      sendError(
        res,
        error?.statusCode || 500,
        error?.statusCode ? error.message : "Internal server error.",
      );
    } else {
      res.end();
    }
  }
});

await Promise.all([
  preferenceStore.init(),
  dashboardPreferenceStore.init(),
]);
const keepalive = startPortalKeepalive({
  intervalMinutes: keepaliveMinutes,
});

server.listen(port, host, () => {
  console.log(`NUTC Portal: http://${host}:${port}`);

  if (
    cloudflareAccess.enabled &&
    !["127.0.0.1", "::1", "localhost"].includes(host)
  ) {
    console.warn(
      "Production note: the Node listener is not loopback-only. For a direct Cloudflare-proxy deployment, set HOST=127.0.0.1 and put Caddy/nginx on public :443.",
    );
  }
  console.log(
    cloudflareAccess.enabled
      ? `Dashboard authentication: Cloudflare Access JWT enforced at origin (${cloudflareAccess.publicInfo().teamDomain}).`
      : "Dashboard authentication: delegated to Cloudflare Access; origin JWT enforcement is disabled.",
  );
  console.log(
    "Cloudflare Access pre-auth screen: /login (configure only this path as public/bypassed at the edge).",
  );
  console.log(
    "Server ePortal session: persistent Playwright profile at .eportal-profile/",
  );
  console.log(
    "Interactive server re-login: native HTML form bridge at /server-login/",
  );
  console.log(
    keepalive.enabled
      ? `ePortal keepalive: every ${keepalive.intervalMinutes} minute(s).`
      : "ePortal keepalive: disabled.",
  );
});
