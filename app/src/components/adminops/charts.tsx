"use client";

/**
 * Lightweight SVG charts for /admin/ops/insights (ADR 0010). No external
 * library — consistent with the existing hand-rolled icons + brand surface,
 * and keeps the admin bundle thin.
 *
 * Insufficient pattern: every chart still draws the axes/grid/scaffold
 * when `insufficient` is set, and overlays a semi-transparent veil with
 * the message + progress count centered. The chart "appears" the moment
 * the threshold clears — the empty scaffold is a deliberate product cue,
 * not a placeholder.
 *
 * Colors come from theme tokens (teal, green, amber, red, muted, text);
 * the chart never invents palette.
 */

import type { ReactNode } from "react";

import { useTheme } from "@/lib/theme";

const VB_W = 400;
const VB_H = 180;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 28;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

const MONO = "var(--font-geist-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

interface InsufficientProps {
  n: number;
  threshold: number;
  message: string;
}

/** Maps a bps value (0..10_000) to a Y coordinate inside the plot area. */
function yFromBps(bps: number): number {
  const clamped = Math.max(0, Math.min(10_000, bps));
  return PAD_T + PLOT_H - (clamped / 10_000) * PLOT_H;
}

function Scaffold({
  tokens,
  axisLabels,
}: {
  tokens: ReturnType<typeof useTheme>["tokens"];
  axisLabels: string[]; // bottom labels under the plot
}) {
  // Horizontal gridlines at 0/25/50/75/100% — light, non-distracting.
  const grids = [0, 2_500, 5_000, 7_500, 10_000];
  const stepX = axisLabels.length > 0 ? PLOT_W / axisLabels.length : 0;
  return (
    <g>
      {grids.map((g) => (
        <g key={g}>
          <line
            x1={PAD_L}
            y1={yFromBps(g)}
            x2={PAD_L + PLOT_W}
            y2={yFromBps(g)}
            stroke={tokens.border}
            strokeWidth={1}
          />
          <text
            x={PAD_L - 6}
            y={yFromBps(g) + 3}
            fill={tokens.muted}
            fontSize={9}
            fontFamily={MONO}
            textAnchor="end"
          >
            {Math.round(g / 100)}%
          </text>
        </g>
      ))}
      {axisLabels.map((lbl, i) => (
        <text
          key={i}
          x={PAD_L + stepX * (i + 0.5)}
          y={VB_H - 8}
          fill={tokens.muted}
          fontSize={10}
          fontFamily={MONO}
          textAnchor="middle"
        >
          {lbl}
        </text>
      ))}
    </g>
  );
}

function Veil({
  tokens,
  insufficient,
}: {
  tokens: ReturnType<typeof useTheme>["tokens"];
  insufficient: InsufficientProps;
}) {
  // Only the n / threshold counter renders inside the SVG — short, fits.
  // The descriptive `insufficient.message` is rendered as HTML by the
  // page directly below the chart, where it can word-wrap. SVG <text>
  // can't wrap, and long PT strings overflow the 400-unit viewBox.
  return (
    <g>
      <rect
        x={PAD_L}
        y={PAD_T}
        width={PLOT_W}
        height={PLOT_H}
        fill={tokens.surface1}
        opacity={0.72}
      />
      <text
        x={PAD_L + PLOT_W / 2}
        y={PAD_T + PLOT_H / 2 + 4}
        fill={tokens.muted}
        fontSize={12}
        fontFamily={MONO}
        textAnchor="middle"
      >
        {insufficient.n} / {insufficient.threshold}
      </text>
    </g>
  );
}

function Frame({
  tokens,
  children,
}: {
  tokens: ReturnType<typeof useTheme>["tokens"];
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width="100%"
      style={{ display: "block", background: tokens.surface1, borderRadius: 8 }}
      preserveAspectRatio="xMidYMid meet"
    >
      {children}
    </svg>
  );
}

// ── GroupedBarChart ────────────────────────────────────────────────────
// 3 groups (cohorts) × 2 bars each (completion%, default%) for retention.

export interface BarSpec {
  valueBps: number | null;
  color: string;
}

export interface GroupSpec {
  label: string;
  bars: BarSpec[];
  /** Cohort size for this group. When `n === 0` the chart renders a
   *  ghost bar + "n=0" tag instead of zero-height invisible rects, so
   *  an empty cohort is distinguishable from "no data". When omitted,
   *  ghost-bar handling is skipped (back-compat). */
  n?: number;
}

/** Minimum bar height (in viewBox units) when valueBps === 0 but the
 *  cohort has observations. Without it, a real-but-zero rate is
 *  indistinguishable from a missing rate. */
const ZERO_BAR_MIN_H = 2;

