/**
 * Frontend allowlist + cluster classification tests (SEV-045).
 *
 * Pinning tests for the three pure-function defenses that gate the
 * front-end's mainnet exposure:
 *
 *   1. `classifyEndpoint()` — source-of-truth for "what cluster is
 *      this URL pointing at." Used by `NetworkBanner` to decide
 *      whether to fire the LOUD red mainnet alert. A drift here
 *      (e.g. someone adds a "mainnet" substring to localnet) would
 *      route a mainnet RPC into the silent-banner path.
 *
 *   2. `resolveRpcAllowlist()` / `isAllowlistedEndpoint()` — gates
 *      which RPC endpoints the app can talk to. Without a mainnet
 *      entry, switching to mainnet would either crash or fall
 *      through to the unknown-RPC path (which would alert but is a
 *      defense-in-depth, not a primary gate).
 *
 *   3. `decideWalletAllowlist()` — gates which wallet adapters the
 *      app can connect to. Mainnet: block unknown wallets entirely.
 *      Devnet: warn but allow (test wallets welcome).
 *
 * All three are tested without spinning up a React tree, validator,
 * or network — sub-second cargo-equivalent for the front-end.
 */

import { expect } from "chai";

import { classifyEndpoint } from "../app/src/lib/networkClassify";
import { isAllowlistedEndpoint, resolveRpcAllowlist } from "../app/src/lib/rpcAllowlist";
import {
  decideWalletAllowlist,
  isBlockedWallet,
  shouldAutoConnect,
} from "../app/src/lib/walletAllowlist";

describe("frontend — classifyEndpoint (NetworkBanner source-of-truth)", () => {
  it("classifies the canonical Solana mainnet RPC as mainnet", () => {
    expect(classifyEndpoint("https://api.mainnet-beta.solana.com")).to.equal("mainnet");
  });

  it("classifies the canonical Solana devnet RPC as devnet", () => {
    expect(classifyEndpoint("https://api.devnet.solana.com")).to.equal("devnet");
  });

  it("classifies 127.0.0.1:8899 as localnet", () => {
    expect(classifyEndpoint("http://127.0.0.1:8899")).to.equal("localnet");
  });

  it("classifies localhost:* as localnet", () => {
    expect(classifyEndpoint("http://localhost:8899")).to.equal("localnet");
  });

  it("classifies a Helius mainnet URL as mainnet (substring match)", () => {
    expect(classifyEndpoint("https://mainnet.helius-rpc.com/?api-key=xxx")).to.equal("mainnet");
  });

  it("classifies a Helius devnet URL as devnet (substring match)", () => {
    expect(classifyEndpoint("https://devnet.helius-rpc.com/?api-key=xxx")).to.equal("devnet");
  });

  it("classifies a Triton mainnet URL as mainnet", () => {
    expect(classifyEndpoint("https://yyy.mainnet.rpcpool.com")).to.equal("mainnet");
  });

  it("returns 'unknown' for a URL with no cluster substring", () => {
    expect(classifyEndpoint("https://evil.example.com")).to.equal("unknown");
  });

  it("returns 'unknown' for an empty URL", () => {
    expect(classifyEndpoint("")).to.equal("unknown");
  });

  it("order matters — localnet check beats devnet substring", () => {
    // SEV-045 — if someone reorders the substring checks and `devnet`
    // is checked before `localhost`, a URL like
    // `http://localhost:8899?network=devnet` could classify as devnet
    // even though it's actually local. Pin the order behavior.
    expect(classifyEndpoint("http://localhost:8899?network=devnet")).to.equal("localnet");
  });
});

describe("frontend — resolveRpcAllowlist (per-network endpoint pinning)", () => {
  it("returns the localnet validator endpoint for localnet", () => {
    const { primary, secondaries } = resolveRpcAllowlist("localnet");
    expect(primary).to.equal("http://127.0.0.1:8899");
    expect(secondaries).to.deep.equal([]);
  });

  it("returns the canonical Solana devnet RPC as primary", () => {
    const { primary } = resolveRpcAllowlist("devnet");
    expect(primary).to.equal("https://api.devnet.solana.com");
  });

  it("returns the canonical Solana mainnet RPC as primary", () => {
    const { primary } = resolveRpcAllowlist("mainnet-beta");
    expect(primary).to.equal("https://api.mainnet-beta.solana.com");
  });

  // The Helius/Triton conditional inclusion depends on
  // process.env.NEXT_PUBLIC_HELIUS_* / NEXT_PUBLIC_TRITON_*. We don't
  // assert their presence (the test env doesn't set them); instead we
  // only assert the primary, which is the floor guarantee. If a CI
  // run does set the env vars, the secondaries should grow — that's
  // exercised by an env-var-tweaking variant in the future.
});

