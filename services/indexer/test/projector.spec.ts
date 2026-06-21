/**
 * Projector parity + rebuildability test (ADR 0009 close-out criteria).
 *
 * Runs against a REAL Postgres (DATABASE_URL) so the assertions exercise
 * the migration, the `events` table, and the typed views end-to-end — not
 * a mock. Proves:
 *   #4 rebuild is NOT write-once (re-running rebuildEvents from zero
 *      reconstructs identical derived values),
 *   #5 (local analogue) EXACT values, not "field populated": dueTs equals
 *      the on-chain next_cycle_at of that cycle, delta/grace match,
 *   #6 cycle is the one carried on the row (the cycle current at the tx
 *      slot), and default-eligibility is NOT stored as an event fact,
 *   #3 details JSONB carries every type-specific field (via the views),
 *   #7 the typed views reproduce the typed shape over `events`,
 *   3a composite unique (txSig, eventType) lets one tx carry two events.
 */

import { expect } from "chai";
import { PrismaClient } from "@prisma/client";
import { dueTs as computeDueTs } from "@roundfi/sdk";

import { rebuildEvents } from "../src/projector.js";

const prisma = new PrismaClient();

const STARTED_AT = 1_700_000_000n;
const CYCLE = 2_592_000n; // 30 days
const RESOLVED = new Date("2026-05-27T00:00:00Z");

function poolData(pda: string, startedAt: bigint | null) {
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
    status: "Active" as const,
    startedAt,
    currentCycle: 0,
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
  };
}

