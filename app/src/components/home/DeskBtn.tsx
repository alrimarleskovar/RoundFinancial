"use client";

import type { ReactNode } from "react";

import type { IconProps } from "@/components/brand/icons";
import { useTheme } from "@/lib/theme";

// Primary or default button used by the Home hero and other surfaces.
// Mirrors the prototype's inline DeskBtn helper.

export function DeskBtn({
  children,
  onClick,
  tone = "default",
  icon: Ic,
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "primary" | "default";
  icon?: (p?: IconProps) => React.ReactElement;
  href?: string;
}) {
  const { tokens } = useTheme();
  const primary = tone === "primary";

  const style = primary
    ? {
        padding: "10px 16px",
        borderRadius: 11,
        border: "none",
        cursor: "pointer",
        background: `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`,
        color: tokens.bgDeep,
        fontSize: 13,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        boxShadow: `0 6px 18px ${tokens.green}33`,
        textDecoration: "none",
        fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
      }
    : {
        padding: "10px 16px",
        borderRadius: 11,
        cursor: "pointer",
        background: tokens.fillSoft,
        border: `1px solid ${tokens.border}`,
        color: tokens.text,
        fontSize: 13,
        fontWeight: 500,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        textDecoration: "none",
        fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
      };

  const inner = (
    <>
      {Ic && (
        <Ic
          size={15}
          stroke={primary ? tokens.bgDeep : tokens.text}
          sw={primary ? 2 : 1.8}
        />
      )}
      {children}
    </>
  );

  if (href) {
    return (
      <a href={href} style={style as React.CSSProperties}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} style={style as React.CSSProperties}>
      {inner}
    </button>
  );
}
