"use client";

import { MonoLabel } from "@/components/brand/brand";
import { MARKET_OFFERS } from "@/data/market";
import { FEATURED_OFFER } from "@/data/market";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Buy-tab feedback strip: every "purchase" event from the session
// store renders as a row here. Doesn't show until at least one
// purchase has been made — keeps the Buy tab clean for new users.

const ALL_OFFERS = [
  ...MARKET_OFFERS.map((o) => ({
    id: o.id,
    num: o.num,
    group: o.group,
    face: o.face,
  })),
  {
    id: FEATURED_OFFER.id,
    num: "—",
    group: FEATURED_OFFER.group,
    face: FEATURED_OFFER.face,
  },
];

export function MyPurchases() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();
  const { events } = useSession();

  const purchases = events.filter((e) => e.kind === "purchase");
  if (purchases.length === 0) return null;

  return (
    <div
      style={{
        ...glass,
        padding: 22,
        borderRadius: 18,
        marginTop: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 14,
        }}
      >
        <MonoLabel color={tokens.green}>
          {t("market.purchases.title")}
        </MonoLabel>
        <span
          style={{
            fontSize: 11,
            color: tokens.muted,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {t("market.purchases.count", { n: purchases.length })}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {purchases.map((p) => {
          const offer = ALL_OFFERS.find((o) => o.group === p.target);
          const face = offer?.face;
          const num = offer?.num ?? "—";
          return (
            <div
              key={p.id}
              style={{
                display: "grid",
                gridTemplateColumns: "60px 1fr auto auto",
                gap: 14,
                alignItems: "center",
                padding: 14,
                borderRadius: 12,
                background: `${tokens.green}0D`,
                border: `1px solid ${tokens.green}44`,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-syne), Syne",
                  fontSize: 18,
                  fontWeight: 800,
                  color: tokens.green,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 2,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: tokens.muted,
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontWeight: 500,
                  }}
                >
                  #
                </span>
                {num}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: tokens.text,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.target}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: tokens.muted,
                    marginTop: 3,
                    fontFamily:
                      "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  }}
                >
                  {fmtMoney(Math.abs(p.amountBrl), { noCents: true })}
                  {face !== undefined &&
                    ` · ${formatTimeAgo(p.ts, t)} · ${t("market.sellModal.face")} ${fmtMoney(face, { noCents: true })}`}
                  {face === undefined && ` · ${formatTimeAgo(p.ts, t)}`}
                </div>
              </div>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: `${tokens.green}1F`,
                  border: `1px solid ${tokens.green}55`,
                  color: tokens.green,
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                ✓ {t("market.purchases.statusOwned")}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: tokens.muted,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  whiteSpace: "nowrap",
                }}
              >
                {p.txid}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatTimeAgo(ts: number, t: (k: string) => string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  // Fallback to "agora" / "now" — we don't expect demo sessions to
  // exceed 24h.
  return t("market.purchases.statusOwned");
}
