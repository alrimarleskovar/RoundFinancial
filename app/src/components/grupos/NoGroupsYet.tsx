"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";

// Empty-state wrapper for /grupos when no group matches the active
// filter set. Uses the existing `groups.empty.*` i18n keys.

export function NoGroupsYet({ onClear }: { onClear: () => void }) {
  const t = useT();
  return (
    <EmptyState
      icon="◇"
      title={t("groups.empty.title")}
      sub={t("groups.empty.sub")}
      ctaLabel={t("groups.clear")}
      onCta={onClear}
    />
  );
}
