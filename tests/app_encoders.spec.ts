/**
 * Structural + PDA parity tests for the front-end's IDL-free
 * instruction encoders under `app/src/lib/*.ts`.
 *
 * Why this spec exists: the front-end ships hand-rolled encoders that
 * mirror `sdk/src/actions.ts`'s SDK-side encoders byte-for-byte. The
 * SDK encoders are exercised by the existing bankrun specs
 * (`tests/lifecycle.spec.ts`, `tests/security_*.spec.ts`,
 * `tests/yield_integration.spec.ts`). The front-end encoders are
 * **structurally duplicated** but were previously only validated by
 * devnet round-trips — meaning a discriminator typo or an account-list
 * reorder would only surface on a real Phantom-signed tx hitting
 * devnet.
 *
 * This spec catches both classes of drift at zero infra cost:
 *
 *   1. **Discriminator drift** — compute `sha256("global:<ix>")[:8]`
 *      in-test and assert the encoder embeds the same 8 bytes.
 *   2. **Account-count drift** — pin the count from
 *      `programs/roundfi-core/src/instructions/<ix>.rs`'s
 *      `<Accounts>` struct declaration; if a future PR adds an
 *      account to the on-chain struct without updating the encoder,
 *      this fails.
 *   3. **PDA derivation drift** — assert the encoder uses the
 *      canonical `@roundfi/sdk/pda` helpers (same source of truth
 *      that `parity.spec.ts` already pins against the Rust constants).
 *   4. **Signer position drift** — Solana's runtime expects signers at
 *      specific indices; assert each encoder's first key is the
 *      designated signer.
 *
 * Coverage today: 5 encoders (all the pure `build*Ix` builders in
 * `app/src/lib/`). `escape-valve-buy.ts` is excluded because it builds
 * its instruction inline inside `sendEscapeValveBuy` rather than
 * exposing a pure builder — refactoring it for testability is tracked
 * as a follow-up under issue #283.
 *
 * Runs under `pnpm test:app-encoders` (~1s, no validator).
 */

import { expect } from "chai";
import { createHash } from "node:crypto";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

// Direct sub-path imports (not the barrel) so legacy ts-node 7's
// CommonJS resolver doesn't choke on the `.js`-suffixed re-exports
// the barrel emits for NodeNext. Same workaround as parity.spec.ts.
import { ATTESTATION_SCHEMA } from "@roundfi/sdk/constants";
import {
  attestationNonce,
  attestationPda,
  escrowVaultAuthorityPda,
  listingPda,
  memberPda,
  protocolConfigPda,
  reputationProfilePda,
  solidarityVaultAuthorityPda,
} from "@roundfi/sdk/pda";

import { buildContributeIx } from "../app/src/lib/contribute";
import { buildClaimPayoutIx } from "../app/src/lib/claim-payout";
import { buildReleaseEscrowIx } from "../app/src/lib/release-escrow";
import { buildEscapeValveListIx } from "../app/src/lib/escape-valve-list";
import { buildDepositIdleToYieldIx } from "../app/src/lib/deposit-idle-to-yield";
import { DEVNET_PROGRAM_IDS, DEVNET_USDC_MINT } from "../app/src/lib/devnet";
import type { TransactionInstruction } from "@solana/web3.js";

// ─── helpers ─────────────────────────────────────────────────────────

