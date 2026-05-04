"use client";

import { useTheme } from "@/lib/theme";

// Segmented toggle used by the top bar for PT/EN and R$/USDC. Mirrors
// the prototype's SegToggle in index.html (DeskTopBar inline script).

export interface SegOption<V extends string> {
  v: V;
  l: string;
}

export function SegToggle<V extends string>({
  value,
  onChange,
  options,
}: {
  value: V;
  onChange: (v: V) => void;
  options: SegOption<V>[];
}) {
  const { tokens, isDark } = useTheme();
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 3,
        borderRadius: 9,
        background: tokens.fillSoft,
        border: `1px solid ${tokens.border}`,
      }}
    >
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            style={{
              padding: "5px 10px",
              borderRadius: 7,
              cursor: "pointer",
              background: active ? (isDark ? tokens.surface2 : tokens.surface1) : "transparent",
              border: "none",
              color: active ? tokens.text : tokens.muted,
              fontSize: 11,
              fontWeight: active ? 700 : 500,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              transition: "all 150ms ease",
              minWidth: 34,
            }}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}
