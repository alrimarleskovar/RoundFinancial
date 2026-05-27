/**
 * Admin query helpers (ADR 0009 Phase 1) against a REAL Postgres. Covers
 * indexer health/staleness, the structural canary overview (behavioral
 * gated), and the structural pools list with health labels.
 */

import { expect } from "chai";
import { PrismaClient } from "@prisma/client";

import {
  computeIndexerHealth,
  getCanaryOverview,
  listPoolsForAdmin,
  listUsersForAdmin,
} from "../src/adminQueries.js";

const prisma = new PrismaClient();
const CYCLE = 2_592_000n;

function poolData(pda: string, status: "Active" | "Completed", defaultedMembers: number) {
  return {
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
    status,
    startedAt: 1_700_000_000n,
    currentCycle: 3,
    nextCycleAt: 1_700_000_000n + 4n * CYCLE,
    totalContributed: 123n,
    totalPaidOut: 45n,
    solidarityBalance: 6n,
    escrowBalance: 7n,
    yieldAccrued: 0n,
    guaranteeFundBalance: 0n,
    totalProtocolFeeAccrued: 0n,
    yieldPrincipalDeposited: 0n,
    defaultedMembers,
    slotsBitmapHex: "0000000000000000",
  };
}

async function reset() {
  await prisma.event.deleteMany({});
  await prisma.contributeEvent.deleteMany({});
  await prisma.claimEvent.deleteMany({});
  await prisma.defaultEvent.deleteMany({});
  await prisma.member.deleteMany({});
  await prisma.pool.deleteMany({});
  await prisma.indexerCursor.deleteMany({});
  await prisma.backfillRun.deleteMany({});
}

