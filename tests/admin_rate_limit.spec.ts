/**
 * Rate-limit gate on /api/admin/auth/{nonce,verify} (RoundFi internal
 * audit follow-up).
 *
 * Three concerns covered:
 *
 *   1. Sliding-window correctness (pure-fn): under limit / at limit /
 *      window expiry / parallel keys / retry-after computation.
 *   2. Client-key extraction: X-Forwarded-First-hop > X-Real-IP >
 *      "unknown". Defense against the "use last hop" footgun.
 *   3. End-to-end on the actual route handlers: 429 with Retry-After
 *      after exhausting the limit, isolated per IP. Uses the standard
 *      `Request` constructor so no Next.js server is bound.
 *
 * Tests inject ADMIN_RL_NONCE_PER_MIN=3 / ADMIN_RL_VERIFY_PER_MIN=2 so
 * they exhaust the window quickly without sleeping. Defaults in
 * production (10 / 5) are not under test here — they're constants.
 */

import { expect } from "chai";

import {
  slidingWindowDecision,
  clientKeyFromRequest,
  observeClientKey,
  __resetClientKeyHealthForTest,
} from "../app/src/lib/admin/rateLimit.js";
import { __resetInMemoryStoresForTest } from "../app/src/lib/admin/sharedStore.js";

describe("rate limit — sliding-window decision (pure fn)", () => {
  // The pure decision threads state explicitly: each call returns
  // `nextTimestamps`, which the caller persists and passes to the next
  // call. This mirrors exactly what the store does.

  it("allows up to `max` requests in the window", () => {
    const t0 = 1_000_000;
    let ts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = slidingWindowDecision(ts, 60_000, 5, t0 + i);
      expect(r.ok, `req ${i}`).to.equal(true);
      expect(r.remaining).to.equal(4 - i);
      ts = r.nextTimestamps;
    }
  });

  it("rejects the (max+1)-th request and reports retryAfterMs", () => {
    const t0 = 1_000_000;
    let ts: number[] = [];
    for (let i = 0; i < 5; i++) {
      ts = slidingWindowDecision(ts, 60_000, 5, t0 + i).nextTimestamps;
    }
    const r = slidingWindowDecision(ts, 60_000, 5, t0 + 10);
    expect(r.ok).to.equal(false);
    // Oldest entry was at t0 + 0; window expires at t0 + 60_000; we're
    // querying at t0 + 10 → retryAfterMs = 60_000 - 10 = 59_990.
    expect(r.retryAfterMs).to.equal(59_990);
    expect(r.remaining).to.equal(0);
  });

  it("allows again once the oldest entry falls out of the window", () => {
    const t0 = 1_000_000;
    let ts = slidingWindowDecision([], 1000, 1, t0).nextTimestamps;
    const blocked = slidingWindowDecision(ts, 1000, 1, t0 + 500);
    expect(blocked.ok).to.equal(false);
    ts = blocked.nextTimestamps;
    const allowed = slidingWindowDecision(ts, 1000, 1, t0 + 1001);
    expect(allowed.ok).to.equal(true);
  });

  it("isolates state by caller (the store keys; the fn is stateless)", () => {
    const t0 = 1_000_000;
    let a: number[] = [];
    for (let i = 0; i < 3; i++) a = slidingWindowDecision(a, 60_000, 3, t0 + i).nextTimestamps;
    expect(slidingWindowDecision(a, 60_000, 3, t0 + 10).ok).to.equal(false);
    // A fresh (different-key) timestamp list is unaffected.
    expect(slidingWindowDecision([], 60_000, 3, t0 + 10).ok).to.equal(true);
  });

  it("does not grow unboundedly across windows (expired entries are dropped)", () => {
    const t0 = 1_000_000;
    let ts: number[] = [];
    for (let i = 0; i < 5; i++) ts = slidingWindowDecision(ts, 1000, 5, t0 + i).nextTimestamps;
    // Window fully expired — five fresh accepts.
    for (let i = 0; i < 5; i++) {
      const r = slidingWindowDecision(ts, 1000, 5, t0 + 2000 + i);
      expect(r.ok, `second burn req ${i}`).to.equal(true);
      ts = r.nextTimestamps;
    }
    // The persisted log holds only the SECOND window's entries, so a
    // 6th inside it is blocked — proves the trim dropped the stale ones.
    expect(ts.length).to.equal(5);
    expect(slidingWindowDecision(ts, 1000, 5, t0 + 2010).ok).to.equal(false);
  });
});

