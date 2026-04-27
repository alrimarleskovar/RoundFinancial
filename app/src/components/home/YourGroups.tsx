"use client";

import Link from "next/link";

import { MonoLabel } from "@/components/brand/brand";
import { GroupRow } from "@/components/home/GroupRow";
import { ACTIVE_GROUPS } from "@/data/groups";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

// "Seus grupos" section: header + 2 non-featured groups.
// FeaturedGroup renders the first one separately above this.

export function YourGroups() {
  const { tokens } = useTheme();
  const t = useT();
  const rest = ACTIVE_GROUPS.slice(1);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <MonoLabel color={tokens.green}>{t("home.yourGroups")}</MonoLabel>
        <Link
          href="/grupos"
          style={{
            background: "none",
            border: "none",
            color: tokens.muted,
            fontSize: 11,
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          {t("home.seeAll")}
        </Link>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rest.map((g) => (
          <GroupRow key={g.id} g={g} />
        ))}
      </div>
    </div>
  );
}
