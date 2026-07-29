/**
 * ADR 0012 Phase 3 — lance livre (sealed free bid), litesvm E2E.
 *
 * A free bid seals an amount behind `sha256(amount ‖ salt ‖ bidder)` while
 * bidding is open, then opens it after the cycle deadline. The reveal PAYS
 * the bid as K whole installments through the normal `split_installment`
 * partition and adjudicates it with Phase 2's rule — atomically. So a free
 * bid *compiles down to* prepayment + embedded bid: it adds a sealed
 * envelope and NO new contemplation math.
 *
 * The property this spec exists to pin: **a losing bid costs nothing.**
 * Adjudication runs BEFORE any transfer, so `EmbeddedBidTooShallow` reverts
 * the whole transaction and the USDC never leaves the wallet. That is what
 * deletes the bid vault, the refund path and the settlement step from the
 * design — three surfaces that would otherwise hold other people's money.
 *
 * Matrix (mirrors docs/security/lance-contemplation.md §5):
 *   (i)    a sealed envelope leaks neither amount nor depth on chain;
 *   (ii)   revealing before the deadline is refused (`BidWindowClosed`);
 *   (iii)  committing after it is refused too — the windows are disjoint,
 *          and that disjunction IS the seal;
 *   (iv)   a wrong amount or salt cannot open the envelope
 *          (`BidCommitMismatch`);
 *   (v)    a valid reveal debits EXACTLY K × installment, credits K
 *          installments at once, and swaps the draw;
 *   (vi)   an EQUAL-depth sealed bid reverts and the loser's USDC balance
 *          is UNCHANGED — the load-bearing property;
 *   (vii)  a DEEPER sealed bid chains a second swap, and paying through to
 *          the last installment escalates the single attestation to
 *          POOL_COMPLETE;
 *   (viii) the envelope is single-use (`BidAlreadyRevealed`);
 *   (ix)   the winner claims and the pool completes with every member
 *          contemplated exactly once — the bijection survived two swaps.
 *
 * Harness mirrors litesvm_lance_embutido. Skips cleanly without artifacts.
 */

import { expect } from "chai";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

import { ATTESTATION_SCHEMA, ORDERING_POLICY, freeBidCommitHash } from "@roundfi/sdk";
import { attestationNonce, attestationPda, bidPda } from "@roundfi/sdk/pda";

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
import {
  configPda,
  escrowVaultAuthorityPda,
  reputationConfigPda,
  reputationProfilePda,
  solidarityVaultAuthorityPda,
} from "./_harness/pda.js";
import { setLitesvmUnixTs, setupLitesvmEnv, type LitesvmEnv } from "./_harness/litesvm.js";

// FOUR members: three seats with a FUTURE drawn cycle, so the matrix has a
// spare bidder to lose with (case vi). Three members would force the loser
// to be the natural cycle-0 recipient, who is rejected earlier and for a
// different reason (`EmbeddedBidUnavailable` — nothing to bring forward).
const MEMBERS_TARGET = 4;
const CYCLES_TOTAL = 4;
const CYCLE_DURATION_SEC = 86_400;
// Viability: 4 × 2000 × 0.74 = 5920 ≥ 2200 ✓ (same shape as the Phase 2 spec).
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

