import { FeaturedGroup } from "@/components/home/FeaturedGroup";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeKpis } from "@/components/home/HomeKpis";
import { YourGroups } from "@/components/home/YourGroups";
import { DeskShell } from "@/components/layout/DeskShell";

// /home — native dashboard. B.3.a stacks Hero + KPIs + FeaturedGroup
// + YourGroups in a single column. B.3.b will refactor into a
// 1.5fr / 1fr two-column with the right side hosting Passport mini,
// Triplo Escudo, and Activity feed.

export default function HomePage() {
  return (
    <DeskShell>
      <div
        style={{
          padding: 32,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <HomeHero />
        <HomeKpis />
        <FeaturedGroup />
        <YourGroups />
      </div>
    </DeskShell>
  );
}
