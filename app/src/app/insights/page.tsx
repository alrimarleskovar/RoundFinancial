import { InsightsClient } from "@/components/insights/InsightsClient";
import { DeskShell } from "@/components/layout/DeskShell";

// /insights — behavioral signals + score evolution.

export default function InsightsPage() {
  return (
    <DeskShell>
      <InsightsClient />
    </DeskShell>
  );
}
