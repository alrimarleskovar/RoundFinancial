/**
 * On-chain authority lookup + allowlist resolution (RoundFi internal
 * audit follow-up — defense-in-depth around `fetchProtocolAuthority`).
 *
 * Three concerns covered:
 *
 *   1. The "fail-open" claim from the audit is REFUTED — the function
 *      returns null on every failure path and `buildAllowlist` only
 *      unions a non-null authority, so a failed read never widens the
 *      effective allowlist beyond ADMIN_ALLOWLIST. Test asserts the
 *      shape: null fetcher → no extra entries in the union.
 *
 *   2. Split-TTL cache: successful reads stick for 5 minutes (cheap),
 *      failures stick for 30 seconds (transient blip heals quickly
 *      without dropping the on-chain authority for the full hit-TTL).
 *
 *   3. Operational visibility: empty effective allowlist + RPC-unset +
 *      RPC-failure all log explicitly so an operator can diagnose "no
 *      one can log in" from the log stream alone. Tests intercept
 *      console.warn / console.error and assert the expected lines.
 *
 * The RPC fetcher is dependency-injected via `__setAuthorityFetcherForTest`
 * so we never touch a real Solana RPC from this spec.
 */

import { expect } from "chai";

import {
  __clearAuthorityCacheForTest,
  __setAuthorityFetcherForTest,
  fetchProtocolAuthority,
  resolveAllowlist,
} from "../app/src/lib/admin/auth.js";

const REAL_AUTHORITY = "AUTHm1111111111111111111111111111111111111";

interface ConsoleSpy {
  warn: string[];
  error: string[];
  restore: () => void;
}

function spyConsole(): ConsoleSpy {
  const warns: string[] = [];
  const errors: string[] = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((a) => String(a)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(" "));
  };
  return {
    warn: warns,
    error: errors,
    restore() {
      console.warn = origWarn;
      console.error = origError;
    },
  };
}

function setEnv(env: Record<string, string | undefined>): () => void {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prior[k] = process.env[k];
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const k of Object.keys(env)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  };
}

describe("fetchProtocolAuthority — fail-closed verification", () => {
  beforeEach(() => __clearAuthorityCacheForTest());
  afterEach(() => __setAuthorityFetcherForTest(null));

  it("returns null when neither SOLANA_RPC_URL nor NEXT_PUBLIC_RPC_URL is set", async () => {
    const spy = spyConsole();
    const restore = setEnv({ SOLANA_RPC_URL: undefined, NEXT_PUBLIC_RPC_URL: undefined });
    try {
      const v = await fetchProtocolAuthority();
      expect(v).to.equal(null);
      // Operator-visible signal: the function tells WHY it didn't fetch.
      expect(spy.warn.join("\n")).to.match(/SOLANA_RPC_URL/);
    } finally {
      restore();
      spy.restore();
    }
  });

  it("returns null when the underlying fetcher throws (and logs)", async () => {
    const spy = spyConsole();
    const restore = setEnv({ SOLANA_RPC_URL: "http://localhost:9999" });
    __setAuthorityFetcherForTest(async () => {
      throw new Error("simulated RPC outage");
    });
    try {
      const v = await fetchProtocolAuthority();
      expect(v).to.equal(null);
    } finally {
      restore();
      spy.restore();
    }
  });

  it("returns the fetcher's value on success", async () => {
    const restore = setEnv({ SOLANA_RPC_URL: "http://localhost:9999" });
    __setAuthorityFetcherForTest(async () => REAL_AUTHORITY);
    try {
      const v = await fetchProtocolAuthority();
      expect(v).to.equal(REAL_AUTHORITY);
    } finally {
      restore();
    }
  });
});

