/**
 * RoundFi indexer — Fastify entrypoint.
 *
 * Two surfaces:
 *
 *   1. **Helius webhook** (`POST /webhook/helius`). Helius pushes a
 *      JSON payload with `meta.logMessages` + the signed tx envelope
 *      whenever it sees a tx that touches one of the programs we
 *      registered for. We decode the relevant ix's, upsert the
 *      affected Pool / Member / Attestation rows, and append an
 *      append-only event row.
 *
 *   2. **Health endpoints** (`GET /healthz`, `GET /metrics`). The
 *      `/metrics` endpoint is a thin prometheus surface — exposes the
 *      indexer's lag (latest_indexed_slot vs cluster_slot) so an
 *      ops dashboard can alarm when we're falling behind.
 *
 * Deployment: container behind a reverse proxy (Traefik / nginx).
 * Helius webhook URL is configured per-environment via the Helius
 * dashboard; we don't sign or verify the body in v0 since the URL is
 * a per-environment secret.
 *
 * Fastify is chosen over Express for two reasons:
 *   - first-class async/await + zod-driven schema validation,
 *   - higher throughput — the webhook fans out into Postgres writes
 *     and we want to soak short bursts without a queue.
 *
 * This file is the **scaffold**: the webhook handler decodes a
 * placeholder shape. The on-chain log parser lives in `decoder.ts`
 * and is exercised by a unit test in `decoder.test.ts` (TODO; gated
 * on the bankrun harness migration).
 */

import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

import { handleHeliusWebhook } from "./webhook.js";

const PORT = Number(process.env.INDEXER_PORT ?? 8787);
const HOST = process.env.INDEXER_HOST ?? "0.0.0.0";

// Helius pushes an array of "enhanced transactions". The envelope is
// long; we only depend on a few fields for routing. Full schema:
// https://docs.helius.dev/webhooks-and-websockets/api-reference
const heliusBodySchema = z
  .array(
    z.object({
      signature: z.string(),
      slot: z.number(),
      timestamp: z.number().nullable(),
      type: z.string().optional(),
      transactionError: z
        .object({
          error: z.unknown(),
        })
        .nullable()
        .optional(),
      meta: z
        .object({
          logMessages: z.array(z.string()).nullable().optional(),
        })
        .partial()
        .optional(),
      // Anchor-flavored ix list — Helius pre-decodes when an IDL is
      // uploaded, but our IDL gen is broken on Rust 1.95 (see
      // sdk/src/onchain-raw.ts). We re-decode from `meta.logMessages`
      // in `decoder.ts`, so this field is best-effort.
      instructions: z
        .array(
          z.object({
            programId: z.string(),
            data: z.string().optional(),
            accounts: z.array(z.string()).optional(),
          }),
        )
        .optional(),
    }),
  )
  .min(1);

export async function buildServer(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    // Helius bursts can be large — accept up to 5 MB.
    bodyLimit: 5_242_880,
  });

  app.get("/healthz", async () => ({ ok: true, ts: Date.now() }));

  app.get("/metrics", async () => {
    const cursor = await prisma.indexerCursor.findFirst({
      orderBy: { updatedAt: "desc" },
    });
    return {
      lastIndexedSlot: cursor?.lastSlot.toString() ?? null,
      lastUpdatedAt: cursor?.updatedAt ?? null,
    };
  });

  app.post("/webhook/helius", async (req, reply) => {
    const parse = heliusBodySchema.safeParse(req.body);
    if (!parse.success) {
      app.log.warn({ issues: parse.error.issues }, "rejected malformed Helius payload");
      return reply.code(400).send({ error: "invalid_payload" });
    }

    let processed = 0;
    let skipped = 0;
    for (const tx of parse.data) {
      try {
        const result = await handleHeliusWebhook(prisma, tx);
        if (result.processed) processed += 1;
        else skipped += 1;
      } catch (err) {
        app.log.error({ err, sig: tx.signature }, "webhook handler failed");
        // Don't fail the whole batch — Helius retries the entire
        // batch on a 5xx, which would re-process the txs we already
        // wrote (Postgres unique-constraint catches that, but it's
        // wasted work). We swallow per-tx and continue.
      }
    }
    return reply.code(200).send({ processed, skipped });
  });

  return app;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const app = await buildServer(prisma);
  try {
    await app.listen({ host: HOST, port: PORT });
    app.log.info(`indexer listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  void main();
}
