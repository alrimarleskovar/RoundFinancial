"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { runMockDemo, type MockHandle } from "@/lib/mockDemo";
import { runRealDemo, type RealHandle } from "@/lib/realDemo";
import {
  ActionsPanel,
  type DemoConfig,
  type DemoMode,
} from "@/components/ActionsPanel";
import { PoolCard } from "@/components/PoolCard";
import { MembersList } from "@/components/MembersList";
import { EventsFeed } from "@/components/EventsFeed";
import { useLifecycleState } from "@/hooks/useLifecycleState";
import { useNetwork } from "@/lib/network";

const DEFAULT_CONFIG: DemoConfig = {
  memberNames: ["Ana", "Bruno", "Clara", "David"],
  cyclesTotal: 4,
  installmentAmount: 1_000_000_000n,
  creditAmount: 2_000_000_000n,
  enableDefault: false,
  defaultMemberSlot: 1,
  defaultAtCycle: 1,
  stepDelayMs: 350,
};

type DemoHandle = MockHandle | RealHandle;

export default function HomePage() {
  const [config, setConfig] = useState<DemoConfig>(DEFAULT_CONFIG);
  const [mode, setMode] = useState<DemoMode>("mock");
  const { id: networkId, endpoint, setNetwork } = useNetwork();
  const [state, dispatch] = useLifecycleState();
  const handleRef = useRef<DemoHandle | null>(null);

  // Clean up any running demo on unmount.
  useEffect(() => {
    return () => {
      handleRef.current?.cancel();
    };
  }, []);

  const startDemo = useCallback(() => {
    handleRef.current?.cancel();
    dispatch({
      type: "reset",
      cyclesTotal: config.cyclesTotal,
      installment: config.installmentAmount,
      credit: config.creditAmount,
      memberNames: config.memberNames,
    });
    dispatch({ type: "start" });

    const defaultScenario = config.enableDefault
      ? {
          memberSlotIndex: config.defaultMemberSlot,
          atCycle: config.defaultAtCycle,
        }
      : undefined;

    if (mode === "real") {
      handleRef.current = runRealDemo(
        {
          memberNames: config.memberNames,
          cyclesTotal: config.cyclesTotal,
          installmentAmount: config.installmentAmount,
          creditAmount: config.creditAmount,
          defaultScenario,
          endpoint,
        },
        (event) => dispatch({ type: "event", event }),
      );
    } else {
      handleRef.current = runMockDemo(
        {
          memberNames: config.memberNames,
          cyclesTotal: config.cyclesTotal,
          installmentAmount: config.installmentAmount,
          creditAmount: config.creditAmount,
          defaultScenario,
          stepDelayMs: config.stepDelayMs,
        },
        (event) => dispatch({ type: "event", event }),
      );
    }
  }, [config, dispatch, mode, endpoint]);

  const stopDemo = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
    dispatch({ type: "finish" });
  }, [dispatch]);

  const resetDemo = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
    dispatch({
      type: "reset",
      cyclesTotal: 0,
      installment: 0n,
      credit: 0n,
      memberNames: [],
    });
  }, [dispatch]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-6 px-6 py-8">
      <Header
        phase={state.currentPhase?.label ?? null}
        running={state.running}
        mode={mode}
        networkId={networkId}
      />

      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <ActionsPanel
          config={config}
          onConfigChange={setConfig}
          mode={mode}
          onModeChange={setMode}
          networkId={networkId}
          onNetworkChange={setNetwork}
          running={state.running}
          finished={state.finished}
          onStart={startDemo}
          onStop={stopDemo}
          onReset={resetDemo}
        />

        <div className="flex flex-col gap-6">
          <PoolCard pool={state.pool} memberCount={state.members.length} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <MembersList
              members={state.members}
              currentCycle={state.pool.currentCycle}
            />
            <EventsFeed events={state.events} />
          </div>
          {state.summary ? <SummaryCard summary={state.summary} /> : null}
        </div>
      </div>
    </main>
  );
}

function Header({
  phase,
  running,
  mode,
  networkId,
}: {
  phase: string | null;
  running: boolean;
  mode: DemoMode;
  networkId: string;
}) {
  return (
    <header className="flex items-center justify-between border-b border-border pb-4">
      <div>
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-md bg-accent/20 ring-1 ring-accent/40">
            <div className="m-[3px] h-5 w-5 rounded bg-gradient-to-br from-accent to-accentMuted" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">RoundFi</h1>
          <span className="text-xs text-slate-500">
            ROSCA on Solana · Colosseum Hackathon demo
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
          {mode === "real" ? `Real · ${networkId}` : "Mock"}
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              running ? "animate-pulse bg-accent" : "bg-slate-600"
            }`}
          />
          <span className="text-xs text-slate-400">
            {running ? phase ?? "Running…" : "Idle"}
          </span>
        </div>
      </div>
    </header>
  );
}

function SummaryCard({
  summary,
}: {
  summary: Extract<
    import("@roundfi/orchestrator").LifecycleEvent,
    { kind: "summary" }
  >;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
        Summary
      </h3>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <SummaryStat label="Events" value={String(summary.totalEvents)} />
        <SummaryStat label="OK" value={String(summary.okCount)} tone="good" />
        <SummaryStat label="Skipped" value={String(summary.skipCount)} tone="warn" />
        <SummaryStat
          label="Failed"
          value={String(summary.failCount)}
          tone={summary.failCount > 0 ? "bad" : "default"}
        />
      </div>
      {summary.notes.length > 0 ? (
        <ul className="mt-4 space-y-1.5 text-xs text-slate-400">
          {summary.notes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-slate-600">·</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SummaryStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    default: "text-slate-100",
    good: "text-success",
    warn: "text-warning",
    bad: "text-danger",
  } as const;
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg ${toneClass[tone]}`}>{value}</div>
    </div>
  );
}
