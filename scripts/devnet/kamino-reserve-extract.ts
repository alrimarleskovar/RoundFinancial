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
 *   # Step 1 (recommended): auto-discover the USDC reserve pubkey on Main Market
 *   # via getProgramAccounts filtered by lending_market + liquidity.mint:
 *   pnpm tsx scripts/devnet/kamino-find-usdc-reserve.ts
 *
 *   # Step 2: dump the reserve account (validated 2026-05-24 — Main Market USDC
 *   # reserve is D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59):
 *   solana account D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59 \
 *     --url mainnet-beta --output json > /tmp/kamino-usdc-reserve.json
 *
 *   pnpm tsx scripts/devnet/kamino-reserve-extract.ts /tmp/kamino-usdc-reserve.json
 *
 * Output: pubkeys + ready-to-run `solana account` commands for each
 * dependency. Re-runnable; idempotent.
 *
 * KNOWN ISSUES (2026-05-24 discovery — flagged for future fix):
 *   1. lending_market_authority PDA derivation at line ~83-84 uses
 *      `findProgramAddressSync([lendingMarket], KAMINO_LEND_PROGRAM_ID)` which
 *      returns the *canonical* PDA bump (the highest valid bump). Production
 *      Kamino reserves use a *stored* bump from the lending_market account's
 *      `bump_seed` field, so the derived address does NOT match the real on-
 *      chain authority. For USDC Main Market reserve, the real authority is
 *      `9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo`, not what this script
 *      derives. Validation: the c-token mint's `mint_authority` field is the
 *      authoritative source.
 *      Fix: read bump_seed from the lending_market account data and call
 *      `createProgramAddressSync` with that bump explicitly.
 *
 *   2. The "no clone needed" guidance below for `lending_market_authority` is
 *      misleading — the bankrun test harness (`tests/_harness/kamino_fixtures.ts`
 *      line 113) DOES require a `lending-market-authority.json` file. For
 *      production reserves the account exists on-chain and can be dumped via
 *      `solana account <real_pda> --url mainnet-beta --output json > ...`. For
 *      synthetic test states, an empty-data JSON pointing to the real PDA
 *      pubkey works.
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
  // ReserveLiquidity actual size: 1232 bytes (empirically confirmed
  // May 2026 via brute-force scan + mint-account validation on the
  // USDC reserve D6q6wuQS...). Original best-effort was 1264; the
  // BigFractionBytes type is smaller than assumed (likely 24 bytes
  // [u8; 24] rather than [u8; 32]).
  // Plus reserve_liquidity_padding [u64; 150] = 1200 bytes.
  // So ReserveCollateral starts at: 120 + 1232 + 1200 = 2552.
  // C-token mint is the first 32 bytes of ReserveCollateral.
  //
  // Validation reference: in the USDC reserve D6q6wuQS... (Main Market,
  // validated 2026-05-24 — see `kamino-find-usdc-reserve.ts`), the c-token
  // mint at offset 2552 is B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D
  // (Mint, space=82, owned by SPL Token, mint_authority =
  // 9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo = real on-chain
  // lending_market_authority — NOT the canonical-bump PDA AbTz488... that
  // this script's `findProgramAddressSync` derives; see KNOWN ISSUES #1 in
  // the file header). The collateral.supply_vault at offset 2592 is
  // 3DzjXRfxRm6iejfyyMynR4tScddaanrePJ1NJU2XnPPL (Token Account,
  // space=165). Both confirm the offset.
  collateralMint: 2552,
  collateralSupplyVault: 2592,
} as const;

