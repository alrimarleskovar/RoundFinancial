/**
 * Read-only pool inspector — the ops answer to "why can't anyone pay /
 * claim / settle on pool N right now?".
 *
 * Prints the Pool account, every Member (per-seat paid/defaulted/paidOut
 * state), the DrawResult when the pool is sorteio-ordered, and a
 * DIAGNOSIS section that applies the same gates the program applies:
 * whose turn it is to receive, who is behind on contributions, whether
 * the claim grace has elapsed (crank/settle territory), and what action
 * unblocks the pool. Purely getAccountInfo/getProgramAccounts — safe to
 * run any time, signs nothing, moves nothing.
 *
 * Usage (either selector):
 *   POOL_PDA=HKKep8nEANrN7LemzY1PiMRmkRjTzHrdeaPGMRPJf8hN \
 *     pnpm exec tsx scripts/devnet/inspect-pool.ts
 *   POOL_SEED_ID=9 pnpm exec tsx scripts/devnet/inspect-pool.ts
 *
 * POOL_PDA works for ANY pool regardless of who seeded it. POOL_SEED_ID
 * derives the PDA from the LOCAL keypair (ANCHOR_WALLET or
 * ~/.config/solana/id.json) — only finds pools that keypair authored.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { fetchDrawRaw, fetchPoolMembers, fetchPoolRaw } from "@roundfi/sdk/onchain-raw";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const USDC = (v: bigint) => `${(Number(v) / 1e6).toFixed(2)} USDC`;
const ts = (v: bigint | number) => {
  const n = Number(v);
  return n > 0 ? `${n} (${new Date(n * 1000).toISOString()})` : String(n);
};

// Devnet-canary grace (deploy.ts --canary): 1 day. Mainnet-parity: 7 days.
// Same constant the app pins in lib/devnet.ts — flip together.
const GRACE_PERIOD_SECS = Number(process.env.GRACE_PERIOD_SECS ?? 86_400);

function resolvePoolPda(coreProgram: PublicKey): PublicKey {
  if (process.env.POOL_PDA) return new PublicKey(process.env.POOL_PDA);
  const seedId = BigInt(process.env.POOL_SEED_ID ?? "0");
  if (seedId === 0n) {
    throw new Error("set POOL_PDA=<base58> or POOL_SEED_ID=<n> (derives from the local keypair)");
  }
  const walletPath = process.env.ANCHOR_WALLET ?? resolve(homedir(), ".config/solana/id.json");
  if (!existsSync(walletPath)) throw new Error(`keypair not found at ${walletPath}`);
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf-8"))),
  );
  const seedIdLe = Buffer.alloc(8);
  seedIdLe.writeBigUInt64LE(seedId, 0);
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), authority.publicKey.toBuffer(), seedIdLe],
    coreProgram,
  );
  return poolPda;
}

async function main() {
  const cluster = loadCluster();
  const coreProgram = requireProgram(cluster, "core");
  const connection = new Connection(cluster.rpcUrl, "confirmed");
  const poolPda = resolvePoolPda(coreProgram);
  const now = Math.floor(Date.now() / 1000);

  const pool = await fetchPoolRaw(connection, poolPda);
  if (!pool) {
    console.log(`✗ no Pool account at ${poolPda.toBase58()} on ${cluster.name}`);
    process.exit(1);
  }

  console.log(`━━━ pool ${poolPda.toBase58()} (${cluster.name}) ━━━`);
  console.log(`authority:        ${pool.authority.toBase58()}`);
  console.log(`seed_id:          ${pool.seedId}`);
  console.log(
    `status:           ${pool.status}   ordering_policy: ${pool.orderingPolicy === 1 ? "1 (SORTEIO)" : `${pool.orderingPolicy} (arrival)`}`,
  );
  console.log(
    `members:          ${pool.membersJoined}/${pool.membersTarget} joined, ${pool.defaultedMembers} defaulted`,
  );
  console.log(
    `cycle:            ${pool.currentCycle}/${pool.cyclesTotal} (duration ${pool.cycleDurationSec}s)`,
  );
  console.log(
    `economics:        credit ${USDC(pool.creditAmount)} · installment ${USDC(pool.installmentAmount)}`,
  );
  console.log(`started_at:       ${ts(pool.startedAt)}`);
  console.log(`next_cycle_at:    ${ts(pool.nextCycleAt)}`);
  const overdueSec = now - Number(pool.nextCycleAt);
  if (pool.status === "active") {
    console.log(
      overdueSec >= 0
        ? `                  → deadline ${(overdueSec / 3600).toFixed(1)}h AGO (grace ${overdueSec >= GRACE_PERIOD_SECS ? "ELAPSED — crank/settle territory" : `ends in ${((GRACE_PERIOD_SECS - overdueSec) / 3600).toFixed(1)}h`})`
        : `                  → deadline in ${(-overdueSec / 3600).toFixed(1)}h`,
    );
  }
  console.log(
    `vaults:           solidarity ${USDC(pool.solidarityBalance)} · escrow ${USDC(pool.escrowBalance)} · guarantee ${USDC(pool.guaranteeFundBalance)}`,
  );
  console.log(
    `flows:            contributed ${USDC(pool.totalContributed)} · paid out ${USDC(pool.totalPaidOut)}`,
  );

  // ── Draw (sorteio pools) ────────────────────────────────────────────
  let order: number[] | null = null;
  if (pool.orderingPolicy === 1) {
    const draw = await fetchDrawRaw(connection, coreProgram, poolPda);
    if (draw) {
      order = draw.order;
      console.log(`draw:             seed ${draw.seed.toString("hex").slice(0, 16)}…`);
      draw.order.forEach((cycle, seat) =>
        console.log(`                  seat #${seat} → receives in cycle ${cycle}`),
      );
    } else {
      console.log(`draw:             NOT FINALIZED — payouts gated (DrawRequired) until it runs`);
    }
  }

  // ── Members ─────────────────────────────────────────────────────────
  const members = await fetchPoolMembers(connection, coreProgram, poolPda);
  console.log(`\n━━━ members (${members.length}) ━━━`);
  for (const m of members) {
    const marks = [
      m.defaulted ? "DEFAULTED" : null,
      m.paidOut ? "paid-out" : null,
      !m.defaulted && m.contributionsPaid < pool.currentCycle ? "BEHIND" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(
      `seat #${m.slotIndex}: ${m.wallet.toBase58()}\n` +
        `   paid ${m.contributionsPaid}/${pool.cyclesTotal} cycles · stake ${USDC(m.stakeDeposited)} · escrow ${USDC(m.escrowBalance)} · on-time ${m.onTimeCount} late ${m.lateCount}${marks ? ` · ${marks}` : ""}`,
    );
  }

  // ── Diagnosis — mirror the program's own gates ──────────────────────
  console.log(`\n━━━ diagnosis ━━━`);
  if (pool.status !== "active") {
    console.log(`pool is ${pool.status.toUpperCase()} — no live cycle to pay or claim.`);
    return;
  }
  if (pool.currentCycle >= pool.cyclesTotal) {
    console.log(`all ${pool.cyclesTotal} cycles ran — pool is finishing (complete/close next).`);
    return;
  }
  if (pool.orderingPolicy === 1 && !order) {
    console.log(
      `sorteio pool with NO draw: run finalize_draw (button or script) — payouts unreachable until then.`,
    );
    return;
  }
  // Who receives the current cycle? arrival: seat == cycle; sorteio: order[seat] == cycle.
  const contemplatedSeat =
    pool.orderingPolicy === 1 && order
      ? order.findIndex((c) => c === pool.currentCycle)
      : pool.currentCycle;
  const contemplated = members.find((m) => m.slotIndex === contemplatedSeat) ?? null;
  console.log(
    `cycle ${pool.currentCycle} receiver: seat #${contemplatedSeat}${contemplated ? ` (${contemplated.wallet.toBase58().slice(0, 8)}…)` : " — MEMBER NOT FOUND"}`,
  );
  if (contemplated?.defaulted) {
    console.log(
      `→ receiver is DEFAULTED: fire skip_defaulted_payout (cranker) to roll the cycle past them.`,
    );
  } else if (contemplated?.paidOut) {
    console.log(`→ receiver already paid out — cycle should roll via crank_payout if stuck.`);
  }
  const behind = members.filter((m) => !m.defaulted && m.contributionsPaid < pool.currentCycle);
  const dueNow = members.filter((m) => !m.defaulted && m.contributionsPaid === pool.currentCycle);
  const ahead = members.filter((m) => !m.defaulted && m.contributionsPaid > pool.currentCycle);
  console.log(
    `contributions: ${ahead.length} paid this cycle · ${dueNow.length} due now · ${behind.length} BEHIND (settle candidates once grace elapses)`,
  );
  if (dueNow.length > 0) {
    console.log(
      `→ due now: ${dueNow.map((m) => `#${m.slotIndex}`).join(", ")} can pay (Pagar / contribute).`,
    );
  }
  if (behind.length > 0 && overdueSec >= GRACE_PERIOD_SECS) {
    console.log(
      `→ behind + grace elapsed: ${behind.map((m) => `#${m.slotIndex}`).join(", ")} settleable via settle_default (cranker).`,
    );
  }
  if (ahead.length === members.length - (pool.defaultedMembers ?? 0)) {
    console.log(
      `→ everyone alive already paid cycle ${pool.currentCycle}: nothing to pay until the receiver claims (or crank_payout past the deadline) — the Pagar button being absent is CORRECT here.`,
    );
  }
}

main().catch((e) => {
  console.error("✗ inspect-pool failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
