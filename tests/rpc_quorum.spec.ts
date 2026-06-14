/**
 * RPC quorum primitive — pure decision layer (Wave 9.1).
 *
 * Verifies the consensus logic the `backfill-events` ingest path uses
 * when fanning a `getTransaction` across multiple RPC providers. No RPC
 * is touched here — the `decideTxQuorum` function takes a list of
 * `ProviderResult` synthetic values and returns the verdict. That's
 * what makes this safe to run in the `js` CI lane.
 *
 * The threshold is `quorumThreshold(N) = ⌊N/2⌋ + 1` (strict majority)
 * — same convention as `reconciler.ts::checkFinalizedQuorum` and the
 * telemetry in `backfill-events.ts`. With N=1 the threshold is 1, so a
 * single-provider deployment behaves exactly as before. With N=2 the
 * threshold is 2 — 1 lying / divergent / null-returning provider
 * cannot single-handedly fix the verdict (see the docstring on
 * `quorumThreshold` for the attack-vector derivation).
 */

import { expect } from "chai";

import {
  decideTxQuorum,
  parseRpcUrls,
  quorumThreshold,
  type ProviderResult,
  type TxFingerprint,
} from "../services/indexer/src/rpcQuorum.js";

const FP_A: TxFingerprint = { slot: 100, blockTime: 1_700_000_000, logsHash: "aaaa" };
const FP_B: TxFingerprint = { slot: 100, blockTime: 1_700_000_000, logsHash: "bbbb" };
const FP_DIFF_SLOT: TxFingerprint = { slot: 101, blockTime: 1_700_000_000, logsHash: "aaaa" };

describe("decideTxQuorum", () => {
  it("single provider, tx returned → consensus_tx (back-compat path)", () => {
    const v = decideTxQuorum([{ kind: "tx", fingerprint: FP_A }]);
    expect(v.kind).to.equal("consensus_tx");
    if (v.kind === "consensus_tx") expect(v.fingerprint).to.deep.equal(FP_A);
  });

  it("single provider, null → consensus_null", () => {
    expect(decideTxQuorum([{ kind: "null" }]).kind).to.equal("consensus_null");
  });

  it("single provider, error → divergence (all_errors)", () => {
    const v = decideTxQuorum([{ kind: "error" }]);
    expect(v.kind).to.equal("divergence");
    if (v.kind === "divergence") expect(v.reason).to.equal("all_errors");
  });

  it("empty providers list → divergence (no_providers)", () => {
    const v = decideTxQuorum([]);
    expect(v.kind).to.equal("divergence");
    if (v.kind === "divergence") expect(v.reason).to.equal("no_providers");
  });

  it("3 providers, all agree on same tx → consensus_tx", () => {
    const results: ProviderResult[] = [
      { kind: "tx", fingerprint: FP_A },
      { kind: "tx", fingerprint: FP_A },
      { kind: "tx", fingerprint: FP_A },
    ];
    const v = decideTxQuorum(results);
    expect(v.kind).to.equal("consensus_tx");
  });

  it("3 providers, 2 agree on tx + 1 null → consensus_tx (threshold=2 met)", () => {
    const results: ProviderResult[] = [
      { kind: "tx", fingerprint: FP_A },
      { kind: "tx", fingerprint: FP_A },
      { kind: "null" },
    ];
    expect(decideTxQuorum(results).kind).to.equal("consensus_tx");
  });

  it("3 providers, 2 null + 1 tx → consensus_null", () => {
    const results: ProviderResult[] = [
      { kind: "null" },
      { kind: "null" },
      { kind: "tx", fingerprint: FP_A },
    ];
    expect(decideTxQuorum(results).kind).to.equal("consensus_null");
  });

  it("3 providers, 1+1+1 split (tx_A, tx_B, null) → divergence (no_quorum)", () => {
    const results: ProviderResult[] = [
      { kind: "tx", fingerprint: FP_A },
      { kind: "tx", fingerprint: FP_B },
      { kind: "null" },
    ];
    const v = decideTxQuorum(results);
    expect(v.kind).to.equal("divergence");
    if (v.kind === "divergence") expect(v.reason).to.match(/no_quorum/);
  });

  it("3 providers, 2 disagree on slot → divergence (the exact attack vector)", () => {
    // Same logs, same blockTime, but slot differs → fingerprints don't match.
    // A lying RPC reporting the wrong slot would land here.
    const results: ProviderResult[] = [
      { kind: "tx", fingerprint: FP_A },
      { kind: "tx", fingerprint: FP_DIFF_SLOT },
      { kind: "null" },
    ];
    expect(decideTxQuorum(results).kind).to.equal("divergence");
  });

  it("2 providers, both error → divergence (all_errors)", () => {
    const v = decideTxQuorum([{ kind: "error" }, { kind: "error" }]);
    expect(v.kind).to.equal("divergence");
    if (v.kind === "divergence") expect(v.reason).to.equal("all_errors");
  });

  it("2 providers, 1 tx + 1 error → divergence (no_quorum, threshold=2)", () => {
    // quorumThreshold(2) = 2 (strict majority). A single tx vote does
    // NOT clear the threshold; the error contributes nothing. Trade-off:
    // a flaky provider causes the caller to defer + retry on the next
    // run instead of ingesting on a single vote. Worth it — under the
    // old `ceil` rule, a malicious provider returning "error" would let
    // any single (possibly lying) survivor decide the verdict alone.
    const v = decideTxQuorum([{ kind: "tx", fingerprint: FP_A }, { kind: "error" }]);
    expect(v.kind).to.equal("divergence");
    if (v.kind === "divergence") expect(v.reason).to.match(/no_quorum/);
  });

  // ─── Regression: strict-majority attack vectors (#OBS-NOVA-1) ───────
  // Both of these returned consensus under the old `ceil(N/2)` threshold,
  // letting 1 lying provider out of 2 fix the verdict. Lock them down so
  // a future regression to `ceil` trips here loudly.

  it("2 providers, fingerprints diverge → divergence (no tie-break injection)", () => {
    // Old behavior: buckets {A: 1, B: 1}, both ≥ 1, `best` decided by
    // Map insertion order → the first-inserted fingerprint silently won.
    // New behavior: neither bucket reaches threshold 2, no consensus.
    const v = decideTxQuorum([
      { kind: "tx", fingerprint: FP_A },
      { kind: "tx", fingerprint: FP_B },
    ]);
    expect(v.kind).to.equal("divergence");
    if (v.kind === "divergence") expect(v.reason).to.match(/no_quorum/);
  });

  it("2 providers, 1 tx + 1 null → divergence (no null-censorship)", () => {
    // Old behavior: the `nulls ≥ threshold` check fired first with
    // nulls=1 ≥ threshold=1, returning consensus_null and silently
    // dropping a real tx. New behavior: nulls=1 < threshold=2, falls
    // through to the tx bucket which also fails 1 < 2 → no_quorum.
    const v = decideTxQuorum([{ kind: "tx", fingerprint: FP_A }, { kind: "null" }]);
    expect(v.kind).to.equal("divergence");
    if (v.kind === "divergence") expect(v.reason).to.match(/no_quorum/);
  });
});

