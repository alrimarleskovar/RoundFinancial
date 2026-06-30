/**
 * Email notification sender (PR3b). Scans opted-in subscriptions + on-chain
 * pool state and sends due-date / pool-started / new-group emails, deduped via
 * `EmailSentLog`. Dark unless EMAIL_NOTIFICATIONS_ENABLED=true.
 *
 * Runs STANDALONE on an operator machine (Option 1 / Gmail SMTP) — NOT inside
 * the Fastify server or the reconciler daemon. It reads subscriptions from the
 * shared Postgres and pool state straight from chain (the indexer needn't be
 * deployed), so it works anywhere with network + the env below.
 *
 * Full pass (one shot + exit):
 *   EMAIL_NOTIFICATIONS_ENABLED=true \
 *   DATABASE_URL=postgres://...                 # the shared opt-in DB (Neon/…) \
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   ROUNDFI_CORE_PROGRAM_ID=8LVrgxKw... \
 *   ROUNDFI_REPUTATION_PROGRAM_ID=Hpo174...     # optional; level → new-group \
 *   SMTP_HOST=smtp.gmail.com SMTP_PORT=465 \
 *   SMTP_USER=roundfinance.sol@gmail.com SMTP_PASS=<app-password> \
 *   pnpm --filter @roundfi/indexer notify:once
 *
 * Daemon (loops every NOTIFY_INTERVAL_MS, default 5 min):
 *   ...same env...  pnpm --filter @roundfi/indexer notify
 *
 * Quick delivery test (NO Postgres / NO on-chain — just proves the Gmail path):
 *   EMAIL_NOTIFICATIONS_ENABLED=true NOTIFY_TEST_TO=you@email.com \
 *   SMTP_HOST=smtp.gmail.com SMTP_PORT=465 \
 *   SMTP_USER=roundfinance.sol@gmail.com SMTP_PASS=<app-password> \
 *   pnpm --filter @roundfi/indexer notify:once
 */

import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  decodeMemberRaw,
  decodePoolRaw,
  fetchReputationProfileRaw,
  type RawMemberView,
  type RawPoolView,
} from "@roundfi/sdk";

import { getPrisma } from "../db.js";
import { createLogger } from "../log.js";
import { accountDiscriminatorBase58 } from "../discriminator.js";
import { getEmailAdapter, type EmailAdapter, type EmailMessage } from "./adapter.js";
import {
  dueDateEmail,
  newGroupsDigestEmail,
  poolStartedEmail,
  type EmailLang,
} from "./templates.js";
import {
  collateralPctForLevel,
  daysUntil,
  formatBrl,
  formatDate,
  levelLabel,
  shortWallet,
} from "./select.js";

// ─── Config ────────────────────────────────────────────────────────────────
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const CORE_PROGRAM = process.env.ROUNDFI_CORE_PROGRAM_ID;
const REPUTATION_PROGRAM = process.env.ROUNDFI_REPUTATION_PROGRAM_ID;
const BASE_URL = process.env.NOTIFY_BASE_URL ?? "https://roundfi.vercel.app";
// Default = the hosted brand lockup — a CLEAN transparent PNG of the real
// RoundFi mark + wordmark, served from the app's public dir. The <img> carries
// alt="RoundFi", so a client that blocks remote images still shows the name.
// Set NOTIFY_LOGO_URL="" to force the inline text wordmark instead. (The old
// prototype JPEG was boxed/non-transparent and looked broken; the new asset is
// the app's gradient logomark rasterized at the template's 120×34 aspect.)
const LOGO_URL = process.env.NOTIFY_LOGO_URL ?? `${BASE_URL}/email-logo.png`;
const DUE_WINDOW_SECS = Number(process.env.NOTIFY_DUE_WINDOW_HOURS ?? "48") * 3600;
const INTERVAL_MS = Number(process.env.NOTIFY_INTERVAL_MS ?? "300000");

const unsubUrl = `${BASE_URL}/carteira?tab=connections`;
const payUrl = `${BASE_URL}/grupos`;
const groupUrl = `${BASE_URL}/grupos`;

const logger = createLogger({ service: "notify" });

const POOL_DISC = accountDiscriminatorBase58("Pool");
const MEMBER_DISC = accountDiscriminatorBase58("Member");

