"use client";

import type { ReactNode } from "react";

import { MonoLabel } from "@/components/brand/brand";

// 110px label column + flex-wrap chip column. Used by the Grupos
// filter panel.

export function FilterRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 1fr",
        gap: 14,
        alignItems: "center",
      }}
    >
      <MonoLabel size={9}>{label}</MonoLabel>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}
