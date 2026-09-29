import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

export const REMOTE_LOGIN_STATE_FILE = path.join(
  ROOT,
  "data",
  "remote-login.json",
);
export const REMOTE_LOGIN_COOKIE = "nutc_remote_login";

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function safeEqualHex(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex"),
  );
}

export async function createRemoteLoginState({
  port = 14500,
  display = ":100",
  ttlMinutes = 30,
  bandwidthKbps = 512,
} = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const startedAt = new Date();
  const expiresAt = new Date(
    startedAt.getTime() + Math.max(5, Number(ttlMinutes) || 30) * 60_000,
  );

  const state = {
    version: 1,
    pid: process.pid,
    port: Number(port),
    display,
    bandwidthKbps: Math.max(128, Number(bandwidthKbps) || 512),
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    tokenHash: hashToken(token),
  };

  await fs.mkdir(path.dirname(REMOTE_LOGIN_STATE_FILE), {
    recursive: true,
    mode: 0o700,
  });
  await fs.writeFile(
    REMOTE_LOGIN_STATE_FILE,
    JSON.stringify(state, null, 2) + "\n",
    { mode: 0o600 },
  );

  return { token, state };
}

export async function readRemoteLoginState() {
  try {
    const raw = await fs.readFile(REMOTE_LOGIN_STATE_FILE, "utf8");
    const state = JSON.parse(raw);
    const expiresAt = Date.parse(state?.expiresAt || "");

    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      await fs.unlink(REMOTE_LOGIN_STATE_FILE).catch(() => {});
      return null;
    }

    return state;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

export async function clearRemoteLoginState() {
  await fs.unlink(REMOTE_LOGIN_STATE_FILE).catch(() => {});
}

export function parseCookieHeader(header) {
  const cookies = new Map();

  for (const part of String(header || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }

  return cookies;
}

export async function validateRemoteLoginToken(token) {
  const state = await readRemoteLoginState();
  if (!state || !token) return false;

  return safeEqualHex(hashToken(token), state.tokenHash);
}

export async function isRemoteLoginRequestAuthorized(req) {
  const token = parseCookieHeader(req.headers.cookie).get(REMOTE_LOGIN_COOKIE);
  return validateRemoteLoginToken(token);
}

export async function isPortListening(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port: Number(port),
    });

    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function getRemoteLoginStatus({ authorized = false } = {}) {
  const state = await readRemoteLoginState();

  if (!state) {
    return {
      active: false,
      authorized: false,
    };
  }

  const active = await isPortListening(state.port);

  return {
    active,
    authorized: Boolean(active && authorized),
    startedAt: state.startedAt,
    expiresAt: state.expiresAt,
    bandwidthKbps: state.bandwidthKbps,
  };
}
