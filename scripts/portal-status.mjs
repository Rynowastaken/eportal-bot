#!/usr/bin/env node

import process from "node:process";
import { checkServerPortalStatus } from "../src/portal-session.js";

const status = await checkServerPortalStatus();
console.log(JSON.stringify(status, null, 2));

if (!status.valid) {
  process.exitCode = status.status === "error" ? 2 : 1;
}
