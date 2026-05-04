"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { Modal } from "@/components/ui/Modal";
import { ModalSuccess } from "@/components/ui/ModalSuccess";
import type { CatalogGroup } from "@/lib/groups";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

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
  const { joinGroup, user } = useSession();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const reset = () => {
    setSubmitting(false);
    setDone(false);
    onClose();
  };

  const handleConfirm = () => {
    if (!group) return;
    // Defensive guard: even if the locked branch below renders, a
    // race-condition state could try to flip to confirm. Hard-block
    // joinGroup() against the same rule the chain enforces.
    if (group.level > user.level) return;
    setSubmitting(true);
    setTimeout(() => {
      joinGroup(group);
      setSubmitting(false);
      setDone(true);
    }, 1200);
  };

  const collateralPct = group?.level === 1 ? 50 : group?.level === 2 ? 30 : 10;
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
          body={t("modal.join.success.body")}
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

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={reset} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              style={{
                ...primaryBtn(tokens),
                opacity: submitting ? 0.7 : 1,
                cursor: submitting ? "default" : "pointer",
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
