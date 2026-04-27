"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MonoLabel, RFILogoMark } from "@/components/brand/brand";
import { Icons, type IconProps } from "@/components/brand/icons";
import { USER, type User } from "@/data/carteira";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// Left sidebar used by every Next-native screen. Port of
// RFISideNav in prototype/components/desktop.jsx.
//
// Since only /carteira is a real route in B.2.a, the other nav
// items link back to "/" — which serves the iframe'd prototype.
// Once each screen gets ported (B.3+), its entry here flips to
// a native route.

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: (p?: IconProps) => React.ReactElement;
  matchPrefix: string | null; // null = only exact match
}

export function SideNav({
  user = USER,
  collapsed = false,
}: {
  user?: User;
  collapsed?: boolean;
}) {
  const { tokens } = useTheme();
  const t = useT();
  const pathname = usePathname();

  const items: NavItem[] = [
    { id: "home",     label: t("nav.home"),     href: "/home",     icon: Icons.home,   matchPrefix: "/home" },
    { id: "groups",   label: t("nav.groups"),   href: "/grupos",   icon: Icons.groups, matchPrefix: "/grupos" },
    { id: "score",    label: t("nav.score"),    href: "/reputacao",icon: Icons.shield, matchPrefix: "/reputacao" },
    { id: "wallet",   label: t("nav.wallet"),   href: "/carteira", icon: Icons.wallet, matchPrefix: "/carteira" },
    { id: "market",   label: t("nav.market"),   href: "/mercado",  icon: Icons.ticket, matchPrefix: "/mercado" },
    { id: "insights", label: t("nav.insights"), href: "/insights", icon: Icons.chart,  matchPrefix: "/insights" },
  ];

  const levelCopy = {
    badge: `◆ Nv. ${user.level} · ${user.levelLabel}`,
    pts: t("level.ptsToNext", { n: user.nextLevel - user.score }),
  };

  return (
    <div
      style={{
        width: collapsed ? 72 : 240,
        flexShrink: 0,
        background: tokens.surface1,
        borderRight: `1px solid ${tokens.border}`,
        display: "flex",
        flexDirection: "column",
        padding: "24px 14px",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 8px 24px",
        }}
      >
        <RFILogoMark size={28} />
        {!collapsed && (
          <span
            style={{
              fontFamily: "var(--font-syne), Syne, system-ui",
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: "-0.02em",
              color: tokens.text,
            }}
          >
            Round<span style={{ fontWeight: 800 }}>Fi</span>
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((it) => {
          const active = it.matchPrefix
            ? pathname === it.matchPrefix || pathname.startsWith(`${it.matchPrefix}/`)
            : pathname === it.href;
          return (
            <Link
              key={it.id}
              href={it.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: collapsed ? "10px" : "10px 12px",
                borderRadius: 10,
                background: active ? tokens.fillMed : "transparent",
                textDecoration: "none",
                color: active ? tokens.text : tokens.text2,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                justifyContent: collapsed ? "center" : "flex-start",
                position: "relative",
                fontFamily: "var(--font-dm-sans), DM Sans, sans-serif",
              }}
            >
              {active && !collapsed && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 10,
                    bottom: 10,
                    width: 3,
                    background: tokens.green,
                    borderRadius: 2,
                  }}
                />
              )}
              <it.icon size={18} sw={active ? 2 : 1.6} />
              {!collapsed && <span>{it.label}</span>}
            </Link>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      {!collapsed && (
        <div
          style={{
            padding: 14,
            borderRadius: 14,
            background: `linear-gradient(145deg, ${tokens.navyDeep}, ${tokens.surface2})`,
            border: `1px solid ${tokens.border}`,
            marginBottom: 10,
          }}
        >
          <MonoLabel color={tokens.green} size={9}>
            {levelCopy.badge}
          </MonoLabel>
          <div style={{ marginTop: 8, fontSize: 11, color: tokens.text2 }}>
            {levelCopy.pts}
          </div>
          <div
            style={{
              marginTop: 8,
              height: 4,
              background: tokens.fillMed,
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${(user.score / user.nextLevel) * 100}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${tokens.green}, ${tokens.teal})`,
              }}
            />
          </div>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: 8,
          borderRadius: 12,
          background: tokens.fillSoft,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            flexShrink: 0,
            background: `linear-gradient(135deg, ${tokens.teal}, ${tokens.green})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-syne), Syne",
            fontWeight: 800,
            fontSize: 12,
            color: tokens.bgDeep,
          }}
        >
          {user.avatar}
        </div>
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: tokens.text,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {user.name}
            </div>
            <div
              style={{
                fontSize: 10,
                color: tokens.muted,
                fontFamily:
                  "var(--font-jetbrains-mono), JetBrains Mono, monospace",
              }}
            >
              {user.walletShort}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
