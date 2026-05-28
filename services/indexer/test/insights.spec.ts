/**
 * Insights v0 primitives (ADR 0010). Two-axis coverage per view:
 *
 *   (a) "insufficient" — devnet shape (sample below threshold): API must
 *       return nulls for the metrics and an honest counter (so the UI can
 *       render progress, NEVER a number).
 *   (b) "significant" — synthetic shape (sample at/above 2× threshold):
 *       exact-value parity against the spec definition + Wilson CI bounds.
 *
 * `classifySample` and `wilson95Bps` are pure functions and get exact-
 * value coverage of their own.
 *
 * Fixture topology: the schema enforces `@@unique([poolId, slotIndex])` on
 * Member, so synthetic cohorts can't all share the same pool with
 * slotIndex=0. Two patterns below:
 *   - Single-pool cohort (retention, predictor): N members in ONE pool
 *     with slotIndex = 0..N-1. The DB doesn't enforce `membersTarget`;
 *     the unique constraint is the only invariant.
 *   - Wallet-across-pools history (progression, improvement): K pools, one
 *     per ordinal membership. Wallet w's k-th membership lives in
 *     `pool[k]` at slotIndex=w. That mirrors the real semantic ("wallet
 *     joined pool A then pool B") and keeps slotIndex unique per pool.
 */

import { expect } from "chai";
import { PrismaClient } from "@prisma/client";

import {
  behavioralImprovement,
  classifySample,
  defaultPredictor,
  INSIGHTS_THRESHOLDS,
  progression,
  retentionByLevel,
  wilson95Bps,
} from "../src/insights.js";

const prisma = new PrismaClient();
const CYCLE = 2_592_000n;

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

async function reset() {
  await prisma.event.deleteMany({});
  await prisma.contributeEvent.deleteMany({});
  await prisma.claimEvent.deleteMany({});
  await prisma.defaultEvent.deleteMany({});
  await prisma.member.deleteMany({});
  await prisma.pool.deleteMany({});
}

/** Create a Pool with a unique PDA derived from `tag`. Multiple pools can
 *  coexist per scenario — each "ordinal membership" lives in its own. */
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

// Distinct, schema-valid pseudo-base58 string of the requested length —
// good enough for unique PDA/wallet identity in tests.
function id(prefix: string, n: number, len = 44): string {
  const s = `${prefix}${n}`;
  return (s + "1".repeat(Math.max(0, len - s.length))).slice(0, len);
}

describe("Insights v0 — pure helpers", function () {
  this.timeout(5_000);

  it("classifySample: below T → insufficient", () => {
    expect(classifySample(0, 30)).to.equal("insufficient");
    expect(classifySample(29, 30)).to.equal("insufficient");
  });

  it("classifySample: [T, 2T) → preliminary", () => {
    expect(classifySample(30, 30)).to.equal("preliminary");
    expect(classifySample(59, 30)).to.equal("preliminary");
  });

  it("classifySample: ≥ 2T → significant", () => {
    expect(classifySample(60, 30)).to.equal("significant");
    expect(classifySample(1_000, 30)).to.equal("significant");
  });

  it("wilson95Bps(0, 0) is null (no observation, no interval)", () => {
    expect(wilson95Bps(0, 0)).to.equal(null);
  });

  it("wilson95Bps stays inside [0, 10000] even at the boundaries", () => {
    const lo = wilson95Bps(0, 100);
    expect(lo).to.not.equal(null);
    expect(lo![0]).to.be.gte(0);
    expect(lo![1]).to.be.lte(10_000);

    const hi = wilson95Bps(100, 100);
    expect(hi).to.not.equal(null);
    expect(hi![0]).to.be.gte(0);
    expect(hi![1]).to.be.lte(10_000);
  });

  it("wilson95Bps(50, 100) returns a CI centered ≈ 50%", () => {
    const ci = wilson95Bps(50, 100);
    expect(ci).to.not.equal(null);
    // Wilson 50%/100 ≈ [40.4%, 59.6%].
    expect(ci![0]).to.be.within(4_000, 4_100);
    expect(ci![1]).to.be.within(5_900, 6_000);
  });
});

