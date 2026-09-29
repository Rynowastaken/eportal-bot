#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const outputDir = path.join(root, ".deploy");

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeHostname(value) {
  const input = clean(value)
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "")
    .toLowerCase();

  if (
    !input ||
    input.length > 253 ||
    !input.includes(".") ||
    !/^[a-z0-9.-]+$/.test(input) ||
    input.split(".").some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-"),
    )
  ) {
    throw new Error("Enter a valid public hostname such as portal.example.com.");
  }

  return input;
}

function normalizeTeamDomain(value) {
  const raw = clean(value);
  if (!raw) throw new Error("Cloudflare Access team domain is required.");

  let url;
  try {
    url = new URL(
      /^https?:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
  } catch {
    throw new Error(
      "Enter a valid Cloudflare Access team domain, for example my-team.cloudflareaccess.com.",
    );
  }

  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("The team domain must be an HTTPS origin without a path.");
  }

  return url.origin;
}

function normalizeAudience(value) {
  const values = clean(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!values.length) {
    throw new Error("At least one Cloudflare Access Application AUD is required.");
  }

  if (values.some((entry) => /\s/.test(entry))) {
    throw new Error("Access AUD values cannot contain whitespace.");
  }

  return values.join(",");
}

function normalizeAbsolutePath(value, label) {
  const raw = clean(value);
  if (!raw || !path.isAbsolute(raw)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return path.normalize(raw);
}

function envQuote(value) {
  const string = String(value);
  if (/^[A-Za-z0-9_./,:@+\-=]+$/.test(string)) return string;
  return JSON.stringify(string);
}

function caddyQuote(value) {
  return JSON.stringify(String(value));
}

function systemdValue(value) {
  const string = String(value);
  if (!/[\s"\\]/.test(string)) return string;
  return `"${string.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function askValidated(rl, prompt, {
  defaultValue = "",
  validate = (value) => value,
} = {}) {
  for (;;) {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = clean(await rl.question(`${prompt}${suffix}: `));
    const candidate = answer || defaultValue;

    try {
      return validate(candidate);
    } catch (error) {
      console.error(`  ! ${error.message}`);
    }
  }
}

async function yesNo(rl, prompt, defaultValue = false) {
  const suffix = defaultValue ? " [Y/n]" : " [y/N]";
  for (;;) {
    const answer = clean(await rl.question(`${prompt}${suffix}: `))
      .toLowerCase();

    if (!answer) return defaultValue;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    console.error("  ! Enter y or n.");
  }
}

async function ensureParent(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
}

async function writeFile(file, content, mode = 0o644) {
  await ensureParent(file);
  await fs.writeFile(file, content, { mode });
  await fs.chmod(file, mode).catch(() => {});
}

async function backupIfPresent(file) {
  try {
    await fs.access(file);
  } catch {
    return null;
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
  const backup = `${file}.backup-${stamp}`;
  await fs.copyFile(file, backup);
  return backup;
}

async function installBundle(bundle) {
  if (process.platform !== "linux") {
    die("--install is supported on Linux only.");
  }

  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    die("Run the installer as root: sudo npm run deploy:configure -- --install");
  }

  const targets = [
    {
      source: bundle.envFile,
      target: "/etc/eportal-bot/eportal.env",
      mode: 0o600,
    },
    {
      source: bundle.caddyFile,
      target: "/etc/caddy/Caddyfile",
      mode: 0o644,
    },
    {
      source: bundle.serviceFile,
      target: "/etc/systemd/system/eportal-bot.service",
      mode: 0o644,
    },
  ];

  console.log("");
  console.log("Installing generated files:");

  for (const entry of targets) {
    const backup = await backupIfPresent(entry.target);
    if (backup) console.log(`  backup: ${backup}`);

    await ensureParent(entry.target);
    await fs.copyFile(entry.source, entry.target);
    await fs.chmod(entry.target, entry.mode).catch(() => {});
    console.log(`  wrote:  ${entry.target}`);
  }

  console.log("");
  console.log("Files installed. Review them before restarting services:");
  console.log("  sudo caddy validate --config /etc/caddy/Caddyfile");
  console.log("  sudo systemctl daemon-reload");
  console.log("  sudo systemctl enable --now eportal-bot");
  console.log("  sudo systemctl reload caddy");
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

try {
  console.log("NUTC Portal deployment configuration wizard");
  console.log("------------------------------------------");
  console.log("Mode: direct Cloudflare proxy + Access, no Cloudflare Tunnel");
  console.log("");

  const userInfo = os.userInfo();
  const hostname = await askValidated(rl, "Public Portal hostname", {
    defaultValue: process.env.PORTAL_HOSTNAME || "portal.example.com",
    validate: normalizeHostname,
  });

  const teamDomain = await askValidated(
    rl,
    "Cloudflare Access team domain",
    {
      defaultValue:
        process.env.CLOUDFLARE_ACCESS_TEAM_DOMAIN ||
        "https://YOUR-TEAM.cloudflareaccess.com",
      validate: (value) => {
        if (value.includes("YOUR-TEAM")) {
          throw new Error(
            "Replace YOUR-TEAM with the team domain shown in Cloudflare Zero Trust.",
          );
        }
        return normalizeTeamDomain(value);
      },
    },
  );

  const audience = await askValidated(
    rl,
    "Cloudflare Access Application AUD",
    {
      defaultValue: process.env.CLOUDFLARE_ACCESS_AUD || "",
      validate: normalizeAudience,
    },
  );

  const linuxUser = await askValidated(rl, "Linux service user", {
    defaultValue:
      process.env.SUDO_USER ||
      process.env.USER ||
      userInfo.username,
    validate: (value) => {
      const result = clean(value);
      if (!/^[a-z_][a-z0-9_-]*[$]?$/i.test(result)) {
        throw new Error("Enter a valid Linux username.");
      }
      return result;
    },
  });

  const linuxGroup = await askValidated(rl, "Linux service group", {
    defaultValue: linuxUser,
    validate: (value) => {
      const result = clean(value);
      if (!/^[a-z_][a-z0-9_-]*[$]?$/i.test(result)) {
        throw new Error("Enter a valid Linux group.");
      }
      return result;
    },
  });

  const repoPath = await askValidated(rl, "Repository path on server", {
    defaultValue: root,
    validate: (value) => normalizeAbsolutePath(value, "Repository path"),
  });

  const nodePath = await askValidated(rl, "Node executable path", {
    defaultValue: process.execPath,
    validate: (value) => normalizeAbsolutePath(value, "Node path"),
  });

  const certPath = await askValidated(
    rl,
    "Cloudflare Origin CA certificate path",
    {
      defaultValue: `/etc/caddy/certs/${hostname}-origin.pem`,
      validate: (value) =>
        normalizeAbsolutePath(value, "Certificate path"),
    },
  );

  const keyPath = await askValidated(
    rl,
    "Cloudflare Origin CA private-key path",
    {
      defaultValue: `/etc/caddy/certs/${hostname}-origin-key.pem`,
      validate: (value) =>
        normalizeAbsolutePath(value, "Private-key path"),
    },
  );

  const keepalive = await askValidated(
    rl,
    "ePortal keepalive interval (minutes)",
    {
      defaultValue: "10",
      validate: (value) => {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0 || number > 1440) {
          throw new Error("Enter a number from 0 to 1440.");
        }
        return String(number);
      },
    },
  );

  const bridgeTtl = await askValidated(
    rl,
    "Server login bridge lifetime (minutes)",
    {
      defaultValue: "15",
      validate: (value) => {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 1 || number > 1440) {
          throw new Error("Enter a number from 1 to 1440.");
        }
        return String(number);
      },
    },
  );

  console.log("");
  console.log("Cloudflare checklist:");
  console.log(`  DNS:    ${hostname} -> public IP, Proxied (orange cloud)`);
  console.log(`  Access: protect ${hostname} with your Allow policy`);
  console.log(`  Public: only ${hostname}/login* uses Bypass / Everyone`);
  console.log("  TLS:    Full (strict), using the Origin CA cert below");
  console.log("");

  const confirmed = await yesNo(
    rl,
    "Generate deployment files with these settings?",
    true,
  );

  if (!confirmed) {
    console.log("No files were changed.");
    process.exit(0);
  }

  const env = `# Generated by npm run deploy:configure
# Direct Cloudflare proxy + Access (no Tunnel).
HOST=127.0.0.1
PORT=4174

CLOUDFLARE_ACCESS_ENFORCE=1
CLOUDFLARE_ACCESS_TEAM_DOMAIN=${envQuote(teamDomain)}
CLOUDFLARE_ACCESS_AUD=${envQuote(audience)}

EPORTAL_RESTART_MODE=exit
EPORTAL_KEEPALIVE_MINUTES=${envQuote(keepalive)}
EPORTAL_LOGIN_BRIDGE_TTL_MINUTES=${envQuote(bridgeTtl)}
`;

  const caddy = `# Generated by npm run deploy:configure
# Cloudflare DNS for this hostname must remain Proxied (orange cloud).

${hostname} {
    tls ${caddyQuote(certPath)} ${caddyQuote(keyPath)}

    encode zstd gzip

    reverse_proxy 127.0.0.1:4174

    header {
        -Server
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
    }

    log {
        format console
    }
}
`;

  const service = `# Generated by npm run deploy:configure

[Unit]
Description=NUTC ePortal Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${linuxUser}
Group=${linuxGroup}
WorkingDirectory=${systemdValue(repoPath)}
EnvironmentFile=/etc/eportal-bot/eportal.env
ExecStart=${systemdValue(nodePath)} ${systemdValue(path.join(repoPath, "server.js"))}
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;

  const envFile = path.join(outputDir, "eportal.env");
  const caddyFile = path.join(outputDir, "Caddyfile");
  const serviceFile = path.join(outputDir, "eportal-bot.service");
  const summaryFile = path.join(outputDir, "README.txt");

  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  await writeFile(envFile, env, 0o600);
  await writeFile(caddyFile, caddy, 0o644);
  await writeFile(serviceFile, service, 0o644);

  const summary = `NUTC Portal deployment bundle

Hostname: ${hostname}
Node origin: http://127.0.0.1:4174
Cloudflare team: ${teamDomain}
Access AUD count: ${audience.split(",").length}

Generated:
  ${envFile}
  ${caddyFile}
  ${serviceFile}

Cloudflare configuration still required:
  1. DNS record for ${hostname} -> your public IP, Proxied/orange-clouded.
  2. Self-hosted Access app for ${hostname} with your Allow policy.
  3. More-specific Bypass/Everyone path for /login* only.
  4. SSL/TLS mode Full (strict).
  5. Install the matching Origin CA certificate at:
       ${certPath}
     and private key at:
       ${keyPath}

Install generated files:
  sudo cp ${envFile} /etc/eportal-bot/eportal.env
  sudo cp ${caddyFile} /etc/caddy/Caddyfile
  sudo cp ${serviceFile} /etc/systemd/system/eportal-bot.service

Then:
  sudo caddy validate --config /etc/caddy/Caddyfile
  sudo systemctl daemon-reload
  sudo systemctl enable --now eportal-bot
  sudo systemctl reload caddy

Verify app environment:
  set -a
  source /etc/eportal-bot/eportal.env
  set +a
  npm run deploy:check
`;

  await writeFile(summaryFile, summary, 0o600);

  console.log("");
  console.log("Generated deployment bundle:");
  console.log(`  ${envFile}`);
  console.log(`  ${caddyFile}`);
  console.log(`  ${serviceFile}`);
  console.log(`  ${summaryFile}`);

  if (args.has("--install")) {
    await installBundle({
      envFile,
      caddyFile,
      serviceFile,
    });
  } else {
    console.log("");
    console.log(
      "Review .deploy/README.txt, then copy the files into /etc when ready.",
    );
    console.log(
      "Or rerun with --install as root to install them with backups:",
    );
    console.log(
      "  sudo npm run deploy:configure -- --install",
    );
  }
} finally {
  rl.close();
}
