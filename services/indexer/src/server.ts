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
 * dashboard. The webhook handler authenticates incoming POSTs against
 * HELIUS_WEBHOOK_SECRET via a constant-time Bearer compare — see
 * `checkWebhookAuth` for the threat model (SEV-009 / SEV-033 / RoundFi
 * internal audit follow-up).
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

import "dotenv/config";
import { timingSafeEqual } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

import { makePrismaClient } from "./db.js";
import { handleHeliusWebhook } from "./webhook.js";
import { collectIndexerMetrics, PROMETHEUS_CONTENT_TYPE } from "./metrics.js";
import { loadSubjectScore } from "./reputationScore.js";

const PORT = Number(process.env.INDEXER_PORT ?? 8787);
const HOST = process.env.INDEXER_HOST ?? "0.0.0.0";

// A base58 Solana pubkey is 32 bytes → 43–44 base58 chars. Validate the
// `:subject` path param so a malformed id 400s instead of hitting the DB.
const SUBJECT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
      // uploaded, but we run IDL-free by design (ADR 0002; see
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

/**
 * Outcome of the webhook Authorization gate. `reason` is logged but never
 * returned to the caller — a 401 body just says "unauthorized" so we don't
 * leak which check failed.
 */
type WebhookAuthResult =
  | { ok: true; reason: "ok" | "no_secret_unauth_allowed" }
  | { ok: false; reason: "no_secret_denied" | "bad_token" };

/**
 * Webhook auth gate (Adevar Labs SEV-009 / SEV-033 — RoundFi internal
 * audit follow-up).
 *
 * Trust model
 * -----------
 * Helius natively only supports a configurable per-webhook `authHeader`
 * (shared secret echoed back as the `Authorization` header). Helius does
 * NOT sign the request body, so true HMAC-of-body verification would
 * require a signing proxy in front of Helius — out of scope here. We
 * harden the shared-secret model instead:
 *
 *   1. **Constant-time compare** via `timingSafeEqual` removes the timing
 *      leak the prior string `!==` exposed (V8 short-circuits character
 *      comparison; an attacker measuring response time could in principle
 *      recover the secret byte-by-byte). The length-leak from the
 *      length-mismatch early-out is not exploitable: the secret length is
 *      operator-fixed and not attacker-controlled.
 *
 *   2. **Default-DENY when secret unset.** SEV-033 closed the
 *      production-like-env fail-open at startup, but the request handler
 *      itself still treated `unset secret == allow request`. That meant a
 *      preview/staging/CI deployment that escaped the production-like
 *      allowlist (e.g. NODE_ENV unset, INDEXER_ENV unset) silently became
 *      an unauthenticated webhook surface — the original SEV-009 shape.
 *      The new default is fail-CLOSED at request time. The ONLY way to
 *      accept unauthenticated POSTs is an explicit
 *      `INDEXER_ALLOW_UNAUTH_WEBHOOK=true` opt-in for local dev; the
 *      startup gate refuses that opt-in in production-like environments
 *      as defense-in-depth.
 */
export function checkWebhookAuth(authHeader: string | string[] | undefined): WebhookAuthResult {
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.INDEXER_ALLOW_UNAUTH_WEBHOOK === "true") {
      return { ok: true, reason: "no_secret_unauth_allowed" };
    }
    return { ok: false, reason: "no_secret_denied" };
  }
  if (typeof authHeader !== "string") {
    return { ok: false, reason: "bad_token" };
  }
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const actual = Buffer.from(authHeader, "utf8");
  // Length-mismatch shortcut: timingSafeEqual REQUIRES equal-length
  // buffers and throws otherwise. We reject before the call.
  if (expected.length !== actual.length) {
    return { ok: false, reason: "bad_token" };
  }
  if (!timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "bad_token" };
  }
  return { ok: true, reason: "ok" };
}