function emailNotificationsEnabled(): boolean {
  return process.env.EMAIL_NOTIFICATIONS_ENABLED === "true";
}

// Pools carry no on-chain name; an operator can map pda → friendly name via the
// NOTIFY_POOL_LABELS env (JSON: {"<pda>":"Pool Rápida"}), else "Pool #<seedId>".
function poolLabel(pda: string, seedId: bigint): string {
  try {
    const map = JSON.parse(process.env.NOTIFY_POOL_LABELS ?? "{}") as Record<string, string>;
    if (typeof map[pda] === "string") return map[pda]!;
  } catch {
    /* malformed map → fall through to the default */
  }
  return `Pool #${seedId.toString()}`;
}

type Prisma = ReturnType<typeof getPrisma>;

interface Counters {
  due: number;
  poolStarted: number;
  newGroup: number;
  skipped: number;
  errors: number;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** Claim-then-send. INSERT the dedup row FIRST (atomic, race-safe); a P2002
 *  unique violation means another tick/instance already sent it → skip. On a
 *  send failure DELETE the claim so a later tick retries (lease, not tombstone). */
async function sendDeduped(
  prisma: Prisma,
  adapter: EmailAdapter,
  key: { wallet: string; kind: string; dedupeKey: string },
  msg: EmailMessage,
): Promise<"sent" | "skipped" | "error"> {
  try {
    await prisma.emailSentLog.create({ data: key });
  } catch (err) {
    if (isUniqueViolation(err)) return "skipped";
    throw err;
  }
  const res = await adapter.send(msg);
  if (!res.ok) {
    await prisma.emailSentLog.deleteMany({ where: key }).catch(() => {});
    logger.warn({ event_type: "notify_send_failed", ...key, error: res.error }, "send failed");
    return "error";
  }
  logger.info({ event_type: "notify_sent", ...key, to: msg.to, id: res.id }, "email sent");
  return "sent";
}

async function readLevel(connection: Connection, wallet: string): Promise<number> {
  if (!REPUTATION_PROGRAM) return 1;
  try {
    const profile = await fetchReputationProfileRaw(
      connection,
      new PublicKey(REPUTATION_PROGRAM),
      new PublicKey(wallet),
    );
    return profile?.level ?? 1;
  } catch {
    return 1;
  }
}

interface PoolBundle {
  pda: PublicKey;
  pool: RawPoolView;
  members: RawMemberView[];
}

// Enumerate every Pool + Member via the Anchor account discriminator (memcmp at
// offset 0) — survives struct-layout edits, unlike a dataSize filter (mirrors
// backfill.ts).
async function fetchAllPools(connection: Connection, programId: PublicKey): Promise<PoolBundle[]> {
  const [poolAccts, memberAccts] = await Promise.all([
    connection.getProgramAccounts(programId, {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 0, bytes: POOL_DISC } }],
    }),
    connection.getProgramAccounts(programId, {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 0, bytes: MEMBER_DISC } }],
    }),
  ]);
  const members = memberAccts.map(({ pubkey, account }) =>
    decodeMemberRaw(pubkey, account.data as Buffer),
  );
  return poolAccts.map(({ pubkey, account }) => ({
    pda: pubkey,
    pool: decodePoolRaw(pubkey, account.data as Buffer),
    members: members.filter((m) => m.pool.equals(pubkey)),
  }));
}

type Sub = { wallet: string; email: string; lang: string };

function langOf(s: Sub): EmailLang {
  return s.lang === "en" ? "en" : "pt";
}

// Marker row recording that a wallet's new-group baseline has been taken.
const NEW_GROUP_SEED_KIND = "new_group_seed";

// One open Forming pool a subscriber isn't a member of — a candidate for the
// "new group for your level" digest.
type NewGroupCand = { pdaStr: string; name: string; slotsFilled: number; slotsTotal: number };

