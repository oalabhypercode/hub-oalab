import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

/** Loads .env.local (BOM-safe) without overriding variables that are already set. Values are never printed. */
export async function loadLocalEnv() {
  const file = new URL("../../.env.local", import.meta.url);
  if (!existsSync(file)) return;
  const values = parseEnv((await readFile(file, "utf8")).replace(/^﻿/, ""));
  for (const [name, value] of Object.entries(values)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
}
