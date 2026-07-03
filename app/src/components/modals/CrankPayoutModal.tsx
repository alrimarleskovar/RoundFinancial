"use client";

import { useEffect, useMemo, useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { sendCrankPayout } from "@/lib/crank-payout";
import { DEVNET_POOLS, GRACE_PERIOD_SECS, type DevnetPoolKey } from "@/lib/devnet";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { usePool, usePoolMembers } from "@/lib/usePool";
import { shortAddr, useWallet } from "@/lib/wallet";

// `GRACE_PERIOD_SECS` (the on-chain `crank_payout` gate: callable once
// `now >= pool.next_cycle_at + GRACE_PERIOD_SECS`) is shared from `@/lib/devnet`
// so this modal, the settle modal, and the pool radar can't drift apart.

/**
 * CrankPayoutModal — community-cranker UI for the permissionless
 * `crank_payout` (SEV-051): unstick a pool whose LIVE contemplated member
 * never claimed. Anyone can crank; the credit is delivered to the MEMBER's OWN
 * ATA (never the caller's), and the cycle advances so the pool isn't frozen for
 * the rest of the group.
 *
 * Eligible when, in an Active pool, the contemplated member (slot ==
 * current_cycle) is NOT defaulted, NOT paid out, and the self-claim grace
 * (`next_cycle_at + GRACE_PERIOD_SECS`) has elapsed. Before that the member is
 * expected to `claim_payout` themselves (the program reverts `PayoutGraceActive`).
 */
export function CrankPayoutModal({
  open,
  onClose,
  onSuccess,
  initialPool,
  lockPool = false,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Pool to pre-select when opened (e.g. from the pool radar). */
  initialPool?: DevnetPoolKey;
  /** Hide the pool selector and pin to `initialPool` — used from the member-
   *  facing group card, where the pool is already the one being viewed. */
  lockPool?: boolean;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const { explorerTx } = useWallet();

  const [selectedPool, setSelectedPool] = useState<DevnetPoolKey>(initialPool ?? "pool3");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [now, setNow] = useState<bigint>(BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    if (!open || done) return;
    const id = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(id);
  }, [open, done]);

  // When opened pre-targeted at a specific pool (from the radar), jump to it.
  useEffect(() => {
    if (open && initialPool) setSelectedPool(initialPool);
  }, [open, initialPool]);

  const onChainPool = usePool(selectedPool);
  const onChainMembers = usePoolMembers(selectedPool);

  // The contemplated member is the one whose slot_index == current_cycle.
  const target = useMemo(() => {
    if (onChainPool.status !== "ok" || !onChainPool.pool) return null;
    if (onChainMembers.status !== "ok") return null;
    const pool = onChainPool.pool;
    if (pool.status !== "active") return null;
    if (pool.currentCycle >= pool.cyclesTotal) return null;
    const m = onChainMembers.members.find((x) => x.slotIndex === pool.currentCycle);
    if (!m) return null;
    const graceDeadline = pool.nextCycleAt + GRACE_PERIOD_SECS;
    const graceSecsRemaining = Number(graceDeadline - now);
    return {
      cycle: pool.currentCycle,
      wallet: m.wallet,
      shortWallet: shortAddr(m.wallet.toBase58()),
      defaulted: m.defaulted,
      paidOut: m.paidOut,
      creditAmount: pool.creditAmount,
      graceSecsRemaining,
      // Eligible = live, unclaimed, past the self-claim grace window.
      eligibleNow: !m.defaulted && !m.paidOut && graceSecsRemaining <= 0,
    };
  }, [onChainPool, onChainMembers, now]);

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    setTxSig(null);
    setChainError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!target) return;
    if (!adapter.publicKey || !adapter.sendTransaction) {
      setChainError(t("modal.crankPayout.error.noWallet"));
      return;
    }
    if (!target.eligibleNow) {
      setChainError(t("modal.crankPayout.error.graceActive"));
      return;
    }
    setSubmitting(true);
    setChainError(null);
    try {
      const sig = await sendCrankPayout({
        connection,
        sendTransaction: adapter.sendTransaction,
        pool: DEVNET_POOLS[selectedPool].pda,
        caller: adapter.publicKey,
        contemplatedMemberWallet: target.wallet,
        cycle: target.cycle,
        slotIndex: target.cycle,
      });
      setTxSig(sig);
      void onChainPool.refresh();
      void onChainMembers.refresh();
      onSuccess?.();
      setSubmitting(false);
      setDone(true);
    } catch (err) {
      const e = err as { message?: string; logs?: string[]; cause?: unknown };
      const parts: string[] = [];
      if (e.message) parts.push(e.message);
      if (Array.isArray(e.logs) && e.logs.length > 0) parts.push("logs:\n" + e.logs.join("\n"));
      if (e.cause) parts.push("cause: " + String(e.cause));
      if (parts.length === 0) parts.push(String(err));
      // eslint-disable-next-line no-console
      console.error("[RoundFi] crank_payout failed:", err);
      setChainError(parts.join("\n"));
      setSubmitting(false);
    }
  };

  const mono = "var(--font-jetbrains-mono), JetBrains Mono, monospace";
  const sectionLabel = (label: string) => (
    <MonoLabel size={9} style={{ marginBottom: 6 }}>
      {label}
    </MonoLabel>
  );

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : reset}
      title={done ? "" : t("modal.crankPayout.title")}
      subtitle={done ? undefined : t("modal.crankPayout.subtitle")}
      closeable={!submitting}
      width={560}
    >
      {done && txSig ? (
        <ModalSuccess
          title={t("modal.crankPayout.success.title")}
          body={
            <>
              {t("modal.crankPayout.success.body")}
              <div style={{ marginTop: 12 }}>
                <a
                  href={explorerTx(txSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: tokens.green,
                    textDecoration: "underline",
                    fontFamily: mono,
                    fontSize: 12,
                  }}
                >
                  {shortAddr(txSig)} ↗ Solscan
                </a>
              </div>
            </>
          }
          cta={
            <button type="button" onClick={reset} style={primaryBtn(tokens)}>
              {t("modal.crankPayout.success.cta")}
            </button>
          }
        />
      ) : (
        <>
          {/* Pool selector — hidden when the modal is pinned to one pool
              (e.g. opened from the member-facing group card). */}
          {!lockPool && (
            <div style={{ marginBottom: 16 }}>
              {sectionLabel(t("modal.crankPayout.pool"))}
              <div style={{ display: "flex", gap: 8 }}>
                {(Object.keys(DEVNET_POOLS) as DevnetPoolKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedPool(key)}
                    style={{
                      ...ghostBtn(tokens),
                      flex: 1,
                      borderColor: selectedPool === key ? tokens.green : tokens.border,
                      background: selectedPool === key ? `${tokens.green}1A` : "transparent",
                    }}
                  >
                    {t(`home.devnet.${key}.label`).split("·")[0].trim()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Contemplated slot */}
          <div style={{ marginBottom: 16 }}>
            {sectionLabel(t("modal.crankPayout.contemplated"))}
            {onChainPool.status === "loading" || onChainMembers.status === "loading" ? (
              <div style={{ fontSize: 12, color: tokens.muted, fontFamily: mono }}>
                {t("modal.crankPayout.loading")}
              </div>
            ) : !target ? (
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: tokens.fillSoft,
                  border: `1px dashed ${tokens.border}`,
                  fontSize: 12,
                  color: tokens.muted,
                  textAlign: "center",
                }}
              >
                {t("modal.crankPayout.nothingStuck")}
              </div>
            ) : (
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${target.eligibleNow ? tokens.green : tokens.border}`,
                  background: target.eligibleNow ? `${tokens.green}0D` : tokens.fillSoft,
                  fontFamily: mono,
                  fontSize: 12,
                  color: tokens.muted,
                }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between", color: tokens.text }}
                >
                  <span>
                    {t("modal.crankPayout.cycle")} {target.cycle} · {target.shortWallet}
                  </span>
                  <span style={{ color: target.eligibleNow ? tokens.green : tokens.muted }}>
                    {target.paidOut
                      ? t("modal.crankPayout.alreadyPaid")
                      : target.defaulted
                        ? t("modal.crankPayout.defaulted")
                        : target.eligibleNow
                          ? t("modal.crankPayout.eligible")
                          : `${t("modal.crankPayout.graceIn")} ${Math.max(0, target.graceSecsRemaining)}s`}
                  </span>
                </div>
                <div style={{ marginTop: 8 }}>
                  {t("modal.crankPayout.willDeliver", {
                    amount: `$${(Number(target.creditAmount) / 1e6).toFixed(2)}`,
                  })}
                </div>
              </div>
            )}
          </div>

          {chainError && (
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                background: `${tokens.red ?? "#ef4444"}14`,
                border: `1px solid ${tokens.red ?? "#ef4444"}66`,
                color: tokens.red ?? "#ef4444",
                fontSize: 11,
                fontFamily: mono,
                whiteSpace: "pre-wrap",
                marginBottom: 12,
                maxHeight: 120,
                overflow: "auto",
              }}
            >
              {chainError}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={reset} disabled={submitting} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || !target || !target.eligibleNow}
              style={{
                ...primaryBtn(tokens),
                flex: 1,
                opacity: submitting || !target || !target.eligibleNow ? 0.5 : 1,
              }}
            >
              {submitting ? t("modal.crankPayout.submitting") : t("modal.crankPayout.crank")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
