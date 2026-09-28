import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  EPORTAL_DASHBOARD,
  EPORTAL_HOME,
  moduleById,
  moduleUrl,
} from "./eportal.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PROFILE_DIR = path.join(ROOT, ".eportal-profile");

const STUDENT_BUTTON_SELECTOR = 'button[onclick*="NUTC_6401"]';
const VIEWPORT = Object.freeze({ width: 1280, height: 800 });

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
      throw new Error(
        `Unsupported SSO launch method: POST ${contentType || "without form content type"}`,
      );
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

function topLevelExternalRequest(request, trackedPages) {
  if (!request.isNavigationRequest()) return false;

  const page = request.frame().page();
  if (!trackedPages.has(page)) return false;
  if (request.frame() !== page.mainFrame()) return false;

  try {
    return new URL(request.url()).hostname !== "eportal.nutc.edu.tw";
  } catch {
    return false;
  }
}

export class PortalBrowserSession {
  constructor() {
    this.context = null;
    this.remotePage = null;
    this.remoteMode = false;
    this.operationQueue = Promise.resolve();
  }

  async init() {
    if (this.context) return;
    await fs.mkdir(PROFILE_DIR, { recursive: true });

    this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      viewport: VIEWPORT,
      locale: "zh-TW",
    });

    this.context.setDefaultTimeout(20_000);
    this.context.setDefaultNavigationTimeout(30_000);

    const pages = this.context.pages();
    this.remotePage = pages[0] || (await this.context.newPage());

    this.context.on("page", (page) => {
      if (this.remoteMode) this.remotePage = page;
    });
  }

  async close() {
    if (!this.context) return;
    await this.context.close();
    this.context = null;
    this.remotePage = null;
  }

  async enqueue(task) {
    const run = this.operationQueue.then(task, task);
    this.operationQueue = run.catch(() => {});
    return run;
  }

  async openLogin() {
    await this.init();
    this.remoteMode = true;
    if (!this.remotePage || this.remotePage.isClosed()) {
      this.remotePage = await this.context.newPage();
    }

    await this.remotePage.goto(EPORTAL_HOME, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    return this.remoteStatus();
  }

  activeRemotePage() {
    if (!this.remotePage || this.remotePage.isClosed()) {
      throw new Error("Remote ePortal browser is not open.");
    }
    return this.remotePage;
  }

  async remoteStatus() {
    await this.init();
    const page = this.activeRemotePage();
    let loggedIn = false;

    try {
      loggedIn =
        new URL(page.url()).hostname === "eportal.nutc.edu.tw" &&
        ((await page.locator(STUDENT_BUTTON_SELECTOR).count()) > 0 ||
          page.url().includes("/nutc_dashboard/"));
    } catch {
      loggedIn = false;
    }

    return {
      loggedIn,
      url: page.url(),
      title: await page.title().catch(() => ""),
      viewport: VIEWPORT,
    };
  }

  async screenshot() {
    await this.init();
    const page = this.activeRemotePage();
    return page.screenshot({ type: "jpeg", quality: 70 });
  }

  async input(action) {
    await this.init();
    const page = this.activeRemotePage();

    switch (action?.type) {
      case "click": {
        const x = Number(action.x);
        const y = Number(action.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error("Invalid pointer coordinates.");
        }
        await page.mouse.click(
          Math.max(0, Math.min(VIEWPORT.width, x)),
          Math.max(0, Math.min(VIEWPORT.height, y)),
        );
        break;
      }
      case "wheel": {
        const deltaX = Number(action.deltaX || 0);
        const deltaY = Number(action.deltaY || 0);
        await page.mouse.wheel(deltaX, deltaY);
        break;
      }
      case "press": {
        const key = String(action.key || "");
        if (!key || key.length > 40) throw new Error("Invalid key.");
        await page.keyboard.press(key);
        break;
      }
      case "text": {
        const text = String(action.text || "");
        if (!text || text.length > 256) throw new Error("Invalid text input.");
        await page.keyboard.insertText(text);
        break;
      }
      default:
        throw new Error("Unknown remote browser input action.");
    }

    return this.remoteStatus();
  }

  async assertLoggedIn() {
    await this.init();
    const page = await this.context.newPage();
    try {
      await page.goto(EPORTAL_DASHBOARD, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if ((await page.locator(STUDENT_BUTTON_SELECTOR).count()) === 0) {
        throw new Error("ePortal login is required.");
      }
      return true;
    } finally {
      await page.close();
    }
  }

  async captureModuleLaunch(moduleId) {
    moduleById(moduleId);

    return this.enqueue(async () => {
      await this.assertLoggedIn();
      this.remoteMode = false;

      const trackedPages = new Set();
      const page = await this.context.newPage();
      trackedPages.add(page);

      const onPage = (newPage) => trackedPages.add(newPage);
      this.context.on("page", onPage);

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
      }, 25_000);

      const routeHandler = async (route) => {
        const request = route.request();
        if (!settled && topLevelExternalRequest(request, trackedPages)) {
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
      };

      await this.context.route("**/*", routeHandler);

      try {
        page.goto(moduleUrl(moduleId), {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        }).catch(() => {
          // Expected: the external request is aborted before the one-time SSO
          // ticket is consumed by the persistent Chromium context.
        });

        return await launchPromise;
      } finally {
        clearTimeout(timeout);
        await this.context.unroute("**/*", routeHandler).catch(() => {});
        this.context.off("page", onPage);
        for (const tracked of trackedPages) {
          if (!tracked.isClosed() && tracked !== this.remotePage) {
            await tracked.close().catch(() => {});
          }
        }
      }
    });
  }

  async ensureAisSession() {
    await this.assertLoggedIn();
    const page = await this.context.newPage();
    try {
      await page.goto(moduleUrl("ais"), {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForURL((url) => url.hostname === "ais.nutc.edu.tw", {
        timeout: 20_000,
      });
    } finally {
      await page.close();
    }
  }

  async fetchAis(rawUrl, options = {}) {
    return this.enqueue(async () => {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || url.hostname !== "ais.nutc.edu.tw") {
        throw new Error("AIS request URL must stay under https://ais.nutc.edu.tw/.");
      }

      await this.ensureAisSession();
      const method = String(options.method || "GET").toUpperCase();
      const requestOptions = { timeout: 30_000 };

      if (options.headers) requestOptions.headers = options.headers;
      if (options.form) requestOptions.form = options.form;
      if (options.data) requestOptions.data = options.data;

      if (method === "GET") return this.context.request.get(url.toString(), requestOptions);
      if (method === "POST") return this.context.request.post(url.toString(), requestOptions);
      throw new Error("Only GET and POST are supported for AIS requests.");
    });
  }
}
