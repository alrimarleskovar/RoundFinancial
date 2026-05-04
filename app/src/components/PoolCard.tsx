import type { PoolUi } from "@/hooks/useLifecycleState";
import { formatUsdc } from "@/lib/formatUsdc";
import { StatCard } from "./StatCard";

interface PoolCardProps {
  pool: PoolUi;
  memberCount: number;
}

export function PoolCard({ pool, memberCount }: PoolCardProps) {
  const progressPct =
    pool.totalCycles === 0
      ? 0
      : Math.min(100, Math.round((pool.currentCycle / pool.totalCycles) * 100));

  const statusColor: Record<PoolUi["status"], string> = {
    idle: "text-slate-400",
    forming: "text-warning",
    Forming: "text-warning",
    Active: "text-accent",
    Completed: "text-success",
    Liquidated: "text-danger",
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-slate-400">Pool</div>
          <h2 className="mt-1 text-2xl font-semibold">
            {memberCount} members × {pool.totalCycles || "–"} cycles
          </h2>
        </div>
        <div className={`font-mono text-sm ${statusColor[pool.status]}`}>
          {pool.status === "idle" ? "—" : pool.status}
        </div>
      </header>

      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
          <span>
            Cycle {Math.min(pool.currentCycle, Math.max(pool.totalCycles, 1))} /{" "}
            {pool.totalCycles || "–"}
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surfaceMuted">
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Installment"
          value={pool.installmentAmount === 0n ? "—" : formatUsdc(pool.installmentAmount)}
          hint="Paid each cycle per member"
        />
        <StatCard
          label="Credit"
          value={pool.creditAmount === 0n ? "—" : formatUsdc(pool.creditAmount)}
          hint="Released to the cycle's slot owner"
        />
        <StatCard label="Total contributed" value={formatUsdc(pool.totalContributed)} />
        <StatCard label="Total paid out" value={formatUsdc(pool.totalPaidOut)} />
        <StatCard
          label="Defaults"
          value={String(pool.defaultedMembers)}
          tone={pool.defaultedMembers > 0 ? "warn" : "default"}
        />
        <StatCard
          label="Pool vault"
          value={formatUsdc(pool.poolUsdcVaultBalance)}
          hint="Float held for next payout"
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCard
          label="Escrow vault"
          value={formatUsdc(pool.escrowBalance)}
          hint="Stakes + per-cycle escrow slice"
        />
        <StatCard
          label="Solidarity vault"
          value={formatUsdc(pool.solidarityBalance)}
          hint="1% solidarity skim per contribution"
        />
      </div>
    </section>
  );
}
