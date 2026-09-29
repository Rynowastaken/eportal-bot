#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

function hasCommand(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function readOsRelease() {
  try {
    return fs.readFileSync("/etc/os-release", "utf8");
  } catch {
    return "";
  }
}

const osRelease = readOsRelease();

if (process.platform !== "linux") {
  run("npx", ["playwright", "install", "chromium"]);
  process.exit(0);
}

if (hasCommand("apt-get")) {
  run("npx", ["playwright", "install", "--with-deps", "chromium"]);
  process.exit(0);
}

if (hasCommand("pacman")) {
  console.log(
    "Arch/pacman-based Linux detected. Installing Chromium runtime libraries with pacman...",
  );

  const packages = [
    "alsa-lib",
    "at-spi2-core",
    "cairo",
    "dbus",
    "expat",
    "fontconfig",
    "freetype2",
    "glib2",
    "gtk3",
    "harfbuzz",
    "libcups",
    "libdrm",
    "libffi",
    "libjpeg-turbo",
    "libpulse",
    "libwebp",
    "libx11",
    "libxcb",
    "libxcomposite",
    "libxdamage",
    "libxext",
    "libxfixes",
    "libxkbcommon",
    "libxrandr",
    "libxss",
    "mesa",
    "nspr",
    "nss",
    "pango",
    "systemd-libs",
    "ttf-liberation",
  ];

  run("sudo", ["pacman", "-S", "--needed", ...packages]);
  run("npx", ["playwright", "install", "chromium"]);
  process.exit(0);
}

console.error(
  [
    "This Linux distribution is not supported by Playwright's automatic dependency installer.",
    osRelease.trim()
      ? "Detected /etc/os-release:\n" + osRelease.trim()
      : "Could not read /etc/os-release.",
    "",
    "Install your distribution's Chromium runtime libraries, then run:",
    "  npx playwright install chromium",
    "  npm run doctor",
  ].join("\n"),
);
process.exit(1);
