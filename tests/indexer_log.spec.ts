/**
 * Structured-logger tests (observability/README.md item #2 — Pass-14).
 *
 * Pins the JSON shape `services/indexer/src/log.ts` emits, since the
 * PagerDuty runbook (`docs/observability/pagerduty-runbook.md`) parses
 * indexer logs assuming `{ ts, level, service, msg, event_type?,
 * slot?, signature?, error? }`. Free-text drift here would silently
 * break alert grouping + log queries — same threat model as the
 * front-end allowlist tests (SEV-045): pure-function unit tests at
 * the boundary catch drift before deploy.
 *
 * Methodology: capture lines via a custom sink instead of stubbing
 * console — keeps the assertion deterministic and doesn't touch
 * global console state. Same shape as the frontend allowlist tests.
 */

import { expect } from "chai";

import { createLogger, type LogLevel } from "../services/indexer/src/log";

interface ParsedLine {
  ts: string;
  level: LogLevel;
  service: string;
  msg: string;
  [k: string]: unknown;
}

function captureSink(): { lines: ParsedLine[]; sink: (l: string) => void } {
  const lines: ParsedLine[] = [];
  return {
    lines,
    sink: (l: string) => {
      lines.push(JSON.parse(l));
    },
  };
}

describe("indexer log — structured JSON shape (observability #2)", () => {
  it("emits one JSON object per line with fixed root keys", () => {
    const { lines, sink } = captureSink();
    const log = createLogger({ service: "reconciler", sink });
    log.info({ event_type: "tick" }, "reconciler tick complete");

    expect(lines).to.have.length(1);
    const line = lines[0]!;
    expect(line).to.have.property("ts");
    expect(line.level).to.equal("info");
    expect(line.service).to.equal("reconciler");
    expect(line.msg).to.equal("reconciler tick complete");
    expect(line.event_type).to.equal("tick");
  });

  it("includes a parseable ISO-8601 timestamp", () => {
    const { lines, sink } = captureSink();
    const log = createLogger({ service: "backfill", sink });
    log.info({}, "hello");

    const parsed = Date.parse(lines[0]!.ts);
    expect(parsed).to.not.be.NaN;
    expect(Math.abs(Date.now() - parsed)).to.be.lessThan(2_000);
  });

  it("passes signature + slot fields through unchanged", () => {
    const { lines, sink } = captureSink();
    const log = createLogger({ service: "reconciler", sink });
    log.warn(
      {
        event_type: "orphan",
        signature: "5xK...abc",
        slot: 123_456_789,
        table: "contribute_events",
      },
      "orphan tx",
    );

    const line = lines[0]!;
    expect(line.signature).to.equal("5xK...abc");
    expect(line.slot).to.equal(123_456_789);
    expect(line.table).to.equal("contribute_events");
  });

  it("stringifies bigint values (JSON.stringify would throw natively)", () => {
    const { lines, sink } = captureSink();
    const log = createLogger({ service: "reconciler", sink });
    log.info({ slot: 99999999999999n }, "high slot");

    expect(lines[0]!.slot).to.equal("99999999999999");
  });

  it("flattens Error instances into { name, message, stack }", () => {
    const { lines, sink } = captureSink();
    const log = createLogger({ service: "backfill", sink });

    const err = new Error("boom");
    err.name = "FetchError";
    log.error({ event_type: "rpc_call", error: err }, "rpc call failed");

    const line = lines[0]!;
    const flattened = line.error as { name: string; message: string; stack: string };
    expect(flattened.name).to.equal("FetchError");
    expect(flattened.message).to.equal("boom");
    expect(flattened.stack).to.be.a("string");
  });

  it("stringifies non-Error values passed in error field", () => {
    const { lines, sink } = captureSink();
    const log = createLogger({ service: "backfill", sink });

    log.error({ error: "raw string failure" }, "weird error");
    log.error({ error: 404 }, "numeric error");

    expect((lines[0]!.error as { message: string }).message).to.equal("raw string failure");
    expect((lines[1]!.error as { message: string }).message).to.equal("404");
  });

  it("respects minLevel — drops lines below threshold", () => {
    const { lines, sink } = captureSink();
    const log = createLogger({ service: "reconciler", sink, minLevel: "warn" });

    log.debug({}, "debug line");
    log.info({}, "info line");
    log.warn({}, "warn line");
    log.error({}, "error line");

    expect(lines.map((l) => l.level)).to.deep.equal(["warn", "error"]);
  });

  it("defaults minLevel to info when ROUNDFI_LOG_LEVEL is unset", () => {
    const { lines, sink } = captureSink();
    const original = process.env.ROUNDFI_LOG_LEVEL;
    delete process.env.ROUNDFI_LOG_LEVEL;
    try {
      const log = createLogger({ service: "backfill", sink });
      log.debug({}, "debug");
      log.info({}, "info");
      expect(lines.map((l) => l.level)).to.deep.equal(["info"]);
    } finally {
      if (original !== undefined) process.env.ROUNDFI_LOG_LEVEL = original;
    }
  });

  it("reads ROUNDFI_LOG_LEVEL env var when set", () => {
    const { lines, sink } = captureSink();
    const original = process.env.ROUNDFI_LOG_LEVEL;
    process.env.ROUNDFI_LOG_LEVEL = "debug";
    try {
      const log = createLogger({ service: "backfill", sink });
      log.debug({}, "debug");
      log.info({}, "info");
      expect(lines.map((l) => l.level)).to.deep.equal(["debug", "info"]);
    } finally {
      if (original === undefined) delete process.env.ROUNDFI_LOG_LEVEL;
      else process.env.ROUNDFI_LOG_LEVEL = original;
    }
  });

  it("skips undefined values in the context object", () => {
    const { lines, sink } = captureSink();
    const log = createLogger({ service: "reconciler", sink });
    log.info({ event_type: "tick", signature: undefined, slot: 42 }, "tick");

    const line = lines[0]!;
    expect(line).to.not.have.property("signature");
    expect(line.slot).to.equal(42);
  });
});
