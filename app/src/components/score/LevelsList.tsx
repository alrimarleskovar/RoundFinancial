"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { LEVELS } from "@/data/score";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// 50/30/10 ladder column. Current level highlighted with the teal tint.

export function LevelsList() {
  const { tokens } = useTheme();
  const t = useT();

  const colorFor = (lv: 1 | 2 | 3): string =>
    lv === 1 ? tokens.amber : lv === 2 ? tokens.teal : tokens.green;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <MonoLabel color={tokens.green}>{t("score.levelsTitle")}</MonoLabel>
      {LEVELS.map((l) => {
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
              padding: 16,
              borderRadius: 14,
              background: l.current
                ? `${tokens.teal}0D`
                : tokens.surface1,
              border: `1px solid ${
                l.current ? `${tokens.teal}4D` : tokens.border
              }`,
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
                {l.current && (
                  <span
                    style={{
                      color: tokens.teal,
                      fontSize: 10,
                      marginLeft: 8,
                      fontFamily:
                        "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t("score.lvDetail", { c: l.colat, l: l.lev })}
              </div>
            </div>
            {l.unlocked ? (
              <Icons.check size={18} stroke={tokens.green} sw={2} />
            ) : (
              <Icons.lock size={18} stroke={tokens.muted} />
            )}
          </div>
        );
      })}
    </div>
  );
}
