import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";

const ACTIVITY_HOST = "vote.nutc.edu.tw";
const ACTIVITY_IP = "163.17.131.167";
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_REQUEST_BODY = 4 * 1024 * 1024;
const MAX_RESPONSE_BODY = 16 * 1024 * 1024;
const ACTIVITY_PROXY_URL = String(
  process.env.NUTC_ACTIVITY_PROXY || "",
).trim();
const ACTIVITY_PROXY_USER = String(
  process.env.NUTC_ACTIVITY_PROXY_USER || "",
);
const ACTIVITY_PROXY_PASSWORD = String(
  process.env.NUTC_ACTIVITY_PROXY_PASSWORD || "",
);

const sessions = new Map();

function relayError(message, code = "ACTIVITY_RELAY_UNAVAILABLE") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeLabel(raw) {
  try {
    const url = raw instanceof URL ? raw : new URL(raw);
    const path = url.pathname.startsWith("/ssoLoginV2/")
      ? "/ssoLoginV2/[redacted]"
      : url.pathname;
    return `${url.hostname}${path}`;
  } catch {
    return "invalid-url";
  }
}

function allowedTarget(raw) {
  const url = raw instanceof URL ? new URL(raw) : new URL(raw);

  if (url.hostname === ACTIVITY_HOST && url.protocol === "https:") {
    return url;
  }

  if (url.hostname === ACTIVITY_IP && url.protocol === "http:") {
    return url;
  }

  throw relayError(
    `Activity relay refused unsupported upstream ${url.protocol}//${url.hostname}.`,
  );
}

function defaultCookiePath(pathname) {
  const path = pathname || "/";
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash + 1);
}

function parseSetCookie(line, target) {
  const parts = String(line || "").split(";").map((part) => part.trim());
  const pair = parts.shift() || "";
  const index = pair.indexOf("=");
  if (index <= 0) return null;

  const cookie = {
    name: pair.slice(0, index),
    value: pair.slice(index + 1),
    domain: target.hostname,
    hostOnly: true,
    path: defaultCookiePath(target.pathname),
    secure: false,
    expiresAt: null,
  };

  for (const part of parts) {
    const eq = part.indexOf("=");
    const key = (eq >= 0 ? part.slice(0, eq) : part).trim().toLowerCase();
    const value = eq >= 0 ? part.slice(eq + 1).trim() : "";

    if (key === "domain" && value) {
      cookie.domain = value.replace(/^\./, "").toLowerCase();
      cookie.hostOnly = false;
    } else if (key === "path" && value.startsWith("/")) {
      cookie.path = value;
    } else if (key === "secure") {
      cookie.secure = true;
    } else if (key === "max-age") {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) {
        cookie.expiresAt = Date.now() + seconds * 1000;
      }
    } else if (key === "expires") {
      const expires = Date.parse(value);
      if (Number.isFinite(expires)) cookie.expiresAt = expires;
    }
  }

  return cookie;
}

function cookieMatches(cookie, target) {
  if (cookie.expiresAt && cookie.expiresAt <= Date.now()) return false;
  if (cookie.secure && target.protocol !== "https:") return false;
  if (!target.pathname.startsWith(cookie.path || "/")) return false;

  const host = target.hostname.toLowerCase();
  const domain = cookie.domain.toLowerCase();

  return cookie.hostOnly
    ? host === domain
    : host === domain || host.endsWith(`.${domain}`);
}

function storeResponseCookies(session, target, headers) {
  const setCookies = headers["set-cookie"] || [];

  for (const line of Array.isArray(setCookies) ? setCookies : [setCookies]) {
    const cookie = parseSetCookie(line, target);
    if (!cookie) continue;

    const key = `${cookie.name}\n${cookie.domain}\n${cookie.path}`;

    if (
      (cookie.expiresAt && cookie.expiresAt <= Date.now()) ||
      cookie.value === ""
    ) {
      session.cookies.delete(key);
      continue;
    }

    session.cookies.set(key, cookie);
  }
}

function cookieHeader(session, target) {
  const pairs = [];

  for (const [key, cookie] of session.cookies) {
    if (cookie.expiresAt && cookie.expiresAt <= Date.now()) {
      session.cookies.delete(key);
      continue;
    }

    if (cookieMatches(cookie, target)) {
      pairs.push(`${cookie.name}=${cookie.value}`);
    }
  }

  return pairs.join("; ");
}

