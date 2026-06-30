"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS } from "@/components/layout/SessionNav";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Fixed bottom tab bar — the primary mobile nav (<lg). Replaces the TopBar's
// horizontal SessionNav on phones (hidden lg:flex there), putting the six
// destinations in the thumb zone with icon + label and iOS safe-area padding.
// Full-screen modals portal to <body> at z-70, so they still cover this bar.
export function BottomTabBar() {
  const pathname = usePathname();
  const t = useT();
  const { tokens, isDark } = useTheme();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around lg:hidden"
      style={{
        background: isDark ? "rgba(6,9,15,0.92)" : "rgba(245,241,234,0.94)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderTop: `1px solid ${tokens.border}`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.matchPrefix || pathname.startsWith(`${item.matchPrefix}/`);
        const color = active ? tokens.green : tokens.muted;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="flex flex-1 flex-col items-center justify-center gap-1"
            style={{
              color,
              minHeight: 54,
              padding: "7px 2px",
              textDecoration: "none",
            }}
          >
            <item.icon size={20} sw={active ? 2.2 : 1.8} stroke={color} />
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.03em",
                fontFamily: "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {t(item.labelKey)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
