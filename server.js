import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { EPORTAL_ORIGIN, moduleUrl, publicModules } from "./src/eportal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const serverStartedAt = Date.now();

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

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
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
    if (req.method === "GET" && url.pathname === "/api/server/status") {
      sendJson(res, 200, {
        startedAt: serverStartedAt,
        platform: process.platform,
        arch: process.arch,
        authMode: "cloudflare-access",
        eportalSessionMode: "client-browser",
        eportalOrigin: EPORTAL_ORIGIN,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/modules") {
      sendJson(res, 200, { modules: publicModules() });
      return;
    }

    const goMatch = req.method === "GET" && url.pathname.match(/^\/go\/([a-z0-9-]+)$/);
    if (goMatch) {
      try {
        redirect(res, moduleUrl(goMatch[1]));
      } catch {
        sendError(res, 404, "Unknown ePortal module.");
      }
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendError(res, 404, "API route not found.");
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error("Request failed:", error?.message || error);
    if (!res.headersSent) sendError(res, 500, "Internal server error.");
    else res.end();
  }
});

server.listen(port, host, () => {
  console.log(`NUTC Portal: http://${host}:${port}`);
  console.log("Dashboard authentication: delegated to Cloudflare Access.");
  console.log("ePortal session: owned by the user's browser.");
});
