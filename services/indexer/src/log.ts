/**
 * Structured JSON logger for the RoundFi indexer.
 *
 * Closes item #2 of `docs/observability/README.md` "Pre-deployment
 * readiness" — the PagerDuty runbook (and any Loki / Datadog
 * pipeline) parses indexer logs assuming the fixed key set
 * `{ ts, level, event_type, slot, signature, error? }` plus arbitrary
 * passthrough context. Free-text `console.log` lines wreck that
 * contract, so this module is the single emission point.
 *
 * Why bespoke instead of pino/winston:
 *
 *   - Zero new dep — the indexer's runtime closure is small + we want
 *     to keep it that way (cold-start matters when Helius webhooks
 *     spawn handler processes).
 *   - The shape is small (6 fields). A 25-line module beats a 30 KB
 *     transitive dep for a fixed surface.
 *   - The reconciler + backfill already pass a `logger?: { info, warn }`
 *     interface around — this module produces an instance that matches
 *     that shape with zero call-site changes downstream.
 *
 * The pino migration option stays open: replace `createLogger()` with
 * a pino instance, keep the call sites untouched.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  /** Event class (table name, instruction name, subsystem). */
  event_type?: string;
  /** Solana slot, when the log is tied to a chain event. */
  slot?: bigint | number | string;
  /** Tx signature, when the log is tied to a single transaction. */
  signature?: string;
  /** Error chain, when level === "error" or the message is a failure. */
  error?: unknown;
  /** Any other passthrough fields. */
  [k: string]: unknown;
}

export interface Logger {
  info: (ctx: LogContext, msg: string) => void;
  warn: (ctx: LogContext, msg: string) => void;
  error: (ctx: LogContext, msg: string) => void;
  debug: (ctx: LogContext, msg: string) => void;
}

interface LoggerOptions {
  /** Service name — populates `service` on every line. */
  service: string;
  /** Minimum level to emit; lower-priority lines are dropped. */
  minLevel?: LogLevel;
  /** Override sink for unit tests; defaults to console.log. */
  sink?: (line: string) => void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function defaultMinLevel(): LogLevel {
  const raw = (process.env.ROUNDFI_LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function serializeError(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

/**
 * Normalize one log line into the fixed-shape JSON the runbook
 * assumes. BigInts get stringified (JSON.stringify barfs on them
 * natively), errors get flattened to `{ name, message, stack }`.
 */
function serialize(level: LogLevel, service: string, ctx: LogContext, msg: string): string {
  const out: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    service,
    msg,
  };
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined) continue;
    if (k === "error") {
      out.error = serializeError(v);
    } else if (typeof v === "bigint") {
      out[k] = v.toString();
    } else {
      out[k] = v;
    }
  }
  return JSON.stringify(out);
}

export function createLogger(opts: LoggerOptions): Logger {
  const minLevel = opts.minLevel ?? defaultMinLevel();
  const minPriority = LEVEL_PRIORITY[minLevel];
  const sink = opts.sink ?? ((line) => console.log(line));

  function emit(level: LogLevel, ctx: LogContext, msg: string): void {
    if (LEVEL_PRIORITY[level] < minPriority) return;
    sink(serialize(level, opts.service, ctx, msg));
  }

  return {
    debug: (ctx, msg) => emit("debug", ctx, msg),
    info: (ctx, msg) => emit("info", ctx, msg),
    warn: (ctx, msg) => emit("warn", ctx, msg),
    error: (ctx, msg) => emit("error", ctx, msg),
  };
}
