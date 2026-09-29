#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "server.js",
  "src/eportal.js",
  "src/portal-session.js",
  "src/login-bridge.js",
  "src/dashboard-preferences.js",
  "scripts/portal-login.mjs",
  "scripts/portal-status.mjs",
  "scripts/portal-run.mjs",
  "public/index.html",
  "public/server-login.html",
  "public/server-login.js",
  "public/app.js",
  "public/launch.html",
  "public/launch.js",
  "public/theme.js",
  "public/motion.js",
  "public/tailwind-config.js",
  "public/vendor/tailwindcss-3.4.17.js",
  "public/vendor/lucide-1.24.0.min.js",
  "public/userscript/nutc-portal.user.js",
];

const major = Number(process.versions.node.split(".")[0]);
const errors = [];

if (!Number.isFinite(major) || major < 18) {
  errors.push("Node.js 18 or newer is required.");
}

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    errors.push(`Missing required file: ${file}`);
  }
}

console.log("NUTC Portal runtime check");
console.log(`  platform: ${process.platform} (${process.arch})`);
console.log(`  node: ${process.version}`);
console.log("  server interactive login: native headless form bridge at /server-login/");
console.log("  local headed fallback: npm run login");
console.log("  server-side browser: Playwright Chromium");
console.log("  persistent profile: .eportal-profile/");
console.log("  background session check: npm run portal:status");
console.log(
  `  login bridge ttl minutes: ${process.env.EPORTAL_LOGIN_BRIDGE_TTL_MINUTES || "15 (default)"}`,
);
console.log(
  `  keepalive minutes: ${process.env.EPORTAL_KEEPALIVE_MINUTES || "10 (default)"}`,
);
console.log("  client convenience detection: userscript bridge");

if (!errors.length) {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      timeout: 15_000,
    });
    console.log("  playwright chromium: launch ok");
  } catch (error) {
    const message = error?.message || String(error);
    const missingLibrary = message.match(
      /error while loading shared libraries:\s*([^:]+):/i,
    )?.[1];

    if (missingLibrary) {
      errors.push(
        `Playwright Chromium is missing Linux library ${missingLibrary}. Run: npm run install-browser`,
      );
    } else if (/executable doesn't exist|browserType\.launch/i.test(message)) {
      errors.push(
        "Playwright Chromium could not launch. Run: npm run install-browser",
      );
    } else {
      errors.push(
        `Playwright Chromium launch failed: ${message.split("\n")[0]}`,
      );
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

for (const error of errors) console.error(`  error: ${error}`);

if (errors.length) process.exit(1);
console.log("  status: ready");
