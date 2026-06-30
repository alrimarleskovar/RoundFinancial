"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { NoTransactionsYet } from "@/components/carteira/NoTransactionsYet";
import { TX_LIST, type Transaction } from "@/data/carteira";
import { useI18n } from "@/lib/i18n";
import { useIsMobile } from "@/lib/useIsMobile";
import { useMyDevnetTxHistory } from "@/lib/useMyDevnetTxHistory";
import { useMyDevnetTransfers } from "@/lib/useMyDevnetTransfers";
import { useSession, type SessionEvent } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";
import { WALLET_MOBILE_TYPE as WMT } from "@/lib/walletType";

// A real Solana signature (recorded by recordTx after a signed devnet tx)
// vs. a synthesized mock id ("tx_aB3…k9Fn"). Real sigs get shortened + linked
// to the explorer; mock ids render as-is.
function isRealSig(addr: string): boolean {
  return !addr.startsWith("tx_") && !addr.includes("…") && addr.length > 40;
}

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
  // The `payment` kind is reused for sends (wallet.send) and claim receipts
  // (pool.claim); relabel both honestly. Sends also carry the SOL/USDC
  // denomination through; a claim is a positive inflow (credit received).
  const label =
    ev.op === "wallet.send"
      ? `Envio · ${ev.target}`
      : ev.op === "pool.claim"
        ? `Recebido · ${ev.target}`
        : (labelMap[ev.kind] ?? ev.op);
  return {
    label,
    addr: ev.txid,
    amount: ev.amountBrl,
    denom: ev.denom,
    ts: ev.ts,
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

// A muted spinner row. Used in two spots: as the empty-state while the chain
// scans are still in flight (so we never flash "no transactions" before the
// Member-PDA history resolves), and as a footer while the slower transfer scan
// is still decoding txs (so the list doesn't look complete then silently grow).
function TxLoadingRow({
  label,
  color,
  muted,
  border,
}: {
  label: string;
  color: string;
  muted: string;
  border?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 0",
        color: muted,
        fontSize: 11,
        fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
        borderTop: border ? `1px solid ${border}` : "none",
      }}
    >
      <span
        style={{
          width: 11,
          height: 11,
          borderRadius: "50%",
          border: `2px solid ${muted}`,
          borderTopColor: color,
          animation: "rfi-spin 0.7s linear infinite",
          display: "inline-block",
        }}
      />
      {label}
    </div>
  );
}

export function TransactionsList({ limit, onSeeAll }: { limit?: number; onSeeAll?: () => void }) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const { t, fmtMoney } = useI18n();
  const isMobile = useIsMobile();
  const { events, demoActive } = useSession();
  const { explorerTx } = useWallet();
  // Durable on-chain history (read via getSignaturesForAddress on each Member
  // PDA) — survives a full page reload, unlike the session ledger.
  const history = useMyDevnetTxHistory();
  // Plain wallet-to-wallet SOL/USDC transfers (Send modal + incoming receipts),
  // also durable. The Member-PDA scan above can't see these — they never touch
  // a Member account — so this fills the gap and shows transfers the session
  // never witnessed (e.g. funds arriving on a second wallet).
  const transfers = useMyDevnetTransfers();

  // Live session events (newest first via reducer) sit on top: they show an
  // action the instant it confirms, before the RPC history catches up. Skip
  // attestation pings — 0-amount metadata, not money moves.
  const liveTx = events.filter((e) => e.kind !== "attestation").map(eventToTx);
  // Durable rows minus anything already shown by the session (dedup by the real
  // signature). join/contribute signatures touch the wallet too, so the
  // transfer scan is also deduped against the Member-PDA history — that scan
  // owns the labelled "Entrada / Parcela" rows.
  const liveSigs = new Set(events.map((e) => e.txid));
  const chainTx = history.txs.filter((tx) => !liveSigs.has(tx.addr));
  const chainSigs = new Set(history.txs.map((tx) => tx.addr));
  const transferTx = transfers.txs.filter(
    (tx) => !liveSigs.has(tx.addr) && !chainSigs.has(tx.addr),
  );
  // Real rows sorted newest-first by block time so the three sources interleave
  // chronologically; the demo fixture (no ts) trails in real demo mode only. A
  // fresh wallet with nothing on-chain falls through to NoTransactionsYet.
  const realTx = [...liveTx, ...chainTx, ...transferTx].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  const merged = [...realTx, ...(demoActive ? TX_LIST : [])];
  const rows = limit ? merged.slice(0, limit) : merged;
  // Either chain scan still in its first round: the Member-PDA history (fast)
  // or the wallet transfer scan (slow — decodes each tx). Drives the spinner
  // so a wallet WITH activity never flashes the empty-state, and a half-loaded
  // list shows it's still filling rather than looking final.
  const loadingChain = history.status === "loading" || transfers.status === "loading";
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
        <MonoLabel
          color={tokens.green}
          size={isMobile ? WMT.cardTitle : undefined}
          style={isMobile ? { letterSpacing: "0.04em" } : undefined}
        >
          {limit ? t("wallet.tx.recent") : t("wallet.tx.all")}
        </MonoLabel>
        {limit && onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            style={{
              fontSize: isMobile ? WMT.description : 11,
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
        {rows.length === 0 &&
          (loadingChain ? (
            <TxLoadingRow label={t("wallet.tx.loading")} color={tokens.teal} muted={tokens.muted} />
          ) : (
            <NoTransactionsYet />
          ))}
        {rows.map((tx, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr auto auto",
              gap: 12,
              padding: "12px 0",
              borderBottom: i < rows.length - 1 ? `1px solid ${tokens.border}` : "none",
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
              {tx.amount > 0 ? <Icons.arrow size={12} sw={2} /> : <Icons.send size={12} sw={1.8} />}
            </div>
            <div>
              <div
                style={{ fontSize: isMobile ? WMT.body : 12, fontWeight: 600, color: tokens.text }}
              >
                {tx.label}
              </div>
              <div
                style={{
                  fontSize: isMobile ? WMT.micro : 10,
                  color: tokens.muted,
                  marginTop: 2,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {isRealSig(tx.addr) ? (
                  <a
                    href={explorerTx(tx.addr)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: tokens.teal, textDecoration: "none" }}
                  >
                    {shortAddr(tx.addr, 6, 6)} ↗
                  </a>
                ) : (
                  tx.addr
                )}
              </div>
            </div>
            <span
              style={{
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: isMobile ? WMT.description : 12,
                fontWeight: 600,
                color: tx.amount > 0 ? tokens.green : tokens.text,
              }}
            >
              {tx.denom
                ? `${tx.amount > 0 ? "+" : ""}${Number(tx.amount.toFixed(4))} ${tx.denom}`
                : fmtMoney(tx.amount, { noCents: true, signed: true })}
            </span>
            <span
              style={{
                fontSize: isMobile ? WMT.micro : 10,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {tx.date}
            </span>
          </div>
        ))}
        {rows.length > 0 && loadingChain && (
          <TxLoadingRow
            label={t("wallet.tx.loadingMore")}
            color={tokens.teal}
            muted={tokens.muted}
            border={tokens.border}
          />
        )}
      </div>
    </div>
  );
}