describe("Insights v0 — retentionByLevel (gate: 30 per cohort)", function () {
  this.timeout(30_000);

  before(async () => {
    await reset();
    // L1, L2, L3 all share ONE pool with sequential slotIndex 0..94.
    //   L1: 30 members → preliminary. 10 completed, 5 defaulted.
    //   L2: 5 members  → insufficient.
    //   L3: 60 members → significant. 30 completed, 0 defaulted.
    const { id: poolId } = await createPool("Ret");
    const rows: ReturnType<typeof memberData>[] = [];
    let slot = 0;
    for (let k = 0; k < 30; k++) {
      rows.push(
        memberData({
          pda: id("L1m", k, 44),
          poolId,
          wallet: id("L1w", k, 44),
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
          pda: id("L2m", k, 44),
          poolId,
          wallet: id("L2w", k, 44),
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
          pda: id("L3m", k, 44),
          poolId,
          wallet: id("L3w", k, 44),
          slotIndex: slot++,
          level: 3,
          paidOut: k < 30,
          defaulted: false,
        }),
      );
    }
    await prisma.member.createMany({ data: rows });
  });

  after(async () => {
    await reset();
  });

  it("L1 cohort (n=30) is preliminary with exact rates", async () => {
    const v = await retentionByLevel(prisma);
    const l1 = v.cohorts.find((c) => c.level === 1)!;
    expect(l1.n).to.equal(30);
    expect(l1.status).to.equal("preliminary");
    expect(l1.completedShareBps).to.equal(Math.round((10 / 30) * 10_000)); // 3333
    expect(l1.defaultedShareBps).to.equal(Math.round((5 / 30) * 10_000)); // 1667
    expect(l1.completedCi95Bps).to.not.equal(null);
  });

  it("L2 cohort (n=5) is insufficient — metrics are null, NOT zero", async () => {
    const v = await retentionByLevel(prisma);
    const l2 = v.cohorts.find((c) => c.level === 2)!;
    expect(l2.n).to.equal(5);
    expect(l2.status).to.equal("insufficient");
    expect(l2.completedShareBps).to.equal(null);
    expect(l2.defaultedShareBps).to.equal(null);
    expect(l2.completedCi95Bps).to.equal(null);
  });

  it("L3 cohort (n=60) is significant with exact rates", async () => {
    const v = await retentionByLevel(prisma);
    const l3 = v.cohorts.find((c) => c.level === 3)!;
    expect(l3.n).to.equal(60);
    expect(l3.status).to.equal("significant");
    expect(l3.completedShareBps).to.equal(5_000); // 30/60
    expect(l3.defaultedShareBps).to.equal(0);
  });

  it("threshold is the documented constant (30 per cohort)", async () => {
    const v = await retentionByLevel(prisma);
    expect(v.threshold).to.equal(INSIGHTS_THRESHOLDS.retentionPerCohort);
  });
});

describe("Insights v0 — L1 default when ReputationProfile is unhydrated", function () {
  this.timeout(30_000);

  it("members with reputationLevel = 0 still land in L1 (no undercounting)", async () => {
    await reset();
    const { id: poolId } = await createPool("L1def0");
    const rows = Array.from({ length: 5 }, (_, k) =>
      memberData({
        pda: id("Z", k, 44),
        poolId,
        wallet: id("Zw", k, 44),
        slotIndex: k,
        level: 0, // sentinel for "RP not seen yet"; matches the program's L1 default
        paidOut: false,
        defaulted: false,
      }),
    );
    await prisma.member.createMany({ data: rows });
    const v = await retentionByLevel(prisma);
    const l1 = v.cohorts.find((c) => c.level === 1)!;
    expect(l1.n).to.equal(5);
  });

  it("level=1 also lands in L1 (the canonical fresh-wallet level)", async () => {
    await reset();
    const { id: poolId } = await createPool("L1def1");
    const rows = Array.from({ length: 7 }, (_, k) =>
      memberData({
        pda: id("O", k, 44),
        poolId,
        wallet: id("Ow", k, 44),
        slotIndex: k,
        level: 1,
        paidOut: false,
        defaulted: false,
      }),
    );
    await prisma.member.createMany({ data: rows });
    const v = await retentionByLevel(prisma);
    const l1 = v.cohorts.find((c) => c.level === 1)!;
    expect(l1.n).to.equal(7);
  });
});

