"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { USDC_RATE, useI18n } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme, type ThemeTokens } from "@/lib/theme";
import { shortAddr, useWallet } from "@/lib/wallet";
import { usePool, type UsePoolResult } from "@/lib/usePool";
import { DEVNET_POOLS, type DevnetPoolKey } from "@/lib/devnet";

// /home — devnet showcase row. Reads all three deployed pools live and
// renders status + cycle + members + credit so the demo can prove
// "this is real on-chain state, not a fixture" at a glance.
//
// Each card degrades gracefully: status="loading" shows a skeleton,
// status="fallback" shows a muted "rpc unavailable" line. The
// FeaturedGroup card above this one already does the same for pool2,
// so this component is a complementary fleet view.

const POOL_KEYS: DevnetPoolKey[] = ["pool1", "pool2", "pool3"];

function statusColor(name: string | undefined, tokens: ThemeTokens): string {
  switch (name) {
    case "active":
      return tokens.green;
    case "completed":
      return tokens.teal;
    case "liquidated":
      return tokens.red;
    case "forming":
    default:
      return tokens.amber;
  }
}

export function DevnetPoolStatus() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const { fmtMoney } = useI18n();
  const { explorerAddr } = useWallet();

  const pool1 = usePool("pool1");
  const pool2 = usePool("pool2");
  const pool3 = usePool("pool3");
  const results: Record<DevnetPoolKey, UsePoolResult> = {
    pool1,
    pool2,
    pool3,
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
          marginBottom: 14,
        }}
      >
        <MonoLabel color={tokens.green}>ON-CHAIN · DEVNET</MonoLabel>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 9,
            color: tokens.muted,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {POOL_KEYS.map((key) => {
          const meta = DEVNET_POOLS[key];
          const result = results[key];
          const pool = result.pool;
          const sColor = statusColor(pool?.status, tokens);
          return (
            <div
              key={key}
              style={{
                background: tokens.fillSoft,
                border: `1px solid ${tokens.borderStr}`,
                borderRadius: 14,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                minHeight: 156,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-syne), Syne",
                      fontSize: 14,
                      fontWeight: 700,
                      color: tokens.text,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {meta.label.split("·")[0]?.trim()}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: tokens.muted,
                      marginTop: 2,
                      lineHeight: 1.35,
                    }}
                  >
                    {meta.headline}
                  </div>
                </div>
                <span
                  style={{
                    flexShrink: 0,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 9,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    padding: "3px 7px",
                    borderRadius: 6,
                    background: `${sColor}1f`,
                    color: sColor,
                    border: `1px solid ${sColor}55`,
                  }}
                >
                  {pool?.status ?? (result.status === "loading" ? "…" : "n/a")}
                </span>
              </div>

              {result.status === "ok" && pool ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 11,
                    color: tokens.text2,
                  }}
                >
                  <Stat
                    label="cycle"
                    value={`${pool.currentCycle}/${pool.cyclesTotal}`}
                    tokens={tokens}
                  />
                  <Stat
                    label="members"
                    value={`${pool.membersJoined}/${pool.membersTarget}`}
                    tokens={tokens}
                  />
                  <Stat
                    label="credit"
                    value={fmtMoney((Number(pool.creditAmount) / 1e6) * USDC_RATE, {
                      noCents: true,
                    })}
                    tokens={tokens}
                  />
                  <Stat label="defaults" value={String(pool.defaultedMembers)} tokens={tokens} />
                </div>
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 10,
                    color: tokens.muted,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {result.status === "loading" ? "fetching…" : "rpc unavailable"}
                </div>
              )}

              <a
                href={explorerAddr(meta.pda.toBase58())}
                target="_blank"
                rel="noreferrer"
                style={{
                  marginTop: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  fontSize: 10,
                  color: tokens.muted,
                  textDecoration: "none",
                  paddingTop: 8,
                  borderTop: `1px dashed ${tokens.borderStr}`,
                }}
              >
                <span>{shortAddr(meta.pda.toBase58(), 5, 5)}</span>
                <Icons.arrow size={11} stroke={tokens.muted} sw={2} />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, tokens }: { label: string; value: string; tokens: ThemeTokens }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: tokens.muted,
        }}
      >
        {label}
      </span>
      <span style={{ color: tokens.text }}>{value}</span>
    </div>
  );
}
