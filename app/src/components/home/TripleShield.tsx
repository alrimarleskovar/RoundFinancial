"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Triplo Escudo card — 3 protection mechanisms shown as numbered tiles.

export function TripleShield() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();

  // Bilingual copy lives inline (the prototype kept these PT-only;
  // the equivalent EN strings would be a future i18n pass).
  const items = [
    {
      n: "01",
      title: "Sorteio Semente",
      desc: "91,6% retido Mês 1",
      c: tokens.green,
    },
    {
      n: "02",
      title: "Escrow Adaptativo",
      desc: "65% nunca sai do contrato",
      c: tokens.teal,
    },
    {
      n: "03",
      title: "Cofre + Yield",
      desc: "1% cofre + 6,8% APY Kamino",
      c: tokens.purple,
    },
  ];

  return (
    <div
      style={{
        ...glass,
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icons.shield size={16} stroke={tokens.green} />
        <MonoLabel color={tokens.green}>{t("home.shield")}</MonoLabel>
      </div>
      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {items.map((i) => (
          <div
            key={i.n}
            style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                flexShrink: 0,
                background: `${i.c}1A`,
                border: `1px solid ${i.c}4D`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily:
                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 10,
                color: i.c,
                fontWeight: 600,
              }}
            >
              {i.n}
            </div>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: tokens.text,
                }}
              >
                {i.title}
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
                {i.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
