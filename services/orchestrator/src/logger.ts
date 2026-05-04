/**
 * Default console sink for LifecycleEvent.
 *
 * Renders one line per event with:
 *   [HH:MM:SS] ICON phase | message
 *
 * The output is designed to be read by a human watching the demo, so
 * the message is written in plain English ("Cycle 1: Maria contributed 1000 USDC"),
 * not jargon. All amounts are converted from base units to human USDC.
 */

import type { EventSink, LifecycleEvent } from "./events.js";

// ─── Format helpers ──────────────────────────────────────────────────

const USDC_DECIMALS = 6;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS);

export function formatUsdc(amount: bigint): string {
  const whole = amount / USDC_SCALE;
  const frac = amount % USDC_SCALE;
  if (frac === 0n) return `${whole.toString()} USDC`;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr} USDC`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function timestamp(at: number): string {
  const d = new Date(at);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function phaseTag(tag: string): string {
  const width = 14;
  return tag.length >= width ? tag : tag + " ".repeat(width - tag.length);
}

// ─── Renderer ────────────────────────────────────────────────────────

function render(event: LifecycleEvent): string {
  const ts = timestamp(event.kind === "summary" ? event.finishedAt : event.at);

  switch (event.kind) {
    case "phase.start":
      return `[${ts}] ── ${event.label} ──`;
    case "phase.end":
      return `[${ts}] ── ${event.label} done (${event.elapsedMs} ms) ──`;
    case "action.ok":
      return `[${ts}]    ok  ${phaseTag("action")} ${event.detail}`;
    case "action.skip":
      return `[${ts}]    ~   ${phaseTag("action")} ${event.action} skipped — ${event.reason}`;
    case "action.fail":
      return `[${ts}]    !!  ${phaseTag("action")} ${event.action} FAILED — ${event.error}`;
    case "member.joined":
      return (
        `[${ts}]    +   ${phaseTag("join")} ${event.actor} joined slot ${event.slotIndex} ` +
        `(L${event.reputationLevel}, stake ${formatUsdc(event.stakeDeposited)})`
      );
    case "member.contributed":
      return (
        `[${ts}]    $   ${phaseTag("contribute")} Cycle ${event.cycle}: ${event.actor} ` +
        `contributed ${formatUsdc(event.amount)}` +
        (event.onTime ? "" : " (late)")
      );
    case "member.missed":
      return (
        `[${ts}]    X   ${phaseTag("contribute")} Cycle ${event.cycle}: ${event.actor} ` +
        `MISSED payment — ${event.note}`
      );
    case "payout.executed":
      return (
        `[${ts}]    *   ${phaseTag("payout")} Cycle ${event.cycle}: ` +
        `${event.actor} received ${formatUsdc(event.amount)} (slot ${event.slotIndex})`
      );
    case "pool.snapshot":
      return (
        `[${ts}]    =   ${phaseTag("snapshot")} Cycle ${event.cycle} | ${event.status} | ` +
        `contrib=${formatUsdc(event.totalContributed)} paid=${formatUsdc(event.totalPaidOut)} ` +
        `escrow=${formatUsdc(event.escrowBalance)} solidarity=${formatUsdc(event.solidarityBalance)} ` +
        `defaults=${event.defaultedMembers}`
      );
    case "summary": {
      const lines = [
        `[${ts}] ══ Demo summary ══`,
        `           events=${event.totalEvents} ok=${event.okCount} skip=${event.skipCount} fail=${event.failCount}`,
        `           elapsed=${event.elapsedMs} ms`,
      ];
      for (const n of event.notes) lines.push(`           · ${n}`);
      return lines.join("\n");
    }
  }
}

// ─── Sink factories ──────────────────────────────────────────────────

export interface ConsoleSinkOptions {
  /** Write target. Defaults to `console.log`. */
  write?: (line: string) => void;
  /** Filter out specific event kinds from the output (but still counted upstream). */
  mute?: ReadonlyArray<LifecycleEvent["kind"]>;
}

export function consoleSink(opts: ConsoleSinkOptions = {}): EventSink {
  const write = opts.write ?? ((line: string) => console.log(line));
  const mute = new Set(opts.mute ?? []);
  return (event) => {
    if (mute.has(event.kind)) return;
    write(render(event));
  };
}

/**
 * Collecting sink — keeps every event in memory. Useful for tests and
 * for the Next.js UI, which will subscribe and re-render from this buffer.
 */
export function bufferSink(): {
  sink: EventSink;
  events: LifecycleEvent[];
} {
  const events: LifecycleEvent[] = [];
  const sink: EventSink = (e) => {
    events.push(e);
  };
  return { sink, events };
}
