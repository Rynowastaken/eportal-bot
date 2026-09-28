import crypto from "node:crypto";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureModuleLaunch,
  checkEportalLogin,
  publicModules,
  stateFileExists,
} from "./src/eportal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);

const configuredCode = String(process.env.DASHBOARD_PIN || "").trim();
const dashboardCode = configuredCode || String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const sessionSecret = crypto.randomBytes(32);
const sessions = new Map();
const serverStartedAt = Date.now();

function timingSafeEqualText(a, b) {
  const aa = crypto.createHash("sha256").update(String(a)).digest();
  const bb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(aa, bb);
}

function parseCookies(req) {
  const source = String(req.headers.cookie || "");
  const cookies = {};
  for (const part of source.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function makeSession({ remember = false } = {}) {
  const id = crypto.randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + (remember ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000);
  const signature = crypto.createHmac("sha256", sessionSecret).update(id).digest("base64url");
  sessions.set(id, expiresAt);
  return { token: `${id}.${signature}`, expiresAt };
}

function validSessionToken(token) {
  if (!token || !token.includes(".")) return false;
  const [id, signature] = token.split(".", 2);
  const expected = crypto.createHmac("sha256", sessionSecret).update(id).digest("base64url");
  if (!timingSafeEqualText(signature, expected)) return false;
  const expiresAt = sessions.get(id);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(id);
    return false;
  }
  return true;
}

function isAuthenticated(req) {
  return validSessionToken(parseCookies(req).nutc_portal_session);
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function parseJsonBody(req, limit = 128_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
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

async function serveStatic(req, res, pathname) {
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
    });
    res.end(body);
  } catch {
    sendError(res, 404, "Not found.");
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/server/status") {
    sendJson(res, 200, {
      startedAt: serverStartedAt,
      authenticated: isAuthenticated(req),
      generatedAccessCode: !configuredCode,
      stateExists: await stateFileExists(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await parseJsonBody(req);
    const code = String(body.code || "");
    if (!timingSafeEqualText(code, dashboardCode)) {
      sendError(res, 401, "存取碼錯誤。");
      return;
    }

    const remember = Boolean(body.remember);
    const session = makeSession({ remember });
    const maxAge = remember ? 30 * 24 * 60 * 60 : 12 * 60 * 60;
    sendJson(
      res,
      200,
      { ok: true },
      {
        "Set-Cookie": `nutc_portal_session=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
      },
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const token = parseCookies(req).nutc_portal_session;
    if (token?.includes(".")) sessions.delete(token.split(".", 1)[0]);
    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": "nutc_portal_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    });
    return;
  }

  if (!isAuthenticated(req)) {
    sendError(res, 401, "Dashboard login required.");
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/modules") {
    sendJson(res, 200, { modules: publicModules() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/eportal/status") {
    sendJson(res, 200, {
      stateExists: await stateFileExists(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/eportal/check") {
    const status = await checkEportalLogin();
    sendJson(res, 200, status);
    return;
  }

  const launchMatch = url.pathname.match(/^\/api\/modules\/([a-z0-9-]+)\/launch$/);
  if (req.method === "POST" && launchMatch) {
    try {
      const launch = await captureModuleLaunch(launchMatch[1]);
      sendJson(res, 200, launch);
    } catch (error) {
      const message = String(error?.message || "Unable to launch module.");
      const status = /missing|expired/i.test(message) ? 409 : 502;
      sendError(res, status, message);
    }
    return;
  }

  sendError(res, 404, "API route not found.");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error("Request failed:", error?.message || error);
    if (!res.headersSent) sendError(res, 500, "Internal server error.");
    else res.end();
  }
});

server.listen(port, host, () => {
  console.log(`NUTC Portal: http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  if (configuredCode) {
    console.log("Dashboard access code: using DASHBOARD_PIN from environment.");
  } else {
    console.log(`Dashboard access code: ${dashboardCode}`);
    console.log("Set DASHBOARD_PIN to keep a stable local access code across restarts.");
  }
  console.log("School credentials are never collected by this web app.");
});
