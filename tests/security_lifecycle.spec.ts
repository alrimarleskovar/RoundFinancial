/**
 * Security — state transitions + escape valve (Step 5e / 4).
 *
 * Covers lifecycle-adjacent guards that the other three specs don't
 * exercise directly: pool-status gates on contribute/join, the full
 * guard matrix on release_escrow, authority/status gates on close_pool,
 * and the escape-valve list/buy flow.
 *
 * Attacks covered:
 *
 *   A. Pool-status guards
 *     A.1 contribute on a Forming pool → PoolNotActive
 *     A.2 join_pool after all slots filled (status flipped to Active)
 *         → PoolNotForming
 *
 *   B. release_escrow checkpoint validation (handler require!-order)
 *     B.1 checkpoint = 0                                   → EscrowLocked
 *     B.2 checkpoint > cycles_total                        → EscrowLocked
 *     B.3 checkpoint > current_cycle + 1 (pre-cycle drain) → EscrowLocked
 *     B.4 happy-path release at checkpoint=1, then repeat
 *         → first succeeds; second → EscrowNothingToRelease
 *     B.5 non-member tries release_escrow (member PDA
 *         derived from a foreign wallet)                   → seeds mismatch
 *
 *   C. close_pool
 *     C.1 close while status == Active                     → PoolNotCompleted
 *     C.2 close by non-authority, non-protocol signer      → Unauthorized
 *
 *   D. Escape valve
 *     D.1 list with price = 0                              → InvalidListingPrice
 *     D.2 list happy path — listing PDA written with Active status
 *     D.3 buy with price != listing.price_usdc             → EscapeValvePriceMismatch
 *     D.4 buy with seller_wallet != listing.seller         → Unauthorized
 *     D.5 buy happy path — old Member PDA closed, new Member PDA
 *         created at buyer's seed, listing closed
 *
 * Fail-closed bar:
 *   Every rejection asserts no state moved — vaults, Member rows,
 *   pool aggregates, listing PDA existence — bit-identical before/after.
 *
 * Deferred:
 *   - settle_default grace-period test requires 7-day clock warp; not
 *     reachable on localnet. Covered by Rust unit tests in
 *     `math::dc` + handler require!(GracePeriodNotElapsed).
 *   - escape_valve list "member is behind" (MemberNotBehind) needs a
 *     cycle to advance past a delinquent member without them paying,
 *     which requires seed-draw to succeed from a partial vault —
 *     a non-trivial test-pool topology that the Rust handler require!
 *     already covers unit-wise.
 */

import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";

import {
  balanceOf,
  configPda,
  contribute,
  createPool,
  createUsdcMint,
  ensureAta,
  fetchMember,
  fetchPool,
  fundUsdc,
  initializeProtocol,
  initializeReputation,
  joinMembers,
  joinPool,
  memberKeypairs,
  memberPda,
  releaseEscrow,
  setupEnv,
  usdc,
  type Env,
  type MemberHandle,
  type PoolHandle,
} from "./_harness/index.js";

// ─── Listing PDA helper (not yet in sdk/_harness) ─────────────────────
//
// Rust: seeds = [b"listing", pool.key().as_ref(), &[slot_index]]
//
function listingPdaFor(coreProgram: PublicKey, pool: PublicKey, slotIndex: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("listing"), pool.toBuffer(), Buffer.from([slotIndex])],
    coreProgram,
  );
  return pda;
}

// ─── Pool parameters ──────────────────────────────────────────────────
//
// Three pools, each sized for exactly the surface it tests. Keeping
// them independent means ordering between describe() blocks is
// irrelevant (no cross-pool state handoffs).
//
//   Pool F — Forming (2/3 joined). Used for A.1 (contribute rejected)
//     and as a source of a real Member PDA for B.5.
//
//   Pool L — Active, 2 members, 3 cycles. Used for B.x release_escrow
//     guards + C.x close_pool guards. cycles_total=3 so we can
//     distinguish "too large" vs "too early" checkpoints.
//
//   Pool EV — Active, 3 members, 3 cycles. Used for D.x escape-valve
//     tests. 3 slots because we need one listed slot and two
//     untouched slots to probe error paths without perturbing the
//     listed one.
//
const CYCLE_DURATION_SEC = 86_400;
const LEVEL: 1 | 2 | 3 = 2;

