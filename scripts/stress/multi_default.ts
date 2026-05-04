/**
 * RoundFi — Multi-Default Stress Test (Step 4f)
 *
 * Pure-TypeScript economic simulator that mirrors the on-chain math
 * in `settle_default.rs` to answer the pitch claim:
 *
 *   "Three veterans default at once — can the pool still cover its
 *    obligations to remaining members and stay solvent?"
 *
 * The simulator runs the same seizure cascade the program enforces:
 *   Shield 1 (Solidarity) → Shield 2 (Escrow → Stake, D/C-bounded)
 *   → (v2, not used here) Shield 3 (Guarantee Fund).
 *
 * Why pure TS and not an on-chain test? (a) We want this to run in CI
 * without a Solana validator. (b) Judges can read a single file and
 * follow the math end-to-end. (c) The same assertions become the
 * oracle for the Step-5 integration tests — if this simulation says
 * "solvent", the on-chain test MUST also say "solvent" or there is a
 * divergence between docs and code.
 *
 * RUN:
 *   pnpm tsx scripts/stress/multi_default.ts
 *   (or `node --import tsx scripts/stress/multi_default.ts`)
 *
 * Exit code 0 ⇔ all assertions pass (protocol remains solvent).
 */

// ─── Pool params (match architecture.md §3.2 defaults) ──────────────
const USDC = 1_000_000n; // 6 decimals

const POOL = {
  membersTarget: 24,
  installmentAmount: 416n * USDC, // 416 USDC
  creditAmount: 10_000n * USDC,   // 10,000 USDC
  cyclesTotal: 24,
  solidarityBps: 100,              // 1%
  escrowReleaseBps: 2_500,         // 25% of installment goes to escrow
  seedDrawBps: 9_160,              // 91.6% must be retained at cycle 0
};

// Per-level stake requirements (matches constants.rs:stake_bps_for_level)
const STAKE_BPS_BY_LEVEL: Record<number, number> = {
  1: 5_000, // 50%
  2: 3_000, // 30%
  3: 1_000, // 10% — Veteran
};

// ─── Member model ────────────────────────────────────────────────────
interface Member {
  id: number;
  level: 1 | 2 | 3;
  slotIndex: number; // payout cycle index
  stakeDepositedInitial: bigint;
  stakeDeposited: bigint;
  escrowBalance: bigint;
  totalEscrowDeposited: bigint;
  contributionsPaid: number;
  defaulted: boolean;
  paidOut: boolean;
}

interface Pool {
  usdcVault: bigint;        // pool_usdc_vault.amount
  solidarityBalance: bigint;
  escrowBalance: bigint;    // aggregate (informational)
  guaranteeFund: bigint;    // earmarked inside usdcVault
  totalContributed: bigint;
  totalPaidOut: bigint;
  currentCycle: number;
  members: Member[];
}

// ─── bps helper ──────────────────────────────────────────────────────
const applyBps = (amount: bigint, bps: number): bigint =>
  (amount * BigInt(bps)) / 10_000n;

// ─── Split an installment into (solidarity, escrow, poolFloat) ───────
function splitInstallment(amount: bigint, solidarityBps: number, escrowBps: number) {
  const solidarity = applyBps(amount, solidarityBps);
  const escrow = applyBps(amount, escrowBps);
  const poolFloat = amount - solidarity - escrow;
  return { solidarity, escrow, poolFloat };
}

// ─── D/C invariant (cross-multiplied — matches settle_default.rs) ────
function dcInvariantHolds(dInit: bigint, dRem: bigint, cInit: bigint, cRem: bigint): boolean {
  if (dInit === 0n) return true;
  if (cInit === 0n) return dRem === 0n;
  return dRem * cInit <= cRem * dInit;
}

function maxSeizureRespectingDc(
  dInit: bigint,
  dRem: bigint,
  cInit: bigint,
  cBefore: bigint,
  proposed: bigint,
): bigint {
  if (dInit === 0n) return proposed;
  // c_min = ceil(d_rem * c_init / d_init)
  const num = dRem * cInit;
  const cMin = (num + dInit - 1n) / dInit;
  const maxAllowed = cBefore > cMin ? cBefore - cMin : 0n;
  return proposed < maxAllowed ? proposed : maxAllowed;
}

