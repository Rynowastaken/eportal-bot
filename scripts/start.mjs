#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const checkOnly = process.argv.includes("--check");
const platform = process.platform;
const arch = process.arch;
const env = { ...process.env };
const children = [];

function commandPath(command) {
  if (!command) return null;

  const hasSeparator = command.includes("/") || command.includes("\\");
  if (hasSeparator) {
    return executableExists(command) ? path.resolve(command) : null;
  }

  const pathEntries = String(env.PATH || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  const extensions =
    platform === "win32"
      ? String(env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];

  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate =
        platform === "win32" && !command.toLowerCase().endsWith(extension.toLowerCase())
          ? path.join(directory, `${command}${extension}`)
          : path.join(directory, command);

      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;

        if (platform === "win32") return candidate;

        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Keep looking through PATH.
      }
    }
  }

  return null;
}

function commandExists(command) {
  return Boolean(commandPath(command));
}

function executableExists(value) {
  if (!value) return null;
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}

function firstExistingFile(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep looking.
    }
  }
  return null;
}

function findSystemChromium() {
  const fromPath =
    platform === "linux"
      ? [
          "chromium",
          "chromium-browser",
          "google-chrome-stable",
          "google-chrome",
          "microsoft-edge-stable",
          "microsoft-edge",
        ]
      : platform === "darwin"
        ? ["chromium", "google-chrome", "microsoft-edge"]
        : ["chrome", "chromium", "msedge"];

  for (const command of fromPath) {
    const resolved = commandPath(command);
    if (resolved && executableExists(resolved)) return resolved;
  }

  if (platform === "darwin") {
    return firstExistingFile([
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      path.join(env.HOME || "", "Applications/Chromium.app/Contents/MacOS/Chromium"),
      path.join(env.HOME || "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ]);
  }

  if (platform === "win32") {
    const programFiles = env.ProgramFiles || env.PROGRAMFILES;
    const programFilesX86 = env["ProgramFiles(x86)"] || env.PROGRAMFILES_X86;
    const localAppData = env.LOCALAPPDATA;

    return firstExistingFile([
      programFiles && path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      programFilesX86 && path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData && path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      programFiles && path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      programFilesX86 && path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      localAppData && path.join(localAppData, "Chromium", "Application", "chrome.exe"),
    ]);
  }

  return null;
}

function detectBrowser() {
  const override = String(env.PORTAL_CHROMIUM || "").trim() || null;
  if (override) {
    return {
      source: "override",
      path: override,
      exists: executableExists(override),
    };
  }

  let managedPath = null;
  try {
    managedPath = chromium.executablePath();
  } catch {
    managedPath = null;
  }

  if (managedPath && executableExists(managedPath)) {
    return {
      source: "playwright",
      path: managedPath,
      exists: true,
    };
  }

  const systemPath = findSystemChromium();
  if (systemPath) {
    return {
      source: "system",
      path: systemPath,
      exists: true,
      missingManagedPath: managedPath,
    };
  }

  return {
    source: "missing",
    path: managedPath,
    exists: false,
  };
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
  if (report.browser.source === "playwright") {
    console.log(`  Chromium: Playwright-managed (${report.browser.path})`);
  } else if (report.browser.source === "system") {
    console.log(`  Chromium: system browser (${report.browser.path})`);
  } else if (report.browser.source === "override") {
    console.log(
      `  Chromium: PORTAL_CHROMIUM=${report.browser.path} (${
        report.browser.exists ? "found" : "not found"
      })`,
    );
  } else {
    console.log("  Chromium: not found");
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

  const browser = detectBrowser();

  if (browser.source === "override" && !browser.exists) {
    errors.push("PORTAL_CHROMIUM points to a file that does not exist.");
  } else if (browser.source === "missing") {
    errors.push(
      "No Chromium browser is available. Run 'npm run install-browser' or set PORTAL_CHROMIUM to an installed Chromium/Chrome/Edge executable.",
    );
  } else if (browser.source === "system" && browser.missingManagedPath) {
    warnings.push(
      "Playwright-managed Chromium is not installed; using the detected system browser instead.",
    );
  }

  const externalNoVnc = Boolean(String(env.PORTAL_NOVNC_TARGET || "").trim());
  const noVncWeb = firstNoVncRoot();
  const hasX11Display = Boolean(env.DISPLAY);
  const hasGraphicalDisplay = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  const linuxCanCreateDisplay = platform === "linux" && commands.Xvfb;
  const linuxHasNoVncTools =
    platform === "linux" && commands.x11vnc && commands.websockify && Boolean(noVncWeb);
  const linuxCanCreateNoVnc =
    linuxHasNoVncTools && (hasX11Display || linuxCanCreateDisplay);

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

  if (platform === "linux" && loginMode === "novnc" && !externalNoVnc && !hasX11Display && !linuxCanCreateDisplay) {
    errors.push(
      "Embedded noVNC on Linux needs an X11 display. Provide DISPLAY or install an X virtual display such as Xvfb.",
    );
  }

  if (platform === "linux" && loginMode === "host" && !hasGraphicalDisplay) {
    if (requestedMode === "auto") {
      errors.push(
        "This Linux host has no graphical desktop and no usable noVNC path. Install/configure a VNC/noVNC bridge or explicitly choose another runtime.",
      );
    } else if (!linuxCanCreateDisplay) {
      errors.push(
        "Host login mode needs DISPLAY/WAYLAND_DISPLAY, or an X virtual display if you intentionally plan to attach your own viewer.",
      );
    }
  }

  if ((platform === "darwin" || platform === "win32") && loginMode === "novnc" && !externalNoVnc) {
    errors.push(
      "On macOS/Windows, embedded noVNC requires PORTAL_NOVNC_TARGET pointing to your VNC/noVNC bridge.",
    );
  }

  if (loginMode === "host" && !hasGraphicalDisplay && platform === "linux" && linuxCanCreateDisplay) {
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
    browser,
    externalNoVnc,
    noVncWeb,
    hasDisplay: hasGraphicalDisplay,
    hasX11Display,
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
  const needsX11ForNoVnc =
    report.loginMode === "novnc" && !report.externalNoVnc && !env.DISPLAY;

  if (!needsX11ForNoVnc && (env.DISPLAY || env.WAYLAND_DISPLAY)) return;
  if (env.DISPLAY) return;

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

if (report.browser.source === "system" || report.browser.source === "override") {
  env.PORTAL_CHROMIUM = report.browser.path;
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
