"use client";

import type { MouseEventHandler } from "react";

import { useTheme } from "@/lib/theme";
import type { IconProps } from "@/components/brand/icons";

// A dropdown menu item used inside WalletChip's connected menu.

export function MenuItem({
  icon: Ic,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: (p?: IconProps) => React.ReactElement;
  label: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  tone?: "danger";
}) {
  const { tokens } = useTheme();
  const color = tone === "danger" ? tokens.red : tokens.text;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "transparent",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        padding: "8px 10px",
        borderRadius: 8,
        color,
        fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
        fontSize: 12,
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        gap: 10,
        textAlign: "left",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = tokens.fillSoft;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Ic size={14} stroke={color} />
      {label}
    </button>
  );
}
