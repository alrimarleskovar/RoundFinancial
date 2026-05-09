"use client";

import { MonoLabel } from "@/components/brand/brand";
import type { DemoController } from "@/lib/demoState";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Actions panel — right column. Dramatic action triggers for the
// video. Each click pushes an event onto the activity log and
// updates the demo state's user.balance / score / flags accordingly.

export function ActionsPanel({ ctrl }: { ctrl: DemoController }) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { state } = ctrl;

  return (
    <div
      style={{
        ...glass,
        padding: 18,
        borderRadius: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <MonoLabel color={tokens.amber}>{t("admin.actions.title")}</MonoLabel>

      <ActionBtn
        glyph="💰"
        label={t("admin.actions.payInstallment")}
        sub={(() => {
          // Dynamic sub-label: explains why the button is disabled when
          // applicable so jurors understand the state (cycle complete /
          // balance insufficient). Mirrors the reducer guards in
          // demoState.ts PAY_INSTALLMENT.
          if (state.monthsPaid >= state.group.months)
            return t("admin.actions.payInstallmentCycleComplete", {
              paid: state.monthsPaid,
              total: state.group.months,
            });
          if (state.user.balance < state.group.installment)
            return t("admin.actions.payInstallmentInsufficient", {
              v: state.group.installment,
            });
          return t("admin.actions.payInstallmentSub", { v: state.group.installment });
        })()}
        tone={tokens.green}
        onClick={ctrl.payInstallment}
        disabled={
          state.defaulted ||
          state.exitedViaValve ||
          state.monthsPaid >= state.group.months ||
          state.user.balance < state.group.installment
        }
      />
      <ActionBtn
        glyph="🎯"
        label={t("admin.actions.contemplate")}
        sub={
          state.contemplated
            ? t("admin.actions.contemplateAlready")
            : t("admin.actions.contemplateSub", { v: Math.round(state.group.carta * 0.35) })
        }
        tone={tokens.teal}
        onClick={ctrl.contemplate}
        disabled={state.contemplated || state.exitedViaValve || state.defaulted}
      />
      <ActionBtn
        glyph="✨"
        label={t("admin.actions.harvestYield")}
        sub={
          state.user.yield > 0
            ? t("admin.actions.harvestSub", { v: state.user.yield.toFixed(2) })
            : t("admin.actions.harvestEmpty")
        }
        tone={tokens.purple}
        onClick={ctrl.harvestYield}
        disabled={state.user.yield <= 0}
      />
      <ActionBtn
        glyph="🚪"
        label={t("admin.actions.escapeValve")}
        sub={t("admin.actions.escapeValveSub", {
          v: Math.round(state.group.carta * 0.88),
        })}
        tone={tokens.amber}
        onClick={ctrl.escapeValve}
        disabled={state.exitedViaValve || state.defaulted}
      />
      <ActionBtn
        glyph="⚠️"
        label={t("admin.actions.default")}
        sub={t("admin.actions.defaultSub", {
          v: Math.round(state.group.carta * 0.1),
        })}
        tone={tokens.red}
        onClick={ctrl.triggerDefault}
        disabled={state.defaulted || state.exitedViaValve}
      />
    </div>
  );
}

function ActionBtn({
  glyph,
  label,
  sub,
  tone,
  onClick,
  disabled,
}: {
  glyph: string;
  label: string;
  sub: string;
  tone: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        background: disabled ? tokens.fillSoft : `${tone}10`,
        border: `1px solid ${disabled ? tokens.border : `${tone}40`}`,
        color: tokens.text,
        fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
        opacity: disabled ? 0.45 : 1,
        display: "flex",
        alignItems: "center",
        gap: 10,
        transition: "all 200ms ease",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = `${tone}1F`;
        e.currentTarget.style.borderColor = `${tone}77`;
        e.currentTarget.style.transform = "translateX(2px)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = `${tone}10`;
        e.currentTarget.style.borderColor = `${tone}40`;
        e.currentTarget.style.transform = "translateX(0)";
      }}
    >
      <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{glyph}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 700,
            color: disabled ? tokens.text2 : tokens.text,
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 10,
            color: tokens.muted,
            marginTop: 2,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {sub}
        </span>
      </span>
    </button>
  );
}