function GhostGroup({
  tokens,
  groupStart,
  groupW,
}: {
  tokens: ReturnType<typeof useTheme>["tokens"];
  groupStart: number;
  groupW: number;
}) {
  // Dashed outline spanning the group's plot column + "n=0" tag.
  const innerW = groupW * 0.7;
  return (
    <g>
      <rect
        x={groupStart}
        y={PAD_T + 2}
        width={innerW}
        height={PLOT_H - 4}
        fill="none"
        stroke={tokens.muted}
        strokeDasharray="3 2"
        strokeWidth={1}
        rx={2}
        opacity={0.5}
      />
      <text
        x={groupStart + innerW / 2}
        y={PAD_T + PLOT_H / 2 + 3}
        fill={tokens.muted}
        fontSize={9}
        fontFamily={MONO}
        textAnchor="middle"
      >
        n=0
      </text>
    </g>
  );
}

function renderBarsForGroup(
  tokens: ReturnType<typeof useTheme>["tokens"],
  g: GroupSpec,
  groupStart: number,
  groupW: number,
  barW: number,
) {
  if (g.n === 0) {
    return <GhostGroup tokens={tokens} groupStart={groupStart} groupW={groupW} />;
  }
  return (
    <>
      {g.bars.map((b, bi) => {
        if (b.valueBps == null) return null;
        const x = groupStart + bi * barW;
        const y0 = yFromBps(b.valueBps);
        const naturalH = Math.max(0, PAD_T + PLOT_H - y0);
        // valueBps === 0: render a minimum-height bar so a real-but-zero
        // rate is visible, anchored to the baseline.
        const height = b.valueBps === 0 ? ZERO_BAR_MIN_H : naturalH;
        const y = b.valueBps === 0 ? PAD_T + PLOT_H - ZERO_BAR_MIN_H : y0;
        return (
          <rect key={bi} x={x} y={y} width={barW * 0.9} height={height} fill={b.color} rx={2} />
        );
      })}
    </>
  );
}

export function GroupedBarChart({
  groups,
  insufficient,
}: {
  groups: GroupSpec[];
  insufficient?: InsufficientProps;
}) {
  const { tokens } = useTheme();
  const groupW = PLOT_W / groups.length;
  const barsPerGroup = Math.max(1, groups[0]?.bars.length ?? 1);
  const barW = (groupW * 0.7) / barsPerGroup;
  return (
    <Frame tokens={tokens}>
      <Scaffold tokens={tokens} axisLabels={groups.map((g) => g.label)} />
      {!insufficient
        ? groups.map((g, gi) => {
            const groupStart = PAD_L + groupW * gi + groupW * 0.15;
            return <g key={gi}>{renderBarsForGroup(tokens, g, groupStart, groupW, barW)}</g>;
          })
        : null}
      {insufficient ? <Veil tokens={tokens} insufficient={insufficient} /> : null}
    </Frame>
  );
}

// ── BarChart with baseline ─────────────────────────────────────────────
// Predictor: one pair (with/without feature) per group + horizontal
// baseline at the overall default rate.

export function BarWithBaselineChart({
  groups,
  baselineBps,
  baselineLabel,
  insufficient,
}: {
  groups: GroupSpec[];
  baselineBps: number | null;
  baselineLabel: string;
  insufficient?: InsufficientProps;
}) {
  const { tokens } = useTheme();
  return (
    <Frame tokens={tokens}>
      <Scaffold tokens={tokens} axisLabels={groups.map((g) => g.label)} />
      {!insufficient && baselineBps != null ? (
        <g>
          <line
            x1={PAD_L}
            y1={yFromBps(baselineBps)}
            x2={PAD_L + PLOT_W}
            y2={yFromBps(baselineBps)}
            stroke={tokens.amber}
            strokeDasharray="4 3"
            strokeWidth={1.5}
          />
          <text
            x={PAD_L + PLOT_W - 6}
            y={yFromBps(baselineBps) - 4}
            fill={tokens.amber}
            fontSize={9}
            fontFamily={MONO}
            textAnchor="end"
          >
            {baselineLabel}
          </text>
        </g>
      ) : null}
      <GroupedBarsInner groups={groups} insufficient={insufficient} />
      {insufficient ? <Veil tokens={tokens} insufficient={insufficient} /> : null}
    </Frame>
  );
}

function GroupedBarsInner({
  groups,
  insufficient,
}: {
  groups: GroupSpec[];
  insufficient?: InsufficientProps;
}) {
  const { tokens } = useTheme();
  if (insufficient) return null;
  const groupW = PLOT_W / groups.length;
  const barsPerGroup = Math.max(1, groups[0]?.bars.length ?? 1);
  const barW = (groupW * 0.7) / barsPerGroup;
  return (
    <g>
      {groups.map((g, gi) => {
        const groupStart = PAD_L + groupW * gi + groupW * 0.15;
        return <g key={gi}>{renderBarsForGroup(tokens, g, groupStart, groupW, barW)}</g>;
      })}
    </g>
  );
}

