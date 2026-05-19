/**
 * Helper: load mainnet-cloned account snapshots from JSON files and
 * seed them into bankrun via `context.setAccount`. The JSONs are
 * produced by `solana account <pubkey> --url mainnet-beta --output json`.
 *
 * Each fixture file has shape:
 *
 *   {
 *     "pubkey": "...",
 *     "account": {
 *       "lamports": 12345,
 *       "data": ["base64string", "base64"],
 *       "owner": "...",
 *       "executable": false,
 *       "rentEpoch": 18446744073709551615,
 *       "space": 82
 *     }
 *   }
 *
 * Phase 2b reads these to populate the bankrun env with Kamino's
 * real on-chain state (reserve, lending market, c-token mint, etc),
 * so when our wrapper's CPI fires, klend's account-validation code
 * sees real data shapes.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AccountInfoBytes, ProgramTestContext } from "solana-bankrun";
import { PublicKey } from "@solana/web3.js";

export interface MainnetCloneSnapshot {
  pubkey: PublicKey;
  account: AccountInfoBytes;
}

/**
 * Read a `solana account --output json` dump file and return a
 * `{ pubkey, account }` pair ready for `context.setAccount(pubkey, account)`.
 */
export function loadMainnetClone(jsonPath: string): MainnetCloneSnapshot {
  const raw = JSON.parse(readFileSync(resolve(jsonPath), "utf-8"));
  if (!raw.pubkey || !raw.account) {
    throw new Error(
      `Invalid mainnet-clone JSON at ${jsonPath} — expected { pubkey, account } shape. ` +
        `Re-run: solana account <pubkey> --url mainnet-beta --output json > ${jsonPath}`,
    );
  }
  const [base64Str, encoding] = raw.account.data as [string, string];
  if (encoding !== "base64") {
    throw new Error(`Expected base64 encoding, got ${encoding} in ${jsonPath}`);
  }
  return {
    pubkey: new PublicKey(raw.pubkey),
    account: {
      lamports: Number(raw.account.lamports),
      data: new Uint8Array(Buffer.from(base64Str, "base64")),
      owner: new PublicKey(raw.account.owner),
      executable: Boolean(raw.account.executable),
      // rentEpoch from CLI is u64::MAX (account never collected); cap
      // at MAX_SAFE_INTEGER for AccountInfoBytes' number type. bankrun
      // doesn't gate on this field.
      rentEpoch: 0,
    },
  };
}

/**
 * Load + seed in one step. Returns the loaded snapshot for convenience.
 */
export function seedMainnetClone(
  context: ProgramTestContext,
  jsonPath: string,
): MainnetCloneSnapshot {
  const snapshot = loadMainnetClone(jsonPath);
  context.setAccount(snapshot.pubkey, snapshot.account);
  return snapshot;
}

export interface KaminoFixtures {
  reserve: MainnetCloneSnapshot;
  lendingMarket: MainnetCloneSnapshot;
  lendingMarketAuthority: MainnetCloneSnapshot;
  usdcMint: MainnetCloneSnapshot;
  cTokenMint: MainnetCloneSnapshot;
  reserveLiquiditySupply: MainnetCloneSnapshot;
  reserveFeeVault: MainnetCloneSnapshot;
  collateralSupplyVault: MainnetCloneSnapshot;
}

/**
 * Convenience: load all 8 Kamino USDC reserve cascade-clone fixtures
 * from `tests/fixtures/kamino/`. Throws with a clear setup message
 * if any are missing.
 */
export function loadAllKaminoFixtures(): KaminoFixtures {
  const dir = resolve(process.cwd(), "tests", "fixtures", "kamino");
  const load = (fname: string): MainnetCloneSnapshot => {
    try {
      return loadMainnetClone(resolve(dir, fname));
    } catch (err) {
      throw new Error(
        `Missing Kamino fixture ${fname}.\n` +
          `Pre-flight: run the dump commands documented in ` +
          `scripts/devnet/kamino-reserve-extract.ts output.\n` +
          `Cause: ${err instanceof Error ? err.message : err}`,
      );
    }
  };
  return {
    reserve: load("reserve.json"),
    lendingMarket: load("lending-market.json"),
    lendingMarketAuthority: load("lending-market-authority.json"),
    usdcMint: load("usdc-mint.json"),
    cTokenMint: load("c-token-mint.json"),
    reserveLiquiditySupply: load("reserve-liquidity-supply.json"),
    reserveFeeVault: load("reserve-fee-vault.json"),
    collateralSupplyVault: load("collateral-supply-vault.json"),
  };
}
