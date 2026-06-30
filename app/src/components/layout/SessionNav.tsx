"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icons } from "@/components/brand/icons";
import { useT } from "@/lib/i18n";

// Horizontal session navigation — the app's primary nav now that the left
// SideNav is gone. Same routes / icons / labels as the old sidebar
// (Icons.* + the shared nav.* dict keys), rendered as loose pills with a
// green active state. Used by the TopBar (every dashboard route) and the
// /home-v2 header so the two stay identical. Labels show from 2xl up (the
// full labelled bar needs ~1450px before it crowds the logo/controls);
// narrower viewports fall back to icon-only, and below that the row scrolls.

// Exported so the mobile BottomTabBar renders the same six destinations.
export const NAV_ITEMS = [
  { id: "home", href: "/home", icon: Icons.home, labelKey: "nav.home", matchPrefix: "/home" },
  {
    id: "groups",
    href: "/grupos",
    icon: Icons.groups,
    labelKey: "nav.groups",
    matchPrefix: "/grupos",
  },
  {
    id: "score",
    href: "/reputacao",
    icon: Icons.shield,
    labelKey: "nav.score",
    matchPrefix: "/reputacao",
  },
  {
    id: "wallet",
    href: "/carteira",
    icon: Icons.wallet,
    labelKey: "nav.wallet",
    matchPrefix: "/carteira",
  },
  {
    id: "market",
    href: "/mercado",
    icon: Icons.ticket,
    labelKey: "nav.market",
    matchPrefix: "/mercado",
  },
  {
    id: "insights",
    href: "/insights",
    icon: Icons.chart,
    labelKey: "nav.insights",
    matchPrefix: "/insights",
  },
];

export function SessionNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav
      // Scrollable strip: when the labelled/icon row is wider than the space
      // between the logo and the controls (mobile, or heavy zoom), it scrolls
      // horizontally instead of overlapping its neighbours. Centered once it
      // fits (lg+); scrollbar hidden for clean chrome.
      className={`flex min-w-0 items-center justify-start gap-1 overflow-x-auto sm:gap-2 lg:justify-center 2xl:gap-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.matchPrefix || pathname.startsWith(`${item.matchPrefix}/`);
        return (
          <Link
            key={item.id}
            href={item.href}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-2 transition-all sm:px-3 ${
              active
                ? "bg-[#14F195] text-black shadow-[0_0_20px_rgba(20,241,149,0.3)]"
                : "text-gray-400 hover:bg-white/10 hover:text-white"
            }`}
          >
            <item.icon size={16} sw={active ? 2 : 1.7} />
            <span className="hidden text-xs font-bold uppercase tracking-[0.12em] [font-family:var(--font-jetbrains-mono)] 2xl:inline">
              {t(item.labelKey)}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