export async function buildServer(prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    // Helius bursts can be large — accept up to 5 MB.
    bodyLimit: 5_242_880,
  });

  app.get("/healthz", async () => ({ ok: true, ts: Date.now() }));

  // Prometheus exposition format (text/plain; version=0.0.4). Migrated
  // from JSON per item #1 of docs/observability/README.md
  // "Pre-deployment readiness" so the alerts in
  // docs/observability/prometheus-alerts.yaml can scrape against real
  // metrics. See `metrics.ts` for the catalogued metric set and which
  // alert-spec metrics are still deferred.
  app.get("/metrics", async (_req, reply) => {
    const body = await collectIndexerMetrics(prisma);
    reply.header("Content-Type", PROMETHEUS_CONTENT_TYPE);
    return reply.send(body);
  });

  // ─── Reputation score (v5.2 Hybrid, Phase C.3.3) ──────────────────
  // Read-only off-chain score for a subject wallet. Computes the
  // proposal's Reliability + Punctuality over the subject's persisted
  // attestations (C.2b). `formula_versao: "v1-provisional"` — the
  // weights are NOT canonical (see reputationScore.ts / team decisão 1).
  // A wallet with no attestations returns the honest fresh default
  // (reliability 0, punctuality 80) rather than 404 — "no history" is a
  // valid, queryable state, not an error.
  app.get<{ Params: { subject: string } }>("/score/:subject", async (req, reply) => {
    const { subject } = req.params;
    if (!SUBJECT_RE.test(subject)) {
      return reply.code(400).send({ error: "invalid_subject" });
    }
    try {
      const summary = await loadSubjectScore(prisma, subject);
      return reply.code(200).send(summary);
    } catch (err) {
      app.log.error({ err, subject }, "score lookup failed");
      return reply.code(500).send({ error: "score_lookup_failed" });
    }
  });

  app.post("/webhook/helius", async (req, reply) => {
    const gate = checkWebhookAuth(req.headers["authorization"]);
    if (!gate.ok) {
      app.log.warn({ ip: req.ip, reason: gate.reason }, "rejected webhook POST");
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (gate.reason === "no_secret_unauth_allowed") {
      app.log.warn(
        { ip: req.ip },
        "accepted webhook POST without auth (INDEXER_ALLOW_UNAUTH_WEBHOOK=true)",
      );
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
  const prisma = makePrismaClient();
  const app = await buildServer(prisma);

  // Startup webhook-auth gate. Layered defense-in-depth over the
  // request-time gate in `checkWebhookAuth`. Production-like envs
  // (NODE_ENV=production or INDEXER_ENV in {mainnet, production,
  // staging}) refuse to start when:
  //   (a) HELIUS_WEBHOOK_SECRET is unset (SEV-009 / SEV-033 — would
  //       leave the webhook surface unauthenticated), OR
  //   (b) INDEXER_ALLOW_UNAUTH_WEBHOOK=true (the local-dev opt-in
  //       escaped into prod via env-var inheritance — RoundFi internal
  //       audit follow-up to SEV-033).
  // Local dev: warn loudly when neither knob is set, so the operator
  // knows the webhook will 401 every request (rather than silently
  // accepting unauthenticated traffic, which was the SEV-009 bug).
  const allowUnauth = process.env.INDEXER_ALLOW_UNAUTH_WEBHOOK === "true";
  if (isProductionLikeEnv()) {
    if (!process.env.HELIUS_WEBHOOK_SECRET) {
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
    if (allowUnauth) {
      app.log.error(
        {
          NODE_ENV: process.env.NODE_ENV,
          INDEXER_ENV: process.env.INDEXER_ENV,
        },
        "INDEXER_ALLOW_UNAUTH_WEBHOOK=true in production-like environment — " +
          "refusing to start. This flag is for local dev only. " +
          "(RoundFi internal audit follow-up to SEV-033)",
      );
      await prisma.$disconnect();
      process.exit(1);
    }
  } else if (!process.env.HELIUS_WEBHOOK_SECRET && !allowUnauth) {
    app.log.warn(
      "HELIUS_WEBHOOK_SECRET is unset and INDEXER_ALLOW_UNAUTH_WEBHOOK is not " +
        "set — every webhook POST will be rejected with 401. Set " +
        "HELIUS_WEBHOOK_SECRET for any non-local deploy, or " +
        "INDEXER_ALLOW_UNAUTH_WEBHOOK=true to accept unauthenticated POSTs " +
        "in local dev.",
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
