"use client";

import { useMemo, useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { IntentPanel } from "@/components/ui/IntentPanel";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { sendContribute } from "@/lib/contribute";
import type { ActiveGroup } from "@/data/groups";
import { DEVNET_POOLS } from "@/lib/devnet";
import { USDC_RATE, useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { contemplatedSlotForCycle, useDraw } from "@/lib/sorteio";
import { useTheme } from "@/lib/theme";
import { usePool, usePoolMembers } from "@/lib/usePool";
import { useUsdcBalance } from "@/lib/useUsdcBalance";
import { shortAddr, useWallet } from "@/lib/wallet";

// Pay-installment modal. Shows the active group + installment amount
// + Triple Shield breakdown (65 / 30 / 5).

const SHIELD_SPLITS = [
  { key: "escrow", pct: 65 },
  { key: "vault", pct: 30 },
  { key: "fee", pct: 5 },
] as const;

export function PayInstallmentModal({
  group,
  open,
  onClose,
  onSuccess,
}: {
  group: ActiveGroup;
  open: boolean;
  onClose: () => void;
  // Fired right after a successful contribute() tx. Parents pass this
  // to trigger an eager re-fetch of their own usePool/usePoolMembers
  // so the dial advances in ~1s instead of waiting for the next 30s
  // poll. The modal also refreshes its own hooks unconditionally.
  onSuccess?: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const { payInstallment, recordTx, user, monthsPaidByGroup, demoActive } = useSession();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const usdc = useUsdcBalance();
  const wallet = useWallet();
  const { explorerTx } = wallet;
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  // ─── On-chain mode detection ─────────────────────────────────────────
  // `onChainReady` means: real devnet pool, active, connected wallet is a
  // (non-defaulted) member — i.e. a real contribute() COULD fire. Whether one
  // is actually DUE this instant is a separate check (cycle alignment, below)
  // that gates the CTA — a member who already paid the current cycle is
  // onChainReady but must not contribute again.
  // Otherwise the modal falls back to the original mock 1500ms timeout so
  // localhost/demo flows are unchanged.
  const seedKey = group.devnetPool;
  const onChainPool = usePool(seedKey ?? "pool1");
  const onChainMembers = usePoolMembers(seedKey ?? "pool1");
  const connectedWallet = adapter.publicKey;
  const memberRecord = useMemo(() => {
    if (!seedKey || !connectedWallet) return null;
    if (onChainMembers.status !== "ok") return null;
    return onChainMembers.members.find((m) => m.wallet.equals(connectedWallet)) ?? null;
  }, [seedKey, connectedWallet, onChainMembers]);
  const onChainReady =
    !!seedKey &&
    onChainPool.status === "ok" &&
    !!onChainPool.pool &&
    onChainPool.pool.status === "active" &&
    !!memberRecord &&
    !memberRecord.defaulted;

  // ─── Cycle alignment: already-paid / your-turn-to-claim / behind ─────
  // contribute(cycle) requires member.contributions_paid == pool.current_cycle,
  // and this modal sends cycle = pool.current_cycle. So once the member has
  // ALREADY paid the current cycle (contributions_paid > current_cycle) there
  // is simply no installment due — the program reverts AlreadyContributed —
  // until the slot whose index == current_cycle CLAIMS the payout and the
  // cycle rolls over. The team hit exactly this ("paguei a 2ª parcela" →
  // TX FAILED 0x1779); detect it and surface a clean state instead of firing
  // a doomed tx.
  const memberCycle = memberRecord?.contributionsPaid ?? null;
  const poolCycle = onChainPool.status === "ok" ? (onChainPool.pool?.currentCycle ?? null) : null;
  const aheadOfCycle = memberCycle !== null && poolCycle !== null && memberCycle > poolCycle;
  const behindCycle = memberCycle !== null && poolCycle !== null && memberCycle < poolCycle;
  // When paid-ahead, the cycle only rolls when the CONTEMPLATED seat claims.
  // Arrival pools: seat == current_cycle. Sorteio pools (ADR pool_v2): the
  // seat the DrawResult assigned to this cycle — null while undrawn, so the
  // "waiting for claimer" copy degrades to "—" instead of pointing at seat 0.
  // If that seat is the connected wallet, it's THEIR turn to receive — point
  // them at claim, not "waiting".
  const livePool = onChainPool.status === "ok" ? onChainPool.pool : null;
  const drawRes = useDraw(seedKey, livePool);
  const contemplatedSlot =
    livePool && poolCycle !== null
      ? contemplatedSlotForCycle(livePool, drawRes.draw, poolCycle)
      : null;
  const myTurnToClaim =
    aheadOfCycle && contemplatedSlot !== null && memberRecord?.slotIndex === contemplatedSlot;
  const claimer = useMemo(() => {
    if (contemplatedSlot === null || onChainMembers.status !== "ok") return null;
    return onChainMembers.members.find((m) => m.slotIndex === contemplatedSlot) ?? null;
  }, [contemplatedSlot, onChainMembers]);

  // ─── Real-pool guard (anti-mock) ─────────────────────────────────────
  // A group carrying a `devnetPool` pointer, on a real connected wallet
  // (NOT an admin-lab demo persona), must never fall through to the mock
  // 1500ms "payment". During the team test a Forming pool (1/3 members)
  // did exactly that — the modal reported success with no wallet signature
  // ever requested. When the real pool isn't contributable yet we surface
  // WHY and disable the CTA. `mockMode` (pure fixtures + demo personas)
  // keeps the original pitch flow untouched.
  const mockMode = !seedKey || demoActive;
  const chainGate:
    | "loading"
    | "forming"
    | "notMember"
    | "unavailable"
    | "alreadyPaid"
    | "claimTurn"
    | "behind"
    | null = mockMode
    ? null
    : onChainReady
      ? myTurnToClaim
        ? "claimTurn"
        : aheadOfCycle
          ? "alreadyPaid"
          : behindCycle
            ? "behind"
            : null
      : onChainPool.status === "loading"
        ? "loading"
        : onChainPool.status === "ok" && onChainPool.pool?.status !== "active"
          ? "forming"
          : onChainPool.status === "ok" && onChainPool.pool?.status === "active" && !memberRecord
            ? "notMember"
            : "unavailable";

  // Positive gates (em dia / sua vez) read green; waiting/behind read amber.
  const gatePositive = chainGate === "alreadyPaid" || chainGate === "claimTurn";
  const gateAccent = gatePositive ? tokens.green : tokens.amber;
  const gateLabelKey =
    chainGate === "alreadyPaid"
      ? "modal.pay.gate.label.upToDate"
      : chainGate === "claimTurn"
        ? "modal.pay.gate.label.yourTurn"
        : chainGate === "behind"
          ? "modal.pay.gate.label.behind"
          : "modal.pay.gate.label";

  // `group` is the static fixture; live progress comes from session.
  // effectiveMonth is the month the user is *about to pay for*. When
  // it equals group.total the cycle is fully funded — no more parcelas.
  const paidExtra = monthsPaidByGroup[group.name] ?? 0;
  const effectiveMonth = Math.min(group.total, group.month + paidExtra);
  const cycleDone = effectiveMonth >= group.total;
  // The on-chain installment in USDC (base units → USDC) — drives the BRL hero
  // AND the live balance gate below.
  const installmentUsdc =
    onChainReady && onChainPool.pool ? Number(onChainPool.pool.installmentAmount) / 1e6 : null;
  // Block on insufficient balance. Mock mode uses the session balance. On-chain
  // mode pre-checks the REAL USDC ATA: contribute.rs:146 reverts with the
  // (misleadingly-named) InsufficientStake error when member_usdc < installment —
  // its message says "Stake below required amount for this reputation level",
  // which confused the team. Surface a clear "use the faucet" gate instead. Only
  // when a payment is actually due (no chainGate) and the balance read succeeded.
  const insufficient = mockMode && user.balance < group.installment;
  const insufficientChain =
    onChainReady &&
    !chainGate &&
    installmentUsdc !== null &&
    usdc.status === "ok" &&
    usdc.uiAmount !== null &&
    usdc.uiAmount < installmentUsdc;
  const blocked = cycleDone || insufficient || insufficientChain;

  // A2-F2: when on-chain, drive the 40px hero + Triple-Shield breakdown from the
  // pinned chain installment (as the IntentPanel already does) rather than the
  // static fixture — otherwise the headline can disagree with what the program
  // actually debits if the fixture and the deployed pool drift. fmtMoney takes
  // BRL, so convert the USDC base-units installment via USDC_RATE.
  const installmentBrl = installmentUsdc !== null ? installmentUsdc * USDC_RATE : group.installment;

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    setTxSig(null);
    setChainError(null);
    onClose();
  };

  const handleConfirm = async () => {
    // `chainGate` ⇒ real devnet pool that can't be contributed to yet
    // (Forming, wallet-not-member, …). The CTA is disabled in that state;
    // this guard makes the no-op explicit so we never reach the mock path.
    if (blocked || chainGate) return;
    setSubmitting(true);
    setChainError(null);

    if (onChainReady && memberRecord && onChainPool.pool && adapter.sendTransaction) {
      try {
        // The attestation PDA seeds include the schema id, so the off-chain
        // derivation MUST match contribute.rs — and the FINAL installment
        // escalates to POOL_COMPLETE (4), not PAYMENT/LATE. Pass cyclesTotal +
        // nextCycleAt and let the encoder pick the schema; hardcoding PAYMENT
        // here was the bug that ConstraintSeeds-rejected the last installment
        // of every pool (cycle == cyclesTotal-1).
        const sig = await sendContribute({
          connection,
          sendTransaction: adapter.sendTransaction,
          pool: DEVNET_POOLS[seedKey!].pda,
          memberWallet: connectedWallet as PublicKey,
          cycle: onChainPool.pool.currentCycle,
          cyclesTotal: onChainPool.pool.cyclesTotal,
          nextCycleAt: onChainPool.pool.nextCycleAt,
          slotIndex: memberRecord.slotIndex,
        });
        setTxSig(sig);
        // Record the REAL contribute as a ledger event carrying the actual
        // signature, so /carteira + the Activity feed reflect it. On a real
        // wallet we do NOT run the mock PAY_INSTALLMENT reducer: its
        // balance/score mutations + `balance < amount` guard fight the
        // on-chain bridge (which owns those) and could silently drop the row.
        // The cycle dial advances from the eager on-chain re-fetch below.
        // Demo personas keep the mock advance for the pitch.
        if (demoActive) {
          payInstallment(group);
        } else {
          recordTx({
            kind: "payment",
            amountBrl: -installmentBrl,
            target: group.name,
            txid: sig,
          });
        }
        // Eager on-chain re-fetch — both the modal's own copy and the
        // parent's (via onSuccess). Without this the FeaturedGroup dial
        // stays stale for up to 30s after a successful pay.
        void onChainPool.refresh();
        void onChainMembers.refresh();
        onSuccess?.();
        setSubmitting(false);
        setDone(true);
      } catch (err) {
        // Phantom + wallet-adapter often surface a generic "Unexpected
        // error" while the actual program revert log lives on
        // `err.logs` or `err.cause`. Concatenate everything we can
        // reach so the modal banner is diagnosable instead of opaque.
        const e = err as { message?: string; logs?: string[]; cause?: unknown };
        const parts: string[] = [];
        if (e.message) parts.push(e.message);
        if (Array.isArray(e.logs) && e.logs.length > 0) {
          parts.push("logs:\n" + e.logs.join("\n"));
        }
        if (e.cause) parts.push("cause: " + String(e.cause));
        if (parts.length === 0) parts.push(String(err));
        // eslint-disable-next-line no-console
        console.error("[RoundFi] contribute failed:", err);
        setChainError(parts.join("\n"));
        setSubmitting(false);
      }
      return;
    }

    // Mock fallback — only reachable in `mockMode` (pure fixtures + demo
    // personas); the `chainGate` guard above stops real devnet pools from
    // ever landing here. Preserves the original pitch flow exactly.
    setTimeout(() => {
      payInstallment(group);
      setSubmitting(false);
      setDone(true);
    }, 1500);
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : reset}
      title={done ? "" : t("modal.pay.title")}
      subtitle={done ? undefined : t("modal.pay.subtitle")}
      closeable={!submitting}
      width={480}
    >
      {done ? (
        <ModalSuccess
          title={t("modal.pay.success.title")}
          body={
            txSig ? (
              <>
                {t("modal.pay.success.body")}
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
                  on-chain tx · {shortAddr(txSig, 6, 6)}
                </a>
              </>
            ) : (
              t("modal.pay.success.body")
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
          {/* Group + month */}
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
                background: `${tokens.green}1A`,
                border: `1px solid ${tokens.green}4D`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
              }}
            >
              {group.emoji}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <MonoLabel size={9}>{t("modal.pay.group")}</MonoLabel>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{group.name}</div>
              <div
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  marginTop: 2,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t("modal.pay.month", { m: effectiveMonth, t: group.total })} ·{" "}
                {t("modal.pay.due", { d: group.nextDue })}
              </div>
            </div>
          </div>

          {/* Amount hero */}
          <div
            style={{
              padding: 18,
              borderRadius: 14,
              background: `linear-gradient(145deg, ${tokens.navyDeep}, ${tokens.surface1} 80%)`,
              border: `1px solid ${tokens.border}`,
              marginBottom: 16,
              textAlign: "center",
            }}
          >
            <MonoLabel size={9}>{t("modal.pay.amount")}</MonoLabel>
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
              {fmtMoney(installmentBrl)}
            </div>
          </div>

          {/* Triple Shield breakdown */}
          <MonoLabel size={9}>{t("modal.pay.breakdown")}</MonoLabel>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              marginBottom: 12,
            }}
          >
            <div style={{ flex: 65, background: tokens.green }} />
            <div style={{ flex: 30, background: tokens.teal }} />
            <div style={{ flex: 5, background: tokens.purple }} />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
              marginBottom: 18,
            }}
          >
            {SHIELD_SPLITS.map((s) => {
              const c =
                s.key === "escrow" ? tokens.green : s.key === "vault" ? tokens.teal : tokens.purple;
              return (
                <div key={s.key}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 2,
                        background: c,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                        fontSize: 10,
                        color: c,
                        fontWeight: 600,
                      }}
                    >
                      {s.pct}%
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: tokens.text2, marginTop: 2 }}>
                    {t(`modal.pay.breakdown.${s.key}`)}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: tokens.text,
                      marginTop: 2,
                    }}
                  >
                    {fmtMoney((installmentBrl * s.pct) / 100, {
                      noCents: true,
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* On-chain mode banner — only when wallet matches a pool member AND
              a contribution is actually due (not gated by already-paid / claim
              turn / behind), so it never implies a payment the CTA won't fire. */}
          {onChainReady && !chainGate && memberRecord && onChainPool.pool ? (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.green}14`,
                border: `1px solid ${tokens.green}33`,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={tokens.green}>
                ON-CHAIN
              </MonoLabel>
              <span
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: tokens.text2,
                  lineHeight: 1.5,
                }}
              >
                {t("modal.pay.onchain.banner", {
                  slot: memberRecord.slotIndex,
                  addr: shortAddr(connectedWallet?.toBase58() ?? ""),
                  seedId: onChainPool.pool.seedId.toString(),
                  cycle: onChainPool.pool.currentCycle,
                })}
              </span>
            </div>
          ) : null}

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
                TX FAILED
              </MonoLabel>
              <div style={{ marginTop: 4 }}>{chainError}</div>
            </div>
          ) : null}

          {/* Block reasons (cycle done / insufficient balance) */}
          {blocked && (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.red}14`,
                border: `1px solid ${tokens.red}33`,
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={tokens.red}>
                {cycleDone
                  ? t("modal.pay.blocked.cycleComplete")
                  : t("modal.pay.blocked.insufficientBalance")}
              </MonoLabel>
              <span
                style={{
                  fontSize: 11,
                  color: tokens.text2,
                  lineHeight: 1.5,
                }}
              >
                {cycleDone
                  ? `Você já pagou todas as ${group.total} parcelas deste ciclo.`
                  : insufficientChain
                    ? `Saldo USDC insuficiente: você tem ${(usdc.uiAmount ?? 0).toFixed(2)} USDC e a parcela é ${(installmentUsdc ?? 0).toFixed(2)} USDC. Pegue USDC no faucet ("Solicitar SOL + USDC" na tela de Carteira) e tente de novo.`
                    : `Saldo atual ${fmtMoney(user.balance, { noCents: true })} — adicione fundos pela tela de Carteira.`}
              </span>
            </div>
          )}

          {/* Real-pool gate — explains why an on-chain payment isn't
              available right now (pool still Forming / wallet not a member /
              state unreachable) instead of silently firing the mock. */}
          {chainGate ? (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${gateAccent}14`,
                border: `1px solid ${gateAccent}33`,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={gateAccent}>
                {t(gateLabelKey)}
              </MonoLabel>
              <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
                {t(`modal.pay.gate.${chainGate}`, {
                  filled: onChainPool.pool?.membersJoined ?? 0,
                  target: onChainPool.pool?.membersTarget ?? group.total,
                  slot: poolCycle ?? 0,
                  claimer: claimer ? shortAddr(claimer.wallet.toBase58()) : "—",
                })}
              </span>
            </div>
          ) : null}

          {/* Pre-sign intent panel (#249 W3) — gated on on-chain mode.
              Renders authoritative tx summary inside our UI so the user
              has a reference to cross-check Phantom's prompt against
              (phishing-resistance). Hidden in mock mode since no real
              tx fires. */}
          {onChainReady && !blocked && !chainGate && (
            <IntentPanel
              action="contribute"
              amountUsdc={Number(onChainPool.pool!.installmentAmount) / 1e6}
              poolLabel={group.name}
              network={wallet.network}
              walletLabel={wallet.walletLabel}
              isHardware={wallet.isHardware}
              isUnknownWallet={wallet.isUnknownWallet}
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
              disabled={submitting || blocked || !!chainGate}
              style={{
                ...primaryBtn(tokens),
                opacity: submitting || blocked || chainGate ? 0.45 : 1,
                cursor: submitting || blocked || chainGate ? "default" : "pointer",
              }}
            >
              {submitting ? t("modal.processing") : t("modal.pay.cta")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
