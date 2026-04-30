import { DeskShell } from "@/components/layout/DeskShell";
import { StressLabClient } from "@/components/lab/StressLabClient";

// /lab — Stress Lab (M1).
// Pure-TS actuarial simulator that mirrors the on-chain math the
// roundfi-core program will compute. Lets us validate the Triple
// Shield economics against arbitrary default scenarios before the
// Anchor programs ship.

export default function LabPage() {
  return (
    <DeskShell hideSideNav>
      <StressLabClient />
    </DeskShell>
  );
}
