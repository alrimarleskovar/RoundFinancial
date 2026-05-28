/**
 * Seed Insights v0 fixtures into the indexer DB so /admin/ops/insights can
 * be visually inspected without depending on real devnet traffic (which is
 * always below the sample-size gates) or on leaked test fixtures.
 *
 * Same four topologies that back services/indexer/test/insights.spec.ts —
 * documented per-section in the test, but trimmed to one fixture per
 * section (the "above threshold" cases that produce visible charts). The
 * `all` mode seeds the four with disjoint prefixes so they coexist in one
 * DB state without colliding on `pda` or `(poolId, slotIndex)`.
 *
 * Usage:
 *   pnpm --filter @roundfi/indexer seed:insights all
 *   pnpm --filter @roundfi/indexer seed:insights clean
 *   pnpm --filter @roundfi/indexer seed:insights retention
 *   pnpm --filter @roundfi/indexer seed:insights predictor
 *   pnpm --filter @roundfi/indexer seed:insights progression
 *   pnpm --filter @roundfi/indexer seed:insights improvement
 *
 * Every mode truncates first so the run is reproducible. Cross-section
 * counts in `all` mode are intentionally NOT clean against the test
 * assertions (retention picks up predictor's L1 wallets, etc.) — the goal
 * is "show all four charts populated", not "match unit-test values".
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CYCLE = 2_592_000n;

type Topology =
  | "all"
  | "clean"
  | "retention"
  | "predictor"
  | "progression"
  | "improvement";

function id(prefix: string, n: number, len = 44): string {
  const s = `${prefix}${String(n).padStart(4, "0")}`;
  return (s + "1".repeat(Math.max(0, len - s.length))).slice(0, len);
}

function memberData(opts: {
  pda: string;
  poolId: string;
  wallet: string;
  slotIndex: number;
  level: number;
  paidOut: boolean;
  defaulted: boolean;
  onTime?: number;
  late?: number;
  joinedAt?: bigint;
}) {
  const onTime = opts.onTime ?? 0;
  const late = opts.late ?? 0;
  return {
    pda: opts.pda,
    poolId: opts.poolId,
    wallet: opts.wallet,
    nftAsset: `Nft${opts.pda.slice(3, 10)}`,
    slotIndex: opts.slotIndex,
    reputationLevel: opts.level,
    stakeBps: 5000,
    stakeDeposited: 0n,
    contributionsPaid: onTime + late,
    totalContributed: 0n,
    totalReceived: 0n,
    escrowBalance: 0n,
    onTimeCount: onTime,
    lateCount: late,
    defaulted: opts.defaulted,
    paidOut: opts.paidOut,
    lastReleasedCheckpoint: 0,
    joinedAt: opts.joinedAt ?? 1_700_000_000n,
    stakeDepositedInitial: 0n,
    totalEscrowDeposited: 0n,
    lastTransferredAt: opts.joinedAt ?? 1_700_000_000n,
  };
}

async function createPool(tag: string): Promise<{ id: string; pda: string }> {
  const pda = `Pool${tag}`.padEnd(44, "1");
  const p = await prisma.pool.create({
    data: {
      pda,
      authority: "Auth1111111111111111111111111111111111111111",
      seedId: 1n,
      usdcMint: "Usdc1111111111111111111111111111111111111111",
      yieldAdapter: "Yield111111111111111111111111111111111111111",
      membersTarget: 24,
      installmentAmount: 600_000_000n,
      creditAmount: 10_000_000_000n,
      cyclesTotal: 24,
      cycleDurationSec: CYCLE,
      seedDrawBps: 9160,
      solidarityBps: 100,
      escrowReleaseBps: 2500,
      membersJoined: 24,
      status: "Active",
      startedAt: 1_700_000_000n,
      currentCycle: 3,
      nextCycleAt: 1_700_000_000n + 4n * CYCLE,
      totalContributed: 0n,
      totalPaidOut: 0n,
      solidarityBalance: 0n,
      escrowBalance: 0n,
      yieldAccrued: 0n,
      guaranteeFundBalance: 0n,
      totalProtocolFeeAccrued: 0n,
      yieldPrincipalDeposited: 0n,
      defaultedMembers: 0,
      slotsBitmapHex: "0000000000000000",
    },
  });
  return { id: p.id, pda };
}

async function reset() {
  await prisma.event.deleteMany({});
  await prisma.contributeEvent.deleteMany({});
  await prisma.claimEvent.deleteMany({});
  await prisma.defaultEvent.deleteMany({});
  await prisma.member.deleteMany({});
  await prisma.pool.deleteMany({});
}

// L1=30 (10 completed, 5 defaulted), L2=5 (insufficient), L3=60 (30 completed)
async function seedRetention(): Promise<void> {
  const { id: poolId } = await createPool("Ret");
  const rows: ReturnType<typeof memberData>[] = [];
  let slot = 0;
  for (let k = 0; k < 30; k++) {
    rows.push(
      memberData({
        pda: id("L1m", k),
        poolId,
        wallet: id("L1w", k),
        slotIndex: slot++,
        level: 1,
        paidOut: k < 10,
        defaulted: k >= 10 && k < 15,
      }),
    );
  }
  for (let k = 0; k < 5; k++) {
    rows.push(
      memberData({
        pda: id("L2m", k),
        poolId,
        wallet: id("L2w", k),
        slotIndex: slot++,
        level: 2,
        paidOut: false,
        defaulted: false,
      }),
    );
  }
  for (let k = 0; k < 60; k++) {
    rows.push(
      memberData({
        pda: id("L3m", k),
        poolId,
        wallet: id("L3w", k),
        slotIndex: slot++,
        level: 3,
        paidOut: k < 30,
        defaulted: false,
      }),
    );
  }
  await prisma.member.createMany({ data: rows });
}

// 120 wallets / 30 late / 20 grace / 15 defaulted (preliminary, T ≤ 120 < 2T)
async function seedPredictor(): Promise<void> {
  const { id: poolId, pda: poolPda } = await createPool("Pred");
  const members = Array.from({ length: 120 }, (_, k) => {
    const defaulted = k < 10 || (k >= 30 && k < 35);
    return memberData({
      pda: id("Pm", k),
      poolId,
      wallet: id("Pw", k),
      slotIndex: k,
      level: 1,
      paidOut: false,
      defaulted,
    });
  });
  await prisma.member.createMany({ data: members });
  const events = Array.from({ length: 30 }, (_, k) => ({
    txSig: `seed-pred-sig-${k}`,
    eventType: "Contribute" as const,
    subjectWallet: id("Pw", k),
    poolId,
    poolPda,
    cycle: 0,
    slotIndex: 0,
    slotNumber: 1n + BigInt(k),
    onChainTs: 1n + BigInt(k),
    deltaSeconds: 3600,
    graceUsed: k < 20,
    details: {},
  }));
  for (const e of events) await prisma.event.create({ data: e });
}

// 60 wallets × up to 3 ordinal pools — reachL2=30/60, reachL3=10/60
async function seedProgression(): Promise<void> {
  const pool1 = await createPool("Prog1");
  const pool2 = await createPool("Prog2");
  const pool3 = await createPool("Prog3");
  const rows: ReturnType<typeof memberData>[] = [];
  for (let k = 0; k < 60; k++) {
    const wallet = id("Gw", k);
    rows.push(
      memberData({
        pda: id("Gm1", k),
        poolId: pool1.id,
        wallet,
        slotIndex: k,
        level: 1,
        paidOut: true,
        defaulted: false,
        joinedAt: 1_700_000_000n + BigInt(k),
      }),
    );
    rows.push(
      memberData({
        pda: id("Gm2", k),
        poolId: pool2.id,
        wallet,
        slotIndex: k,
        level: k < 30 ? 2 : 1,
        paidOut: false,
        defaulted: false,
        joinedAt: 1_700_000_000n + BigInt(k) + 1_000_000n,
      }),
    );
    if (k < 10) {
      rows.push(
        memberData({
          pda: id("Gm3", k),
          poolId: pool3.id,
          wallet,
          slotIndex: k,
          level: 3,
          paidOut: false,
          defaulted: false,
          joinedAt: 1_700_000_000n + BigInt(k) + 2_000_000n,
        }),
      );
    }
  }
  await prisma.member.createMany({ data: rows });
}

// 35 wallets × 3 ordinal pools, on-time rate 20% → 60% → 100% (preliminary)
async function seedImprovement(): Promise<void> {
  const pools = [
    await createPool("Imp1"),
    await createPool("Imp2"),
    await createPool("Imp3"),
  ];
  const setups = [
    { onTime: 1, late: 4 },
    { onTime: 3, late: 2 },
    { onTime: 5, late: 0 },
  ];
  const rows: ReturnType<typeof memberData>[] = [];
  for (let w = 0; w < 35; w++) {
    const wallet = id("Iw", w);
    setups.forEach((s, m) => {
      rows.push(
        memberData({
          pda: id(`Iw${String(w).padStart(3, "0")}m`, m),
          poolId: pools[m]!.id,
          wallet,
          slotIndex: w,
          level: 1,
          paidOut: false,
          defaulted: false,
          onTime: s.onTime,
          late: s.late,
          joinedAt: 1_700_000_000n + BigInt(w) * 100n + BigInt(m),
        }),
      );
    });
  }
  await prisma.member.createMany({ data: rows });
}

function usage(): never {
  console.error(
    "usage: pnpm --filter @roundfi/indexer seed:insights <topology>\n" +
      "  topologies: all | clean | retention | predictor | progression | improvement",
  );
  process.exit(1);
}

async function main() {
  const arg = process.argv[2] as Topology | undefined;
  if (!arg) usage();

  await reset();
  console.log("DB reset.");

  switch (arg) {
    case "clean":
      console.log("Clean. No seed.");
      break;
    case "retention":
      await seedRetention();
      console.log("Seeded retention: L1=30, L2=5, L3=60.");
      break;
    case "predictor":
      await seedPredictor();
      console.log("Seeded predictor: 120 wallets, 30 late, 20 grace, 15 defaulted.");
      break;
    case "progression":
      await seedProgression();
      console.log("Seeded progression: 60 wallets across 3 ordinal pools.");
      break;
    case "improvement":
      await seedImprovement();
      console.log("Seeded improvement: 35 wallets × 3 ordinals, 20%→60%→100%.");
      break;
    case "all":
      await seedRetention();
      await seedPredictor();
      await seedProgression();
      await seedImprovement();
      console.log("Seeded all four topologies.");
      break;
    default:
      usage();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
