"use client";

import { MonoLabel } from "@/components/brand/brand";
import type { Tone } from "@/data/carteira";
import type { FactorKey } from "@/data/insights";
import { categorizeGroup } from "@/lib/groups";
import { useT } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// 5-factor behavior breakdown column. Each row: label + numeric
// value + tone-colored bar + caption.
//
// **Reactive to session state.** Values + detail strings derive from:
//   - `events` array (PAY_INSTALLMENT, JOIN_GROUP, etc.)
//   - `joinedGroupNames` (for consistency + diversity factors)
//
// This wires the live behavioral score narrative — when the user
// pays an installment on /home, the factors that compose the score
// move correspondingly. The /home PassportMini already reacts to
// the same state via user.score; this closes the loop on the
// behind-the-scenes signals that justify the score lift.
//
// Tones (visual identity) stay static. Detail strings are i18n
// keys with {paid} / {count} / {events} / {types} placeholders so
// PT/EN flips render correctly while still showing live numbers.

type FactorMeta = { key: FactorKey; tone: Tone };

const FACTOR_META: ReadonlyArray<FactorMeta> = [
  { key: "punctuality", tone: "g" },
  { key: "anticipation", tone: "t" },
  { key: "consistency", tone: "p" },
  { key: "engagement", tone: "a" },
  { key: "diversity", tone: "r" },
];

function clamp(n: number, max = 100): number {
  return Math.min(max, Math.max(0, n));
}

export function FactorsList() {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const t = useT();
  const { events, joinedGroupNames } = useSession();

  // ─── Derive factor values from session state ────────────────────────
  // Each factor has a baseline (representing static fixture history,
  // so a fresh session isn't all zeros) plus a per-event delta.
  const paymentEvents = events.filter((e) => e.kind === "payment").length;
  const joinedCount = joinedGroupNames.length;
  const totalEvents = events.length;
  const categorySet = new Set(joinedGroupNames.map((n) => categorizeGroup({ name: n })));

  const values: Record<FactorKey, { value: number; details: Record<string, number> }> = {
    // Punctuality: high baseline (good user) + +2 per payment event,
    // capped at 100. Surfaces the "every paid installment lifts your
    // score" loop visibly.
    punctuality: {
      value: clamp(80 + paymentEvents * 2),
      details: { paid: paymentEvents },
    },
    // Anticipation: lower baseline + +3 per payment (proxy for
    // early-pay behavior; mock mode doesn't differentiate on-time
    // vs late, so each pay action is treated as anticipative intent).
    anticipation: {
      value: clamp(60 + paymentEvents * 3),
      details: { paid: paymentEvents },
    },
    // Consistency: scales with active group count. 3 baseline fixtures
    // = ~42; joining more groups bumps it.
    consistency: {
      value: clamp(joinedCount * 14),
      details: { count: joinedCount },
    },
    // Engagement: total session activity (any reducer-emitted event).
    engagement: {
      value: clamp(35 + totalEvents * 2),
      details: { events: totalEvents },
    },
    // Diversity: unique group categories joined (PME, Casa, Dev, etc.).
    diversity: {
      value: clamp(categorySet.size * 18),
      details: { types: categorySet.size },
    },
  };

  const toneColor = (tone: Tone): string => {
    switch (tone) {
      case "g":
        return tokens.green;
      case "t":
        return tokens.teal;
      case "p":
        return tokens.purple;
      case "a":
        return tokens.amber;
      case "r":
        return tokens.red;
    }
  };

  return (
    <div
      style={{
        ...glass,
        padding: 22,
        borderRadius: 18,
      }}
    >
      <MonoLabel color={tokens.green}>{t("insights.factors.title")}</MonoLabel>
      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {FACTOR_META.map((f) => {
          const c = toneColor(f.tone);
          const { value, details } = values[f.key];
          return (
            <div key={f.key}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: tokens.text,
                    fontWeight: 500,
                  }}
                >
                  {t(`insights.factor.${f.key}.label`)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                    fontSize: 11,
                    color: c,
                    fontWeight: 600,
                  }}
                >
                  {value}
                </span>
              </div>
              <div
                style={{
                  marginTop: 6,
                  height: 4,
                  background: tokens.fillMed,
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${value}%`,
                    height: "100%",
                    background: c,
                    borderRadius: 999,
                    transition: "width 400ms ease",
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: tokens.muted,
                  marginTop: 4,
                  fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                }}
              >
                {t(`insights.factor.${f.key}.detail`, details)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
