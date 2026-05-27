/**
 * Shared ingest pipeline (ADR 0009 decision B) against a REAL Postgres.
 * Proves resolve-when-possible / else-NULL + idempotency + that resolved
 * rows flow through the projector with exact behavioral values, end to end.
 */

import { expect } from "chai";
import { PrismaClient } from "@prisma/client";

import { bumpCursor, upsertEventsFromLogs } from "../src/ingest.js";
import { rebuildEvents } from "../src/projector.js";
import {
  getCanaryBehavioral,
  getPoolDetail,
  getUserProfile,
  queryEvents,
  exportEventRows,
  eventsToCsv,
  recordExportAudit,
} from "../src/adminQueries.js";
import type { CoreEvent } from "../src/decoder.js";

const prisma = new PrismaClient();
const CYCLE = 2_592_000n;
const STARTED_AT = 1_700_000_000n;
const POOL_PDA = "PoolIngest11111111111111111111111111111111";
const WALLET = "WalletIngest1111111111111111111111111111111";

async function reset() {
  await prisma.event.deleteMany({});
  await prisma.contributeEvent.deleteMany({});
  await prisma.claimEvent.deleteMany({});
  await prisma.defaultEvent.deleteMany({});
  await prisma.member.deleteMany({});
  await prisma.pool.deleteMany({});
  await prisma.indexerCursor.deleteMany({});
  await prisma.exportAudit.deleteMany({});
}

const contribute = (slotIndex: number, onTime: boolean): CoreEvent => ({
  kind: "contribute",
  cycle: 0,
  slotIndex,
  solidarityAmt: 100_000n,
  escrowAmt: 2_500_000n,
  poolAmt: 7_400_000n,
  onTime,
});

