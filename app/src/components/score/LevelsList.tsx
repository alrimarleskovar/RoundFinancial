"use client";

import { useRouter } from "next/navigation";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { LEVELS } from "@/data/score";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// 50/30/10 ladder column. Current level highlighted with the teal
// tint. Bottom CTA bridges to /insights for the score-up path —
// matches the locked-modal patterns on /grupos.

export function LevelsList() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { user } = useSession();
  const router = useRouter();
  const pointsToNext = Math.max(0, user.nextLevel - user.score);
  const atTopTier = user.level >= 3;

  const colorFor = (lv: 1 | 2 | 3): string =>
    lv === 1 ? tokens.amber : lv === 2 ? tokens.teal : tokens.green;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <MonoLabel color={tokens.green}>{t("score.levelsTitle")}</MonoLabel>
      {LEVELS.map((l) => {
        // Derive current/unlocked from live session state — the fixture
        // values were a static snapshot and would never reflect a
        // levelup mid-session.
        const isCurrent = l.lv === user.level;
        const isUnlocked = l.lv <= user.level;
        const c = colorFor(l.lv);
        const localizedName =
          l.lv === 1
            ? t("level.beginner")
            : l.lv === 2
              ? t("level.provenName")
              : t("level.veteran");
        return (
          <div
            key={l.lv}
            style={{
              ...glass,
              padding: 16,
              borderRadius: 14,
              ...(isCurrent
                ? {
                    background: `${tokens.teal}1A`,
                    border: `1px solid ${tokens.teal}4D`,
                  }
                : null),
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: `${c}1A`,
                border: `1px solid ${c}4D`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-syne), Syne",
                fontSize: 20,
                fontWeight: 800,
                color: c,
              }}
            >
              {l.lv}
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: tokens.text,
                }}
              >
                {localizedName}
                {l.vip && (
                  <span
                    style={{
                      color: tokens.green,
                      fontSize: 12,
                      marginLeft: 6,
                    }}
                  >
                    ✦ VIP
                  </span>
                )}
                {isCurrent && (
                  <span
                    style={{
                      color: tokens.teal,
                      fontSize: 10,
                      marginLeft: 8,
                      fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    }}
                  >
                    {t("level.youLabel")}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: tokens.muted,
                  marginTop: 3,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t("score.lvDetail", { c: l.colat, l: l.lev })}
              </div>
            </div>
            {isUnlocked ? (
              <Icons.check size={18} stroke={tokens.green} sw={2} />
            ) : (
              <Icons.lock size={18} stroke={tokens.muted} />
            )}
          </div>
        );
      })}

      {!atTopTier && (
        <button
          type="button"
          onClick={() => router.push("/insights")}
          style={{
            ...glass,
            marginTop: 4,
            padding: 14,
            borderRadius: 14,
            cursor: "pointer",
            border: `1px solid ${tokens.teal}33`,
            background: `${tokens.teal}0D`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
            color: tokens.text,
            transition: "border-color 180ms ease, background 180ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = `${tokens.teal}66`;
            e.currentTarget.style.background = `${tokens.teal}1A`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = `${tokens.teal}33`;
            e.currentTarget.style.background = `${tokens.teal}0D`;
          }}
        >
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{t("score.levelUp.title")}</div>
            <div
              style={{
                marginTop: 3,
                fontSize: 10,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {t("score.levelUp.gap", { pts: pointsToNext })}
            </div>
          </div>
          <Icons.arrow size={16} stroke={tokens.teal} sw={2} />
        </button>
      )}
    </div>
  );
}