describe("adminQueries — structural + health (ADR 0009 Phase 1)", function () {
  this.timeout(30_000);

  let poolAId = "";

  before(async () => {
    await reset();
    const a = await prisma.pool.create({
      data: poolData("PoolA11111111111111111111111111111111111", "Active", 0),
    });
    poolAId = a.id;
    await prisma.pool.create({
      data: poolData("PoolB11111111111111111111111111111111111", "Active", 6),
    }); // distressed
    await prisma.pool.create({
      data: poolData("PoolC11111111111111111111111111111111111", "Completed", 1),
    }); // at_risk

    const member = await prisma.member.create({
      data: {
        pda: "Mem1111111111111111111111111111111111111111",
        poolId: poolAId,
        wallet: "WalletAAA1111111111111111111111111111111111",
        nftAsset: "Nft11111111111111111111111111111111111111111",
        slotIndex: 0,
        reputationLevel: 1,
        stakeBps: 5000,
        stakeDeposited: 0n,
        contributionsPaid: 0,
        totalContributed: 0n,
        totalReceived: 0n,
        escrowBalance: 0n,
        onTimeCount: 0,
        lateCount: 0,
        defaulted: false,
        paidOut: false,
        lastReleasedCheckpoint: 0,
        joinedAt: 1_700_000_000n,
        stakeDepositedInitial: 0n,
        totalEscrowDeposited: 0n,
        lastTransferredAt: 1_700_000_000n,
      },
    });

    // Unresolved + orphaned typed rows (health signals). "Unresolved" =
    // resolvedAt IS NULL (what computeIndexerHealth counts), independent of
    // the poolId "_unresolved" ingest sentinel; we use a real FK here.
    await prisma.contributeEvent.create({
      data: {
        txSignature: "unresolved-sig",
        poolId: poolAId,
        memberId: member.id,
        cycle: 0,
        schemaId: 1,
        installment: 0n,
        solidarityAmt: 1n,
        escrowAmt: 1n,
        poolFloatAmt: 1n,
        slotIndex: 0,
        onTime: true,
        blockTime: 1n,
        slot: 1n,
        orphaned: false,
        resolvedAt: null,
      },
    });
    await prisma.claimEvent.create({
      data: {
        txSignature: "orphan-sig",
        poolId: poolAId,
        memberId: member.id,
        cycle: 0,
        slotIndex: 0,
        amountPaid: 1n,
        blockTime: 1n,
        slot: 1n,
        orphaned: true,
        resolvedAt: null,
      },
    });

    // Projected events (counts + projection freshness).
    for (const [sig, type] of [
      ["e1", "Contribute"],
      ["e2", "Contribute"],
      ["e3", "Default"],
    ] as const) {
      await prisma.event.create({
        data: {
          txSig: sig,
          eventType: type,
          subjectWallet: "WalletAAA1111111111111111111111111111111111",
          poolId: poolAId,
          poolPda: "PoolA11111111111111111111111111111111111",
          cycle: 0,
          slotIndex: 0,
          slotNumber: 1n,
          onChainTs: 1n,
          details: {},
        },
      });
    }

    await prisma.indexerCursor.create({
      data: { programId: "prog", lastSlot: 1000n, lastSig: "s" },
    });
    await prisma.backfillRun.create({
      data: { programId: "prog", status: "ok", durationMs: 1234, finishedAt: new Date() },
    });
  });

  after(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("computeIndexerHealth reports cursor, lag, unresolved, orphaned, projection", async () => {
    const h = await computeIndexerHealth(prisma, 1500);
    expect(h.lastSlot).to.equal("1000");
    expect(h.slotsBehind).to.equal(500);
    expect(h.lastBackfill?.status).to.equal("ok");
    expect(h.unresolved.contribute).to.equal(1);
    expect(h.orphaned.claim).to.equal(1);
    expect(h.projectedEventCount).to.equal(3);
    expect(h.lastProjectionUnix).to.be.a("number");
  });

  it("slotsBehind is null when no cluster slot is supplied (lag unknown, not fake 0)", async () => {
    const h = await computeIndexerHealth(prisma);
    expect(h.slotsBehind).to.equal(null);
  });

  it("getCanaryOverview is structural + gates behavioral", async () => {
    const o = await getCanaryOverview(prisma, 1500);
    expect(o.pools.total).to.equal(3);
    expect(o.pools.byStatus.Active).to.equal(2);
    expect(o.pools.byStatus.Completed).to.equal(1);
    expect(o.pools.atRisk).to.equal(2); // poolB + poolC have defaultedMembers > 0
    expect(o.members.total).to.equal(1);
    expect(o.events.contribute).to.equal(2);
    expect(o.events.default).to.equal(1);
  });

  it("listPoolsForAdmin maps fields + labels structural health", async () => {
    const rows = await listPoolsForAdmin(prisma);
    const byPda = Object.fromEntries(rows.map((r) => [r.pda, r]));
    expect(byPda["PoolA11111111111111111111111111111111111"]!.health).to.equal("healthy");
    expect(byPda["PoolB11111111111111111111111111111111111"]!.health).to.equal("distressed");
    expect(byPda["PoolC11111111111111111111111111111111111"]!.health).to.equal("at_risk");
    // bigints surfaced as strings; timestamps as unix seconds.
    expect(byPda["PoolA11111111111111111111111111111111111"]!.totalContributed).to.equal("123");
    expect(byPda["PoolA11111111111111111111111111111111111"]!.startedAtUnix).to.equal(
      1_700_000_000,
    );
  });

  it("listUsersForAdmin summarizes by wallet (1 member, 1 default, untimed events)", async () => {
    const users = await listUsersForAdmin(prisma);
    expect(users).to.have.length(1);
    const u = users[0]!;
    expect(u.wallet).to.equal("WalletAAA1111111111111111111111111111111111");
    expect(u.pools).to.equal(1);
    expect(u.level).to.equal(1);
    // The seeded events have no due_ts → no timed contributions → null rate.
    expect(u.timedContributions).to.equal(0);
    expect(u.onTimeRateBps).to.equal(null);
    // The seeded Default event for this wallet is counted.
    expect(u.defaults).to.equal(1);
  });
});
