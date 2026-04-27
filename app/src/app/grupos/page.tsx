import { GruposClient } from "@/components/grupos/GruposClient";
import { DeskShell } from "@/components/layout/DeskShell";

// /grupos — catalog of available ROSCA groups with multi-facet filters,
// search, sort, and an "only open" toggle.

export default function GruposPage() {
  return (
    <DeskShell>
      <GruposClient />
    </DeskShell>
  );
}