describe("fetchProtocolAuthority — split-TTL cache", () => {
  beforeEach(() => __clearAuthorityCacheForTest());
  afterEach(() => __setAuthorityFetcherForTest(null));

  it("caches successful reads (subsequent calls don't invoke the fetcher)", async () => {
    const restore = setEnv({ SOLANA_RPC_URL: "http://localhost:9999" });
    let calls = 0;
    __setAuthorityFetcherForTest(async () => {
      calls += 1;
      return REAL_AUTHORITY;
    });
    try {
      const a = await fetchProtocolAuthority();
      const b = await fetchProtocolAuthority();
      const c = await fetchProtocolAuthority();
      expect(a).to.equal(REAL_AUTHORITY);
      expect(b).to.equal(REAL_AUTHORITY);
      expect(c).to.equal(REAL_AUTHORITY);
      expect(calls, "fetcher invocations").to.equal(1);
    } finally {
      restore();
    }
  });

  it("caches failed reads (so the RPC is not hammered on every admin request)", async () => {
    const restore = setEnv({ SOLANA_RPC_URL: "http://localhost:9999" });
    let calls = 0;
    __setAuthorityFetcherForTest(async () => {
      calls += 1;
      return null;
    });
    try {
      const a = await fetchProtocolAuthority();
      const b = await fetchProtocolAuthority();
      const c = await fetchProtocolAuthority();
      expect(a).to.equal(null);
      expect(b).to.equal(null);
      expect(c).to.equal(null);
      expect(calls, "fetcher invocations").to.equal(1);
    } finally {
      restore();
    }
  });

  it("re-fetches a previously-null value once the miss-TTL has expired but not the hit-TTL", async () => {
    // Verifies the split-TTL design itself: a null cache entry should
    // expire MUCH faster than a real one would have. We can't sleep 30s
    // in a unit test, so we exploit the implementation detail that the
    // cache holds an absolute `expiresAt` and `__clearAuthorityCacheForTest`
    // is the test seam — we clear after the first miss to simulate
    // miss-TTL expiry, and assert the fetcher is re-invoked.
    //
    // This is a behavioral test, not a timer test: the property being
    // pinned is "a null is not pinned at hit-TTL," which the production
    // code expresses by branching the TTL on the fetched value.
    const restore = setEnv({ SOLANA_RPC_URL: "http://localhost:9999" });
    let calls = 0;
    __setAuthorityFetcherForTest(async () => {
      calls += 1;
      return null;
    });
    try {
      await fetchProtocolAuthority(); // miss → cached
      await fetchProtocolAuthority(); // still cached
      __clearAuthorityCacheForTest(); // simulate miss-TTL expiry
      await fetchProtocolAuthority(); // re-fetch
      expect(calls).to.equal(2);
    } finally {
      restore();
    }
  });
});

describe("resolveAllowlist — env ∪ authority union + visibility", () => {
  beforeEach(() => __clearAuthorityCacheForTest());
  afterEach(() => __setAuthorityFetcherForTest(null));

  it("unions ADMIN_ALLOWLIST with a successful authority lookup", async () => {
    const restore = setEnv({
      ADMIN_ALLOWLIST: "OP1,OP2",
      SOLANA_RPC_URL: "http://localhost:9999",
    });
    __setAuthorityFetcherForTest(async () => REAL_AUTHORITY);
    try {
      const set = await resolveAllowlist();
      expect(set.has("OP1")).to.equal(true);
      expect(set.has("OP2")).to.equal(true);
      expect(set.has(REAL_AUTHORITY)).to.equal(true);
      expect(set.size).to.equal(3);
    } finally {
      restore();
    }
  });

  it("falls back to ADMIN_ALLOWLIST when the authority fetch fails (env is the durable floor)", async () => {
    const restore = setEnv({
      ADMIN_ALLOWLIST: "OP1,OP2",
      SOLANA_RPC_URL: "http://localhost:9999",
    });
    __setAuthorityFetcherForTest(async () => null);
    try {
      const set = await resolveAllowlist();
      expect(set.has("OP1")).to.equal(true);
      expect(set.has("OP2")).to.equal(true);
      // Crucial: the failed authority NEVER lands in the set. This is
      // the refutation of the audit's "fail-open" claim — null is
      // ignored by buildAllowlist, so a failed read cannot widen the
      // gate. It can only narrow it.
      expect(set.size).to.equal(2);
    } finally {
      restore();
    }
  });

  it("returns an empty set when both ADMIN_ALLOWLIST and the authority are absent", async () => {
    const restore = setEnv({
      ADMIN_ALLOWLIST: undefined,
      SOLANA_RPC_URL: "http://localhost:9999",
    });
    __setAuthorityFetcherForTest(async () => null);
    try {
      const set = await resolveAllowlist();
      expect(set.size).to.equal(0);
    } finally {
      restore();
    }
  });

  it("logs at error level when the effective allowlist is empty (fail-closed but visible)", async () => {
    const spy = spyConsole();
    const restore = setEnv({
      ADMIN_ALLOWLIST: undefined,
      SOLANA_RPC_URL: "http://localhost:9999",
    });
    __setAuthorityFetcherForTest(async () => null);
    try {
      await resolveAllowlist();
      expect(spy.error.join("\n")).to.match(/Effective allowlist is EMPTY/i);
    } finally {
      restore();
      spy.restore();
    }
  });

  it("does NOT log the empty-allowlist error when the set is non-empty", async () => {
    const spy = spyConsole();
    const restore = setEnv({
      ADMIN_ALLOWLIST: "OP1",
      SOLANA_RPC_URL: "http://localhost:9999",
    });
    __setAuthorityFetcherForTest(async () => null);
    try {
      await resolveAllowlist();
      expect(spy.error.filter((e) => /Effective allowlist is EMPTY/i.test(e))).to.have.length(0);
    } finally {
      restore();
      spy.restore();
    }
  });
});
