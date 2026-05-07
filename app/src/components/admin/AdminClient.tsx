"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MonoLabel } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import { ActionsPanel } from "@/components/admin/ActionsPanel";
import { DemoPreview } from "@/components/admin/DemoPreview";
import { PresetSelector } from "@/components/admin/PresetSelector";
import { SetupPanel } from "@/components/admin/SetupPanel";
import { TimelinePanel } from "@/components/admin/TimelinePanel";
import { SegToggle } from "@/components/layout/SegToggle";
import type { ActiveGroup } from "@/data/groups";
import { useDemoState, type DemoPresetId } from "@/lib/demoState";
import { useI18n, useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
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
  const i18n = useI18n();
  const ctrl = useDemoState();
  const { loadFromDemo } = useSession();
  const router = useRouter();
  const [activePresetId, setActivePresetId] = useState<DemoPresetId | null>(null);

  // Apply current demo state to the production session and route
  // to /home so the boss can navigate the real dashboard during
  // the video. Maps user fields (name, score, balance, yield,
  // level/levelLabel, avatar) AND constructs a synthetic ActiveGroup
  // from the preset's group + cycle state — FeaturedGroup picks it
  // up via session.demoGroup so the live /home reflects the chosen
  // scenario instead of the default Renovação MEI fixture.
  const applyToSession = () => {
    const levelLabel = ((): string => {
      switch (ctrl.state.user.level) {
        case 1:
          return "Iniciante";
        case 2:
          return "Comprovado";
        case 3:
          return "Veterano";
      }
    })();
    const firstName = ctrl.state.user.name.split(" ")[0] ?? "Demo";
    const groupName = `Cenário ${firstName}`;
    const tone = ctrl.state.user.level === 3 ? "p" : ctrl.state.user.level === 2 ? "g" : "a";
    const emoji = ctrl.state.user.level === 3 ? "✦" : ctrl.state.contemplated ? "🏆" : "▶";
    const remainingMonths = Math.max(0, ctrl.state.group.months - ctrl.state.currentMonth);
    const demoGroup: ActiveGroup = {
      id: "demo-active",
      name: `${groupName} · ${ctrl.state.group.months}m`,
      emoji,
      tone,
      prize: ctrl.state.group.carta,
      month: ctrl.state.currentMonth,
      total: ctrl.state.group.months,
      status: ctrl.state.contemplated ? "drawn" : "paying",
      nextDue: 5, // synthetic — admin doesn't expose due-date timing
      progress: ctrl.state.currentMonth / ctrl.state.group.months,
      members: ctrl.state.group.members,
      draw: ctrl.state.contemplated
        ? `ganho no mês ${ctrl.state.group.contemplationMonth}`
        : `em ${remainingMonths} meses`,
      installment: ctrl.state.group.installment,
      contemplated: ctrl.state.contemplated,
    };
    loadFromDemo(
      {
        name: ctrl.state.user.name,
        avatar: ctrl.state.user.avatar,
        level: ctrl.state.user.level,
        levelLabel,
        score: ctrl.state.user.score,
        balance: ctrl.state.user.balance,
        yield: ctrl.state.user.yield,
      },
      groupName,
      `Demo Studio · ${ctrl.state.user.name}`,
      demoGroup,
    );
    router.push("/home");
  };

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
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <SegToggle
              value={i18n.lang}
              onChange={i18n.setLang}
              options={[
                { v: "pt", l: "PT" },
                { v: "en", l: "EN" },
              ]}
            />
            <button
              type="button"
              onClick={() => {
                ctrl.reset();
                setActivePresetId(null);
              }}
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
            <button
              type="button"
              onClick={applyToSession}
              style={{
                padding: "10px 18px",
                borderRadius: 11,
                cursor: "pointer",
                background: `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
                border: "none",
                color: tokens.bgDeep,
                fontSize: 12,
                fontWeight: 800,
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                boxShadow: `0 8px 24px ${tokens.green}33`,
                letterSpacing: "0.02em",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = `0 12px 32px ${tokens.green}55`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = `0 8px 24px ${tokens.green}33`;
              }}
            >
              ▶ {t("admin.applyToSession")}
              <Icons.arrow size={13} stroke="currentColor" sw={2.4} />
            </button>
          </div>
        </div>

        {/* Preset selector */}
        <div style={{ marginTop: 24 }}>
          <PresetSelector
            activeId={activePresetId}
            onLoad={(id) => {
              ctrl.loadPreset(id);
              setActivePresetId(id);
            }}
          />
        </div>

        {/* 3-column control row */}
        <div
          style={{
            marginTop: 16,
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
