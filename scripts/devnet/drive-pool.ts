/**
 * drive-pool.ts — push an ARRIVAL-ORDER pool forward through as many cycles
 * as the protocol allows RIGHT NOW, using the local member keypairs.
 *
 * The problem it solves: a script-seeded pool (members are
 * `keypairs/member-{N}.json`, not anyone's browser wallet) gets stuck
 * mid-round and there's no one-tap way to run it to term. Paying and claiming
 * each require the MEMBER's signature, so only these keypairs can advance it —
 * and doing it by hand means remembering the right MEMBER_INDEX_OFFSET,
 * INSTALLMENT and cycle for every call. This orchestrator reads the chain,
 * auto-discovers the slot→keypair mapping, and drives the pool cycle by cycle
 * by reusing the proven `seed-cycle` (contribute) + `seed-claim` (claim_payout)
 * primitives — stopping cleanly at the first wall it can't pass and telling you
 * exactly what unblocks it and when.
 *
 * What it does each cycle, in order:
 *   1. seed-cycle — every alive member whose `contributions_paid ==
 *      current_cycle` pays this cycle's installment (the on-chain gate rejects
 *      anyone ahead or behind; behind members can NEVER catch up — that's the
 *      protocol, `contribute.rs` require args.cycle == contributions_paid).
 *   2. seed-claim — the cycle's contemplated member (arrival order: the seat
 *      whose index == current_cycle) claims its payout, which advances
 *      `current_cycle`. A behind contemplated member can still claim (claim
 *      has no contributions gate) as long as the pool float covers the credit.
 * When the claim can't advance the cycle it's almost always WaterfallUnderflow
 * (an underfunded pool — too many behind/defaulted members). The cure is
 * settle_default, which seizes the delinquents' collateral into the pool — but
 * that's grace-gated on-chain (`now >= next_cycle_at + GRACE`), so the driver
 * reports the unlock time instead of spinning.
 *
 * Signs NOTHING itself — every write is a child `seed-*` process signed by the
 * member keypairs. Read paths reuse the SDK decoders (same as inspect-pool.ts).
 *
 * Usage:
 *   POOL_PDA=<base58>  pnpm exec tsx scripts/devnet/drive-pool.ts   # any pool
 *   POOL_SEED_ID=7     pnpm exec tsx scripts/devnet/drive-pool.ts   # local-authored
 *   DRY_RUN=1 POOL_PDA=… pnpm exec tsx scripts/devnet/drive-pool.ts # plan only
 *
 * Env:
 *   POOL_PDA | POOL_SEED_ID   which pool (PDA works regardless of authority)
 *   MAX_STEPS   (default 12)  loop bound — safety, well above any real pool
 *   DRY_RUN=1                 print the plan + offset map, sign nothing
 *   GRACE_PERIOD_SECS         devnet-canary grace (default 86400 = 1 day)
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { fetchPoolMembers, fetchPoolRaw } from "@roundfi/sdk/onchain-raw";

import { loadCluster, requireProgram } from "../../config/clusters.js";

const KEYPAIRS_DIR = resolve(process.cwd(), "keypairs");
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 12);
const DRY_RUN = process.env.DRY_RUN === "1";
const GRACE_PERIOD_SECS = Number(process.env.GRACE_PERIOD_SECS ?? 86_400);

const USDC = (v: bigint) => `${(Number(v) / 1e6).toFixed(2)} USDC`;

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

/** base58 pubkey → the member-{N}.json index that holds it. */
function loadKeypairIndex(): Map<string, number> {
  const map = new Map<string, number>();
  if (!existsSync(KEYPAIRS_DIR)) return map;
  for (const f of readdirSync(KEYPAIRS_DIR)) {
    const m = /^member-(\d+)\.json$/.exec(f);
    if (!m) continue;
    try {
      const kp = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(resolve(KEYPAIRS_DIR, f), "utf-8"))),
      );
      map.set(kp.publicKey.toBase58(), Number(m[1]));
    } catch {
      /* skip unreadable / non-keypair json */
    }
  }
  return map;
}

interface State {
  pool: NonNullable<Awaited<ReturnType<typeof fetchPoolRaw>>>;
  members: Awaited<ReturnType<typeof fetchPoolMembers>>;
}