function activityProxy() {
  if (!ACTIVITY_PROXY_URL) return null;

  let proxy;
  try {
    proxy = new URL(ACTIVITY_PROXY_URL);
  } catch {
    throw relayError(
      "NUTC_ACTIVITY_PROXY must be a valid http:// proxy URL.",
      "ACTIVITY_PROXY_CONFIG_INVALID",
    );
  }

  if (proxy.protocol !== "http:") {
    throw relayError(
      "NUTC_ACTIVITY_PROXY currently supports only an http:// CONNECT proxy.",
      "ACTIVITY_PROXY_CONFIG_INVALID",
    );
  }

  const username =
    ACTIVITY_PROXY_USER ||
    (proxy.username ? decodeURIComponent(proxy.username) : "");
  const password =
    ACTIVITY_PROXY_PASSWORD ||
    (proxy.password ? decodeURIComponent(proxy.password) : "");

  proxy.username = "";
  proxy.password = "";

  return {
    hostname: proxy.hostname,
    port: Number(proxy.port || 80),
    username,
    password,
  };
}

function openHttpsProxyTunnel(target, timeout) {
  const proxy = activityProxy();
  if (!proxy) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const headers = {
      Host: `${target.hostname}:443`,
      Connection: "close",
    };

    if (proxy.username || proxy.password) {
      headers["Proxy-Authorization"] =
        "Basic " +
        Buffer.from(
          `${proxy.username}:${proxy.password}`,
          "utf8",
        ).toString("base64");
    }

    const connect = http.request({
      hostname: proxy.hostname,
      port: proxy.port,
      method: "CONNECT",
      path: `${target.hostname}:443`,
      headers,
    });

    connect.setTimeout(timeout, () => {
      connect.destroy(
        relayError("Activity proxy CONNECT timed out."),
      );
    });

    connect.once("connect", (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();

        const code =
          response.statusCode === 407
            ? "ACTIVITY_PROXY_AUTH_REQUIRED"
            : "ACTIVITY_PROXY_CONNECT_FAILED";

        reject(
          relayError(
            `Activity proxy CONNECT failed with HTTP ${response.statusCode || 0}.`,
            code,
          ),
        );
        return;
      }

      if (head?.length) socket.unshift(head);

      const secureSocket = tls.connect({
        socket,
        servername: target.hostname,
      });

      secureSocket.setTimeout(timeout, () => {
        secureSocket.destroy(
          relayError("Activity proxy TLS tunnel timed out."),
        );
      });

      secureSocket.once("secureConnect", () => {
        secureSocket.setTimeout(0);
        resolve(secureSocket);
      });

      secureSocket.once("error", (error) => {
        reject(
          relayError(
            `Activity proxy TLS tunnel failed (${error.code || error.message}).`,
            "ACTIVITY_PROXY_TLS_FAILED",
          ),
        );
      });
    });

    connect.once("error", (error) => {
      reject(
        error?.code?.startsWith?.("ACTIVITY_")
          ? error
          : relayError(
              `Activity proxy could not be reached (${error.code || error.message}).`,
              "ACTIVITY_PROXY_UNREACHABLE",
            ),
      );
    });

    connect.end();
  });
}

function connectionFor(target) {
  if (target.hostname === ACTIVITY_HOST) {
    return {
      client: https,
      // Do not assume vote.nutc.edu.tw is served by the legacy verify IP.
      // Let the Raspberry Pi resolver choose the current address for the
      // HTTPS service while preserving normal TLS SNI / Host validation.
      hostname: ACTIVITY_HOST,
      port: 443,
      servername: ACTIVITY_HOST,
      hostHeader: ACTIVITY_HOST,
    };
  }

  if (target.hostname === ACTIVITY_IP && target.protocol === "http:") {
    return {
      client: http,
      hostname: ACTIVITY_IP,
      port: 80,
      servername: undefined,
      hostHeader: ACTIVITY_IP,
    };
  }

  throw relayError("Activity relay target is not allowlisted.");
}

async function requestOnce(
  session,
  rawUrl,
  {
    method = "GET",
    headers = {},
    body = null,
    timeout = 15_000,
  } = {},
) {
  const target = allowedTarget(rawUrl);
  const connection = connectionFor(target);
  const cookies = cookieHeader(session, target);
  const tunnelSocket =
    target.hostname === ACTIVITY_HOST
      ? await openHttpsProxyTunnel(target, timeout)
      : null;

  return new Promise((resolve, reject) => {
    const requestHeaders = {
      ...headers,
      Host: connection.hostHeader,
      ...(cookies ? { Cookie: cookies } : {}),
      Connection: "close",
    };

    delete requestHeaders.host;
    delete requestHeaders.cookie;
    delete requestHeaders["content-length"];

    if (body?.length) {
      requestHeaders["Content-Length"] = String(body.length);
    }

    const request = connection.client.request(
      {
        protocol: target.protocol,
        hostname: connection.hostname,
        port: connection.port,
        servername: connection.servername,
        ...(tunnelSocket
          ? {
              agent: false,
              createConnection: () => tunnelSocket,
            }
          : {}),
        method,
        path: `${target.pathname}${target.search}`,
        headers: requestHeaders,
      },
      (response) => {
        const chunks = [];
        let size = 0;

        response.on("data", (chunk) => {
          size += chunk.length;

          if (size > MAX_RESPONSE_BODY) {
            request.destroy(
              relayError("Activity relay response exceeded the size limit."),
            );
            return;
          }

          chunks.push(chunk);
        });

        response.on("end", () => {
          storeResponseCookies(session, target, response.headers);

          resolve({
            status: response.statusCode || 502,
            headers: response.headers,
            body: Buffer.concat(chunks),
            url: target,
          });
        });
      },
    );

    request.setTimeout(timeout, () => {
      request.destroy(relayError("Activity relay upstream request timed out."));
    });

    request.on("error", (error) => {
      reject(
        relayError(
          `Activity relay could not reach ${target.hostname}:${connection.port} from the server (${error.code || error.message}).`,
        ),
      );
    });

    if (body?.length) request.write(body);
    request.end();
  });
}

