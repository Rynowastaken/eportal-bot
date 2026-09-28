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
    this.controlPage = null;
    this.operationQueue = Promise.resolve();
  }

  async init() {
    if (this.context) return;

    await fs.mkdir(PROFILE_DIR, { recursive: true });

    this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: null,
      locale: "zh-TW",
      args: ["--window-size=1280,800", "--start-maximized"],
    });

    this.context.setDefaultTimeout(20_000);
    this.context.setDefaultNavigationTimeout(30_000);

    const pages = this.context.pages();
    this.controlPage = pages[0] || (await this.context.newPage());

    await this.controlPage.goto(EPORTAL_DASHBOARD, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    }).catch(() => {});
  }

  async close() {
    if (!this.context) return;
    await this.context.close();
    this.context = null;
    this.controlPage = null;
  }

  async enqueue(task) {
    const run = this.operationQueue.then(task, task);
    this.operationQueue = run.catch(() => {});
    return run;
  }

  async openLogin() {
    await this.init();

    if (!this.controlPage || this.controlPage.isClosed()) {
      this.controlPage =
        this.context.pages().find((entry) => !entry.isClosed()) ||
        (await this.context.newPage());
    }

    await this.controlPage.bringToFront();
    await this.controlPage.goto(EPORTAL_HOME, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    return this.status();
  }

  async status() {
    await this.init();

    const pages = this.context.pages().filter((entry) => !entry.isClosed());
    if (!pages.length) return { loggedIn: false, url: "", title: "" };

    for (const page of pages) {
      try {
        const hostname = new URL(page.url()).hostname;
        if (
          hostname === "eportal.nutc.edu.tw" &&
          (page.url().includes("/nutc_dashboard/") ||
            (await page.locator(STUDENT_BUTTON_SELECTOR).count()) > 0)
        ) {
          return {
            loggedIn: true,
            url: page.url(),
            title: await page.title().catch(() => ""),
          };
        }
      } catch {
        // Continue looking through the persistent context.
      }
    }

    const page =
      this.controlPage && !this.controlPage.isClosed()
        ? this.controlPage
        : pages[0];

    return {
      loggedIn: false,
      url: page?.url() || "",
      title: page ? await page.title().catch(() => "") : "",
    };
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
          // ticket is consumed by the persistent Chromium browser.
        });

        return await launchPromise;
      } finally {
        clearTimeout(timeout);
        await this.context.unroute("**/*", routeHandler).catch(() => {});
        this.context.off("page", onPage);

        for (const tracked of trackedPages) {
          if (!tracked.isClosed() && tracked !== this.controlPage) {
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

      if (method === "GET") {
        return this.context.request.get(url.toString(), requestOptions);
      }

      if (method === "POST") {
        return this.context.request.post(url.toString(), requestOptions);
      }

      throw new Error("Only GET and POST are supported for AIS requests.");
    });
  }
}
