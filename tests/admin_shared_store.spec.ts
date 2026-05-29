/**
 * Admin shared store — in-memory backend behavior + env selector
 * (RoundFi internal audit Wave 2).
 *
 * Covers the prisma-FREE surface so it runs in the `js` CI lane:
 *   - the in-memory ChallengeStore enforces consume-once (the single-use
 *     guarantee that used to live in challenge.ts),
 *   - the in-memory RateLimitStore applies the sliding window through the
 *     async interface,
 *   - the env selector returns the right backend and defaults to memory.
 *
 * The POSTGRES backend's exact SQL behavior (insert-or-conflict replay
 * detection, windowed DELETE, transaction) is DB-backed and verified in
 * services/indexer/test/admin_shared_store_pg.spec.ts against a real
 * Postgres (operator-run, like insights.spec.ts) — no DB in this lane.
 */

import { expect } from "chai";

import {
  __resetInMemoryStoresForTest,
  getChallengeStore,
  getRateLimitStore,
  sharedStoreBackend,
} from "../app/src/lib/admin/sharedStore.js";

function withEnv(value: string | undefined, fn: () => void): void {
  const prior = process.env.ADMIN_SHARED_STORE;
  if (value === undefined) delete process.env.ADMIN_SHARED_STORE;
  else process.env.ADMIN_SHARED_STORE = value;
  try {
    fn();
  } finally {
    if (prior === undefined) delete process.env.ADMIN_SHARED_STORE;
    else process.env.ADMIN_SHARED_STORE = prior;
  }
}

describe("sharedStoreBackend — env selector", () => {
  it("defaults to memory when ADMIN_SHARED_STORE is unset", () => {
    withEnv(undefined, () => expect(sharedStoreBackend()).to.equal("memory"));
  });

  it("returns memory for any non-postgres value", () => {
    withEnv("redis", () => expect(sharedStoreBackend()).to.equal("memory"));
  });

  it("returns postgres only for the exact 'postgres' value", () => {
    withEnv("postgres", () => expect(sharedStoreBackend()).to.equal("postgres"));
  });
});

describe("in-memory ChallengeStore — consume-once", () => {
  beforeEach(() => __resetInMemoryStoresForTest());

  it("first consume returns true, replay returns false", async () => {
    const store = getChallengeStore(); // memory by default
    const exp = Date.now() + 60_000;
    expect(await store.consume("tok-A", exp)).to.equal(true);
    expect(await store.consume("tok-A", exp)).to.equal(false); // replay
  });

  it("distinct tokens are independent", async () => {
    const store = getChallengeStore();
    const exp = Date.now() + 60_000;
    expect(await store.consume("tok-A", exp)).to.equal(true);
    expect(await store.consume("tok-B", exp)).to.equal(true);
    expect(await store.consume("tok-A", exp)).to.equal(false);
    expect(await store.consume("tok-B", exp)).to.equal(false);
  });

  it("reset clears consumed tokens (so a token is reusable after reset)", async () => {
    const store = getChallengeStore();
    const exp = Date.now() + 60_000;
    expect(await store.consume("tok-A", exp)).to.equal(true);
    __resetInMemoryStoresForTest();
    expect(await store.consume("tok-A", exp)).to.equal(true);
  });
});

describe("in-memory RateLimitStore — sliding window via async interface", () => {
  beforeEach(() => __resetInMemoryStoresForTest());

  it("allows up to max then blocks with retryAfter", async () => {
    const store = getRateLimitStore();
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) {
      const r = await store.check({ key: "k", windowMs: 60_000, max: 3, now: t0 + i });
      expect(r.ok, `req ${i}`).to.equal(true);
    }
    const blocked = await store.check({ key: "k", windowMs: 60_000, max: 3, now: t0 + 10 });
    expect(blocked.ok).to.equal(false);
    expect(blocked.retryAfterMs).to.be.greaterThan(0);
  });

  it("isolates buckets by key", async () => {
    const store = getRateLimitStore();
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++)
      await store.check({ key: "a", windowMs: 60_000, max: 3, now: t0 + i });
    expect((await store.check({ key: "a", windowMs: 60_000, max: 3, now: t0 + 5 })).ok).to.equal(
      false,
    );
    expect((await store.check({ key: "b", windowMs: 60_000, max: 3, now: t0 + 5 })).ok).to.equal(
      true,
    );
  });

  it("recovers after the window expires", async () => {
    const store = getRateLimitStore();
    const t0 = 2_000_000;
    await store.check({ key: "k", windowMs: 1000, max: 1, now: t0 });
    expect((await store.check({ key: "k", windowMs: 1000, max: 1, now: t0 + 500 })).ok).to.equal(
      false,
    );
    expect((await store.check({ key: "k", windowMs: 1000, max: 1, now: t0 + 1001 })).ok).to.equal(
      true,
    );
  });
});
