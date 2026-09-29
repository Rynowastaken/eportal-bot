import fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { EPORTAL_ORIGIN, publicModules } from "./src/eportal.js";
import { PreferenceStore } from "./src/preference-store.js";
import {
  getNativeLoginRelayStatus,
  handleNativeLoginRelayRequest,
  startNativeLoginRelay,
} from "./src/native-login-relay.js";
import {
  REMOTE_LOGIN_COOKIE,
  getRemoteLoginStatus,
  isRemoteLoginRequestAuthorized,
  readRemoteLoginState,
  validateRemoteLoginToken,
} from "./src/remote-login.js";
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
const nativeRelayOrigin = process.env.EPORTAL_RELAY_ORIGIN
  ? new URL(process.env.EPORTAL_RELAY_ORIGIN)
  : null;
const nativeRelayTtlMinutes = Number(
  process.env.EPORTAL_RELAY_TTL_MINUTES ?? 15,
);

function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), { statusCode: 400 });
  }
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

function requestIsSecure(req) {
  const forwarded = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  return forwarded === "https" || Boolean(req.socket.encrypted);
}

function setRemoteLoginCookie(req, res, token, expiresAt) {
  const maxAge = Math.max(
    0,
    Math.floor((Date.parse(expiresAt) - Date.now()) / 1000),
  );
  const secure = requestIsSecure(req) ? "; Secure" : "";

  res.setHeader(
    "Set-Cookie",
    `${REMOTE_LOGIN_COOKIE}=${encodeURIComponent(token)}; Path=/remote-login/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`,
  );
}

function remoteLoginTargetPath(url) {
  const prefix = "/remote-login/xpra";
  let pathname = url.pathname.slice(prefix.length);
  if (!pathname) pathname = "/";
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  return `${pathname}${url.search}`;
}

function safeProxyRequestHeaders(req, state) {
  const allowed = [
    "accept",
    "accept-encoding",
    "accept-language",
    "cache-control",
    "pragma",
    "user-agent",
  ];
  const headers = {
    Host: `127.0.0.1:${state.port}`,
    "X-Forwarded-Prefix": "/remote-login/xpra",
  };

  for (const name of allowed) {
    const value = req.headers[name];
    if (value !== undefined) headers[name] = value;
  }

  return headers;
}