// ── FunnelChart ────────────────────────────────────────────────────────
// Progression L1 → L2 → L3: horizontal stages with trapezoidal shapes that
// shrink left-to-right as the share decreases.

export interface FunnelStep {
  label: string;
  valueBps: number; // 0..10000; first step is the baseline (100%)
  color: string;
}

export function FunnelChart({
  steps,
  insufficient,
}: {
  steps: FunnelStep[];
  insufficient?: InsufficientProps;
}) {
  const { tokens } = useTheme();
  const stageW = PLOT_W / steps.length;
  // Vertical centerline; each step's height shrinks proportionally.
  const midY = PAD_T + PLOT_H / 2;
  const maxHalfH = PLOT_H / 2 - 6;
  return (
    <Frame tokens={tokens}>
      <Scaffold tokens={tokens} axisLabels={steps.map((s) => s.label)} />
      {!insufficient
        ? steps.map((s, i) => {
            const half = maxHalfH * (s.valueBps / 10_000);
            const left = PAD_L + stageW * i + stageW * 0.1;
            const right = left + stageW * 0.8;
            const nextValue = steps[i + 1]?.valueBps ?? s.valueBps;
            const nextHalf = maxHalfH * (nextValue / 10_000);
            const points = [
              `${left},${midY - half}`,
              `${right},${midY - nextHalf}`,
              `${right},${midY + nextHalf}`,
              `${left},${midY + half}`,
            ].join(" ");
            return (
              <g key={i}>
                <polygon points={points} fill={s.color} opacity={0.85} />
                <text
                  x={(left + right) / 2}
                  y={midY + 4}
                  fill={tokens.text}
                  fontSize={11}
                  fontWeight={700}
                  textAnchor="middle"
                >
                  {Math.round(s.valueBps / 100)}%
                </text>
              </g>
            );
          })
        : null}
      {insufficient ? <Veil tokens={tokens} insufficient={insufficient} /> : null}
    </Frame>
  );
}

// ── LineChart ──────────────────────────────────────────────────────────
// Behavioral improvement: y = on-time rate (bps), x = ordinal 1/2/3+.

export interface LinePoint {
  label: string;
  yBps: number | null;
}

export function LineChart({
  points,
  color,
  insufficient,
}: {
  points: LinePoint[];
  color: string;
  insufficient?: InsufficientProps;
}) {
  const { tokens } = useTheme();
  const stepX = points.length > 1 ? PLOT_W / (points.length - 1) : 0;
  const xs = points.map((_, i) => PAD_L + stepX * i);
  return (
    <Frame tokens={tokens}>
      <Scaffold tokens={tokens} axisLabels={points.map((p) => p.label)} />
      {!insufficient ? (
        <g>
          <polyline
            points={points
              .map((p, i) => (p.yBps == null ? "" : `${xs[i]},${yFromBps(p.yBps)}`))
              .filter(Boolean)
              .join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((p, i) => {
            if (p.yBps == null) return null;
            const cy = yFromBps(p.yBps);
            // Adaptive label placement: above the point by default; flip
            // below when the natural y would clip the top of the viewBox
            // (yBps ≈ 100% case), and flip back above when at the floor
            // (yBps ≈ 0% case).
            const labelAboveY = cy - 8;
            const labelBelowY = cy + 14;
            const labelY = labelAboveY < PAD_T + 8 ? labelBelowY : labelAboveY;
            // Edge labels otherwise collide with the Y-axis tick numbers on
            // the left and would clip on the right. Anchor + nudge inward.
            const isFirst = i === 0;
            const isLast = i === points.length - 1;
            const anchor: "start" | "end" | "middle" = isFirst
              ? "start"
              : isLast
                ? "end"
                : "middle";
            const labelX = isFirst ? xs[i] + 4 : isLast ? xs[i] - 4 : xs[i];
            return (
              <g key={i}>
                <circle cx={xs[i]} cy={cy} r={3} fill={color} />
                <text
                  x={labelX}
                  y={labelY}
                  fill={tokens.text}
                  fontSize={10}
                  fontWeight={700}
                  textAnchor={anchor}
                >
                  {Math.round(p.yBps / 100)}%
                </text>
              </g>
            );
          })}
        </g>
      ) : null}
      {insufficient ? <Veil tokens={tokens} insufficient={insufficient} /> : null}
    </Frame>
  );
}