// First time we evaluate new-group for a wallet, record every currently-open
// group as "already known" WITHOUT emailing (+ a seed marker), so a fresh
// subscriber isn't flooded with the pre-existing backlog. Only groups that open
// AFTER this baseline will alert. Idempotent: a P2002 on an existing row is fine.
async function seedNewGroupBaseline(
  prisma: Prisma,
  wallet: string,
  candidates: NewGroupCand[],
): Promise<void> {
  for (const c of candidates) {
    await prisma.emailSentLog
      .create({ data: { wallet, kind: "new_group", dedupeKey: c.pdaStr } })
      .catch(() => {});
  }
  await prisma.emailSentLog
    .create({ data: { wallet, kind: NEW_GROUP_SEED_KIND, dedupeKey: "baseline" } })
    .catch(() => {});
}

// Send ONE digest listing the genuinely-new groups (vs one email per pool).
// Claims each group's dedup row first (race-safe — a P2002 means another tick
// already took it); only the rows we win get listed. On send failure the claims
// are released so a later tick retries.
async function sendNewGroupDigest(
  prisma: Prisma,
  adapter: EmailAdapter,
  sub: Sub,
  level: number,
  fresh: NewGroupCand[],
): Promise<"sent" | "skipped" | "error"> {
  const claimed: NewGroupCand[] = [];
  for (const c of fresh) {
    try {
      await prisma.emailSentLog.create({
        data: { wallet: sub.wallet, kind: "new_group", dedupeKey: c.pdaStr },
      });
      claimed.push(c);
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  if (claimed.length === 0) return "skipped";
  const { subject, html } = newGroupsDigestEmail(
    {
      email: sub.email,
      walletShort: shortWallet(sub.wallet),
      logoUrl: LOGO_URL,
      unsubUrl,
      levelLabel: levelLabel(level),
      groups: claimed.map((c) => ({
        groupName: c.name,
        slotsFilled: c.slotsFilled,
        slotsTotal: c.slotsTotal,
        collateralPct: collateralPctForLevel(level),
      })),
      groupUrl,
    },
    langOf(sub),
  );
  const res = await adapter.send({ to: sub.email, subject, html });
  if (!res.ok) {
    for (const c of claimed) {
      await prisma.emailSentLog
        .deleteMany({ where: { wallet: sub.wallet, kind: "new_group", dedupeKey: c.pdaStr } })
        .catch(() => {});
    }
    logger.warn(
      {
        event_type: "notify_send_failed",
        wallet: sub.wallet,
        kind: "new_group_digest",
        error: res.error,
      },
      "digest send failed",
    );
    return "error";
  }
  logger.info(
    {
      event_type: "notify_sent",
      wallet: sub.wallet,
      kind: "new_group_digest",
      count: claimed.length,
      to: sub.email,
      id: res.id,
    },
    "digest sent",
  );
  return "sent";
}

/** One scan over (subscriptions × pools). Idempotent — EmailSentLog dedup makes
 *  re-running send nothing new. */
export async function notifyOnce(
  prisma: Prisma,
  connection: Connection,
  adapter: EmailAdapter,
  nowSec: number,
): Promise<Counters> {
  const counters: Counters = { due: 0, poolStarted: 0, newGroup: 0, skipped: 0, errors: 0 };
  const subs = (await prisma.emailSubscription.findMany({
    where: { optedIn: true },
    select: { wallet: true, email: true, lang: true },
  })) as Sub[];
  if (subs.length === 0) {
    logger.info({ event_type: "notify_no_subs" }, "no opted-in subscriptions — nothing to do");
    return counters;
  }
  const byWallet = new Map(subs.map((s) => [s.wallet, s]));
  const pools = await fetchAllPools(connection, new PublicKey(CORE_PROGRAM!));

  const tally = (r: "sent" | "skipped" | "error", kind: "due" | "poolStarted" | "newGroup") => {
    if (r === "skipped") counters.skipped += 1;
    else if (r === "error") counters.errors += 1;
    else counters[kind] += 1;
  };

  // New-group alerts are accumulated per subscriber across ALL pools, then sent
  // as ONE digest after the loop (instead of one email per Forming pool).
  const newGroupCandidates = new Map<string, NewGroupCand[]>();

  for (const { pda, pool, members } of pools) {
    const pdaStr = pda.toBase58();
    const name = poolLabel(pdaStr, pool.seedId);

    if (pool.status === "active") {
      for (const m of members) {
        const sub = byWallet.get(m.wallet.toBase58());
        if (!sub) continue;
        const lang = langOf(sub);
        const common = {
          email: sub.email,
          walletShort: shortWallet(sub.wallet),
          logoUrl: LOGO_URL,
          unsubUrl,
        };

        // POOL STARTED — fires once per (member, pool) the first scan after the
        // pool goes Active.
        {
          const { subject, html } = poolStartedEmail(
            {
              ...common,
              groupName: name,
              membersTarget: pool.membersTarget,
              firstDueDate: formatDate(pool.nextCycleAt, lang),
              installmentBrl: formatBrl(pool.installmentAmount),
              groupUrl,
            },
            lang,
          );
          tally(
            await sendDeduped(
              prisma,
              adapter,
              { wallet: sub.wallet, kind: "pool_started", dedupeKey: pdaStr },
              { to: sub.email, subject, html },
            ),
            "poolStarted",
          );
        }

        // DUE REMINDER — member owes the CURRENT cycle and it's within the
        // window (and not already past — that's a late/default case, not a
        // "vence em X dias" reminder).
        const owes = !m.defaulted && m.contributionsPaid === pool.currentCycle;
        const secsLeft = Number(pool.nextCycleAt) - nowSec;
        const days = daysUntil(nowSec, Number(pool.nextCycleAt));
        if (owes && days !== null && secsLeft <= DUE_WINDOW_SECS) {
          const { subject, html } = dueDateEmail(
            {
              ...common,
              groupName: name,
              installmentBrl: formatBrl(pool.installmentAmount),
              dueDate: formatDate(pool.nextCycleAt, lang),
              days,
              payUrl,
            },
            lang,
          );
          tally(
            await sendDeduped(
              prisma,
              adapter,
              { wallet: sub.wallet, kind: "due", dedupeKey: `${pdaStr}:cycle${pool.currentCycle}` },
              { to: sub.email, subject, html },
            ),
            "due",
          );
        }
      }
    }

    // NEW GROUP — a Forming pool with open slots → opted-in wallets NOT already
    // members. Pools aren't level-tagged on-chain, so the "for your level"
    // framing comes from the recipient's own collateral tier. Collected per
    // subscriber here; sent as ONE digest after the loop (see below).
    if (pool.status === "forming" && pool.membersJoined < pool.membersTarget) {
      const memberSet = new Set(members.map((m) => m.wallet.toBase58()));
      for (const sub of subs) {
        if (memberSet.has(sub.wallet)) continue;
        const list = newGroupCandidates.get(sub.wallet) ?? [];
        list.push({
          pdaStr,
          name,
          slotsFilled: pool.membersJoined,
          slotsTotal: pool.membersTarget,
        });
        newGroupCandidates.set(sub.wallet, list);
      }
    }
  }

  // NEW-GROUP DIGEST — once per subscriber, after every pool is scanned.
  //   • First scan for a wallet → baseline the existing open groups SILENTLY (no
  //     email) so a fresh subscriber isn't flooded with the backlog.
  //   • Established wallet → email ONE digest of the groups it hasn't seen yet.
  for (const [wallet, candidates] of newGroupCandidates) {
    const sub = byWallet.get(wallet);
    if (!sub) continue;
    const seeded = await prisma.emailSentLog.findFirst({
      where: { wallet, kind: NEW_GROUP_SEED_KIND },
      select: { id: true },
    });
    if (!seeded) {
      await seedNewGroupBaseline(prisma, wallet, candidates);
      counters.skipped += candidates.length;
      continue;
    }
    const logged = await prisma.emailSentLog.findMany({
      where: { wallet, kind: "new_group", dedupeKey: { in: candidates.map((c) => c.pdaStr) } },
      select: { dedupeKey: true },
    });
    const loggedSet = new Set(logged.map((l) => l.dedupeKey));
    const fresh = candidates.filter((c) => !loggedSet.has(c.pdaStr));
    if (fresh.length === 0) continue;
    const level = await readLevel(connection, wallet);
    const r = await sendNewGroupDigest(prisma, adapter, sub, level, fresh);
    if (r === "sent") counters.newGroup += 1;
    else if (r === "skipped") counters.skipped += 1;
    else counters.errors += 1;
  }
  return counters;
}

// ─── Quick delivery test ─────────────────────────────────────────────────────
// Sends ONE sample of each template to NOTIFY_TEST_TO and exits — proves the
// SMTP/Gmail path end-to-end with zero Postgres / on-chain dependency.
function msgOf(rendered: { subject: string; html: string }, to: string): EmailMessage {
  return { to, subject: rendered.subject, html: rendered.html };
}

async function runTestMode(adapter: EmailAdapter, to: string, nowSec: number): Promise<void> {
  const common = { email: to, walletShort: "81u3…bchNy", logoUrl: LOGO_URL, unsubUrl };
  const dueDate = formatDate(nowSec + 2 * 86_400, "pt");
  const samples: EmailMessage[] = [
    msgOf(
      dueDateEmail(
        {
          ...common,
          groupName: "Pool Rápida · Devnet",
          installmentBrl: "R$ 82,50",
          dueDate,
          days: 2,
          payUrl,
        },
        "pt",
      ),
      to,
    ),
    msgOf(
      poolStartedEmail(
        {
          ...common,
          groupName: "Pool Rápida · Devnet",
          membersTarget: 5,
          firstDueDate: dueDate,
          installmentBrl: "R$ 82,50",
          groupUrl,
        },
        "pt",
      ),
      to,
    ),
    msgOf(
      newGroupsDigestEmail(
        {
          ...common,
          levelLabel: "Comprovado",
          groups: [
            {
              groupName: "Renovação MEI · Devnet",
              slotsFilled: 3,
              slotsTotal: 5,
              collateralPct: 25,
            },
            {
              groupName: "Capital de Giro · Devnet",
              slotsFilled: 1,
              slotsTotal: 5,
              collateralPct: 25,
            },
          ],
          groupUrl,
        },
        "pt",
      ),
      to,
    ),
  ];
  for (const m of samples) {
    const r = await adapter.send(m);
    logger.info(
      {
        event_type: "notify_test_send",
        to,
        subject: m.subject,
        ok: r.ok,
        id: r.id,
        error: r.error,
      },
      r.ok ? "test email sent" : "test email FAILED",
    );
  }
}

async function main(): Promise<void> {
  if (!emailNotificationsEnabled()) {
    logger.warn(
      { event_type: "startup" },
      "EMAIL_NOTIFICATIONS_ENABLED!=true — exiting (feature dark by default)",
    );
    return;
  }
  const adapter = getEmailAdapter();
  logger.info({ event_type: "startup", adapter: adapter.name, rpc: RPC }, "notify starting");
  if (adapter.name === "noop") {
    logger.warn(
      { event_type: "startup" },
      "adapter is noop — set SMTP_HOST/SMTP_USER/SMTP_PASS (or RESEND_API_KEY) to actually send",
    );
  }

  const testTo = process.env.NOTIFY_TEST_TO;
  if (testTo) {
    await runTestMode(adapter, testTo, Math.floor(Date.now() / 1000));
    return;
  }

  if (!CORE_PROGRAM) {
    logger.error(
      { event_type: "startup" },
      "ROUNDFI_CORE_PROGRAM_ID is required (or set NOTIFY_TEST_TO for a delivery test)",
    );
    process.exit(1);
  }
  const prisma = getPrisma();
  const connection = new Connection(RPC, "confirmed");

  const runTick = async (): Promise<Counters | null> => {
    try {
      const r = await notifyOnce(prisma, connection, adapter, Math.floor(Date.now() / 1000));
      logger.info({ event_type: "notify_tick", ...r }, "notify tick complete");
      return r;
    } catch (err) {
      logger.error({ event_type: "notify_tick", error: err }, "notify tick failed");
      return null;
    }
  };

  if (process.argv.includes("--once")) {
    const r = await runTick();
    console.log(JSON.stringify(r, null, 2));
    await prisma.$disconnect();
    return;
  }

  logger.info({ event_type: "daemon_start", intervalMs: INTERVAL_MS }, "notify daemon starting");
  void runTick();
  const timer = setInterval(() => void runTick(), INTERVAL_MS);
  const shutdown = async () => {
    clearInterval(timer);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

if (process.argv[1]?.endsWith("notify.ts") || process.argv[1]?.endsWith("notify.js")) {
  void main();
}
