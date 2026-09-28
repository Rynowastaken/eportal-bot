#!/usr/bin/env node

import process from "node:process";
import {
  checkEportalLogin,
  fetchAuthenticatedAis,
  firstLogin,
} from "./src/eportal.js";

function printUsage() {
  console.log(`Usage:
  node eportal_bot.js login
  node eportal_bot.js run [--headed] [--fetch-url https://ais.nutc.edu.tw/...]
`);
}

function parseRunArgs(args) {
  let fetchUrl = null;
  let headed = false;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--headed") {
      headed = true;
      continue;
    }
    if (args[i] === "--fetch-url") {
      if (!args[i + 1]) throw new Error("--fetch-url requires a URL.");
      fetchUrl = args[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${args[i]}`);
  }

  return { fetchUrl, headed };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "login") return firstLogin();

  if (command === "run") {
    const { fetchUrl, headed } = parseRunArgs(rest);
    const status = await checkEportalLogin();

    if (!status.valid) {
      console.error(
        status.reason === "missing-state"
          ? "[-] Missing eportal-auth-state.json. Run npm run login."
          : "[-] Saved ePortal login state has expired. Run npm run login again.",
      );
      return 3;
    }

    console.log("[+] ePortal login state is valid.");

    if (fetchUrl) {
      const result = await fetchAuthenticatedAis(fetchUrl, { headed });
      console.log(`[+] Authenticated request status: ${result.status}`);
      console.log(`[+] Response saved to: ${result.outputPath}`);
      console.log(`[+] Metadata saved to: ${result.metadataPath}`);
    }
    return 0;
  }

  printUsage();
  return 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`[-] ${error.message}`);
  process.exitCode = 1;
}
