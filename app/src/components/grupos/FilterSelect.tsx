"use client";

import { useTheme } from "@/lib/theme";

// Native <select> styled to match the filter panel.

export function FilterSelect<V extends string>({
  value,
  onChange,
  options,
}: {
  value: V;
  onChange: (v: V) => void;
  options: ReadonlyArray<readonly [V, string]>;
}) {
  const { tokens } = useTheme();
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          padding: "10px 32px 10px 14px",
          borderRadius: 10,
          cursor: "pointer",
          background: tokens.fillSoft,
          border: `1px solid ${tokens.border}`,
          color: tokens.text,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <span
        style={{
          position: "absolute",
          right: 12,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: tokens.muted,
          fontSize: 10,
        }}
      >
        ▾
      </span>
    </div>
  );
}
