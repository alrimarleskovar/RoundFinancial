"use client";

import { useEffect, useRef } from "react";

import type { LifecycleEvent } from "@roundfi/orchestrator";
import { formatUsdc } from "@/lib/formatUsdc";

interface EventsFeedProps {
  events: LifecycleEvent[];
}

function fmtTs(at: number): string {
  const d = new Date(at);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Signatures come from the orchestrator as base58 strings — shorten to
 * first-6/last-6 so the feed stays readable while still being uniquely
 * identifiable for a quick Explorer lookup.
 */
function shortSig(sig: string): string {
  if (sig.length <= 14) return sig;
  return `${sig.slice(0, 6)}…${sig.slice(-6)}`;
}

function lineForEvent(e: LifecycleEvent): {
  line: string;
  tone: "phase" | "ok" | "skip" | "fail" | "member" | "payout" | "snapshot" | "summary";
  ts: number;
} {
  switch (e.kind) {
    case "phase.start":
      return { line: `── ${e.label} ──`, tone: "phase", ts: e.at };
    case "phase.end":
      return {
        line: `── ${e.label} done (${e.elapsedMs} ms) ──`,
        tone: "phase",
        ts: e.at,
      };
    case "action.ok": {
      // Any action.ok that carries `signature` is a confirmed on-chain
      // tx — surface it visibly so Real mode shows tx hashes without
      // requiring a separate devtools panel.
      const line = e.signature
        ? `${e.detail}  🔗 ${shortSig(e.signature)} ✔`
        : e.detail;
      return { line, tone: "ok", ts: e.at };
    }
    case "action.skip":
      return { line: `${e.action} skipped — ${e.reason}`, tone: "skip", ts: e.at };
    case "action.fail":
      return {
        line: `${e.action} FAILED — ${e.error}`,
        tone: "fail",
        ts: e.at,
      };
    case "member.joined":
      return {
        line: `${e.actor} joined slot ${e.slotIndex} (L${e.reputationLevel}, stake ${formatUsdc(e.stakeDeposited)})`,
        tone: "member",
        ts: e.at,
      };
    case "member.contributed":
      return {
        line: `Cycle ${e.cycle}: ${e.actor} contributed ${formatUsdc(e.amount)}${e.onTime ? "" : " (late)"}`,
        tone: "member",
        ts: e.at,
      };
    case "member.missed":
      return {
        line: `Cycle ${e.cycle}: ${e.actor} MISSED payment — ${e.note}`,
        tone: "fail",
        ts: e.at,
      };
    case "payout.executed":
      return {
        line: `Cycle ${e.cycle}: ${e.actor} received ${formatUsdc(e.amount)} (slot ${e.slotIndex})`,
        tone: "payout",
        ts: e.at,
      };
    case "pool.snapshot":
      return {
        line: `Cycle ${e.cycle} | ${e.status} | contrib=${formatUsdc(e.totalContributed)} paid=${formatUsdc(e.totalPaidOut)} defaults=${e.defaultedMembers}`,
        tone: "snapshot",
        ts: e.at,
      };
    case "summary":
      return {
        line: `Summary: events=${e.totalEvents} ok=${e.okCount} skip=${e.skipCount} fail=${e.failCount} · elapsed=${e.elapsedMs} ms`,
        tone: "summary",
        ts: e.finishedAt,
      };
  }
}

const toneClass = {
  phase: "text-slate-500",
  ok: "text-slate-200",
  skip: "text-slate-400 italic",
  fail: "text-danger",
  member: "text-accent",
  payout: "text-success",
  snapshot: "text-warning",
  summary: "text-slate-100 font-semibold",
} as const;

const tonePrefix = {
  phase: "──",
  ok: " ✓",
  skip: " ~",
  fail: " ✕",
  member: " ·",
  payout: " ★",
  snapshot: " =",
  summary: "══",
} as const;

export function EventsFeed({ events }: EventsFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-surface shadow-card">
      <header className="flex items-baseline justify-between border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Events
        </h3>
        <span className="text-xs text-slate-500">{events.length} total</span>
      </header>
      <div
        ref={containerRef}
        className="scrollable max-h-[380px] overflow-y-auto px-5 py-3 font-mono text-xs"
      >
        {events.length === 0 ? (
          <div className="py-10 text-center text-slate-500">
            The demo hasn&rsquo;t started yet.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {events.map((e, i) => {
              const r = lineForEvent(e);
              return (
                <li key={i} className={`flex gap-2 ${toneClass[r.tone]}`}>
                  <span className="shrink-0 text-slate-600">[{fmtTs(r.ts)}]</span>
                  <span className="shrink-0">{tonePrefix[r.tone]}</span>
                  <span className="whitespace-pre-wrap">{r.line}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
