"use client";

import { useEffect, useMemo, useState } from "react";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { MonoLabel } from "@/components/brand/brand";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { sendSettleDefault } from "@/lib/settle-default";
import { DEVNET_POOLS, type DevnetPoolKey } from "@/lib/devnet";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { usePool, usePoolMembers } from "@/lib/usePool";
import { shortAddr, useWallet } from "@/lib/wallet";

// `GRACE_PERIOD_SECS` on the on-chain `constants.rs` is currently
// 60s (devnet patch — see `programs/roundfi-core/src/constants.rs`).
// Mainnet flips this to 604_800 (7d) before launch.
const GRACE_PERIOD_SECS = 60n;

interface CandidateMember {
  slotIndex: number;
  wallet: string;
  shortWallet: string;
  contributionsPaid: number;
  onTimeCount: number;
  lateCount: number;
  escrowBalance: bigint;
  stakeDeposited: bigint;
  defaulted: boolean;
  /** True when this member missed the current cycle's contribution AND
   *  the grace period has elapsed. */
  eligibleNow: boolean;
  /** Seconds until grace deadline (negative = already elapsed). */
  graceSecsRemaining: number;
}

/**
 * SettleDefaultCrankModal — admin / community-cranker UI for triggering
 * `settle_default` against a defaulter once their grace period has
 * elapsed. Anyone can crank (the on-chain instruction is permissionless);
 * this modal just makes the workflow ergonomic for the canary operator.
 *
 * Flow:
 *   1. Operator picks a pool from `DEVNET_POOLS`
 *   2. Modal reads pool state via `usePool()` + members via `usePoolMembers()`
 *   3. Filters down to "eligible defaulters" — members who missed the
 *      previous cycle AND whose grace deadline (`next_cycle_at - cycle +
 *      GRACE_PERIOD_SECS`) is in the past
 *   4. Renders Triple Shield preview (solidarity → escrow → stake) for
 *      the selected candidate
 *   5. Submits via wallet adapter; renders Solscan link on success
 *
 * Failure surface (rendered as-is to the operator):
 *   - `SettleDefaultGracePeriodNotElapsed` — too early
 *   - `AlreadyContributed` — member paid on time after all
 *   - `AlreadyDefaulted` — re-settle blocked
 *   - `WrongCycle` — cycle arg mismatch
 *   - `WaterfallUnderflow` / `WaterfallNotConserved` — invariant violation
 *
 * Tracks issue #291.
 */
