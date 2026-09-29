import crypto from "node:crypto";
import { EPORTAL_ORIGIN } from "./eportal.js";
import { openPortalRelaySession } from "./portal-session.js";

const RELAY_COOKIE = "nutc_native_login";
let active = null;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function safeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function cookies(header) {
  const out = new Map();
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    try { out.set(name, decodeURIComponent(raw)); } catch { out.set(name, raw); }
  }
  return out;
}

function esc(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function validReturnUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function htmlPage(title, body) {
  return [
    "<!doctype html>",
    '<html lang="zh-Hant"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    "<title>" + esc(title) + "</title>",
    "<style>",
    ':root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    "body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#100d13;color:#f7f1f6}",
    "main{width:min(92vw,34rem);padding:1.2rem;border:1px solid #ffffff22;border-radius:16px;background:#19141dcc}",
    "h1{font-size:1.25rem;margin:0 0 .6rem}p{color:#f7f1f6aa;line-height:1.6}",
    "a{display:inline-flex;min-height:44px;align-items:center;margin-top:.5rem;padding:.55rem .8rem;border-radius:11px;color:#21151d;background:#f0a8c8;text-decoration:none;font-weight:700}",
    ".bad{color:#f07178}",
    "</style></head><body><main>",
    body,
    "</main></body></html>",
  ].join("\n");
}

function bootstrapHtml() {
  return htmlPage(
    "NUTC ePortal Login Relay",
    [
      "<h1>正在建立 ePortal Login Relay</h1>",
      '<p id="status">正在驗證這次短效登入連線…</p>',
      "<script>",
      "(async()=>{",
      'const s=document.querySelector("#status");',
      'const p=new URLSearchParams(location.hash.replace(/^#/,""));',
      'const t=p.get("token");history.replaceState(null,"","/");',
      'if(!t){s.className="bad";s.textContent="缺少短效登入 token。請從 Dashboard 重新啟動。";return;}',
      'try{const r=await fetch("/__relay/authorize",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({token:t})});',
      'if(!r.ok)throw new Error();location.replace("/login_main.php");}',
      'catch{s.className="bad";s.textContent="登入 relay token 無效或已過期。請回 Dashboard 重新啟動。";}',
      "})();",
      "</script>",
    ].join("\n"),
  );
}

function successHtml(returnUrl) {
  const link = returnUrl
    ? '<a href="' + esc(returnUrl) + '">回到 NUTC Portal Dashboard</a>'
    : "";
  return htmlPage(
    "ePortal Login Complete",
    "<h1>Server ePortal 已重新登入</h1>" +
      "<p>新的 session 已保存在 Server 的 <code>.eportal-profile/</code>。這個 login relay 已關閉。</p>" +
      link,
  );
}

function inactiveHtml() {
  return htmlPage(
    "Login Relay Inactive",
    "<h1>Login Relay 尚未啟動</h1><p>請從受 Cloudflare Access 保護的 Dashboard 啟動 Server ePortal Login。</p>",
  );
}

function sendHtml(res, status, html) {
  const body = Buffer.from(html);
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      const error = new Error("Relay request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function forwardHeaders(req, target, relayOrigin) {
  const headers = {};
  for (const name of ["accept", "accept-language", "content-type", "user-agent", "x-requested-with"]) {
    if (req.headers[name] !== undefined) headers[name] = req.headers[name];
  }

  if (req.headers.origin) headers.Origin = EPORTAL_ORIGIN;

  if (req.headers.referer) {
    try {
      const ref = new URL(req.headers.referer);
      if (ref.origin === relayOrigin.origin) {
        headers.Referer = new URL(ref.pathname + ref.search, EPORTAL_ORIGIN).toString();
      }
    } catch {}
  }

  headers.Host = target.host;
  return headers;
}

function rewriteText(text, relayOrigin) {
  return text
    .replaceAll(EPORTAL_ORIGIN, relayOrigin.origin)
    .replaceAll("//eportal.nutc.edu.tw", "//" + relayOrigin.host);
}

function textResponse(contentType) {
  const type = String(contentType || "").toLowerCase();
  return type.startsWith("text/") ||
    type.includes("javascript") ||
    type.includes("json") ||
    type.includes("xml") ||
    type.includes("svg");
}

function targetUrl(url) {
  return new URL(url.pathname + url.search, EPORTAL_ORIGIN);
}

function relayRedirect(location, current, relayOrigin) {
  const next = new URL(location, current);
  if (next.origin !== EPORTAL_ORIGIN) return null;
  return new URL(next.pathname + next.search + next.hash, relayOrigin);
}

function authorized(req) {
  if (!active?.cookieHash) return false;
  const value = cookies(req.headers.cookie).get(RELAY_COOKIE);
  return safeEqual(sha256(value), active.cookieHash);
}

async function closeActive() {
  if (!active) return;
  const session = active;
  active = null;
  if (session.timer) clearTimeout(session.timer);
  await session.portal.close().catch(() => {});
}

export async function startNativeLoginRelay({ relayOrigin, returnUrl = "", ttlMinutes = 15 } = {}) {
  if (!(relayOrigin instanceof URL) || relayOrigin.protocol !== "https:") {
    const error = new Error("EPORTAL_RELAY_ORIGIN must be a dedicated HTTPS origin.");
    error.code = "EPORTAL_RELAY_NOT_CONFIGURED";
    throw error;
  }

  await closeActive();

  const portal = await openPortalRelaySession({ timeoutMs: 5_000 });
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + Math.max(5, Number(ttlMinutes) || 15) * 60_000);

  active = {
    portal,
    relayOrigin,
    returnUrl: validReturnUrl(returnUrl),
    tokenHash: sha256(token),
    cookieHash: null,
    expiresAt: expires.toISOString(),
    timer: null,
  };

  active.timer = setTimeout(() => { void closeActive(); }, expires.getTime() - Date.now());
  active.timer.unref?.();

  return {
    active: true,
    expiresAt: active.expiresAt,
    launchUrl: relayOrigin.origin + "/#token=" + encodeURIComponent(token),
  };
}

export function getNativeLoginRelayStatus(configured = true) {
  return {
    configured,
    active: Boolean(active),
    expiresAt: active?.expiresAt || null,
  };
}

async function authorize(req, res) {
  if (!active) return sendJson(res, 503, { error: "Login relay is not active." });

  let data;
  try {
    data = JSON.parse((await readBody(req, 16 * 1024)).toString("utf8") || "{}");
  } catch {
    return sendJson(res, 400, { error: "Invalid authorization request." });
  }

  if (!active.tokenHash || !safeEqual(sha256(data.token), active.tokenHash)) {
    return sendJson(res, 401, { error: "Invalid or expired login relay token." });
  }

  active.tokenHash = null;
  const cookie = crypto.randomBytes(32).toString("base64url");
  active.cookieHash = sha256(cookie);
  const maxAge = Math.max(0, Math.floor((Date.parse(active.expiresAt) - Date.now()) / 1000));

  res.setHeader(
    "Set-Cookie",
    RELAY_COOKIE + "=" + encodeURIComponent(cookie) + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge,
  );
  sendJson(res, 200, { ok: true, expiresAt: active.expiresAt });
}

async function proxy(req, res, url) {
  if (!active) return sendHtml(res, 503, inactiveHtml());
  if (!authorized(req)) return sendHtml(res, 401, bootstrapHtml());

  const target = targetUrl(url);
  if (target.pathname.startsWith("/nutc_dashboard/")) {
    const back = active.returnUrl;
    await closeActive();
    return sendHtml(res, 200, successHtml(back));
  }

  const requestBody =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : await readBody(req);

  const response = await active.portal.request.fetch(target.toString(), {
    method: req.method,
    headers: forwardHeaders(req, target, active.relayOrigin),
    data: requestBody,
    maxRedirects: 0,
    failOnStatusCode: false,
    timeout: 30_000,
  });

  const status = response.status();
  const upstream = response.headers();
  const location = upstream.location;

  if (location && [301, 302, 303, 307, 308].includes(status)) {
    const next = relayRedirect(location, target, active.relayOrigin);
    if (!next) {
      return sendJson(res, 502, {
        error: "Login relay blocked an external redirect. Use the Xpra fallback for this login flow.",
      });
    }

    if (next.pathname.startsWith("/nutc_dashboard/")) {
      const back = active.returnUrl;
      await closeActive();
      return sendHtml(res, 200, successHtml(back));
    }

    res.writeHead(status, {
      Location: next.toString(),
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
    });
    res.end();
    return;
  }

  let body = await response.body();
  const contentType = upstream["content-type"] || "application/octet-stream";

  if (textResponse(contentType)) {
    body = Buffer.from(rewriteText(body.toString("utf8"), active.relayOrigin));
  }

  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });

  if (req.method === "HEAD") res.end();
  else res.end(body);
}

export async function handleNativeLoginRelayRequest(req, res, url, relayOrigin) {
  if (!active) return sendHtml(res, 503, inactiveHtml());
  if (active.relayOrigin.origin !== relayOrigin.origin) {
    return sendJson(res, 421, { error: "Wrong login relay origin." });
  }

  if (req.method === "POST" && url.pathname === "/__relay/authorize") {
    return authorize(req, res);
  }

  if (req.method === "GET" && url.pathname === "/__relay/status") {
    return sendJson(res, 200, {
      active: true,
      authorized: authorized(req),
      expiresAt: active.expiresAt,
    });
  }

  if (req.method === "GET" && url.pathname === "/" && !authorized(req)) {
    return sendHtml(res, 200, bootstrapHtml());
  }

  if (req.method === "GET" && url.pathname === "/" && authorized(req)) {
    res.writeHead(302, {
      Location: relayOrigin.origin + "/login_main.php",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  return proxy(req, res, url);
}

export async function stopNativeLoginRelay() {
  await closeActive();
}
