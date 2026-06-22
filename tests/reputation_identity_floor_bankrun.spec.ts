/**
 * SEV-E — identity-floor re-cap on identity loss (bankrun, clock-warp).
 *
 * **The finding.** SEV-047's identity floor (`cap_level_for_identity`) runs at
 * `promote_level`, but the resulting `ReputationProfile.level` is a SNAPSHOT.
 * `roundfi-core::join_pool` reads that snapshot directly and — by the
 * architecture boundary in `state/identity.rs` — MUST NOT read the
 * `IdentityRecord`. So once a wallet reached an identity-gated tier (most
 * damagingly L4 Elite, with the smallest stake), nothing re-applied the floor
 * when its identity later lapsed: the discounted tier persisted into the next
 * join. The clearest exploit is fully deterministic: verify → reach L4 → unlink
 * the identity (reclaiming its rent) → keep L4 forever.
 *
 * **The fix.** The reputation program re-caps `profile.level` to the identity
 * floor at the moment identity loss is observed on-chain:
 *   • `unlink_identity` — UNCONDITIONAL (identity is definitively gone). Closes
 *     the deterministic exploit above without depending on any external crank.
 *   • `refresh_identity` — when the bridge re-read flips the record out of
 *     `Verified` (Expired / Revoked). Covers the auditor's "é revogada" case.
 * Both delegate to the pure `ReputationProfile::demote_to_identity_floor`
 * (exhaustively unit-tested in the Rust module); this spec proves the on-chain
 * wiring (new `identity_gate` + optional `profile` accounts, the handler reads,
 * and the persisted demotion) actually reaches it.
 *
 * **Why bankrun.** Reaching an L2-qualifying profile needs score 500 AND
 * cycles_completed >= 1 under the SEV-027/030 60s admin-attest cooldown — only
 * possible by warping the clock +61s between attests (same rationale as
 * `reputation_gate_bankrun.spec.ts`). roundfi-reputation has no mpl-core CPI,
 * so this runs in the CI `bankrun · no-mpl-core` lane.
 */

import { expect } from "chai";
import { describe, it, before } from "mocha";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";

import {
  SCHEMA,
  adminAttest,
  fetchProfile,
  identityFor,
  identityGateFor,
  initProfile,
  initializeReputation,
  keypairFromSeed,
  promoteLevel,
  reputationConfigFor,
  reputationProfileFor,
  setIdentityGate,
} from "./_harness/index.js";
import { setupBankrunEnvCompat, type BankrunEnvCompat } from "./_harness/bankrun_compat.js";
import { setBankrunUnixTs } from "./_harness/bankrun.js";

const COOLDOWN_STEP = 61n; // a hair past MIN_ADMIN_ATTEST_COOLDOWN_SECS (60s).
let CLOCK = 1_950_000_000n; // ~2031, comfortably past every cooldown floor.

// Passport attestation byte layout (83 bytes) — see identity/passport.rs.
const PASSPORT_LEN = 83;
const OFF_OWNER = 1;
const OFF_NETWORK = 33;
const OFF_STATE = 65;
const OFF_EXPIRE = 66;
const STATE_ACTIVE = 0;
const STATE_REVOKED = 1;

const LEVEL_1 = 1;
const LEVEL_2 = 2;
const IDENTITY_STATUS_REVOKED = 3; // IdentityStatus::Revoked

// Bridge-service identity provenance. Generated per-run so we own the
// attestation accounts we fabricate.
let passportAuthority: PublicKey;
let passportNetwork: PublicKey;

async function tick(env: BankrunEnvCompat): Promise<void> {
  CLOCK += COOLDOWN_STEP;
  await setBankrunUnixTs(env.context, CLOCK);
}

/** Give `addr` a system-owned, well-funded wallet (pays the IdentityRecord
 *  rent on link; receives it back on unlink). */
