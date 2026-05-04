"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";

// Empty-state wrapper for the /carteira transactions list. Renders
// when both the static fixture and the live session feed are empty —
// a fresh wallet that just connected and hasn't moved any USDC yet.

export function NoTransactionsYet() {
  const t = useT();
  return <EmptyState icon="≡" title={t("wallet.tx.empty.title")} sub={t("wallet.tx.empty.sub")} />;
}
