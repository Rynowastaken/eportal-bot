#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import {
  clearRemoteLoginState,
  createRemoteLoginState,
  isPortListening,
} from "../src/remote-login.js";
import { loginServerPortal } from "../src/portal-session.js";

const display = process.env.EPORTAL_REMOTE_DISPLAY || ":100";
const port = Number(process.env.EPORTAL_REMOTE_PORT || 14500);
const bandwidthKbps = Number(
  process.env.EPORTAL_REMOTE_BANDWIDTH_KBPS || 512,
);
const ttlMinutes = Number(process.env.EPORTAL_REMOTE_TTL_MINUTES || 30);
const dashboardUrl = String(process.env.DASHBOARD_URL || "").replace(/\/+$/, "");

function fail(message) {
  console.error("[-]", message);
  process.exitCode = 1;
}

function checkXpra() {
  const result = spawnSync("xpra", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error?.code === "ENOENT") {
    throw new Error(
      "xpra is not installed. Install Xpra with its HTML5 client package first.",
    );
  }

  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() || "Unable to execute the xpra command.",
    );
  }
}

async function waitForPort(targetPort, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isPortListening(targetPort, 300)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Xpra did not start its HTML5 listener on 127.0.0.1:${targetPort}.`,
  );
}

function stopXpra(child) {
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }

  spawnSync("xpra", ["stop", display], {
    stdio: "ignore",
    timeout: 5_000,
  });
}

let xpraProcess = null;
let cleanedUp = false;

async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  await clearRemoteLoginState();
  stopXpra(xpraProcess);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    void cleanup().finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 1);
    });
  });
}

try {
  checkXpra();

  if (await isPortListening(port, 300)) {
    throw new Error(
      `Port ${port} is already in use. Stop the existing remote-login session or set EPORTAL_REMOTE_PORT.`,
    );
  }

  const xpraArgs = [
    "seamless",
    display,
    "--backend=x11",
    `--bind-tcp=127.0.0.1:${port}`,
    "--html=on",
    "--daemon=no",
    "--audio=no",
    "--clipboard=no",
    "--file-transfer=no",
    "--printing=no",
    "--webcam=no",
    "--notifications=no",
    "--bell=no",
    "--mdns=no",
    "--sharing=no",
    "--lock=yes",
  ];

  console.log("[+] Starting temporary Xpra HTML5 session...");
  console.log(
    `[+] Bandwidth budget: ${Math.max(128, bandwidthKbps)} kbps (HTML5 client).`,
  );

  xpraProcess = spawn("xpra", xpraArgs, {
    env: {
      ...process.env,
      XPRA_XDG: "0",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  let xpraExit = null;
  xpraProcess.once("exit", (code, signal) => {
    xpraExit = { code, signal };
  });

  await waitForPort(port);

  if (xpraExit) {
    throw new Error(
      `Xpra exited before login could start (${xpraExit.signal || xpraExit.code}).`,
    );
  }

  const { token, state } = await createRemoteLoginState({
    port,
    display,
    ttlMinutes,
    bandwidthKbps,
  });

  const fragment = `#token=${encodeURIComponent(token)}`;
  const launchPath = `/remote-login/${fragment}`;

  console.log("");
  console.log("[+] Remote ePortal login is ready.");
  console.log(`[+] Expires: ${state.expiresAt}`);
  if (dashboardUrl) {
    console.log(`[+] Open: ${dashboardUrl}${launchPath}`);
  } else {
    console.log(`[+] Open your Dashboard at: ${launchPath}`);
    console.log(`[+] One-time access token: ${token}`);
  }
  console.log("");
  console.log(
    "[+] The token is kept in the URL fragment, then exchanged for an HttpOnly temporary cookie.",
  );
  console.log(
    "[+] Xpra listens only on localhost; the Dashboard reverse proxy is the browser entry point.",
  );

  process.env.DISPLAY = display;

  await loginServerPortal({
    loginTimeout: Math.max(5, ttlMinutes) * 60_000,
    viewport: { width: 1100, height: 760 },
  });

  console.log("[+] Remote login completed successfully.");
} catch (error) {
  fail(error?.message || String(error));
} finally {
  await cleanup();
}
