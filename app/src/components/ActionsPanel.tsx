"use client";

import { useMemo } from "react";

import { formatUsdc } from "@/lib/formatUsdc";

export interface DemoConfig {
  memberNames: string[];
  cyclesTotal: number;
  installmentAmount: bigint;
  creditAmount: bigint;
  enableDefault: boolean;
  defaultMemberSlot: number;
  defaultAtCycle: number;
  stepDelayMs: number;
}

interface ActionsPanelProps {
  config: DemoConfig;
  onConfigChange: (c: DemoConfig) => void;
  running: boolean;
  finished: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}

const PRESETS: Record<string, DemoConfig> = {
  "4×4 happy path": {
    memberNames: ["Ana", "Bruno", "Clara", "David"],
    cyclesTotal: 4,
    installmentAmount: 1_000_000_000n, // 1000 USDC
    creditAmount: 2_000_000_000n,      // 2000 USDC
    enableDefault: false,
    defaultMemberSlot: 1,
    defaultAtCycle: 1,
    stepDelayMs: 350,
  },
  "4×4 with default": {
    memberNames: ["Ana", "Bruno", "Clara", "David"],
    cyclesTotal: 4,
    installmentAmount: 1_000_000_000n,
    creditAmount: 2_000_000_000n,
    enableDefault: true,
    defaultMemberSlot: 1,
    defaultAtCycle: 1,
    stepDelayMs: 350,
  },
  "3×3 tiny": {
    memberNames: ["Maria", "João", "Sofia"],
    cyclesTotal: 3,
    installmentAmount: 1_000_000_000n,
    creditAmount: 2_200_000_000n,
    enableDefault: false,
    defaultMemberSlot: 0,
    defaultAtCycle: 0,
    stepDelayMs: 350,
  },
};

export function ActionsPanel({
  config,
  onConfigChange,
  running,
  finished,
  onStart,
  onStop,
  onReset,
}: ActionsPanelProps) {
  const memberOptions = useMemo(
    () =>
      config.memberNames.map((name, i) => ({
        label: `#${i} · ${name}`,
        value: i,
      })),
    [config.memberNames],
  );

  const cycleOptions = useMemo(
    () =>
      Array.from({ length: config.cyclesTotal }, (_, i) => ({
        label: `Cycle ${i}`,
        value: i,
      })),
    [config.cyclesTotal],
  );

  return (
    <aside className="flex h-full flex-col gap-5 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Actions
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Drive the protocol demo end-to-end.
        </p>
      </div>

      <div className="space-y-2">
        <button
          onClick={onStart}
          disabled={running}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
        >
          {running ? "Running…" : finished ? "Run Demo again" : "Run Demo"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onStop}
            disabled={!running}
            className="rounded-lg border border-border bg-surfaceMuted px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Stop
          </button>
          <button
            onClick={onReset}
            disabled={running}
            className="rounded-lg border border-border bg-surfaceMuted px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Preset
        </label>
        <div className="grid gap-1.5">
          {Object.entries(PRESETS).map(([label, preset]) => (
            <button
              key={label}
              onClick={() => onConfigChange(preset)}
              disabled={running}
              className="rounded-lg border border-border bg-background px-3 py-2 text-left text-xs font-medium text-slate-300 transition hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Scenario
        </h3>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border bg-surfaceMuted accent-accent"
            checked={config.enableDefault}
            onChange={(e) =>
              onConfigChange({ ...config, enableDefault: e.target.checked })
            }
            disabled={running}
          />
          Simulate a missed contribution
        </label>

        {config.enableDefault ? (
          <div className="grid grid-cols-2 gap-2 pl-6">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500">
                Member
              </label>
              <select
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-slate-200"
                value={config.defaultMemberSlot}
                disabled={running}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    defaultMemberSlot: Number(e.target.value),
                  })
                }
              >
                {memberOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-slate-500">
                At cycle
              </label>
              <select
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-slate-200"
                value={config.defaultAtCycle}
                disabled={running}
                onChange={(e) =>
                  onConfigChange({
                    ...config,
                    defaultAtCycle: Number(e.target.value),
                  })
                }
              >
                {cycleOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Parameters
        </h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-400">
          <span>Members</span>
          <span className="text-right font-mono text-slate-200">
            {config.memberNames.length}
          </span>
          <span>Cycles</span>
          <span className="text-right font-mono text-slate-200">
            {config.cyclesTotal}
          </span>
          <span>Installment</span>
          <span className="text-right font-mono text-slate-200">
            {formatUsdc(config.installmentAmount)}
          </span>
          <span>Credit / cycle</span>
          <span className="text-right font-mono text-slate-200">
            {formatUsdc(config.creditAmount)}
          </span>
          <span>Step delay</span>
          <span className="text-right font-mono text-slate-200">
            {config.stepDelayMs} ms
          </span>
        </div>
      </div>

      <div className="mt-auto rounded-lg border border-border bg-background/50 p-3 text-[11px] leading-relaxed text-slate-500">
        This first frontend version drives a local simulation of the
        lifecycle. The event shapes match{" "}
        <span className="font-mono text-slate-300">@roundfi/orchestrator</span>{" "}
        1:1, so Step 8 swaps in live on-chain events without touching the UI.
      </div>
    </aside>
  );
}