export function SettleDefaultCrankModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney: _fmtMoney } = useI18n();
  void _fmtMoney;
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const { explorerTx } = useWallet();

  const [selectedPool, setSelectedPool] = useState<DevnetPoolKey>("pool3");
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [now, setNow] = useState<bigint>(BigInt(Math.floor(Date.now() / 1000)));

  // Tick `now` every second so the grace-deadline countdown updates.
  useEffect(() => {
    if (!open || done) return;
    const id = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(id);
  }, [open, done]);

  const onChainPool = usePool(selectedPool);
  const onChainMembers = usePoolMembers(selectedPool);

  // Cycle to settle — per the on-chain `WrongCycle` guard, this is
  // `pool.current_cycle - 1` (the cranker settles the PREVIOUS cycle's
  // defaulters once `current_cycle` has advanced past them).
  const settleCycle = useMemo(() => {
    if (onChainPool.status !== "ok" || !onChainPool.pool) return null;
    const cc = onChainPool.pool.currentCycle;
    return cc > 0 ? cc - 1 : null;
  }, [onChainPool]);

  // Build candidate list. A member is a candidate when:
  //   - they exist (slot has a Member PDA)
  //   - they haven't contributed the settle-cycle
  //   - they aren't already flagged defaulted
  // Eligibility-now adds the grace-elapsed check.
  const candidates = useMemo<CandidateMember[]>(() => {
    if (onChainMembers.status !== "ok") return [];
    if (onChainPool.status !== "ok" || !onChainPool.pool || settleCycle == null) return [];
    const nextCycleAt = onChainPool.pool.nextCycleAt;
    // Grace deadline for the missed cycle = pool.next_cycle_at - cycle_duration + GRACE_PERIOD
    // (because next_cycle_at was advanced when the cycle rolled).
    const cycleDuration = onChainPool.pool.cycleDurationSec;
    const missedCycleEndsAt = nextCycleAt - cycleDuration;
    const graceDeadline = missedCycleEndsAt + GRACE_PERIOD_SECS;

    return onChainMembers.members
      .filter((m) => m.contributionsPaid <= settleCycle)
      .filter((m) => !m.defaulted)
      .map<CandidateMember>((m) => {
        const graceSecsRemaining = Number(graceDeadline - now);
        return {
          slotIndex: m.slotIndex,
          wallet: m.wallet.toBase58(),
          shortWallet: shortAddr(m.wallet),
          contributionsPaid: m.contributionsPaid,
          onTimeCount: m.onTimeCount,
          lateCount: m.lateCount,
          escrowBalance: m.escrowBalance,
          stakeDeposited: m.stakeDeposited,
          defaulted: m.defaulted,
          eligibleNow: graceSecsRemaining <= 0,
          graceSecsRemaining,
        };
      });
  }, [onChainMembers, onChainPool, settleCycle, now]);

  // Auto-select the first eligible candidate when the list refreshes.
  useEffect(() => {
    if (selectedSlot != null) return;
    const firstEligible = candidates.find((c) => c.eligibleNow);
    if (firstEligible) setSelectedSlot(firstEligible.slotIndex);
  }, [candidates, selectedSlot]);

  const selectedCandidate = candidates.find((c) => c.slotIndex === selectedSlot) ?? null;
  const installmentMissed = onChainPool.pool?.installmentAmount ?? 0n;

  // Triple Shield preview — drains solidarity first (capped at solidarity
  // vault balance), then escrow (capped by D/C in practice; preview uses
  // the simple cap here), then stake (same). This is the ESTIMATE the
  // operator sees; the on-chain handler computes the exact cascade.
  const cascadePreview = useMemo(() => {
    if (!selectedCandidate || !onChainPool.pool) return null;
    const missed = installmentMissed;
    const solidarityAvail = onChainPool.pool.solidarityBalance;
    const escrowAvail = selectedCandidate.escrowBalance;
    const stakeAvail = selectedCandidate.stakeDeposited;

    const fromSolidarity = missed < solidarityAvail ? missed : solidarityAvail;
    const remainAfterSol = missed - fromSolidarity;
    const fromEscrow = remainAfterSol < escrowAvail ? remainAfterSol : escrowAvail;
    const remainAfterEsc = remainAfterSol - fromEscrow;
    const fromStake = remainAfterEsc < stakeAvail ? remainAfterEsc : stakeAvail;
    const remainAfterStake = remainAfterEsc - fromStake;

    return {
      missed,
      fromSolidarity,
      fromEscrow,
      fromStake,
      shortfall: remainAfterStake, // > 0 means even Shield 3 can't cover
    };
  }, [selectedCandidate, onChainPool, installmentMissed]);

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    setTxSig(null);
    setChainError(null);
    setSelectedSlot(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!selectedCandidate || settleCycle == null) return;
    if (!adapter.publicKey || !adapter.sendTransaction) {
      setChainError(t("modal.settleDefault.error.noWallet"));
      return;
    }
    if (!selectedCandidate.eligibleNow) {
      setChainError(t("modal.settleDefault.error.graceNotElapsed"));
      return;
    }

    setSubmitting(true);
    setChainError(null);

    try {
      const sig = await sendSettleDefault({
        connection,
        sendTransaction: adapter.sendTransaction,
        pool: DEVNET_POOLS[selectedPool].pda,
        caller: adapter.publicKey,
        defaultedMemberWallet: candidates.find((c) => c.slotIndex === selectedSlot)!.wallet
          ? // resolve to PublicKey
            onChainMembers.status === "ok"
            ? onChainMembers.members.find((m) => m.slotIndex === selectedSlot)!.wallet
            : adapter.publicKey
          : adapter.publicKey,
        slotIndex: selectedCandidate.slotIndex,
        cycle: settleCycle,
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
      if (Array.isArray(e.logs) && e.logs.length > 0) {
        parts.push("logs:\n" + e.logs.join("\n"));
      }
      if (e.cause) parts.push("cause: " + String(e.cause));
      if (parts.length === 0) parts.push(String(err));
      // eslint-disable-next-line no-console
      console.error("[RoundFi] settle_default failed:", err);
      setChainError(parts.join("\n"));
      setSubmitting(false);
    }
  };

  const sectionLabel = (label: string) => (
    <MonoLabel size={9} style={{ marginBottom: 6 }}>
      {label}
    </MonoLabel>
  );

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : reset}
      title={done ? "" : t("modal.settleDefault.title")}
      subtitle={done ? undefined : t("modal.settleDefault.subtitle")}
      closeable={!submitting}
      width={560}
    >
      {done && txSig ? (
        <ModalSuccess
          title={t("modal.settleDefault.success.title")}
          body={
            <>
              {t("modal.settleDefault.success.body")}
              <div style={{ marginTop: 12 }}>
                <a
                  href={explorerTx(txSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: tokens.green,
                    textDecoration: "underline",
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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
              {t("modal.settleDefault.success.cta")}
            </button>
          }
        />
      ) : (
        <>
          {/* Pool selector */}
          <div style={{ marginBottom: 16 }}>
            {sectionLabel(t("modal.settleDefault.pool"))}
            <div style={{ display: "flex", gap: 8 }}>
              {(Object.keys(DEVNET_POOLS) as DevnetPoolKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedPool(key);
                    setSelectedSlot(null);
                  }}
                  style={{
                    ...ghostBtn(tokens),
                    flex: 1,
                    borderColor: selectedPool === key ? tokens.green : tokens.border,
                    background: selectedPool === key ? `${tokens.green}1A` : "transparent",
                  }}
                >
                  {DEVNET_POOLS[key].label.split("·")[0].trim()}
                </button>
              ))}
            </div>
            <div
              style={{
                fontSize: 11,
                color: tokens.muted,
                marginTop: 6,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {DEVNET_POOLS[selectedPool].headline}
            </div>
          </div>

          {/* Pool state summary */}
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              background: tokens.fillSoft,
              border: `1px solid ${tokens.border}`,
              marginBottom: 16,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              fontSize: 11,
              color: tokens.muted,
            }}
          >
            {onChainPool.status === "loading" && t("modal.settleDefault.loading")}
            {onChainPool.status === "fallback" && t("modal.settleDefault.rpcUnavailable")}
            {onChainPool.status === "ok" && onChainPool.pool && settleCycle != null && (
              <>
                <div>
                  {t("modal.settleDefault.currentCycle")}:{" "}
                  <span style={{ color: tokens.text }}>{onChainPool.pool.currentCycle}</span> ·{" "}
                  {t("modal.settleDefault.settleCycle")}:{" "}
                  <span style={{ color: tokens.text }}>{settleCycle}</span>
                </div>
                <div>
                  next_cycle_at: {onChainPool.pool.nextCycleAt.toString()} · GRACE_PERIOD_SECS:{" "}
                  {GRACE_PERIOD_SECS.toString()}s
                </div>
                <div>
                  installment: ${(Number(installmentMissed) / 1e6).toFixed(2)} · pool float: $
                  {(Number(onChainPool.pool.solidarityBalance) / 1e6).toFixed(2)} (solidarity)
                </div>
              </>
            )}
            {onChainPool.status === "ok" && settleCycle == null && (
              <div>{t("modal.settleDefault.noPreviousCycle")}</div>
            )}
          </div>

          {/* Candidate list */}
          <div style={{ marginBottom: 16 }}>
            {sectionLabel(t("modal.settleDefault.candidates"))}
            {candidates.length === 0 ? (
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
                {t("modal.settleDefault.noCandidates")}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {candidates.map((c) => (
                  <button
                    key={c.slotIndex}
                    type="button"
                    onClick={() => setSelectedSlot(c.slotIndex)}
                    style={{
                      ...ghostBtn(tokens),
                      textAlign: "left",
                      padding: "10px 12px",
                      borderColor: selectedSlot === c.slotIndex ? tokens.green : tokens.border,
                      background:
                        selectedSlot === c.slotIndex
                          ? `${tokens.green}14`
                          : c.eligibleNow
                            ? `${tokens.green}05`
                            : "transparent",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 12,
                        color: tokens.text,
                      }}
                    >
                      <span>
                        slot {c.slotIndex} · {c.shortWallet}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          color: c.eligibleNow ? tokens.green : tokens.muted,
                          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                        }}
                      >
                        {c.eligibleNow
                          ? t("modal.settleDefault.eligible")
                          : `${t("modal.settleDefault.graceIn")} ${c.graceSecsRemaining}s`}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: tokens.muted,
                        marginTop: 4,
                        fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                      }}
                    >
                      paid: {c.contributionsPaid} · on-time: {c.onTimeCount} · escrow: $
                      {(Number(c.escrowBalance) / 1e6).toFixed(2)} · stake: $
                      {(Number(c.stakeDeposited) / 1e6).toFixed(2)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cascade preview */}
          {cascadePreview && selectedCandidate && (
            <div style={{ marginBottom: 16 }}>
              {sectionLabel(t("modal.settleDefault.cascade"))}
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${tokens.border}`,
                  background: tokens.fillSoft,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  fontSize: 11,
                  color: tokens.muted,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{t("modal.settleDefault.shield1")} · solidarity</span>
                  <span style={{ color: tokens.text }}>
                    ${(Number(cascadePreview.fromSolidarity) / 1e6).toFixed(2)}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{t("modal.settleDefault.shield2")} · escrow</span>
                  <span style={{ color: tokens.text }}>
                    ${(Number(cascadePreview.fromEscrow) / 1e6).toFixed(2)}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{t("modal.settleDefault.shield3")} · stake</span>
                  <span style={{ color: tokens.text }}>
                    ${(Number(cascadePreview.fromStake) / 1e6).toFixed(2)}
                  </span>
                </div>
                {cascadePreview.shortfall > 0n && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 6,
                      paddingTop: 6,
                      borderTop: `1px dashed ${tokens.border}`,
                      color: tokens.red ?? "#ef4444",
                    }}
                  >
                    <span>{t("modal.settleDefault.shortfall")}</span>
                    <span>${(Number(cascadePreview.shortfall) / 1e6).toFixed(2)}</span>
                  </div>
                )}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: tokens.muted,
                  marginTop: 6,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t("modal.settleDefault.cascadeNote")}
              </div>
            </div>
          )}

          {/* Error banner */}
          {chainError && (
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                background: `${tokens.red ?? "#ef4444"}14`,
                border: `1px solid ${tokens.red ?? "#ef4444"}66`,
                color: tokens.red ?? "#ef4444",
                fontSize: 11,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                whiteSpace: "pre-wrap",
                marginBottom: 12,
                maxHeight: 120,
                overflow: "auto",
              }}
            >
              {chainError}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={reset} disabled={submitting} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || !selectedCandidate || !selectedCandidate.eligibleNow}
              style={{
                ...primaryBtn(tokens),
                flex: 1,
                opacity:
                  submitting || !selectedCandidate || !selectedCandidate.eligibleNow ? 0.5 : 1,
              }}
            >
              {submitting ? t("modal.settleDefault.submitting") : t("modal.settleDefault.crank")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
