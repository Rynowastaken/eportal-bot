import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const FILE = path.join(DATA_DIR, "preferences.json");

function cleanBucket(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const output = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof key !== "string" || key.length > 128) continue;
    if (typeof rawValue !== "string" || rawValue.length > 8192) continue;
    output[key] = rawValue;
  }
  return output;
}

export class PreferenceStore {
  constructor() {
    this.value = {
      localStorage: {},
      sessionStorage: {},
      updatedAt: null,
    };
  }

  async init() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
      const raw = await fs.readFile(FILE, "utf8");
      const parsed = JSON.parse(raw);
      this.value = {
        localStorage: cleanBucket(parsed.localStorage),
        sessionStorage: cleanBucket(parsed.sessionStorage),
        updatedAt: parsed.updatedAt || null,
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("Preference store could not be loaded:", error.message);
      }
    }
  }

  get() {
    return structuredClone(this.value);
  }

  async set(payload) {
    this.value = {
      localStorage: cleanBucket(payload?.localStorage),
      sessionStorage: cleanBucket(payload?.sessionStorage),
      updatedAt: new Date().toISOString(),
    };

    const temp = `${FILE}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.value, null, 2) + "\n", {
      mode: 0o600,
    });
    await fs.rename(temp, FILE);

    try {
      await fs.chmod(FILE, 0o600);
    } catch {
      // Best effort on platforms without POSIX permissions.
    }

    return this.get();
  }
}