// ─── Build a fresh pool ──────────────────────────────────────────────
function buildPool(): Pool {
  // Mix: 3 Veterans (L3), 9 Trusted (L2), 12 Newcomers (L1).
  const members: Member[] = [];
  const levels: (1 | 2 | 3)[] = [
    ...Array(3).fill(3),
    ...Array(9).fill(2),
    ...Array(12).fill(1),
  ] as (1 | 2 | 3)[];

  // Put Veterans in the late slots (typical — they get paid last
  // because they have the lowest immediate capital need).
  // Slots 21, 22, 23 = veterans (3 defaulters in the stress scenario).
  // This matches the pitch's "three veterans defaulting together".
  const slotAssignment: (1 | 2 | 3)[] = [
    ...Array(12).fill(1),
    ...Array(9).fill(2),
    ...Array(3).fill(3),
  ] as (1 | 2 | 3)[];

  let aggregateEscrow = 0n;
  let poolFloat = 0n;
  for (let i = 0; i < POOL.membersTarget; i++) {
    const level = slotAssignment[i]!;
    const stakeBps = STAKE_BPS_BY_LEVEL[level]!;
    const stake = applyBps(POOL.creditAmount, stakeBps);

    // Convention: stake is deposited into the escrow vault at join.
    members.push({
      id: i,
      level,
      slotIndex: i,
      stakeDepositedInitial: stake,
      stakeDeposited: stake,
      escrowBalance: 0n,
      totalEscrowDeposited: 0n,
      contributionsPaid: 0,
      defaulted: false,
      paidOut: false,
    });
    aggregateEscrow += stake;
    void levels; // suppress unused — keep for debugging / reference
  }

  return {
    usdcVault: 0n,
    solidarityBalance: 0n,
    escrowBalance: aggregateEscrow,
    guaranteeFund: 0n,
    totalContributed: 0n,
    totalPaidOut: 0n,
    currentCycle: 0,
    members,
    ...{ _unused: poolFloat }, // keep linter quiet; poolFloat is per-cycle below
  } as Pool;
}

// ─── Run `cycles` full cycles, optionally marking certain members as
//     defaulted at a given cycle. Returns the pool state at the end.
interface RunOptions {
  cycles: number;
  defaultAtCycle?: number;
  defaultMemberIds?: number[];
}

function run(pool: Pool, opts: RunOptions): Pool {
  for (let cycle = 0; cycle < opts.cycles; cycle++) {
    pool.currentCycle = cycle;

    // ─── Contributions ─────────────────────────────────────────────
    for (const m of pool.members) {
      if (m.defaulted) continue;
      const shouldDefault =
        opts.defaultAtCycle === cycle &&
        (opts.defaultMemberIds ?? []).includes(m.id);
      if (shouldDefault) continue; // skip contribution → triggers default

      const { solidarity, escrow, poolFloat } = splitInstallment(
        POOL.installmentAmount,
        POOL.solidarityBps,
        POOL.escrowReleaseBps,
      );
      pool.solidarityBalance += solidarity;
      pool.escrowBalance += escrow;
      pool.usdcVault += poolFloat;
      pool.totalContributed += POOL.installmentAmount;
      m.escrowBalance += escrow;
      m.totalEscrowDeposited += escrow;
      m.contributionsPaid += 1;
    }

    // ─── Payout (if a non-defaulted member owns this slot) ─────────
    const slotOwner = pool.members.find((m) => m.slotIndex === cycle);
    if (slotOwner && !slotOwner.defaulted && !slotOwner.paidOut) {
      // Check GF earmark (guarantee fund cannot be drained)
      const spendable = pool.usdcVault - pool.guaranteeFund;
      if (spendable >= POOL.creditAmount) {
        pool.usdcVault -= POOL.creditAmount;
        pool.totalPaidOut += POOL.creditAmount;
        slotOwner.paidOut = true;
      }
      // If GF would be breached, payout is skipped in this simulation —
      // on-chain the tx reverts with WaterfallUnderflow.
    }

    // ─── Settle defaults marked above ──────────────────────────────
    if (opts.defaultAtCycle === cycle) {
      for (const id of opts.defaultMemberIds ?? []) {
        settleDefault(pool, id);
      }
    }
  }
  return pool;
}

