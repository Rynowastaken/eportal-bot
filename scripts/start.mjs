#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const checkOnly = process.argv.includes("--check");
const platform = process.platform;
const arch = process.arch;
const env = { ...process.env };
const children = [];

function commandExists(command) {
  const lookup = platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { stdio: "ignore" });
  return result.status === 0;
}

function executableExists(value) {
  if (!value) return null;
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}

function firstNoVncRoot() {
  const candidates = [
    env.PORTAL_NOVNC_WEB,
    "/usr/share/novnc",
    "/usr/share/noVNC",
    "/usr/local/share/novnc",
    "/usr/local/share/noVNC",
  ].filter(Boolean);

  return (
    candidates.find((candidate) => {
      try {
        return fs.statSync(path.join(candidate, "vnc.html")).isFile();
      } catch {
        return false;
      }
    }) || null
  );
}

function printReport(report) {
  console.log("NUTC Portal runtime check");
  console.log(`  platform: ${report.platform} (${report.arch})`);
  console.log(`  node: ${process.version}`);
  console.log(`  display: ${report.display || "none"}`);
  console.log(`  login UI: ${report.loginMode}`);
  console.log(`  external noVNC: ${report.externalNoVnc ? "configured" : "not configured"}`);
  console.log(`  Xvfb: ${report.commands.Xvfb ? "yes" : "no"}`);
  console.log(`  x11vnc: ${report.commands.x11vnc ? "yes" : "no"}`);
  console.log(`  websockify: ${report.commands.websockify ? "yes" : "no"}`);
  console.log(`  noVNC web root: ${report.noVncWeb || "not found"}`);
  if (report.chromiumOverride) {
    console.log(
      `  PORTAL_CHROMIUM: ${report.chromiumOverride} (${
        report.chromiumOverrideExists ? "found" : "not found"
      })`,
    );
  } else {
    console.log("  Chromium: Playwright-managed browser");
  }

  for (const warning of report.warnings) console.warn(`  warning: ${warning}`);
  for (const error of report.errors) console.error(`  error: ${error}`);
}

function inspectRuntime() {
  const requestedMode = String(env.PORTAL_LOGIN_MODE || "auto").toLowerCase();
  const validModes = new Set(["auto", "novnc", "host"]);
  const errors = [];
  const warnings = [];

  if (!validModes.has(requestedMode)) {
    errors.push("PORTAL_LOGIN_MODE must be auto, novnc, or host.");
  }

  const commands = {
    Xvfb: commandExists("Xvfb"),
    x11vnc: commandExists("x11vnc"),
    websockify: commandExists("websockify"),
  };

  const chromiumOverride = String(env.PORTAL_CHROMIUM || "").trim() || null;
  const chromiumOverrideExists = executableExists(chromiumOverride);
  if (chromiumOverride && !chromiumOverrideExists) {
    errors.push("PORTAL_CHROMIUM points to a file that does not exist.");
  }

  const externalNoVnc = Boolean(String(env.PORTAL_NOVNC_TARGET || "").trim());
  const noVncWeb = firstNoVncRoot();
  const hasDisplay = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  const linuxCanCreateDisplay = platform === "linux" && commands.Xvfb;
  const linuxCanCreateNoVnc =
    platform === "linux" && commands.x11vnc && commands.websockify && Boolean(noVncWeb);

  let loginMode = requestedMode;
  if (requestedMode === "auto") {
    if (externalNoVnc || linuxCanCreateNoVnc) loginMode = "novnc";
    else loginMode = "host";
  }

  if (loginMode === "novnc" && !externalNoVnc && !linuxCanCreateNoVnc) {
    errors.push(
      "noVNC mode was requested, but no external PORTAL_NOVNC_TARGET or usable local VNC/noVNC stack was found.",
    );
  }

  if (platform === "linux" && !hasDisplay && !linuxCanCreateDisplay) {
    errors.push(
      "No graphical display was detected and Xvfb is unavailable. Provide DISPLAY/WAYLAND_DISPLAY or install an X virtual display.",
    );
  }

  if ((platform === "darwin" || platform === "win32") && loginMode === "novnc" && !externalNoVnc) {
    errors.push(
      "On macOS/Windows, embedded noVNC requires PORTAL_NOVNC_TARGET pointing to your VNC/noVNC bridge.",
    );
  }

  if (loginMode === "host" && !hasDisplay && platform === "linux" && linuxCanCreateDisplay) {
    warnings.push(
      "Host login mode will use an Xvfb display; without noVNC you must attach another viewer to interact with Chromium.",
    );
  }

  if (loginMode === "host" && platform !== "linux") {
    warnings.push(
      "ePortal login will open on this machine's desktop. Set PORTAL_NOVNC_TARGET for an embedded remote login UI.",
    );
  }

  return {
    platform,
    arch,
    requestedMode,
    loginMode,
    commands,
    chromiumOverride,
    chromiumOverrideExists,
    externalNoVnc,
    noVncWeb,
    hasDisplay,
    linuxCanCreateDisplay,
    linuxCanCreateNoVnc,
    display: env.DISPLAY || env.WAYLAND_DISPLAY || null,
    warnings,
    errors,
  };
}

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: options.stdio || "inherit",
    windowsHide: false,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`${command} failed: ${error.message}`);
  });
  return child;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startLinuxDisplay(report) {
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return;

  const display = String(env.PORTAL_DISPLAY || ":99");
  console.log(`Starting Xvfb on ${display}…`);
  spawnChild("Xvfb", [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-ac"], {
    stdio: "ignore",
  });
  env.DISPLAY = display;
  await sleep(450);
}

async function startLinuxNoVnc(report) {
  if (report.externalNoVnc) return;

  const vncPort = String(env.PORTAL_VNC_PORT || "5900");
  const noVncPort = String(env.PORTAL_NOVNC_PORT || "6080");
  const display = env.DISPLAY;

  console.log(`Starting x11vnc for ${display}…`);
  spawnChild(
    "x11vnc",
    [
      "-display",
      display,
      "-localhost",
      "-forever",
      "-shared",
      "-nopw",
      "-rfbport",
      vncPort,
      "-quiet",
    ],
    { stdio: "ignore" },
  );

  await sleep(250);

  console.log(`Starting noVNC/websockify on 127.0.0.1:${noVncPort}…`);
  spawnChild(
    "websockify",
    [
      `--web=${report.noVncWeb}`,
      `127.0.0.1:${noVncPort}`,
      `127.0.0.1:${vncPort}`,
    ],
    { stdio: "ignore" },
  );

  env.PORTAL_NOVNC_TARGET = `http://127.0.0.1:${noVncPort}`;
  await sleep(250);
}

async function cleanup() {
  for (const child of children.reverse()) {
    if (!child.killed) child.kill(platform === "win32" ? undefined : "SIGTERM");
  }
}

const report = inspectRuntime();
printReport(report);

if (report.errors.length) process.exit(1);
if (checkOnly) process.exit(0);

if (platform === "linux") {
  await startLinuxDisplay(report);
  if (report.loginMode === "novnc") await startLinuxNoVnc(report);
}

env.PORTAL_LOGIN_MODE = report.loginMode;

if (report.loginMode === "novnc" && !env.PORTAL_NOVNC_TARGET) {
  console.error("noVNC mode selected without a PORTAL_NOVNC_TARGET.");
  await cleanup();
  process.exit(1);
}

console.log(`Starting NUTC Portal in ${report.loginMode} login mode…`);
const server = spawnChild(process.execPath, ["server.js"]);

const shutdown = async () => {
  await cleanup();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.on("exit", async (code, signal) => {
  await cleanup();
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
