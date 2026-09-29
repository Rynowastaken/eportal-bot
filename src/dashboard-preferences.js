import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const META_FILE = path.join(DATA_DIR, "dashboard-preferences.json");
const AVATAR_FILE = path.join(DATA_DIR, "dashboard-avatar.bin");
const BACKGROUND_FILE = path.join(DATA_DIR, "dashboard-background.bin");

const IMAGE_LIMITS = {
  avatar: 2 * 1024 * 1024,
  background: 6 * 1024 * 1024,
};

function cleanUsername(value) {
  const username = typeof value === "string" ? value.trim() : "";
  if (!username || username.length > 40) {
    throw Object.assign(
      new Error("Username must contain 1 to 40 characters."),
      { statusCode: 400 },
    );
  }
  return username;
}

function decodeImageDataUrl(value, kind) {
  if (value === "") return null;
  if (typeof value !== "string") {
    throw Object.assign(new Error("Image data must be a data URL."), {
      statusCode: 400,
    });
  }

  const match = value.match(
    /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i,
  );
  if (!match) {
    throw Object.assign(
      new Error("Only JPEG, PNG, WEBP, or GIF image data URLs are accepted."),
      { statusCode: 400 },
    );
  }

  const contentType =
    match[1].toLowerCase() === "image/jpg"
      ? "image/jpeg"
      : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  const limit = IMAGE_LIMITS[kind];

  if (!buffer.length || buffer.length > limit) {
    throw Object.assign(
      new Error(
        `${kind === "avatar" ? "Account picture" : "Background"} must be smaller than ${Math.round(limit / 1024 / 1024)} MB after processing.`,
      ),
      { statusCode: 413 },
    );
  }

  return { buffer, contentType };
}

async function fileExists(file) {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

export class DashboardPreferenceStore {
  constructor() {
    this.value = {
      version: 1,
      account: {
        initialized: false,
        username: "User",
        avatar: null,
      },
      appearance: {
        initialized: false,
        background: null,
      },
      updatedAt: null,
    };
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });

    try {
      const parsed = JSON.parse(await fs.readFile(META_FILE, "utf8"));
      this.value = {
        version: 1,
        account: {
          initialized: Boolean(parsed?.account?.initialized),
          username:
            typeof parsed?.account?.username === "string" &&
            parsed.account.username.trim()
              ? parsed.account.username.trim().slice(0, 40)
              : "User",
          avatar:
            parsed?.account?.avatar &&
            typeof parsed.account.avatar.contentType === "string" &&
            typeof parsed.account.avatar.updatedAt === "string"
              ? {
                  contentType: parsed.account.avatar.contentType,
                  updatedAt: parsed.account.avatar.updatedAt,
                }
              : null,
        },
        appearance: {
          initialized: Boolean(parsed?.appearance?.initialized),
          background:
            parsed?.appearance?.background &&
            typeof parsed.appearance.background.contentType === "string" &&
            typeof parsed.appearance.background.updatedAt === "string"
              ? {
                  contentType: parsed.appearance.background.contentType,
                  updatedAt: parsed.appearance.background.updatedAt,
                }
              : null,
        },
        updatedAt:
          typeof parsed?.updatedAt === "string" ? parsed.updatedAt : null,
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn(
          "Dashboard preference store could not be loaded:",
          error.message,
        );
      }
    }

    if (this.value.account.avatar && !(await fileExists(AVATAR_FILE))) {
      this.value.account.avatar = null;
    }

    if (
      this.value.appearance.background &&
      !(await fileExists(BACKGROUND_FILE))
    ) {
      this.value.appearance.background = null;
    }
  }

  get() {
    const accountAvatar = this.value.account.avatar;
    const background = this.value.appearance.background;

    return {
      account: {
        initialized: this.value.account.initialized,
        username: this.value.account.username,
        avatarUrl: accountAvatar
          ? `/api/preferences/avatar?v=${encodeURIComponent(accountAvatar.updatedAt)}`
          : "",
      },
      appearance: {
        initialized: this.value.appearance.initialized,
        backgroundUrl: background
          ? `/api/preferences/background?v=${encodeURIComponent(background.updatedAt)}`
          : "",
      },
      updatedAt: this.value.updatedAt,
    };
  }

  async persist() {
    const temp = `${META_FILE}.tmp`;
    await fs.writeFile(
      temp,
      JSON.stringify(this.value, null, 2) + "\n",
      { mode: 0o600 },
    );
    await fs.rename(temp, META_FILE);
    await fs.chmod(META_FILE, 0o600).catch(() => {});
  }

  enqueue(task) {
    const pending = this.writeQueue.then(task, task);
    this.writeQueue = pending.catch(() => {});
    return pending;
  }

  async setAccount(payload = {}) {
    return this.enqueue(async () => {
      const username = cleanUsername(payload.username);
      const hasAvatar = Object.hasOwn(payload, "avatarDataUrl");
      const decoded = hasAvatar
        ? decodeImageDataUrl(payload.avatarDataUrl, "avatar")
        : undefined;

      if (hasAvatar) {
        if (decoded) {
          const temp = `${AVATAR_FILE}.tmp`;
          await fs.writeFile(temp, decoded.buffer, { mode: 0o600 });
          await fs.rename(temp, AVATAR_FILE);
          await fs.chmod(AVATAR_FILE, 0o600).catch(() => {});
          this.value.account.avatar = {
            contentType: decoded.contentType,
            updatedAt: new Date().toISOString(),
          };
        } else {
          await fs.rm(AVATAR_FILE, { force: true }).catch(() => {});
          this.value.account.avatar = null;
        }
      }

      this.value.account.username = username;
      this.value.account.initialized = true;
      this.value.updatedAt = new Date().toISOString();
      await this.persist();
      return this.get();
    });
  }

  async setBackground(payload = {}) {
    return this.enqueue(async () => {
      if (!Object.hasOwn(payload, "backgroundDataUrl")) {
        throw Object.assign(
          new Error("backgroundDataUrl is required."),
          { statusCode: 400 },
        );
      }

      const decoded = decodeImageDataUrl(
        payload.backgroundDataUrl,
        "background",
      );

      if (decoded) {
        const temp = `${BACKGROUND_FILE}.tmp`;
        await fs.writeFile(temp, decoded.buffer, { mode: 0o600 });
        await fs.rename(temp, BACKGROUND_FILE);
        await fs.chmod(BACKGROUND_FILE, 0o600).catch(() => {});
        this.value.appearance.background = {
          contentType: decoded.contentType,
          updatedAt: new Date().toISOString(),
        };
      } else {
        await fs.rm(BACKGROUND_FILE, { force: true }).catch(() => {});
        this.value.appearance.background = null;
      }

      this.value.appearance.initialized = true;
      this.value.updatedAt = new Date().toISOString();
      await this.persist();
      return this.get();
    });
  }

  async readAvatar() {
    if (!this.value.account.avatar) return null;
    try {
      return {
        body: await fs.readFile(AVATAR_FILE),
        contentType: this.value.account.avatar.contentType,
      };
    } catch {
      return null;
    }
  }

  async readBackground() {
    if (!this.value.appearance.background) return null;
    try {
      return {
        body: await fs.readFile(BACKGROUND_FILE),
        contentType: this.value.appearance.background.contentType,
      };
    } catch {
      return null;
    }
  }
}
