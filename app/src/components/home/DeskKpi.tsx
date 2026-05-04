"use client";

import Link from "next/link";

import { MonoLabel } from "@/components/brand/brand";
import { CountUp } from "@/components/ui/CountUp";
import type { Tone } from "@/data/carteira";
import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// One KPI card used in the top row of the Home dashboard. When an
// `href` prop is passed, the whole card becomes an internal link
// — used to bridge the home dashboard to the page where the metric
// can actually be inspected (Saldo → /carteira, Score → /reputacao).

export function DeskKpi({
  label,
  value,
  numericValue,
  format,
  delta,
  tone,
  sub,
  href,
}: {
  label: string;
  value: string | number;
  // When provided, renders an animated CountUp with format(numericValue)
  // instead of the static `value` string. Currency / palette flips
  // animate between values.
  numericValue?: number;
  format?: (n: number) => string;
  delta: string;
  tone: Tone;
  sub?: string;
  href?: string;
}) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);
  const toneColor = ((): string => {
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
  })();

  const Wrapper = href
    ? ({ children }: { children: React.ReactNode }) => (
        <Link
          href={href}
          style={{
            display: "block",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          {children}
        </Link>
      )
    : ({ children }: { children: React.ReactNode }) => <>{children}</>;

  return (
    <Wrapper>
      <div
        style={{
          ...glass,
          borderRadius: 16,
          padding: 18,
          position: "relative",
          overflow: "hidden",
          cursor: href ? "pointer" : "default",
          transition: "transform 180ms ease, border-color 180ms ease",
        }}
        onMouseEnter={
          href
            ? (e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.borderColor = `${toneColor}55`;
              }
            : undefined
        }
        onMouseLeave={
          href
            ? (e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.borderColor = "";
              }
            : undefined
        }
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, ${toneColor}, transparent 70%)`,
          }}
        />
        <MonoLabel size={9}>{label}</MonoLabel>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            marginTop: 8,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-syne), Syne",
              fontSize: 28,
              fontWeight: 800,
              color: tokens.text,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            {numericValue != null && format ? (
              <CountUp value={numericValue} format={format} />
            ) : (
              value
            )}
          </span>
          {sub && (
            <span
              style={{
                fontSize: 12,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {sub}
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: toneColor,
            fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
          }}
        >
          {delta}
        </div>
      </div>
    </Wrapper>
  );
}
