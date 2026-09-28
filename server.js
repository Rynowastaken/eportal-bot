import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import httpProxy from "http-proxy";
import { PortalBrowserSession } from "./src/browser-session.js";
import { publicModules } from "./src/eportal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const serverStartedAt = Date.now();
const browserSession = new PortalBrowserSession();

const noVncProxy = httpProxy.createProxyServer({
  target: "http://127.0.0.1:6080",
  ws: true,
});

noVncProxy.on("error", (error, req, resOrSocket) => {
  console.error("noVNC proxy error:", error.message);
  if (resOrSocket?.writeHead) {
    sendError(resOrSocket, 502, "noVNC is not available.");
  } else {
    resOrSocket?.destroy?.();
  }
});

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

function sendHtml(res, status, html) {
  const payload = Buffer.from(html);
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(payload);
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function autoSubmitForm(launch) {
  const fields = (launch.fields || [])
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("");

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <title>正在開啟校務系統…</title>
</head>
<body>
  <p>正在完成官方 SSO…</p>
  <form id="sso" method="post" action="${escapeHtml(launch.url)}">
    ${fields}
  </form>
  <script>document.getElementById("sso").submit();</script>
</body>
</html>`;
}

function contentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

async function parseJsonBody(req, limit = 64_000) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertSameSiteMutation(req) {
  const site = String(req.headers["sec-fetch-site"] || "");
  if (site && !["same-origin", "same-site", "none"].includes(site)) {
    const error = new Error("Cross-site mutation blocked.");
    error.status = 403;
    throw error;
  }

  const type = String(req.headers["content-type"] || "");
  if (req.method === "POST" && !type.startsWith("application/json")) {
    const error = new Error("JSON request required.");
    error.status = 415;
    throw error;
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
        "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(body);
  } catch {
    sendError(res, 404, "Not found.");
  }
}

function proxyNoVncHttp(req, res) {
  req.url = req.url.slice("/novnc".length) || "/";
  noVncProxy.web(req, res);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/server/status") {
    sendJson(res, 200, {
      startedAt: serverStartedAt,
      authMode: "cloudflare-access",
      eportalSessionMode: "persistent-playwright-novnc",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/modules") {
    sendJson(res, 200, { modules: publicModules() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/browser/status") {
    sendJson(res, 200, await browserSession.status());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/browser/open") {
    assertSameSiteMutation(req);
    await parseJsonBody(req);
    sendJson(res, 200, await browserSession.openLogin());
    return;
  }

  sendError(res, 404, "API route not found.");
}

async function handleModuleLaunch(res, moduleId) {
  try {
    const launch = await browserSession.captureModuleLaunch(moduleId);

    if (launch.kind === "url") {
      redirect(res, launch.url);
      return;
    }

    if (launch.kind === "form") {
      sendHtml(res, 200, autoSubmitForm(launch));
      return;
    }

    sendHtml(res, 502, "<!doctype html><meta charset=utf-8><p>無法辨識 ePortal SSO 格式。</p>");
  } catch (error) {
    const message = String(error?.message || "Unable to launch module.");
    const loginRequired = /login is required/i.test(message);

    sendHtml(
      res,
      loginRequired ? 409 : 502,
      `<!doctype html>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<title>無法開啟校務系統</title>
<body style="font-family:system-ui;background:#141018;color:#f7f1f6;padding:2rem">
  <h1 style="font-size:1.3rem">無法開啟校務系統</h1>
  <p style="color:#c7bdc7">${escapeHtml(
    loginRequired
      ? "請回到 NUTC Portal，開啟整合式 ePortal 登入並先完成官方登入。"
      : message,
  )}</p>
</body>`,
    );
  }
}

await browserSession.init();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/novnc/") || url.pathname === "/novnc") {
      proxyNoVncHttp(req, res);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    const goMatch = req.method === "GET" && url.pathname.match(/^\/go\/([a-z0-9-]+)$/);
    if (goMatch) {
      await handleModuleLaunch(res, goMatch[1]);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error("Request failed:", error?.message || error);
    if (!res.headersSent) {
      sendError(res, Number(error?.status) || 500, error?.message || "Internal server error.");
    } else {
      res.end();
    }
  }
});

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (!url.pathname.startsWith("/novnc/")) {
      socket.destroy();
      return;
    }

    req.url = req.url.slice("/novnc".length) || "/";
    noVncProxy.ws(req, socket, head);
  } catch {
    socket.destroy();
  }
});

server.listen(port, host, () => {
  console.log(`NUTC Portal: http://${host}:${port}`);
  console.log("Dashboard authentication: delegated to Cloudflare Access.");
  console.log("ePortal session: one headed persistent Playwright Chromium profile.");
  console.log("Remote login UI: noVNC proxied at /novnc/.");
});

async function shutdown() {
  await browserSession.close().catch(() => {});
  noVncProxy.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
