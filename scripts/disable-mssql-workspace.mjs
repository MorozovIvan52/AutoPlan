#!/usr/bin/env node
/** Writes workspace recommendation to disable MSSQL extension SQL checking. */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const settingsPath = join(process.cwd(), ".vscode", "settings.json");
const patch = {
  "mssql.intelliSense.enableErrorChecking": false,
  "files.associations": { "*.pgsql": "pgsql" },
};
let current = {};
if (existsSync(settingsPath)) {
  try { current = JSON.parse(readFileSync(settingsPath, "utf8")); } catch { /* */ }
}
writeFileSync(settingsPath, JSON.stringify({ ...current, ...patch }, null, 2) + "\n");
console.log("Updated .vscode/settings.json for PostgreSQL workspace");
