/**
 * edge — treasury rotation state machine (LEAD-006, Phase E, bankrun).
 *
 * LEAD-006 (Caio audit) found the treasury/authority/fee rotations are
 * deadlock-free by construction (permissionless `commit`, not blocked by lock or
 * pause), but the only shipped coverage was a single `TreasuryLocked` negative
 * (`security_audit_paths.spec.ts`). This pins the liveness-critical properties of
 * the canonical rotation (`propose → 7d timelock → anyone-commits`), which need
 * bankrun's setClock to cross the 7-day window.
 *
 * The pending rotation is seeded directly (config.pending_treasury +
 * pending_treasury_eta) — equivalent to a prior authority-signed
 * propose_new_treasury — so we can isolate the commit-side gates.
 *
 * Cases:
 *   A. commit before the eta → TreasuryTimelockActive (the timelock bites).
 *   B. commit exactly AT the eta, by a NON-authority signer → succeeds; treasury
 *      rotates, pending clears. Proves (i) the `>=` eta boundary and (ii) the
 *      permissionless-commit liveness: the rotation completes even if the
 *      authority key is offline.
 *   C. commit again with nothing pending → NoPendingTreasuryChange (single-shot).
 *   D. commit while the protocol is PAUSED → still succeeds. Proves a pause
 *      cannot trap an in-flight rotation (a key LEAD-006 deadlock-freedom point).
 */

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

import { protocolConfigPda } from "@roundfi/sdk";

import {
  setBankrunUnixTs,
  setupBankrunEnv,
  writeAnchorAccount,
  type BankrunEnv,
} from "./_harness/bankrun.js";

const ETA = 1_800_000_000n; // pending_treasury_eta — ~2027, safely future

describe("edge — treasury rotation state machine (LEAD-006, bankrun)", function () {
  this.timeout(60_000);

  let env: BankrunEnv;

  // authority is DISTINCT from the bankrun payer, so the payer that signs
  // `commit` below is a genuine non-authority caller (permissionless proof).
  const authority = Keypair.generate();
  const oldTreasury = Keypair.generate().publicKey;
  const newTreasury = Keypair.generate().publicKey;
  const metaplexCore = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
  const usdcMint = Keypair.generate().publicKey;

  let configPk: PublicKey;
  let configBump: number;

  async function seedConfig(pending: PublicKey, etaSecs: bigint, paused: boolean) {
    await writeAnchorAccount(env.context, env.programs.core, "protocolConfig", configPk, {
      authority: authority.publicKey,
      treasury: oldTreasury,
      usdcMint,
      metaplexCore,
      defaultYieldAdapter: env.ids.yieldMock,
      reputationProgram: PublicKey.default,
      feeBpsYield: 2_000,
      feeBpsCycleL1: 200,
      feeBpsCycleL2: 100,
      feeBpsCycleL3: 0,
      guaranteeFundBps: 15_000,
      paused,
      bump: configBump,
      pendingTreasury: pending,
      pendingTreasuryEta: new BN(etaSecs.toString()),
    });
  }

  before(async function () {
    env = await setupBankrunEnv();
    [configPk, configBump] = protocolConfigPda(env.ids.core);
    await seedConfig(newTreasury, ETA, false);
  });

  const commit = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.programs.core.methods as any)
      .commitNewTreasury()
      .accounts({ config: configPk, caller: env.payer.publicKey });

  async function fetchTreasuryState() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (env.programs.core.account as any).protocolConfig.fetch(configPk)) as {
      treasury: PublicKey;
      pendingTreasury: PublicKey;
      pendingTreasuryEta: BN;
    };
  }

  it("A. commit before the eta: rejects TreasuryTimelockActive", async function () {
    await setBankrunUnixTs(env.context, ETA - 1n);
    let threw = false;
    try {
      await commit().rpc();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(
        /TreasuryTimelockActive/,
        `expected TreasuryTimelockActive before eta, got:\n${haystack}`,
      );
    }
    expect(threw, "commit before the eta must reject").to.equal(true);
  });

  it("B. commit exactly at the eta by a non-authority: rotates treasury, clears pending", async function () {
    await setBankrunUnixTs(env.context, ETA); // clock == eta → the >= boundary
    await commit().rpc(); // signed by env.payer, which is NOT config.authority

    const cfg = await fetchTreasuryState();
    expect(cfg.treasury.toString(), "treasury rotated to the pending value").to.equal(
      newTreasury.toString(),
    );
    expect(cfg.pendingTreasury.toString(), "pending cleared").to.equal(
      PublicKey.default.toString(),
    );
    expect(BigInt(cfg.pendingTreasuryEta.toString()), "eta cleared").to.equal(0n);
  });

  it("C. commit again with nothing pending: rejects NoPendingTreasuryChange", async function () {
    let threw = false;
    try {
      await commit().rpc();
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(
        /NoPendingTreasuryChange/,
        `expected NoPendingTreasuryChange, got:\n${haystack}`,
      );
    }
    expect(threw, "committing with no pending proposal must reject").to.equal(true);
  });

  it("D. commit while PAUSED: still succeeds (a pause cannot trap a pending rotation)", async function () {
    await seedConfig(newTreasury, ETA, true); // re-arm the pending rotation, paused = true
    await setBankrunUnixTs(env.context, ETA + 100n);
    await commit().rpc();

    const cfg = await fetchTreasuryState();
    expect(cfg.treasury.toString(), "rotation completed despite pause").to.equal(
      newTreasury.toString(),
    );
    expect(cfg.pendingTreasury.toString(), "pending cleared under pause").to.equal(
      PublicKey.default.toString(),
    );
  });
});
