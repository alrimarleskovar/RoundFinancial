import { Activity } from "@/components/home/Activity";
import { FeaturedGroup } from "@/components/home/FeaturedGroup";
import { HomeHero } from "@/components/home/HomeHero";
import { HomeKpis } from "@/components/home/HomeKpis";
import { PassportMini } from "@/components/home/PassportMini";
import { TripleShield } from "@/components/home/TripleShield";
import { YourGroups } from "@/components/home/YourGroups";
import { DeskShell } from "@/components/layout/DeskShell";

// /home — native dashboard. Hero + 4 KPIs span the full width;
// below them a 1.5fr / 1fr grid splits the active groups column
// (left) from the passport / shield / activity column (right).

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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 1fr",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <FeaturedGroup />
            <YourGroups />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <PassportMini />
            <TripleShield />
            <Activity />
          </div>
        </div>
      </div>
    </DeskShell>
  );
}
