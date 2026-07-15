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
  // pool8 — the first SORTEIO pool (ADR pool_v2): payout order is drawn
  // on-chain by the permissionless `finalize_draw` when the pool fills,
  // instead of following arrival order. 6 slots / 6 cycles, 2-day cycle,
  // tiny economics (4 USDC credit / 1 USDC installment → Lv1 stake 2 USDC;
  // each member needs ~8 USDC total, one faucet hit). Seeded under the
  // DEPLOYER authority (64XM…Cffm) with POOL_SEED_ID=8 ORDERING_POLICY=1 →
  // deterministic PDA, cross-verified by re-derivation from
  // [b"pool", DEVNET_DEPLOYER, u64le(8)]. Its DrawResult lives at
  // [b"draw-result", pool] (see @roundfi/sdk `drawResultPda`).
  pool8: {
    seedId: 8n,
    pda: new PublicKey("51F8KpZYVJdht553e3gFayCqewubo1a6WBNLKgtjN69E"),
  },
} as const;

export type DevnetPoolKey = keyof typeof DEVNET_POOLS;

/**
 * Grace window (seconds) after `pool.next_cycle_at` before the permissionless
 * cranks (`settle_default`, `crank_payout`) become callable on-chain. Mirrors
 * the Rust `GRACE_PERIOD_SECS` (roundfi-core/src/constants.rs), which is
 * compile-time cfg-gated:
 *
 *   - vanilla / mainnet build → 604_800 (7 days), the whitepaper value
 *   - `devnet-canary` build   → 86_400 (24 hours), the Genesis Canary phase
 *
 * The devnet deploy runs the **canary** build by default (`deploy · devnet`
 * workflow → `canary` input → `DEVNET_CANARY=1` → deploy.ts rebuilds
 * roundfi_core with `--features devnet-canary`), so the pools intended to
 * exercise the late-payment / stuck-cycle arc (e.g. pool7, 2-day cycle) reach
 * it in a short window. This UI counts down **1 day** to match.
 *
 * IMPORTANT — this must track the deployed build: if you ever deploy with the
 * canary toggle OFF (a mainnet-parity rehearsal at 7-day grace), flip this back
 * to `604_800n` in the same change. It's the single source the banner, the
 * settle modal, and the pool radar all read, so one edit keeps them in lockstep
 * with the chain. (Erring low here is caught by `simulateOrThrow` before the
 * wallet signs — the tx reverts `PayoutGraceActive` / `…GracePeriodNotElapsed`
 * rather than costing a fee — but the UI would still surface the crank early.)
 *
 * History: `SettleDefaultCrankModal` once hardcoded `60n` — the leftover SEV-002
 * "DEVNET DEMO PATCH" value (reverted on-chain long ago). Centralizing here
 * killed that drift.
 */
export const GRACE_PERIOD_SECS = 86_400n;
