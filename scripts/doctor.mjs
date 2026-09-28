#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "server.js",
  "src/eportal.js",
  "public/index.html",
  "public/app.js",
  "public/app.css",
  "extension/manifest.json",
  "extension/eportal-bridge.js",
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
console.log("  interactive ePortal login: client browser");
console.log("  server-side browser: not required");
console.log("  automatic login detection: WebExtension bridge");

for (const error of errors) console.error(`  error: ${error}`);

if (errors.length) process.exit(1);
console.log("  status: ready");
