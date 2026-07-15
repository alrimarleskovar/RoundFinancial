"use client";

import { useEffect, useMemo, useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { sendCrankPayout } from "@/lib/crank-payout";
import { DEVNET_POOLS, GRACE_PERIOD_SECS, type DevnetPoolKey } from "@/lib/devnet";
import { useT } from "@/lib/i18n";
import {
  contemplatedSlotForCycle,
  isDrawRequiredError,
  isSorteioPool,
  useDraw,
} from "@/lib/sorteio";
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
  const { explorerTx, explorerAddr } = useWallet();

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
  // Sorteio pools (ADR pool_v2): the seat→cycle translation lives in the
  // DrawResult; fetched only when the selected pool actually is sorteio.
  const drawRes = useDraw(selectedPool, onChainPool.status === "ok" ? onChainPool.pool : null);
  // Full Active sorteio pool with no draw yet — there IS no contemplated
  // member to crank; the group needs "Sortear ordem" (on its card) first.
  const awaitingDraw =
    onChainPool.status === "ok" &&
    !!onChainPool.pool &&
    isSorteioPool(onChainPool.pool) &&
    onChainPool.pool.status === "active" &&
    drawRes.status === "ok" &&
    !drawRes.draw;

  // The contemplated member: arrival pools → slot_index == current_cycle;
  // sorteio pools → the seat the DrawResult assigned to this cycle (null
  // while undrawn, so no crank target can exist pre-draw).
  const target = useMemo(() => {
    if (onChainPool.status !== "ok" || !onChainPool.pool) return null;
    if (onChainMembers.status !== "ok") return null;
    const pool = onChainPool.pool;
    if (pool.status !== "active") return null;
    if (pool.currentCycle >= pool.cyclesTotal) return null;
    const contemplatedSlot = contemplatedSlotForCycle(pool, drawRes.draw, pool.currentCycle);
    if (contemplatedSlot === null) return null;
    const m = onChainMembers.members.find((x) => x.slotIndex === contemplatedSlot);
    if (!m) return null;
    const graceDeadline = pool.nextCycleAt + GRACE_PERIOD_SECS;
    const graceSecsRemaining = Number(graceDeadline - now);
    return {
      cycle: pool.currentCycle,
      slotIndex: m.slotIndex,
      wallet: m.wallet,
      shortWallet: shortAddr(m.wallet.toBase58()),
      defaulted: m.defaulted,
      paidOut: m.paidOut,
      creditAmount: pool.creditAmount,
      graceSecsRemaining,
      // Eligible = live, unclaimed, past the self-claim grace window.
      eligibleNow: !m.defaulted && !m.paidOut && graceSecsRemaining <= 0,
    };
  }, [onChainPool, onChainMembers, drawRes.draw, now]);

  // ─── Funding pre-check (SEV-053 UX follow-up) ────────────────────────
  // crank_payout enforces spendable = vault − (guarantee_fund + lp_distribution)
  // ≥ credit_amount and reverts WaterfallUnderflow otherwise. Read the float
  // live (same pattern as ClaimPayoutModal) so an underfunded pool shows
  // "waiting for group funds" instead of offering a crank that must fail.
  const paidCount = useMemo(
    () =>
      onChainPool.status === "ok" && onChainPool.pool && onChainMembers.status === "ok"
        ? onChainMembers.members.filter(
            (m) => m.contributionsPaid > (onChainPool.pool?.currentCycle ?? 0),
          ).length
        : null,
    [onChainPool, onChainMembers],
  );
  const [vaultUsdc, setVaultUsdc] = useState<number | null>(null);
  useEffect(() => {
    if (!open || onChainPool.status !== "ok" || !onChainPool.pool) return;
    const usdcMint = onChainPool.pool.usdcMint;
    const poolPda = DEVNET_POOLS[selectedPool].pda;
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
    // paidCount re-arms the read when a payment lands, keeping the gate live.
  }, [open, selectedPool, onChainPool, connection, paidCount]);
  const spendableUsdc =
    onChainPool.status === "ok" && onChainPool.pool && vaultUsdc !== null
      ? vaultUsdc -
        Number(onChainPool.pool.guaranteeFundBalance) / 1e6 -
        Number(onChainPool.pool.lpDistributionBalance) / 1e6
      : null;
  const creditUsdc = target ? Number(target.creditAmount) / 1e6 : null;
  // Underfunded is a HARD on-chain fail (WaterfallUnderflow) → safe to gate on.
  // An unknown read (null) never blocks — simulateOrThrow still protects the wallet.
  const underfunded = spendableUsdc !== null && creditUsdc !== null && spendableUsdc < creditUsdc;
  const shortfallUsdc =
    underfunded && creditUsdc !== null && spendableUsdc !== null
      ? Math.ceil(creditUsdc - spendableUsdc)
      : 0;

  // Which pool this modal is acting on. A pool has no on-chain name, so pin the
  // identity with its seed id + account (Solscan) — that's what actually tells a
  // user *which* group is stuck, rather than the contemplated wallet address.
  const poolIdent = useMemo(() => {
    const meta = DEVNET_POOLS[selectedPool];
    return {
      title: t(`home.devnet.${selectedPool}.label`).split("·")[0].trim(),
      seedId: meta.seedId.toString(),
      pda: meta.pda.toBase58(),
    };
  }, [selectedPool, t]);

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
    if (underfunded) {
      setChainError(t("modal.crankPayout.error.underfunded"));
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
        // The member's REAL seat — equals cycle on arrival pools, and the
        // drawn seat on sorteio pools (the attestation nonce packs both).
        slotIndex: target.slotIndex,
        // Sorteio pools ride the DrawResult as a remaining account; the
        // encoder appends it only when present (arrival shape unchanged).
        ...(onChainPool.status === "ok" && isSorteioPool(onChainPool.pool) && drawRes.drawPda
          ? { drawResult: drawRes.drawPda }
          : {}),
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
      const blob = parts.join("\n");
      // Sorteio fail-closed gate (ADR pool_v2): crank raced the draw or the
      // UI is stale — translate instead of dumping the raw revert.
      setChainError(isDrawRequiredError(blob) ? t("modal.crankPayout.error.drawRequired") : blob);
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

          {/* Which pool — pin the identity (name · #seedId · account ↗) so it's
              unmistakable which real group this stuck cycle belongs to. */}
          <div
            style={{
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              fontFamily: mono,
              fontSize: 11,
              color: tokens.muted,
            }}
          >
            <span style={{ color: tokens.text, fontWeight: 700 }}>{poolIdent.title}</span>
            <span
              style={{
                border: `1px solid ${tokens.border}`,
                borderRadius: 6,
                padding: "1px 6px",
              }}
            >
              #{poolIdent.seedId}
            </span>
            <a
              href={explorerAddr(poolIdent.pda)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: tokens.muted, textDecoration: "none" }}
            >
              {shortAddr(poolIdent.pda)} ↗
            </a>
          </div>

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
                  color: awaitingDraw ? tokens.amber : tokens.muted,
                  textAlign: "center",
                }}
              >
                {awaitingDraw
                  ? t("modal.crankPayout.awaitingDraw")
                  : t("modal.crankPayout.nothingStuck")}
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
                    {t("modal.crankPayout.cycle")} {target.cycle} ·{" "}
                    {t("modal.crankPayout.recipient")} {target.shortWallet}
                  </span>
                  <span
                    style={{
                      color:
                        target.eligibleNow && underfunded
                          ? tokens.amber
                          : target.eligibleNow
                            ? tokens.green
                            : tokens.muted,
                    }}
                  >
                    {target.paidOut
                      ? t("modal.crankPayout.alreadyPaid")
                      : target.defaulted
                        ? t("modal.crankPayout.defaulted")
                        : target.eligibleNow
                          ? underfunded
                            ? t("modal.crankPayout.waitingFunds", { n: shortfallUsdc })
                            : t("modal.crankPayout.eligible")
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
              disabled={submitting || !target || !target.eligibleNow || underfunded}
              style={{
                ...primaryBtn(tokens),
                flex: 1,
                opacity: submitting || !target || !target.eligibleNow || underfunded ? 0.5 : 1,
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
