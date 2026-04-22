/**
 * Yield adapter helpers.
 *
 * `roundfi-yield-mock` is a ping-only scaffold today (business logic
 * lands separately). For Step 5a we only need it to:
 *   (a) be a real executable program ID (so `create_pool`'s
 *       `executable` constraint passes on the adapter account); and
 *   (b) expose its state PDA helper so future specs that actually
 *       call into the adapter can derive the state account.
 *
 * When the mock grows real deposit/harvest logic (Step 5c/5d scope)
 * this file adds wrappers around its instructions without changing
 * the surface exposed to earlier tests.
 */

import { PublicKey } from "@solana/web3.js";

import { yieldVaultStatePda } from "@roundfi/sdk";

import type { Env } from "./env.js";

/** Mock adapter program ID for this env. */
export function yieldMockProgramId(env: Env): PublicKey {
  return env.ids.yieldMock;
}

/** State PDA the mock adapter would use for `owner` (usually the pool). */
export function yieldMockStatePda(env: Env, owner: PublicKey): PublicKey {
  return yieldVaultStatePda(env.ids.yieldMock, owner)[0];
}