describe("Insights v0 — defaultPredictor (gate: 100 wallets)", function () {
  this.timeout(30_000);

  it("below threshold (n=10) → status=insufficient, buckets=[]", async () => {
    await reset();
    const { id: poolId } = await createPool("PredLow");
    const rows = Array.from({ length: 10 }, (_, k) =>
      memberData({
        pda: id("Pm", k, 44),
        poolId,
        wallet: id("Pw", k, 44),
        slotIndex: k,
        level: 1,
        paidOut: false,
        defaulted: false,
      }),
    );
    await prisma.member.createMany({ data: rows });
    const v = await defaultPredictor(prisma);
    expect(v.totalWallets).to.equal(10);
    expect(v.status).to.equal("insufficient");
    expect(v.buckets).to.deep.equal([]);
    expect(v.overallDefaultRateBps).to.equal(null);
  });

  describe("with 120 wallets / 30 late / 20 grace / 15 defaulted", function () {
    let poolPdaStr = "";
    before(async () => {
      await reset();
      const { id: poolId, pda } = await createPool("Pred");
      poolPdaStr = pda;
      // 120 distinct wallets, each in this pool with sequential slotIndex
      // 0..119. 30 wallets (0..29) have one late event; 20 of those used
      // grace (0..19). Default outcome: wallets 0..9 (late+defaulted) and
      // 30..34 (no-late+defaulted) — 15 defaulted in total, with 10 of
      // them in the late cohort.
      const members = Array.from({ length: 120 }, (_, k) => {
        const defaulted = k < 10 || (k >= 30 && k < 35);
        return memberData({
          pda: id("Pm", k, 44),
          poolId,
          wallet: id("Pw", k, 44),
          slotIndex: k,
          level: 1,
          paidOut: false,
          defaulted,
        });
      });
      await prisma.member.createMany({ data: members });
      const events = Array.from({ length: 30 }, (_, k) => ({
        txSig: `sig-${k}`,
        eventType: "Contribute" as const,
        subjectWallet: id("Pw", k, 44),
        poolId,
        poolPda: poolPdaStr,
        cycle: 0,
        slotIndex: 0,
        slotNumber: 1n + BigInt(k),
        onChainTs: 1n + BigInt(k),
        deltaSeconds: 3600,
        graceUsed: k < 20,
        details: {},
      }));
      for (const e of events) await prisma.event.create({ data: e });
    });

    it("status is preliminary (T ≤ 120 < 2T)", async () => {
      const v = await defaultPredictor(prisma);
      expect(v.totalWallets).to.equal(120);
      expect(v.status).to.equal("preliminary");
    });

    it("overallDefaultRateBps is 15/120 (the chart baseline)", async () => {
      const v = await defaultPredictor(prisma);
      expect(v.overallDefaultRateBps).to.equal(Math.round((15 / 120) * 10_000));
    });

    it("late_gte_1 splits 30 / 90 with the documented default rates", async () => {
      const v = await defaultPredictor(prisma);
      const b = v.buckets.find((x) => x.feature === "late_gte_1")!;
      expect(b.withFeature).to.equal(30);
      expect(b.withoutFeature).to.equal(90);
      expect(b.withFeatureDefaultRateBps).to.equal(Math.round((10 / 30) * 10_000));
      expect(b.withoutFeatureDefaultRateBps).to.equal(Math.round((5 / 90) * 10_000));
    });

    it("grace_used_gte_1 splits 20 / 100", async () => {
      const v = await defaultPredictor(prisma);
      const b = v.buckets.find((x) => x.feature === "grace_used_gte_1")!;
      expect(b.withFeature).to.equal(20);
      expect(b.withoutFeature).to.equal(100);
    });

    it("late_gte_2: zero wallets with the feature in this fixture", async () => {
      const v = await defaultPredictor(prisma);
      const b = v.buckets.find((x) => x.feature === "late_gte_2")!;
      expect(b.withFeature).to.equal(0);
      expect(b.withoutFeature).to.equal(120);
      expect(b.withFeatureDefaultRateBps).to.equal(null);
    });
  });
});

