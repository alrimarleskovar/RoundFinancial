"use client";

import Link from "next/link";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { ActionsPanel } from "@/components/admin/ActionsPanel";
import { DemoPreview } from "@/components/admin/DemoPreview";
import { SetupPanel } from "@/components/admin/SetupPanel";
import { TimelinePanel } from "@/components/admin/TimelinePanel";
import { useDemoState } from "@/lib/demoState";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// /admin · Demo Studio (Phase 1).
//
// Parallel dashboard for video recording: configure a Maria-style
// scenario (carta + months + score + contemplation cycle), advance
// through time, and trigger every dramatic action — all isolated
// from the regular /home session so the production flow stays
// pristine for users.

export function AdminClient() {
  const { tokens } = useTheme();
  const t = useT();
  const ctrl = useDemoState();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: tokens.bg,
        color: tokens.text,
        fontFamily: "var(--font-dm-sans), DM Sans, system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "32px 32px 80px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 11px",
                borderRadius: 999,
                background: tokens.fillSoft,
                border: `1px solid ${tokens.border}`,
                color: tokens.text2,
                fontFamily:
                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                fontSize: 11,
                fontWeight: 600,
                textDecoration: "none",
                marginBottom: 12,
                transition: "all 220ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = `${tokens.amber}55`;
                e.currentTarget.style.color = tokens.text;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = tokens.border;
                e.currentTarget.style.color = tokens.text2;
              }}
            >
              <Icons.back size={12} stroke="currentColor" sw={2} />
              {t("admin.back")}
            </Link>
            <MonoLabel color={tokens.amber}>{t("admin.badge")}</MonoLabel>
            <div
              style={{
                fontFamily: "var(--font-syne), Syne",
                fontSize: 32,
                fontWeight: 800,
                color: tokens.text,
                letterSpacing: "-0.03em",
                marginTop: 4,
              }}
            >
              {t("admin.title")}
            </div>
            <div
              style={{
                fontSize: 13,
                color: tokens.text2,
                marginTop: 4,
                maxWidth: 720,
              }}
            >
              {t("admin.subtitle")}
            </div>
          </div>
          <button
            type="button"
            onClick={ctrl.reset}
            style={{
              padding: "10px 16px",
              borderRadius: 11,
              cursor: "pointer",
              background: `${tokens.red}14`,
              border: `1px solid ${tokens.red}55`,
              color: tokens.red,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icons.refresh size={13} stroke="currentColor" sw={2} />
            {t("admin.reset")}
          </button>
        </div>

        {/* 3-column control row */}
        <div
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 16,
          }}
        >
          <SetupPanel
            user={ctrl.state.user}
            group={ctrl.state.group}
            setUser={ctrl.setUser}
            setGroup={ctrl.setGroup}
          />
          <TimelinePanel
            currentMonth={ctrl.state.currentMonth}
            totalMonths={ctrl.state.group.months}
            contemplationMonth={ctrl.state.group.contemplationMonth}
            contemplated={ctrl.state.contemplated}
            advanceMonth={ctrl.advanceMonth}
            rewindMonth={ctrl.rewindMonth}
            jumpToContemplation={ctrl.jumpToContemplation}
          />
          <ActionsPanel ctrl={ctrl} />
        </div>

        {/* Live preview */}
        <DemoPreview state={ctrl.state} />
      </div>
    </div>
  );
}
