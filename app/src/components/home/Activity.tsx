"use client";

import { MonoLabel } from "@/components/brand/brand";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Recent activity feed for /home — 4 mixed entries (parcela / yield /
// venda cota / SAS atestado). The atestado row uses a static "+18 pts"
// label instead of a money amount.

interface Row {
  l: string;
  v: number; // BRL; 0 = non-money entry
  d: string;
  toneNeg?: "default";
  monoOverride?: string;
}

const ROWS: Row[] = [
  { l: "Parcela · MEI",    v: -892.4, d: "12 ABR" },
  { l: "Yield · Kamino",   v: +52.3,  d: "10 ABR" },
  { l: "Venda cota #03",   v: +1890,  d: "05 ABR" },
  { l: "SAS atestado #12", v: 0,      d: "04 ABR", monoOverride: "+18 pts" },
];

export function Activity() {
  const { tokens } = useTheme();
  const t = useT();
  const { fmtMoney } = useI18n();

  return (
    <div
      style={{
        background: tokens.surface1,
        border: `1px solid ${tokens.border}`,
        borderRadius: 18,
        padding: 18,
      }}
    >
      <MonoLabel color={tokens.green}>{t("home.activity")}</MonoLabel>
      <div
        style={{
          marginTop: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {ROWS.map((r, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 12,
            }}
          >
            <div>
              <div style={{ color: tokens.text, fontWeight: 500 }}>{r.l}</div>
              <div
                style={{
                  fontSize: 9,
                  color: tokens.muted,
                  marginTop: 1,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {r.d}
              </div>
            </div>
            <span
              style={{
                fontFamily:
                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 12,
                fontWeight: 600,
                color:
                  r.monoOverride
                    ? tokens.purple
                    : r.v > 0
                    ? tokens.green
                    : tokens.text,
              }}
            >
              {r.monoOverride
                ? r.monoOverride
                : r.v !== 0
                ? fmtMoney(r.v, { noCents: true, signed: true })
                : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