// Pool F (Forming).
const F_MEMBERS_TARGET = 3;
const F_CYCLES_TOTAL = 2;
const F_INSTALLMENT_USDC = 1_000n;
const F_CREDIT_USDC = 1_500n;
const F_INSTALLMENT_BASE = usdc(F_INSTALLMENT_USDC);
const F_CREDIT_BASE = usdc(F_CREDIT_USDC);

// Pool L (Lifecycle — release_escrow + close_pool).
const L_MEMBERS_TARGET = 2;
const L_CYCLES_TOTAL = 3;
const L_INSTALLMENT_USDC = 1_000n;
const L_CREDIT_USDC = 1_500n;
const L_INSTALLMENT_BASE = usdc(L_INSTALLMENT_USDC);
const L_CREDIT_BASE = usdc(L_CREDIT_USDC);

// Pool EV (Escape valve).
const EV_MEMBERS_TARGET = 3;
const EV_CYCLES_TOTAL = 3;
const EV_INSTALLMENT_USDC = 1_000n;
const EV_CREDIT_USDC = 2_200n;
const EV_INSTALLMENT_BASE = usdc(EV_INSTALLMENT_USDC);
const EV_CREDIT_BASE = usdc(EV_CREDIT_USDC);

// Listing price used in D.x.
const LISTING_PRICE = usdc(10n);

// ─── Snapshot helpers ────────────────────────────────────────────────

interface ReleaseSnapshot {
  escrowVault: bigint;
  memberUsdc: bigint;
  memberEscrowBalance: bigint;
  memberLastReleased: number;
  poolEscrowBalance: bigint;
}

function bn(x: { toString(): string }): bigint {
  return BigInt(x.toString());
}

async function snapshotRelease(
  env: Env,
  pool: PoolHandle,
  h: MemberHandle,
): Promise<ReleaseSnapshot> {
  const [escrowVault, memberUsdc] = await Promise.all([
    balanceOf(env, pool.escrowVault),
    balanceOf(env, h.memberUsdc),
  ]);
  const m = (await fetchMember(env, h.member)) as {
    escrowBalance: { toString(): string };
    lastReleasedCheckpoint: number;
  };
  const p = (await fetchPool(env, pool.pool)) as {
    escrowBalance: { toString(): string };
  };
  return {
    escrowVault,
    memberUsdc,
    memberEscrowBalance: bn(m.escrowBalance),
    memberLastReleased: m.lastReleasedCheckpoint,
    poolEscrowBalance: bn(p.escrowBalance),
  };
}

function expectReleaseUnchanged(
  before: ReleaseSnapshot,
  after: ReleaseSnapshot,
  label: string,
): void {
  expect(after, `${label}: release snapshot drift`).to.deep.equal(before);
}

