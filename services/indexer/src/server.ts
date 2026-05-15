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
 * and will be exercised by a unit test in `decoder.test.ts` once the
 * bankrun harness migration lands (gated on Anchor 0.31+ via issue
 * #230 — Anza Agave 2.x migration unblocks the IDL generation that
 * the bankrun harness loads at startup).
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
    // Adevar Labs SEV-009 fix — shared-secret auth on the webhook.
    //
    // Before: any POST with a well-formed payload was accepted. The
    // only "auth" was URL obscurity, which leaks via Helius dashboard
    // config, CI logs, proxy tooling. An attacker who learned the URL
    // could inject phantom contributes/claims/defaults into the
    // indexer's Postgres — eventually corrupting the B2B Phase 3
    // oracle's score reads.
    //
    // After: bearer-token check against HELIUS_WEBHOOK_SECRET env.
    // Helius dashboard config supports a custom Authorization header.
    // If the env var is unset (devnet / local), the check is bypassed
    // so the local-development loop stays frictionless — but a startup
    // warning fires so the gap is visible in logs.
    const expected = process.env.HELIUS_WEBHOOK_SECRET;
    if (expected) {
      const auth = req.headers["authorization"];
      if (auth !== `Bearer ${expected}`) {
        app.log.warn(
          { ip: req.ip, hasHeader: typeof auth === "string" },
          "rejected webhook POST — missing or invalid Authorization header",
        );
        return reply.code(401).send({ error: "unauthorized" });
      }
    }

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

/**
 * Determine whether this process is running in a "production-like"
 * environment that must NOT accept unauthenticated webhook POSTs.
 *
 * Production-like = any of:
 *   - `NODE_ENV=production` (standard Node convention)
 *   - `INDEXER_ENV` set to `mainnet`, `production`, or `staging`
 *
 * Conservative: anything else (unset, `development`, `test`, `local`)
 * is treated as **not** production-like and allows the fail-open
 * webhook for the local-dev loop. Explicit list rather than negation
 * to avoid future env values silently downgrading the check.
 */
function isProductionLikeEnv(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const tier = process.env.INDEXER_ENV?.toLowerCase();
  return tier === "mainnet" || tier === "production" || tier === "staging";
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const app = await buildServer(prisma);

  // Adevar Labs SEV-009 (W2) — startup gap warning when
  // HELIUS_WEBHOOK_SECRET is unset. The webhook handler skips auth in
  // that case (frictionless local-dev loop), with a visible warning at
  // startup so the gap is auditable in logs.
  //
  // Adevar Labs SEV-033 (W3) — fail-OPEN is not safe in production.
  // The W3 re-audit flagged that an operator could deploy the indexer
  // to staging/mainnet, forget to set the env var, and end up with an
  // unauthenticated webhook surface in production — exactly the SEV-009
  // shape that SEV-009 was supposed to close. Auditor recommended
  // fail-CLOSED on production deploys: refuse to start if the env var
  // is unset AND the process is running in a production-like
  // environment (NODE_ENV=production or INDEXER_ENV in {mainnet,
  // production, staging}).
  //
  // Local dev (NODE_ENV unset / development / test) still gets the
  // frictionless path with a warning — the dev loop is preserved.
  if (!process.env.HELIUS_WEBHOOK_SECRET) {
    if (isProductionLikeEnv()) {
      app.log.error(
        {
          NODE_ENV: process.env.NODE_ENV,
          INDEXER_ENV: process.env.INDEXER_ENV,
        },
        "HELIUS_WEBHOOK_SECRET is unset in production-like environment — " +
          "refusing to start. Set HELIUS_WEBHOOK_SECRET or run with " +
          "NODE_ENV=development for local-dev. (SEV-033 / Adevar audit)",
      );
      await prisma.$disconnect();
      process.exit(1);
    }
    app.log.warn(
      "HELIUS_WEBHOOK_SECRET is unset — webhook auth disabled. " +
        "Required for any non-local deploy (SEV-009 / SEV-033 / Adevar audit).",
    );
  }

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
