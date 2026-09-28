import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

export const EPORTAL_ORIGIN = "https://eportal.nutc.edu.tw";
export const EPORTAL_HOME = `${EPORTAL_ORIGIN}/`;
export const EPORTAL_DASHBOARD = `${EPORTAL_ORIGIN}/nutc_dashboard/`;
export const STATE_FILE = path.join(ROOT, "eportal-auth-state.json");
export const OUTPUT_DIR = path.join(ROOT, "output");

const STUDENT_BUTTON_SELECTOR = 'button[onclick*="NUTC_6401"]';

export const MODULES = Object.freeze([
  {
    id: "ais",
    name: "學生管理系統",
    shortName: "學生管理",
    description: "課表、學籍與學生資訊",
    uuid: "8a782d88-721c-4545-a5b7-c6a986158c64",
    path: "/?app_id=NUTC_6401",
    sourceColor: "#a742ae",
    icon: "graduation-cap",
  },
  {
    id: "webmail",
    name: "WebMail郵件系統",
    shortName: "WebMail",
    description: "校務信箱與通知",
    uuid: "26645edb-4114-4322-a3f1-96d569928b6d",
    path: "/ext_module/ext_set_param.php?mod_id=_OSL256_lPGpV8f9YqQ8qgA9cyn8QA",
    sourceColor: "#4e7dda",
    icon: "mail",
  },
  {
    id: "activity",
    name: "活動報名暨投票系統",
    shortName: "活動報名",
    description: "活動、報名與投票",
    uuid: "e407696e-de54-429a-8e5a-93bdd3c2586e",
    path: "/ext_module/ext_set_param.php?mod_id=_OSL256_PI9bsUzimpCHrDSTPoMVcQ",
    sourceColor: "#da5e0b",
    icon: "clipboard-check",
  },
  {
    id: "ep",
    name: "學生學習歷程(EP)跨平台整合系統",
    shortName: "學習歷程",
    description: "EP 學習歷程與成果",
    uuid: "21b57b37-4685-490d-b127-05f5eefe6735",
    path: "/ext_module/ext_set_param.php?mod_id=_OSL256_pmabVqSXTYna294Vl9JLJg",
    sourceColor: "#d75656",
    icon: "route",
  },
  {
    id: "tronclass",
    name: "TronClass創新教學平台",
    shortName: "TronClass",
    description: "課程、教材、作業與測驗",
    uuid: "d54250aa-edce-4fa2-8cdc-9d708537cccb",
    path: "/ext_module/ext_set_param.php?mod_id=_OSL256_OBbFAusuXIjtGB-G8RS4gQ",
    sourceColor: "#a742ae",
    icon: "book-open-check",
  },
]);

export function publicModules() {
  return MODULES.map(({ path, ...module }) => module);
}

export async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function secureStateFile() {
  try {
    await fs.chmod(STATE_FILE, 0o600);
  } catch {
    // Best effort on platforms where chmod is meaningful.
  }
}

export async function saveState(context) {
  await context.storageState({ path: STATE_FILE });
  await secureStateFile();
}

export async function stateFileExists() {
  try {
    await fs.access(STATE_FILE);
    return true;
  } catch {
    return false;
  }
}

