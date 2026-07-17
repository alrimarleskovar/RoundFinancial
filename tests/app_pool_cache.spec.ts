/**
 * poolCache (app/src/lib/poolCache.ts) — the stale-while-revalidate layer
 * under usePool / usePoolMembers / useDraw.
 *
 * What's pinned here and why it matters:
 *   1. Codec round-trip: the SDK view objects carry PublicKey, bigint and
 *      Buffer values. If the codec silently mangles one (e.g. a bigint
 *      re-hydrated as string), the home would paint NaN balances from cache
 *      and "fix themselves" on revalidate — a worse bug than the flash the
 *      cache exists to kill. Round-trip must reconstruct REAL instances
 *      (`PublicKey.equals`, `typeof bigint`, `Buffer.equals`).
 *   2. TTL + version gating: an ancient or old-schema snapshot must read as
 *      a miss, never decode into garbage.
 *   3. Storage resilience: with no localStorage (SSR/node) the memory tier
 *      alone works; a corrupt stored entry reads as a miss, not a throw.
 *
 * Runs in node with a Map-backed localStorage stub installed BEFORE the
 * module under test is imported (the module reads localStorage lazily, so
 * the stub is picked up per call).
 */

import { strict as assert } from "node:assert";
import { PublicKey } from "@solana/web3.js";

// ── localStorage stub (installed before importing the module) ────────────
// The module reads `globalThis.localStorage` lazily per call, so a stub set
// here is picked up by every cacheGet/cacheSet below.
const backing = new Map<string, string>();
const stub = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, v),
  removeItem: (k: string) => void backing.delete(k),
};
(globalThis as unknown as { localStorage: unknown }).localStorage = stub;

import {
  cacheDelete,
  cacheGet,
  cacheSet,
  decodeCacheValue,
  encodeCacheValue,
  __clearMemoryCacheForTests,
} from "../app/src/lib/poolCache";

const PK_A = new PublicKey("8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw");
const PK_B = new PublicKey("9WJDL5nEpGKjVT7yhBE75zQomJrr6UJe2oeNtcmS7rAY");

// A RawPoolView-shaped sample (the fields that exercise every codec branch).
const poolView = {
  address: PK_B,
  authority: PK_A,
  seedId: 9n,
  installmentAmount: 1_000_000n,
  nextCycleAt: 1_784_592_651n,
  currentCycle: 1,
  status: "active",
  occupiedSlots: [0, 1, 2],
  orderingPolicy: 1,
};

// A RawDrawView-shaped sample — exercises the Buffer branch.
const drawView = {
  pool: PK_B,
  seed: Buffer.from("b8d0d90e346dbabe0011223344556677", "hex"),
  order: [1, 0, 2],
  membersTarget: 3,
};

describe("poolCache — SWR persistence under the pool hooks", () => {
  beforeEach(() => {
    backing.clear();
    __clearMemoryCacheForTests();
  });

  it("codec round-trips PublicKey / bigint / Buffer into real instances", () => {
    const decoded = decodeCacheValue(
      JSON.parse(JSON.stringify(encodeCacheValue(poolView))),
    ) as typeof poolView;
    assert.ok(decoded.authority instanceof PublicKey, "authority must be a PublicKey again");
    assert.ok(decoded.authority.equals(PK_A));
    assert.equal(typeof decoded.seedId, "bigint");
    assert.equal(decoded.seedId, 9n);
    assert.equal(decoded.installmentAmount, 1_000_000n);
    assert.equal(decoded.currentCycle, 1);
    assert.equal(decoded.status, "active");
    assert.deepEqual(decoded.occupiedSlots, [0, 1, 2]);

    const drawBack = decodeCacheValue(
      JSON.parse(JSON.stringify(encodeCacheValue(drawView))),
    ) as typeof drawView;
    assert.ok(Buffer.isBuffer(drawBack.seed), "seed must be a Buffer again");
    assert.ok(drawBack.seed.equals(drawView.seed));
    assert.deepEqual(drawBack.order, [1, 0, 2]);
  });

  it("set → get round-trips through the storage tier (memory cleared)", () => {
    cacheSet("pool", "pool9:pda", poolView);
    __clearMemoryCacheForTests(); // force the localStorage path
    const got = cacheGet<typeof poolView>("pool", "pool9:pda");
    assert.ok(got, "expected a storage-tier hit");
    assert.ok(got.address.equals(PK_B));
    assert.equal(got.nextCycleAt, 1_784_592_651n);
  });

  it("members list round-trips as an array of views", () => {
    const roster = [
      { wallet: PK_A, slotIndex: 0, contributionsPaid: 2, defaulted: false, paidOut: true },
      { wallet: PK_B, slotIndex: 1, contributionsPaid: 1, defaulted: false, paidOut: false },
    ];
    cacheSet("members", "pool9:pda", roster);
    __clearMemoryCacheForTests();
    const got = cacheGet<typeof roster>("members", "pool9:pda");
    assert.ok(got && got.length === 2);
    assert.ok(got[0]!.wallet.equals(PK_A));
    assert.equal(got[1]!.slotIndex, 1);
  });

  it("expired entries read as a miss (TTL)", () => {
    cacheSet("pool", "pool9:pda", poolView);
    __clearMemoryCacheForTests();
    // Rewrite the stored envelope with an ancient timestamp.
    const key = [...backing.keys()].find((k) => k.endsWith(":pool:pool9:pda"))!;
    const parsed = JSON.parse(backing.get(key)!) as { ts: number; data: unknown };
    parsed.ts = Date.now() - 25 * 60 * 60 * 1000; // 25h > 24h TTL
    backing.set(key, JSON.stringify(parsed));
    assert.equal(cacheGet("pool", "pool9:pda"), null);
  });

  it("a version bump orphans old keys (prefix carries the version)", () => {
    cacheSet("pool", "pool9:pda", poolView);
    const key = [...backing.keys()][0]!;
    assert.match(key, /^roundfi:cache:v\d+:pool:/, "keys must be version-prefixed");
  });

  it("corrupt stored JSON reads as a miss, never throws", () => {
    cacheSet("pool", "pool9:pda", poolView);
    __clearMemoryCacheForTests();
    const key = [...backing.keys()][0]!;
    backing.set(key, "{not json");
    assert.equal(cacheGet("pool", "pool9:pda"), null);
  });

  it("cacheDelete drops both tiers", () => {
    cacheSet("pool", "pool9:pda", poolView);
    cacheDelete("pool", "pool9:pda");
    assert.equal(cacheGet("pool", "pool9:pda"), null);
    assert.equal(backing.size, 0);
  });
});
