import { StressLabClient } from "@/components/lab/StressLabClient";

// /lab — Stress Lab (M1).
// Pure-TS actuarial simulator that mirrors the on-chain math the
// roundfi-core program will compute. Lets us validate the Triple
// Shield economics against arbitrary default scenarios before the
// Anchor programs ship.
//
// Wrapped by (app)/layout.tsx → DeskShell with `hideSideNav` derived
// from the pathname (focus mode for /lab).

export default function LabPage() {
  return <StressLabClient />;
}
