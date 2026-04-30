"use client";

import { MonoLabel, RFIPill } from "@/components/brand/brand";
import { Icons } from "@/components/brand/icons";
import type { DemoState, DemoEventKind } from "@/lib/demoState";
import { useI18n, useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Live preview row — rendered below the control row. Mirrors the
// /home dashboard layout so the boss can demo "this is what the user
// sees now" while clicking actions in the panel above. Pulls every
// value off the demo state — fully reactive, no production session
// touched.

export function DemoPreview({ state }: { state: DemoState }) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { fmtMoney } = useI18n();

  const status = state.defaulted
    ? "defaulted"
    : state.exitedViaValve
    ? "exited"
    : state.contemplated
    ? "contemplated"
    : state.currentMonth > 0
    ? "active"
    : "pending";
  const statusTone =
    status === "defaulted"
      ? tokens.red
      : status === "exited"
      ? tokens.amber
      : status === "contemplated"
      ? tokens.green
      : status === "active"
      ? tokens.teal
      : tokens.muted;
  const statusLabel = t(`admin.preview.status.${status}`);

  const escrowLocked = Math.round(state.group.carta * 0.65);
  const escrowReleased = state.contemplated
    ? Math.min(
        escrowLocked,
        Math.round((state.monthsPaid / state.group.months) * escrowLocked),
      )
    : 0;

  return (
    <div
      style={{
        marginTop: 24,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <MonoLabel color={tokens.green}>{t("admin.preview.title")}</MonoLabel>
        <span
          style={{
            fontSize: 11,
            color: tokens.muted,
            fontFamily:
              "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {t("admin.preview.hint")}
        </span>
      </div>

      {/* Hero strip */}
      <div
        style={{
          ...glass,
          padding: 22,
          borderRadius: 18,
          display: "flex",
          gap: 18,
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: tokens.bgDeep,
            fontFamily: "var(--font-syne), Syne",
            fontSize: 22,
            fontWeight: 800,
          }}
        >
          {state.user.avatar || state.user.name.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 24,
              fontWeight: 800,
              color: tokens.text,
              letterSpacing: "-0.02em",
            }}
          >
            {state.user.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: tokens.muted,
              marginTop: 4,
              fontFamily:
                "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              letterSpacing: "0.06em",
            }}
          >
            L{state.user.level} · SCORE {state.user.score} · MÊS {state.currentMonth}/{state.group.months}
          </div>
        </div>
        <RFIPill tone={status === "defaulted" ? "r" : status === "exited" ? "a" : "g"}>
          {statusLabel}
        </RFIPill>
      </div>

      {/* KPI strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
        }}
      >
        <Kpi
          label={t("admin.preview.kpi.balance")}
          value={fmtMoney(state.user.balance, { noCents: true })}
          tone={tokens.green}
        />
        <Kpi
          label={t("admin.preview.kpi.yield")}
          value={fmtMoney(state.user.yield, { noCents: false })}
          tone={tokens.teal}
        />
        <Kpi
          label={t("admin.preview.kpi.carta")}
          value={fmtMoney(state.group.carta, { noCents: true })}
          tone={tokens.purple}
        />
        <Kpi
          label={t("admin.preview.kpi.installment")}
          value={fmtMoney(state.group.installment, { noCents: true })}
          tone={tokens.amber}
        />
      </div>

      {/* Group + Activity */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 16,
        }}
      >
        {/* Group state card */}
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
          <MonoLabel color={tokens.teal}>{t("admin.preview.group.title")}</MonoLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 10,
            }}
          >
            <Stat
              label={t("admin.preview.group.monthsPaid")}
              value={`${state.monthsPaid}/${state.group.months}`}
            />
            <Stat
              label={t("admin.preview.group.escrowReleased")}
              value={fmtMoney(escrowReleased, { noCents: true })}
              color={tokens.green}
            />
            <Stat
              label={t("admin.preview.group.escrowLocked")}
              value={fmtMoney(escrowLocked - escrowReleased, { noCents: true })}
              color={tokens.amber}
            />
          </div>
          <ProgressBar
            label={t("admin.preview.group.progress")}
            pct={(state.monthsPaid / state.group.months) * 100}
            tone={tokens.teal}
          />
          <ProgressBar
            label={t("admin.preview.group.escrowProgress")}
            pct={(escrowReleased / Math.max(1, escrowLocked)) * 100}
            tone={tokens.green}
          />
          {state.contemplated && (
            <div
              style={{
                padding: 10,
                borderRadius: 9,
                background: `${tokens.green}10`,
                border: `1px solid ${tokens.green}40`,
                fontSize: 11,
                color: tokens.text2,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: tokens.green }}>
                ◆ {t("admin.preview.contemplated")}
              </strong>{" "}
              {t("admin.preview.contemplatedBody", {
                m: state.group.contemplationMonth,
                v: Math.round(state.group.carta * 0.35),
              })}
            </div>
          )}
          {state.defaulted && (
            <div
              style={{
                padding: 10,
                borderRadius: 9,
                background: `${tokens.red}10`,
                border: `1px solid ${tokens.red}40`,
                fontSize: 11,
                color: tokens.text2,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: tokens.red }}>
                ⚠ {t("admin.preview.defaulted")}
              </strong>{" "}
              {t("admin.preview.defaultedBody", {
                v: Math.round(state.group.carta * 0.1),
              })}
            </div>
          )}
          {state.exitedViaValve && (
            <div
              style={{
                padding: 10,
                borderRadius: 9,
                background: `${tokens.amber}10`,
                border: `1px solid ${tokens.amber}40`,
                fontSize: 11,
                color: tokens.text2,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: tokens.amber }}>
                🚪 {t("admin.preview.exited")}
              </strong>{" "}
              {t("admin.preview.exitedBody", {
                v: Math.round(state.group.carta * 0.88),
              })}
            </div>
          )}
        </div>

        {/* Activity log */}
        <div
          style={{
            ...glass,
            padding: 18,
            borderRadius: 16,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
            }}
          >
            <MonoLabel color={tokens.purple}>
              {t("admin.preview.activity.title")}
            </MonoLabel>
            <span
              style={{
                fontSize: 10,
                color: tokens.muted,
                fontFamily:
                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {state.events.length}
            </span>
          </div>
          {state.events.length === 0 ? (
            <div
              style={{
                padding: 16,
                textAlign: "center",
                fontSize: 11,
                color: tokens.muted,
                lineHeight: 1.5,
              }}
            >
              {t("admin.preview.activity.empty")}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              {state.events.slice(0, 20).map((e) => (
                <ActivityRow
                  key={e.id}
                  kind={e.kind}
                  label={e.label}
                  amount={e.amount}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  return (
    <div
      style={{
        ...glass,
        padding: 14,
        borderRadius: 12,
        borderTop: `2px solid ${tone}55`,
      }}
    >
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
      <div
        style={{
          marginTop: 6,
          fontFamily: "var(--font-syne), Syne",
          fontSize: 22,
          fontWeight: 800,
          color: tokens.text,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
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
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          fontSize: 13,
          fontWeight: 700,
          color: color ?? tokens.text,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ProgressBar({
  label,
  pct,
  tone,
}: {
  label: string;
  pct: number;
  tone: string;
}) {
  const { tokens } = useTheme();
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 9,
            color: tokens.muted,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontFamily:
              "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: tokens.text2,
            fontFamily:
              "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {clamped.toFixed(0)}%
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
            width: `${clamped}%`,
            background: tone,
            transition: "width 320ms ease",
          }}
        />
      </div>
    </div>
  );
}

function ActivityRow({
  kind,
  label,
  amount,
}: {
  kind: DemoEventKind;
  label: string;
  amount: number;
}) {
  const { tokens } = useTheme();
  const tone = ((): string => {
    switch (kind) {
      case "installment": return tokens.green;
      case "contemplated": return tokens.teal;
      case "default": return tokens.red;
      case "sale": return tokens.amber;
      case "yieldHarvest": return tokens.purple;
      case "monthAdvance": return tokens.text2;
      default: return tokens.muted;
    }
  })();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 10px",
        borderRadius: 8,
        background: tokens.fillSoft,
        border: `1px solid ${tokens.border}`,
      }}
    >
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          background: tone,
          flexShrink: 0,
          boxShadow: `0 0 6px ${tone}`,
        }}
      />
      <span
        style={{
          fontSize: 11,
          color: tokens.text,
          fontWeight: 500,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {amount !== 0 && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: amount > 0 ? tokens.green : tokens.text,
            fontFamily:
              "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            flexShrink: 0,
          }}
        >
          {amount > 0 ? "+" : ""}
          {amount.toLocaleString()}
        </span>
      )}
    </div>
  );
}
