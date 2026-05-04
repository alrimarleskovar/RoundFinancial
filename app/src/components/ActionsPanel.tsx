"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

import { formatUsdc } from "@/lib/formatUsdc";
import { NETWORK_OPTIONS, type NetworkId } from "@/lib/network";

// wallet-adapter-react-ui's WalletMultiButton mounts a portal and
// reads `document`, so SSR must be skipped.
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

export type DemoMode = "mock" | "real";

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
  mode: DemoMode;
  onModeChange: (m: DemoMode) => void;
  networkId: NetworkId;
  onNetworkChange: (id: NetworkId) => void;
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
    creditAmount: 2_000_000_000n, // 2000 USDC
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
  mode,
  onModeChange,
  networkId,
  onNetworkChange,
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

  const network = NETWORK_OPTIONS[networkId];

  return (
    <aside className="flex h-full flex-col gap-5 rounded-2xl border border-border bg-surface p-5 shadow-card">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Actions</h2>
        <p className="mt-1 text-xs text-slate-500">Drive the protocol demo end-to-end.</p>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            label="Mock"
            hint="instant, in-browser"
            active={mode === "mock"}
            disabled={running}
            onClick={() => onModeChange("mock")}
          />
          <ModeButton
            label="Real"
            hint="on-chain via orchestrator"
            active={mode === "real"}
            disabled={running}
            onClick={() => onModeChange("real")}
          />
        </div>
      </div>

      <div className="space-y-2">
        <button
          onClick={onStart}
          disabled={running}
          className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
        >
          {running
            ? "Running…"
            : finished
              ? `Run ${mode === "real" ? "Real" : "Mock"} Demo again`
              : `Run ${mode === "real" ? "Real" : "Mock"} Demo`}
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

      {mode === "real" ? (
        <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-accent/90">
              Real mode
            </h3>
            <div className="scale-90">
              <WalletMultiButton />
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500">
              Network
            </label>
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-slate-200"
              value={networkId}
              disabled={running}
              onChange={(e) => onNetworkChange(e.target.value as NetworkId)}
            >
              {Object.values(NETWORK_OPTIONS).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} · {o.endpoint.replace(/^https?:\/\//, "")}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[10px] leading-snug text-slate-500">{network.notes}</p>
          </div>
        </div>
      ) : null}

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
            onChange={(e) => onConfigChange({ ...config, enableDefault: e.target.checked })}
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
          <span className="text-right font-mono text-slate-200">{config.memberNames.length}</span>
          <span>Cycles</span>
          <span className="text-right font-mono text-slate-200">{config.cyclesTotal}</span>
          <span>Installment</span>
          <span className="text-right font-mono text-slate-200">
            {formatUsdc(config.installmentAmount)}
          </span>
          <span>Credit / cycle</span>
          <span className="text-right font-mono text-slate-200">
            {formatUsdc(config.creditAmount)}
          </span>
          {mode === "mock" ? (
            <>
              <span>Step delay</span>
              <span className="text-right font-mono text-slate-200">{config.stepDelayMs} ms</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="mt-auto rounded-lg border border-border bg-background/50 p-3 text-[11px] leading-relaxed text-slate-500">
        {mode === "real" ? (
          <>
            Real mode drives the full orchestrator end-to-end over{" "}
            <span className="font-mono text-slate-300">{networkId}</span>. Requires a running
            validator with the three programs deployed and IDLs populated under{" "}
            <span className="font-mono text-slate-300">app/public/idls/</span> (see the README
            there).
          </>
        ) : (
          <>
            Mock mode emits the exact same{" "}
            <span className="font-mono text-slate-300">LifecycleEvent</span> shapes as the
            orchestrator — no validator, no wallet, instant. Toggle to Real above to drive the
            actual on-chain flow.
          </>
        )}
      </div>
    </aside>
  );
}

function ModeButton({
  label,
  hint,
  active,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "flex flex-col items-start rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 " +
        (active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-background text-slate-300 hover:border-slate-500")
      }
    >
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-[10px] text-slate-500">{hint}</span>
    </button>
  );
}
