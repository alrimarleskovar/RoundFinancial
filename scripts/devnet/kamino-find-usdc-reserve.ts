/**
 * Auto-discover Kamino's USDC reserve on the main market.
 *
 * Why this exists: the main market has multiple reserves (USDC, USDT,
 * SOL, JLP, pSOL, JitoSOL, etc). Guessing-by-address-and-checking
 * surfaced that `HV9KsS5...` is NOT the USDC reserve (its liquidity
 * mint is `pSo1f9n...` — a pSOL variant). This script enumerates
 * ALL reserves on the main market via getProgramAccounts filtered by
 * the `lending_market` field offset, then identifies the USDC one by
 * matching its `liquidity.mint_pubkey` against the canonical USDC mint.
 *
 * Output: the USDC reserve pubkey + a printed command to re-run the
 * existing `kamino-reserve-extract.ts` against it.
 *
 * Usage:
 *
 *   pnpm tsx scripts/devnet/kamino-find-usdc-reserve.ts
 *
 * Optional env:
 *   RPC_URL=https://api.mainnet-beta.solana.com (default)
 */

import { Connection, PublicKey } from "@solana/web3.js";

const KAMINO_LEND_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
const MAIN_MARKET = new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// Reserve struct layout (verified by kamino-reserve-extract.ts run on
// HV9KsS5...): offsets below are post 8-byte Anchor discriminator.
//   0..8:    version: u64
//   8..24:   last_update: LastUpdate
//   24..56:  lending_market: Pubkey   ← filter target
//   56..88:  farm_collateral: Pubkey
//   88..120: farm_debt: Pubkey
//   120..152: liquidity.mint_pubkey   ← we identify USDC reserve by this
const ANCHOR_DISC_SIZE = 8;
const LENDING_MARKET_OFFSET_IN_DATA = ANCHOR_DISC_SIZE + 8 + 16; // 32
const LIQUIDITY_MINT_OFFSET_IN_DATA = ANCHOR_DISC_SIZE + 120; // 128

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  console.log("");
  console.log(`Querying ${rpcUrl} for all Kamino reserves on main market...`);
  console.log(`Main market: ${MAIN_MARKET.toBase58()}`);
  console.log(`Looking for: liquidity.mint_pubkey == ${USDC_MINT.toBase58()}`);
  console.log("");

  // Filter all program accounts that have lending_market matching the
  // main market at the expected byte offset. Skip the dataSize filter
  // for tolerance — different reserve versions may have different sizes.
  const accounts = await connection.getProgramAccounts(KAMINO_LEND_PROGRAM_ID, {
    filters: [
      {
        memcmp: {
          offset: LENDING_MARKET_OFFSET_IN_DATA,
          bytes: MAIN_MARKET.toBase58(),
        },
      },
    ],
  });

  console.log(`Found ${accounts.length} accounts on main market.`);
  console.log("");

  const matches: Array<{ pubkey: PublicKey; mint: PublicKey }> = [];
  for (const { pubkey, account } of accounts) {
    if (account.data.length < LIQUIDITY_MINT_OFFSET_IN_DATA + 32) continue;
    const mint = new PublicKey(
      account.data.subarray(LIQUIDITY_MINT_OFFSET_IN_DATA, LIQUIDITY_MINT_OFFSET_IN_DATA + 32),
    );
    matches.push({ pubkey, mint });
  }

  console.log("All reserves on main market (pubkey → liquidity mint):");
  for (const { pubkey, mint } of matches) {
    const isUsdc = mint.equals(USDC_MINT);
    console.log(
      `  ${isUsdc ? "✅" : "  "} ${pubkey.toBase58()}  →  ${mint.toBase58()}${isUsdc ? "  (USDC)" : ""}`,
    );
  }
  console.log("");

  const usdcReserves = matches.filter((m) => m.mint.equals(USDC_MINT));
  if (usdcReserves.length === 0) {
    console.error(
      "❌ No USDC reserve found on main market. Either the market migrated USDC away, or the byte offsets are wrong.",
    );
    process.exit(1);
  }
  if (usdcReserves.length > 1) {
    console.warn(
      `⚠️  Found ${usdcReserves.length} reserves matching USDC mint. Main market typically has 1 USDC reserve. Investigate manually:`,
    );
    for (const r of usdcReserves) console.warn(`   ${r.pubkey.toBase58()}`);
    process.exit(2);
  }

  const usdcReserve = usdcReserves[0]!.pubkey;
  console.log(`USDC reserve on Kamino main market: ${usdcReserve.toBase58()}`);
  console.log("");
  console.log("Next step — dump the reserve and re-run the extract script:");
  console.log("");
  console.log(
    `  solana account ${usdcReserve.toBase58()} --url mainnet-beta --output json > /tmp/kamino-usdc-reserve.json`,
  );
  console.log("  pnpm tsx scripts/devnet/kamino-reserve-extract.ts /tmp/kamino-usdc-reserve.json");
}

main().catch((err) => {
  console.error("Discovery failed:", err);
  process.exit(99);
});
