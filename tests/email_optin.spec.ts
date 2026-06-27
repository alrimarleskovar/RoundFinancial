/**
 * Email opt-in (notifications) — challenge crypto + in-memory store + email
 * validation. Pure (no Next / no DB), so it runs in the normal mocha+tsx suite,
 * mirroring the admin SIWS auth spec.
 *
 * The challenge HMAC binds (domain, pubkey, email, action, nonce, issuedAt), so
 * the key assertions are: tampering with the email OR the action invalidates
 * the token, a real ed25519 signature over the issued message verifies, and the
 * store applies subscribe/unsubscribe idempotently.
 */

import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { expect } from "chai";
import { Keypair } from "@solana/web3.js";

import { verifySignInSignature } from "../app/src/lib/admin/siws.js";
import {
  buildEmailMessage,
  issueEmailChallenge,
  verifyEmailChallengeShape,
  EMAIL_CHALLENGE_TTL_MS,
} from "../app/src/lib/notifications/emailChallenge.js";
import {
  getEmailStore,
  __resetEmailStoreForTest,
} from "../app/src/lib/notifications/emailStore.js";
import { isValidEmail, normalizeEmail } from "../app/src/lib/notifications/config.js";

const SECRET = "notify-secret-至少十六chars-long-enough";
const DOMAIN = "alerts.roundfi.test";
const EMAIL = "alice@example.com";

// DER PKCS8 prefix for an ed25519 private key (RFC 8410), then 32-byte seed.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function signWithKeypair(kp: Keypair, message: string): Uint8Array {
  const seed = Buffer.from(kp.secretKey.subarray(0, 32));
  const der = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return new Uint8Array(cryptoSign(null, Buffer.from(message, "utf8"), key));
}

describe("email opt-in — challenge shape (HMAC + TTL)", () => {
  it("round-trips: a freshly issued challenge verifies", () => {
    const pubkey = Keypair.generate().publicKey.toBase58();
    const c = issueEmailChallenge({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      now: 1000,
    });
    const v = verifyEmailChallengeShape({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      nonce: c.nonce,
      issuedAt: c.issuedAt,
      challengeToken: c.challengeToken,
      now: 1000,
    });
    expect(v.ok).to.equal(true);
    if (v.ok) expect(v.message).to.equal(c.message);
  });

  it("rejects a token replayed for a DIFFERENT email", () => {
    const pubkey = Keypair.generate().publicKey.toBase58();
    const c = issueEmailChallenge({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      now: 1000,
    });
    const v = verifyEmailChallengeShape({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: "attacker@evil.com", // swapped
      action: "subscribe",
      nonce: c.nonce,
      issuedAt: c.issuedAt,
      challengeToken: c.challengeToken,
      now: 1000,
    });
    expect(v.ok).to.equal(false);
    if (!v.ok) expect(v.reason).to.equal("bad_token");
  });

  it("rejects a token replayed for a DIFFERENT action", () => {
    const pubkey = Keypair.generate().publicKey.toBase58();
    const c = issueEmailChallenge({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      now: 1000,
    });
    const v = verifyEmailChallengeShape({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "unsubscribe", // swapped
      nonce: c.nonce,
      issuedAt: c.issuedAt,
      challengeToken: c.challengeToken,
      now: 1000,
    });
    expect(v.ok).to.equal(false);
    if (!v.ok) expect(v.reason).to.equal("bad_token");
  });

  it("rejects an expired challenge (past the TTL window)", () => {
    const pubkey = Keypair.generate().publicKey.toBase58();
    const c = issueEmailChallenge({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      now: 1000,
    });
    const v = verifyEmailChallengeShape({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      nonce: c.nonce,
      issuedAt: c.issuedAt,
      challengeToken: c.challengeToken,
      now: 1000 + EMAIL_CHALLENGE_TTL_MS + 1,
    });
    expect(v.ok).to.equal(false);
    if (!v.ok) expect(v.reason).to.equal("expired");
  });

  it("rejects a token forged under a different secret", () => {
    const pubkey = Keypair.generate().publicKey.toBase58();
    const c = issueEmailChallenge({
      secret: "some-other-secret-16chars+long",
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      now: 1000,
    });
    const v = verifyEmailChallengeShape({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      nonce: c.nonce,
      issuedAt: c.issuedAt,
      challengeToken: c.challengeToken,
      now: 1000,
    });
    expect(v.ok).to.equal(false);
    if (!v.ok) expect(v.reason).to.equal("bad_token");
  });
});

describe("email opt-in — signature over the issued message", () => {
  it("accepts a real ed25519 signature by the binding wallet", () => {
    const kp = Keypair.generate();
    const pubkey = kp.publicKey.toBase58();
    const c = issueEmailChallenge({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      now: 1000,
    });
    const sig = signWithKeypair(kp, c.message);
    expect(verifySignInSignature(pubkey, c.message, sig)).to.equal(true);
  });

  it("rejects a signature from a different wallet", () => {
    const owner = Keypair.generate();
    const attacker = Keypair.generate();
    const message = buildEmailMessage({
      domain: DOMAIN,
      pubkey: owner.publicKey.toBase58(),
      email: EMAIL,
      action: "subscribe",
      nonce: "abc",
      issuedAt: 1000,
    });
    const sig = signWithKeypair(attacker, message);
    expect(verifySignInSignature(owner.publicKey.toBase58(), message, sig)).to.equal(false);
  });
});

