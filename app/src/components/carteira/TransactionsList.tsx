"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { TX_LIST } from "@/data/carteira";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Recent transactions list. Preview mode (`limit` set) shows "recent"
// heading + "See all →" hint; full mode shows every row.

export function TransactionsList({ limit }: { limit?: number }) {
  const { tokens } = useTheme();
  const { t, fmtMoney } = useI18n();
  const rows = limit ? TX_LIST.slice(0, limit) : TX_LIST;
  return (
    <div
      style={{
        padding: 20,
        borderRadius: 18,
        background: tokens.surface1,
        border: `1px solid ${tokens.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <MonoLabel color={tokens.green}>
          {limit ? t("wallet.tx.recent") : t("wallet.tx.all")}
        </MonoLabel>
        {limit && (
          <span
            style={{
              fontSize: 11,
              color: tokens.muted,
              cursor: "pointer",
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {t("wallet.tx.seeAll")}
          </span>
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        {rows.map((tx, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr auto auto",
              gap: 12,
              padding: "12px 0",
              borderBottom:
                i < rows.length - 1 ? `1px solid ${tokens.border}` : "none",
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: tokens.fillSoft,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: tx.amount > 0 ? tokens.green : tokens.text2,
              }}
            >
              {tx.amount > 0 ? (
                <Icons.arrow size={12} sw={2} />
              ) : (
                <Icons.send size={12} sw={1.8} />
              )}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: tokens.text }}>
                {tx.label}
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
                {tx.addr}
              </div>
            </div>
            <span
              style={{
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 12,
                fontWeight: 600,
                color: tx.amount > 0 ? tokens.green : tokens.text,
              }}
            >
              {fmtMoney(tx.amount, { noCents: true, signed: true })}
            </span>
            <span
              style={{
                fontSize: 10,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {tx.date}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
