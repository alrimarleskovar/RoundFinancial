"use client";

import { MonoLabel } from "@/components/brand/brand";
import { useI18n, useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Activity reformatted as a terminal log. Mono font everywhere,
// fixed-width columns aligned grid-style, color-coded per row
// type (in / out / attestation), tx-id prefix per entry.

type RowKind = "in" | "out" | "attestation";

interface Row {
  kind: RowKind;
  ts: string;        // "12 ABR 14:32"
  txid: string;      // truncated tx pubkey
  op: string;        // "payment.send"
  amountBrl: number; // 0 for non-money rows
  target: string;    // "escrow.usdc"
  attestPts?: number;
}

const ROWS: Row[] = [
  {
    kind: "out",
    ts: "12 ABR 14:32",
    txid: "tx_4xR9…k9Fn",
    op: "payment.send",
    amountBrl: -892.4,
    target: "escrow.usdc",
  },
  {
    kind: "in",
    ts: "10 ABR 09:15",
    txid: "tx_8mP2…aQ7L",
    op: "yield.claim",
    amountBrl: +52.3,
    target: "kamino.vault",
  },
  {
    kind: "in",
    ts: "05 ABR 18:42",
    txid: "tx_2vK7…hN4T",
    op: "secondary.market",
    amountBrl: +1890,
    target: "@petrus",
  },
  {
    kind: "attestation",
    ts: "04 ABR 22:01",
    txid: "tx_6wB3…pX1Z",
    op: "sas.attestation",
    amountBrl: 0,
    target: "civic.pass",
    attestPts: 18,
  },
];

export function Activity() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();

  const colorFor = (kind: RowKind): string => {
    if (kind === "in") return tokens.green;
    if (kind === "attestation") return tokens.purple;
    return tokens.amber;
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
        {ROWS.map((r, i) => {
          const c = colorFor(r.kind);
          const amount = r.attestPts != null
            ? `+${r.attestPts} pts`
            : r.amountBrl !== 0
            ? fmtMoney(r.amountBrl, { noCents: true, signed: true })
            : "—";
          return (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto 1fr auto auto",
                gap: 10,
                alignItems: "center",
                padding: "4px 0",
                borderBottom:
                  i < ROWS.length - 1
                    ? `1px dashed ${tokens.border}`
                    : "none",
              }}
            >
              {/* prompt > */}
              <span style={{ color: c, fontWeight: 700 }}>{">"}</span>
              {/* timestamp */}
              <span style={{ color: tokens.muted, fontSize: 10 }}>
                [{r.ts}]
              </span>
              {/* op + tx + target */}
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