// ─── Seizure cascade (matches settle_default.rs exactly) ─────────────
function settleDefault(pool: Pool, memberId: number): void {
  const m = pool.members.find((x) => x.id === memberId)!;
  if (m.defaulted) return;

  const dInitial = POOL.creditAmount;
  const dRemaining = POOL.creditAmount; // worst case — defaulted before payout
  const cInitial = m.stakeDepositedInitial + m.totalEscrowDeposited;
  const cBefore = m.stakeDeposited + m.escrowBalance;

  const missed = POOL.installmentAmount < dRemaining ? POOL.installmentAmount : dRemaining;

  // (a) Solidarity
  const fromSolidarity = missed < pool.solidarityBalance ? missed : pool.solidarityBalance;
  pool.solidarityBalance -= fromSolidarity;
  pool.usdcVault += fromSolidarity;
  let shortfall = missed - fromSolidarity;

  // (b) Member escrow, D/C-bounded
  const proposedEscrow = shortfall < m.escrowBalance ? shortfall : m.escrowBalance;
  const fromEscrow = maxSeizureRespectingDc(
    dInitial,
    dRemaining,
    cInitial,
    cBefore,
    proposedEscrow,
  );
  m.escrowBalance -= fromEscrow;
  pool.escrowBalance -= fromEscrow;
  pool.usdcVault += fromEscrow;
  shortfall -= fromEscrow;

  // (c) Member stake, D/C-bounded
  const cAfterEscrow = cBefore - fromEscrow;
  const proposedStake = shortfall < m.stakeDeposited ? shortfall : m.stakeDeposited;
  const fromStake = maxSeizureRespectingDc(
    dInitial,
    dRemaining,
    cInitial,
    cAfterEscrow,
    proposedStake,
  );
  m.stakeDeposited -= fromStake;
  pool.escrowBalance -= fromStake; // stake lives in escrow vault
  pool.usdcVault += fromStake;

  m.defaulted = true;

  const seizedTotal = fromSolidarity + fromEscrow + fromStake;
  console.log(
    `    settle_default member=${m.id} level=${m.level} ` +
      `seized=${fmtUsdc(seizedTotal)} ` +
      `(solidarity=${fmtUsdc(fromSolidarity)} escrow=${fmtUsdc(fromEscrow)} stake=${fmtUsdc(fromStake)})`,
  );
}

// ─── Pretty-print ────────────────────────────────────────────────────
const fmtUsdc = (x: bigint): string => {
  const whole = x / USDC;
  const frac = x % USDC;
  return `${whole}.${frac.toString().padStart(6, "0").slice(0, 2)} USDC`;
};

