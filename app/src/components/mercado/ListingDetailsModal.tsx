"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Modal } from "@/components/ui/Modal";
import type { NftPosition } from "@/data/carteira";
import { useI18n, useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Active listing the user has on the secondary market.
// Created when SellPositionModal phase === "success", lives in
// MercadoClient state (no persistence — fits the demo pattern).
export interface ActiveListing {
  id: string;            // listing pk (random)
  position: NftPosition; // ref + denormalized so cancellation is local
  askPrice: number;
  discountPct: number;
  listedAt: number;      // ms epoch
  expiresAt: number;     // listedAt + 7d
}

const SLASHING_DAYS = 7;

// Detail panel for a listing the user clicked from "Minhas listagens".
// Shows pricing breakdown, days remaining (out of the 7-day Escape
// Valve window), a mock buyer-activity feed so the demo feels lived
// in, and a "Cancelar listagem" CTA that pops the listing out of
// state and returns the position to the available pool.

export function ListingDetailsModal({
  listing,
  open,
  onClose,
  onCancel,
}: {
  listing: ActiveListing | null;
  open: boolean;
  onClose: () => void;
  onCancel: (listingId: string) => void;
}) {
  const { tokens } = useTheme();
  const { fmtMoney } = useI18n();
  const t = useT();

  if (!listing) return null;

  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysElapsed = Math.max(
    0,
    Math.floor((now - listing.listedAt) / msPerDay),
  );
  const daysRemaining = Math.max(0, SLASHING_DAYS - daysElapsed);
  const progressPct = Math.min(
    100,
    Math.round((daysElapsed / SLASHING_DAYS) * 100),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("market.listingDetails.title")}
      subtitle={listing.position.group}
      width={520}
    >
      {/* Position summary */}
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          background: tokens.fillSoft,
          border: `1px solid ${tokens.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 16,
              fontWeight: 700,
              color: tokens.text,
              letterSpacing: "-0.02em",
            }}
          >
            #{listing.position.num} · {listing.position.group}
          </div>
          <div
            style={{
              fontSize: 11,
              color: tokens.muted,
              marginTop: 4,
              fontFamily:
                "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {t("home.month")} {listing.position.month}/{listing.position.total} · {listing.position.exp}
          </div>
        </div>
        <span
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            background: `${tokens.green}1F`,
            border: `1px solid ${tokens.green}55`,
            color: tokens.green,
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          ◆ {t("market.listingDetails.statusActive")}
        </span>
      </div>

      {/* Pricing breakdown */}
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          padding: 14,
          borderRadius: 12,
          background: tokens.fillSoft,
          border: `1px solid ${tokens.border}`,
        }}
      >
        <Stat
          label={t("market.sellModal.face")}
          value={fmtMoney(listing.position.value, { noCents: true })}
          color={tokens.text2}
        />
        <Stat
          label={t("market.sellModal.discount")}
          value={`−${listing.discountPct.toFixed(0)}%`}
          color={listing.discountPct > 0 ? tokens.amber : tokens.muted}
        />
        <Stat
          label={t("market.sellModal.youReceive")}
          value={fmtMoney(listing.askPrice, { noCents: true })}
          color={tokens.text}
          emphasis
        />
      </div>

      {/* Slashing countdown */}
      <div
        style={{
          marginTop: 14,
          padding: 14,
          borderRadius: 12,
          background: `${tokens.amber}0D`,
          border: `1px solid ${tokens.amber}33`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 8,
          }}
        >
          <MonoLabel size={9} color={tokens.amber}>
            {t("market.listingDetails.windowLabel")}
          </MonoLabel>
          <span
            style={{
              fontSize: 12,
              color: tokens.text,
              fontWeight: 700,
              fontFamily:
                "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            }}
          >
            {t("market.listingDetails.daysRemaining", {
              n: daysRemaining,
              total: SLASHING_DAYS,
            })}
          </span>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: tokens.fillMed,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              background: `linear-gradient(90deg, ${tokens.amber}, ${tokens.red})`,
              transition: "width 200ms ease",
            }}
          />
        </div>
        <p
          style={{
            marginTop: 8,
            fontSize: 11,
            color: tokens.text2,
            lineHeight: 1.5,
          }}
        >
          {t("market.listingDetails.windowBody")}
        </p>
      </div>

      {/* Mock buyer activity */}
      <div
        style={{
          marginTop: 14,
          padding: 14,
          borderRadius: 12,
          background: tokens.fillSoft,
          border: `1px solid ${tokens.border}`,
        }}
      >
        <MonoLabel size={9} color={tokens.muted}>
          {t("market.listingDetails.activity")}
        </MonoLabel>
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <ActivityRow
            kind="view"
            text={t("market.listingDetails.act.view", { n: 12 })}
            ts="2m"
          />
          <ActivityRow
            kind="watch"
            text={t("market.listingDetails.act.watch", { n: 3 })}
            ts="14m"
          />
          <ActivityRow
            kind="offer"
            text={t("market.listingDetails.act.offer", {
              pct: Math.max(50, listing.discountPct + 88).toString().slice(0, 2),
            })}
            ts="38m"
          />
        </div>
      </div>

      {/* Action row */}
      <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            flex: 1,
            padding: 11,
            borderRadius: 11,
            background: tokens.fillMed,
            color: tokens.text2,
            border: `1px solid ${tokens.borderStr}`,
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
          }}
        >
          {t("market.listingDetails.close")}
        </button>
        <button
          type="button"
          onClick={() => {
            onCancel(listing.id);
            onClose();
          }}
          style={{
            flex: 1.4,
            padding: 11,
            borderRadius: 11,
            background: `${tokens.red}14`,
            color: tokens.red,
            border: `1px solid ${tokens.red}55`,
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
          }}
        >
          {t("market.listingDetails.cancelListing")}
        </button>
      </div>
    </Modal>
  );
}

function Stat({
  label,
  value,
  color,
  emphasis,
}: {
  label: string;
  value: string;
  color: string;
  emphasis?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 9,
          color: tokens.muted,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: emphasis
            ? "var(--font-syne), Syne"
            : "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: emphasis ? 18 : 13,
          fontWeight: emphasis ? 800 : 600,
          color,
          letterSpacing: emphasis ? "-0.02em" : 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ActivityRow({
  kind,
  text,
  ts,
}: {
  kind: "view" | "watch" | "offer";
  text: string;
  ts: string;
}) {
  const { tokens } = useTheme();
  const accent =
    kind === "offer"
      ? tokens.green
      : kind === "watch"
      ? tokens.purple
      : tokens.text2;
  const glyph =
    kind === "offer" ? "◆" : kind === "watch" ? "★" : "•";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        fontSize: 11,
        color: tokens.text2,
        lineHeight: 1.4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span
          style={{
            color: accent,
            fontFamily:
              "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            fontWeight: 700,
            width: 14,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {glyph}
        </span>
        <span style={{ color: tokens.text }}>{text}</span>
      </div>
      <span
        style={{
          fontSize: 10,
          color: tokens.muted,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          flexShrink: 0,
        }}
      >
        {ts}
      </span>
    </div>
  );
}
