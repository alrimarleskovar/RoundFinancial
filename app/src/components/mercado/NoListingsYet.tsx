"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";

// Empty-state wrapper for the /mercado offers table when no Escape
// Valve listing is currently active. Real production: this is the
// "nobody's distressed enough to sell" healthy-pool default.

export function NoListingsYet() {
  const t = useT();
  return (
    <EmptyState
      icon="◯"
      title={t("market.offers.empty.title")}
      sub={t("market.offers.empty.sub")}
    />
  );
}
