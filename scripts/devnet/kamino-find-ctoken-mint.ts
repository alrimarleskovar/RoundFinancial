/**
 * Brute-force scan to find c-token mint in a Kamino reserve.
 *
 * The reserve's `collateral.mint_pubkey` lives somewhere after the
 * `liquidity` block. My best-effort offset (2584) was wrong — empirical
 * evidence: the address it produced wasn't a valid on-chain account.
 *
 * This script scans candidate pubkey-aligned positions in the range
 * 2400..2700 (post-discriminator) and prints all candidates that look
 * like real pubkeys (non-zero, not all-FF). The user then runs
 * `solana account <pubkey>` on each to find the one that exists and
 * has the right `mint_authority` (= lending_market_authority PDA).
 *
 * Usage:
 *
 *   pnpm tsx scripts/devnet/kamino-find-ctoken-mint.ts tests/fixtures/kamino/reserve.json
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PublicKey } from "@solana/web3.js";

const ANCHOR_DISC_SIZE = 8;
const SCAN_START = 2400;
const SCAN_END = 2800;
const STEP = 8; // 8-byte alignment is standard for Solana structs

function isLikelyPubkey(buf: Buffer): boolean {
  // Reject all-zero (uninitialized padding)
  let nonZero = false;
  for (const b of buf) {
    if (b !== 0) {
      nonZero = true;
      break;
    }
  }
  if (!nonZero) return false;
  // Reject all-FF (also uninitialized in some cases)
  let allFF = true;
  for (const b of buf) {
    if (b !== 0xff) {
      allFF = false;
      break;
    }
  }
  if (allFF) return false;
  return true;
}

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error("Usage: pnpm tsx scripts/devnet/kamino-find-ctoken-mint.ts <reserve-json-path>");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(resolve(jsonPath), "utf-8"));
  const dataField = raw.account?.data ?? raw.data;
  const [base64Str] = dataField as [string, string];
  const data = Buffer.from(base64Str, "base64").subarray(ANCHOR_DISC_SIZE);

  console.log("");
  console.log(`Scanning offsets ${SCAN_START}..${SCAN_END} (post-discriminator) in 8-byte steps:`);
  console.log("");

  // Print pubkey candidates at every 8-byte aligned offset
  for (let offset = SCAN_START; offset <= SCAN_END - 32; offset += STEP) {
    const slice = data.subarray(offset, offset + 32);
    if (!isLikelyPubkey(slice)) continue;
    const pk = new PublicKey(slice);
    console.log(`  offset ${String(offset).padStart(4, " ")}: ${pk.toBase58()}`);
  }

  console.log("");
  console.log("Test each candidate with:");
  console.log("");
  console.log("  for PK in <paste each pubkey above>; do");
  console.log('    echo "=== $PK ==="');
  console.log("    solana account $PK --url mainnet-beta --output json-compact 2>&1 | head -3");
  console.log("  done");
  console.log("");
  console.log("The c-token mint is the one that:");
  console.log("  (a) exists on mainnet (no 'AccountNotFound' error)");
  console.log("  (b) is owned by SPL Token program (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)");
  console.log(
    "  (c) has mint_authority = AbTz488RL5G2WfbbZ6PkyGi6UVyLWAcUeRWihGwR46k4 (lending_market_authority)",
  );
}

main();