function fundWallet(env: BankrunEnvCompat, addr: PublicKey): void {
  env.context.setAccount(addr, {
    lamports: 5_000_000_000,
    data: new Uint8Array(0),
    owner: SystemProgram.programId,
    executable: false,
    rentEpoch: 0,
  });
}

/** Build a raw 83-byte Human Passport attestation as the off-chain bridge
 *  service would write it (no expiry). `state`: 0=Active, 1=Revoked. */
function makePassport(owner: PublicKey, state: number): Uint8Array {
  const buf = Buffer.alloc(PASSPORT_LEN);
  buf[0] = 0; // version
  owner.toBuffer().copy(buf, OFF_OWNER);
  passportNetwork.toBuffer().copy(buf, OFF_NETWORK);
  buf[OFF_STATE] = state;
  buf.writeBigInt64LE(0n, OFF_EXPIRE); // 0 ≡ never expires
  return new Uint8Array(buf);
}

/** Write a fabricated passport attestation account owned by the bridge. */
function writePassport(env: BankrunEnvCompat, addr: PublicKey, data: Uint8Array): void {
  env.context.setAccount(addr, {
    lamports: 5_000_000_000,
    data,
    owner: passportAuthority,
    executable: false,
    rentEpoch: 0,
  });
}

async function linkPassport(
  env: BankrunEnvCompat,
  subject: Keypair,
  gatewayToken: PublicKey,
): Promise<string> {
  return (env.programs.reputation.methods as any)
    .linkPassportIdentity()
    .accounts({
      wallet: subject.publicKey,
      config: reputationConfigFor(env),
      identity: identityFor(env, subject.publicKey),
      gatewayToken,
      systemProgram: SystemProgram.programId,
    })
    .signers([env.payer, subject])
    .rpc();
}

async function refreshIdentity(
  env: BankrunEnvCompat,
  subject: PublicKey,
  gatewayToken: PublicKey,
): Promise<string> {
  return (env.programs.reputation.methods as any)
    .refreshIdentity()
    .accounts({
      subject,
      config: reputationConfigFor(env),
      identity: identityFor(env, subject),
      // SEV-E: new accounts.
      identityGate: identityGateFor(env),
      profile: reputationProfileFor(env, subject),
      gatewayToken,
      caller: env.payer.publicKey,
    })
    .signers([env.payer])
    .rpc();
}

async function unlinkIdentity(env: BankrunEnvCompat, subject: Keypair): Promise<string> {
  return (env.programs.reputation.methods as any)
    .unlinkIdentity()
    .accounts({
      wallet: subject.publicKey,
      identity: identityFor(env, subject.publicKey),
      // SEV-E: new accounts.
      identityGate: identityGateFor(env),
      profile: reputationProfileFor(env, subject.publicKey),
    })
    .signers([env.payer, subject])
    .rpc();
}

/**
 * Drive `seed` to L2 with a linked, VERIFIED Human Passport identity under an
 * enabled gate (requiredMinLevel = 2). Mirrors the proven score recipe from
 * `reputation_gate_bankrun.spec.ts` (1 PoolComplete +25 + 95 Payments +475 =
 * score 500, cycles 1, all unverified/halved), then links + promotes. Returns
 * the subject keypair, asserted at L2.
 */
async function driveToL2Verified(env: BankrunEnvCompat, seed: string): Promise<Keypair> {
  const subject = keypairFromSeed(seed);
  fundWallet(env, subject.publicKey);
  await initProfile(env, subject.publicKey);

  await tick(env);
  await adminAttest(env, {
    subject: subject.publicKey,
    schemaId: SCHEMA.PoolComplete,
    nonce: 0x0e00_0000n,
  });
  for (let i = 0; i < 95; i++) {
    await tick(env);
    await adminAttest(env, {
      subject: subject.publicKey,
      schemaId: SCHEMA.Payment,
      nonce: BigInt(0x0e00_0100 + i),
    });
  }

  // Link a verified identity (Active passport, no expiry).
  const gw = keypairFromSeed(`${seed}/gw`).publicKey;
  writePassport(env, gw, makePassport(subject.publicKey, STATE_ACTIVE));
  await linkPassport(env, subject, gw);

  // Enable the gate, then promote: a verified subject bypasses the floor → L2.
  await setIdentityGate(env, { requiredMinLevel: 2 });
  await promoteLevel(env, {
    subject: subject.publicKey,
    identity: identityFor(env, subject.publicKey),
  });

  const p = (await fetchProfile(env, subject.publicKey)) as { level: number };
  expect(p.level, "verified subject should reach L2 under gate=2").to.equal(LEVEL_2);
  return subject;
}

