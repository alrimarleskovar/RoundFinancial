"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { TX_LIST, type Transaction } from "@/data/carteira";
import { useI18n } from "@/lib/i18n";
import { useSession, type SessionEvent } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Recent transactions list. Preview mode (`limit` set) shows "recent"
// heading + "See all →" hint that routes back to the parent's
// transactions tab via `onSeeAll`; full mode shows every row.
//
// Live session events (purchases, sales, payments, joins, yield)
// are merged on top of the static TX_LIST so user actions show up
// here in real time across tabs.

function eventToTx(ev: SessionEvent): Transaction {
  const dateStr = formatRelative(ev.ts);
  const labelMap: Record<string, string> = {
    purchase: `Compra · ${ev.target}`,
    sale: `Venda · ${ev.target}`,
    payment: `Parcela · ${ev.target}`,
    yield: `Yield · ${ev.target}`,
    join: `Entrada · ${ev.target}`,
    attestation: `SAS · ${ev.target}`,
  };
  return {
    label: labelMap[ev.kind] ?? ev.op,
    addr: ev.txid,
    amount: ev.amountBrl,
    date: dateStr,
  };
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}m atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

export function TransactionsList({
  limit,
  onSeeAll,
}: {
  limit?: number;
  onSeeAll?: () => void;
}) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const { t, fmtMoney } = useI18n();
  const { events } = useSession();

  // Live events (newest first via reducer) prepended to static rows.
  // Skip attestation events — they're 0-amount metadata pings, not
  // "transactions" the user moves money with.
  const liveTx = events
    .filter((e) => e.kind !== "attestation")
    .map(eventToTx);
  const merged = [...liveTx, ...TX_LIST];
  const rows = limit ? merged.slice(0, limit) : merged;
  return (
    <div
      style={{
        ...glass,
        padding: 20,
        borderRadius: 18,
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
        {limit && onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            style={{
              fontSize: 11,
              color: tokens.teal,
              cursor: "pointer",
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              background: "transparent",
              border: "none",
              padding: 0,
              fontWeight: 600,
            }}
          >
            {t("wallet.tx.seeAll")}
          </button>
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