async function readState(
  connection: Connection,
  coreProgram: PublicKey,
  poolPda: PublicKey,
): Promise<State> {
  const pool = await fetchPoolRaw(connection, poolPda);
  if (!pool) throw new Error(`no Pool account at ${poolPda.toBase58()}`);
  const members = await fetchPoolMembers(connection, coreProgram, poolPda);
  return { pool, members };
}

function runChild(script: string, env: Record<string, string>): boolean {
  try {
    execFileSync("pnpm", ["exec", "tsx", `scripts/devnet/${script}`], {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    return true;
  } catch {
    // The child printed its own error (stdio inherited). A non-zero exit here
    // is expected sometimes (e.g. nobody eligible to pay) — the caller decides
    // whether that's fatal by re-reading on-chain state.
    return false;
  }
}

async function main() {
  const cluster = loadCluster();
  const coreProgram = requireProgram(cluster, "core");
  const connection = new Connection(cluster.rpcUrl, "confirmed");
  const poolPda = resolvePoolPda(coreProgram);

  let { pool, members } = await readState(connection, coreProgram, poolPda);

  console.log(`━━━ drive pool ${poolPda.toBase58()} (${cluster.name}) ━━━`);
  console.log(
    `status ${pool.status} · ordering ${pool.orderingPolicy === 1 ? "SORTEIO" : "arrival"} · ` +
      `cycle ${pool.currentCycle}/${pool.cyclesTotal} · ${pool.membersJoined}/${pool.membersTarget} members, ${pool.defaultedMembers} defaulted`,
  );
  console.log(
    `economics: credit ${USDC(pool.creditAmount)} · installment ${USDC(pool.installmentAmount)}`,
  );

  if (pool.orderingPolicy === 1) {
    // seed-claim claims the seat whose index == current_cycle (arrival). On a
    // sorteio pool the contemplated seat comes from the DrawResult, so that
    // assumption would claim the WRONG member. Refuse rather than misfire.
    console.error(
      `\n✗ this is a SORTEIO pool. drive-pool only supports arrival-order pools ` +
        `(seed-claim's slot==cycle rule). Use the app's "Sortear ordem" + Receber flow instead.`,
    );
    process.exit(1);
  }

  // ── Discover the slot → keypair offset ──────────────────────────────────
  // seed-cycle / seed-claim locate each member at `member-{slot + OFFSET}.json`.
  // Recover OFFSET from the chain: for every member we hold a keypair for,
  // (keypairIndex - slotIndex) must be one constant. That constant is the
  // MEMBER_INDEX_OFFSET the primitives need — no guessing which block the pool
  // was seeded from.
  const kpIndex = loadKeypairIndex();
  const offsets = new Set<number>();
  const haveSeat = new Map<number, boolean>();
  for (const m of members) {
    const idx = kpIndex.get(m.wallet.toBase58());
    haveSeat.set(m.slotIndex, idx !== undefined);
    if (idx !== undefined) offsets.add(idx - m.slotIndex);
  }
  const seatsWithKp = [...haveSeat.entries()].filter(([, has]) => has).map(([s]) => s);
  const seatsMissing = [...haveSeat.entries()].filter(([, has]) => !has).map(([s]) => s);

  console.log(
    `\nkeypairs: ${seatsWithKp.length}/${members.length} seats matched in ${KEYPAIRS_DIR}` +
      (seatsMissing.length
        ? ` (missing seats: ${seatsMissing.map((s) => `#${s}`).join(", ")})`
        : ""),
  );

  if (offsets.size === 0) {
    console.error(
      `\n✗ no member-{N}.json in ${KEYPAIRS_DIR} matches any on-chain member of this pool.\n` +
        `  This pool's members were seeded elsewhere, or the keypairs dir is on another machine.`,
    );
    process.exit(1);
  }
  if (offsets.size > 1) {
    console.error(
      `\n✗ the local keypairs don't sit at a single contiguous offset (found offsets ` +
        `${[...offsets].join(", ")}). seed-cycle/seed-claim need member-{slot+OFFSET}.json to line ` +
        `up with slot order; this pool's keypairs don't. Drive it with the individual scripts instead.`,
    );
    process.exit(1);
  }
  // Exactly one offset survived the guards above (size !== 1 exits).
  const OFFSET = [...offsets][0]!;
  console.log(`→ MEMBER_INDEX_OFFSET = ${OFFSET} (member-{slot+${OFFSET}}.json)`);

  const childEnv: Record<string, string> = {
    POOL_PDA: poolPda.toBase58(),
    MEMBERS_TARGET: String(pool.membersTarget),
    INSTALLMENT_AMOUNT_USDC: String(Number(pool.installmentAmount) / 1e6),
    MEMBER_INDEX_OFFSET: String(OFFSET),
  };

  if (DRY_RUN) {
    console.log(`\n[DRY_RUN] would drive with env:`, childEnv);
    console.log(`[DRY_RUN] no transactions sent.`);
    return;
  }

  // ── Drive loop ──────────────────────────────────────────────────────────
  for (let step = 0; step < MAX_STEPS; step++) {
    ({ pool, members } = await readState(connection, coreProgram, poolPda));

    if (pool.status !== "active") {
      console.log(`\n✓ pool is ${pool.status.toUpperCase()} — nothing more to drive.`);
      break;
    }
    if (pool.currentCycle >= pool.cyclesTotal) {
      console.log(
        `\n✓ all ${pool.cyclesTotal} cycles ran (current_cycle=${pool.currentCycle}). ` +
          `Pool is finishing — run seed-close / close-vaults to wrap it up.`,
      );
      break;
    }

    const cyc = pool.currentCycle;
    const contemplated = members.find((m) => m.slotIndex === cyc);
    console.log(`\n──── step ${step + 1}: cycle ${cyc} (receiver = seat #${cyc}) ────`);

    if (!contemplated) {
      console.error(`✗ no member at seat #${cyc}; cannot advance. Stopping.`);
      break;
    }

    const graceDeadline = Number(pool.nextCycleAt) + GRACE_PERIOD_SECS;
    const graceElapsed = Math.floor(Date.now() / 1000) >= graceDeadline;

    // A defaulted / already-paid receiver can't claim — the cycle only rolls
    // past them via the permissionless cranker, which is grace-gated.
    if (contemplated.defaulted || contemplated.paidOut) {
      const why = contemplated.defaulted ? "DEFAULTED" : "already paid out";
      if (graceElapsed) {
        console.log(`receiver #${cyc} is ${why} → cranking past it (crank-payout)…`);
        runChild("crank-payout.ts", { POOL_PDA: poolPda.toBase58() });
        continue;
      }
      console.log(
        `⏸ receiver #${cyc} is ${why}; the cycle rolls only via the cranker, which unlocks at ` +
          `grace (${new Date(graceDeadline * 1000).toISOString()}). Re-run drive-pool after that.`,
      );
      break;
    }

    if (!haveSeat.get(cyc)) {
      console.log(
        `⏸ no local keypair for the receiver seat #${cyc} — can't claim as them. ` +
          `Re-run once member-${cyc + OFFSET}.json is present, or crank after grace.`,
      );
      break;
    }

    // 1) everyone who owes THIS cycle pays (seed-cycle tolerates the rest).
    console.log(`· paying cycle ${cyc} (every seat with contributions_paid == ${cyc})…`);
    runChild("seed-cycle.ts", childEnv);

    // 2) the contemplated seat claims → advances current_cycle.
    console.log(`· claiming cycle ${cyc} as seat #${cyc}…`);
    runChild("seed-claim.ts", childEnv);

    // Did it advance?
    const after = await fetchPoolRaw(connection, poolPda);
    if (after && after.currentCycle > cyc) {
      console.log(`✓ advanced to cycle ${after.currentCycle}.`);
      continue;
    }

    // Stuck — almost always the float can't cover the credit (WaterfallUnderflow).
    console.log(
      `\n⏸ cycle ${cyc} did not advance. The most likely cause is WaterfallUnderflow: the pool ` +
        `float can't cover the ${USDC(pool.creditAmount)} payout because ${pool.defaultedMembers} ` +
        `member(s) defaulted and others are behind (and behind members can't back-pay).`,
    );
    console.log(
      `  Fix: settle the delinquents (settle_default seizes their collateral INTO the pool), ` +
        `which is grace-gated. Grace elapses ${new Date(graceDeadline * 1000).toISOString()}` +
        (graceElapsed ? ` (ELAPSED — run seed-default for the behind seats, then re-run).` : `.`),
    );
    break;
  }

  // ── Final snapshot ──────────────────────────────────────────────────────
  console.log(`\n━━━ final state ━━━`);
  runChild("inspect-pool.ts", { POOL_PDA: poolPda.toBase58() });
}

main().catch((e) => {
  console.error("✗ drive-pool failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
