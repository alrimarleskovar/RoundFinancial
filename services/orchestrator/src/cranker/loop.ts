/**
 * Cranker polling loop.
 *
 * Every `pollIntervalMs`:
 *   1. for each watched pool, fetch the Pool account + all its Members
 *   2. compute eligible settle_default candidates via detector
 *   3. attempt to settle each (settler decides retry policy)
 *
 * Never throws — any error is captured into state.lastError so the
 * healthcheck endpoint can surface it. Loop only exits when the
 * process is killed.
 *
 * Pool + Member account decoding mirrors scripts/devnet/seed-default.ts
 * — offsets locked to the on-chain layout. Bumping the program's
 * account size = update these offsets here AND in seed-default.ts.
 */

import { Connection, PublicKey } from "@solana/web3.js";

import type { CrankerConfig } from "./config.js";
import { detectEligibleDefaults, type MemberSnapshot, type PoolSnapshot } from "./detector.js";
import { attemptSettle, type Logger, type SettlerDeps } from "./settler.js";
import type { CrankerState } from "./state.js";

// ─── On-chain account decoding ───────────────────────────────────────
// Offsets match programs/roundfi-core/src/state/pool.rs +
// state/member.rs. Mirrors decodePool/decodeMember in seed-default.ts.

function decodePool(address: PublicKey, data: Buffer): PoolSnapshot {
  return {
    address,
    status: data.readUInt8(145),
    currentCycle: data.readUInt8(154),
    nextCycleAt: data.readBigInt64LE(155),
  };
}

function decodeMember(data: Buffer): MemberSnapshot {
  // Wallet is 32 bytes after the 8-byte Anchor discriminator + 32-byte
  // pool. Slot index sits right after (~ check seed-default.ts for
  // the canonical offsets if this ever drifts).
  return {
    wallet: new PublicKey(data.subarray(40, 72)),
    slotIndex: data.readUInt8(72),
    contributionsPaid: data.readUInt8(116),
    defaulted: data.readUInt8(145) !== 0,
  };
}

// ─── Member listing (gPA with memcmp on pool field) ─────────────────

async function listPoolMembers(
  connection: Connection,
  coreProgram: PublicKey,
  pool: PublicKey,
): Promise<MemberSnapshot[]> {
  // Anchor Member account: 8-byte discriminator, then `pool: Pubkey`
  // at offset 8. Filter via getProgramAccounts memcmp.
  const accounts = await connection.getProgramAccounts(coreProgram, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 8, bytes: pool.toBase58() } }],
  });
  return accounts.map((a) => decodeMember(a.account.data));
}

// ─── Polling loop ────────────────────────────────────────────────────

export async function runCrankerLoop(
  connection: Connection,
  config: CrankerConfig,
  state: CrankerState,
  log: Logger,
): Promise<void> {
  const settlerDeps: SettlerDeps = {
    connection,
    caller: config.callerKeypair,
    usdcMint: config.usdcMint,
    coreProgram: config.coreProgram,
    reputationProgram: config.reputationProgram,
  };

  for (;;) {
    state.lastPollAt = Date.now();
    state.pollsTotal++;

    try {
      const nowSec = BigInt(Math.floor(Date.now() / 1000));

      for (const poolAddr of config.pools) {
        const info = await connection.getAccountInfo(poolAddr, "confirmed");
        if (!info) {
          log(`pool ${poolAddr.toBase58().slice(0, 8)}… not found, skipping`);
          continue;
        }
        const pool = decodePool(poolAddr, info.data);
        const members = await listPoolMembers(connection, config.coreProgram, poolAddr);
        const candidates = detectEligibleDefaults(pool, members, nowSec, config.graceSeconds);

        if (candidates.length > 0) {
          state.candidatesDetected += candidates.length;
          log(`pool ${poolAddr.toBase58().slice(0, 8)}…: ${candidates.length} candidate(s)`);
          for (const c of candidates) {
            await attemptSettle(settlerDeps, c, state, log);
          }
        }
      }

      state.lastSuccessAt = Date.now();
      state.lastError = null;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      state.lastError = `poll: ${msg}`;
      log(`POLL ERROR: ${msg}`);
    }

    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}