function memberData(pda: string, poolId: string, wallet: string, slotIndex: number) {
  return {
    pda,
    poolId,
    wallet,
    nftAsset: "Nft11111111111111111111111111111111111111111",
    slotIndex,
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

describe("projector — events derivation parity (ADR 0009)", function () {
  this.timeout(30_000);

  before(async () => {
    await reset();
  });

  after(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("derives EXACT dueTs/delta/grace; dueTs == on-chain next_cycle_at", async () => {
    const pool = await prisma.pool.create({
      data: poolData("PoolActive1111111111111111111111111111111", STARTED_AT),
    });
    const member = await prisma.member.create({
      data: memberData(
        "Mem11111111111111111111111111111111111111111",
        pool.id,
        "WalletAAA1111111111111111111111111111111111",
        0,
      ),
    });

    // Cycle 0 deadline the PROGRAM would compute: started_at + 1*cycle.
    const onChainNextCycleAt = STARTED_AT + CYCLE;
    const blockTime = onChainNextCycleAt + 100n; // 100s late → within grace

    await prisma.contributeEvent.create({
      data: {
        txSignature: "sigContribute0",
        poolId: pool.id,
        memberId: member.id,
        cycle: 0,
        schemaId: 2,
        installment: 0n,
        solidarityAmt: 100_000n,
        escrowAmt: 2_500_000n,
        poolFloatAmt: 7_400_000n,
        slotIndex: 0,
        onTime: false,
        blockTime,
        slot: 5000n,
        orphaned: false,
        resolvedAt: RESOLVED,
      },
    });

    await rebuildEvents(prisma);

    const ev = await prisma.event.findUniqueOrThrow({
      where: { txSig_eventType: { txSig: "sigContribute0", eventType: "Contribute" } },
    });

    // dueTs equals what behavioral.dueTs computes AND the on-chain value.
    expect(ev.dueTs).to.equal(onChainNextCycleAt);
    expect(ev.dueTs).to.equal(computeDueTs(STARTED_AT, CYCLE, 0));
    expect(ev.deltaSeconds).to.equal(100);
    expect(ev.graceUsed).to.equal(true);
    expect(ev.cycle).to.equal(0); // carried from the row, not "now"
    expect(ev.subjectWallet).to.equal("WalletAAA1111111111111111111111111111111111");
    expect(ev.onChainTs).to.equal(blockTime);
    // details JSONB carries type-specific fields as decimal strings.
    expect((ev.details as Record<string, unknown>).solidarityAmt).to.equal("100000");
    expect((ev.details as Record<string, unknown>).onTime).to.equal(false);
  });

  it("on-time contribution: negative delta, grace false", async () => {
    const pool = await prisma.pool.findFirstOrThrow();
    const member = await prisma.member.findFirstOrThrow();
    const due1 = STARTED_AT + 2n * CYCLE; // cycle 1
    await prisma.contributeEvent.create({
      data: {
        txSignature: "sigContribute1",
        poolId: pool.id,
        memberId: member.id,
        cycle: 1,
        schemaId: 1,
        installment: 0n,
        solidarityAmt: 100_000n,
        escrowAmt: 2_500_000n,
        poolFloatAmt: 7_400_000n,
        slotIndex: 0,
        onTime: true,
        blockTime: due1 - 50n,
        slot: 6000n,
        orphaned: false,
        resolvedAt: RESOLVED,
      },
    });
    await rebuildEvents(prisma);
    const ev = await prisma.event.findUniqueOrThrow({
      where: { txSig_eventType: { txSig: "sigContribute1", eventType: "Contribute" } },
    });
    expect(ev.dueTs).to.equal(due1);
    expect(ev.deltaSeconds).to.equal(-50);
    expect(ev.graceUsed).to.equal(false);
  });

  it("pre-Active pool: dueTs null, delta null, grace false (schedule undefined)", async () => {
    const forming = await prisma.pool.create({
      data: poolData("PoolForming111111111111111111111111111111", null),
    });
    const member = await prisma.member.create({
      data: memberData(
        "Mem22222222222222222222222222222222222222222",
        forming.id,
        "WalletBBB2222222222222222222222222222222222",
        1,
      ),
    });
    await prisma.contributeEvent.create({
      data: {
        txSignature: "sigContributeForming",
        poolId: forming.id,
        memberId: member.id,
        cycle: 0,
        schemaId: 1,
        installment: 0n,
        solidarityAmt: 1n,
        escrowAmt: 1n,
        poolFloatAmt: 1n,
        slotIndex: 1,
        onTime: true,
        blockTime: 123n,
        slot: 7000n,
        orphaned: false,
        resolvedAt: RESOLVED,
      },
    });
    await rebuildEvents(prisma);
    const ev = await prisma.event.findUniqueOrThrow({
      where: { txSig_eventType: { txSig: "sigContributeForming", eventType: "Contribute" } },
    });
    expect(ev.dueTs).to.equal(null);
    expect(ev.deltaSeconds).to.equal(null);
    expect(ev.graceUsed).to.equal(false);
  });

  it("claim + default sharing one txSig coexist (composite unique 3a); default_reason inferred", async () => {
    const pool = await prisma.pool.findFirstOrThrow({ where: { startedAt: { not: null } } });
    const member = await prisma.member.findFirstOrThrow({ where: { poolId: pool.id } });

    await prisma.claimEvent.create({
      data: {
        txSignature: "sigShared",
        poolId: pool.id,
        memberId: member.id,
        cycle: 0,
        slotIndex: 0,
        amountPaid: 10_000_000_000n,
        blockTime: STARTED_AT + CYCLE - 10n,
        slot: 8000n,
        orphaned: false,
        resolvedAt: RESOLVED,
      },
    });
    await prisma.defaultEvent.create({
      data: {
        txSignature: "sigShared",
        poolId: pool.id,
        defaultedWallet: "WalletCCC3333333333333333333333333333333333",
        cycle: 1,
        slotIndex: 3,
        seizedSolidarity: 200_000n,
        seizedEscrow: 0n,
        seizedStake: 0n,
        dInit: 0n,
        dRem: 30_000_000n,
        cInit: 30_000_000n,
        cAfter: 30_000_000n,
        blockTime: STARTED_AT + 2n * CYCLE + 700_000n,
        slot: 8000n,
        orphaned: false,
        resolvedAt: RESOLVED,
      },
    });

    await rebuildEvents(prisma);

    const claim = await prisma.event.findUniqueOrThrow({
      where: { txSig_eventType: { txSig: "sigShared", eventType: "Claim" } },
    });
    const def = await prisma.event.findUniqueOrThrow({
      where: { txSig_eventType: { txSig: "sigShared", eventType: "Default" } },
    });
    // Both rows exist under the same signature — composite unique works.
    expect(claim.eventType).to.equal("Claim");
    expect(def.eventType).to.equal("Default");
    // Claim has no payment timing.
    expect(claim.deltaSeconds).to.equal(null);
    expect((claim.details as Record<string, unknown>).amountPaid).to.equal("10000000000");
    // Default reason inferred + provenance-tagged (never on-chain fact).
    expect(def.defaultReason).to.equal("MissedDeadline");
    expect(def.defaultReasonProvenance).to.equal("Inferred");
    expect(def.subjectWallet).to.equal("WalletCCC3333333333333333333333333333333333");
    // No default-eligibility column stored as an event fact (criterion #6).
    expect(Object.keys(def)).to.not.include("defaultEligible");
  });

  it("rebuild is idempotent — re-running from zero reconstructs identical derived values (#4)", async () => {
    const snapshot = async () =>
      (await prisma.event.findMany({ orderBy: [{ txSig: "asc" }, { eventType: "asc" }] })).map(
        (e) => ({
          txSig: e.txSig,
          eventType: e.eventType,
          subjectWallet: e.subjectWallet,
          cycle: e.cycle,
          dueTs: e.dueTs?.toString() ?? null,
          deltaSeconds: e.deltaSeconds,
          graceUsed: e.graceUsed,
          defaultReason: e.defaultReason,
          details: e.details,
        }),
      );

    const before = await snapshot();
    await rebuildEvents(prisma); // from zero again
    const after = await snapshot();
    expect(after).to.deep.equal(before);
  });

  it("typed views reproduce the typed shape over events (#7) + details roundtrip (#3)", async () => {
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        txSignature: string;
        solidarityAmt: string;
        graceUsed: boolean;
        dueTs: bigint | null;
      }>
    >(
      `SELECT "txSignature", "solidarityAmt", "graceUsed", "dueTs" FROM contribute_events_v WHERE "txSignature" = 'sigContribute0'`,
    );
    expect(rows).to.have.length(1);
    expect(rows[0]!.solidarityAmt.toString()).to.equal("100000");
    expect(rows[0]!.graceUsed).to.equal(true);
    expect(rows[0]!.dueTs?.toString()).to.equal((STARTED_AT + CYCLE).toString());

    const claims = await prisma.$queryRawUnsafe<Array<{ amountPaid: string }>>(
      `SELECT "amountPaid" FROM claim_events_v WHERE "txSignature" = 'sigShared'`,
    );
    expect(claims[0]!.amountPaid.toString()).to.equal("10000000000");

    const defs = await prisma.$queryRawUnsafe<
      Array<{ defaultedWallet: string; defaultReason: string }>
    >(
      `SELECT "defaultedWallet", "defaultReason" FROM default_events_v WHERE "txSignature" = 'sigShared'`,
    );
    expect(defs[0]!.defaultReason).to.equal("MissedDeadline");
  });
});
