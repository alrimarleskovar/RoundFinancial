/**
 * Admin SIWS auth core (ADR 0009 §1) — server-side verification, session
 * HMAC, stateless challenge, and allowlist. Pure crypto, no Next / no DB,
 * so it runs in the normal mocha+tsx suite.
 *
 * Signing uses Node's ed25519 (same primitive a wallet uses) so the test
 * exercises the real verification path, not a stub.
 */

import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";

import { buildSignInMessage, verifySignInSignature } from "../app/src/lib/admin/siws.js";
import {
  issueChallenge,
  verifyChallenge,
  CHALLENGE_TTL_MS,
  __resetUsedTokensForTest,
} from "../app/src/lib/admin/challenge.js";
import { signSession, verifySession } from "../app/src/lib/admin/session.js";
import { buildAllowlist, isAllowed, parseAllowlist } from "../app/src/lib/admin/allowlist.js";

const SECRET = "test-secret-至少十六chars-long-enough";
const DOMAIN = "admin.roundfi.test";

// DER PKCS8 prefix for an ed25519 private key (RFC 8410), then 32-byte seed.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function signWithKeypair(kp: Keypair, message: string): Uint8Array {
  const seed = Buffer.from(kp.secretKey.subarray(0, 32));
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return new Uint8Array(cryptoSign(null, Buffer.from(message, "utf8"), key));
}

describe("admin auth — SIWS core (ADR 0009)", () => {
  beforeEach(() => __resetUsedTokensForTest());

  describe("verifySignInSignature", () => {
    it("accepts a valid ed25519 signature over the exact message", () => {
      const kp = Keypair.generate();
      const pubkey = kp.publicKey.toBase58();
      const message = buildSignInMessage({ domain: DOMAIN, pubkey, nonce: "abc", issuedAt: 1000 });
      const sig = signWithKeypair(kp, message);
      expect(verifySignInSignature(pubkey, message, sig)).to.equal(true);
    });

    it("rejects a signature from a different key", () => {
      const signer = Keypair.generate();
      const other = Keypair.generate();
      const message = buildSignInMessage({
        domain: DOMAIN,
        pubkey: other.publicKey.toBase58(),
        nonce: "abc",
        issuedAt: 1000,
      });
      const sig = signWithKeypair(signer, message);
      expect(verifySignInSignature(other.publicKey.toBase58(), message, sig)).to.equal(false);
    });

    it("rejects a tampered message", () => {
      const kp = Keypair.generate();
      const pubkey = kp.publicKey.toBase58();
      const message = buildSignInMessage({ domain: DOMAIN, pubkey, nonce: "abc", issuedAt: 1000 });
      const sig = signWithKeypair(kp, message);
      expect(verifySignInSignature(pubkey, message + "x", sig)).to.equal(false);
    });

    it("rejects a wrong-length signature", () => {
      const kp = Keypair.generate();
      expect(verifySignInSignature(kp.publicKey.toBase58(), "m", new Uint8Array(10))).to.equal(
        false,
      );
    });
  });

  describe("challenge (stateless, HMAC-bound, single-use)", () => {
    it("round-trips and yields the exact message to sign", () => {
      const kp = Keypair.generate();
      const c = issueChallenge({
        secret: SECRET,
        domain: DOMAIN,
        pubkey: kp.publicKey.toBase58(),
        now: 5000,
      });
      const v = verifyChallenge({
        secret: SECRET,
        domain: DOMAIN,
        pubkey: c.pubkey,
        nonce: c.nonce,
        issuedAt: c.issuedAt,
        challengeToken: c.challengeToken,
        now: 5000,
      });
      expect(v.ok).to.equal(true);
      if (v.ok) expect(v.message).to.equal(c.message);
    });

    it("rejects an expired challenge", () => {
      const kp = Keypair.generate();
      const c = issueChallenge({
        secret: SECRET,
        domain: DOMAIN,
        pubkey: kp.publicKey.toBase58(),
        now: 5000,
      });
      const v = verifyChallenge({
        secret: SECRET,
        domain: DOMAIN,
        pubkey: c.pubkey,
        nonce: c.nonce,
        issuedAt: c.issuedAt,
        challengeToken: c.challengeToken,
        now: 5000 + CHALLENGE_TTL_MS + 1,
      });
      expect(v.ok).to.equal(false);
    });

    it("rejects a forged token (wrong secret)", () => {
      const kp = Keypair.generate();
      const c = issueChallenge({
        secret: SECRET,
        domain: DOMAIN,
        pubkey: kp.publicKey.toBase58(),
        now: 5000,
      });
      const v = verifyChallenge({
        secret: "different-secret-different-len!!",
        domain: DOMAIN,
        pubkey: c.pubkey,
        nonce: c.nonce,
        issuedAt: c.issuedAt,
        challengeToken: c.challengeToken,
        now: 5000,
      });
      expect(v.ok).to.equal(false);
    });

    it("is single-use (replay rejected)", () => {
      const kp = Keypair.generate();
      const c = issueChallenge({
        secret: SECRET,
        domain: DOMAIN,
        pubkey: kp.publicKey.toBase58(),
        now: 5000,
      });
      const args = {
        secret: SECRET,
        domain: DOMAIN,
        pubkey: c.pubkey,
        nonce: c.nonce,
        issuedAt: c.issuedAt,
        challengeToken: c.challengeToken,
        now: 5000,
      };
      expect(verifyChallenge(args).ok).to.equal(true);
      expect(verifyChallenge(args).ok).to.equal(false); // replay
    });
  });

  describe("session token (HMAC, expiring)", () => {
    it("signs and verifies, returning the pubkey", () => {
      const token = signSession({ secret: SECRET, pubkey: "WalletXYZ", now: 0 });
      expect(verifySession({ secret: SECRET, token, now: 1000 })).to.deep.equal({
        pubkey: "WalletXYZ",
      });
    });

    it("rejects after expiry", () => {
      const token = signSession({ secret: SECRET, pubkey: "WalletXYZ", now: 0, ttlSeconds: 60 });
      expect(verifySession({ secret: SECRET, token, now: 61_000 })).to.equal(null);
    });

    it("rejects a tampered token", () => {
      const token = signSession({ secret: SECRET, pubkey: "WalletXYZ", now: 0 });
      const tampered = token.slice(0, -2) + "xy";
      expect(verifySession({ secret: SECRET, token: tampered, now: 1000 })).to.equal(null);
    });

    it("rejects a token signed with another secret", () => {
      const token = signSession({ secret: SECRET, pubkey: "WalletXYZ", now: 0 });
      expect(
        verifySession({ secret: "another-secret-another-length!!", token, now: 1000 }),
      ).to.equal(null);
    });
  });

  describe("allowlist", () => {
    it("parses a comma-separated env list", () => {
      const set = parseAllowlist(" A , B ,, C ");
      expect([...set].sort()).to.deep.equal(["A", "B", "C"]);
    });

    it("unions env operators with the on-chain authority", () => {
      const set = buildAllowlist({ envValue: "OP1,OP2", authority: "AUTHORITY" });
      expect(isAllowed("OP1", set)).to.equal(true);
      expect(isAllowed("AUTHORITY", set)).to.equal(true);
      expect(isAllowed("STRANGER", set)).to.equal(false);
    });

    it("is empty (fail-closed) when no env and no authority", () => {
      const set = buildAllowlist({ envValue: undefined, authority: null });
      expect(set.size).to.equal(0);
      expect(isAllowed("anyone", set)).to.equal(false);
    });
  });
});
