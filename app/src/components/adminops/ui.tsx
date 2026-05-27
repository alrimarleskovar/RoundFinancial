"use client";

/**
 * Minimal presentational primitives for the /admin/ops console (ADR 0009).
 * Operational console aesthetic: dark, clean type, big metrics, simple
 * tables — no neon/effects. Accent colors are used only for status/health
 * pills, never for decoration.
 */

import type { ReactNode } from "react";

import { useTheme } from "@/lib/theme";

const MONO = "var(--font-geist-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

/** Relative time label from a unix-seconds timestamp; "—" when null. */
export function agoLabel(unix: number | null | undefined): string {
  if (unix == null) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.floor(s / 60)}m atrás`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86_400)}d atrás`;
}

/** Humanized duration from seconds; "—" when null. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.abs(seconds);
  if (s < 60) return `${seconds}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86_400).toFixed(1)}d`;
}

export function MonoLabel({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: tokens.muted,
      }}
    >
      {children}
    </span>
  );
}

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  const { tokens } = useTheme();
  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0, color: tokens.text2 }}>{title}</h2>
        {note ? <span style={{ fontSize: 12, color: tokens.muted }}>{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "muted";
}) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 12,
        background: tokens.surface1,
        border: `1px solid ${tokens.border}`,
        minWidth: 0,
      }}
    >
      <MonoLabel>{label}</MonoLabel>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          marginTop: 8,
          color: tone === "muted" ? tokens.muted : tokens.text,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
      {sub ? <div style={{ fontSize: 12, color: tokens.muted, marginTop: 6 }}>{sub}</div> : null}
    </div>
  );
}

export function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        padding: "3px 9px",
        borderRadius: 999,
        color,
        background: `${color}1A`,
        border: `1px solid ${color}33`,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
      {text}
    </span>
  );
}

export function HealthPill({ health }: { health: "healthy" | "at_risk" | "distressed" }) {
  const { tokens } = useTheme();
  if (health === "healthy") return <Pill text="saudável" color={tokens.green} />;
  if (health === "at_risk") return <Pill text="em risco" color={tokens.amber} />;
  return <Pill text="crítico" color={tokens.red} />;
}

export function StatusPill({ status }: { status: string }) {
  const { tokens } = useTheme();
  const color =
    status === "Active"
      ? tokens.green
      : status === "Forming"
        ? tokens.teal
        : status === "Completed"
          ? tokens.text2
          : status === "Liquidated"
            ? tokens.red
            : tokens.muted; // Closed / unknown
  return <Pill text={status} color={color} />;
}

/** Behavioral timing pill for a timeline row (behavioral.ts semantics):
 *  contribute → em dia / grace / atrasado from delta+grace; claim/default
 *  get their own label. Shared by the pool detail + user profile timelines. */
export function TimingPill({
  eventType,
  deltaSeconds,
  graceUsed,
}: {
  eventType: string;
  deltaSeconds: number | null;
  graceUsed: boolean;
}) {
  const { tokens } = useTheme();
  if (eventType === "Claim") return <Pill text="payout" color={tokens.teal} />;
  if (eventType === "Default") return <Pill text="default" color={tokens.red} />;
  if (deltaSeconds == null) return <Pill text="—" color={tokens.muted} />;
  if (deltaSeconds <= 0) return <Pill text="em dia" color={tokens.green} />;
  if (graceUsed) return <Pill text="grace" color={tokens.amber} />;
  return <Pill text="atrasado" color={tokens.red} />;
}

/** Honest empty state — never fill with fake data on thin devnet. */
export function Empty({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        padding: "28px 20px",
        borderRadius: 12,
        background: tokens.fillSoft,
        border: `1px dashed ${tokens.border}`,
        color: tokens.muted,
        fontSize: 13,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

/** A clearly-marked "gated pending on-devnet smoke" placeholder (ADR 0009 #5). */
export function GatedNote({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: tokens.fillSoft,
        border: `1px solid ${tokens.border}`,
        color: tokens.text2,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <Pill text="gated" color={tokens.amber} /> <span style={{ marginLeft: 8 }}>{children}</span>
    </div>
  );
}