async function followInitialHandoff(session, handoff) {
  if (!handoff || !["get", "post"].includes(handoff.type)) {
    throw relayError("Activity relay received an unsupported SSO handoff.");
  }

  let current = allowedTarget(handoff.url);
  let method = handoff.type === "post" ? "POST" : "GET";
  let body =
    handoff.type === "post"
      ? Buffer.from(new URLSearchParams(handoff.fields || []).toString())
      : null;

  for (let step = 0; step < 12; step += 1) {
    const response = await requestOnce(session, current, {
      method,
      body,
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.location;
    if (!location) return response;

    const next = allowedTarget(new URL(location, current));
    const preserve = response.status === 307 || response.status === 308;

    if (!preserve) {
      method = "GET";
      body = null;
    }

    current = next;
  }

  throw relayError("Activity relay followed too many SSO redirects.");
}

function relayPath(sessionId, rawUrl) {
  const url = allowedTarget(rawUrl);
  return (
    `/activity-relay/${encodeURIComponent(sessionId)}/` +
    `${encodeURIComponent(url.hostname)}${url.pathname}${url.search}${url.hash}`
  );
}

function parseRelayTarget(pathname, search, sessionId) {
  const prefix = `/activity-relay/${encodeURIComponent(sessionId)}/`;

  if (!pathname.startsWith(prefix)) {
    throw relayError("Activity relay session path is invalid.");
  }

  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  const encodedHost = slash >= 0 ? rest.slice(0, slash) : rest;
  const path = slash >= 0 ? rest.slice(slash) : "/";
  const host = decodeURIComponent(encodedHost);

  let origin;
  if (host === ACTIVITY_HOST) origin = `https://${ACTIVITY_HOST}`;
  else if (host === ACTIVITY_IP) origin = `http://${ACTIVITY_IP}`;
  else throw relayError("Activity relay upstream host is not allowlisted.");

  const target = new URL(origin);
  target.pathname = path || "/";
  target.search = search || "";
  return allowedTarget(target);
}

function rootPrefix(sessionId, hostname) {
  return (
    `/activity-relay/${encodeURIComponent(sessionId)}/` +
    `${encodeURIComponent(hostname)}`
  );
}

function rewriteText(text, sessionId, upstreamUrl, contentType) {
  const currentPrefix = rootPrefix(sessionId, upstreamUrl.hostname);
  const votePrefix = rootPrefix(sessionId, ACTIVITY_HOST);
  const ipPrefix = rootPrefix(sessionId, ACTIVITY_IP);

  let output = String(text)
    .replaceAll(`https://${ACTIVITY_HOST}`, votePrefix)
    .replaceAll(`http://${ACTIVITY_IP}`, ipPrefix);

  if (
    contentType.includes("text/html") ||
    contentType.includes("javascript")
  ) {
    output = output
      .replace(
        /(\b(?:href|src|action|formaction|poster)\s*=\s*["'])\/(?!\/)/gi,
        `$1${currentPrefix}/`,
      )
      .replace(
        /(\b(?:fetch|window\.open|location\.assign|location\.replace)\(\s*["'])\/(?!\/)/g,
        `$1${currentPrefix}/`,
      )
      .replace(
        /(\blocation(?:\.href)?\s*=\s*["'])\/(?!\/)/g,
        `$1${currentPrefix}/`,
      )
      .replace(
        /(\burl\s*:\s*["'])\/(?!\/)/g,
        `$1${currentPrefix}/`,
      );
  }

  if (
    contentType.includes("text/css") ||
    contentType.includes("text/html")
  ) {
    output = output.replace(
      /url\(\s*(["']?)\/(?!\/)/gi,
      `url($1${currentPrefix}/`,
    );
  }

  return output;
}

function forwardedHeaders(req, target, sessionId) {
  const headers = {};

  for (const name of [
    "accept",
    "accept-language",
    "content-type",
    "user-agent",
    "x-requested-with",
  ]) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }

  if (req.headers.origin) headers.Origin = target.origin;

  if (req.headers.referer) {
    try {
      const ref = new URL(req.headers.referer);
      const refTarget = parseRelayTarget(
        ref.pathname,
        ref.search,
        sessionId,
      );
      headers.Referer = refTarget.toString();
    } catch {
      headers.Referer = target.origin + "/";
    }
  }

  return headers;
}

async function readRequestBody(req) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method || "GET")) {
    return null;
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;

    if (size > MAX_REQUEST_BODY) {
      throw relayError("Activity relay request body exceeded the size limit.");
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function cleanupExpiredSessions() {
  const now = Date.now();

  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

const cleanupTimer = setInterval(cleanupExpiredSessions, 5 * 60 * 1000);
cleanupTimer.unref?.();

export function clearActivityRelaySessions() {
  sessions.clear();
}

export async function startActivityRelay(handoff) {
  const target = allowedTarget(handoff?.url || "");

  if (target.hostname !== ACTIVITY_HOST) {
    throw relayError(
      "Activity relay expected the official vote.nutc.edu.tw SSO target.",
    );
  }

  const session = {
    id: crypto.randomBytes(24).toString("base64url"),
    cookies: new Map(),
    prefetched: null,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  console.log(
    ACTIVITY_PROXY_URL
      ? "[activity-relay] consuming one-time Activity SSO handoff via configured NUTC proxy"
      : "[activity-relay] consuming one-time Activity SSO handoff on the server",
  );

  const landing = await followInitialHandoff(session, handoff);
  session.prefetched = {
    key: landing.url.toString(),
    response: landing,
  };
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(session.id, session);

  console.log(
    `[activity-relay] session ready at ${safeLabel(landing.url)}`,
  );

  return {
    launchPath: relayPath(session.id, landing.url),
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

export async function proxyActivityRelay(req, res, url) {
  const match = url.pathname.match(
    /^\/activity-relay\/([^/]+)\/([^/]+)(\/.*)?$/,
  );

  if (!match) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Activity relay path not found.");
    return;
  }

  const sessionId = decodeURIComponent(match[1]);
  const session = sessions.get(sessionId);

  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    res.writeHead(410, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("Activity relay session expired. Reopen Activity from the Dashboard.");
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":
        "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
      "Access-Control-Allow-Headers":
        "content-type,x-requested-with,accept",
      "Access-Control-Max-Age": "600",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;

  const target = parseRelayTarget(url.pathname, url.search, sessionId);
  const body = await readRequestBody(req);

  let response;
  if (
    req.method === "GET" &&
    session.prefetched?.key === target.toString()
  ) {
    response = session.prefetched.response;
    session.prefetched = null;
  } else {
    response = await requestOnce(session, target, {
      method: req.method || "GET",
      body,
      headers: forwardedHeaders(req, target, sessionId),
    });
  }

  if (
    [301, 302, 303, 307, 308].includes(response.status) &&
    response.headers.location
  ) {
    let location;

    try {
      const next = new URL(response.headers.location, target);

      if (
        (next.hostname === ACTIVITY_HOST && next.protocol === "https:") ||
        (next.hostname === ACTIVITY_IP && next.protocol === "http:")
      ) {
        location = relayPath(sessionId, next);
      } else if (next.protocol === "https:") {
        location = next.toString();
      } else {
        throw relayError(
          "Activity relay refused a non-HTTPS redirect outside its allowlist.",
        );
      }
    } catch (error) {
      if (error?.code === "ACTIVITY_RELAY_UNAVAILABLE") throw error;
      throw relayError("Activity relay received an invalid redirect.");
    }

    res.writeHead(response.status, {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    res.end();
    return;
  }

  const contentType = String(response.headers["content-type"] || "");
  const isText =
    contentType.includes("text/html") ||
    contentType.includes("text/css") ||
    contentType.includes("javascript") ||
    contentType.includes("application/json") ||
    contentType.startsWith("text/");

  const payload = isText
    ? Buffer.from(
        rewriteText(
          response.body.toString("utf8"),
          sessionId,
          target,
          contentType,
        ),
      )
    : response.body;

  const headers = {
    "Content-Type": contentType || "application/octet-stream",
    "Content-Length": payload.length,
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  };

  if (contentType.includes("text/html")) {
    headers["Content-Security-Policy"] =
      "sandbox allow-forms allow-scripts allow-popups allow-modals allow-downloads; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; connect-src *; form-action *";
  }

  res.writeHead(response.status, headers);
  if (req.method === "HEAD") res.end();
  else res.end(payload);
}