describe("Insights v0 — progression (gate: 50 completed wallets)", function () {
  this.timeout(30_000);

  it("below threshold → insufficient with null shares", async () => {
    await reset();
    const { id: poolId } = await createPool("ProgLow");
    const rows = Array.from({ length: 10 }, (_, k) =>
      memberData({
        pda: id("Gm", k, 44),
        poolId,
        wallet: id("Gw", k, 44),
        slotIndex: k,
        level: 1,
        paidOut: k < 5,
        defaulted: false,
      }),
    );
    await prisma.member.createMany({ data: rows });
    const v = await progression(prisma);
    expect(v.eligibleWallets).to.equal(5);
    expect(v.status).to.equal("insufficient");
    expect(v.reachedL2ShareBps).to.equal(null);
    expect(v.avgPoolsToL2).to.equal(null);
  });

  it("above threshold: exact reach shares + mean pools", async () => {
    await reset();
    // 60 wallets each with up to 3 ordinal memberships, ordered by
    // joinedAt. Each ordinal lives in its OWN pool so (poolId, slotIndex)
    // stays unique with slotIndex = wallet index. That also matches the
    // real semantic: a wallet's "1st pool" and "2nd pool" are distinct
    // pools.
    const pool1 = await createPool("Prog1");
    const pool2 = await createPool("Prog2");
    const pool3 = await createPool("Prog3");

    type Row = ReturnType<typeof memberData>;
    const rows: Row[] = [];
    for (let k = 0; k < 60; k++) {
      const wallet = id("Gw", k, 44);
      // Pool 1: every wallet, level 1, paidOut=true (the "completed" gate).
      rows.push(
        memberData({
          pda: id("Gm1", k, 44),
          poolId: pool1.id,
          wallet,
          slotIndex: k,
          level: 1,
          paidOut: true,
          defaulted: false,
          joinedAt: 1_700_000_000n + BigInt(k),
        }),
      );
      // Pool 2: every wallet. First 30 graduate to L2; the rest stay L1.
      const secondLevel = k < 30 ? 2 : 1;
      rows.push(
        memberData({
          pda: id("Gm2", k, 44),
          poolId: pool2.id,
          wallet,
          slotIndex: k,
          level: secondLevel,
          paidOut: false,
          defaulted: false,
          joinedAt: 1_700_000_000n + BigInt(k) + 1_000_000n,
        }),
      );
      // Pool 3: first 10 wallets — they reach L3 on their 3rd membership.
      if (k < 10) {
        rows.push(
          memberData({
            pda: id("Gm3", k, 44),
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

    const v = await progression(prisma);
    expect(v.eligibleWallets).to.equal(60);
    expect(v.status).to.equal("preliminary"); // 50 ≤ 60 < 100
    expect(v.reachedL2ShareBps).to.equal(Math.round((30 / 60) * 10_000)); // 5000
    expect(v.reachedL3ShareBps).to.equal(Math.round((10 / 60) * 10_000)); // 1667
    // L2 first appears at idx 1 (2nd join) → 2 pools to L2.
    expect(v.avgPoolsToL2).to.equal(2);
    // L3 first appears at idx 2 (3rd join) → 3 pools to L3.
    expect(v.avgPoolsToL3).to.equal(3);
  });
});

describe("Insights v0 — behavioralImprovement (gate: 30 wallets with ≥3 pools)", function () {
  this.timeout(30_000);

  it("below threshold: walletsAtOrdinal still counted, onTimeRateBps null", async () => {
    await reset();
    // 10 wallets × 3 ordinal memberships each. One pool per ordinal so
    // each (poolId, slotIndex=wallet) pair is unique.
    const pools = [
      await createPool("ImpLow1"),
      await createPool("ImpLow2"),
      await createPool("ImpLow3"),
    ];
    type Row = ReturnType<typeof memberData>;
    const rows: Row[] = [];
    for (let w = 0; w < 10; w++) {
      for (let m = 0; m < 3; m++) {
        rows.push(
          memberData({
            pda: id(`ILw${w}m`, m, 44),
            poolId: pools[m]!.id,
            wallet: id("Iw", w, 44),
            slotIndex: w,
            level: 1,
            paidOut: false,
            defaulted: false,
            onTime: 4,
            late: 1,
            joinedAt: 1_700_000_000n + BigInt(w) * 100n + BigInt(m),
          }),
        );
      }
    }
    await prisma.member.createMany({ data: rows });
    const v = await behavioralImprovement(prisma);
    expect(v.eligibleWallets).to.equal(10);
    expect(v.status).to.equal("insufficient");
    for (const b of v.buckets) {
      expect(b.onTimeRateBps).to.equal(null); // gated
      expect(b.walletsAtOrdinal).to.equal(10); // counter still honest
    }
  });

  it("above threshold: 1st < 2nd < 3rd+ on-time rate (monotonic improvement)", async () => {
    await reset();
    // 35 wallets × 3 ordinal memberships. Per-ordinal on-time rate:
    //   1st pool: 1/5 on-time (rate 2000 bps)
    //   2nd pool: 3/5 on-time (rate 6000 bps)
    //   3rd pool: 5/5 on-time (rate 10000 bps)
    // One pool per ordinal so slotIndex=wallet is unique within each.
    const pools = [await createPool("Imp1"), await createPool("Imp2"), await createPool("Imp3")];
    type Row = ReturnType<typeof memberData>;
    const rows: Row[] = [];
    for (let w = 0; w < 35; w++) {
      const wallet = id("Iw", w, 44);
      const setups = [
        { onTime: 1, late: 4 },
        { onTime: 3, late: 2 },
        { onTime: 5, late: 0 },
      ];
      setups.forEach((s, m) => {
        rows.push(
          memberData({
            pda: id(`Iw${w}m`, m, 44),
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
    const v = await behavioralImprovement(prisma);
    expect(v.eligibleWallets).to.equal(35);
    expect(v.status).to.equal("preliminary");
    const r1 = v.buckets.find((b) => b.ordinal === 1)!;
    const r2 = v.buckets.find((b) => b.ordinal === 2)!;
    const r3 = v.buckets.find((b) => b.ordinal === 3)!;
    expect(r1.onTimeRateBps).to.equal(2_000);
    expect(r2.onTimeRateBps).to.equal(6_000);
    expect(r3.onTimeRateBps).to.equal(10_000);
    expect(r3.walletsAtOrdinal).to.equal(35);
  });
});

after(async () => {
  await prisma.$disconnect();
});