describe("frontend — isAllowlistedEndpoint (refuse user-supplied endpoints)", () => {
  it("accepts the primary devnet endpoint", () => {
    expect(isAllowlistedEndpoint("https://api.devnet.solana.com", "devnet")).to.equal(true);
  });

  it("accepts the primary mainnet endpoint", () => {
    expect(isAllowlistedEndpoint("https://api.mainnet-beta.solana.com", "mainnet-beta")).to.equal(
      true,
    );
  });

  it("refuses an arbitrary attacker-controlled URL on mainnet", () => {
    expect(isAllowlistedEndpoint("https://evil.example.com", "mainnet-beta")).to.equal(false);
  });

  it("refuses the devnet endpoint when network=mainnet-beta", () => {
    // SEV-045 — cross-cluster substitution. A devnet URL on mainnet
    // is NOT allowlisted (different network's allowlist).
    expect(isAllowlistedEndpoint("https://api.devnet.solana.com", "mainnet-beta")).to.equal(false);
  });

  it("refuses the mainnet endpoint when network=devnet", () => {
    expect(isAllowlistedEndpoint("https://api.mainnet-beta.solana.com", "devnet")).to.equal(false);
  });
});

describe("frontend — decideWalletAllowlist (wallet-by-cluster gates)", () => {
  it("allows Phantom on every network", () => {
    expect(decideWalletAllowlist("Phantom", "localnet").kind).to.equal("allowed");
    expect(decideWalletAllowlist("Phantom", "devnet").kind).to.equal("allowed");
    expect(decideWalletAllowlist("Phantom", "mainnet-beta").kind).to.equal("allowed");
  });

  it("allows Ledger (hardware) on every network", () => {
    expect(decideWalletAllowlist("Ledger", "localnet").kind).to.equal("allowed");
    expect(decideWalletAllowlist("Ledger", "devnet").kind).to.equal("allowed");
    expect(decideWalletAllowlist("Ledger", "mainnet-beta").kind).to.equal("allowed");
  });

  it("BLOCKS an unknown wallet on mainnet", () => {
    const decision = decideWalletAllowlist("ScamWallet", "mainnet-beta");
    expect(decision.kind).to.equal("block");
    if (decision.kind === "block") {
      expect(decision.reason).to.equal("unknown_wallet_on_mainnet");
    }
  });

  it("WARNS (does not block) an unknown wallet on devnet", () => {
    const decision = decideWalletAllowlist("ScamWallet", "devnet");
    expect(decision.kind).to.equal("warn");
    if (decision.kind === "warn") {
      expect(decision.reason).to.equal("unknown_wallet");
    }
  });

  it("warns (does not block) an unknown wallet on localnet", () => {
    const decision = decideWalletAllowlist("ScamWallet", "localnet");
    expect(decision.kind).to.equal("warn");
  });

  it("case-sensitive matching — 'phantom' (lowercase) is unknown", () => {
    // SEV-045 — wallet-standard discovery surfaces names case-sensitively.
    // A spoofed wallet named "phantom" should NOT pass through.
    const decision = decideWalletAllowlist("phantom", "mainnet-beta");
    expect(decision.kind).to.equal("block");
  });
});

describe("frontend — shouldAutoConnect (gate autoConnect by allowlist)", () => {
  it("allows an allowlisted wallet to auto-reconnect on every network", () => {
    expect(shouldAutoConnect("Phantom", "devnet")).to.equal(true);
    expect(shouldAutoConnect("Phantom", "mainnet-beta")).to.equal(true);
    expect(shouldAutoConnect("Ledger", "mainnet-beta")).to.equal(true);
  });

  it("REFUSES auto-reconnect of an unknown wallet on mainnet (closes the bypass)", () => {
    // Issue #249 W1 — autoConnect must not silently reconnect a
    // previously approved unknown wallet against real funds.
    expect(shouldAutoConnect("ScamWallet", "mainnet-beta")).to.equal(false);
  });

  it("still auto-reconnects an unknown wallet on devnet/localnet (warn-but-allow)", () => {
    // Preserves today's test-wallet UX — only mainnet hard-blocks.
    expect(shouldAutoConnect("ScamWallet", "devnet")).to.equal(true);
    expect(shouldAutoConnect("ScamWallet", "localnet")).to.equal(true);
  });
});

describe("frontend — isBlockedWallet (post-connect guard predicate)", () => {
  it("flags an unknown wallet on mainnet for force-disconnect", () => {
    expect(isBlockedWallet("ScamWallet", "mainnet-beta")).to.equal(true);
  });

  it("does NOT flag allowlisted wallets on mainnet", () => {
    expect(isBlockedWallet("Phantom", "mainnet-beta")).to.equal(false);
    expect(isBlockedWallet("Ledger", "mainnet-beta")).to.equal(false);
  });

  it("is inert on devnet/localnet — never force-disconnects a test wallet", () => {
    expect(isBlockedWallet("ScamWallet", "devnet")).to.equal(false);
    expect(isBlockedWallet("ScamWallet", "localnet")).to.equal(false);
    expect(isBlockedWallet("Phantom", "devnet")).to.equal(false);
  });
});