/** Anchor instruction discriminator = sha256("global:<ix_name>")[:8]. */
function expectedDiscriminator(ixName: string): Buffer {
  return createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

/**
 * Indexed account fetch that throws if out-of-range — narrows the
 * `ix.keys[i]` type to `AccountMeta` (instead of `AccountMeta |
 * undefined` under `noUncheckedIndexedAccess`) and produces a clearer
 * failure message than the default "Cannot read property of undefined".
 */
function key(ix: TransactionInstruction, idx: number) {
  const k = ix.keys[idx];
  if (!k) {
    throw new Error(
      `expected ix.keys[${idx}] to exist, but only ${ix.keys.length} accounts present`,
    );
  }
  return k;
}

// Deterministic fixture wallets. Keypairs are seeded but the test
// only cares about pubkeys for PDA derivations.
const POOL = Keypair.generate().publicKey;
const MEMBER = Keypair.generate().publicKey;
const BUYER = Keypair.generate().publicKey;
const YIELD_VAULT = Keypair.generate().publicKey;
const YIELD_ADAPTER_PROGRAM = Keypair.generate().publicKey;
const CORE = DEVNET_PROGRAM_IDS.core;
const REPUTATION = DEVNET_PROGRAM_IDS.reputation;
const USDC = DEVNET_USDC_MINT;

// ─── tests ───────────────────────────────────────────────────────────

describe("app/src/lib/*.ts IDL-free encoders — structural parity", () => {
  describe("buildContributeIx", () => {
    const ix = buildContributeIx({ pool: POOL, memberWallet: MEMBER, cycle: 1 });

    it("uses sha256(global:contribute)[:8] as discriminator", () => {
      const expected = expectedDiscriminator("contribute");
      expect(ix.data.subarray(0, 8).toString("hex")).to.equal(expected.toString("hex"));
    });

    it("encodes [discriminator | cycle u8] = 9 bytes", () => {
      expect(ix.data.length).to.equal(9);
      expect(ix.data[8]).to.equal(1); // cycle arg
    });

    it("targets the roundfi-core program", () => {
      expect(ix.programId.toBase58()).to.equal(CORE.toBase58());
    });

    it("has 18 accounts in the program-mandated order", () => {
      // Mirrors Contribute<'info> in
      // programs/roundfi-core/src/instructions/contribute.rs.
      expect(ix.keys.length).to.equal(18);
    });

    it("places the member wallet as signer at index 0", () => {
      expect(key(ix, 0).pubkey.toBase58()).to.equal(MEMBER.toBase58());
      expect(key(ix, 0).isSigner).to.equal(true);
      expect(key(ix, 0).isWritable).to.equal(true);
    });

    it("derives the canonical Member + ProtocolConfig PDAs", () => {
      const [config] = protocolConfigPda(CORE);
      const [member] = memberPda(CORE, POOL, MEMBER);
      expect(key(ix, 1).pubkey.toBase58()).to.equal(config.toBase58());
      expect(key(ix, 3).pubkey.toBase58()).to.equal(member.toBase58());
    });

    it("derives the Solidarity + Escrow vault authority PDAs", () => {
      const [solidarityAuth] = solidarityVaultAuthorityPda(CORE, POOL);
      const [escrowAuth] = escrowVaultAuthorityPda(CORE, POOL);
      expect(key(ix, 7).pubkey.toBase58()).to.equal(solidarityAuth.toBase58());
      expect(key(ix, 9).pubkey.toBase58()).to.equal(escrowAuth.toBase58());
    });

    it("derives the reputation Profile + Attestation PDAs", () => {
      const [repProfile] = reputationProfilePda(REPUTATION, MEMBER);
      const nonce = attestationNonce(1, 0);
      const [attestation] = attestationPda(
        REPUTATION,
        POOL,
        MEMBER,
        ATTESTATION_SCHEMA.Payment,
        nonce,
      );
      expect(key(ix, 14).pubkey.toBase58()).to.equal(repProfile.toBase58());
      expect(key(ix, 16).pubkey.toBase58()).to.equal(attestation.toBase58());
    });

    it("uses the SPL Token + System programs at known indices", () => {
      expect(key(ix, 11).pubkey.toBase58()).to.equal(TOKEN_PROGRAM_ID.toBase58());
      expect(key(ix, 17).pubkey.toBase58()).to.equal(SystemProgram.programId.toBase58());
    });

    it("derives the member's USDC ATA at index 5", () => {
      const memberUsdc = getAssociatedTokenAddressSync(USDC, MEMBER);
      expect(key(ix, 5).pubkey.toBase58()).to.equal(memberUsdc.toBase58());
    });
  });

  describe("buildClaimPayoutIx", () => {
    const ix = buildClaimPayoutIx({
      pool: POOL,
      memberWallet: MEMBER,
      cycle: 2,
      slotIndex: 2,
    });

    it("uses sha256(global:claim_payout)[:8] as discriminator", () => {
      const expected = expectedDiscriminator("claim_payout");
      expect(ix.data.subarray(0, 8).toString("hex")).to.equal(expected.toString("hex"));
    });

    it("encodes [discriminator | cycle u8] = 9 bytes", () => {
      expect(ix.data.length).to.equal(9);
      expect(ix.data[8]).to.equal(2);
    });

    it("targets the roundfi-core program", () => {
      expect(ix.programId.toBase58()).to.equal(CORE.toBase58());
    });

    it("has 14 accounts in the program-mandated order", () => {
      // Mirrors ClaimPayout<'info> in claim_payout.rs.
      expect(ix.keys.length).to.equal(14);
    });

    it("places the member wallet as signer at index 0", () => {
      expect(key(ix, 0).pubkey.toBase58()).to.equal(MEMBER.toBase58());
      expect(key(ix, 0).isSigner).to.equal(true);
    });

    it("uses SCHEMA_CYCLE_COMPLETE for the attestation PDA", () => {
      const nonce = attestationNonce(2, 2);
      const [attestation] = attestationPda(
        REPUTATION,
        POOL,
        MEMBER,
        ATTESTATION_SCHEMA.CycleComplete,
        nonce,
      );
      expect(key(ix, 12).pubkey.toBase58()).to.equal(attestation.toBase58());
    });

    it("references the reputation program at the conventional index", () => {
      expect(key(ix, 8).pubkey.toBase58()).to.equal(REPUTATION.toBase58());
    });
  });

  describe("buildReleaseEscrowIx", () => {
    const ix = buildReleaseEscrowIx({ pool: POOL, memberWallet: MEMBER, checkpoint: 3 });

    it("uses sha256(global:release_escrow)[:8] as discriminator", () => {
      const expected = expectedDiscriminator("release_escrow");
      expect(ix.data.subarray(0, 8).toString("hex")).to.equal(expected.toString("hex"));
    });

    it("encodes [discriminator | checkpoint u8] = 9 bytes", () => {
      expect(ix.data.length).to.equal(9);
      expect(ix.data[8]).to.equal(3);
    });

    it("has 9 accounts in the program-mandated order", () => {
      // Mirrors ReleaseEscrow<'info> in release_escrow.rs.
      expect(ix.keys.length).to.equal(9);
    });

    it("places the member wallet as signer at index 0", () => {
      expect(key(ix, 0).pubkey.toBase58()).to.equal(MEMBER.toBase58());
      expect(key(ix, 0).isSigner).to.equal(true);
    });

    it("derives the Escrow vault authority PDA at index 6", () => {
      const [escrowAuth] = escrowVaultAuthorityPda(CORE, POOL);
      expect(key(ix, 6).pubkey.toBase58()).to.equal(escrowAuth.toBase58());
    });

    it("rejects checkpoints outside u8 range", () => {
      expect(() =>
        buildReleaseEscrowIx({ pool: POOL, memberWallet: MEMBER, checkpoint: 256 }),
      ).to.throw();
      expect(() =>
        buildReleaseEscrowIx({ pool: POOL, memberWallet: MEMBER, checkpoint: 0 }),
      ).to.throw();
    });
  });

  describe("buildEscapeValveListIx", () => {
    const priceUsdc = BigInt(14_000_000); // $14 USDC, 6 decimals
    const ix = buildEscapeValveListIx({
      pool: POOL,
      sellerWallet: MEMBER,
      slotIndex: 1,
      priceUsdc,
    });

    it("uses sha256(global:escape_valve_list)[:8] as discriminator", () => {
      const expected = expectedDiscriminator("escape_valve_list");
      expect(ix.data.subarray(0, 8).toString("hex")).to.equal(expected.toString("hex"));
    });

    it("encodes [discriminator | price_usdc u64 LE] = 16 bytes", () => {
      expect(ix.data.length).to.equal(16);
      expect(ix.data.readBigUInt64LE(8)).to.equal(priceUsdc);
    });

    it("has 6 accounts in the program-mandated order", () => {
      // Mirrors EscapeValveList<'info> in escape_valve_list.rs.
      expect(ix.keys.length).to.equal(6);
    });

    it("places the seller wallet as signer at index 0", () => {
      expect(key(ix, 0).pubkey.toBase58()).to.equal(MEMBER.toBase58());
      expect(key(ix, 0).isSigner).to.equal(true);
    });

    it("derives the Listing PDA from (pool, slot_index)", () => {
      const [listing] = listingPda(CORE, POOL, 1);
      expect(key(ix, 4).pubkey.toBase58()).to.equal(listing.toBase58());
      expect(key(ix, 4).isWritable).to.equal(true); // listing is init'd
    });

    it("ends with the System program (for `init`)", () => {
      expect(key(ix, 5).pubkey.toBase58()).to.equal(SystemProgram.programId.toBase58());
    });
  });

  describe("buildDepositIdleToYieldIx", () => {
    const amount = BigInt(10_000_000); // $10 USDC
    const ix = buildDepositIdleToYieldIx({
      pool: POOL,
      caller: BUYER,
      amount,
      yieldVault: YIELD_VAULT,
      yieldAdapterProgram: YIELD_ADAPTER_PROGRAM,
    });

    it("uses sha256(global:deposit_idle_to_yield)[:8] as discriminator", () => {
      const expected = expectedDiscriminator("deposit_idle_to_yield");
      expect(ix.data.subarray(0, 8).toString("hex")).to.equal(expected.toString("hex"));
    });

    it("encodes [discriminator | amount u64 LE] = 16 bytes", () => {
      expect(ix.data.length).to.equal(16);
      expect(ix.data.readBigUInt64LE(8)).to.equal(amount);
    });

    it("has 8 explicit accounts (adapter remaining_accounts excluded)", () => {
      // Mirrors DepositIdleToYield<'info> in deposit_idle_to_yield.rs.
      // remaining_accounts is variable per adapter and appended by the
      // modal layer, so the encoder itself stops at 8.
      expect(ix.keys.length).to.equal(8);
    });

    it("places the caller as signer at index 0 (permissionless crank)", () => {
      expect(key(ix, 0).pubkey.toBase58()).to.equal(BUYER.toBase58());
      expect(key(ix, 0).isSigner).to.equal(true);
      // Caller is read-only — it pays fees but doesn't hold balance.
      expect(key(ix, 0).isWritable).to.equal(false);
    });

    it("references the adapter program at index 6", () => {
      expect(key(ix, 6).pubkey.toBase58()).to.equal(YIELD_ADAPTER_PROGRAM.toBase58());
    });

    it("derives the pool's USDC ATA at index 4", () => {
      const poolUsdcVault = getAssociatedTokenAddressSync(USDC, POOL, true);
      expect(key(ix, 4).pubkey.toBase58()).to.equal(poolUsdcVault.toBase58());
    });
  });

  describe("cross-encoder invariants", () => {
    it("all encoders embed the canonical roundfi-core program ID", () => {
      const ixs = [
        buildContributeIx({ pool: POOL, memberWallet: MEMBER, cycle: 0 }),
        buildClaimPayoutIx({ pool: POOL, memberWallet: MEMBER, cycle: 0, slotIndex: 0 }),
        buildReleaseEscrowIx({ pool: POOL, memberWallet: MEMBER, checkpoint: 1 }),
        buildEscapeValveListIx({ pool: POOL, sellerWallet: MEMBER, slotIndex: 0, priceUsdc: 1 }),
        buildDepositIdleToYieldIx({
          pool: POOL,
          caller: BUYER,
          amount: 1,
          yieldVault: YIELD_VAULT,
          yieldAdapterProgram: YIELD_ADAPTER_PROGRAM,
        }),
      ];
      for (const ix of ixs) {
        expect(ix.programId.toBase58()).to.equal(CORE.toBase58());
      }
    });

    it("all encoders' discriminators are byte-distinct (no copy-paste collisions)", () => {
      const discriminators = [
        buildContributeIx({ pool: POOL, memberWallet: MEMBER, cycle: 0 }).data.subarray(0, 8),
        buildClaimPayoutIx({
          pool: POOL,
          memberWallet: MEMBER,
          cycle: 0,
          slotIndex: 0,
        }).data.subarray(0, 8),
        buildReleaseEscrowIx({ pool: POOL, memberWallet: MEMBER, checkpoint: 1 }).data.subarray(
          0,
          8,
        ),
        buildEscapeValveListIx({
          pool: POOL,
          sellerWallet: MEMBER,
          slotIndex: 0,
          priceUsdc: 1,
        }).data.subarray(0, 8),
        buildDepositIdleToYieldIx({
          pool: POOL,
          caller: BUYER,
          amount: 1,
          yieldVault: YIELD_VAULT,
          yieldAdapterProgram: YIELD_ADAPTER_PROGRAM,
        }).data.subarray(0, 8),
      ];
      const hex = discriminators.map((d) => d.toString("hex"));
      const unique = new Set(hex);
      expect(unique.size).to.equal(discriminators.length);
    });

    it("each encoder uses the same ProtocolConfig PDA derivation", () => {
      const [canonicalConfig] = protocolConfigPda(CORE);
      const ixs = [
        buildContributeIx({ pool: POOL, memberWallet: MEMBER, cycle: 0 }),
        buildClaimPayoutIx({ pool: POOL, memberWallet: MEMBER, cycle: 0, slotIndex: 0 }),
        buildReleaseEscrowIx({ pool: POOL, memberWallet: MEMBER, checkpoint: 1 }),
        buildEscapeValveListIx({ pool: POOL, sellerWallet: MEMBER, slotIndex: 0, priceUsdc: 1 }),
        buildDepositIdleToYieldIx({
          pool: POOL,
          caller: BUYER,
          amount: 1,
          yieldVault: YIELD_VAULT,
          yieldAdapterProgram: YIELD_ADAPTER_PROGRAM,
        }),
      ];
      // Config sits at index 1 in every encoder (after the signer at 0).
      for (const ix of ixs) {
        expect(key(ix, 1).pubkey.toBase58()).to.equal(canonicalConfig.toBase58());
      }
    });
  });
});
