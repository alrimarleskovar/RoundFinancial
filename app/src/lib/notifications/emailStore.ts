/**
 * Pluggable store for email subscriptions — the notification twin of
 * `lib/admin/sharedStore.ts`, with the same two-backend shape:
 *
 *   - `memory` (default): a process-local Map. Single-instance correct, no DB,
 *     so the prisma-free `js` CI lane + unit tests run unchanged.
 *   - `postgres`: durable + shared across instances — selected by
 *     `EMAIL_SUBSCRIPTION_STORE=postgres` (only meaningful where DATABASE_URL
 *     is set, i.e. the same DB the indexer owns). Writes the
 *     `email_subscriptions` table via an upsert keyed on the wallet.
 *
 * Prisma is imported DYNAMICALLY inside the Postgres methods only, so the
 * in-memory path (and the prisma-free test lane) never needs
 * `@roundfi/indexer/db` to resolve or a DB to connect.
 *
 * The send side (a leased indexer cron behind a swappable adapter) reads this
 * same table in a later PR; this module only owns the cadastro writes/reads.
 */

export interface EmailSubscriptionRecord {
  email: string;
  optedIn: boolean;
  /** Preferred email language ("pt" | "en"). */
  lang: string;
}

export interface EmailSubscriptionStore {
  /** Bind (or re-bind) an email to a wallet, opted-in. Idempotent upsert. */
  subscribe(wallet: string, email: string, token: string, lang: string): Promise<void>;
  /** Mark a wallet opted-out (row kept for audit). Returns false if the wallet
   *  had no subscription to begin with. */
  unsubscribe(wallet: string, token: string): Promise<boolean>;
  /** Current binding for a wallet, or null if none. */
  get(wallet: string): Promise<EmailSubscriptionRecord | null>;
}

// ─── In-memory backend (default) ─────────────────────────────────────────

interface MemRow {
  email: string;
  optedIn: boolean;
  lastToken: string;
  lang: string;
}
const rows = new Map<string, MemRow>();

const inMemoryStore: EmailSubscriptionStore = {
  async subscribe(wallet, email, token, lang) {
    rows.set(wallet, { email, optedIn: true, lastToken: token, lang });
  },
  async unsubscribe(wallet, token) {
    const row = rows.get(wallet);
    if (!row) return false;
    rows.set(wallet, { ...row, optedIn: false, lastToken: token });
    return true;
  },
  async get(wallet) {
    const row = rows.get(wallet);
    return row ? { email: row.email, optedIn: row.optedIn, lang: row.lang } : null;
  },
};

// ─── Postgres backend (opt-in) ───────────────────────────────────────────

const postgresStore: EmailSubscriptionStore = {
  async subscribe(wallet, email, token, lang) {
    const { getPrisma } = await import("@roundfi/indexer/db");
    const prisma = getPrisma();
    await prisma.emailSubscription.upsert({
      where: { wallet },
      create: { wallet, email, optedIn: true, lastToken: token, lang },
      update: { email, optedIn: true, lastToken: token, lang },
    });
  },
  async unsubscribe(wallet, token) {
    const { getPrisma } = await import("@roundfi/indexer/db");
    const prisma = getPrisma();
    // updateMany (not update) so a missing row is a 0-count, not a throw.
    const res = await prisma.emailSubscription.updateMany({
      where: { wallet },
      data: { optedIn: false, lastToken: token },
    });
    return res.count > 0;
  },
  async get(wallet) {
    const { getPrisma } = await import("@roundfi/indexer/db");
    const prisma = getPrisma();
    const row = await prisma.emailSubscription.findUnique({
      where: { wallet },
      select: { email: true, optedIn: true, lang: true },
    });
    return row ?? null;
  },
};

// ─── Selector ────────────────────────────────────────────────────────────

/** Which backend the env selects. Default `memory` preserves CI behavior. */
export function emailStoreBackend(): "memory" | "postgres" {
  return process.env.EMAIL_SUBSCRIPTION_STORE === "postgres" ? "postgres" : "memory";
}

export function getEmailStore(): EmailSubscriptionStore {
  return emailStoreBackend() === "postgres" ? postgresStore : inMemoryStore;
}

// ─── Test seam ───────────────────────────────────────────────────────────

/** Clears the in-memory backend between unit-test cases. */
export function __resetEmailStoreForTest(): void {
  rows.clear();
}
