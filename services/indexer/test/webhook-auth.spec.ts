/**
 * Webhook auth gate — request-level behavior.
 *
 * Covers the three hardening properties from the RoundFi internal audit
 * follow-up to SEV-009 / SEV-033:
 *
 *   1. Constant-time Bearer compare (no string `!==` timing leak).
 *   2. Default-DENY when HELIUS_WEBHOOK_SECRET is unset (no
 *      fallback-allow at the request layer — only the explicit
 *      INDEXER_ALLOW_UNAUTH_WEBHOOK=true opt-in allows it, gated to
 *      local dev by the startup check in `main()`).
 *   3. Length-mismatch rejection without throwing (timingSafeEqual
 *      requires equal-length buffers — we short-circuit BEFORE the
 *      call).
 *
 * Tests use Fastify's `inject` API so no port is bound and no Postgres
 * is required: the auth gate runs before the body parse / handler,
 * which is the only path that touches Prisma. A bare `{}` stands in for
 * the PrismaClient — it is never dereferenced on the paths under test.
 */

import { expect } from "chai";
import type { PrismaClient } from "@prisma/client";

import { buildServer, checkWebhookAuth } from "../src/server.js";

const PRISMA_STUB = {} as unknown as PrismaClient;

/**
 * Run `fn` with `process.env` patched, then restore. Each key in `env`
 * is either set to a string or deleted (`undefined`). Used to scope env
 * mutations to one test so we don't leak across the suite.
 */
async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prior[k] = process.env[k];
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
}

describe("webhook auth gate (pure fn)", () => {
  it("denies when secret unset and no opt-in", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: undefined, INDEXER_ALLOW_UNAUTH_WEBHOOK: undefined },
      async () => {
        const r = checkWebhookAuth(undefined);
        expect(r.ok).to.equal(false);
        expect(r.reason).to.equal("no_secret_denied");
      },
    );
  });

  it("allows when secret unset and INDEXER_ALLOW_UNAUTH_WEBHOOK=true", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: undefined, INDEXER_ALLOW_UNAUTH_WEBHOOK: "true" },
      async () => {
        const r = checkWebhookAuth(undefined);
        expect(r.ok).to.equal(true);
        expect(r.reason).to.equal("no_secret_unauth_allowed");
      },
    );
  });

  it("rejects a bad Bearer", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: "the-good-secret", INDEXER_ALLOW_UNAUTH_WEBHOOK: undefined },
      async () => {
        const r = checkWebhookAuth("Bearer the-bad-secret-x");
        expect(r.ok).to.equal(false);
        expect(r.reason).to.equal("bad_token");
      },
    );
  });

  it("rejects missing Authorization header", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: "the-good-secret", INDEXER_ALLOW_UNAUTH_WEBHOOK: undefined },
      async () => {
        const r = checkWebhookAuth(undefined);
        expect(r.ok).to.equal(false);
        expect(r.reason).to.equal("bad_token");
      },
    );
  });

  it("rejects Authorization given as a string[] (does not throw)", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: "the-good-secret", INDEXER_ALLOW_UNAUTH_WEBHOOK: undefined },
      async () => {
        const r = checkWebhookAuth(["Bearer the-good-secret"]);
        expect(r.ok).to.equal(false);
        expect(r.reason).to.equal("bad_token");
      },
    );
  });

  it("rejects Bearer of wrong length without throwing (timingSafeEqual length-mismatch shortcut)", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: "the-good-secret", INDEXER_ALLOW_UNAUTH_WEBHOOK: undefined },
      async () => {
        const r = checkWebhookAuth("Bearer x");
        expect(r.ok).to.equal(false);
        expect(r.reason).to.equal("bad_token");
      },
    );
  });

  it("accepts a valid Bearer", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: "the-good-secret", INDEXER_ALLOW_UNAUTH_WEBHOOK: undefined },
      async () => {
        const r = checkWebhookAuth("Bearer the-good-secret");
        expect(r.ok).to.equal(true);
        expect(r.reason).to.equal("ok");
      },
    );
  });
});

describe("webhook auth gate (HTTP)", () => {
  it("rejects with 401 when secret unset and no opt-in", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: undefined, INDEXER_ALLOW_UNAUTH_WEBHOOK: undefined },
      async () => {
        const app = await buildServer(PRISMA_STUB);
        try {
          const res = await app.inject({
            method: "POST",
            url: "/webhook/helius",
            payload: [],
          });
          expect(res.statusCode).to.equal(401);
        } finally {
          await app.close();
        }
      },
    );
  });

  it("rejects with 401 on bad Bearer", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: "the-good-secret", INDEXER_ALLOW_UNAUTH_WEBHOOK: undefined },
      async () => {
        const app = await buildServer(PRISMA_STUB);
        try {
          const res = await app.inject({
            method: "POST",
            url: "/webhook/helius",
            payload: [],
            headers: { authorization: "Bearer the-bad-secret-x" },
          });
          expect(res.statusCode).to.equal(401);
        } finally {
          await app.close();
        }
      },
    );
  });

  it("passes auth on valid Bearer (then 400 from empty-body schema)", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: "the-good-secret", INDEXER_ALLOW_UNAUTH_WEBHOOK: undefined },
      async () => {
        const app = await buildServer(PRISMA_STUB);
        try {
          // Empty array fails the `.min(1)` schema → 400. The KEY point
          // is that 400 (not 401) means we passed the auth gate, which
          // is what we're asserting.
          const res = await app.inject({
            method: "POST",
            url: "/webhook/helius",
            payload: [],
            headers: { authorization: "Bearer the-good-secret" },
          });
          expect(res.statusCode).to.equal(400);
        } finally {
          await app.close();
        }
      },
    );
  });

  it("passes auth on unauth opt-in (then 400 from empty-body schema)", async () => {
    await withEnv(
      { HELIUS_WEBHOOK_SECRET: undefined, INDEXER_ALLOW_UNAUTH_WEBHOOK: "true" },
      async () => {
        const app = await buildServer(PRISMA_STUB);
        try {
          const res = await app.inject({
            method: "POST",
            url: "/webhook/helius",
            payload: [],
          });
          expect(res.statusCode).to.equal(400);
        } finally {
          await app.close();
        }
      },
    );
  });
});
