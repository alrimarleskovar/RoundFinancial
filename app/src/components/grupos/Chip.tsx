"use client";

import type { ReactNode } from "react";

import type { Tone } from "@/data/carteira";
import { useTheme } from "@/lib/theme";

// Round chip used by the filter rows. Active state colors the bg+border
// with a tone-tinted overlay.

export function Chip({
  active,
  tone = "g",
  onClick,
  children,
}: {
  active: boolean;
  tone?: Tone;
  onClick: () => void;
  children: ReactNode;
}) {
  const { tokens } = useTheme();
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

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "7px 13px",
        borderRadius: 999,
        fontSize: 12,
        cursor: "pointer",
        background: active ? `${toneColor}1A` : tokens.fillSoft,
        border: `1px solid ${active ? `${toneColor}4D` : tokens.border}`,
        color: active ? toneColor : tokens.text2,
        fontWeight: active ? 600 : 500,
        fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
        transition: "all 120ms ease",
      }}
    >
      {children}
    </button>
  );
}
