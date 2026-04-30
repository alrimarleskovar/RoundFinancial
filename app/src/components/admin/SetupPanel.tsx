"use client";

import { MonoLabel } from "@/components/brand/brand";
import type { DemoGroup, DemoUser } from "@/lib/demoState";
import { useT } from "@/lib/i18n";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Setup panel — left column of /admin's control row. Configures
// the user (name/score/level/balance) and the group (carta/months/
// installment/contemplation month). Most fields are number inputs
// with sensible bounds; level is a 3-button toggle.

export function SetupPanel({
  user,
  group,
  setUser,
  setGroup,
}: {
  user: DemoUser;
  group: DemoGroup;
  setUser: (patch: Partial<DemoUser>) => void;
  setGroup: (patch: Partial<DemoGroup>) => void;
}) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <MonoLabel color={tokens.green}>{t("admin.setup.title")}</MonoLabel>
        <span
          style={{
            fontSize: 9,
            color: tokens.muted,
            fontFamily:
              "var(--font-jetbrains-mono), JetBrains Mono, monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {t("admin.setup.hint")}
        </span>
      </div>

      {/* User row */}
      <Field label={t("admin.setup.name")}>
        <input
          type="text"
          value={user.name}
          onChange={(e) => {
            const next = e.target.value;
            const auto = next
              .split(" ")
              .filter(Boolean)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase() ?? "")
              .join("");
            setUser({ name: next, avatar: auto });
          }}
          style={inputStyle(tokens)}
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("admin.setup.score")}>
          <input
            type="number"
            value={user.score}
            min={0}
            max={1000}
            onChange={(e) => setUser({ score: clampInt(e.target.value, 0, 1000) })}
            style={inputStyle(tokens)}
          />
        </Field>
        <Field label={t("admin.setup.balance")}>
          <input
            type="number"
            value={user.balance}
            min={0}
            onChange={(e) => setUser({ balance: parseNum(e.target.value) })}
            style={inputStyle(tokens)}
          />
        </Field>
      </div>

      <Field label={t("admin.setup.level")}>
        <div style={{ display: "flex", gap: 6 }}>
          {([1, 2, 3] as const).map((lv) => {
            const active = user.level === lv;
            const labels: Record<1 | 2 | 3, string> = {
              1: t("admin.setup.lvl.iniciante"),
              2: t("admin.setup.lvl.comprovado"),
              3: t("admin.setup.lvl.veterano"),
            };
            return (
              <button
                key={lv}
                type="button"
                onClick={() => setUser({ level: lv })}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: active ? `${tokens.green}1F` : tokens.fillSoft,
                  border: `1px solid ${active ? `${tokens.green}55` : tokens.border}`,
                  color: active ? tokens.green : tokens.text2,
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily:
                    "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                  letterSpacing: "0.04em",
                }}
              >
                L{lv} · {labels[lv]}
              </button>
            );
          })}
        </div>
      </Field>

      {/* Group row */}
      <div
        style={{
          marginTop: 4,
          paddingTop: 12,
          borderTop: `1px solid ${tokens.border}`,
        }}
      >
        <MonoLabel color={tokens.teal}>{t("admin.setup.groupTitle")}</MonoLabel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("admin.setup.carta")}>
          <input
            type="number"
            value={group.carta}
            min={1000}
            step={1000}
            onChange={(e) => setGroup({ carta: parseNum(e.target.value) })}
            style={inputStyle(tokens)}
          />
        </Field>
        <Field label={t("admin.setup.months")}>
          <input
            type="number"
            value={group.months}
            min={1}
            max={60}
            onChange={(e) => setGroup({ months: clampInt(e.target.value, 1, 60) })}
            style={inputStyle(tokens)}
          />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("admin.setup.installment")}>
          <input
            type="number"
            value={group.installment}
            min={1}
            onChange={(e) => setGroup({ installment: parseNum(e.target.value) })}
            style={inputStyle(tokens)}
          />
        </Field>
        <Field label={t("admin.setup.contMonth")}>
          <input
            type="number"
            value={group.contemplationMonth}
            min={1}
            max={group.months}
            onChange={(e) =>
              setGroup({
                contemplationMonth: clampInt(e.target.value, 1, group.months),
              })
            }
            style={inputStyle(tokens)}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { tokens } = useTheme();
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span
        style={{
          fontSize: 11,
          color: tokens.text2,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function inputStyle(
  tokens: ReturnType<typeof useTheme>["tokens"],
): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 8,
    background: tokens.fillSoft,
    border: `1px solid ${tokens.border}`,
    color: tokens.text,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
    width: "100%",
    outline: "none",
  };
}

function clampInt(s: string, min: number, max: number): number {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function parseNum(s: string): number {
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}
