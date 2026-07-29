/**
 * ADR 0012 Phase 2 — lance embutido (embedded bid), litesvm E2E.
 *
 * `place_embedded_bid` lets a sorteio-pool member who PREPAID installments
 * beyond the one currently due (Phase 1) take the CURRENT cycle by swapping
 * two entries of the pool's `DrawResult.order`. A swap of a bijection is a
 * bijection, so every member is still contemplated exactly once — the pool
 * runs to completion with zero changes to the payout instructions.
 *
 * Matrix (mirrors docs/security/lance-contemplation.md §4):
 *   (i)   a merely-CURRENT member (paid this cycle, nothing beyond) has no
 *         bid material → EmbeddedBidUnavailable (the −1 in the depth metric:
 *         contributions_paid == current_cycle + 1 is NOT a bid);
 *   (ii)  a prepaid member's first bid swaps the draw + sets the tracker;
 *   (iii) an equal-depth counter-bid loses (strictly-greater rule) →
 *         EmbeddedBidTooShallow;
 *   (iv)  a DEEPER counter-bid chains a second swap (previous bidder is
 *         displaced to the newcomer's old cycle);
 *   (v)   the winning bidder CLAIMS the current cycle end-to-end (the payout
 *         path reads the swapped truth) and the advance resets the tracker;
 *   (vi)  the pool completes with every member paid out exactly once —
 *         bijection preserved through two swaps;
 *   (vii) arrival-order pool → structurally impossible: its DrawResult PDA
 *         can never exist (finalize_draw requires sorteio), so account
 *         deserialization rejects with AccountNotInitialized before any
 *         constraint runs — the policy gate is belt-and-braces behind it.
 *
 * Harness mirrors litesvm_sorteio_draw: anchored clock, funded members,
 * finalizeDraw backstop after the joins. Skips cleanly without artifacts.
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

import { ORDERING_POLICY } from "@roundfi/sdk";

import {
  claimPayout,
  contribute,
  createPool,
  createUsdcMint,
  fetchDraw,
  fetchMember,
  fetchPool,
  finalizeDraw,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  memberKeypairs,
  usdc,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";
import { configPda } from "./_harness/pda.js";
import { setLitesvmUnixTs, setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

const MEMBERS_TARGET = 3;
const CYCLES_TOTAL = 3;
const CYCLE_DURATION_SEC = 86_400;
// Same viability-passing shape as litesvm_sorteio_draw:
// 3 × 2000 × 0.74 = 4440 ≥ 2200 ✓.
const INSTALLMENT = usdc(2_000n);
const CREDIT = usdc(2_200n);
const STAKE = (CREDIT * 5_000n) / 10_000n; // Lv1 = 50 %
const TOTAL_PER_MEMBER = BigInt(CYCLES_TOTAL) * INSTALLMENT + STAKE;

const BASE_TS = 1_900_000_000n;

const ARTIFACTS = [
  "target/idl/roundfi_core.json",
  "target/deploy/roundfi_core.so",
  "target/deploy/roundfi_reputation.so",
  "target/deploy/mpl_core.so",
].map((p) => resolve(process.cwd(), p));

function num(x: unknown): number {
  return Number((x as { toString(): string }).toString());
}

describe("ADR 0012 Phase 2 — lance embutido (embedded bid) (litesvm)", function () {
  this.timeout(180_000);

  let env: LitesvmEnv;
  let available = true;
  let usdcMint: PublicKey;

  const authority = Keypair.generate();
  const memberKps = memberKeypairs(MEMBERS_TARGET, "litesvm_lance_embutido");

  let pool: PoolHandle;
  let members: MemberHandle[] = [];
  let drawPda: PublicKey;

  const placeBid = (m: MemberHandle) => {
    // `place_embedded_bid` carries NO args, so two bids by the same member
    // build byte-identical transactions under litesvm's frozen blockhash and
    // the ledger dedupes the second as AlreadyProcessed (tx err 6) — even
    // when the first REVERTED (failed txs are still recorded). Rotate the
    // blockhash so every bid is a distinct transaction. (Same litesvm quirk
    // the pool_complete_cooldown spec documents for idempotent mintTo.)
    env.svm.expireBlockhash();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (env.programs.core.methods as any)
      .placeEmbeddedBid()
      .accounts({
        memberWallet: m.wallet.publicKey,
        config: configPda(env),
        pool: pool.pool,
        member: m.member,
        draw: drawPda,
      })
      .signers([m.wallet])
      .rpc();
  };

  const expectRevert = async (p: Promise<unknown>, pattern: RegExp, label: string) => {
    let threw = false;
    try {
      await p;
    } catch (e) {
      threw = true;
      const err = e as { logs?: string[]; message?: string };
      const haystack = [...(err.logs ?? []), err.message ?? "", String(e)].join("\n");
      expect(haystack).to.match(pattern, `${label} — got:\n${haystack}`);
    }
    expect(threw, `${label} must revert`).to.equal(true);
  };

  before(async function () {
    for (const p of ARTIFACTS) {
      if (!existsSync(p)) {
        console.warn(`\n[litesvm] SKIPPING lance-embutido spec — missing ${p}.`);
        available = false;
        return;
      }
    }
    try {
      env = await setupLitesvmEnv();
      await setLitesvmUnixTs(env.svm, BASE_TS);
      usdcMint = await createUsdcMint(env, { forceFresh: true });
      await initializeProtocol(env, { usdcMint });
      await initializeReputation(env, { coreProgram: env.ids.core });

      for (const kp of [authority, ...memberKps]) {
        env.svm.airdrop(kp.publicKey.toBase58(), 100_000_000_000n);
      }
      pool = await createPool(env, {
        authority,
        usdcMint,
        membersTarget: MEMBERS_TARGET,
        installmentAmount: INSTALLMENT,
        creditAmount: CREDIT,
        cyclesTotal: CYCLES_TOTAL,
        cycleDurationSec: CYCLE_DURATION_SEC,
        orderingPolicy: ORDERING_POLICY.Sorteio,
      });
      for (const kp of memberKps) {
        await fundUsdc(env, usdcMint, kp.publicKey, TOTAL_PER_MEMBER);
      }
      members = await joinMembers(
        env,
        pool,
        memberKps.map((kp) => ({ member: kp, reputationLevel: 1 })),
      );
      drawPda = await finalizeDraw(env, { pool });
    } catch (e) {
      console.warn(`\n[litesvm] SKIPPING lance-embutido — setup failed: ${(e as Error)?.message}`);
      available = false;
    }
  });

  it("runs the full embedded-bid matrix: gate, swap, outbid chain, claim, completion", async function () {
    if (!available) {
      this.skip();
      return;
    }
    try {
      // Everyone pays cycle 0 — all members are now CURRENT (ahead=1, depth=0).
      for (const m of members) {
        await contribute(env, { pool, member: m, cycle: 0 });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draw0 = (await fetchDraw(env, pool.pool)) as any;
      const order0 = Array.from(draw0.order as number[]).slice(0, MEMBERS_TARGET);
      // order[seat] == cycle. Cast by drawn cycle (all distinct — bijection).
      const seatOf = (cycle: number, order: number[]) => order.indexOf(cycle);
      const bySeat = (seat: number) => members.find((m) => m.slotIndex === seat)!;
      const wLast = bySeat(seatOf(2, order0)); // drawn LAST → natural bidder
      const wMid = bySeat(seatOf(1, order0)); // drawn middle → counter-bidder
      const holder0 = bySeat(seatOf(0, order0)); // natural cycle-0 recipient

      // (i) merely-current member: paid cycle 0, nothing beyond → no bid material.
      await expectRevert(
        placeBid(wLast),
        /EmbeddedBidUnavailable/,
        "current member (depth 0) cannot bid",
      );

      // (ii) wLast prepays cycle 1 (depth 1) and bids: draw entries swap.
      await contribute(env, { pool, member: wLast, cycle: 1 });
      await placeBid(wLast);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draw1 = (await fetchDraw(env, pool.pool)) as any;
      const order1 = Array.from(draw1.order as number[]).slice(0, MEMBERS_TARGET);
      expect(order1[wLast.slotIndex], "bidder took the current cycle").to.equal(0);
      expect(order1[holder0.slotIndex], "displaced seat inherited the bidder's cycle").to.equal(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolBid1 = (await fetchPool(env, pool.pool)) as any;
      expect(num(poolBid1.currentBidDepth), "tracker records depth 1").to.equal(1);

      // (iii) equal depth loses: wMid prepays cycle 1 (depth 1) and bids.
      await contribute(env, { pool, member: wMid, cycle: 1 });
      await expectRevert(
        placeBid(wMid),
        /EmbeddedBidTooShallow/,
        "equal-depth counter-bid rejected",
      );

      // (iv) deeper bid chains: wMid prepays cycle 2 (its FINAL installment →
      // POOL_COMPLETE schema) → depth 2, outbids wLast.
      await contribute(env, { pool, member: wMid, cycle: 2, isFinalInstallment: true });
      await placeBid(wMid);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draw2 = (await fetchDraw(env, pool.pool)) as any;
      const order2 = Array.from(draw2.order as number[]).slice(0, MEMBERS_TARGET);
      expect(order2[wMid.slotIndex], "deeper bidder took the current cycle").to.equal(0);
      expect(order2[wLast.slotIndex], "previous bidder displaced to newcomer's cycle").to.equal(1);
      // Bijection intact after two swaps.
      expect([...order2].sort(), "order is still a permutation of cycles").to.deep.equal([0, 1, 2]);

      // (v) the winner CLAIMS cycle 0 — payout path reads the swapped truth —
      // and the advance resets the per-cycle tracker.
      await claimPayout(env, { pool, member: wMid, cycle: 0, drawResult: drawPda });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolAfterClaim = (await fetchPool(env, pool.pool)) as any;
      expect(num(poolAfterClaim.currentCycle), "cycle advanced 0 → 1").to.equal(1);
      expect(num(poolAfterClaim.currentBidDepth), "tracker reset on advance").to.equal(0);

      // (vi) pool completes: cycle 1 → holder is wLast (displaced there);
      // cycle 2 → holder0. Everyone pays what remains, each claims once.
      await contribute(env, { pool, member: holder0, cycle: 1 });
      await claimPayout(env, { pool, member: wLast, cycle: 1, drawResult: drawPda });
      await contribute(env, { pool, member: holder0, cycle: 2, isFinalInstallment: true });
      await contribute(env, { pool, member: wLast, cycle: 2, isFinalInstallment: true });
      await claimPayout(env, { pool, member: holder0, cycle: 2, drawResult: drawPda });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolDone = (await fetchPool(env, pool.pool)) as any;
      expect(num(poolDone.status), "pool reaches Completed").to.equal(2);
      for (const m of members) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rec = (await fetchMember(env, m.member)) as any;
        expect(rec.paidOut, `seat ${m.slotIndex} contemplated exactly once`).to.equal(true);
      }
    } catch (e) {
      const logs = (e as { logs?: string[] }).logs;
      if (logs?.length) console.error("\n[litesvm] program logs:\n" + logs.join("\n"));
      throw e;
    }
  });

  it("(vii) arrival-order pool: bid structurally impossible — no DrawResult exists", async function () {
    if (!available) {
      this.skip();
      return;
    }
    try {
      env.svm.expireBlockhash();
      const authorityB = Keypair.generate();
      const kps = memberKeypairs(2, "litesvm_lance_arrival");
      for (const kp of [authorityB, ...kps]) {
        env.svm.airdrop(kp.publicKey.toBase58(), 100_000_000_000n);
      }
      const CREDIT_B = usdc(1_480n);
      const STAKE_B = (CREDIT_B * 5_000n) / 10_000n;
      const arrival = await createPool(env, {
        authority: authorityB,
        usdcMint,
        membersTarget: 2,
        installmentAmount: usdc(1_000n),
        creditAmount: CREDIT_B,
        cyclesTotal: 2,
        cycleDurationSec: CYCLE_DURATION_SEC,
      });
      for (const kp of kps) {
        await fundUsdc(env, usdcMint, kp.publicKey, 2n * usdc(1_000n) + STAKE_B);
      }
      const [mA] = await joinMembers(
        env,
        arrival,
        kps.map((kp) => ({ member: kp, reputationLevel: 1 })),
      );
      // Pay cycle 0 + prepay cycle 1 → real depth 1, so ONLY the policy gate
      // can be the reason for the revert.
      await contribute(env, { pool: arrival, member: mA!, cycle: 0 });
      await contribute(env, { pool: arrival, member: mA!, cycle: 1, isFinalInstallment: true });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bid = (env.programs.core.methods as any)
        .placeEmbeddedBid()
        .accounts({
          memberWallet: mA!.wallet.publicKey,
          config: configPda(env),
          pool: arrival.pool,
          member: mA!.member,
          // Canonical draw PDA for the arrival pool — which can NEVER exist
          // (finalize_draw requires sorteio), so Anchor's account
          // deserialization rejects the call with AccountNotInitialized
          // BEFORE any constraint runs. The pool's ordering-policy constraint
          // (EmbeddedBidUnavailable) is belt-and-braces BEHIND this
          // structural impossibility — an arrival pool is fail-closed against
          // bids at the account layer itself.
          draw: PublicKey.findProgramAddressSync(
            [Buffer.from("draw-result"), arrival.pool.toBuffer()],
            env.ids.core,
          )[0],
        })
        .signers([mA!.wallet])
        .rpc();
      await expectRevert(bid, /AccountNotInitialized/, "arrival-order pool cannot take bids");
    } catch (e) {
      const logs = (e as { logs?: string[] }).logs;
      if (logs?.length) console.error("\n[litesvm] program logs:\n" + logs.join("\n"));
      throw e;
    }
  });
});