describe("email opt-in — in-memory store", () => {
  beforeEach(() => __resetEmailStoreForTest());

  it("subscribe binds an opted-in email + lang; get returns it", async () => {
    const store = getEmailStore();
    await store.subscribe("walletA", EMAIL, "tok1", "pt");
    expect(await store.get("walletA")).to.deep.equal({ email: EMAIL, optedIn: true, lang: "pt" });
  });

  it("unsubscribe flips opted-in to false and returns true", async () => {
    const store = getEmailStore();
    await store.subscribe("walletA", EMAIL, "tok1", "en");
    expect(await store.unsubscribe("walletA", "tok2")).to.equal(true);
    expect(await store.get("walletA")).to.deep.equal({ email: EMAIL, optedIn: false, lang: "en" });
  });

  it("unsubscribe of an unknown wallet returns false", async () => {
    const store = getEmailStore();
    expect(await store.unsubscribe("nobody", "tok")).to.equal(false);
  });

  it("re-subscribe is an idempotent upsert (latest email + lang win, opted back in)", async () => {
    const store = getEmailStore();
    await store.subscribe("walletA", EMAIL, "tok1", "pt");
    await store.unsubscribe("walletA", "tok2");
    await store.subscribe("walletA", "bob@example.com", "tok3", "en");
    expect(await store.get("walletA")).to.deep.equal({
      email: "bob@example.com",
      optedIn: true,
      lang: "en",
    });
  });
});

describe("email opt-in — validation", () => {
  it("accepts well-formed addresses", () => {
    expect(isValidEmail("a@b.co")).to.equal(true);
    expect(isValidEmail("First.Last+tag@sub.example.com")).to.equal(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmail("")).to.equal(false);
    expect(isValidEmail("no-at-sign")).to.equal(false);
    expect(isValidEmail("missing@domain")).to.equal(false);
    expect(isValidEmail("two@@at.com")).to.equal(false);
    expect(isValidEmail(`${"x".repeat(260)}@example.com`)).to.equal(false);
  });

  it("rejects delimiter / injection characters (safe to persist + encode)", () => {
    expect(isValidEmail("a@b.co|unsubscribe")).to.equal(false); // pipe → delimiter
    expect(isValidEmail("a@b.co<script>")).to.equal(false);
    expect(isValidEmail('"a"@b.co')).to.equal(false);
    expect(isValidEmail("a(comment)@b.co")).to.equal(false);
    expect(isValidEmail("a,b@c.co")).to.equal(false);
    expect(isValidEmail("a;b@c.co")).to.equal(false);
  });

  it("normalizes casing + surrounding whitespace", () => {
    expect(normalizeEmail("  Alice@Example.COM  ")).to.equal("alice@example.com");
  });
});

describe("email opt-in — HMAC canonicalization + hardening", () => {
  it("a crafted email can't re-split the tuple to a colliding HMAC", () => {
    // Under a `|`-joined HMAC, an email ending in the delimiter could shift the
    // field boundaries so a token issued for one (email, action) validated for
    // another. JSON encoding makes the tuples serialize distinctly, so a token
    // issued for "a@b.co" never validates for a delimiter-laden lookalike.
    const pubkey = Keypair.generate().publicKey.toBase58();
    const c = issueEmailChallenge({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: "a@b.co",
      action: "subscribe",
      now: 1000,
    });
    const v = verifyEmailChallengeShape({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: 'a@b.co","unsubscribe', // the JSON-injection attempt
      action: "subscribe",
      nonce: c.nonce,
      issuedAt: c.issuedAt,
      challengeToken: c.challengeToken,
      now: 1000,
    });
    expect(v.ok).to.equal(false);
    if (!v.ok) expect(v.reason).to.equal("bad_token");
  });

  it("rejects a nonce that isn't the issued hex shape", () => {
    const pubkey = Keypair.generate().publicKey.toBase58();
    const c = issueEmailChallenge({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      now: 1000,
    });
    const v = verifyEmailChallengeShape({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      nonce: "not|a|hex|nonce",
      issuedAt: c.issuedAt,
      challengeToken: c.challengeToken,
      now: 1000,
    });
    expect(v.ok).to.equal(false);
    if (!v.ok) expect(v.reason).to.equal("bad_token");
  });

  it("rejects a non-finite issuedAt (NaN can't slip the TTL window)", () => {
    const pubkey = Keypair.generate().publicKey.toBase58();
    const c = issueEmailChallenge({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      now: 1000,
    });
    const v = verifyEmailChallengeShape({
      secret: SECRET,
      domain: DOMAIN,
      pubkey,
      email: EMAIL,
      action: "subscribe",
      nonce: c.nonce,
      issuedAt: Number.NaN,
      challengeToken: c.challengeToken,
      now: 1000,
    });
    expect(v.ok).to.equal(false);
    if (!v.ok) expect(v.reason).to.equal("expired");
  });
});