describe("ingest — resolve-when-possible / else NULL (ADR 0009 B)", function () {
  this.timeout(30_000);

  before(async () => {
    await reset();
    const pool = await prisma.pool.create({
      data: {
        pda: POOL_PDA,
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
        startedAt: STARTED_AT,
        currentCycle: 1,
        nextCycleAt: STARTED_AT + CYCLE,
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
    await prisma.member.create({
      data: {
        pda: "MemIngest111111111111111111111111111111111",
        poolId: pool.id,
        wallet: WALLET,
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
        joinedAt: STARTED_AT,
        stakeDepositedInitial: 0n,
        totalEscrowDeposited: 0n,
        lastTransferredAt: STARTED_AT,
      },
    });
  });

  after(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("resolves at ingest when the pool PDA is in the account keys (real FK + resolvedAt)", async () => {
    const due = STARTED_AT + CYCLE;
    await upsertEventsFromLogs(
      prisma,
      { txSignature: "sig-resolved", slot: 5000n, blockTime: due + 100n, accountKeys: [POOL_PDA] },
      [contribute(0, false)],
    );
    const row = await prisma.contributeEvent.findUniqueOrThrow({
      where: { txSignature: "sig-resolved" },
    });
    expect(row.poolId).to.be.a("string");
    expect(row.memberId).to.be.a("string");
    expect(row.resolvedAt).to.not.equal(null);
  });

  it("defers to NULL when no account keys (webhook fast-path)", async () => {
    await upsertEventsFromLogs(
      prisma,
      {
        txSignature: "sig-deferred",
        slot: 5001n,
        blockTime: STARTED_AT + CYCLE + 5n,
        accountKeys: [],
      },
      [contribute(0, false)],
    );
    const row = await prisma.contributeEvent.findUniqueOrThrow({
      where: { txSignature: "sig-deferred" },
    });
    expect(row.poolId).to.equal(null);
    expect(row.memberId).to.equal(null);
    expect(row.resolvedAt).to.equal(null);
  });

  it("is idempotent — re-running does not duplicate", async () => {
    const before = await prisma.contributeEvent.count();
    await upsertEventsFromLogs(
      prisma,
      {
        txSignature: "sig-resolved",
        slot: 5000n,
        blockTime: STARTED_AT + CYCLE + 100n,
        accountKeys: [POOL_PDA],
      },
      [contribute(0, false)],
    );
    expect(await prisma.contributeEvent.count()).to.equal(before);
  });

  it("resolved rows project into events with exact behavioral values; deferred rows do not", async () => {
    await rebuildEvents(prisma);
    const projected = await prisma.event.findMany();
    // Only the resolved contribution projects (the deferred NULL row is skipped).
    expect(projected).to.have.length(1);
    const ev = projected[0]!;
    expect(ev.txSig).to.equal("sig-resolved");
    expect(ev.dueTs).to.equal(STARTED_AT + CYCLE); // == on-chain next_cycle_at(cycle 0)
    expect(ev.deltaSeconds).to.equal(100);
    expect(ev.graceUsed).to.equal(true);
    expect(ev.subjectWallet).to.equal(WALLET);
  });

  it("getCanaryBehavioral aggregates the projected events (gate #5 cleared)", async () => {
    // The single projected contribution is late-within-grace (delta +100).
    const b = await getCanaryBehavioral(prisma);
    expect(b.timedContributions).to.equal(1);
    expect(b.onTime).to.equal(0);
    expect(b.late).to.equal(1);
    expect(b.graceUsed).to.equal(1);
    expect(b.onTimeRateBps).to.equal(0);
    expect(b.avgDelaySecondsLate).to.equal(100);
    expect(b.defaults).to.equal(0);
  });

  it("getPoolDetail returns members + the behavioral timeline", async () => {
    const detail = await getPoolDetail(prisma, POOL_PDA);
    expect(detail).to.not.equal(null);
    expect(detail!.members).to.have.length(1);
    expect(detail!.timeline).to.have.length(1);
    const t = detail!.timeline[0]!;
    expect(t.eventType).to.equal("Contribute");
    expect(t.deltaSeconds).to.equal(100);
    expect(t.graceUsed).to.equal(true);
    expect(t.subjectWallet).to.equal(WALLET);
  });

  it("getUserProfile aggregates across pools (derived) + timeline", async () => {
    const profile = await getUserProfile(prisma, WALLET);
    expect(profile).to.not.equal(null);
    expect(profile!.pools.total).to.equal(1);
    expect(profile!.pools.active).to.equal(1);
    const b = profile!.behavioral;
    expect(b.timedContributions).to.equal(1);
    expect(b.onTime).to.equal(0);
    expect(b.late).to.equal(1);
    expect(b.graceUsed).to.equal(1);
    expect(b.avgDelaySecondsLate).to.equal(100);
    // Late-but-within-grace is NOT a setback → no recovery context.
    expect(b.hadSetback).to.equal(false);
    expect(b.recovered).to.equal(false);
    expect(profile!.timeline).to.have.length(1);
    expect(profile!.timeline[0]!.poolPda).to.equal(POOL_PDA);
    // chain-truth counters cross-check (seeded member has 0/0).
    expect(profile!.chainCounters.onTimeCount).to.equal(0);
  });

  it("queryEvents filters + paginates over the recorder", async () => {
    const all = await queryEvents(prisma, {}, { limit: 50, offset: 0 });
    expect(all.total).to.equal(1);
    expect(all.rows[0]!.txSig).to.equal("sig-resolved");
    expect(all.rows[0]!.eventType).to.equal("Contribute");

    // The projected contribution is late-within-grace.
    expect((await queryEvents(prisma, { timing: "grace" }, {})).total).to.equal(1);
    expect((await queryEvents(prisma, { timing: "on_time" }, {})).total).to.equal(0);
    expect((await queryEvents(prisma, { eventType: "Default" }, {})).total).to.equal(0);
    expect((await queryEvents(prisma, { subjectWallet: WALLET }, {})).total).to.equal(1);
  });

  it("export reproduces the filtered slice + records an audit row", async () => {
    const rows = await exportEventRows(prisma, {});
    expect(rows).to.have.length(1);
    const csv = eventsToCsv(rows);
    expect(csv.split("\n")).to.have.length(2); // header + 1 row
    expect(csv).to.include("sig-resolved");

    await recordExportAudit(prisma, {
      actor: "OperatorWallet111",
      format: "csv",
      filter: {},
      rowCount: rows.length,
    });
    const audits = await prisma.exportAudit.findMany();
    expect(audits).to.have.length(1);
    expect(audits[0]!.actor).to.equal("OperatorWallet111");
    expect(audits[0]!.format).to.equal("csv");
    expect(audits[0]!.rowCount).to.equal(1);
  });

  it("bumpCursor is monotonic", async () => {
    await bumpCursor(prisma, "prog", 100n, "a");
    await bumpCursor(prisma, "prog", 50n, "b"); // ignored (backwards)
    let cur = await prisma.indexerCursor.findUniqueOrThrow({ where: { programId: "prog" } });
    expect(cur.lastSlot).to.equal(100n);
    await bumpCursor(prisma, "prog", 200n, "c");
    cur = await prisma.indexerCursor.findUniqueOrThrow({ where: { programId: "prog" } });
    expect(cur.lastSlot).to.equal(200n);
  });
});
