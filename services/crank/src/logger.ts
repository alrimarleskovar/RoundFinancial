/**
 * Minimal structured logger — one JSON object per line, no transitive
 * dep on pino/winston. Keeps the crank tree small and Railway-friendly
 * (their UI pretty-prints stdout JSON natively).
 *
 * Conventions:
 *   - event_type is the lookup key for the indexer's projector and the
 *     admin's filter (e.g. settle.success, settle.skip.precondition).
 *   - level is { info | warn | error } only — no debug noise in prod.
 *   - ts is always ISO8601 UTC, generated server-side here so log lines
 *     don't depend on the host TZ.
 */

export type Level = "info" | "warn" | "error";

export interface LogPayload {
  [key: string]: unknown;
  event_type: string;
}

function emit(level: Level, payload: LogPayload, msg?: string): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    service: "crank",
    ...payload,
    ...(msg ? { msg } : {}),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

export const logger = {
  info(payload: LogPayload, msg?: string): void {
    emit("info", payload, msg);
  },
  warn(payload: LogPayload, msg?: string): void {
    emit("warn", payload, msg);
  },
  error(payload: LogPayload, msg?: string): void {
    emit("error", payload, msg);
  },
};