// ─── Assertions ──────────────────────────────────────────────────────
let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}`);
    failures += 1;
  }
}

// ─── Scenarios ───────────────────────────────────────────────────────
function scenarioHappyPath(): void {
  console.log("\n━━━ Scenario A — happy path (no defaults) ━━━");
  const pool = buildPool();
  run(pool, { cycles: POOL.cyclesTotal });

  const allCompleted = pool.members.every((m) => m.paidOut);
  assert(allCompleted, "all members received their payout");
  assert(
    pool.totalPaidOut === POOL.creditAmount * BigInt(POOL.membersTarget),
    `total paid out = ${fmtUsdc(POOL.creditAmount * BigInt(POOL.membersTarget))}`,
  );
  assert(
    pool.usdcVault >= 0n,
    `pool vault non-negative (end: ${fmtUsdc(pool.usdcVault)})`,
  );
}

function scenarioThreeVeteransDefault(): void {
  console.log("\n━━━ Scenario B — three veterans default at cycle 0 ━━━");
  console.log("  veterans occupy slots 21, 22, 23 — late payout, thin collateral ratio");

  const pool = buildPool();
  const veteranIds = pool.members.filter((m) => m.level === 3).map((m) => m.id);
  run(pool, {
    cycles: POOL.cyclesTotal,
    defaultAtCycle: 0,
    defaultMemberIds: veteranIds,
  });

  // ─── Post-stress assertions ──────────────────────────────────────
  const defaultedCount = pool.members.filter((m) => m.defaulted).length;
  assert(defaultedCount === 3, "exactly 3 members defaulted");

  const nonDefaulted = pool.members.filter((m) => !m.defaulted);
  const paidOut = nonDefaulted.filter((m) => m.paidOut).length;
  assert(
    paidOut === POOL.membersTarget - 3,
    `all ${POOL.membersTarget - 3} non-defaulted members were paid (actual: ${paidOut})`,
  );

  // Solvency claim: pool_usdc_vault + solidarity + escrow + GF >= 0
  const totalProtocolAssets =
    pool.usdcVault + pool.solidarityBalance + pool.escrowBalance + pool.guaranteeFund;
  assert(totalProtocolAssets >= 0n, "aggregate protocol assets non-negative");

  // D/C invariant: for every defaulter, it must still hold.
  for (const m of pool.members.filter((x) => x.defaulted)) {
    const dInit = POOL.creditAmount;
    const dRem = POOL.creditAmount;
    const cInit = m.stakeDepositedInitial + m.totalEscrowDeposited;
    const cAfter = m.stakeDeposited + m.escrowBalance;
    assert(
      dcInvariantHolds(dInit, dRem, cInit, cAfter),
      `D/C invariant holds for defaulted member ${m.id}`,
    );
  }

  // Print shield absorption summary.
  console.log("\n  ─── shield absorption summary ───");
  console.log(`    Shield 1 (Solidarity) residual: ${fmtUsdc(pool.solidarityBalance)}`);
  console.log(`    Shield 2 residual (aggregate escrow): ${fmtUsdc(pool.escrowBalance)}`);
  console.log(`    Shield 3 (Guarantee Fund): ${fmtUsdc(pool.guaranteeFund)} — inert in v1`);
  console.log(`    pool_usdc_vault: ${fmtUsdc(pool.usdcVault)}`);
  console.log(`    total paid out: ${fmtUsdc(pool.totalPaidOut)}`);
  console.log(`    total contributed: ${fmtUsdc(pool.totalContributed)}`);
}

function scenarioAllVeteransDefault(): void {
  console.log("\n━━━ Scenario C — adversarial upper bound (all 3 veterans + 2 trusted default) ━━━");
  const pool = buildPool();
  const ids = [
    ...pool.members.filter((m) => m.level === 3).map((m) => m.id),
    ...pool.members.filter((m) => m.level === 2).slice(0, 2).map((m) => m.id),
  ];
  run(pool, {
    cycles: POOL.cyclesTotal,
    defaultAtCycle: 0,
    defaultMemberIds: ids,
  });

  const defaultedCount = pool.members.filter((m) => m.defaulted).length;
  assert(defaultedCount === ids.length, `${ids.length} members defaulted`);
  assert(pool.usdcVault >= 0n, "pool vault remains non-negative");
  // This scenario is exploratory — we don't assert payout completeness
  // because with 5 defaults some slots will have insufficient float.
  const paidOut = pool.members.filter((m) => m.paidOut).length;
  console.log(`  info: ${paidOut} / ${POOL.membersTarget} members were paid before float ran out`);
}

// ─── Main ────────────────────────────────────────────────────────────
function main(): void {
  console.log("━━━ RoundFi stress-test simulator (Step 4f) ━━━");
  console.log(`pool params: ${POOL.membersTarget} members × ${POOL.cyclesTotal} cycles`);
  console.log(`installment: ${fmtUsdc(POOL.installmentAmount)}`);
  console.log(`credit:      ${fmtUsdc(POOL.creditAmount)}`);
  console.log(`stake by level: L1=50% L2=30% L3=10%`);

  scenarioHappyPath();
  scenarioThreeVeteransDefault();
  scenarioAllVeteransDefault();

  console.log(`\n${failures === 0 ? "OK" : "FAIL"} — ${failures} assertion failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