describe("reputation — SEV-E identity-floor re-cap on identity loss (bankrun)", function () {
  this.timeout(180_000);

  let env: BankrunEnvCompat;

  before(async function () {
    env = await setupBankrunEnvCompat({ loadMplCore: false });
    await setBankrunUnixTs(env.context, CLOCK);

    passportAuthority = Keypair.generate().publicKey;
    passportNetwork = Keypair.generate().publicKey;

    await initializeReputation(env, {
      coreProgram: env.ids.core,
      passportAttestationAuthority: passportAuthority,
      passportNetwork,
    });
    // Create the IdentityGateConfig PDA (gate OFF initially).
    await setIdentityGate(env, { requiredMinLevel: 0 });
  });

  it("unlink_identity re-caps L2 → L1 and closes the record (deterministic exploit)", async function () {
    const subject = await driveToL2Verified(env, "sev-e/unlink");

    // The exploit: drop identity but keep the gated tier. With the fix, unlink
    // demotes to the floor (gate=2 ⇒ unverified caps at L1).
    await unlinkIdentity(env, subject);

    const after = (await fetchProfile(env, subject.publicKey)) as { level: number };
    expect(after.level, "unlinking identity must demote L2 → L1 under gate=2").to.equal(LEVEL_1);

    const idInfo = await env.connection.getAccountInfo(
      identityFor(env, subject.publicKey),
      "confirmed",
    );
    expect(idInfo, "IdentityRecord should be closed by unlink").to.equal(null);
  });

  it("refresh_identity demotes L2 → L1 when the passport flips to Revoked", async function () {
    const subject = await driveToL2Verified(env, "sev-e/refresh");
    const gw = keypairFromSeed("sev-e/refresh/gw").publicKey;

    // Bridge revokes the passport: rewrite the same attestation → Revoked.
    writePassport(env, gw, makePassport(subject.publicKey, STATE_REVOKED));
    await refreshIdentity(env, subject.publicKey, gw);

    const after = (await fetchProfile(env, subject.publicKey)) as { level: number };
    expect(after.level, "refresh→Revoked must demote L2 → L1 under gate=2").to.equal(LEVEL_1);

    const rec = (await (env.programs.reputation.account as any).identityRecord.fetch(
      identityFor(env, subject.publicKey),
    )) as { status: number };
    expect(rec.status, "identity status should be flipped to Revoked").to.equal(
      IDENTITY_STATUS_REVOKED,
    );
  });

  it("unlink_identity is a no-op for a level-1 wallet (no spurious demotion)", async function () {
    // Negative control: a verified L1 wallet that unlinks must STAY L1 — the
    // re-cap only ever moves DOWN to the floor, never below it.
    const subject = keypairFromSeed("sev-e/noop");
    fundWallet(env, subject.publicKey);
    await initProfile(env, subject.publicKey);

    const gw = keypairFromSeed("sev-e/noop/gw").publicKey;
    writePassport(env, gw, makePassport(subject.publicKey, STATE_ACTIVE));
    await linkPassport(env, subject, gw);
    await setIdentityGate(env, { requiredMinLevel: 2 });

    await unlinkIdentity(env, subject);

    const after = (await fetchProfile(env, subject.publicKey)) as { level: number };
    expect(after.level, "an L1 wallet must not be demoted below the floor").to.equal(LEVEL_1);
  });
});
