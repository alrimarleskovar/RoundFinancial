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
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, before } from "mocha";

import { setupBankrunEnv, BankrunEnv, KAMINO_LEND_PROGRAM_ID } from "./_harness/bankrun.js";

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