export async function firstLogin() {
  await ensureOutputDir();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(EPORTAL_HOME, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    console.log("[+] Browser opened. Log into the official NUTC ePortal page normally.");
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

async function pageIsLoggedIn(page) {
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

export async function checkEportalLogin() {
  if (!(await stateFileExists())) {
    return { valid: false, reason: "missing-state" };
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STATE_FILE });
  const page = await context.newPage();

  try {
    const valid = await pageIsLoggedIn(page);
    if (valid) await saveState(context);
    return { valid, reason: valid ? null : "expired" };
  } finally {
    await browser.close();
  }
}

function moduleById(moduleId) {
  const module = MODULES.find((entry) => entry.id === moduleId);
  if (!module) throw new Error("Unknown ePortal module.");
  return module;
}

function topLevelExternalRequest(request, page) {
  if (!request.isNavigationRequest()) return false;
  if (request.frame() !== page.mainFrame()) return false;

  try {
    const url = new URL(request.url());
    return url.hostname !== "eportal.nutc.edu.tw";
  } catch {
    return false;
  }
}

function externalLaunchPayload(request) {
  const url = new URL(request.url());
  if (url.protocol !== "https:") {
    throw new Error("ePortal attempted to launch a non-HTTPS destination.");
  }

  const method = request.method().toUpperCase();
  if (method === "GET") {
    return { kind: "url", method, url: url.toString() };
  }

  if (method === "POST") {
    const contentType = String(request.headers()["content-type"] || "").toLowerCase();
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      throw new Error(`Unsupported SSO launch method: POST ${contentType || "without form content type"}`);
    }

    const params = new URLSearchParams(request.postData() || "");
    return {
      kind: "form",
      method,
      url: url.toString(),
      fields: [...params.entries()],
    };
  }

  throw new Error(`Unsupported SSO launch method: ${method}`);
}

export async function captureModuleLaunch(moduleId) {
  const module = moduleById(moduleId);

  if (!(await stateFileExists())) {
    throw new Error("ePortal login state is missing. Run npm run login first.");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STATE_FILE });
  const page = await context.newPage();
  let settled = false;
  let resolveLaunch;
  let rejectLaunch;

  const launchPromise = new Promise((resolve, reject) => {
    resolveLaunch = resolve;
    rejectLaunch = reject;
  });

  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectLaunch(new Error("Timed out waiting for the module SSO destination."));
    }
  }, 20_000);

  try {
    if (!(await pageIsLoggedIn(page))) {
      throw new Error("Saved ePortal login state has expired. Run npm run login again.");
    }

    await context.route("**/*", async (route) => {
      const request = route.request();

      if (!settled && topLevelExternalRequest(request, page)) {
        try {
          const payload = externalLaunchPayload(request);
          settled = true;
          clearTimeout(timeout);
          resolveLaunch(payload);
        } catch (error) {
          settled = true;
          clearTimeout(timeout);
          rejectLaunch(error);
        }
        await route.abort("blockedbyclient");
        return;
      }

      await route.continue();
    });

    const target = new URL(module.path, EPORTAL_ORIGIN).toString();
    page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    }).catch(() => {
      // Expected when the external navigation is intentionally aborted before
      // the one-time SSO ticket is consumed by Playwright.
    });

    const launch = await launchPromise;
    await saveState(context);
    return { module: module.id, ...launch };
  } finally {
    clearTimeout(timeout);
    await browser.close();
  }
}

export function validateAisUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("--fetch-url must be a valid absolute URL.");
  }

  if (url.protocol !== "https:" || url.hostname !== "ais.nutc.edu.tw") {
    throw new Error("--fetch-url must stay under https://ais.nutc.edu.tw/.");
  }

  return url;
}

function safeUrlForMetadata(url) {
  const copy = new URL(url);
  for (const key of [...copy.searchParams.keys()]) {
    if (/jwt|token|session|auth/i.test(key)) copy.searchParams.set(key, "<redacted>");
  }
  return copy.toString();
}

function safeResponseHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !/^(set-cookie|cookie|authorization|proxy-authorization)$/i.test(name),
    ),
  );
}

export async function fetchAuthenticatedAis(rawUrl, { headed = false } = {}) {
  const url = validateAisUrl(rawUrl);
  if (!(await stateFileExists())) {
    throw new Error("ePortal login state is missing. Run npm run login first.");
  }

  await ensureOutputDir();
  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({ storageState: STATE_FILE });
  const page = await context.newPage();

  try {
    if (!(await pageIsLoggedIn(page))) {
      throw new Error("Saved ePortal login state has expired. Run npm run login again.");
    }

    await page.goto(new URL(MODULES[0].path, EPORTAL_ORIGIN).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await page.waitForURL((current) => current.hostname === "ais.nutc.edu.tw", {
      timeout: 20_000,
    });

    const response = await context.request.get(url.toString(), { timeout: 30_000 });
    const body = await response.body();
    const outputPath = path.join(OUTPUT_DIR, "authenticated_response.bin");
    const metadataPath = path.join(OUTPUT_DIR, "authenticated_response.json");

    await fs.writeFile(outputPath, body);
    await fs.writeFile(
      metadataPath,
      `${JSON.stringify(
        {
          url: safeUrlForMetadata(url),
          status: response.status(),
          ok: response.ok(),
          headers: safeResponseHeaders(response.headers()),
          bodyFile: outputPath,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await saveState(context);
    return { status: response.status(), ok: response.ok(), outputPath, metadataPath };
  } finally {
    await browser.close();
  }
}
