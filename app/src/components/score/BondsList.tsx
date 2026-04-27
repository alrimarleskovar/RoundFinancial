"use client";

import { MonoLabel, RFIPill } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import {
  SAS_BONDS,
  SAS_TOTAL_CYCLES,
  SAS_TOTAL_INSTALLMENTS,
} from "@/data/score";
import type { Tone } from "@/data/carteira";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Two-column grid of emitted SAS bonds (active or completed).

export function BondsList() {
  const { tokens } = useTheme();
  const t = useT();

  const toneColor = (tone: Tone): string => {
    switch (tone) {
      case "g": return tokens.green;
      case "t": return tokens.teal;
      case "p": return tokens.purple;
      case "a": return tokens.amber;
      case "r": return tokens.red;
    }
  };

  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <MonoLabel color={tokens.green}>{t("score.bondsTitle")}</MonoLabel>
        <span
          style={{
            fontSize: 11,
            color: tokens.muted,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {t("score.bondsTotals", {
            n: SAS_TOTAL_INSTALLMENTS,
            c: SAS_TOTAL_CYCLES,
          })}
        </span>
      </div>
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
        }}
      >
        {SAS_BONDS.map((b) => {
          const c = toneColor(b.tone);
          return (
            <div
              key={b.id}
              style={{
                padding: 14,
                borderRadius: 14,
                background: tokens.surface1,
                border: `1px solid ${tokens.border}`,
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: `${c}1A`,
                  border: `1px solid ${c}4D`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icons.shield size={20} stroke={c} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: tokens.text,
                  }}
                >
                  {b.cycle}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: tokens.muted,
                    marginTop: 2,
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  }}
                >
                  {b.date} ·{" "}
                  {t("score.bondAttest", { n: b.installments })}
                </div>
              </div>
              {b.status === "active" ? (
                <RFIPill tone={b.tone}>{t("score.bondActive")}</RFIPill>
              ) : (
                <RFIPill tone="n">{t("score.bondClosed")}</RFIPill>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
