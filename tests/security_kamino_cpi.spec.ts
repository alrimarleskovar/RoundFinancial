/**
 * Kamino bankrun-clone spike — Phase 1.
 *
 * Validates the foundation layer of the Kamino CPI mechanics gap that
 * SEV-040 partially closed (program ID typo). This phase only proves
 * the bankrun environment can load klend.so without rejection — the
 * SEV-012 / mpl_core upstream-compat failure mode in reverse.
 *
 * **What this spec validates (Phase 1):**
 *   - klend.so loads into bankrun without "unsupported program" errors
 *   - The program is accessible at KAMINO_LEND_PROGRAM_ID
 *   - Executable bit is set (it's a program, not a data account)
 *
 * **What this spec does NOT validate (Phase 2 — separate PR):**
 *   - Discriminator sha256("global:deposit_reserve_liquidity")[..8]
 *     matches what Kamino's bytecode actually decodes
 *   - Account ordering for deposit/redeem CPIs matches Kamino's
 *     interface
 *   - `c_token_account` ATA constraint works when c-tokens are minted
 *     by Kamino
 *   - Full deposit → harvest → redeem round-trip succeeds
 *
 * Phase 2 requires cascade-cloning Kamino's reserve PDA + nested
 * dependencies (collateral mint, liquidity supply ATA, Scope oracle
 * accounts). See docs/operations/kamino-bankrun-spike.md for the
 * accounts-to-clone inventory.
 *
 * **Pre-flight:** download klend.so from mainnet:
 *
 *   solana program dump -u mainnet-beta \
 *     KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD \
 *     target/deploy/klend.so
 *
 * Without the .so, the loader prints a warning and the program isn't
 * registered. The first assertion below fails with a clear pointer to
 * this command.
 *
 * **History:** scaffolded as part of the post-SEV-040 follow-up
 * (May 2026). SEV-040 fixed the typo'd program ID constant; this
 * spec is the first concrete check that anyone EVER attempts to load
 * Kamino's program into the test harness, proving the mechanics
 * layer is testable in principle.
 */

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, before } from "mocha";

