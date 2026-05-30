"use client";

/**
 * Minimal presentational primitives for the /admin/ops console (ADR 0009).
 * Operational console aesthetic: dark, clean type, big metrics, simple
 * tables — no neon/effects. Accent colors are used only for status/health
 * pills, never for decoration.
 */

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { Icons } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

const MONO = "var(--font-geist-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

/** Relative time MAGNITUDE from a unix-seconds timestamp; "—" when null.
 *  Language-neutral (no "ago"/"atrás") — callers wrap with t("adminops.ago")
 *  when they want the localized "X ago" phrasing. */
export function agoLabel(unix: number | null | undefined): string {
  if (unix == null) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
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

/** Thousands grouping for an integer-ish value (en-US grouping). */
function group(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Integer with thousands separators. Scales to large counts (1M+ users). */
export function formatInt(n: number | string): string {
  const s = String(n);
  const neg = s.startsWith("-");
  return (neg ? "-" : "") + group(neg ? s.slice(1) : s);
}

/**
 * Format USDC base units (6 decimals) → human "1,234.56". Uses BigInt so it
 * stays exact at any scale (no f64 rounding). DISPLAY ONLY — the canonical
 * base-unit value is never mutated. Accepts the serialized string the API
 * sends. "—" on bad input.
 */
export function formatUsdc(baseUnits: string | number | bigint): string {
  let b: bigint;
  try {
    b = BigInt(baseUnits);
  } catch {
    return "—";
  }
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const whole = abs / 1_000_000n;
  const cents = ((abs % 1_000_000n) / 10_000n).toString().padStart(2, "0"); // truncated, 2dp
  return `${neg ? "-" : ""}${group(whole.toString())}.${cents}`;
}

/** Basis points → "12.3%"; "—" when null. */
export function formatPct(bps: number | null | undefined): string {
  return bps == null ? "—" : `${(bps / 100).toFixed(1)}%`;
}

export function MonoLabel({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  const { tokens } = useTheme();
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: strong ? 12 : 11,
        letterSpacing: 0.6,
        fontWeight: strong ? 700 : 400,
        textTransform: "uppercase",
        color: strong ? tokens.text : tokens.muted,
      }}
    >
      {children}
    </span>
  );
}

/** Compact "i" icon with a hover/focus tooltip (1-2 lines, concise). Used
 *  next to Section titles and StatCard labels to explain a definition that
 *  reuses behavioral.ts / ADR 0009 semantics. Accessible (keyboard focus,
 *  aria-label). Body text is passed already-translated by the caller. */
export function InfoTooltip({ text }: { text: string }) {
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        marginLeft: 6,
        cursor: "help",
        color: tokens.muted,
        outline: "none",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      role="img"
      aria-label={text}
    >
      <Icons.info size={13} sw={1.7} />
      {open ? (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: tokens.surface3,
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 12,
            fontWeight: 400,
            color: tokens.text,
            width: 240,
            lineHeight: 1.5,
            zIndex: 20,
            textTransform: "none",
            letterSpacing: 0,
            fontFamily: "inherit",
            textAlign: "left",
            whiteSpace: "normal",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            pointerEvents: "none",
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

export function Section({
  title,
  note,
  tooltip,
  children,
}: {
  title: string;
  note?: ReactNode;
  tooltip?: string;
  children: ReactNode;
}) {
  const { tokens } = useTheme();
  return (
    <section style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        {/* Small brand accent — chrome only; data/tables stay clean. */}
        <span
          style={{
            width: 3,
            height: 17,
            borderRadius: 2,
            background: tokens.teal,
            flexShrink: 0,
          }}
        />
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: tokens.text }}>{title}</h2>
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
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
  tooltip,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "muted";
  tooltip?: string;
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
      <div style={{ display: "flex", alignItems: "center" }}>
        <MonoLabel strong>{label}</MonoLabel>
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </div>
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
  const t = useT();
  const color =
    health === "healthy" ? tokens.green : health === "at_risk" ? tokens.amber : tokens.red;
  return <Pill text={t(`adminops.health.${health}`)} color={color} />;
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
  const t = useT();
  // "payout"/"default" are technical event labels — kept verbatim, not chrome.
  if (eventType === "Claim") return <Pill text="payout" color={tokens.teal} />;
  if (eventType === "Default") return <Pill text="default" color={tokens.red} />;
  if (deltaSeconds == null) return <Pill text="—" color={tokens.muted} />;
  if (deltaSeconds <= 0) return <Pill text={t("adminops.timing.onTime")} color={tokens.green} />;
  if (graceUsed) return <Pill text={t("adminops.timing.grace")} color={tokens.amber} />;
  return <Pill text={t("adminops.timing.late")} color={tokens.red} />;
}

/** Shared <thead> styling: subtle surface tint + teal accent rule + heavier
 *  label weight so headers stand out vs clean data rows. Returned as a styles
 *  bag so pages can spread directly into their <tr>/<th>. */
export function tableHeadStyles(tokens: ReturnType<typeof useTheme>["tokens"]) {
  return {
    row: {
      background: tokens.surface2,
      borderBottom: `1px solid ${tokens.teal}55`,
    } as CSSProperties,
    cell: {
      textAlign: "left" as const,
      fontFamily: MONO,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.6,
      textTransform: "uppercase" as const,
      padding: "10px 12px",
      color: tokens.text,
      whiteSpace: "nowrap" as const,
    } as CSSProperties,
  };
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

/** Ticks once per second so any "served Xs ago" label updates between
 *  fetches without re-running the network request. Use in pages that read
 *  servedAtUnix from a useApi response. */
export function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Small bar above each page showing the data's freshness and (when on a
 *  timed cadence) when the next auto-refresh will hit. Manual reload always
 *  available — auto-refresh just removes the click on operational pages. */
export function RefreshBar({
  cadenceSeconds,
  servedAtUnix,
  onReload,
  loading,
}: {
  cadenceSeconds: number | null;
  servedAtUnix: number | null;
  onReload: () => void;
  loading: boolean;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const now = useNowSeconds();
  const handle = useCallback(() => {
    if (!loading) onReload();
  }, [loading, onReload]);
  const ageSeconds = servedAtUnix == null ? null : Math.max(0, now - servedAtUnix);
  const ageLabel = ageSeconds == null ? "—" : agoLabel(now - ageSeconds);
  const cadenceLabel =
    cadenceSeconds == null
      ? t("adminops.refresh.manual", { ago: ageLabel })
      : t("adminops.refresh.auto", { s: cadenceSeconds, ago: ageLabel });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 12,
        marginBottom: 16,
        fontSize: 12,
        color: tokens.muted,
      }}
    >
      <span>{cadenceLabel}</span>
      <button
        type="button"
        onClick={handle}
        disabled={loading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          fontSize: 12,
          fontWeight: 600,
          color: tokens.text2,
          background: "transparent",
          border: `1px solid ${tokens.border}`,
          borderRadius: 8,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.5 : 1,
        }}
      >
        <Icons.refresh size={13} sw={1.7} />
        {t("adminops.refresh.button")}
      </button>
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
