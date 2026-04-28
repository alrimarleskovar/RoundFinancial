"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icons } from "@/components/brand/icons";
import { MonoLabel } from "@/components/brand/brand";
import { useMotion, type MotionMode } from "@/lib/motion";
import { useTheme, type Palette } from "@/lib/theme";

// Floating dev-only panel that swaps palette + jumps to any route.
// Hidden in production builds via NODE_ENV check.

const SHOW_TWEAKS = process.env.NODE_ENV !== "production";

const SCREENS: ReadonlyArray<readonly [string, string]> = [
  ["/home",      "Início"],
  ["/carteira",  "Carteira"],
  ["/grupos",    "Grupos"],
  ["/reputacao", "Reputação"],
  ["/mercado",   "Mercado"],
  ["/insights",  "Insights"],
  ["/lab",       "Stress Lab"],
  ["/",          "Landing"],
];

const PALETTES: ReadonlyArray<readonly [Palette, string]> = [
  ["soft", "Soft · creme & sage"],
  ["neon", "Neon · pitch deck"],
];

const MOTIONS: ReadonlyArray<readonly [MotionMode, string]> = [
  ["off",   "Off · sem animação"],
  ["fade",  "Fade · sutil 220ms"],
  ["slide", "Slide · horizontal 260ms"],
];

export function TweaksPanel() {
  const { tokens, palette, setPalette } = useTheme();
  const { mode: motionMode, setMode: setMotionMode } = useMotion();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Click-outside closes the drawer.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!SHOW_TWEAKS) return null;

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 10,
      }}
    >
      {open && (
        <div
          style={{
            width: 280,
            maxHeight: "calc(100vh - 120px)",
            overflowY: "auto",
            padding: 16,
            borderRadius: 14,
            background: tokens.surface1,
            border: `1px solid ${tokens.borderStr}`,
            boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <MonoLabel color={tokens.green} size={9}>
              ◆ Tweaks · DEV
            </MonoLabel>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: tokens.muted,
                padding: 0,
                display: "flex",
              }}
            >
              <Icons.close size={14} stroke={tokens.muted} />
            </button>
          </div>

          {/* Palette */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <MonoLabel size={9}>Paleta</MonoLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PALETTES.map(([key, label]) => {
                const active = palette === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPalette(key)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 9,
                      cursor: "pointer",
                      background: active ? `${tokens.green}1A` : tokens.fillSoft,
                      border: `1px solid ${active ? `${tokens.green}4D` : tokens.border}`,
                      color: active ? tokens.green : tokens.text,
                      fontSize: 12,
                      fontWeight: active ? 600 : 500,
                      textAlign: "left",
                      fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: active ? tokens.green : tokens.muted,
                      }}
                    />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Animação */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <MonoLabel size={9}>Animação entre rotas</MonoLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {MOTIONS.map(([key, label]) => {
                const active = motionMode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMotionMode(key)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 9,
                      cursor: "pointer",
                      background: active ? `${tokens.teal}1A` : tokens.fillSoft,
                      border: `1px solid ${active ? `${tokens.teal}4D` : tokens.border}`,
                      color: active ? tokens.teal : tokens.text,
                      fontSize: 11,
                      fontWeight: active ? 600 : 500,
                      textAlign: "left",
                      fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: active ? tokens.teal : tokens.muted,
                      }}
                    />
                    {label}
                  </button>
                );
              })}
            </div>
            <div
              style={{
                fontSize: 9,
                color: tokens.muted,
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
                lineHeight: 1.4,
              }}
            >
              Navegue para outra tela pra ver
            </div>
          </div>

          {/* Pular para */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <MonoLabel size={9}>Pular para</MonoLabel>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
              }}
            >
              {SCREENS.map(([href, label]) => {
                const active =
                  href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: active ? tokens.fillMed : tokens.fillSoft,
                      border: `1px solid ${active ? tokens.borderStr : tokens.border}`,
                      color: active ? tokens.text : tokens.text2,
                      fontSize: 11,
                      fontWeight: active ? 600 : 500,
                      textDecoration: "none",
                      textAlign: "center",
                      fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
                    }}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div
            style={{
              fontSize: 9,
              color: tokens.muted,
              fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              textAlign: "center",
              lineHeight: 1.4,
            }}
          >
            Hidden in production
            <br />
            (NODE_ENV !== &quot;production&quot;)
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          cursor: "pointer",
          background: open
            ? `linear-gradient(135deg, ${tokens.green}, ${tokens.teal})`
            : tokens.surface1,
          border: `1px solid ${open ? "transparent" : tokens.borderStr}`,
          color: open ? "#fff" : tokens.text,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          transition: "background 180ms ease",
        }}
        aria-label="Toggle tweaks panel"
      >
        <Icons.spark size={18} stroke={open ? "#fff" : tokens.text} sw={2} />
      </button>
    </div>
  );
}
