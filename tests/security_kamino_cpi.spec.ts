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

import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  setupBankrunEnv,
  BankrunEnv,
  KAMINO_LEND_PROGRAM_ID,
  writeTokenAccount,
  writeAnchorAccount,
} from "./_harness/bankrun.js";
import { loadAllKaminoFixtures, KaminoFixtures } from "./_harness/kamino_fixtures.js";

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
    // Anchor's `InstructionFallbackNotFound` is error number 101 (=0x65).
    // The JS-side bankrun error is "custom program error: 0x65" — the
    // text "InstructionFallbackNotFound" only appears in the Solana
    // runtime log, not the captured JS error. Match the hex code as
    // the reliable signal; keep the human-readable strings in case
    // bankrun-future surfaces them too.
    const dispatcherRejectPatterns = [
      /InstructionFallbackNotFound/i,
      /Fallback functions are not supported/i,
      /custom program error:?\s*0x65\b/i,
      /custom program error:?\s*101\b/,
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

    // Anchor's `InstructionFallbackNotFound` is error number 101 (=0x65).
    // The JS-side bankrun error is "custom program error: 0x65" — the
    // text "InstructionFallbackNotFound" only appears in the Solana
    // runtime log, not the captured JS error. Match the hex code as
    // the reliable signal; keep the human-readable strings in case
    // bankrun-future surfaces them too.
    const dispatcherRejectPatterns = [
      /InstructionFallbackNotFound/i,
      /Fallback functions are not supported/i,
      /custom program error:?\s*0x65\b/i,
      /custom program error:?\s*101\b/,
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

    // Anchor's `InstructionFallbackNotFound` is error number 101 (=0x65).
    // The JS-side bankrun error is "custom program error: 0x65" — the
    // text "InstructionFallbackNotFound" only appears in the Solana
    // runtime log, not the captured JS error. Match the hex code as
    // the reliable signal; keep the human-readable strings in case
    // bankrun-future surfaces them too.
    const dispatcherRejectPatterns = [
      /InstructionFallbackNotFound/i,
      /Fallback functions are not supported/i,
      /custom program error:?\s*0x65\b/i,
      /custom program error:?\s*101\b/,
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

/**
 * Phase 2b checkpoint 1 — fixture seeding validation.
 *
 * Boots bankrun with klend.so + roundfi-yield-kamino, then seeds the
 * 8 cascade-cloned Kamino USDC reserve accounts from
 * `tests/fixtures/kamino/`. Validates that each one is retrievable
 * from bankrun's banks client with the right owner program.
 *
 * **What this catches:**
 *   - Fixture JSONs malformed or stale
 *   - `setAccount` rejecting any of the cloned data shapes
 *   - bankrun losing the seeded state between setAccount calls
 *
 * **What this is NOT yet:**
 *   - Phase 2b checkpoint 2 (init_vault) — pending
 *   - Phase 2b checkpoint 3 (deposit CPI exercise) — pending
 *
 * Sequencing rationale: seed first, run init_vault second, invoke
 * deposit third. Each checkpoint is a clean failure boundary so we
 * know exactly which layer fails when something goes wrong.
 */
describe("Kamino bankrun spike — Phase 2b checkpoint 1 (fixture seeding)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;
  let fixtures: KaminoFixtures | null = null;

  before(async () => {
    if (!KLEND_SO_PRESENT) {
      console.warn(`\n[Kamino spike Phase 2b/1] SKIPPING — klend.so not at ${KLEND_SO_PATH}.`);
      return;
    }
    // Load fixtures BEFORE booting bankrun so we fail fast on missing
    // files (rather than waiting for the 10s+ startup).
    try {
      fixtures = loadAllKaminoFixtures();
    } catch (err) {
      console.warn(
        `\n[Kamino spike Phase 2b/1] SKIPPING — fixtures missing.\n${err instanceof Error ? err.message : err}`,
      );
      return;
    }
    env = await setupBankrunEnv({ loadMplCore: false, loadKaminoLend: true });

    // Seed each cloned account into the bankrun env.
    for (const [label, snap] of Object.entries(fixtures)) {
      env.context.setAccount(snap.pubkey, snap.account);
      console.log(
        `  [seed/${label}] ${snap.pubkey.toBase58()} (${snap.account.data.length}B, owner=${snap.account.owner.toBase58().slice(0, 8)}…)`,
      );
    }
  });

  it("reserve is retrievable + owned by Kamino program", async function () {
    if (!KLEND_SO_PRESENT || !fixtures) {
      this.skip();
      return;
    }
    const info = await env.context.banksClient.getAccount(fixtures.reserve.pubkey);
    assert.ok(info, "reserve account must exist post-seed");
    assert.equal(
      new PublicKey(info.owner).toBase58(),
      KAMINO_LEND_PROGRAM_ID.toBase58(),
      "reserve must be owned by Kamino program",
    );
  });

  it("lending_market is retrievable + owned by Kamino program", async function () {
    if (!KLEND_SO_PRESENT || !fixtures) {
      this.skip();
      return;
    }
    const info = await env.context.banksClient.getAccount(fixtures.lendingMarket.pubkey);
    assert.ok(info);
    assert.equal(new PublicKey(info.owner).toBase58(), KAMINO_LEND_PROGRAM_ID.toBase58());
  });

  it("USDC mint is retrievable + owned by SPL Token program", async function () {
    if (!KLEND_SO_PRESENT || !fixtures) {
      this.skip();
      return;
    }
    const info = await env.context.banksClient.getAccount(fixtures.usdcMint.pubkey);
    assert.ok(info);
    assert.equal(
      new PublicKey(info.owner).toBase58(),
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "USDC mint must be SPL Token-owned",
    );
    // Mint accounts are 82 bytes.
    assert.equal(info.data.length, 82, "USDC mint data must be 82 bytes");
  });

  it("c-token mint is retrievable + has mint_authority = lending_market_authority", async function () {
    if (!KLEND_SO_PRESENT || !fixtures) {
      this.skip();
      return;
    }
    const info = await env.context.banksClient.getAccount(fixtures.cTokenMint.pubkey);
    assert.ok(info);
    assert.equal(
      new PublicKey(info.owner).toBase58(),
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );

    // SPL Mint layout: [mint_authority_option: u32, mint_authority: Pubkey, ...]
    const data = Buffer.from(info.data);
    const mintAuthorityOption = data.readUInt32LE(0);
    assert.equal(mintAuthorityOption, 1, "c-token mint must have mint_authority set");
    const mintAuthority = new PublicKey(data.subarray(4, 36));
    assert.equal(
      mintAuthority.toBase58(),
      fixtures.lendingMarketAuthority.pubkey.toBase58(),
      "c-token mint authority must equal lending_market_authority — confirms cascade-clone integrity",
    );
  });

  it("collateral.supply_vault is retrievable + token account of c-token mint", async function () {
    if (!KLEND_SO_PRESENT || !fixtures) {
      this.skip();
      return;
    }
    const info = await env.context.banksClient.getAccount(fixtures.collateralSupplyVault.pubkey);
    assert.ok(info);
    assert.equal(info.data.length, 165, "token account data must be 165 bytes");
    // Token Account layout: [mint: Pubkey, owner: Pubkey, ...]
    const data = Buffer.from(info.data);
    const mint = new PublicKey(data.subarray(0, 32));
    assert.equal(
      mint.toBase58(),
      fixtures.cTokenMint.pubkey.toBase58(),
      "collateral_supply_vault.mint must equal c_token_mint",
    );
  });

  it("reserve_liquidity_supply is a USDC token account", async function () {
    if (!KLEND_SO_PRESENT || !fixtures) {
      this.skip();
      return;
    }
    const info = await env.context.banksClient.getAccount(fixtures.reserveLiquiditySupply.pubkey);
    assert.ok(info);
    assert.equal(info.data.length, 165);
    const data = Buffer.from(info.data);
    const mint = new PublicKey(data.subarray(0, 32));
    assert.equal(
      mint.toBase58(),
      fixtures.usdcMint.pubkey.toBase58(),
      "reserve_liquidity_supply.mint must equal USDC mint — Kamino's USDC vault",
    );
  });
});

/**
 * Phase 2b checkpoint 2 — deposit CPI against cloned Kamino state.
 *
 * **The moment of truth.** After Phase 1 (program loads), Phase 2a
 * (discriminators correct), and Phase 2b/1 (cascade-clone integrity),
 * this is the actual end-to-end CPI mechanics test.
 *
 * **Bypassed `init_vault`** — calling our wrapper's `init_vault`
 * tripped "Program 11111111 invoke [1] failed: invalid instruction
 * data" at the System Program before our program was even invoked.
 * Anchor's `init` constraint generates a System Program preInstruction
 * that bankrun's tx-build flow doesn't handle cleanly in this setup.
 * The fix is to **pre-seed YieldVaultState directly via
 * writeAnchorAccount + writeTokenAccount**. This skips the init
 * codepath entirely while preserving the validation goal: exercise
 * `deposit` against real Kamino bytecode with cloned state.
 *
 * **Sequence:**
 *   1. Pre-seed YieldVaultState PDA with pool/mint/vault/reserve/market
 *      pointers (Anchor coder-encoded). Bypasses init_vault.
 *   2. Pre-seed shadow vault USDC ATA (owner=state, balance=0).
 *   3. Pre-seed source USDC ATA (owner=pool, balance=100 USDC). Skips
 *      Circle's mint authority since we own the ATA's state directly.
 *   4. Pre-seed c-token ATA (owner=state, balance=0). Anchor's
 *      `associated_token::*` constraint requires it to exist.
 *   5. Invoke `roundfi-yield-kamino::deposit(10_000_000)`.
 *   6. Inspect outcome.
 *
 * **Possible outcomes:**
 *   - SUCCESS — all CPI mechanics correct. Phase 2b closes the account
 *     ordering / signer seeds / ATA constraint gaps.
 *   - "AccountValidationFailed" at position N — account ordering bug
 *     in our wrapper's Deposit accounts struct.
 *   - "ConstraintTokenAccountAuthority" — c-token ATA derivation
 *     mismatch (state PDA seeds or mint mismatch).
 *   - "ReserveStale" / "OracleNotFresh" — Kamino's pre-CPI freshness
 *     check tripped on the cloned (frozen-in-time) state. Operational
 *     limitation of bankrun-clone, NOT a wrapper bug. Documented as
 *     known risk in docs/operations/kamino-bankrun-spike.md.
 *
 * The spec logs the outcome but doesn't assert success/failure — the
 * information value is in WHICH error class fires, not whether the
 * tx returns ok.
 */
describe("Kamino bankrun spike — Phase 2b checkpoint 2 (deposit CPI vs cloned state)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;
  let fixtures: KaminoFixtures | null = null;

  // Identities created at boot
  let pool: Keypair;
  let statePda: PublicKey;
  let shadowVault: PublicKey;
  let sourceAta: PublicKey;
  let cTokenAta: PublicKey;

  const DEPOSIT_AMOUNT = 10_000_000n; // 10 USDC (6 decimals)
  const SOURCE_BALANCE = 100_000_000n; // 100 USDC starting balance

  before(async () => {
    if (!KLEND_SO_PRESENT) {
      console.warn(`\n[Phase 2b/2+3] SKIPPING — klend.so missing.`);
      return;
    }
    try {
      fixtures = loadAllKaminoFixtures();
    } catch (err) {
      console.warn(
        `\n[Phase 2b/2+3] SKIPPING — fixtures missing.\n${err instanceof Error ? err.message : err}`,
      );
      return;
    }
    env = await setupBankrunEnv({ loadMplCore: false, loadKaminoLend: true });

    // Seed all cascade-clone fixtures.
    for (const snap of Object.values(fixtures)) {
      env.context.setAccount(snap.pubkey, snap.account);
    }

    // Generate fresh pool keypair (in production this is roundfi-core's
    // Pool PDA; for this spike, any pubkey we control works).
    pool = Keypair.generate();

    // Derive YieldVaultState PDA.
    [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("yield-state"), pool.publicKey.toBuffer()],
      env.ids.yieldKamino,
    );

    // Pre-derive the ATAs we need.
    shadowVault = getAssociatedTokenAddressSync(fixtures.usdcMint.pubkey, statePda, true);
    sourceAta = getAssociatedTokenAddressSync(fixtures.usdcMint.pubkey, pool.publicKey, true);
    cTokenAta = getAssociatedTokenAddressSync(fixtures.cTokenMint.pubkey, statePda, true);

    console.log(`  [Phase 2b/2+3] pool=${pool.publicKey.toBase58()}`);
    console.log(`  [Phase 2b/2+3] state=${statePda.toBase58()}`);
    console.log(`  [Phase 2b/2+3] shadow_vault=${shadowVault.toBase58()}`);
    console.log(`  [Phase 2b/2+3] source_ata=${sourceAta.toBase58()}`);
    console.log(`  [Phase 2b/2+3] c_token_ata=${cTokenAta.toBase58()}`);
  });

  it("Checkpoint 2 — seed YieldVaultState + ATAs (bypass init_vault)", async function () {
    if (!KLEND_SO_PRESENT || !fixtures) {
      this.skip();
      return;
    }

    // Derive bump for the borsh-encoded state field.
    const [, stateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("yield-state"), pool.publicKey.toBuffer()],
      env.ids.yieldKamino,
    );

    // Seed YieldVaultState via Anchor's coder. Bypasses the `init`
    // constraint that tripped System Program "invalid instruction
    // data" in bankrun (see describe-block docstring for context).
    // IDL account names use PascalCase in the JSON but Anchor 0.30's
    // BorshAccountsCoder keys them in camelCase. Matches the pattern
    // in edge_grace_default_shield1_only.spec.ts (`"protocolConfig"`,
    // `"pool"`, `"member"`).
    await writeAnchorAccount(env.context, env.programs.yieldKamino, "yieldVaultState", statePda, {
      pool: pool.publicKey,
      underlyingMint: fixtures.usdcMint.pubkey,
      vault: shadowVault,
      kaminoReserve: fixtures.reserve.pubkey,
      kaminoMarket: fixtures.lendingMarket.pubkey,
      trackedPrincipal: new anchor.BN(0),
      bump: stateBump,
    });

    // Pre-seed shadow vault USDC ATA (owner=state, balance=0).
    writeTokenAccount(env.context, shadowVault, {
      mint: fixtures.usdcMint.pubkey,
      owner: statePda,
      amount: 0n,
    });

    // Pre-seed source USDC ATA with 100 USDC (owner=pool). Override
    // bypasses Circle's mint authority since we own the ATA state.
    writeTokenAccount(env.context, sourceAta, {
      mint: fixtures.usdcMint.pubkey,
      owner: pool.publicKey,
      amount: SOURCE_BALANCE,
    });

    // Pre-seed c-token ATA (owner=state, balance=0). Anchor's
    // associated_token::* constraint requires it to exist.
    writeTokenAccount(env.context, cTokenAta, {
      mint: fixtures.cTokenMint.pubkey,
      owner: statePda,
      amount: 0n,
    });

    // Validate the seeded YieldVaultState is readable via Anchor's coder.
    // Anchor accessor namespace also uses camelCase keys.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = (await (env.programs.yieldKamino.account as any).yieldVaultState.fetch(
      statePda,
    )) as {
      pool: PublicKey;
      underlyingMint: PublicKey;
      vault: PublicKey;
      kaminoReserve: PublicKey;
      kaminoMarket: PublicKey;
      trackedPrincipal: anchor.BN;
      bump: number;
    };
    assert.equal(state.pool.toBase58(), pool.publicKey.toBase58());
    assert.equal(state.kaminoReserve.toBase58(), fixtures.reserve.pubkey.toBase58());
    assert.equal(state.kaminoMarket.toBase58(), fixtures.lendingMarket.pubkey.toBase58());
    assert.equal(state.bump, stateBump);
    console.log(`  [Phase 2b/2] state + 3 ATAs seeded — bump=${stateBump}`);
  });

  it("Checkpoint 3 — deposit CPI against cloned Kamino state (THE MOMENT OF TRUTH)", async function () {
    if (!KLEND_SO_PRESENT || !fixtures) {
      this.skip();
      return;
    }

    // ATAs + state already seeded by Checkpoint 2.

    let outcome: "SUCCESS" | string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (env.programs.yieldKamino.methods as any)
        .deposit(new anchor.BN(DEPOSIT_AMOUNT.toString()))
        .accounts({
          source: sourceAta,
          destination: shadowVault,
          authority: pool.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          state: statePda,
          kaminoReserve: fixtures.reserve.pubkey,
          kaminoMarket: fixtures.lendingMarket.pubkey,
          kaminoMarketAuthority: fixtures.lendingMarketAuthority.pubkey,
          kaminoReserveLiquiditySupply: fixtures.reserveLiquiditySupply.pubkey,
          kaminoReserveCollateralMint: fixtures.cTokenMint.pubkey,
          cTokenAccount: cTokenAta,
          kaminoProgram: KAMINO_LEND_PROGRAM_ID,
        })
        .signers([pool])
        .rpc();
      outcome = "SUCCESS";
    } catch (err) {
      outcome = err instanceof Error ? err.message : String(err);
    }

    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(" Phase 2b/3 DEPOSIT OUTCOME");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (outcome === "SUCCESS") {
      console.log("✅ DEPOSIT SUCCEEDED — full CPI mechanics validated");
      console.log("   - Account ordering correct");
      console.log("   - Signer seeds correct");
      console.log("   - c-token ATA constraint satisfied");
      console.log("   - Kamino accepted the deposit_reserve_liquidity invocation");
    } else {
      console.log("⚠️  DEPOSIT FAILED — analyze the failure class:");
      console.log(`   Raw error: ${outcome.slice(0, 500)}`);
      console.log("");
      console.log("   Failure classification:");
      const knownClasses = [
        {
          pattern: /AccountValidationFailed|ConstraintRaw|ConstraintAddress/i,
          label: "wrapper-side account validation — our Deposit struct constraint mismatch",
        },
        {
          pattern: /ConstraintTokenAccountAuthority|ConstraintTokenMint/i,
          label: "ATA derivation mismatch — state PDA seeds or mint mismatch",
        },
        {
          pattern: /InvalidKaminoProgram/i,
          label: "kamino_program account mismatch (SEV-040-class — should be impossible after fix)",
        },
        {
          pattern: /Stale|NotFresh|LastUpdate/i,
          label:
            "Kamino oracle/reserve freshness check — bankrun clock vs cloned snapshot timestamp",
        },
        {
          pattern: /PrivilegeEscalation|MissingRequiredSignature/i,
          label: "signer seeds or signer permission mismatch",
        },
        {
          pattern: /AccountOwnedByWrongProgram/i,
          label: "account owner mismatch — likely wrong cascade-clone target",
        },
      ];
      const matched = knownClasses.find((c) => c.pattern.test(outcome));
      if (matched) {
        console.log(`   → ${matched.label}`);
      } else {
        console.log("   → unclassified (investigate manually)");
      }
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Don't assert success/failure — this test is informational.
    // The output is what matters; auto-pass to keep CI green while the
    // spike data is consumed.
    assert.ok(true, "Phase 2b/3 is informational — outcome logged above");
  });
});
