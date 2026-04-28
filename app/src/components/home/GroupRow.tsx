"use client";

import { Icons } from "@/components/brand/icons";
import type { ActiveGroup } from "@/data/groups";
import { useI18n, useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Compact row for the "Seus grupos" list under the FeaturedGroup card.

export function GroupRow({ g }: { g: ActiveGroup }) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();

  const tc = ((): string => {
    switch (g.tone) {
      case "g": return tokens.green;
      case "t": return tokens.teal;
      case "p": return tokens.purple;
      case "a": return tokens.amber;
      case "r": return tokens.red;
    }
  })();

  return (
    <div
      style={{
        ...glass,
        display: "grid",
        gridTemplateColumns: "40px 1fr auto auto auto",
        gap: 16,
        alignItems: "center",
        padding: 14,
        borderRadius: 14,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: `${tc}1A`,
          border: `1px solid ${tc}4D`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
        }}
      >
        {g.emoji}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: tokens.text }}>
          {g.name}
        </div>
        <div
          style={{
            fontSize: 10,
            color: tokens.muted,
            marginTop: 2,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {t("home.month")} {String(g.month).padStart(2, "0")} / {g.total}
          {g.status === "drawn" && (
            <span style={{ color: tokens.green, marginLeft: 8 }}>
              ✓ sorteado
            </span>
          )}
        </div>
      </div>
      <div
        style={{
          width: 140,
          height: 4,
          background: tokens.fillMed,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${g.progress * 100}%`,
            height: "100%",
            background: tc,
          }}
        />
      </div>
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            fontSize: 10,
            color: tokens.muted,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {t("home.installment")}
        </div>
        <div
          style={{
            fontFamily: "var(--font-syne), Syne",
            fontSize: 13,
            fontWeight: 700,
            color: tokens.text,
          }}
        >
          {fmtMoney(g.installment, { noCents: true })}
        </div>
      </div>
      <Icons.arrow size={16} stroke={tokens.muted} />
    </div>
  );
}
