"use client";

import { useRouter } from "next/navigation";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { Modal } from "@/components/ui/Modal";
import { ghostBtn, primaryBtn } from "@/components/modals/JoinGroupModal";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

// Modal opened from the "Novo ciclo" button on /grupos. Gated by
// the Lv.3 Veteran tier — creating new cycles is a top-tier
// capability per the whitepaper. Mirrors the on-chain rule that
// `roundfi-core::create_pool` will enforce in production (M3).

export function NewCycleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tokens } = useTheme();
  const t = useT();
  const { user } = useSession();
  const router = useRouter();

  const eligible = user.level >= 3;
  const pointsNeeded = Math.max(0, user.nextLevel - user.score);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("modal.newCycle.title")}
      subtitle={eligible ? t("modal.newCycle.subtitle") : t("modal.newCycle.lockedSubtitle")}
      width={460}
    >
      {eligible ? (
        <>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: `${tokens.amber}14`,
              border: `1px solid ${tokens.amber}33`,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              fontSize: 12,
              color: tokens.text2,
              lineHeight: 1.6,
            }}
          >
            <MonoLabel size={9} color={tokens.amber}>
              {t("modal.newCycle.demoBadge")}
            </MonoLabel>
            <span>{t("modal.newCycle.demoBody")}</span>
          </div>
          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
            }}
          >
            <button type="button" onClick={onClose} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push("/insights");
              }}
              style={primaryBtn(tokens)}
            >
              {t("modal.newCycle.learnMore")}
            </button>
          </div>
        </>
      ) : (
        <>
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
              {t("modal.newCycle.gapBadge", { cur: user.level })}
            </div>
            <div
              style={{
                fontSize: 12,
                color: tokens.text,
                lineHeight: 1.6,
              }}
            >
              {t("modal.newCycle.lockedBody", {
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
                {t("modal.newCycle.scoreLabel")}: {user.score}
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

          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
            }}
          >
            <button type="button" onClick={onClose} style={ghostBtn(tokens)}>
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                router.push("/insights");
              }}
              style={primaryBtn(tokens)}
            >
              {t("modal.newCycle.cta")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
