#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EPORTAL_HOME = "https://eportal.nutc.edu.tw/";
const EPORTAL_DASHBOARD = "https://eportal.nutc.edu.tw/nutc_dashboard/";
const EPORTAL_STUDENT_SSO = "https://eportal.nutc.edu.tw/?app_id=NUTC_6401";
const AIS_ORIGIN = "https://ais.nutc.edu.tw";

const STATE_FILE = path.join(__dirname, "eportal-auth-state.json");
const OUTPUT_DIR = path.join(__dirname, "output");

const STUDENT_BUTTON_SELECTOR = 'button[onclick*="NUTC_6401"]';

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function secureStateFile() {
  try {
    await fs.chmod(STATE_FILE, 0o600);
  } catch {
    // Best effort only; chmod may not be meaningful on every platform.
  }
}

async function saveState(context) {
  await context.storageState({ path: STATE_FILE });
  await secureStateFile();
}

async function stateFileExists() {
  try {
    await fs.access(STATE_FILE);
    return true;
  } catch {
    return false;
  }
}

async function isEportalLoggedIn(page) {
  try {
    await page.goto(EPORTAL_DASHBOARD, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    return (await page.locator(STUDENT_BUTTON_SELECTOR).count()) > 0;
  } catch {
    return false;
  }
}

async function firstLogin() {
  await ensureOutputDir();

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(EPORTAL_HOME, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    console.log("[+] Browser opened. Please log into ePortal normally.");
    console.log("[+] Waiting for the Student Management button...");

    await page.locator(STUDENT_BUTTON_SELECTOR).waitFor({
      state: "attached",
      timeout: 0,
    });

    await saveState(context);

    console.log(`[+] Login state saved to: ${STATE_FILE}`);
    console.log("[!] Treat this file like a credential and never commit it.");

    return 0;
  } finally {
    await browser.close();
  }
}

async function openAisViaSso(page) {
  await page.goto(EPORTAL_STUDENT_SSO, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  try {
    await page.waitForURL(
      (url) => url.protocol === "https:" && url.hostname === "ais.nutc.edu.tw",
      { timeout: 20_000 },
    );
  } catch {
    throw new Error(
      "SSO did not reach ais.nutc.edu.tw. The ePortal login state may have expired, or the SSO flow may have changed.",
    );
  }
}

function validateAisUrl(rawUrl) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("--fetch-url must be a valid absolute URL.");
  }

  if (url.protocol !== "https:" || url.hostname !== "ais.nutc.edu.tw") {
    throw new Error("--fetch-url must stay under https://ais.nutc.edu.tw/");
  }

  return url;
}

function safeUrlForMetadata(url) {
  const copy = new URL(url);

  for (const key of [...copy.searchParams.keys()]) {
    if (/jwt|token|session|auth/i.test(key)) {
      copy.searchParams.set(key, "<redacted>");
    }
  }

  return copy.toString();
}

function safeResponseHeaders(headers) {
  const safe = {};

  for (const [name, value] of Object.entries(headers)) {
    if (/^(set-cookie|cookie|authorization|proxy-authorization)$/i.test(name)) {
      continue;
    }
    safe[name] = value;
  }

  return safe;
}

async function fetchAuthenticated(context, rawUrl) {
  const url = validateAisUrl(rawUrl);

  const response = await context.request.get(url.toString(), {
    timeout: 30_000,
  });

  const body = await response.body();
  const outputPath = path.join(OUTPUT_DIR, "authenticated_response.bin");
  const metadataPath = path.join(OUTPUT_DIR, "authenticated_response.json");

  await fs.writeFile(outputPath, body);

  const metadata = {
    url: safeUrlForMetadata(url),
    status: response.status(),
    ok: response.ok(),
    headers: safeResponseHeaders(response.headers()),
    bodyFile: outputPath,
  };

  await fs.writeFile(
    metadataPath,
    JSON.stringify(metadata, null, 2) + "\n",
    "utf8",
  );

  console.log(`[+] Authenticated request status: ${response.status()}`);
  console.log(`[+] Response saved to: ${outputPath}`);
  console.log(`[+] Metadata saved to: ${metadataPath}`);
}

async function run({ fetchUrl = null, headed = false } = {}) {
  if (!(await stateFileExists())) {
    console.error(`[-] Missing ${STATE_FILE}`);
    console.error("    Run: npm run login");
    return 2;
  }

  await ensureOutputDir();

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    storageState: STATE_FILE,
  });
  const page = await context.newPage();

  try {
    if (!(await isEportalLoggedIn(page))) {
      console.error("[-] Saved ePortal login state is no longer valid.");
      console.error("    Re-run: npm run login");
      return 3;
    }

    console.log("[+] ePortal login state is valid.");

    try {
      await openAisViaSso(page);
    } catch (error) {
      console.error(`[-] ${error.message}`);
      return 4;
    }

    console.log(`[+] AIS SSO completed: ${page.url()}`);

    const landingPath = path.join(OUTPUT_DIR, "ais_landing.html");
    await fs.writeFile(landingPath, await page.content(), "utf8");
    console.log(`[+] Saved AIS landing HTML: ${landingPath}`);

    // Persist any cookies/storage refreshed during the SSO flow.
    await saveState(context);

    if (fetchUrl) {
      try {
        await fetchAuthenticated(context, fetchUrl);
      } catch (error) {
        console.error(`[-] ${error.message}`);
        return 5;
      }
    }

    return 0;
  } finally {
    await browser.close();
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;

  if (!["login", "run"].includes(command)) {
    return { command: null };
  }

  if (command === "login") {
    return { command };
  }

  let fetchUrl = null;
  let headed = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];

    if (arg === "--headed") {
      headed = true;
      continue;
    }

    if (arg === "--fetch-url") {
      const value = rest[i + 1];
      if (!value) {
        throw new Error("--fetch-url requires a URL.");
      }
      fetchUrl = value;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    command,
    fetchUrl,
    headed,
  };
}

function printUsage() {
  console.log(`Usage:
  node eportal_bot.js login
  node eportal_bot.js run [--headed] [--fetch-url https://ais.nutc.edu.tw/...]
`);
}

async function main() {
  let args;

  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[-] ${error.message}`);
    printUsage();
    return 1;
  }

  if (!args.command) {
    printUsage();
    return 1;
  }

  if (args.command === "login") {
    return firstLogin();
  }

  return run(args);
}

process.exitCode = await main();
