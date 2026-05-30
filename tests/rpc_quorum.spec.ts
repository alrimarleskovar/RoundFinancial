/**
 * RPC quorum primitive — pure decision layer (Wave 9.1).
 *
 * Verifies the consensus logic the `backfill-events` ingest path uses
 * when fanning a `getTransaction` across multiple RPC providers. No RPC
 * is touched here — the `decideTxQuorum` function takes a list of
 * `ProviderResult` synthetic values and returns the verdict. That's
 * what makes this safe to run in the `js` CI lane.
 *
 * The threshold is `ceil(N / 2)` — same convention as
 * `reconciler.ts::checkFinalizedQuorum`. With N=1 the threshold is 1,
 * so a single-provider deployment behaves exactly as before.
 */

import { expect } from "chai";

import {
  decideTxQuorum,
  parseRpcUrls,
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

  it("2 providers, 1 tx + 1 error → consensus_tx (threshold=1 met among non-errors)", () => {
    // ceil(2/2) = 1. The single tx vote clears threshold; the error
    // doesn't count for or against. This is intentional: errors are
    // "no signal", and we'd rather ingest on a thin majority than
    // skip when the only divergence is a flaky provider.
    const v = decideTxQuorum([{ kind: "tx", fingerprint: FP_A }, { kind: "error" }]);
    expect(v.kind).to.equal("consensus_tx");
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
