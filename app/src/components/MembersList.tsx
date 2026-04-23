import type { MemberUi, MemberUiStatus } from "@/hooks/useLifecycleState";
import { formatUsdc } from "@/lib/formatUsdc";

interface MembersListProps {
  members: MemberUi[];
  currentCycle: number;
}

const statusLabel: Record<MemberUiStatus, string> = {
  pending: "Pending",
  current: "On time",
  late: "Late",
  paid_out: "Paid out",
  defaulted: "Defaulted",
};

const statusClass: Record<MemberUiStatus, string> = {
  pending: "bg-surfaceMuted text-slate-400",
  current: "bg-accentMuted/20 text-accent",
  late: "bg-warning/10 text-warning",
  paid_out: "bg-success/10 text-success",
  defaulted: "bg-danger/10 text-danger",
};

const slotDot: Record<MemberUiStatus, string> = {
  pending: "bg-slate-500",
  current: "bg-accent",
  late: "bg-warning",
  paid_out: "bg-success",
  defaulted: "bg-danger",
};

export function MembersList({ members, currentCycle }: MembersListProps) {
  if (members.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Members
        </h3>
        <p className="mt-3 text-sm text-slate-500">
          No pool configured yet. Press &ldquo;Run Demo&rdquo; to start.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Members
        </h3>
        <span className="text-xs text-slate-500">
          {members.length} seats · current cycle {currentCycle}
        </span>
      </header>

      <ul className="divide-y divide-border">
        {members.map((m) => {
          const isClaimantThisCycle = m.slotIndex === currentCycle;
          return (
            <li
              key={m.slotIndex}
              className="flex items-center gap-3 py-2.5 text-sm"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${slotDot[m.status]}`}
                aria-hidden
              />
              <span className="w-10 font-mono text-xs text-slate-500">
                #{m.slotIndex.toString().padStart(2, "0")}
              </span>
              <span className="flex-1 truncate">
                <span className="font-medium">{m.name}</span>
                <span className="ml-2 text-xs text-slate-500">
                  L{m.reputationLevel}
                </span>
                {isClaimantThisCycle ? (
                  <span className="ml-2 rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
                    Claimant
                  </span>
                ) : null}
              </span>
              <span className="hidden font-mono text-xs text-slate-400 sm:inline">
                paid {m.contributionsPaid}×
              </span>
              <span className="hidden font-mono text-xs text-slate-400 md:inline">
                {formatUsdc(m.totalContributed, { suffix: false })} in ·{" "}
                {formatUsdc(m.totalReceived, { suffix: false })} out
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusClass[m.status]}`}
              >
                {statusLabel[m.status]}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
