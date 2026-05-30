/**
 * Postgres-backed admin shared store (RoundFi internal audit Wave 2) —
 * DB-backed verification of the multi-instance behavior that the
 * in-memory backend cannot provide.
 *
 * REQUIRES a real Postgres (DATABASE_URL) + the admin_shared_store
 * migration applied. Operator-run, like insights.spec.ts — there is no
 * Postgres in the `js` CI lane, so this is NOT wired into that lane.
 * Run locally:
 *
 *   cd services/indexer
 *   ADMIN_SHARED_STORE=postgres pnpm exec mocha -t 60000 \
 *     test/admin_shared_store_pg.spec.ts
 *
 * The store is the SAME module the app uses; we force the postgres
 * backend via env and exercise it against the shared DB. This proves
 * the properties the audit cares about: consume-once is atomic across
 * callers (insert-or-conflict), and the rate limiter's window is durable
 * + shared (survives "instances" = separate calls, no in-process state).
 */

import { expect } from "chai";
import { PrismaClient } from "@prisma/client";

// App store — same code path the Next.js routes use. The postgres
// methods dynamically import `@roundfi/indexer/db`'s getPrisma, which
// resolves to this package's own client against DATABASE_URL.
import { getChallengeStore, getRateLimitStore } from "../../../app/src/lib/admin/sharedStore.js";

const prisma = new PrismaClient();

async function reset(): Promise<void> {
  await prisma.adminChallenge.deleteMany({});
  await prisma.adminRateLimitHit.deleteMany({});
}

describe("postgres ChallengeStore — atomic consume-once", () => {
  before(() => {
    process.env.ADMIN_SHARED_STORE = "postgres";
  });
  beforeEach(reset);
  after(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("first consume true, replay false, and persists a row", async () => {
    const store = getChallengeStore();
    const exp = Date.now() + 60_000;
    expect(await store.consume("pgtok-A", exp)).to.equal(true);
    expect(await store.consume("pgtok-A", exp)).to.equal(false);
    const rows = await prisma.adminChallenge.findMany({ where: { token: "pgtok-A" } });
    expect(rows).to.have.length(1);
  });

  it("concurrent consumes of the same token resolve to exactly one winner", async () => {
    const store = getChallengeStore();
    const exp = Date.now() + 60_000;
    // Fire N concurrent consumes — the unique PK guarantees one true.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.consume("pgtok-race", exp)),
    );
    expect(results.filter((r) => r === true)).to.have.length(1);
    expect(results.filter((r) => r === false)).to.have.length(7);
  });

  it("distinct tokens are independent", async () => {
    const store = getChallengeStore();
    const exp = Date.now() + 60_000;
    expect(await store.consume("pgtok-1", exp)).to.equal(true);
    expect(await store.consume("pgtok-2", exp)).to.equal(true);
  });
});

describe("postgres RateLimitStore — durable sliding window", () => {
  before(() => {
    process.env.ADMIN_SHARED_STORE = "postgres";
  });
  beforeEach(reset);
  after(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it("allows up to max then blocks with retryAfter, shared across calls", async () => {
    const store = getRateLimitStore();
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      const r = await store.check({ key: "pg:rl:k", windowMs: 60_000, max: 3, now: t0 + i });
      expect(r.ok, `req ${i}`).to.equal(true);
    }
    const blocked = await store.check({ key: "pg:rl:k", windowMs: 60_000, max: 3, now: t0 + 10 });
    expect(blocked.ok).to.equal(false);
    expect(blocked.retryAfterMs).to.be.greaterThan(0);
    // The window is materialized as rows, not in-process state.
    const rows = await prisma.adminRateLimitHit.findMany({ where: { bucketKey: "pg:rl:k" } });
    expect(rows).to.have.length(3);
  });

  it("prunes expired rows on the next check (windowed DELETE)", async () => {
    const store = getRateLimitStore();
    const t0 = Date.now();
    await store.check({ key: "pg:rl:exp", windowMs: 1000, max: 5, now: t0 });
    // Far past the window — the DELETE should drop the stale row before
    // counting, leaving room and bounding the table.
    const r = await store.check({ key: "pg:rl:exp", windowMs: 1000, max: 5, now: t0 + 10_000 });
    expect(r.ok).to.equal(true);
    const rows = await prisma.adminRateLimitHit.findMany({ where: { bucketKey: "pg:rl:exp" } });
    expect(rows).to.have.length(1); // only the second, in-window hit
  });

  it("isolates buckets by key", async () => {
    const store = getRateLimitStore();
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      await store.check({ key: "pg:rl:a", windowMs: 60_000, max: 3, now: t0 + i });
    }
    expect(
      (await store.check({ key: "pg:rl:a", windowMs: 60_000, max: 3, now: t0 + 5 })).ok,
    ).to.equal(false);
    expect(
      (await store.check({ key: "pg:rl:b", windowMs: 60_000, max: 3, now: t0 + 5 })).ok,
    ).to.equal(true);
  });
});
