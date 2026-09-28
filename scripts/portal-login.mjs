#!/usr/bin/env node

import process from "node:process";
import { loginServerPortal } from "../src/portal-session.js";

try {
  await loginServerPortal();
} catch (error) {
  console.error("[-] Server ePortal login failed:", error?.message || error);
  process.exitCode = 1;
}
