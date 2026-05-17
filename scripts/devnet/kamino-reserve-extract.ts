/**
 * Kamino USDC reserve introspector — Phase 2b cascade-clone prep.
 *
 * Parses a Solana reserve account (output of `solana account --output json`)
 * and prints the nested pubkeys our Phase 2b bankrun spec needs to clone
 * from mainnet, plus the `solana account` commands ready to copy-paste.
 *
 * Offsets are derived from `klend/programs/klend/src/state/reserve.rs`
 * (Kamino-Finance/klend, master branch as of May 2026):
 *
 *   #[account(zero_copy)] #[repr(C)]
 *   pub struct Reserve {
 *       pub version: u64,                  // 8 bytes
 *       pub last_update: LastUpdate,       // 16 bytes (u64 slot + u8 stale + padding)
 *       pub lending_market: Pubkey,        // 32 bytes
 *       pub farm_collateral: Pubkey,       // 32 bytes
 *       pub farm_debt: Pubkey,             // 32 bytes
 *       pub liquidity: ReserveLiquidity,   // begins at offset 120
 *       ...
 *   }
 *
 *   ReserveLiquidity layout (offsets relative to its own start):
 *     0..32   mint_pubkey      ← USDC mint (canonical EPjFW...)
 *     32..64  supply_vault     ← Kamino's USDC vault (we deposit INTO this)
 *     64..96  fee_vault        ← Kamino's USDC fee receiver
 *
 * Account data starts with 8-byte Anchor discriminator, so we add 8 to
 * every offset when slicing the raw `data` buffer.
 *
 * Usage:
 *
 *   solana account HV9KsS5mB4b9CFhDJVKdfxWBAomYfUk5PeUsdgMQsUrB \
 *     --url mainnet-beta --output json > /tmp/kamino-usdc-reserve.json
 *
 *   pnpm tsx scripts/devnet/kamino-reserve-extract.ts /tmp/kamino-usdc-reserve.json
 *
 * Output: pubkeys + ready-to-run `solana account` commands for each
 * dependency. Re-runnable; idempotent.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PublicKey } from "@solana/web3.js";

// Offsets within Reserve account data (AFTER the 8-byte Anchor discriminator)
const OFFSETS = {
  // top-level Reserve fields
  version: 0,
  lastUpdate: 8, // 16 bytes (slot u64 + stale u8 + padding)
  lendingMarket: 8 + 16, // 24
  farmCollateral: 8 + 16 + 32, // 56
  farmDebt: 8 + 16 + 32 + 32, // 88
  // liquidity starts at offset 120 (post version + last_update + 3 pubkeys)
  liquidityStart: 8 + 16 + 32 + 32 + 32, // 120
  // within ReserveLiquidity:
  liquidityMint: 120 + 0,
  liquiditySupply: 120 + 32,
  liquidityFeeVault: 120 + 64,
} as const;

const ANCHOR_DISC_SIZE = 8;

function pubkeyAt(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error("Usage: pnpm tsx scripts/devnet/kamino-reserve-extract.ts <reserve-json-path>");
    console.error("");
    console.error("Get the JSON first:");
    console.error("  solana account HV9KsS5mB4b9CFhDJVKdfxWBAomYfUk5PeUsdgMQsUrB \\");
    console.error("    --url mainnet-beta --output json > /tmp/kamino-usdc-reserve.json");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(resolve(jsonPath), "utf-8"));
  const accountPubkey = raw.account?.data ? raw.pubkey : null;
  const dataField = raw.account?.data ?? raw.data;
  if (!dataField || !Array.isArray(dataField) || dataField[0] === undefined) {
    console.error(
      "Could not find `account.data` field in JSON. Run `solana account ... --output json` and pipe to file.",
    );
    process.exit(1);
  }

  const [base64Str, encoding] = dataField as [string, string];
  if (encoding !== "base64") {
    console.error(`Expected encoding "base64", got "${encoding}".`);
    process.exit(1);
  }
  const raw_data = Buffer.from(base64Str, "base64");

  // Skip the 8-byte Anchor discriminator.
  const data = raw_data.subarray(ANCHOR_DISC_SIZE);

  console.log("");
  console.log("┌──────────────────────────────────────────────────────────────");
  console.log("│ Kamino Reserve — parsed dependencies");
  console.log("├──────────────────────────────────────────────────────────────");
  console.log(`│ Reserve account:        ${accountPubkey ?? "(no pubkey field in input)"}`);
  console.log(`│ Data size (post-disc):  ${data.length} bytes`);
  console.log(`│ Version:                ${data.readBigUInt64LE(OFFSETS.version)}`);
  console.log("├──────────────────────────────────────────────────────────────");

  const lendingMarket = pubkeyAt(data, OFFSETS.lendingMarket);
  const liquidityMint = pubkeyAt(data, OFFSETS.liquidityMint);
  const liquiditySupply = pubkeyAt(data, OFFSETS.liquiditySupply);
  const liquidityFeeVault = pubkeyAt(data, OFFSETS.liquidityFeeVault);

  console.log(`│ lending_market:         ${lendingMarket.toBase58()}`);
  console.log(`│ liquidity.mint_pubkey:  ${liquidityMint.toBase58()}`);
  console.log(`│ liquidity.supply_vault: ${liquiditySupply.toBase58()}`);
  console.log(`│ liquidity.fee_vault:    ${liquidityFeeVault.toBase58()}`);
  console.log("└──────────────────────────────────────────────────────────────");

  // Sanity check: liquidity.mint_pubkey should be the canonical USDC mint
  // on mainnet (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v).
  const CANONICAL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  if (liquidityMint.toBase58() !== CANONICAL_USDC) {
    console.log("");
    console.log(
      `⚠️  WARNING: liquidity.mint_pubkey does NOT match canonical USDC (${CANONICAL_USDC}).`,
    );
    console.log("   Either this is not the USDC reserve, or byte offsets are wrong.");
    console.log("   Cross-check with Solscan before proceeding.");
  } else {
    console.log("");
    console.log("✅ liquidity.mint_pubkey matches canonical USDC mint — offsets look correct.");
  }

  console.log("");
  console.log(
    "Next step — run these `solana account` commands to dump each dependency to JSON fixtures:",
  );
  console.log("");
  console.log("  mkdir -p tests/fixtures/kamino");
  console.log("");
  const accountsToClone: Array<[string, PublicKey]> = [
    ["lending-market", lendingMarket],
    ["usdc-mint", liquidityMint],
    ["reserve-liquidity-supply", liquiditySupply],
    ["reserve-fee-vault", liquidityFeeVault],
  ];
  for (const [label, pk] of accountsToClone) {
    console.log(
      `  solana account ${pk.toBase58()} --url mainnet-beta --output json > tests/fixtures/kamino/${label}.json`,
    );
  }

  console.log("");
  console.log("Reserve account itself (for the bankrun spec to seed it):");
  if (accountPubkey) {
    console.log(
      `  solana account ${accountPubkey} --url mainnet-beta --output json > tests/fixtures/kamino/reserve.json`,
    );
  } else {
    console.log(
      "  solana account <RESERVE_PUBKEY> --url mainnet-beta --output json > tests/fixtures/kamino/reserve.json",
    );
  }

  console.log("");
  console.log("Note: collateral.mint_pubkey (the c-token mint that Anchor's");
  console.log("`associated_token::mint = kamino_reserve_collateral_mint` constraint");
  console.log("expects) requires parsing the ReserveCollateral struct, which sits");
  console.log("at offset 120 + sizeof(ReserveLiquidity) + 1200 (padding [u64; 150])");
  console.log("inside the Reserve account. This script's offsets cover the high-confidence");
  console.log("fields; for the c-token mint, use Solscan's Anchor decoder or klend-sdk.");
  console.log("Cross-reference with the Reserve account's data on Solscan to verify.");
}

main();
