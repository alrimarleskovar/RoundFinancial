/**
 * Pre-mainnet operator script — Kamino program-id pin verification.
 *
 * The adapter's `KAMINO_LEND_PROGRAM_ID` hardcodes the Kamino Lend
 * program it CPIs into. The audit + the adapter's own module header
 * flag this as an operator check to re-run against Kamino's published
 * deploy address before EVERY mainnet adapter deploy.
 *
 * What this script does
 * ---------------------
 *   1. Reads the adapter source from disk and extracts the pinned
 *      `KAMINO_LEND_PROGRAM_ID` value (via the regex in `kamino-pin.ts`).
 *   2. Compares against `EXPECTED_KAMINO_LEND_PROGRAM_ID` (the canonical
 *      value pinned in `kamino-pin.ts`). Drift → exit non-zero with a
 *      side-by-side diff. The same check runs in `js` CI as a spec, so a
 *      regression should be caught there too; this script is the local
 *      "I'm about to deploy mainnet" gate.
 *   3. With `--verify-rpc` (or `KAMINO_VERIFY_RPC=true`), connects to
 *      `--rpc <url>` (or `RPC_URL`, default mainnet-beta) and confirms
 *      `getAccountInfo(KAMINO_LEND_PROGRAM_ID)` returns an existing,
 *      executable account. This catches a clean pin against an
 *      undeployed / decommissioned address.
 *
 * What this does NOT do
 * ---------------------
 *   - Verify the canonical reserve / market pair pinned at
 *     `init_vault(kamino_reserve, kamino_market)`. That belongs to a
 *     per-pool init-time check; the operator must paste the canonical
 *     reserve from Kamino governance into the init env (`KAMINO_RESERVE`)
 *     and re-run this script with `--reserve <pubkey>`. (Coming as
 *     a follow-up; the pinning of the PROGRAM is the load-bearing one.)
 *   - Verify the Kamino program's deployed bytecode is the canonical
 *     `klend` build. The Squads governance announcement + Anchor IDL
 *     hash are the operator's reference. This script proves the
 *     ADDRESS is correct and is deployed.
 *
 * Usage
 * -----
 *
 *   pnpm verify:kamino-pin                      # source check only
 *   pnpm verify:kamino-pin --verify-rpc         # + RPC liveness
 *   pnpm verify:kamino-pin --rpc <url>          # use a custom RPC
 *   KAMINO_VERIFY_RPC=true pnpm verify:kamino-pin
 *
 * Exits non-zero on any failure.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { Connection, PublicKey } from "@solana/web3.js";

import {
  ADAPTER_LIB_RS_RELATIVE_PATH,
  EXPECTED_KAMINO_LEND_PROGRAM_ID,
  verifyKaminoPin,
} from "./kamino-pin.js";

interface CliArgs {
  verifyRpc: boolean;
  rpcUrl: string;
  rootDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    verifyRpc:
      argv.includes("--verify-rpc") || process.env.KAMINO_VERIFY_RPC?.toLowerCase() === "true",
    rpcUrl: process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
    rootDir: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--rpc" && argv[i + 1]) {
      args.rpcUrl = argv[i + 1]!;
      i += 1;
    } else if (a === "--root" && argv[i + 1]) {
      args.rootDir = resolve(argv[i + 1]!);
      i += 1;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`━━━ verify-kamino-pin ━━━`);
  console.log(`  root: ${args.rootDir}`);
  console.log(`  expected: ${EXPECTED_KAMINO_LEND_PROGRAM_ID}`);

  // ─── Step 1: read source + extract pinned value ─────────────────────
  const libRsPath = resolve(args.rootDir, ADAPTER_LIB_RS_RELATIVE_PATH);
  if (!existsSync(libRsPath)) {
    console.error(`✗ adapter source not found at ${libRsPath}`);
    console.error(`  (run from the repo root, or pass --root <path>)`);
    process.exit(1);
  }
  const source = readFileSync(libRsPath, "utf8");

  const verdict = verifyKaminoPin({ source });
  if (!verdict.ok && verdict.reason === "extraction_failed") {
    console.error(
      `✗ could not extract KAMINO_LEND_PROGRAM_ID from ${ADAPTER_LIB_RS_RELATIVE_PATH}`,
    );
    console.error(
      `  the regex in kamino-pin.ts expects the canonical const shape; ` +
        `if you reshaped the const, update the extractor in the same PR.`,
    );
    process.exit(1);
  }
  if (!verdict.ok && verdict.reason === "drift") {
    console.error(`✗ pinned KAMINO_LEND_PROGRAM_ID drifted from canonical:`);
    console.error(`    expected: ${verdict.expected}`);
    console.error(`    on-disk:  ${verdict.pinned}`);
    console.error(
      `  if Kamino rotated the program (governance / redeploy), update BOTH ` +
        `kamino-pin.ts::EXPECTED_KAMINO_LEND_PROGRAM_ID AND the adapter const ` +
        `in the same PR, with a citation to Kamino's published announcement.`,
    );
    process.exit(1);
  }
  console.log(`✓ source-pin matches canonical (${verdict.pinned})`);

  // ─── Step 2 (optional): RPC liveness check ──────────────────────────
  if (!args.verifyRpc) {
    console.log(`  (skipped RPC check — pass --verify-rpc to enable)`);
    console.log(`\n━━━ verify-kamino-pin: PASS ━━━`);
    return;
  }
  console.log(`  rpc: ${args.rpcUrl}`);

  let info: Awaited<ReturnType<Connection["getAccountInfo"]>>;
  try {
    const conn = new Connection(args.rpcUrl, "confirmed");
    info = await conn.getAccountInfo(new PublicKey(verdict.pinned), "confirmed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ RPC fetch failed: ${msg}`);
    process.exit(1);
  }

  if (!info) {
    console.error(
      `✗ no account at ${verdict.pinned} on ${args.rpcUrl} — program is NOT deployed there.`,
    );
    process.exit(1);
  }
  if (!info.executable) {
    console.error(
      `✗ account at ${verdict.pinned} exists but is NOT executable — ` +
        `the pinned address points at a data account, not a program.`,
    );
    process.exit(1);
  }
  console.log(`✓ RPC: program is deployed + executable (owner=${info.owner.toBase58()})`);
  console.log(`\n━━━ verify-kamino-pin: PASS ━━━`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
