"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import { DEVNET_POOLS } from "@/lib/devnet";
import type { CatalogGroup } from "@/lib/groups";
import { useI18n, useT } from "@/lib/i18n";
import { sendJoinPool } from "@/lib/join-pool";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { usePool, usePoolMembers } from "@/lib/usePool";
import { shortAddr, useWallet } from "@/lib/wallet";

// Confirmation modal for joining a ROSCA group. Three states:
//   - locked: group's level is above the user's tier — show the
//     gap + path to next tier, link to /insights. No confirm CTA.
//   - confirm: standard join flow with terms grid + collateral.
//   - success: ModalSuccess + redirect to /home.
//
// The on-chain join_pool instruction (M2) checks the same level
// rule. UI mirrors it so users see the block before paying gas.

export function JoinGroupModal({
  group,
  open,
  onClose,
}: {
  group: CatalogGroup | null;
  open: boolean;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();
  const { joinGroup, recordTx, user, demoActive } = useSession();
  const router = useRouter();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();
  const { explorerTx } = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);

  // ─── On-chain join detection ─────────────────────────────────────────
  // Fire a real join_pool() only when the group points at a devnet pool
  // that's still Forming with a free slot and the wallet isn't already a
  // member. Otherwise the original mock 1200ms flow runs unchanged. (No
  // devnet pool is Forming today, so this path stays dormant until one is
  // deployed — the mock fallback keeps the demo identical meanwhile.)
  const seedKey = group?.devnetPool ?? null;
  const onChainPool = usePool(seedKey ?? "pool1");
  const onChainMembers = usePoolMembers(seedKey ?? "pool1");
  const connectedWallet = adapter.publicKey;
  const freeSlot = useMemo(() => {
    if (!seedKey || onChainPool.status !== "ok" || !onChainPool.pool) return null;
    if (onChainMembers.status !== "ok") return null;
    const taken = new Set(onChainMembers.members.map((m) => m.slotIndex));
    for (let i = 0; i < onChainPool.pool.membersTarget; i++) {
      if (!taken.has(i)) return i;
    }
    return null;
  }, [seedKey, onChainPool, onChainMembers]);
  const alreadyMember =
    !!connectedWallet &&
    onChainMembers.status === "ok" &&
    onChainMembers.members.some((m) => m.wallet.equals(connectedWallet));
  const onChainReady =
    !!seedKey &&
    !!connectedWallet &&
    onChainPool.status === "ok" &&
    !!onChainPool.pool &&
    onChainPool.pool.status === "forming" &&
    onChainPool.pool.membersJoined < onChainPool.pool.membersTarget &&
    !alreadyMember &&
    freeSlot !== null;

  // ─── Real-pool guard (anti-mock) ─────────────────────────────────────
  // Mirror of PayInstallmentModal: a group pointing at a real `devnetPool`,
  // on a real connected wallet (not an admin-lab demo persona), must never
  // mock-join. When the pool can't actually be joined we say WHY and disable
  // the CTA instead of fabricating membership. Critical for the team test:
  // once the fast pool (pool6) fills, a late joiner would otherwise
  // mock-"join" a full pool and see a fake success. `mockMode` keeps
  // fixtures + demo personas untouched.
  const mockMode = !seedKey || demoActive;
  const joinGate: "loading" | "noWallet" | "alreadyMember" | "closed" | "unavailable" | null =
    mockMode
      ? null
      : onChainReady
        ? null
        : onChainPool.status === "loading"
          ? "loading"
          : onChainPool.status === "fallback"
            ? "unavailable"
            : !connectedWallet
              ? "noWallet"
              : alreadyMember
                ? "alreadyMember"
                : "closed";

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    setTxSig(null);
    setChainError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!group) return;
    // Defensive guard: even if the locked branch below renders, a
    // race-condition state could try to flip to confirm. Hard-block
    // joinGroup() against the same rule the chain enforces.
    if (group.level > user.level) return;
    // `joinGate` ⇒ real devnet pool that can't be joined right now (full,
    // already-member, unreachable…). The CTA is disabled in that state;
    // this guard makes the no-op explicit so we never reach the mock path.
    if (joinGate) return;
    setSubmitting(true);
    setChainError(null);

    if (onChainReady && connectedWallet && adapter.sendTransaction && freeSlot !== null) {
      try {
        const sig = await sendJoinPool({
          connection,
          sendTransaction: adapter.sendTransaction,
          pool: DEVNET_POOLS[seedKey!].pda,
          memberWallet: connectedWallet,
          slotIndex: freeSlot,
        });
        setTxSig(sig);
        // Record the REAL join as a ledger event with the actual signature so
        // /carteira + the Activity feed reflect it. On a real wallet we skip
        // the mock JOIN_GROUP reducer (it debits a fictional fee from a
        // session balance the on-chain bridge owns); the membership itself
        // surfaces from useMyDevnetPositions on the next poll. Demo personas
        // keep the mock flow for the pitch.
        if (demoActive) {
          joinGroup(group);
        } else {
          recordTx({ kind: "join", amountBrl: 0, target: group.name, txid: sig });
        }
        void onChainPool.refresh();
        void onChainMembers.refresh();
        setSubmitting(false);
        setDone(true);
      } catch (err) {
        // Phantom often surfaces a generic message while the real revert
        // log lives on err.logs — concatenate everything for a diagnosable
        // banner (same pattern as PayInstallmentModal).
        const e = err as { message?: string; logs?: string[]; cause?: unknown };
        const parts: string[] = [];
        if (e.message) parts.push(e.message);
        if (Array.isArray(e.logs) && e.logs.length > 0) parts.push("logs:\n" + e.logs.join("\n"));
        if (e.cause) parts.push("cause: " + String(e.cause));
        if (parts.length === 0) parts.push(String(err));
        // eslint-disable-next-line no-console
        console.error("[RoundFi] join_pool failed:", err);
        setChainError(parts.join("\n"));
        setSubmitting(false);
      }
      return;
    }

    // Mock fallback — only reachable in `mockMode` (pure fixtures + demo
    // personas); the `joinGate` guard above stops real devnet pools from
    // landing here. Preserves the original demo flow exactly.
    setTimeout(() => {
      joinGroup(group);
      setSubmitting(false);
      setDone(true);
    }, 1200);
  };

  // v5.2 ladder 50/25/10/3 (pre-redeploy — see lib/session.tsx note).
  const collateralPct =
    group?.level === 1 ? 50 : group?.level === 2 ? 25 : group?.level === 4 ? 3 : 10;
  const locked = group ? group.level > user.level && !group.joined : false;
  const pointsNeeded = group && locked ? Math.max(0, user.nextLevel - user.score) : 0;

  if (!group) return null;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : reset}
      title={
        done
          ? ""
          : locked
            ? t("modal.join.locked.title", { lv: group.level })
            : t("modal.join.title")
      }
      subtitle={
        done ? undefined : locked ? t("modal.join.locked.subtitle") : t("modal.join.subtitle")
      }
      closeable={!submitting}
    >
      {locked ? (
        <>
          {/* Tier gap card */}
          <div
            style={{
              padding: 18,
              borderRadius: 14,
              background: `${tokens.amber}14`,
              border: `1px solid ${tokens.amber}33`,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 12,
                color: tokens.amber,
                fontWeight: 700,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              <Icons.lock size={14} stroke={tokens.amber} />
              {t("modal.join.locked.gapBadge", {
                cur: user.level,
                req: group.level,
              })}
            </div>
            <div
              style={{
                fontSize: 12,
                color: tokens.text,
                lineHeight: 1.6,
              }}
            >
              {t("modal.join.locked.body", {
                req: group.level,
                pts: pointsNeeded,
                target: user.nextLevel,
              })}
            </div>
          </div>

          {/* Score progress */}
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                fontSize: 11,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                marginBottom: 6,
              }}
            >
              <span>
                {t("modal.join.locked.scoreLabel")}: {user.score}
              </span>
              <span>{user.nextLevel}</span>
            </div>
            <div
              style={{
                height: 6,
                background: tokens.fillMed,
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, (user.score / user.nextLevel) * 100)}%`,
                  background: `linear-gradient(90deg, ${tokens.teal}, ${tokens.purple})`,
                }}
              />
            </div>
          </div>

          {/* CTA row */}
          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
            }}
          >
            <button type="button" onClick={reset} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                router.push("/insights");
              }}
              style={primaryBtn(tokens)}
            >
              {t("modal.join.locked.cta")}
            </button>
          </div>
        </>
      ) : done ? (
        <ModalSuccess
          title={t("modal.join.success.title")}
          body={
            txSig ? (
              <>
                {t("modal.join.success.body")}
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
              t("modal.join.success.body")
            )
          }
          cta={
            <button
              type="button"
              onClick={() => {
                reset();
                router.push("/home");
              }}
              style={primaryBtn(tokens)}
            >
              {t("modal.join.success.cta")}
            </button>
          }
        />
      ) : (
        <>
          {/* Group header */}
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
                background: `${toneColor(tokens, group.tone)}1A`,
                border: `1px solid ${toneColor(tokens, group.tone)}4D`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
              }}
            >
              {group.emoji}
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text }}>{group.name}</div>
              <div
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                Lv.{group.level} · {group.filled}/{group.total} cotas
              </div>
            </div>
          </div>

          {/* Terms grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 18,
            }}
          >
            <Cell
              label={t("modal.join.summary.prize")}
              value={fmtMoney(group.prize, { noCents: true })}
              tokens={tokens}
            />
            <Cell
              label={t("modal.join.summary.duration")}
              value={`${group.months} m`}
              tokens={tokens}
            />
            <Cell
              label={t("modal.join.summary.installment")}
              value={fmtMoney(group.installment, { noCents: true })}
              tokens={tokens}
            />
            <Cell
              label={t("modal.join.summary.collateral")}
              value={`${collateralPct}%`}
              tokens={tokens}
            />
          </div>

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: `${tokens.green}0F`,
              border: `1px solid ${tokens.green}33`,
              fontSize: 11,
              color: tokens.text2,
              marginBottom: 18,
            }}
          >
            <span style={{ color: tokens.green, fontWeight: 600 }}>
              {t("modal.join.summary.fee")}:
            </span>{" "}
            {t("modal.join.summary.feeValue")} —{" "}
            {fmtMoney(group.installment * 0.015, { noCents: true })} por parcela.
          </div>

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

          {/* Real-pool gate — explains why joining isn't available right now
              (pool full / already a member / unreachable) instead of
              silently firing the mock join. */}
          {joinGate ? (
            <div
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: `${tokens.amber}14`,
                border: `1px solid ${tokens.amber}33`,
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <MonoLabel size={9} color={tokens.amber}>
                {t("modal.join.gate.label")}
              </MonoLabel>
              <span style={{ flex: 1, fontSize: 11, color: tokens.text2, lineHeight: 1.5 }}>
                {t(`modal.join.gate.${joinGate}`)}
              </span>
            </div>
          ) : null}

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={reset} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || !!joinGate}
              style={{
                ...primaryBtn(tokens),
                opacity: submitting || joinGate ? 0.45 : 1,
                cursor: submitting || joinGate ? "default" : "pointer",
              }}
            >
              {submitting ? t("modal.processing") : t("modal.join.cta")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Helpers ────────────────────────────────────────────────
function Cell({
  label,
  value,
  tokens,
}: {
  label: string;
  value: string;
  tokens: ReturnType<typeof useTheme>["tokens"];
}) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 10,
        background: tokens.fillSoft,
        border: `1px solid ${tokens.border}`,
      }}
    >
      <MonoLabel size={9}>{label}</MonoLabel>
      <div
        style={{
          fontFamily: "var(--font-syne), Syne",
          fontSize: 16,
          fontWeight: 700,
          color: tokens.text,
          marginTop: 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function toneColor(tokens: ReturnType<typeof useTheme>["tokens"], tone: CatalogGroup["tone"]) {
  switch (tone) {
    case "g":
      return tokens.green;
    case "t":
      return tokens.teal;
    case "p":
      return tokens.purple;
    case "a":
      return tokens.amber;
    case "r":
      return tokens.red;
  }
}

export function primaryBtn(tokens: ReturnType<typeof useTheme>["tokens"]): React.CSSProperties {
  return {
    padding: "10px 18px",
    borderRadius: 11,
    border: "none",
    cursor: "pointer",
    background: `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
  };
}

export function ghostBtn(tokens: ReturnType<typeof useTheme>["tokens"]): React.CSSProperties {
  return {
    padding: "10px 18px",
    borderRadius: 11,
    cursor: "pointer",
    background: tokens.fillSoft,
    border: `1px solid ${tokens.border}`,
    color: tokens.text,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
  };
}