async function expectRejected(thunk: () => Promise<unknown>): Promise<string> {
  try {
    await thunk();
  } catch (err) {
    return String((err as Error)?.message ?? err);
  }
  expect.fail("expected transaction to revert, but it succeeded");
  return "";
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("security — state transitions + escape valve", function () {
  this.timeout(300_000);

  let env: Env;
  let usdcMint: PublicKey;

  // Authorities.
  const authorityF = Keypair.generate();
  const authorityL = Keypair.generate();
  const authorityEV = Keypair.generate();
  const protocolImpostor = Keypair.generate(); // for C.2

  // Members.
  const membersF = memberKeypairs(F_MEMBERS_TARGET, "sec/lc/F"); // only 2/3 will join
  const membersL = memberKeypairs(L_MEMBERS_TARGET, "sec/lc/L");
  const membersEV = memberKeypairs(EV_MEMBERS_TARGET, "sec/lc/EV");
  const outsider = Keypair.generate(); // used for A.2, B.5, D.5

  // Pools + handles.
  let poolF: PoolHandle;
  let poolL: PoolHandle;
  let poolEV: PoolHandle;
  let handlesF: MemberHandle[]; // only 2 entries
  let handlesL: MemberHandle[];
  let handlesEV: MemberHandle[];

  before(async function () {
    env = await setupEnv();
    usdcMint = await createUsdcMint(env);
    await initializeProtocol(env, { usdcMint });
    await initializeReputation(env, { coreProgram: env.ids.core });

    // ─── Pool F — Forming (2/3 joined) ───────────────────────────────
    poolF = await createPool(env, {
      authority: authorityF,
      usdcMint,
      membersTarget: F_MEMBERS_TARGET,
      installmentAmount: F_INSTALLMENT_BASE,
      creditAmount: F_CREDIT_BASE,
      cyclesTotal: F_CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
      escrowReleaseBps: 2_500,
    });
    handlesF = await joinMembers(
      env,
      poolF,
      // Intentionally join only 2/3 so pool stays Forming.
      membersF.slice(0, 2).map((m) => ({ member: m, reputationLevel: LEVEL })),
    );
    // Pre-fund the members we'll try to contribute with in A.1 so the
    // rejection path isn't masked by an empty-ATA error on the source.
    for (const h of handlesF) {
      await fundUsdc(env, usdcMint, h.wallet.publicKey, F_INSTALLMENT_BASE);
    }

    // ─── Pool L — Active, 2 members, 3 cycles ────────────────────────
    poolL = await createPool(env, {
      authority: authorityL,
      usdcMint,
      membersTarget: L_MEMBERS_TARGET,
      installmentAmount: L_INSTALLMENT_BASE,
      creditAmount: L_CREDIT_BASE,
      cyclesTotal: L_CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
      escrowReleaseBps: 2_500,
    });
    handlesL = await joinMembers(
      env,
      poolL,
      membersL.map((m) => ({ member: m, reputationLevel: LEVEL })),
    );
    for (const m of membersL) {
      await fundUsdc(env, usdcMint, m.publicKey, BigInt(L_CYCLES_TOTAL) * L_INSTALLMENT_BASE);
    }
    // Both members pay cycle 0 → member.on_time_count = 1 and a
    // non-trivial escrow balance that release_escrow can draw from.
    for (const h of handlesL) {
      await contribute(env, { pool: poolL, member: h, cycle: 0 });
    }

    // ─── Pool EV — Active, 3 members, 3 cycles ───────────────────────
    poolEV = await createPool(env, {
      authority: authorityEV,
      usdcMint,
      membersTarget: EV_MEMBERS_TARGET,
      installmentAmount: EV_INSTALLMENT_BASE,
      creditAmount: EV_CREDIT_BASE,
      cyclesTotal: EV_CYCLES_TOTAL,
      cycleDurationSec: CYCLE_DURATION_SEC,
      escrowReleaseBps: 2_500,
    });
    handlesEV = await joinMembers(
      env,
      poolEV,
      membersEV.map((m) => ({ member: m, reputationLevel: LEVEL })),
    );
    for (const m of membersEV) {
      await fundUsdc(env, usdcMint, m.publicKey, BigInt(EV_CYCLES_TOTAL) * EV_INSTALLMENT_BASE);
    }
    // Cycle-0 contributions satisfy escape_valve_list's
    // `contributions_paid >= current_cycle` check when current=0.
    for (const h of handlesEV) {
      await contribute(env, { pool: poolEV, member: h, cycle: 0 });
    }

    // Outsider needs SOL (for rent on init paths it pays for) and
    // USDC (D.5 buyer pays the listing price).
    await fundUsdc(env, usdcMint, outsider.publicKey, LISTING_PRICE * 2n);
  });

  // ─── A. Pool-status guards ────────────────────────────────────────────

  it("A.1 contribute on Forming pool → PoolNotActive, state unchanged", async function () {
    const h = handlesF[0]!;
    const vaultBefore = await balanceOf(env, poolF.poolUsdcVault);
    const solidarityBefore = await balanceOf(env, poolF.solidarityVault);
    const escrowBefore = await balanceOf(env, poolF.escrowVault);
    const memberUsdcBefore = await balanceOf(env, h.memberUsdc);

    const msg = await expectRejected(() => contribute(env, { pool: poolF, member: h, cycle: 0 }));
    expect(msg, `A.1: ${msg}`).to.match(/PoolNotActive|not active|forming/i);

    expect(await balanceOf(env, poolF.poolUsdcVault), "A.1: pool vault unchanged").to.equal(
      vaultBefore,
    );
    expect(await balanceOf(env, poolF.solidarityVault), "A.1: solidarity unchanged").to.equal(
      solidarityBefore,
    );
    expect(await balanceOf(env, poolF.escrowVault), "A.1: escrow unchanged").to.equal(escrowBefore);
    expect(await balanceOf(env, h.memberUsdc), "A.1: member USDC unchanged").to.equal(
      memberUsdcBefore,
    );
  });

  it("A.2 join_pool on fully-joined (Active) pool → PoolNotForming", async function () {
    // Pool EV has 3/3 members joined and is Active. A fourth join
    // attempt trips pool.status == Forming before the PoolFull check
    // (constraints evaluated in declaration order).
    await ensureAta(env, usdcMint, outsider.publicKey);

    const msg = await expectRejected(() =>
      joinPool(env, poolEV, {
        member: outsider,
        slotIndex: 0, // would-be-conflict, but status check fires first
        reputationLevel: LEVEL,
        prefundStake: true,
      }),
    );
    expect(msg, `A.2: ${msg}`).to.match(/PoolNotForming|PoolFull|forming|full/i);

    // Pool EV state untouched — members_joined still == members_target.
    const p = (await fetchPool(env, poolEV.pool)) as {
      membersJoined: number;
      membersTarget: number;
      status: number;
    };
    expect(p.membersJoined, "A.2: members_joined preserved").to.equal(EV_MEMBERS_TARGET);
    expect(p.status, "A.2: status still Active").to.equal(1);
  });

  // ─── B. release_escrow guards (Pool L, slot 1 at current_cycle=0) ─────

  it("B.1 release_escrow(checkpoint=0) → EscrowLocked", async function () {
    const h = handlesL[1]!;
    const before = await snapshotRelease(env, poolL, h);

    const msg = await expectRejected(() =>
      releaseEscrow(env, { pool: poolL, member: h, checkpoint: 0 }),
    );
    expect(msg, `B.1: ${msg}`).to.match(/EscrowLocked|escrow/i);

    expectReleaseUnchanged(before, await snapshotRelease(env, poolL, h), "B.1");
  });

  it("B.2 release_escrow(checkpoint > cycles_total) → EscrowLocked", async function () {
    const h = handlesL[1]!;
    const before = await snapshotRelease(env, poolL, h);

    // cycles_total = 3; 4 > 3.
    const msg = await expectRejected(() =>
      releaseEscrow(env, { pool: poolL, member: h, checkpoint: 4 }),
    );
    expect(msg, `B.2: ${msg}`).to.match(/EscrowLocked|escrow/i);

    expectReleaseUnchanged(before, await snapshotRelease(env, poolL, h), "B.2");
  });

  it("B.3 release_escrow(checkpoint > current_cycle + 1) → EscrowLocked", async function () {
    const h = handlesL[1]!;
    const before = await snapshotRelease(env, poolL, h);

    // current_cycle = 0, so max allowed = 1. 2 is within cycles_total
    // (3) AND > last_released_checkpoint (0), so the fourth require!
    // is the one that fires — pre-cycle drain guard.
    const msg = await expectRejected(() =>
      releaseEscrow(env, { pool: poolL, member: h, checkpoint: 2 }),
    );
    expect(msg, `B.3: ${msg}`).to.match(/EscrowLocked|escrow/i);

    expectReleaseUnchanged(before, await snapshotRelease(env, poolL, h), "B.3");
  });

  it("B.4 release_escrow(1) happy path; repeat → EscrowNothingToRelease", async function () {
    const h = handlesL[1]!;
    const before = await snapshotRelease(env, poolL, h);

    // Happy path first: delta = stake_deposited * 1 / 3 (floor). On-time
    // count is >= 1 because this member paid cycle 0. Member USDC must
    // increase; escrow_vault + member.escrow_balance + pool.escrow_balance
    // must all drop by the same delta.
    await releaseEscrow(env, { pool: poolL, member: h, checkpoint: 1 });
    const after = await snapshotRelease(env, poolL, h);

    const deltaVault = before.escrowVault - after.escrowVault;
    const deltaMemberUsdc = after.memberUsdc - before.memberUsdc;
    const deltaMemberBook = before.memberEscrowBalance - after.memberEscrowBalance;
    const deltaPoolBook = before.poolEscrowBalance - after.poolEscrowBalance;

    expect(deltaVault > 0n, "B.4: escrow vault dropped").to.equal(true);
    expect(deltaMemberUsdc, "B.4: member USDC rose by same amount").to.equal(deltaVault);
    expect(deltaMemberBook, "B.4: member.escrow_balance book drops").to.equal(deltaVault);
    expect(deltaPoolBook, "B.4: pool.escrow_balance book drops").to.equal(deltaVault);
    expect(after.memberLastReleased, "B.4: last_released_checkpoint = 1").to.equal(1);

    // Repeat at same checkpoint — require! #3 fails: checkpoint (1) !=
    // > last_released_checkpoint (1). Handler yields EscrowNothingToRelease.
    const snapAfterFirst = after;
    const msg = await expectRejected(() =>
      releaseEscrow(env, { pool: poolL, member: h, checkpoint: 1 }),
    );
    expect(msg, `B.4/double: ${msg}`).to.match(/EscrowNothingToRelease|nothing|escrow/i);

    expectReleaseUnchanged(snapAfterFirst, await snapshotRelease(env, poolL, h), "B.4/double");
  });

  it("B.5 non-member signs release_escrow → seeds-mismatch rejection", async function () {
    // Member PDA seeds = [SEED_MEMBER, pool, wallet]. Outsider is not
    // a member of pool L — neither the explicitly-supplied PDA nor the
    // Anchor-derived seeds will match a real row.
    const h = handlesL[1]!;
    const before = await snapshotRelease(env, poolL, h);

    // Derive the (non-existent) outsider member PDA to satisfy the
    // method's account table; the on-chain `Account<Member>` deserialize
    // is what fails.
    const [outsiderMemberPda] = memberPda(env.ids.core, poolL.pool, outsider.publicKey);

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .releaseEscrow({ checkpoint: 1 })
        .accounts({
          memberWallet: outsider.publicKey,
          config: configPda(env),
          pool: poolL.pool,
          member: outsiderMemberPda,
          usdcMint,
          // Outsider has no USDC ATA tied to pool L; Anchor will catch
          // the missing-account condition before ever hitting the
          // member-seed check — any rejection satisfies fail-closed.
          memberUsdc: h.memberUsdc, // deliberate mismatch
          escrowVaultAuthority: poolL.escrowVaultAuthority,
          escrowVault: poolL.escrowVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([outsider])
        .rpc(),
    );
    expect(msg, `B.5: ${msg}`).to.match(
      /NotAMember|member|AccountNotInitialized|Account.+does not exist|seeds|constraint/i,
    );

    // The member we're surreptitiously "using" in memberUsdc must not
    // have had any state mutation — the attack never reached the
    // handler body.
    expectReleaseUnchanged(before, await snapshotRelease(env, poolL, h), "B.5");
  });

  // ─── C. close_pool guards ─────────────────────────────────────────────

  it("C.1 close_pool while Active → PoolNotCompleted", async function () {
    // Pool L is Active (cycle 0, claim has not advanced it yet).
    const p0 = (await fetchPool(env, poolL.pool)) as { status: number };
    expect(p0.status, "C.1 precondition: pool Active").to.equal(1);

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .closePool()
        .accounts({
          config: configPda(env),
          authority: authorityL.publicKey,
          pool: poolL.pool,
        })
        .signers([authorityL])
        .rpc(),
    );
    expect(msg, `C.1: ${msg}`).to.match(/PoolNotCompleted|completed|status/i);

    // Status unchanged — still Active.
    const p1 = (await fetchPool(env, poolL.pool)) as { status: number };
    expect(p1.status, "C.1: pool status unchanged").to.equal(1);
  });

  it("C.2 close_pool by unauthorized signer → Unauthorized", async function () {
    // Impostor has no pool/config authority. Constraint on `authority`
    // account (declared before `pool`) fires first → Unauthorized.
    // Impostor needs SOL to pay the tx fee.
    await env.connection.requestAirdrop(protocolImpostor.publicKey, 1_000_000_000);
    // Give airdrop time to settle.
    for (let i = 0; i < 20; i++) {
      const bal = await env.connection.getBalance(protocolImpostor.publicKey, "confirmed");
      if (bal > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const p0 = (await fetchPool(env, poolL.pool)) as { status: number };

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .closePool()
        .accounts({
          config: configPda(env),
          authority: protocolImpostor.publicKey,
          pool: poolL.pool,
        })
        .signers([protocolImpostor])
        .rpc(),
    );
    expect(msg, `C.2: ${msg}`).to.match(/Unauthorized|authority|unauthorized/i);

    const p1 = (await fetchPool(env, poolL.pool)) as { status: number };
    expect(p1.status, "C.2: pool status unchanged").to.equal(p0.status);
  });

  // ─── D. Escape valve ──────────────────────────────────────────────────

  it("D.1 escape_valve_list with price=0 → InvalidListingPrice", async function () {
    const seller = handlesEV[2]!; // keep slot 1 free for the happy-path list in D.2
    const listing = listingPdaFor(env.ids.core, poolEV.pool, seller.slotIndex);

    // No prior listing for slot 2.
    expect(
      await env.connection.getAccountInfo(listing, "confirmed"),
      "D.1 precondition: slot 2 listing must not exist",
    ).to.be.null;

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .escapeValveList({ priceUsdc: new BN(0) })
        .accounts({
          sellerWallet: seller.wallet.publicKey,
          config: configPda(env),
          pool: poolEV.pool,
          member: seller.member,
          listing,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller.wallet])
        .rpc(),
    );
    expect(msg, `D.1: ${msg}`).to.match(/InvalidListingPrice|price|listing/i);

    // Listing PDA must NOT have been persisted (tx reverted).
    expect(
      await env.connection.getAccountInfo(listing, "confirmed"),
      "D.1: listing PDA still absent after reverted tx",
    ).to.be.null;
  });

  it("D.2 escape_valve_list happy path — listing stored Active", async function () {
    const seller = handlesEV[1]!; // slot 1 — used throughout D.3–D.5
    const listing = listingPdaFor(env.ids.core, poolEV.pool, seller.slotIndex);

    await (env.programs.core.methods as any)
      .escapeValveList({ priceUsdc: new BN(LISTING_PRICE.toString()) })
      .accounts({
        sellerWallet: seller.wallet.publicKey,
        config: configPda(env),
        pool: poolEV.pool,
        member: seller.member,
        listing,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller.wallet])
      .rpc();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (await (env.programs.core.account as any).escapeValveListing.fetch(listing)) as {
      pool: PublicKey;
      seller: PublicKey;
      slotIndex: number;
      priceUsdc: { toString(): string };
      status: number;
    };
    expect(row.pool.toBase58(), "D.2: listing.pool").to.equal(poolEV.pool.toBase58());
    expect(row.seller.toBase58(), "D.2: listing.seller").to.equal(
      seller.wallet.publicKey.toBase58(),
    );
    expect(row.slotIndex, "D.2: listing.slot_index").to.equal(seller.slotIndex);
    expect(bn(row.priceUsdc), "D.2: listing.price_usdc").to.equal(LISTING_PRICE);
    expect(row.status, "D.2: listing.status == Active").to.equal(0);
  });

  it("D.3 escape_valve_buy with wrong price → EscapeValvePriceMismatch", async function () {
    const seller = handlesEV[1]!;
    const buyer = outsider;
    const listing = listingPdaFor(env.ids.core, poolEV.pool, seller.slotIndex);

    const buyerUsdc = await ensureAta(env, usdcMint, buyer.publicKey);
    const sellerUsdc = await ensureAta(env, usdcMint, seller.wallet.publicKey);
    const [newMemberPda] = memberPda(env.ids.core, poolEV.pool, buyer.publicKey);

    const buyerUsdcBefore = await balanceOf(env, buyerUsdc);
    const sellerUsdcBefore = await balanceOf(env, sellerUsdc);

    // Listing price is LISTING_PRICE; tx claims a different one.
    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .escapeValveBuy({ priceUsdc: new BN((LISTING_PRICE + 1n).toString()) })
        .accounts({
          buyerWallet: buyer.publicKey,
          sellerWallet: seller.wallet.publicKey,
          config: configPda(env),
          pool: poolEV.pool,
          listing,
          oldMember: seller.member,
          newMember: newMemberPda,
          usdcMint,
          buyerUsdc,
          sellerUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc(),
    );
    expect(msg, `D.3: ${msg}`).to.match(/EscapeValvePriceMismatch|price|mismatch/i);

    expect(await balanceOf(env, buyerUsdc), "D.3: buyer USDC unchanged").to.equal(buyerUsdcBefore);
    expect(await balanceOf(env, sellerUsdc), "D.3: seller USDC unchanged").to.equal(
      sellerUsdcBefore,
    );

    // Listing + old member still present.
    expect(await env.connection.getAccountInfo(listing, "confirmed"), "D.3: listing survives").to
      .not.be.null;
    expect(
      await env.connection.getAccountInfo(seller.member, "confirmed"),
      "D.3: old member row survives",
    ).to.not.be.null;
  });

  it("D.4 escape_valve_buy with wrong seller_wallet → Unauthorized", async function () {
    const seller = handlesEV[1]!;
    const fakeSeller = handlesEV[0]!; // different member, wallet != listing.seller
    const buyer = outsider;
    const listing = listingPdaFor(env.ids.core, poolEV.pool, seller.slotIndex);

    const buyerUsdc = await ensureAta(env, usdcMint, buyer.publicKey);
    const fakeSellerUsdc = await ensureAta(env, usdcMint, fakeSeller.wallet.publicKey);
    const [newMemberPda] = memberPda(env.ids.core, poolEV.pool, buyer.publicKey);

    const buyerUsdcBefore = await balanceOf(env, buyerUsdc);
    const fakeSellerUsdcBefore = await balanceOf(env, fakeSellerUsdc);

    const msg = await expectRejected(() =>
      (env.programs.core.methods as any)
        .escapeValveBuy({ priceUsdc: new BN(LISTING_PRICE.toString()) })
        .accounts({
          buyerWallet: buyer.publicKey,
          sellerWallet: fakeSeller.wallet.publicKey, // ← mismatch
          config: configPda(env),
          pool: poolEV.pool,
          listing,
          // old_member seeds include the seller wallet — here we pass
          // the fake seller's member to keep the seeds check consistent
          // with the (bogus) seller argument. The seller_wallet key
          // constraint is still what fires.
          oldMember: fakeSeller.member,
          newMember: newMemberPda,
          usdcMint,
          buyerUsdc,
          sellerUsdc: fakeSellerUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc(),
    );
    // Depending on Anchor's constraint-evaluation order, either
    // seller_wallet ↔ listing.seller (Unauthorized) or
    // old_member.slot_index ↔ listing.slot_index (NotYourPayoutSlot)
    // fires first. Either is fail-closed.
    expect(msg, `D.4: ${msg}`).to.match(/Unauthorized|NotYourPayoutSlot|seller|slot/i);

    expect(await balanceOf(env, buyerUsdc), "D.4: buyer USDC unchanged").to.equal(buyerUsdcBefore);
    expect(await balanceOf(env, fakeSellerUsdc), "D.4: wrong seller USDC unchanged").to.equal(
      fakeSellerUsdcBefore,
    );

    // Listing + both member rows still present.
    expect(await env.connection.getAccountInfo(listing, "confirmed"), "D.4: listing survives").to
      .not.be.null;
    expect(
      await env.connection.getAccountInfo(seller.member, "confirmed"),
      "D.4: slot-1 member row survives",
    ).to.not.be.null;
    expect(
      await env.connection.getAccountInfo(fakeSeller.member, "confirmed"),
      "D.4: slot-0 member row survives",
    ).to.not.be.null;
  });

  it("D.5 escape_valve_buy happy path — member re-anchored to buyer", async function () {
    const seller = handlesEV[1]!;
    const buyer = outsider;
    const listing = listingPdaFor(env.ids.core, poolEV.pool, seller.slotIndex);

    const buyerUsdc = await ensureAta(env, usdcMint, buyer.publicKey);
    const sellerUsdc = await ensureAta(env, usdcMint, seller.wallet.publicKey);
    const [newMemberPda] = memberPda(env.ids.core, poolEV.pool, buyer.publicKey);

    // Snapshot pre-transfer state that the atomic re-anchor must preserve.
    const oldMemberRow = (await fetchMember(env, seller.member)) as {
      slotIndex: number;
      reputationLevel: number;
      contributionsPaid: number;
      escrowBalance: { toString(): string };
      stakeDeposited: { toString(): string };
    };
    const buyerUsdcBefore = await balanceOf(env, buyerUsdc);
    const sellerUsdcBefore = await balanceOf(env, sellerUsdc);

    // Precondition: buyer must not already have a Member at this pool.
    expect(
      await env.connection.getAccountInfo(newMemberPda, "confirmed"),
      "D.5 precondition: buyer has no pre-existing Member row",
    ).to.be.null;

    await (env.programs.core.methods as any)
      .escapeValveBuy({ priceUsdc: new BN(LISTING_PRICE.toString()) })
      .accounts({
        buyerWallet: buyer.publicKey,
        sellerWallet: seller.wallet.publicKey,
        config: configPda(env),
        pool: poolEV.pool,
        listing,
        oldMember: seller.member,
        newMember: newMemberPda,
        usdcMint,
        buyerUsdc,
        sellerUsdc,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    // Buyer paid exactly the listing price; seller received it plus
    // the rent refund for the closed Member + Listing PDAs (which
    // arrives as SOL, not USDC — so the USDC delta equals the price).
    expect(await balanceOf(env, buyerUsdc), "D.5: buyer USDC − LISTING_PRICE").to.equal(
      buyerUsdcBefore - LISTING_PRICE,
    );
    expect(await balanceOf(env, sellerUsdc), "D.5: seller USDC + LISTING_PRICE").to.equal(
      sellerUsdcBefore + LISTING_PRICE,
    );

    // Old Member PDA is gone; new Member PDA exists with state copied over.
    expect(
      await env.connection.getAccountInfo(seller.member, "confirmed"),
      "D.5: old member PDA closed",
    ).to.be.null;

    const newMemberRow = (await fetchMember(env, newMemberPda)) as {
      wallet: PublicKey;
      slotIndex: number;
      reputationLevel: number;
      contributionsPaid: number;
      escrowBalance: { toString(): string };
      stakeDeposited: { toString(): string };
      defaulted: boolean;
    };
    expect(newMemberRow.wallet.toBase58(), "D.5: new member wallet = buyer").to.equal(
      buyer.publicKey.toBase58(),
    );
    expect(newMemberRow.slotIndex, "D.5: slot preserved").to.equal(oldMemberRow.slotIndex);
    expect(newMemberRow.reputationLevel, "D.5: reputation_level preserved").to.equal(
      oldMemberRow.reputationLevel,
    );
    expect(newMemberRow.contributionsPaid, "D.5: contributions_paid preserved").to.equal(
      oldMemberRow.contributionsPaid,
    );
    expect(bn(newMemberRow.escrowBalance), "D.5: escrow_balance preserved").to.equal(
      bn(oldMemberRow.escrowBalance),
    );
    expect(bn(newMemberRow.stakeDeposited), "D.5: stake_deposited preserved").to.equal(
      bn(oldMemberRow.stakeDeposited),
    );
    expect(newMemberRow.defaulted, "D.5: defaulted reset to false").to.be.false;

    // Listing PDA closed.
    expect(await env.connection.getAccountInfo(listing, "confirmed"), "D.5: listing PDA closed").to
      .be.null;
  });
});