// Kamino's lending_market_authority PDA is derived from the lending
// market pubkey + the klend program. Documented in klend's
// `LendingMarket` impl: `seeds = [lending_market.key().as_ref()]`.
// We need this as a `kamino_market_authority` account in our wrapper's
// CPI — it's a signer derived by Kamino's program at CPI time.
const KAMINO_LEND_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");

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
  const collateralMint =
    data.length >= OFFSETS.collateralMint + 32 ? pubkeyAt(data, OFFSETS.collateralMint) : null;
  const collateralSupplyVault =
    data.length >= OFFSETS.collateralSupplyVault + 32
      ? pubkeyAt(data, OFFSETS.collateralSupplyVault)
      : null;

  // Derive Kamino's lending_market_authority PDA.
  const [marketAuthority] = PublicKey.findProgramAddressSync(
    [lendingMarket.toBuffer()],
    KAMINO_LEND_PROGRAM_ID,
  );

  console.log(`│ lending_market:         ${lendingMarket.toBase58()}`);
  console.log(`│ lending_market_auth:    ${marketAuthority.toBase58()}  (derived PDA)`);
  console.log(`│ liquidity.mint_pubkey:  ${liquidityMint.toBase58()}`);
  console.log(`│ liquidity.supply_vault: ${liquiditySupply.toBase58()}`);
  console.log(`│ liquidity.fee_vault:    ${liquidityFeeVault.toBase58()}`);
  if (collateralMint) {
    console.log(`│ collateral.mint_pubkey: ${collateralMint.toBase58()}  (c-token mint)`);
  }
  if (collateralSupplyVault) {
    console.log(
      `│ collateral.supply_vault: ${collateralSupplyVault.toBase58()}  (Kamino c-token vault)`,
    );
  }
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
  if (collateralMint) {
    accountsToClone.push(["c-token-mint", collateralMint]);
  }
  if (collateralSupplyVault) {
    accountsToClone.push(["collateral-supply-vault", collateralSupplyVault]);
  }
  for (const [label, pk] of accountsToClone) {
    console.log(
      `  solana account ${pk.toBase58()} --url mainnet-beta --output json > tests/fixtures/kamino/${label}.json`,
    );
  }
  console.log("");
  console.log("⚠️  lending_market_authority — REQUIRED as a fixture for bankrun tests");
  console.log("   (tests/_harness/kamino_fixtures.ts:113 loads lending-market-authority.json).");
  console.log("   The derived PDA below is the CANONICAL bump — production Kamino reserves");
  console.log("   use a STORED bump from lending_market.bump_seed, so the real on-chain");
  console.log("   authority may differ. To find the REAL authority, read the c-token");
  console.log("   mint's mint_authority field via Solscan or:");
  console.log("");
  console.log(
    `     solana account ${collateralMint?.toBase58() ?? "<c-token-mint>"} --url mainnet-beta`,
  );
  console.log("");
  console.log("   For the Main Market USDC reserve, the real authority is:");
  console.log("     9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo");
  console.log("   (validated 2026-05-24 via Phase 2b CPI tests — see CHANGELOG).");
  console.log("");
  console.log("   To dump as fixture (real account exists on-chain):");
  console.log(
    "     solana account <real_authority_pubkey> --url mainnet-beta --output json > tests/fixtures/kamino/lending-market-authority.json",
  );
  console.log("");
  console.log("   Canonical-bump PDA (for reference, may NOT match production):");
  console.log(`  PDA: ${marketAuthority.toBase58()}`);
  console.log(`  seeds: [<lending-market-pubkey>] = [${lendingMarket.toBase58()}]`);
  console.log(`  program: ${KAMINO_LEND_PROGRAM_ID.toBase58()}`);

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
  console.log("Verification step — cross-check `collateral.mint_pubkey` via Solscan:");
  console.log(`  https://solscan.io/account/${accountPubkey ?? "<RESERVE_PUBKEY>"}#anchorData`);
  console.log("  Look for the `collateral.mintPubkey` field. If it doesn't match the value above,");
  console.log("  the offset for `collateralMint` in this script is wrong and needs adjustment.");
  console.log("");
  console.log("Still unknown (not extracted by this script):");
  console.log("  - Scope oracle prices PDA (reserve.config.token_info.oracle.scope)");
  console.log("    → find via Solscan anchor decoder under config.tokenInfo.scopeConfiguration");
}

main();
