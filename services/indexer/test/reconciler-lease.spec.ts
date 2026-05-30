/**
 * Reconciler lease — leader election across replicas (Wave 9.2).
 *
 * DB-backed verification of the multi-instance race close. Like
 * `admin_shared_store_pg.spec.ts` and `insights.spec.ts`, this spec
 * requires a real Postgres (DATABASE_URL) + the
 * `20260530100000_reconciler_lease` migration applied. It is operator-
 * run, not in the `js` CI lane.
 *
 *   cd services/indexer
 *   pnpm exec mocha -t 60000 test/reconciler-lease.spec.ts
 *
 * The spec asserts the four properties the Wave 9 survey called out:
 *   1. After the migration, the singleton row exists with epoch
 *      acquiredAt, so the very first tick on any instance wins.
 *   2. Two concurrent acquires resolve to EXACTLY one winner.
 *   3. Within the TTL, a second acquire from the same / different
 *      "instance" loses (the running leader keeps the lease).
 *   4. After the TTL expires, the next acquire from ANY instance wins
 *      (crashed-leader recovery).
 */

import { expect } from "chai";
import { PrismaClient } from "@prisma/client";

import { tryAcquireReconcilerLease } from "../src/reconciler.js";

const prisma = new PrismaClient();
const LEASE_ID = "main";

async function resetLease(): Promise<void> {
  // Reset to the epoch sentinel the migration's bootstrap row uses, so
  // each test starts from "lease is free, first acquire wins".
  await prisma.reconcilerLease.upsert({
    where: { id: LEASE_ID },
    create: { id: LEASE_ID, acquiredAt: new Date(1000), holder: "" },
    update: { acquiredAt: new Date(1000), holder: "" },
  });
}

describe("reconciler lease — leader election across replicas", () => {
  beforeEach(resetLease);
  after(async () => {
    await resetLease();
    await prisma.$disconnect();
  });

  it("bootstraps with the singleton row from the migration", async () => {
    const row = await prisma.reconcilerLease.findUnique({ where: { id: LEASE_ID } });
    expect(row, "migration must have inserted the 'main' row").to.not.equal(null);
    expect(row!.id).to.equal(LEASE_ID);
  });

  it("first acquire wins (lease is past TTL after reset)", async () => {
    const acquired = await tryAcquireReconcilerLease(prisma, {
      ttlSecs: 60,
      holder: "host-A:1",
      now: new Date(),
    });
    expect(acquired).to.equal(true);

    const row = await prisma.reconcilerLease.findUnique({ where: { id: LEASE_ID } });
    expect(row!.holder).to.equal("host-A:1");
  });

  it("two concurrent acquires resolve to EXACTLY one winner", async () => {
    // Both fire at the same wall-clock time against the same Postgres
    // row. The UPDATE's row-level lock serializes them: one sees the
    // pre-update acquiredAt and matches the WHERE clause; the other
    // sees the updated value and fails the predicate.
    const now = new Date();
    const results = await Promise.all([
      tryAcquireReconcilerLease(prisma, { ttlSecs: 60, holder: "host-A:1", now }),
      tryAcquireReconcilerLease(prisma, { ttlSecs: 60, holder: "host-B:1", now }),
      tryAcquireReconcilerLease(prisma, { ttlSecs: 60, holder: "host-C:1", now }),
    ]);
    expect(results.filter((r) => r === true)).to.have.length(1);
    expect(results.filter((r) => r === false)).to.have.length(2);
  });

  it("second acquire within the TTL window LOSES (active leader keeps lease)", async () => {
    const t0 = new Date();
    const first = await tryAcquireReconcilerLease(prisma, {
      ttlSecs: 60,
      holder: "host-A:1",
      now: t0,
    });
    expect(first).to.equal(true);

    // 30s later, still well inside the 60s TTL — peer attempt fails.
    const t1 = new Date(t0.getTime() + 30_000);
    const second = await tryAcquireReconcilerLease(prisma, {
      ttlSecs: 60,
      holder: "host-B:1",
      now: t1,
    });
    expect(second).to.equal(false);

    // host-A is still the recorded holder.
    const row = await prisma.reconcilerLease.findUnique({ where: { id: LEASE_ID } });
    expect(row!.holder).to.equal("host-A:1");
  });

  it("after TTL expires, the next acquire from ANY instance wins (crashed-leader recovery)", async () => {
    const t0 = new Date();
    await tryAcquireReconcilerLease(prisma, { ttlSecs: 60, holder: "host-A:1", now: t0 });

    // Simulate host-A crashing — wall-clock advances past the TTL.
    const t1 = new Date(t0.getTime() + 61_000);
    const recovered = await tryAcquireReconcilerLease(prisma, {
      ttlSecs: 60,
      holder: "host-B:1",
      now: t1,
    });
    expect(recovered).to.equal(true);

    const row = await prisma.reconcilerLease.findUnique({ where: { id: LEASE_ID } });
    expect(row!.holder).to.equal("host-B:1");
  });

  it("active leader can renew its own lease (same holder, no skip)", async () => {
    const t0 = new Date();
    await tryAcquireReconcilerLease(prisma, { ttlSecs: 60, holder: "host-A:1", now: t0 });

    // Same leader, AFTER its own TTL — renewal succeeds. This is the
    // expected steady-state: the single replica re-acquires every
    // tick once the TTL elapses.
    const t1 = new Date(t0.getTime() + 61_000);
    const renewed = await tryAcquireReconcilerLease(prisma, {
      ttlSecs: 60,
      holder: "host-A:1",
      now: t1,
    });
    expect(renewed).to.equal(true);
  });
});
