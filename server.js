import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { EPORTAL_ORIGIN, publicModules } from "./src/eportal.js";
import {
  applyLoginBridgeAction,
  getLoginBridgeImage,
  getLoginBridgeState,
  getLoginBridgeSummary,
  startLoginBridge,
  stopLoginBridge,
} from "./src/login-bridge.js";
import { PreferenceStore } from "./src/preference-store.js";
import {
  checkServerPortalStatus,
  createModuleHandoff,
  getPortalKeepaliveState,
  startPortalKeepalive,
} from "./src/portal-session.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
const serverStartedAt = Date.now();
const preferenceStore = new PreferenceStore();
const keepaliveMinutes = Number(process.env.EPORTAL_KEEPALIVE_MINUTES ?? 10);
const loginBridgeTtlMinutes = Number(
  process.env.EPORTAL_LOGIN_BRIDGE_TTL_MINUTES ?? 15,
);

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
      "Cache-Control": pathname === "/" ? "no-cache" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
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

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );

  try {
    if (req.method === "GET" && url.pathname === "/api/server/status") {
      sendJson(res, 200, {
        startedAt: serverStartedAt,
        platform: process.platform,
        arch: process.arch,
        authMode: "cloudflare-access",
        eportalSessionMode: "server-playwright-and-client-browser",
        eportalOrigin: EPORTAL_ORIGIN,
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

    const goMatch =
      req.method === "GET" &&
      url.pathname.match(/^\/go\/([a-z0-9-]+)$/);

    if (goMatch) {
      try {
        const handoffUrl = await createModuleHandoff(goMatch[1]);
        redirect(res, handoffUrl);
      } catch (error) {
        if (error?.message === "Unknown ePortal module.") {
          sendError(res, 404, error.message);
          return;
        }

        if (error?.code === "EPORTAL_LOGIN_REQUIRED") {
          sendError(res, 503, error.message, error.code);
          return;
        }

        if (error?.code === "EPORTAL_HANDOFF_UNAVAILABLE") {
          sendError(res, 502, error.message, error.code);
          return;
        }

        if (error?.code === "EPORTAL_PROFILE_BUSY") {
          sendError(
            res,
            409,
            "Server ePortal profile is busy, likely because interactive login is in progress.",
            error.code,
          );
          return;
        }

        throw error;
      }
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

await preferenceStore.init();
const keepalive = startPortalKeepalive({
  intervalMinutes: keepaliveMinutes,
});

server.listen(port, host, () => {
  console.log(`NUTC Portal: http://${host}:${port}`);
  console.log("Dashboard authentication: delegated to Cloudflare Access.");
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