describe("ADR 0012 Phase 3 — lance livre (sealed free bid) (litesvm)", function () {
  this.timeout(180_000);

  let env: LitesvmEnv;
  let available = true;
  let usdcMint: PublicKey;

  const authority = Keypair.generate();
  const memberKps = memberKeypairs(MEMBERS_TARGET, "litesvm_lance_livre");

  let pool: PoolHandle;
  let members: MemberHandle[] = [];
  let drawPda: PublicKey;

  /** SPL token account: `amount` is a u64 LE at offset 64. */
  const usdcBalance = (owner: PublicKey): bigint => {
    const ata = getAssociatedTokenAddressSync(usdcMint, owner);
    const acct = env.svm.getAccount(ata);
    if (!acct) return 0n;
    return Buffer.from(acct.data).readBigUInt64LE(64);
  };

  const commit = (m: MemberHandle, cycle: number, hash: Buffer) => {
    // Same litesvm quirk the Phase 2 spec documents: the frozen blockhash
    // dedupes byte-identical transactions (even reverted ones), so rotate it.
    env.svm.expireBlockhash();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (env.programs.core.methods as any)
      .placeBidCommit({ cycle, commitHash: Array.from(hash) })
      .accounts({
        bidder: m.wallet.publicKey,
        config: configPda(env),
        pool: pool.pool,
        member: m.member,
        bid: bidPda(env.ids.core, pool.pool, cycle, m.wallet.publicKey)[0],
        systemProgram: SystemProgram.programId,
      })
      .signers([m.wallet])
      .rpc();
  };

  const reveal = (
    m: MemberHandle,
    cycle: number,
    amount: bigint,
    salt: bigint,
    /** Attestation nonce rides the LAST installment paid = contributions_paid + K − 1. */
    lastCyclePaid: number,
    isFinal = false,
  ) => {
    env.svm.expireBlockhash();
    const schemaId = isFinal ? ATTESTATION_SCHEMA.PoolComplete : ATTESTATION_SCHEMA.Payment;
    const [attestation] = attestationPda(
      env.ids.reputation,
      pool.pool,
      m.wallet.publicKey,
      schemaId,
      attestationNonce(lastCyclePaid, m.slotIndex),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (env.programs.core.methods as any)
      .placeBidReveal({ cycle, amount, salt })
      .accounts({
        bidder: m.wallet.publicKey,
        config: configPda(env),
        pool: pool.pool,
        member: m.member,
        bid: bidPda(env.ids.core, pool.pool, cycle, m.wallet.publicKey)[0],
        draw: drawPda,
        usdcMint: pool.usdcMint,
        bidderUsdc: m.memberUsdc,
        poolUsdcVault: pool.poolUsdcVault,
        solidarityVaultAuthority: solidarityVaultAuthorityPda(env.ids.core, pool.pool)[0],
        solidarityVault: pool.solidarityVault,
        escrowVaultAuthority: escrowVaultAuthorityPda(env.ids.core, pool.pool)[0],
        escrowVault: pool.escrowVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        reputationProgram: env.ids.reputation,
        reputationConfig: reputationConfigPda(env.ids.reputation)[0],
        reputationProfile: reputationProfilePda(env.ids.reputation, m.wallet.publicKey)[0],
        identityRecord: env.ids.reputation,
        attestation,
        systemProgram: SystemProgram.programId,
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

  /** Pay every installment the member still owes up to and including `through`. */
  const payUpTo = async (m: MemberHandle, through: number) => {
    for (;;) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = (await fetchMember(env, m.member)) as any;
      const next = num(rec.contributionsPaid);
      if (next > through || next >= CYCLES_TOTAL) return;
      await contribute(env, {
        pool,
        member: m,
        cycle: next,
        isFinalInstallment: next === CYCLES_TOTAL - 1,
      });
    }
  };

  before(async function () {
    for (const p of ARTIFACTS) {
      if (!existsSync(p)) {
        console.warn(`\n[litesvm] SKIPPING lance-livre spec — missing ${p}.`);
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
      console.warn(`\n[litesvm] SKIPPING lance-livre — setup failed: ${(e as Error)?.message}`);
      available = false;
    }
  });

  it("runs the full sealed free-bid matrix: seal, windows, pay, adjudicate, complete", async function () {
    if (!available) {
      this.skip();
      return;
    }
    try {
      // Everyone pays cycle 0 — all CURRENT (depth 0). Being current is the
      // ENTRY condition for bidding, not bid material (the `−1` in the metric).
      for (const m of members) {
        await contribute(env, { pool, member: m, cycle: 0 });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draw0 = (await fetchDraw(env, pool.pool)) as any;
      const order0 = Array.from(draw0.order as number[]).slice(0, MEMBERS_TARGET);
      const seatOf = (cycle: number) => order0.indexOf(cycle);
      const bySeat = (seat: number) => members.find((m) => m.slotIndex === seat)!;
      const holder0 = bySeat(seatOf(0)); // natural cycle-0 recipient
      const first = bySeat(seatOf(3)); // drawn LAST → the eager bidder
      const loser = bySeat(seatOf(2)); // will tie and lose
      const winner = bySeat(seatOf(1)); // will outbid everyone

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolPre = (await fetchPool(env, pool.pool)) as any;
      const deadline = BigInt(num(poolPre.nextCycleAt));

      // ─── Seal three envelopes while bidding is OPEN ───────────────────
      const saltFirst = 0xfeed_beef_1234_5678n;
      const amountFirst = INSTALLMENT; // 1 installment → depth 1
      const saltLoser = 0x1111_2222_3333_4444n;
      const amountLoser = INSTALLMENT; // also depth 1 → ties, loses
      const saltWinner = 0x0bad_cafe_9876_5432n;
      const amountWinner = INSTALLMENT * 3n; // → contributions 1→4 = cycles_total

      await commit(first, 0, freeBidCommitHash(amountFirst, saltFirst, first.wallet.publicKey));
      await commit(loser, 0, freeBidCommitHash(amountLoser, saltLoser, loser.wallet.publicKey));
      await commit(winner, 0, freeBidCommitHash(amountWinner, saltWinner, winner.wallet.publicKey));

      // (i) the chain holds a hash and nothing else.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sealed = (await (env.programs.core.account as any).bid.fetch(
        bidPda(env.ids.core, pool.pool, 0, winner.wallet.publicKey)[0],
      )) as any;
      expect(num(sealed.amount), "sealed envelope leaks no amount").to.equal(0);
      expect(num(sealed.parcels), "sealed envelope leaks no depth").to.equal(0);
      expect(num(sealed.state), "state = Committed").to.equal(0);

      // (ii) reveals are not open yet.
      await expectRevert(
        reveal(first, 0, amountFirst, saltFirst, 1),
        /BidWindowClosed/,
        "reveal before the deadline is refused",
      );

      // ─── Cross the deadline: bidding closes, revealing opens ──────────
      await setLitesvmUnixTs(env.svm, deadline + 60n);

      // (iii) nobody seals a new envelope now that they can start opening.
      await expectRevert(
        commit(holder0, 0, freeBidCommitHash(INSTALLMENT, 7n, holder0.wallet.publicKey)),
        /BidWindowClosed/,
        "commit after the deadline is refused — the seal is temporal",
      );

      // (iv) only the exact (amount, salt) opens an envelope.
      await expectRevert(
        reveal(first, 0, amountFirst, saltFirst + 1n, 1),
        /BidCommitMismatch/,
        "wrong salt cannot open the envelope",
      );
      await expectRevert(
        reveal(first, 0, amountFirst * 2n, saltFirst, 2),
        /BidCommitMismatch/,
        "wrong amount cannot open the envelope",
      );

      // ─── (v) a valid reveal pays K installments and swaps the draw ────
      const balFirstBefore = usdcBalance(first.wallet.publicKey);
      await reveal(first, 0, amountFirst, saltFirst, 1);
      expect(
        balFirstBefore - usdcBalance(first.wallet.publicKey),
        "debited EXACTLY the sealed bid",
      ).to.equal(amountFirst);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mFirst = (await fetchMember(env, first.member)) as any;
      expect(num(mFirst.contributionsPaid), "the bid credited its installment").to.equal(2);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draw1 = (await fetchDraw(env, pool.pool)) as any;
      const order1 = Array.from(draw1.order as number[]).slice(0, MEMBERS_TARGET);
      expect(order1[first.slotIndex], "winner took the current cycle").to.equal(0);
      expect(order1[holder0.slotIndex], "displaced seat inherited the winner's cycle").to.equal(3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pool1 = (await fetchPool(env, pool.pool)) as any;
      expect(num(pool1.currentBidDepth), "tracker records depth 1").to.equal(1);

      // ─── (vi) THE load-bearing case: losing costs nothing ─────────────
      // `loser` sealed the same depth, so it ties — and ties lose. The
      // adjudication runs BEFORE any transfer, so the revert must leave the
      // balance untouched. If this ever regresses, the design needs the bid
      // vault + refund path it was built to avoid.
      const balLoserBefore = usdcBalance(loser.wallet.publicKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mLoserBefore = (await fetchMember(env, loser.member)) as any;
      await expectRevert(
        reveal(loser, 0, amountLoser, saltLoser, 1),
        /EmbeddedBidTooShallow/,
        "an equal-depth sealed bid loses",
      );
      expect(
        usdcBalance(loser.wallet.publicKey),
        "a losing bid must not move a single lamport",
      ).to.equal(balLoserBefore);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mLoserAfter = (await fetchMember(env, loser.member)) as any;
      expect(
        num(mLoserAfter.contributionsPaid),
        "a losing bid must not credit installments either",
      ).to.equal(num(mLoserBefore.contributionsPaid));

      // ─── (vii) a DEEPER sealed bid chains a second swap ───────────────
      // 3 installments at once → contributions 1 → 4 == cycles_total, so the
      // SINGLE attestation escalates to POOL_COMPLETE.
      const balWinnerBefore = usdcBalance(winner.wallet.publicKey);
      await reveal(winner, 0, amountWinner, saltWinner, 3, true);
      expect(
        balWinnerBefore - usdcBalance(winner.wallet.publicKey),
        "debited exactly 3 installments in one transaction",
      ).to.equal(amountWinner);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mWinner = (await fetchMember(env, winner.member)) as any;
      expect(num(mWinner.contributionsPaid), "all three credited at once").to.equal(CYCLES_TOTAL);
      expect(
        num(mWinner.onTimeCount),
        "K future installments count as K punctual payments",
      ).to.equal(CYCLES_TOTAL);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draw2 = (await fetchDraw(env, pool.pool)) as any;
      const order2 = Array.from(draw2.order as number[]).slice(0, MEMBERS_TARGET);
      expect(order2[winner.slotIndex], "deeper bidder took the current cycle").to.equal(0);
      expect(order2[first.slotIndex], "outbid bidder fell back to the newcomer's cycle").to.equal(
        1,
      );
      expect([...order2].sort(), "order is STILL a permutation after two swaps").to.deep.equal([
        0, 1, 2, 3,
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pool2 = (await fetchPool(env, pool.pool)) as any;
      expect(num(pool2.currentBidDepth), "tracker records the deeper bid").to.equal(3);

      // ─── (viii) one reveal per envelope ───────────────────────────────
      await expectRevert(
        reveal(winner, 0, amountWinner, saltWinner, 3, true),
        /BidAlreadyRevealed/,
        "the envelope is single-use",
      );

      // ─── (ix) claim + run to completion; bijection intact ─────────────
      await claimPayout(env, { pool, member: winner, cycle: 0, drawResult: drawPda });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pool3 = (await fetchPool(env, pool.pool)) as any;
      expect(num(pool3.currentCycle), "cycle advanced").to.equal(1);
      expect(num(pool3.currentBidDepth), "advance resets the per-cycle tracker").to.equal(0);

      for (let cycle = 1; cycle < CYCLES_TOTAL; cycle++) {
        for (const m of members) {
          await payUpTo(m, cycle);
        }
        const recipient = members.find((m) => order2[m.slotIndex] === cycle)!;
        await claimPayout(env, { pool, member: recipient, cycle, drawResult: drawPda });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolEnd = (await fetchPool(env, pool.pool)) as any;
      expect(num(poolEnd.status), "pool completed").to.equal(2);
      for (const m of members) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rec = (await fetchMember(env, m.member)) as any;
        expect(rec.paidOut, `seat ${m.slotIndex} contemplated exactly once`).to.equal(true);
      }
    } catch (e) {
      const err = e as { logs?: string[]; message?: string };
      console.error("[litesvm lance-livre] failure logs:\n" + (err.logs ?? []).join("\n"));
      throw e;
    }
  });
});
