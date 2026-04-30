"use client";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Timeline panel — middle column. Shows the current month vs total
// and the contemplation marker; provides ←/→ to step through and a
// jump button to fast-forward to the contemplation event.

export function TimelinePanel({
  currentMonth,
  totalMonths,
  contemplationMonth,
  contemplated,
  advanceMonth,
  rewindMonth,
  jumpToContemplation,
}: {
  currentMonth: number;
  totalMonths: number;
  contemplationMonth: number;
  contemplated: boolean;
  advanceMonth: () => void;
  rewindMonth: () => void;
  jumpToContemplation: () => void;
}) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();

  const fillPct = (currentMonth / Math.max(1, totalMonths)) * 100;
  const contPct = (contemplationMonth / Math.max(1, totalMonths)) * 100;

  return (
    <div
      style={{
        ...glass,
        padding: 18,
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <MonoLabel color={tokens.purple}>{t("admin.timeline.title")}</MonoLabel>

      {/* Current month display */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-syne), Syne",
            fontSize: 38,
            fontWeight: 800,
            color: tokens.text,
            letterSpacing: "-0.03em",
          }}
        >
          {currentMonth}
          <span style={{ color: tokens.muted, fontWeight: 600 }}>/{totalMonths}</span>
        </span>
        <span
          style={{
            fontSize: 11,
            color: contemplated ? tokens.green : tokens.muted,
            fontWeight: 600,
            fontFamily:
              "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {contemplated
            ? `◆ ${t("admin.timeline.contemplatedAt", { m: contemplationMonth })}`
            : t("admin.timeline.contemplationOn", { m: contemplationMonth })}
        </span>
      </div>

      {/* Progress bar with contemplation marker */}
      <div style={{ position: "relative" }}>
        <div
          style={{
            height: 8,
            borderRadius: 4,
            background: tokens.fillMed,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${fillPct}%`,
              background: `linear-gradient(90deg, ${tokens.green}, ${tokens.teal})`,
              transition: "width 320ms ease",
            }}
          />
        </div>
        {/* Contemplation marker */}
        <div
          style={{
            position: "absolute",
            top: -4,
            left: `${contPct}%`,
            width: 2,
            height: 16,
            background: contemplated ? tokens.green : tokens.purple,
            transform: "translateX(-1px)",
            boxShadow: `0 0 8px ${contemplated ? tokens.green : tokens.purple}`,
          }}
          aria-hidden
        />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 6 }}>
        <ControlBtn
          onClick={rewindMonth}
          disabled={currentMonth === 0}
          tone={tokens.text2}
        >
          <Icons.back size={12} stroke="currentColor" sw={2} />
          {t("admin.timeline.prev")}
        </ControlBtn>
        <ControlBtn
          onClick={advanceMonth}
          disabled={currentMonth >= totalMonths}
          tone={tokens.green}
          primary
        >
          {t("admin.timeline.next")}
          <Icons.arrow size={12} stroke="currentColor" sw={2} />
        </ControlBtn>
      </div>

      <button
        type="button"
        onClick={jumpToContemplation}
        disabled={contemplated}
        style={{
          padding: "9px 12px",
          borderRadius: 9,
          cursor: contemplated ? "not-allowed" : "pointer",
          background: contemplated
            ? tokens.fillSoft
            : `${tokens.purple}14`,
          border: `1px solid ${contemplated ? tokens.border : `${tokens.purple}55`}`,
          color: contemplated ? tokens.muted : tokens.purple,
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
          opacity: contemplated ? 0.5 : 1,
        }}
      >
        ⏭ {t("admin.timeline.jumpToContemplation")}
      </button>
    </div>
  );
}

function ControlBtn({
  children,
  onClick,
  disabled,
  tone,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: string;
  primary?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: "9px 12px",
        borderRadius: 9,
        cursor: disabled ? "not-allowed" : "pointer",
        background: primary
          ? `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`
          : tokens.fillSoft,
        border: primary
          ? "none"
          : `1px solid ${tokens.border}`,
        color: primary ? tokens.bgDeep : tone,
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
        opacity: disabled ? 0.4 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      {children}
    </button>
  );
}
