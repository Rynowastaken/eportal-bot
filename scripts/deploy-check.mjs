#!/usr/bin/env node

import process from "node:process";

const errors = [];
const warnings = [];

const host = String(process.env.HOST || "").trim();
const port = Number(process.env.PORT || 4174);
const enforce = /^(1|true|yes)$/i.test(
  String(process.env.CLOUDFLARE_ACCESS_ENFORCE || ""),
);
const team = String(
  process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN || "",
).trim();
const aud = String(process.env.CLOUDFLARE_ACCESS_AUD || "").trim();

if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
  errors.push(
    "HOST must be 127.0.0.1, ::1, or localhost for the no-tunnel deployment.",
  );
}

if (port !== 4174) {
  warnings.push(
    `PORT is ${port}; the bundled Caddy example expects 4174.`,
  );
}

if (!enforce) {
  errors.push(
    "CLOUDFLARE_ACCESS_ENFORCE=1 is required for production.",
  );
}

if (!team) {
  errors.push("CLOUDFLARE_ACCESS_TEAM_DOMAIN is missing.");
}

if (!aud) {
  errors.push("CLOUDFLARE_ACCESS_AUD is missing.");
}

console.log("NUTC Portal no-tunnel deployment check");
console.log(`  node listener: ${host || "(unset)"}:${port}`);
console.log(
  `  origin Access JWT enforcement: ${enforce ? "enabled" : "disabled"}`,
);
console.log(`  Access team domain: ${team || "(missing)"}`);
console.log(`  Access AUD: ${aud ? "configured" : "(missing)"}`);

for (const warning of warnings) {
  console.warn(`  warning: ${warning}`);
}

for (const error of errors) {
  console.error(`  error: ${error}`);
}

if (errors.length) process.exit(1);

console.log("  status: production environment looks ready");
console.log("");
console.log("Expected public path:");
console.log("  Cloudflare proxy :443 -> Caddy :443 -> 127.0.0.1:4174");
