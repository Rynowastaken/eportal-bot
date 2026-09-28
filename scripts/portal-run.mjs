#!/usr/bin/env node

import process from "node:process";
import { openAisWithServerSession } from "../src/portal-session.js";

let session;

try {
  session = await openAisWithServerSession({ headless: true });
  console.log("[+] Server ePortal session is valid.");
  console.log("[+] AIS SSO completed in headless Chromium.");
} catch (error) {
  console.error("[-]", error?.message || error);
  process.exitCode = error?.code === "EPORTAL_LOGIN_REQUIRED" ? 3 : 1;
} finally {
  if (session?.context) {
    await session.context.close().catch(() => {});
  }
}
