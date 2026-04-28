"use client";

import { MonoLabel } from "@/components/brand/brand";
import { useI18n, useT } from "@/lib/i18n";
import { useSession, type SessionEventKind } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Live activity feed driven by the session orchestrator. New events
// hit the top of the list as the user pays installments / sells
// shares / receives ambient yield. Limited to the last 6 entries
// to keep the card compact.

const MAX_ROWS = 6;

const RELATIVE_TIME_THRESHOLDS_PT: Array<[number, (n: number) => string]> = [
  [60_000, () => "agora"],
  [3_600_000, (s) => `há ${Math.floor(s / 60_000)} min`],
  [86_400_000, (s) => `há ${Math.floor(s / 3_600_000)} h`],
  [Infinity, (s) => `há ${Math.floor(s / 86_400_000)} d`],
];
const RELATIVE_TIME_THRESHOLDS_EN: Array<[number, (n: number) => string]> = [
  [60_000, () => "now"],
  [3_600_000, (s) => `${Math.floor(s / 60_000)}m ago`],
  [86_400_000, (s) => `${Math.floor(s / 3_600_000)}h ago`],
  [Infinity, (s) => `${Math.floor(s / 86_400_000)}d ago`],
];

function formatRelative(ts: number, lang: string): string {
  const delta = Date.now() - ts;
  const table = lang === "pt"
    ? RELATIVE_TIME_THRESHOLDS_PT
    : RELATIVE_TIME_THRESHOLDS_EN;
  for (const [bound, fmt] of table) {
    if (delta < bound) return fmt(delta);
  }
  return ts.toString();
}

export function Activity() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney, lang } = useI18n();
  const { events } = useSession();

  const rows = events.slice(0, MAX_ROWS);

  const colorFor = (kind: SessionEventKind): string => {
    if (kind === "yield" || kind === "sale") return tokens.green;
    if (kind === "attestation") return tokens.purple;
    if (kind === "join") return tokens.teal;
    return tokens.amber; // payment
  };

  return (
    <div
      style={{
        ...glass,
        borderRadius: 18,
        padding: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <MonoLabel color={tokens.green}>{t("home.activity")}</MonoLabel>
        {/* Faux blinking cursor for the "live terminal" feel */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 9,
            color: tokens.muted,
            fontFamily:
              "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              width: 6,
              height: 10,
              background: tokens.green,
              animation: "rfi-pulse 1.2s ease-in-out infinite",
            }}
          />
          live
        </span>
      </div>

      <div
        style={{
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 11,
          lineHeight: 1.7,
          color: tokens.text2,
        }}
      >
        {rows.map((r, i) => {
          const c = colorFor(r.kind);
          const amount = r.attestPts != null
            ? `+${r.attestPts} pts`
            : r.amountBrl !== 0
            ? fmtMoney(r.amountBrl, { noCents: true, signed: true })
            : "—";
          return (
            <div
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto 1fr auto auto",
                gap: 10,
                alignItems: "center",
                padding: "4px 0",
                borderBottom:
                  i < rows.length - 1
                    ? `1px dashed ${tokens.border}`
                    : "none",
              }}
            >
              {/* prompt > */}
              <span style={{ color: c, fontWeight: 700 }}>{">"}</span>
              {/* timestamp */}
              <span style={{ color: tokens.muted, fontSize: 10 }}>
                [{formatRelative(r.ts, lang)}]
              </span>
              {/* op + target */}
              <span
                style={{
                  color: tokens.text,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <span style={{ color: c }}>{r.op}</span>
                <span style={{ color: tokens.muted }}> · {r.target}</span>
              </span>
              {/* amount */}
              <span
                style={{
                  color: c,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {amount}
              </span>
              {/* txid */}
              <span style={{ color: tokens.muted, fontSize: 9 }}>{r.txid}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
