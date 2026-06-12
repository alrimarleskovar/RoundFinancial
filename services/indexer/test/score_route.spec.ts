/**
 * Route-level coverage for `GET /score/:subject` (Phase C.3.3) WITHOUT a
 * real database. A stub PrismaClient injects the attestation rows, so
 * this exercises the Fastify handler — subject validation, the
 * row→signal mapping, and the response envelope — end to end, minus the
 * actual Postgres query (which is operator-run).
 *
 * `buildServer(prisma)` takes the client as a parameter precisely so the
 * handler is testable with a fake.
 */

import { expect } from "chai";
import type { PrismaClient } from "@prisma/client";

import { buildServer } from "../src/server.js";

/** Minimal Prisma stub: only `attestation.findMany` is used by the route. */
function stubPrisma(
  rows: { classification: string | null; deltaSeconds: bigint | null }[],
): PrismaClient {
  return {
    attestation: {
      findMany: async () => rows,
    },
  } as unknown as PrismaClient;
}

describe("GET /score/:subject", () => {
  const VALID = "8LVrgxKwKwqjcdq7rUUwWY2zPNk8anpo2JsaR9jTQQjw";

  it("400s a malformed subject without touching the DB", async () => {
    let queried = false;
    const prisma = {
      attestation: {
        findMany: async () => {
          queried = true;
          return [];
        },
      },
    } as unknown as PrismaClient;

    const app = await buildServer(prisma);
    const res = await app.inject({ method: "GET", url: "/score/not-a-key!!" });
    expect(res.statusCode).to.equal(400);
    expect(res.json()).to.deep.equal({ error: "invalid_subject" });
    expect(queried).to.equal(false);
    await app.close();
  });

  it("returns the fresh-wallet default for a subject with no attestations", async () => {
    const app = await buildServer(stubPrisma([]));
    const res = await app.inject({ method: "GET", url: `/score/${VALID}` });
    expect(res.statusCode).to.equal(200);
    const body = res.json();
    expect(body.subject).to.equal(VALID);
    expect(body.formula_versao).to.equal("v1-provisional");
    expect(body.reliability).to.equal(0);
    expect(body.punctuality).to.equal(80);
    expect(body.commitment).to.equal(null);
    expect(body.recovery).to.equal(null);
    expect(body.event_count).to.equal(0);
    await app.close();
  });

  it("computes the score from injected attestation rows", async () => {
    // 49 on-time + 1 default → reliability 98; all on the deadline → punctuality 80.
    const rows = [
      ...Array.from({ length: 49 }, () => ({
        classification: "payment_on_time",
        deltaSeconds: 0n,
      })),
      { classification: "default", deltaSeconds: null },
    ];
    const app = await buildServer(stubPrisma(rows));
    const res = await app.inject({ method: "GET", url: `/score/${VALID}` });
    expect(res.statusCode).to.equal(200);
    const body = res.json();
    expect(body.reliability).to.equal(98);
    expect(body.event_count).to.equal(50);
    expect(body.classification_counts.payment_on_time).to.equal(49);
    expect(body.classification_counts.default).to.equal(1);
    await app.close();
  });

  it("maps an unknown stored classification to unspecified (no skew)", async () => {
    const rows = [
      { classification: "some_future_variant", deltaSeconds: 123n },
      ...Array.from({ length: 10 }, () => ({
        classification: "payment_on_time",
        deltaSeconds: 0n,
      })),
    ];
    const app = await buildServer(stubPrisma(rows));
    const res = await app.inject({ method: "GET", url: `/score/${VALID}` });
    const body = res.json();
    // The unknown row counts as "unspecified" (no weight) → reliability
    // is the 10 on-time payments → 100.
    expect(body.reliability).to.equal(100);
    expect(body.classification_counts.unspecified).to.equal(1);
    await app.close();
  });
});
