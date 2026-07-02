/**
 * Devnet on-chain reference points — single source of truth for the
 * front-end's read-only display of live protocol state.
 *
 * These values mirror `config/program-ids.devnet.json` at the repo
 * root. Hardcoding them here is fine for the hackathon demo; a
 * production deploy would read from a typed env var, a remote
 * config service, or a build-time generated module.
 */

import { PublicKey } from "@solana/web3.js";

export const DEVNET_PROGRAM_IDS = {
  core: new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw"),
  reputation: new PublicKey("Hpo174C6JTCfiZ6r8VYVQdKxo3LBHaJmMbkgrEkxe9R2"),
  yieldKamino: new PublicKey("74izMa4WzLuHvtzDLdNzcyygKe5fYwtD95EiWMuzhFdb"),
  yieldMock: new PublicKey("GPTMPgxexhwkhXNovnfrcSsmoWPUhedvKAQfTV2Ef5AQ"),
} as const;

export const DEVNET_DEPLOYER = new PublicKey("64XM177Vm6zirzQnjU1juQ9TLqDsZVsCcZzfgEgVCffm");

export const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/**
 * Pools driven on devnet so far. Pinned PDAs let the UI render real
 * state without an indexer / search. User-facing copy (label, headline)
 * lives in app/src/lib/i18n-dict.ts under `home.devnet.poolN.*` so it
 * can be translated and stay free of internal jargon.
 */
export const DEVNET_POOLS = {
  pool1: {
    seedId: 1n,
    pda: new PublicKey("5APoECXzJwr6j6xXGsqkT6GRSWNVDm4NSQB3KLhc8ooa"),
  },
  pool2: {
    seedId: 2n,
    pda: new PublicKey("8XZxRSqUDEvhVENxxnhNKM8htZTmVuyQgYbZXmtwbujm"),
  },
  pool3: {
    seedId: 3n,
    pda: new PublicKey("D9PS7QDGUsAwHa4T6Gibw6HV9Lx2sbB5aZM5GsNzpDE5"),
  },
  // pool4 — the live JOIN target: a Forming pool (created via
  // `POOL_SEED_ID=4 pnpm devnet:seed`, no members seeded) so the real
  // join_pool path in JoinGroupModal can be exercised end-to-end. Seeded
  // under the ANCHOR_WALLET authority (B8CjP1mC…ci8di) → this is that
  // pool's actual on-chain PDA, created + verified live on devnet.
  pool4: {
    seedId: 4n,
    pda: new PublicKey("5pEMW2yR13cLZQLUUW8jEs5MdgJtP8PsWoYS4YqKd2gu"),
  },
  // pool7 — the "fast pool" for the team test, with TINY economics so the
  // faucet can sustain all 5 members: credit 2 USDC / installment 1 USDC →
  // the Lv1 stake is just 1 USDC. (pool6 used 30 credit → a 15 USDC Lv1
  // stake, which the ~33-USDC faucet couldn't fund for 5 joiners — every
  // member needs only ~6 USDC for pool7's whole lifecycle.) 5 slots / 5
  // cycles, 2-day cycle, paired with the devnet-canary core build (grace 1d)
  // so the on-time → late → default arc plays out in ~10 days. Seeded under
  // the DEPLOYER authority (64XM…Cffm) with POOL_SEED_ID=7 → deterministic
  // PDA. (pool5 + pool6 are earlier, now-orphaned sizings on devnet.)
  pool7: {
    seedId: 7n,
    pda: new PublicKey("HKKep8nEANrN7LemzY1PiMRmkRjTzHrdeaPGMRPJf8hN"),
  },
} as const;

export type DevnetPoolKey = keyof typeof DEVNET_POOLS;

/**
 * Grace window (seconds) after `pool.next_cycle_at` before the permissionless
 * cranks (`settle_default`, `crank_payout`) become callable on-chain. Mirrors
 * the Rust `GRACE_PERIOD_SECS` (roundfi-core/src/constants.rs):
 *
 *   - vanilla / mainnet build → 604_800 (7 days), the whitepaper value
 *   - `devnet-canary` build   → 86_400 (24 hours), Genesis Canary phase only
 *
 * The deployed devnet is the vanilla build, so the UI counts down 7 days.
 * Pinning the conservative (higher) value is the safe default: erring high
 * only makes the operator wait a bit longer, whereas erring low makes them
 * sign a tx the program then reverts (`PayoutGraceActive` /
 * `SettleDefaultGracePeriodNotElapsed`) — wasting a signature + fee.
 *
 * History: `SettleDefaultCrankModal` previously hardcoded `60n` here — the
 * leftover SEV-002 "DEVNET DEMO PATCH" value that was reverted on-chain back
 * to 604_800. The stale front-end constant made the settle crank look eligible
 * ~7 days early. Centralizing the value fixes that and keeps both cranks in
 * lockstep with the chain.
 */
export const GRACE_PERIOD_SECS = 604_800n;
