"use client";

import { useEffect, useMemo, useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { IntentPanel } from "@/components/ui/IntentPanel";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { sendClaimPayout } from "@/lib/claim-payout";
import type { ActiveGroup } from "@/data/groups";
import { DEVNET_POOLS } from "@/lib/devnet";
import { isMissingSignatureError } from "@/lib/mobileWallet";
import { isDrawRequiredError } from "@/lib/sorteio";
import { usePoolMembers } from "@/lib/usePool";
import { USDC_RATE, useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";
import type { RawMemberView, RawPoolView } from "@roundfi/sdk";

// Claim-payout modal — the symmetric companion to PayInstallmentModal.
// Dual mode:
//   - **chain**: all of memberRecord/pool/seedKey are passed → fires
//     a real claim_payout(cycle) tx via the wallet adapter.
//   - **mock**: those props are omitted → fires `session.claimPayoutMock`
//     (mock reducer) on a 1500ms timeout. Used by Demo Studio scenarios
//     where the contemplated user clicks Receber but no wallet is
//     connected to the matching on-chain member.

export interface ClaimPayoutModalProps {
  group: ActiveGroup;
  open: boolean;
  onClose: () => void;
  /** Chain-mode: the connected member record (must equal current_cycle's slot). */
  memberRecord?: RawMemberView;
  /** Chain-mode: the live pool view. */
  pool?: RawPoolView;
  /** Chain-mode: DEVNET_POOLS key (matches group.devnetPool). */
  seedKey?: keyof typeof DEVNET_POOLS;
  /** Sorteio pools (ADR pool_v2): the pool's DrawResult PDA — appended to
   *  claim_payout as a remaining account. Omit for arrival-order pools. */
  drawResult?: PublicKey;
}

export function ClaimPayoutModal({
  group,
  open,
  onClose,
  memberRecord,
  pool,
  seedKey,
  drawResult,
}: ClaimPayoutModalProps) {
  const { tokens } = useTheme();
  const { t, fmtMoney } = useI18n();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const chainWallet = useWallet();
  const { explorerTx } = chainWallet;
  const { claimPayoutMock, recordTx } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  const connectedWallet = adapter.publicKey;
  const chainMode = !!(pool && memberRecord && seedKey);
  // Credit amount sourcing: chain mode reads from on-chain pool, mock
  // mode falls back to the fixture's prize (already BRL) and converts
  // back to USDC for the breakdown line.
  const creditUsdc = chainMode ? Number(pool!.creditAmount) / 1e6 : group.prize / USDC_RATE;
  const creditBrl = chainMode ? creditUsdc * USDC_RATE : group.prize;
  const cycleDisplay = chainMode ? pool!.currentCycle : group.month;
  const cyclesTotalDisplay = chainMode ? pool!.cyclesTotal : group.total;

  // ─── Funding readiness ───────────────────────────────────────────────
  // The recipient shouldn't have to ask anyone "did everyone pay yet?". Read the
  // pool's USDC float live and compare it to the credit — the exact gate
  // claim_payout enforces: spendable = vault − guarantee_fund − lp_distribution
  // ≥ credit_amount. Also surface how many members already paid this cycle so the
  // state is self-explanatory. (Membership read from chain, 15s cadence.)
  const membersRes = usePoolMembers(seedKey ?? "pool1", 15_000, chainMode && !!seedKey);
  const paidThisCycle = useMemo(() => {
    if (!chainMode || !pool || membersRes.status !== "ok") return null;
    return membersRes.members.filter((m) => m.contributionsPaid > pool.currentCycle).length;
  }, [chainMode, pool, membersRes]);
  const [vaultUsdc, setVaultUsdc] = useState<number | null>(null);
  useEffect(() => {
    if (!chainMode || !pool || !seedKey || !open) return;
    // Capture narrowed values before the async closure (closures don't narrow).
    const usdcMint = pool.usdcMint;
    const poolPda = DEVNET_POOLS[seedKey].pda;
    let cancelled = false;
    void (async () => {
      try {
        const vaultAta = getAssociatedTokenAddressSync(usdcMint, poolPda, true);
        const bal = await connection.getTokenAccountBalance(vaultAta);
        if (!cancelled) setVaultUsdc(Number(bal.value.amount) / 1e6);
      } catch {
        if (!cancelled) setVaultUsdc(null); // unknown — never block on a failed read
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-read when a payment lands (paidThisCycle ticks up) so the status goes
    // live without reopening the modal.
  }, [chainMode, pool, seedKey, open, connection, paidThisCycle]);
  // spendable mirrors claim_payout.rs exactly: vault − (guarantee_fund + lp_distribution).
  const spendableUsdc =
    chainMode && pool && vaultUsdc !== null
      ? vaultUsdc -
        Number(pool.guaranteeFundBalance) / 1e6 -
        Number(pool.lpDistributionBalance) / 1e6
      : null;
  // Underfunded is a HARD on-chain fail (WaterfallUnderflow), so we can safely
  // gate the CTA on it. "Funded" only clears the float check — the cycle-0
  // seed-draw invariant is still enforced on-chain, so we don't over-promise it.
  const fundingKnown = spendableUsdc !== null;
  const underfunded = spendableUsdc !== null && spendableUsdc < creditUsdc;
  const shortfallUsdc = spendableUsdc !== null ? Math.max(0, creditUsdc - spendableUsdc) : 0;
  const fundingAccent = !fundingKnown ? tokens.muted : underfunded ? tokens.amber : tokens.green;
  const fundingLabel = !fundingKnown
    ? t("modal.claimPayout.funding.checking")
    : underfunded
      ? t("modal.claimPayout.funding.waiting")
      : t("modal.claimPayout.funding.ready");

  // ─── Payment progress + Triple Shield collateral ─────────────────────
  // Surfaces the contract-social side of receiving the credit upfront:
  //   - what the user has paid so far
  //   - what they still owe (remaining installments × installment_amount)
  //   - what's locked as collateral (stake_initial + total_escrow_deposited)
  // Honors the protocol rule that the contemplated member receives
  // credit_amount IN FULL — independent of level (level only affects the
  // join-time stake_bps) and independent of installments-paid-so-far
  // (the credit is anticipated; remaining installments are paid post-claim,
  // gated by the Triple Shield against default).

  // Stake bps by reputation level — the v5.2 ladder (50/25/10/3%).
  // ⚠️ PRE-REDEPLOY: only feeds the mock/demo collateral display below
  // (the chainMode branch reads member.stake_deposited_initial from the
  // program, which still snapshots the deployed 50/30/10 ladder). See
  // the LEVEL_TABLE note in lib/session.tsx.
  const STAKE_BPS_BY_LEVEL: Record<1 | 2 | 3 | 4, number> = {
    1: 5000,
    2: 2500,
    3: 1000,
    4: 300,
  };
  // Escrow split per installment — `pool.escrow_release_bps` default
  // (25% in basis points). Real chain reads this from pool, mock uses
  // the canonical default.
  const ESCROW_BPS = chainMode ? pool!.escrowReleaseBps : 2500;

  // Installments paid so far. Chain: contributions_paid is the source
  // of truth. Mock: derived from group.month (assuming the user paid
  // up to the current month — Demo Studio scenarios maintain this).
  const installmentsPaid = chainMode ? memberRecord!.contributionsPaid : Math.max(0, group.month);
  const installmentsTotal = cyclesTotalDisplay;
  const installmentsRemaining = Math.max(0, installmentsTotal - installmentsPaid);

  // Per-installment amount in BRL (for the mock side, group.installment
  // is already BRL; for chain side, convert from USDC).
  const installmentBrl = chainMode
    ? (Number(pool!.installmentAmount) / 1e6) * USDC_RATE
    : group.installment;

  const paidSoFarBrl = installmentsPaid * installmentBrl;
  const remainingDebtBrl = installmentsRemaining * installmentBrl;

  // Collateral. Chain reads from member.stake_deposited_initial +
  // total_escrow_deposited (the "_initial_" anchors that never mutate
  // — the D/C invariant references them). Mock derives from
  // (prize × stakeBps[level]) for stake and (paidSoFar × escrow_bps)
  // for cumulative escrow.
  const userLevel = (group.level ?? 2) as 1 | 2 | 3 | 4;
  const stakeInitialBrl = chainMode
    ? (Number(memberRecord!.stakeDepositedInitial) / 1e6) * USDC_RATE
    : (group.prize * STAKE_BPS_BY_LEVEL[userLevel]) / 10_000;
  const escrowDepositedBrl = chainMode
    ? (Number(memberRecord!.totalEscrowDeposited) / 1e6) * USDC_RATE
    : (paidSoFarBrl * ESCROW_BPS) / 10_000;
  const totalCollateralBrl = stakeInitialBrl + escrowDepositedBrl;

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    setTxSig(null);
    setChainError(null);
    onClose();
  };

  const handleConfirm = async () => {
    // Underfunded is a hard on-chain fail (spendable < credit) — the CTA is
    // disabled in that state; guard here so we never fire a doomed claim.
    if (underfunded) return;
    setSubmitting(true);
    setChainError(null);

    if (
      chainMode &&
      connectedWallet &&
      adapter.sendTransaction &&
      pool &&
      memberRecord &&
      seedKey
    ) {
      try {
        const sig = await sendClaimPayout({
          connection,
          sendTransaction: adapter.sendTransaction,
          pool: DEVNET_POOLS[seedKey].pda,
          memberWallet: connectedWallet as PublicKey,
          cycle: pool.currentCycle,
          slotIndex: memberRecord.slotIndex,
          // Sorteio pools ride the DrawResult as a remaining account; the
          // encoder appends it only when present (arrival shape unchanged).
          drawResult,
        });
        setTxSig(sig);
        // Record the real claim in the session ledger so /carteira + the Activity
        // feed reflect it — a positive inflow (you RECEIVED the credit). Mirrors
        // the contribute/send recordTx path; op "pool.claim" drives the label.
        recordTx({
          kind: "payment",
          amountBrl: creditBrl,
          target: group.name,
          txid: sig,
          op: "pool.claim",
        });
        setSubmitting(false);
        setDone(true);
      } catch (err) {
        const e = err as { message?: string; logs?: string[]; cause?: unknown };
        const parts: string[] = [];
        if (e.message) parts.push(e.message);
        if (Array.isArray(e.logs) && e.logs.length > 0) {
          parts.push("logs:\n" + e.logs.join("\n"));
        }
        if (e.cause) parts.push("cause: " + String(e.cause));
        if (parts.length === 0) parts.push(String(err));
        // eslint-disable-next-line no-console
        console.error("[RoundFi] claim_payout failed:", err);
        const blob = parts.join("\n");
        // Sorteio fail-closed gate (ADR pool_v2): a claim raced the draw or
        // the UI is stale. Mobile relay failure ("Missing signature"): the
        // wallet never returned the signature — steer to the in-app
        // browser. Either way, translate instead of dumping the raw revert.
        setChainError(
          isDrawRequiredError(blob)
            ? t("modal.claimPayout.error.drawRequired")
            : isMissingSignatureError(blob)
              ? t("wallet.mobileRelay.error")
              : blob,
        );
        setSubmitting(false);
      }
      return;
    }

    // Mock mode — Demo Studio scenarios + any non-chain caller.
    setTimeout(() => {
      claimPayoutMock(group);
      setSubmitting(false);
      setDone(true);
    }, 1500);
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : reset}
      title={done ? "" : t("modal.claimPayout.title")}
      subtitle={done ? undefined : t("modal.claimPayout.subtitle")}
      closeable={!submitting}
      width={480}
    >
      {done ? (
        <ModalSuccess
          title={t("modal.claimPayout.success.title")}
          body={
            txSig ? (
              <>
                {t("modal.claimPayout.success.body", {
                  amount: fmtMoney(creditBrl, { noCents: true }),
                })}
                <a
                  href={explorerTx(txSig)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 12,
                    padding: "6px 10px",
                    borderRadius: 8,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 11,
                    color: tokens.green,
                    background: `${tokens.green}1a`,
                    border: `1px solid ${tokens.green}55`,
                    textDecoration: "none",
                  }}
                >
                  {t("modal.claimPayout.success.txLabel")} · {shortAddr(txSig, 6, 6)}
                </a>
              </>
            ) : (
              t("modal.claimPayout.success.bodyNoTx")
            )
          }
          cta={
            <button type="button" onClick={reset} style={primaryBtn(tokens)}>
              {t("modal.close")}
            </button>
          }
        />
      ) : (
        <>
          {/* Group + slot context */}
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: 12,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: `${tokens.purple}1A`,
                border: `1px solid ${tokens.purple}4D`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
              }}
            >
              {group.emoji}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <MonoLabel size={9}>{t("modal.claimPayout.group")}</MonoLabel>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{group.name}</div>
              <div
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  marginTop: 2,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t("modal.claimPayout.cycleLine", {
                  cycle: cycleDisplay + 1,
                  total: cyclesTotalDisplay,
                })}
              </div>
            </div>
          </div>

          {/* Amount hero */}
          <div
            style={{
              padding: 18,
              borderRadius: 14,
              background: `linear-gradient(145deg, ${tokens.purple}26, ${tokens.surface1} 80%)`,
              border: `1px solid ${tokens.purple}55`,
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            <MonoLabel size={9} color={tokens.purple}>
              {t("modal.claimPayout.youReceive")}
            </MonoLabel>
            <div
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 40,
                fontWeight: 800,
                color: tokens.text,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                marginTop: 6,
              }}
            >
              {fmtMoney(creditBrl)}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {t("modal.claimPayout.fromVault", { usdc: creditUsdc.toFixed(2) })}
            </div>
          </div>

          {/* Funding readiness — answers "can I claim now?" without asking anyone:
              the live pool float vs the credit + how many paid this cycle. */}
          {chainMode && (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${fundingAccent}14`,
                border: `1px solid ${fundingAccent}33`,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={fundingAccent}>
                {fundingLabel}
              </MonoLabel>
              <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
                {!fundingKnown
                  ? t("modal.claimPayout.funding.checkingBody")
                  : underfunded
                    ? t("modal.claimPayout.funding.waitingBody", { n: Math.ceil(shortfallUsdc) })
                    : t("modal.claimPayout.funding.readyBody")}
                {paidThisCycle !== null && pool
                  ? " " +
                    t("modal.claimPayout.funding.paidCount", {
                      paid: paidThisCycle,
                      total: pool.membersTarget,
                    })
                  : ""}
              </span>
            </div>
          )}

          {/* Payment progress — protocol rule: credit is anticipated.
              Member receives credit_amount IN FULL regardless of how
              many installments they've paid so far; remaining
              installments are paid post-claim, secured by the Triple
              Shield. */}
          <div style={{ marginBottom: 14 }}>
            <MonoLabel size={9}>{t("modal.claimPayout.progress.label")}</MonoLabel>
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                borderRadius: 10,
                background: tokens.fillSoft,
                border: `1px solid ${tokens.borderStr}`,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                fontSize: 11,
                color: tokens.text2,
              }}
            >
              <div>
                <div style={{ color: tokens.muted, fontSize: 10, marginBottom: 2 }}>
                  {t("modal.claimPayout.progress.paidSoFar")}
                </div>
                <div style={{ color: tokens.text, fontWeight: 600 }}>
                  {t("modal.claimPayout.progress.installments", {
                    paid: installmentsPaid,
                    total: installmentsTotal,
                  })}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 10,
                    color: tokens.muted,
                    marginTop: 2,
                  }}
                >
                  = {fmtMoney(paidSoFarBrl, { noCents: true })}
                </div>
              </div>
              <div>
                <div style={{ color: tokens.muted, fontSize: 10, marginBottom: 2 }}>
                  {t("modal.claimPayout.progress.remaining")}
                </div>
                <div style={{ color: tokens.amber, fontWeight: 600 }}>
                  {t("modal.claimPayout.progress.remainingCount", { n: installmentsRemaining })}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 10,
                    color: tokens.muted,
                    marginTop: 2,
                  }}
                >
                  {fmtMoney(installmentBrl, { noCents: true })} × {installmentsRemaining} ={" "}
                  {fmtMoney(remainingDebtBrl, { noCents: true })}
                </div>
              </div>
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 10,
                color: tokens.muted,
                lineHeight: 1.5,
              }}
            >
              {t("modal.claimPayout.progress.note", {
                amount: fmtMoney(creditBrl, { noCents: true }),
              })}
            </div>
          </div>

          {/* Triple Shield collateral — what's locked securing the
              remaining debt. Stake_initial + total_escrow_deposited
              are the D/C invariant anchors that never mutate (until
              settle_default seizes them). */}
          <div style={{ marginBottom: 14 }}>
            <MonoLabel size={9} color={tokens.green}>
              {t("modal.claimPayout.shield.label")}
            </MonoLabel>
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.green}0d`,
                border: `1px solid ${tokens.green}33`,
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
                fontSize: 11,
                color: tokens.text2,
              }}
            >
              <div>
                <div style={{ color: tokens.muted, fontSize: 9, marginBottom: 2 }}>
                  {t("modal.claimPayout.shield.stake", { lv: userLevel })}
                </div>
                <div style={{ color: tokens.text, fontWeight: 600 }}>
                  {fmtMoney(stakeInitialBrl, { noCents: true })}
                </div>
              </div>
              <div>
                <div style={{ color: tokens.muted, fontSize: 9, marginBottom: 2 }}>
                  {t("modal.claimPayout.shield.escrow")}
                </div>
                <div style={{ color: tokens.text, fontWeight: 600 }}>
                  {fmtMoney(escrowDepositedBrl, { noCents: true })}
                </div>
              </div>
              <div>
                <div style={{ color: tokens.muted, fontSize: 9, marginBottom: 2 }}>
                  {t("modal.claimPayout.shield.total")}
                </div>
                <div style={{ color: tokens.green, fontWeight: 700 }}>
                  {fmtMoney(totalCollateralBrl, { noCents: true })}
                </div>
              </div>
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 10,
                color: tokens.muted,
                lineHeight: 1.5,
              }}
            >
              {t("modal.claimPayout.shield.note")}
            </div>
          </div>

          {/* On-chain banner */}
          {chainMode ? (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.purple}14`,
                border: `1px solid ${tokens.purple}33`,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={tokens.purple}>
                {t("modal.claimPayout.onchain.label")}
              </MonoLabel>
              <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
                {t("modal.claimPayout.onchain.body", {
                  wallet: shortAddr(connectedWallet?.toBase58() ?? ""),
                })}
              </span>
            </div>
          ) : (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: tokens.fillSoft,
                border: `1px solid ${tokens.borderStr}`,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={tokens.purple}>
                {t("modal.claimPayout.demo.label")}
              </MonoLabel>
              <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
                {t("modal.claimPayout.demo.body")}
              </span>
            </div>
          )}

          {/* What happens (mini bullet list) */}
          <MonoLabel size={9}>{t("modal.claimPayout.whatHappens.label")}</MonoLabel>
          <ul
            style={{
              marginTop: 8,
              marginBottom: 18,
              paddingLeft: 18,
              fontSize: 11,
              color: tokens.text2,
              lineHeight: 1.7,
            }}
          >
            <li>
              {t("modal.claimPayout.whatHappens.transfer", {
                amount: chainMode ? `${creditUsdc.toFixed(2)} USDC` : fmtMoney(creditBrl),
              })}
            </li>
            <li>{t("modal.claimPayout.whatHappens.advance")}</li>
            <li>{t("modal.claimPayout.whatHappens.once")}</li>
            <li>{t("modal.claimPayout.whatHappens.reputation")}</li>
          </ul>

          {chainError ? (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.red}14`,
                border: `1px solid ${tokens.red}33`,
                fontSize: 11,
                color: tokens.text2,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                wordBreak: "break-word",
              }}
            >
              <MonoLabel size={9} color={tokens.red}>
                {t("modal.claimPayout.error.label")}
              </MonoLabel>
              <div style={{ marginTop: 4 }}>{chainError}</div>
            </div>
          ) : null}

          {/* Pre-sign intent panel (#249 W3) — gated on chain mode.
              In claim_payout, the user RECEIVES USDC, so amountUsdc is
              negative (convention: positive=send, negative=receive). */}
          {chainMode && (
            <IntentPanel
              action="claim_payout"
              amountUsdc={-creditUsdc}
              poolLabel={group.name}
              network={chainWallet.network}
              walletLabel={chainWallet.walletLabel}
              isHardware={chainWallet.isHardware}
              isUnknownWallet={chainWallet.isUnknownWallet}
            />
          )}

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" onClick={reset} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || underfunded}
              style={{
                ...primaryBtn(tokens),
                background: `linear-gradient(135deg, ${tokens.purple}, ${tokens.teal})`,
                opacity: submitting || underfunded ? 0.45 : 1,
                cursor: submitting || underfunded ? "default" : "pointer",
              }}
            >
              {submitting
                ? t("modal.claimPayout.cta.processing")
                : underfunded
                  ? t("modal.claimPayout.cta.waitingFunds")
                  : t("modal.claimPayout.cta.confirm")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
