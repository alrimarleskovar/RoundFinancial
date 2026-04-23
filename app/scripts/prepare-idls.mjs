#!/usr/bin/env node
// Copy Anchor-built IDLs from <repo>/target/idl/ into app/public/idls/
// so the browser can fetch them at runtime from /idls/<name>.json.
//
// Run after `anchor build` and before starting real mode in the app:
//   pnpm --filter @roundfi/app prepare-idls

import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const targetDir = resolve(repoRoot, "target", "idl");
const publicDir = resolve(here, "..", "public", "idls");

const required = [
  "roundfi_core.json",
  "roundfi_reputation.json",
  "roundfi_yield_mock.json",
];

if (!existsSync(targetDir)) {
  console.error(
    `[prepare-idls] target/idl/ not found at ${targetDir}.\n` +
      `               Run 'anchor build' from the repo root first.`,
  );
  process.exit(1);
}

mkdirSync(publicDir, { recursive: true });

const missing = [];
for (const file of required) {
  const from = resolve(targetDir, file);
  if (!existsSync(from)) {
    missing.push(file);
    continue;
  }
  const to = resolve(publicDir, file);
  copyFileSync(from, to);
  console.log(`[prepare-idls] ${file}  →  app/public/idls/${file}`);
}

if (missing.length) {
  console.error(
    `[prepare-idls] Missing IDLs: ${missing.join(", ")}. ` +
      `Ensure every program compiled under 'anchor build'.`,
  );
  process.exit(1);
}
console.log(`[prepare-idls] done (${required.length} IDL(s) copied).`);