describe("clientKeyFromRequest", () => {
  it("returns the first hop of X-Forwarded-For", () => {
    const req = new Request("https://x/", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" },
    });
    expect(clientKeyFromRequest(req)).to.equal("1.2.3.4");
  });

  it("falls back to X-Real-IP when X-Forwarded-For is absent", () => {
    const req = new Request("https://x/", { headers: { "x-real-ip": "5.6.7.8" } });
    expect(clientKeyFromRequest(req)).to.equal("5.6.7.8");
  });

  it("returns 'unknown' when neither header is set", () => {
    const req = new Request("https://x/");
    expect(clientKeyFromRequest(req)).to.equal("unknown");
  });

  it("returns 'unknown' on empty/whitespace-only headers", () => {
    const req = new Request("https://x/", {
      headers: { "x-forwarded-for": "  ", "x-real-ip": "  " },
    });
    expect(clientKeyFromRequest(req)).to.equal("unknown");
  });

  it("trims whitespace around the first hop", () => {
    const req = new Request("https://x/", {
      headers: { "x-forwarded-for": "   9.9.9.9   , 10.0.0.1" },
    });
    expect(clientKeyFromRequest(req)).to.equal("9.9.9.9");
  });
});

describe("observeClientKey — unknown-bucket-collapse warning (INFO-1)", () => {
  // Capture what observeClientKey would log without touching console.
  let warns: Array<{ msg: string; ctx: Record<string, unknown> }>;
  const capture = (msg: string, ctx: Record<string, unknown>): void => {
    warns.push({ msg, ctx });
  };

  beforeEach(() => {
    __resetClientKeyHealthForTest();
    warns = [];
  });

  it("does NOT warn outside production-like env (local dev legitimately has no XFF)", () => {
    // 100 unknown samples but env is development — should be silent.
    for (let i = 0; i < 100; i++) {
      observeClientKey("unknown", { env: "development", now: 1_000 + i, logger: capture });
    }
    expect(warns).to.have.length(0);
  });

  it("does NOT warn before the sample floor, even at 100% unknown", () => {
    // Below MIN_SAMPLES_BEFORE_WARN (50) — premature; signal not meaningful yet.
    for (let i = 0; i < 49; i++) {
      observeClientKey("unknown", { env: "production", now: 1_000 + i, logger: capture });
    }
    expect(warns).to.have.length(0);
  });

  it("does NOT warn when the unknown ratio is below the threshold", () => {
    // 50 samples, 24 unknown (48%) — below the 50% threshold.
    for (let i = 0; i < 26; i++) {
      observeClientKey("1.2.3.4", { env: "production", now: 1_000 + i, logger: capture });
    }
    for (let i = 0; i < 24; i++) {
      observeClientKey("unknown", { env: "production", now: 2_000 + i, logger: capture });
    }
    expect(warns).to.have.length(0);
  });

  it("warns ONCE when prod-like + >= 50 samples + >= 50% unknown", () => {
    // 25 keyed + 25 unknown = 50% on the 50th sample — meets the floor + threshold.
    for (let i = 0; i < 25; i++) {
      observeClientKey("1.2.3.4", { env: "production", now: 1_000 + i, logger: capture });
    }
    for (let i = 0; i < 25; i++) {
      observeClientKey("unknown", { env: "production", now: 2_000 + i, logger: capture });
    }
    expect(warns).to.have.length(1);
    expect(warns[0]!.msg).to.match(/bucket collapsed to 'unknown'/);
    expect(warns[0]!.ctx.totalSamples).to.equal(50);
    expect(warns[0]!.ctx.unknownSamples).to.equal(25);
    expect(warns[0]!.ctx.ratio).to.equal(0.5);
  });

  it("respects the cooldown (does not re-warn within 5 minutes)", () => {
    // First warn at t=2024.
    for (let i = 0; i < 25; i++) {
      observeClientKey("1.2.3.4", { env: "production", now: 1_000 + i, logger: capture });
    }
    for (let i = 0; i < 25; i++) {
      observeClientKey("unknown", { env: "production", now: 2_000 + i, logger: capture });
    }
    expect(warns).to.have.length(1);
    // 100 more unknowns within the cooldown window — must NOT re-warn.
    for (let i = 0; i < 100; i++) {
      observeClientKey("unknown", { env: "production", now: 3_000 + i, logger: capture });
    }
    expect(warns).to.have.length(1);
  });

  it("re-warns after the cooldown expires", () => {
    for (let i = 0; i < 25; i++) {
      observeClientKey("1.2.3.4", { env: "production", now: 1_000 + i, logger: capture });
    }
    for (let i = 0; i < 25; i++) {
      observeClientKey("unknown", { env: "production", now: 2_000 + i, logger: capture });
    }
    expect(warns).to.have.length(1);
    const afterCooldown = 2_024 + 5 * 60_000 + 1;
    observeClientKey("unknown", { env: "production", now: afterCooldown, logger: capture });
    expect(warns).to.have.length(2);
  });
});

