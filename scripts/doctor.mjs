#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "server.js",
  "src/eportal.js",
  "src/portal-session.js",
  "scripts/portal-login.mjs",
  "scripts/portal-status.mjs",
  "scripts/portal-run.mjs",
  "public/index.html",
  "public/student.html",
  "public/app.js",
  "public/student.js",
  "public/app.css",
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
console.log("  interactive ePortal login: server Playwright via npm run login");
console.log("  server-side browser: required for background/scheduled work");
console.log("  persistent profile: .eportal-profile/");
console.log("  background session check: npm run portal:status");
console.log("  client convenience detection: userscript bridge");

for (const error of errors) console.error(`  error: ${error}`);

if (errors.length) process.exit(1);
console.log("  status: ready");