describe("quorumThreshold", () => {
  it("strict majority for every N (⌊N/2⌋ + 1)", () => {
    expect(quorumThreshold(0)).to.equal(0); // edge case — callers early-return on empty
    expect(quorumThreshold(1)).to.equal(1); // back-compat: single-RPC unchanged
    expect(quorumThreshold(2)).to.equal(2); // strict majority for N=2 — both must agree
    expect(quorumThreshold(3)).to.equal(2); // same as ceil for odd N
    expect(quorumThreshold(4)).to.equal(3); // 3/4 — 1 dishonest provider can't win
    expect(quorumThreshold(5)).to.equal(3);
    expect(quorumThreshold(6)).to.equal(4);
    expect(quorumThreshold(7)).to.equal(4);
  });
});

describe("parseRpcUrls", () => {
  it("uses the plural CSV when set", () => {
    expect(
      parseRpcUrls({ rpcUrls: "https://a,https://b,https://c", fallback: "https://fb" }),
    ).to.deep.equal(["https://a", "https://b", "https://c"]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(
      parseRpcUrls({ rpcUrls: " https://a , , https://b ", fallback: "https://fb" }),
    ).to.deep.equal(["https://a", "https://b"]);
  });

  it("falls back to the legacy single env when plural is unset", () => {
    expect(parseRpcUrls({ rpcUrl: "https://legacy", fallback: "https://fb" })).to.deep.equal([
      "https://legacy",
    ]);
  });

  it("returns the fallback when nothing is set", () => {
    expect(parseRpcUrls({ fallback: "https://api.devnet.solana.com" })).to.deep.equal([
      "https://api.devnet.solana.com",
    ]);
  });

  it("plural with only whitespace falls through to legacy single", () => {
    expect(
      parseRpcUrls({ rpcUrls: " , , ", rpcUrl: "https://legacy", fallback: "https://fb" }),
    ).to.deep.equal(["https://legacy"]);
  });
});