describe("admin auth routes — HTTP rate limit", () => {
  // `require`-ing the route module under test env so the constants
  // (NONCE_RL_MAX / VERIFY_RL_MAX) bind to the override values we set
  // BEFORE the import. The handlers read env at MODULE-EVAL time, so
  // the order matters — `delete require.cache` lets us re-import with
  // different env between describe blocks if we ever need to.
  let nonceRoute: typeof import("../app/src/app/api/admin/auth/nonce/route.js");
  let verifyRoute: typeof import("../app/src/app/api/admin/auth/verify/route.js");

  before(async () => {
    process.env.ADMIN_RL_NONCE_PER_MIN = "3";
    process.env.ADMIN_RL_VERIFY_PER_MIN = "2";
    // Required for the nonce handler's getSessionSecret() call to
    // succeed past the rate-limit gate (so we can observe 400 vs 429).
    process.env.ADMIN_SESSION_SECRET = "x".repeat(32);
    process.env.ADMIN_DOMAIN = "localhost";
    nonceRoute = await import("../app/src/app/api/admin/auth/nonce/route.js");
    verifyRoute = await import("../app/src/app/api/admin/auth/verify/route.js");
  });

  beforeEach(() => __resetInMemoryStoresForTest());

  function makeReq(url: string, body: unknown, ip: string): Request {
    return new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    });
  }

  it("nonce: allows 3, blocks the 4th with 429 + Retry-After", async () => {
    const ip = "1.1.1.1";
    for (let i = 0; i < 3; i++) {
      const res = await nonceRoute.POST(
        makeReq(
          "https://x/api/admin/auth/nonce",
          { pubkey: "11111111111111111111111111111111" },
          ip,
        ),
      );
      // 200 (challenge issued) — we passed the rate limit AND a valid
      // pubkey. Any non-429 means we passed the gate, which is the
      // assertion that matters here.
      expect(res.status, `req ${i}`).to.not.equal(429);
    }
    const blocked = await nonceRoute.POST(
      makeReq("https://x/api/admin/auth/nonce", { pubkey: "11111111111111111111111111111111" }, ip),
    );
    expect(blocked.status).to.equal(429);
    const retry = blocked.headers.get("retry-after");
    expect(retry, "Retry-After header").to.be.a("string");
    expect(Number(retry)).to.be.greaterThan(0);
    const body = (await blocked.json()) as { error: string };
    expect(body.error).to.equal("rate_limited");
  });

  it("nonce: limits are per-IP", async () => {
    for (let i = 0; i < 3; i++) {
      await nonceRoute.POST(
        makeReq(
          "https://x/api/admin/auth/nonce",
          { pubkey: "11111111111111111111111111111111" },
          "2.2.2.2",
        ),
      );
    }
    // Same window, different IP — should pass the gate.
    const other = await nonceRoute.POST(
      makeReq(
        "https://x/api/admin/auth/nonce",
        { pubkey: "11111111111111111111111111111111" },
        "3.3.3.3",
      ),
    );
    expect(other.status).to.not.equal(429);
  });

  it("verify: allows 2, blocks the 3rd with 429", async () => {
    const ip = "4.4.4.4";
    for (let i = 0; i < 2; i++) {
      const res = await verifyRoute.POST(
        // Garbage body → 400 from the schema check; that's fine, the
        // rate limit gate runs FIRST so anything ≠ 429 means we passed.
        makeReq("https://x/api/admin/auth/verify", {}, ip),
      );
      expect(res.status, `req ${i}`).to.not.equal(429);
    }
    const blocked = await verifyRoute.POST(makeReq("https://x/api/admin/auth/verify", {}, ip));
    expect(blocked.status).to.equal(429);
  });

  it("verify: limits are per-IP", async () => {
    for (let i = 0; i < 2; i++) {
      await verifyRoute.POST(makeReq("https://x/api/admin/auth/verify", {}, "5.5.5.5"));
    }
    const other = await verifyRoute.POST(makeReq("https://x/api/admin/auth/verify", {}, "6.6.6.6"));
    expect(other.status).to.not.equal(429);
  });

  it("nonce and verify share no buckets — they have independent budgets per IP", async () => {
    const ip = "7.7.7.7";
    // Burn the nonce budget for this IP.
    for (let i = 0; i < 3; i++) {
      await nonceRoute.POST(
        makeReq(
          "https://x/api/admin/auth/nonce",
          { pubkey: "11111111111111111111111111111111" },
          ip,
        ),
      );
    }
    // Verify on the SAME IP must still have its independent budget.
    const verifyOk = await verifyRoute.POST(makeReq("https://x/api/admin/auth/verify", {}, ip));
    expect(verifyOk.status).to.not.equal(429);
  });
});