import {
  AccountMeta,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";

import { setupBankrunEnv, BankrunEnv, KAMINO_LEND_PROGRAM_ID } from "./_harness/bankrun.js";

/**
 * Mirror of `kamino_deposit_disc()` / `kamino_redeem_disc()` from
 * `programs/roundfi-yield-kamino/src/lib.rs`. Same input, same algorithm
 * — Node's createHash gives bit-identical output to Rust's
 * `solana_program::hash::hash`. Used by Step 2a below to send a tx with
 * exactly the discriminator our wrapper computes and observe whether
 * Kamino's program decodes it as a known instruction.
 */
function anchorDisc(ixName: string): Buffer {
  const h = createHash("sha256").update(`global:${ixName}`).digest();
  return h.subarray(0, 8);
}

const KLEND_SO_PATH = resolve(process.cwd(), "target", "deploy", "klend.so");
const KLEND_SO_PRESENT = existsSync(KLEND_SO_PATH);

describe("Kamino bankrun spike — Phase 1 (program loading)", function () {
  // Bankrun setup is slow (10-15s); generous default per-test budget.
  this.timeout(60_000);

  let env: BankrunEnv;

  before(async () => {
    if (!KLEND_SO_PRESENT) {
      console.warn(
        `\n[Kamino spike] SKIPPING — klend.so not at ${KLEND_SO_PATH}.\n` +
          `Run this first:\n` +
          `  solana program dump -u mainnet-beta ${KAMINO_LEND_PROGRAM_ID.toBase58()} target/deploy/klend.so\n`,
      );
      return;
    }
    // Phase 1 doesn't CPI into Metaplex Core, so we opt out of
    // loading mpl_core.so. This sidesteps the SBFv2-arch incompatibility
    // (current mainnet mpl_core.so is SBFv2 / arch 0x107;
    // solana-program-test 1.18.0 only reads eBPF / SBFv1 / arch 0xf7).
    // See `BankrunSetupOptions.loadMplCore` docstring for the full
    // explanation.
    env = await setupBankrunEnv({ loadMplCore: false, loadKaminoLend: true });
  });

  it("klend.so is present at target/deploy/klend.so", function () {
    if (!KLEND_SO_PRESENT) {
      this.skip();
    }
    assert.ok(
      KLEND_SO_PRESENT,
      "klend.so must exist in target/deploy/ — see file header for the dump command",
    );
  });

  it("Kamino Lend program account is registered in bankrun", async function () {
    if (!KLEND_SO_PRESENT) {
      this.skip();
    }
    const info = await env.context.banksClient.getAccount(KAMINO_LEND_PROGRAM_ID);
    assert.ok(info, "Kamino Lend program account should be retrievable from bankrun");
  });

  it("Kamino Lend account is marked executable", async function () {
    if (!KLEND_SO_PRESENT) {
      this.skip();
    }
    const info = await env.context.banksClient.getAccount(KAMINO_LEND_PROGRAM_ID);
    assert.ok(info, "program account exists");
    assert.equal(
      info.executable,
      true,
      "Kamino Lend account must be executable — if false, bankrun loaded the .so as data, not as a program",
    );
  });

  it("KAMINO_LEND_PROGRAM_ID matches the post-SEV-040 canonical value", function () {
    // String-equality belt-and-suspenders alongside the cargo test in
    // programs/roundfi-yield-kamino/src/lib.rs (`kamino_lend_program_id_matches_canonical`).
    // Catches any divergence between the on-chain pinned constant and
    // the test harness pin.
    assert.equal(
      KAMINO_LEND_PROGRAM_ID.toBase58(),
      "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
      "harness-side KAMINO_LEND_PROGRAM_ID must match the on-chain pinned constant (canonical per Kamino-Finance/klend declare_id!)",
    );
  });
});

/**
 * Phase 2a — discriminator validation.
 *
 * The cheapest possible Phase 2 step: invoke Kamino's program with
 * exactly the discriminator bytes our `roundfi-yield-kamino` wrapper
 * computes (`kamino_deposit_disc()` / `kamino_redeem_disc()` — both
 * are `sha256("global:<ix_name>")[..8]`). The accounts list is
 * deliberately garbage — we expect the tx to fail; the question is
 * WHY.
 *
 * **What this catches:**
 *
 * If `kamino_deposit_disc()` produces bytes Kamino's dispatcher
 * recognizes (= our function string matches what Kamino's source uses
 * for `#[program] pub fn deposit_reserve_liquidity(...)`), Kamino's
 * code path enters the instruction handler and fails at account
 * validation (the FIRST `ctx.accounts.<field>` access against the
 * garbage account at that position). The expected error code is
 * something like `InvalidAccountData`, `AccountOwnedByWrongProgram`,
 * or `IllegalOwner` — i.e. an account-related error, not an
 * instruction-related one.
 *
 * If `kamino_deposit_disc()` produces bytes Kamino's dispatcher does
 * NOT recognize (= our string is wrong, e.g. `deposit_reserve` instead
 * of `deposit_reserve_liquidity`), Anchor returns
 * `InstructionFallbackNotFound` (`Custom(8002)`) or similar
 * dispatcher-level error before any account validation. That's the
 * signal that our discriminator string is wrong.
 *
 * **What this does NOT catch:**
 *
 * - Wrong account ORDERING (Step 2b — cascade-clone real reserve)
 * - Wrong signer seeds (Step 2b)
 * - Wrong c-token ATA derivation (Step 2b)
 * - SEV-040-class wrong program ID (already pinned by cargo test
 *   + Phase 1 harness pin)
 *
 * **Why this is cheap:** no cascade-cloning needed. We don't care if
 * the accounts are real — we care about the dispatcher's response
 * BEFORE account validation runs.
 */
describe("Kamino bankrun spike — Phase 2a (discriminator validation)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;
  const payer = Keypair.generate();

  before(async () => {
    if (!KLEND_SO_PRESENT) {
      console.warn(`\n[Kamino spike Phase 2a] SKIPPING — klend.so not at ${KLEND_SO_PATH}.`);
      return;
    }
    env = await setupBankrunEnv({ loadMplCore: false, loadKaminoLend: true });
    // Fund a throwaway signer so the tx has a valid fee payer.
    env.context.setAccount(payer.publicKey, {
      lamports: 1_000_000_000,
      data: new Uint8Array(0),
      owner: SystemProgram.programId,
      executable: false,
      rentEpoch: 0,
    });
  });

  /**
   * Send a raw tx with our wrapper's deposit discriminator + 16
   * fresh-keypair accounts (Kamino's `deposit_reserve_liquidity` takes
   * roughly that many; exact count doesn't matter because account
   * validation runs after dispatcher). Parse the bankrun error to
   * determine if the discriminator was DECODED (good — account error)
   * or REJECTED (bad — instruction-level error).
   */
  async function sendKaminoIxWithGarbageAccounts(disc: Buffer): Promise<string> {
    const garbageAccounts: AccountMeta[] = Array.from({ length: 16 }, () => ({
      pubkey: Keypair.generate().publicKey,
      isSigner: false,
      isWritable: true,
    }));

    // Append a u64 amount (8 bytes) — Kamino's deposit takes amount as
    // its sole positional arg. Value doesn't matter; we never reach the
    // handler logic.
    const data = Buffer.concat([disc, Buffer.alloc(8, 0x01)]);

    const ix = new TransactionInstruction({
      programId: KAMINO_LEND_PROGRAM_ID,
      keys: garbageAccounts,
      data,
    });

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
    tx.add(ix);
    tx.recentBlockhash = env.context.lastBlockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);

    try {
      await env.context.banksClient.processTransaction(tx);
      return "SUCCESS"; // impossible given garbage accounts
    } catch (err) {
      // bankrun wraps errors as Error.message containing the
      // underlying program error string.
      return err instanceof Error ? err.message : String(err);
    }
  }

  it("deposit_reserve_liquidity discriminator is RECOGNIZED by Kamino", async function () {
    if (!KLEND_SO_PRESENT) {
      this.skip();
    }
    const disc = anchorDisc("deposit_reserve_liquidity");
    const errMsg = await sendKaminoIxWithGarbageAccounts(disc);

    // If the discriminator was REJECTED at dispatcher level (wrong
    // ix name), the error includes "InstructionFallbackNotFound" or
    // "instruction not found" or "Fallback functions are not
    // supported" or "Custom: 8002". Any of those = our disc string is
    // wrong.
    const dispatcherRejectPatterns = [
      /InstructionFallbackNotFound/i,
      /instruction not found/i,
      /Fallback functions are not supported/i,
      /Custom.*8002/i,
    ];

    for (const pat of dispatcherRejectPatterns) {
      assert.ok(
        !pat.test(errMsg),
        `Kamino dispatcher REJECTED the discriminator from kamino_deposit_disc(): ${errMsg}\n` +
          `This means sha256("global:deposit_reserve_liquidity")[..8] does NOT match what ` +
          `Kamino's bytecode expects. Likely Kamino renamed the ix or uses non-Anchor encoding.`,
      );
    }

    // Sanity: we DID get an error (account validation failure expected).
    assert.notEqual(
      errMsg,
      "SUCCESS",
      "Tx with garbage accounts succeeded — impossible. Either Kamino is wide-open or test wrote a real-state tx.",
    );

    console.log(
      `[Phase 2a/deposit] disc=${disc.toString("hex")} accepted by Kamino, errored at account stage: ${errMsg.slice(0, 200)}`,
    );
  });

  it("redeem_reserve_collateral discriminator is RECOGNIZED by Kamino", async function () {
    if (!KLEND_SO_PRESENT) {
      this.skip();
    }
    const disc = anchorDisc("redeem_reserve_collateral");
    const errMsg = await sendKaminoIxWithGarbageAccounts(disc);

    const dispatcherRejectPatterns = [
      /InstructionFallbackNotFound/i,
      /instruction not found/i,
      /Fallback functions are not supported/i,
      /Custom.*8002/i,
    ];

    for (const pat of dispatcherRejectPatterns) {
      assert.ok(
        !pat.test(errMsg),
        `Kamino dispatcher REJECTED the discriminator from kamino_redeem_disc(): ${errMsg}\n` +
          `This means sha256("global:redeem_reserve_collateral")[..8] does NOT match what ` +
          `Kamino's bytecode expects.`,
      );
    }

    assert.notEqual(errMsg, "SUCCESS");

    console.log(
      `[Phase 2a/redeem] disc=${disc.toString("hex")} accepted by Kamino, errored at account stage: ${errMsg.slice(0, 200)}`,
    );
  });

  it("WRONG discriminator IS rejected (negative control)", async function () {
    if (!KLEND_SO_PRESENT) {
      this.skip();
    }
    // A deliberately-bogus discriminator computed from a name Kamino
    // doesn't have. This proves the dispatcher-rejection pattern
    // matching above isn't a false positive (i.e. it CAN detect the
    // failure mode we care about).
    const disc = anchorDisc("deposit_reserve_liquidity_typo");
    const errMsg = await sendKaminoIxWithGarbageAccounts(disc);

    const dispatcherRejectPatterns = [
      /InstructionFallbackNotFound/i,
      /instruction not found/i,
      /Fallback functions are not supported/i,
      /Custom.*8002/i,
    ];

    const matched = dispatcherRejectPatterns.some((pat) => pat.test(errMsg));
    assert.ok(
      matched,
      `Negative control failed — Kamino accepted a bogus discriminator. ` +
        `Error was: ${errMsg.slice(0, 300)}\n` +
        `Expected one of the dispatcher-reject patterns. If this fails, the patterns ` +
        `above are wrong and the positive tests' signal is unreliable.`,
    );

    console.log(`[Phase 2a/negative] wrong disc correctly rejected: ${errMsg.slice(0, 200)}`);
  });
});
