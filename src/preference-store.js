import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const FILE = path.join(DATA_DIR, "preferences.json");

function cleanProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const id = typeof value.id === "string" ? value.id.trim().toLowerCase() : "";
  const displayName =
    typeof value.displayName === "string" ? value.displayName.trim() : "";

  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  if (!displayName || displayName.length > 128) return null;

  return { id, displayName };
}

export class PreferenceStore {
  constructor() {
    this.value = {
      profile: null,
      updatedAt: null,
    };
  }

  async init() {
    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
      const raw = await fs.readFile(FILE, "utf8");
      const parsed = JSON.parse(raw);
      this.value = {
        profile: cleanProfile(parsed.profile),
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
    const profile = cleanProfile(payload?.profile);
    if (!profile) {
      throw Object.assign(new Error("A valid DOM-derived profile is required."), {
        statusCode: 400,
      });
    }

    this.value = {
      profile,
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
