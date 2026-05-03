"use client";

import { glassSurfaceStyle, useTheme } from "@/lib/theme";

// Reusable empty-state primitive. Every list-style surface in the app
// uses this when there's nothing to show — dashed border + centered
// title + sub + optional CTA. Three named wrappers
// (NoGroupsYet / NoTransactionsYet / NoListingsYet) sit on top of this,
// each pre-baking the relevant i18n keys.
//
// Why a primitive instead of just inlining: every list is a glass
// surface with the same first-render-empty visual. Centralizing means
// the dashed-border treatment, the type sizing, and the CTA button
// shape all evolve in one place.

export interface EmptyStateProps {
  title: string;
  sub: string;
  /** Optional CTA button label. Renders nothing when both label + onClick absent. */
  ctaLabel?: string;
  onCta?: () => void;
  /** Optional icon glyph rendered above the title (string or ReactNode). */
  icon?: React.ReactNode;
}

export function EmptyState({
  title,
  sub,
  ctaLabel,
  onCta,
  icon,
}: EmptyStateProps) {
  const { tokens, palette } = useTheme();
  const glass = glassSurfaceStyle(palette);

  return (
    <div
      style={{
        ...glass,
        marginTop: 12,
        padding: 40,
        borderRadius: 16,
        textAlign: "center",
        border: `1px dashed ${tokens.borderStr}`,
      }}
    >
      {icon && (
        <div
          style={{
            fontSize: 28,
            color: tokens.muted,
            marginBottom: 10,
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <div
        style={{
          fontFamily: "var(--font-syne), Syne",
          fontSize: 18,
          fontWeight: 700,
          color: tokens.text,
        }}
      >
        {title}
      </div>
      <div
        style={{ fontSize: 12, color: tokens.muted, marginTop: 6 }}
      >
        {sub}
      </div>
      {ctaLabel && onCta && (
        <button
          type="button"
          onClick={onCta}
          style={{
            marginTop: 14,
            padding: "9px 16px",
            borderRadius: 10,
            cursor: "pointer",
            background: tokens.fillSoft,
            border: `1px solid ${tokens.borderStr}`,
            color: tokens.text,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
          }}
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