async function proxyRemoteLoginHttp(req, res, url) {
  if (!(await isRemoteLoginRequestAuthorized(req))) {
    sendError(res, 401, "Remote login authorization required.");
    return;
  }

  const state = await readRemoteLoginState();
  if (!state) {
    sendError(res, 503, "Remote login session is not active.");
    return;
  }

  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: state.port,
      path: remoteLoginTargetPath(url),
      method: req.method,
      headers: safeProxyRequestHeaders(req, state),
    },
    (proxyRes) => {
      const headers = { ...proxyRes.headers };
      delete headers["set-cookie"];
      delete headers["x-frame-options"];
      headers["cache-control"] = "no-store, private";
      headers["referrer-policy"] = "no-referrer";

      if (typeof headers.location === "string" && headers.location.startsWith("/")) {
        headers.location = `/remote-login/xpra${headers.location}`;
      }

      res.writeHead(proxyRes.statusCode || 502, headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      sendError(res, 502, "Remote Xpra session is unavailable.");
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
}

function writeUpgradeError(socket, status, message) {
  const body = Buffer.from(message);
  socket.end(
    `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\n\r\n${message}`,
  );
}

async function proxyRemoteLoginUpgrade(req, socket, head) {
  const url = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );

  if (!url.pathname.startsWith("/remote-login/xpra")) {
    writeUpgradeError(socket, "404 Not Found", "Not found.");
    return;
  }

  if (!(await isRemoteLoginRequestAuthorized(req))) {
    writeUpgradeError(socket, "401 Unauthorized", "Remote login authorization required.");
    return;
  }

  const state = await readRemoteLoginState();
  if (!state) {
    writeUpgradeError(socket, "503 Service Unavailable", "Remote login session is not active.");
    return;
  }

  const backend = net.createConnection({
    host: "127.0.0.1",
    port: state.port,
  });

  backend.once("error", () => {
    writeUpgradeError(socket, "502 Bad Gateway", "Remote Xpra session is unavailable.");
  });

  backend.once("connect", () => {
    const lines = [
      `${req.method || "GET"} ${remoteLoginTargetPath(url)} HTTP/${req.httpVersion}`,
    ];

    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index];
      const value = req.rawHeaders[index + 1];
      const lower = name.toLowerCase();

      if (
        lower === "host" ||
        lower === "cookie" ||
        lower.startsWith("cf-") ||
        lower === "x-forwarded-for" ||
        lower === "x-forwarded-host" ||
        lower === "x-forwarded-proto"
      ) {
        continue;
      }

      lines.push(`${name}: ${value}`);
    }

    lines.push(`Host: 127.0.0.1:${state.port}`);
    lines.push("X-Forwarded-Prefix: /remote-login/xpra");
    lines.push("", "");

    backend.write(lines.join("\r\n"));
    if (head?.length) backend.write(head);

    socket.pipe(backend).pipe(socket);
  });
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
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(publicDir, relative);

  if (resolved !== publicDir && !resolved.startsWith(`${publicDir}${path.sep}`)) {
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
        "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(body);
  } catch {
    sendError(res, 404, "Not found.");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (
      nativeRelayOrigin &&
      String(req.headers.host || "").toLowerCase() === nativeRelayOrigin.host.toLowerCase()
    ) {
      await handleNativeLoginRelayRequest(req, res, url, nativeRelayOrigin);
      return;
    }
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
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/native-login/status") {
      sendJson(
        res,
        200,
        getNativeLoginRelayStatus(Boolean(nativeRelayOrigin)),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/native-login/start") {
      if (!nativeRelayOrigin) {
        sendJson(res, 503, {
          error: "EPORTAL_RELAY_ORIGIN is not configured.",
          code: "EPORTAL_RELAY_NOT_CONFIGURED",
        });
        return;
      }

      const body = await readJsonBody(req, 8 * 1024);
      const returnUrl =
        typeof body.returnUrl === "string" ? body.returnUrl : "";

      try {
        sendJson(
          res,
          200,
          await startNativeLoginRelay({
            relayOrigin: nativeRelayOrigin,
            returnUrl,
            ttlMinutes: nativeRelayTtlMinutes,
          }),
        );
      } catch (error) {
        if (error?.code === "EPORTAL_PROFILE_BUSY") {
          sendJson(res, 409, {
            error: "The server ePortal profile is currently busy.",
            code: error.code,
          });
          return;
        }

        if (error?.code === "EPORTAL_RELAY_NOT_CONFIGURED") {
          sendJson(res, 503, {
            error: error.message,
            code: error.code,
          });
          return;
        }

        throw error;
      }
      return;
    }


    if (req.method === "GET" && url.pathname === "/api/remote-login/status") {
      const authorized = await isRemoteLoginRequestAuthorized(req);
      sendJson(res, 200, await getRemoteLoginStatus({ authorized }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/remote-login/status.json") {
      const authorized = await isRemoteLoginRequestAuthorized(req);
      sendJson(res, 200, await getRemoteLoginStatus({ authorized }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/remote-login/authorize") {
      const state = await readRemoteLoginState();
      if (!state) {
        sendError(res, 503, "Remote login session is not active.");
        return;
      }

      const body = await readJsonBody(req, 8 * 1024);
      const token = typeof body.token === "string" ? body.token : "";

      if (!(await validateRemoteLoginToken(token))) {
        sendError(res, 401, "Invalid or expired remote login token.");
        return;
      }

      setRemoteLoginCookie(req, res, token, state.expiresAt);
      sendJson(res, 200, {
        ok: true,
        expiresAt: state.expiresAt,
        bandwidthKbps: state.bandwidthKbps,
      });
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

    const goMatch = req.method === "GET" && url.pathname.match(/^\/go\/([a-z0-9-]+)$/);
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
          sendError(res, 503, error.message);
          return;
        }

        if (error?.code === "EPORTAL_HANDOFF_UNAVAILABLE") {
          sendError(res, 502, error.message);
          return;
        }

        if (error?.code === "EPORTAL_PROFILE_BUSY") {
          sendError(
            res,
            409,
            "Server ePortal profile is busy, likely because remote login is in progress.",
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
      (url.pathname === "/remote-login" || url.pathname === "/remote-login/")
    ) {
      await serveStatic(res, "/remote-login.html");
      return;
    }

    if (url.pathname.startsWith("/remote-login/xpra")) {
      await proxyRemoteLoginHttp(req, res, url);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error("Request failed:", error?.message || error);
    if (!res.headersSent) {
      sendError(res, error?.statusCode || 500, error?.statusCode ? error.message : "Internal server error.");
    } else {
      res.end();
    }
  }
});

server.on("upgrade", (req, socket, head) => {
  void proxyRemoteLoginUpgrade(req, socket, head).catch(() => {
    writeUpgradeError(socket, "500 Internal Server Error", "Remote login proxy failed.");
  });
});

await preferenceStore.init();
const keepalive = startPortalKeepalive({ intervalMinutes: keepaliveMinutes });

server.listen(port, host, () => {
  console.log(`NUTC Portal: http://${host}:${port}`);
  console.log("Dashboard authentication: delegated to Cloudflare Access.");
  console.log("Server ePortal session: persistent Playwright profile at .eportal-profile/");
  console.log("Client ePortal session: optional userscript/browser convenience path.");
  console.log(
    nativeRelayOrigin
      ? `Native ePortal login relay: ${nativeRelayOrigin.origin}`
      : "Native ePortal login relay: disabled (set EPORTAL_RELAY_ORIGIN).",
  );
  console.log(
    keepalive.enabled
      ? `ePortal keepalive: every ${keepalive.intervalMinutes} minute(s).`
      : "ePortal keepalive: disabled.",
  );
});
