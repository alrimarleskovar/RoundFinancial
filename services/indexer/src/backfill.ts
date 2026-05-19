/**
 * Backfill — hydrate Postgres from a fresh devnet/mainnet cluster.
 *
 * Run on first deploy + whenever the indexer is paused for >1h. Reads
 * every Pool + Member account that exists under `roundfi-core` via
 * `getProgramAccounts` filters, decodes them with the IDL-free
 * `decodePoolRaw` / `decodeMemberRaw` from `@roundfi/sdk`, and upserts
 * the canonical rows. Event tables are NOT backfilled here — those
 * come from `getSignaturesForAddress` against each pool PDA + the
 * webhook flow (this script gives the *current state*, the webhook
 * layer gives the *event log*).
 *
 * The two pools the demo expects to find on devnet (1, 2, 3) are
 * pinned in `app/src/lib/devnet.ts`; backfill is broader because new
 * pools may appear without front-end-side fixture updates.
 *
 * Cron-health tracking
 * ====================
 *
 * Every invocation writes a `BackfillRun` row at startup (status =
 * `"running"`) and updates it at the end (status = `"ok"` | `"error"`)
 * with `finishedAt`, `durationMs`, `poolsTouched`, `membersTouched`,
 * and `errorMessage` on failure. Closes item #3 of
 * `docs/observability/README.md` "Pre-deployment readiness" — the
 * `/metrics` scrape reads the most recent row to emit
 * `roundfi_indexer_last_backfill_run_timestamp_seconds` +
 * `roundfi_indexer_last_backfill_status`.
 *
 * Usage:
 *   DATABASE_URL=postgres://... \
 *   ROUNDFI_CORE_PROGRAM_ID=8LVrgxKw... \
 *   SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   pnpm --filter @roundfi/indexer backfill
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { PrismaClient } from "@prisma/client";

import { decodePoolRaw, decodeMemberRaw } from "@roundfi/sdk";

import { createLogger } from "./log.js";

// Pool::SIZE = 244 bytes (8 disc + 236 fields). Member::SIZE = 187.
// These are the dataSize filters we hand to getProgramAccounts.
const POOL_ACCOUNT_SIZE = 244;
const MEMBER_ACCOUNT_SIZE = 187;

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const CORE_PROGRAM = process.env.ROUNDFI_CORE_PROGRAM_ID;

const logger = createLogger({ service: "backfill" });

if (!CORE_PROGRAM) {
  logger.error({ event_type: "startup" }, "ROUNDFI_CORE_PROGRAM_ID env var is required");
  process.exit(1);
}

async function main(): Promise<void> {
  const programId = new PublicKey(CORE_PROGRAM!);
  const connection = new Connection(RPC, "confirmed");
  const prisma = new PrismaClient();
  const startedAt = Date.now();

  // Insert "running" row so an in-flight scrape can distinguish
  // mid-run from successful-completion. The reconciler-style cron
  // health check then updates this same row in finally{}.
  const runRow = await prisma.backfillRun.create({
    data: {
      programId: programId.toBase58(),
      status: "running",
    },
  });

  let poolsTouched = 0;
  let membersTouched = 0;
  let finalStatus: "ok" | "error" = "ok";
  let errorMessage: string | null = null;

  try {
    logger.info(
      { event_type: "backfill_start", rpc: RPC, programId: programId.toBase58() },
      "backfill starting",
    );

    // ─── Pools ──────────────────────────────────────────────────────
    const poolAccounts = await connection.getProgramAccounts(programId, {
      commitment: "confirmed",
      filters: [{ dataSize: POOL_ACCOUNT_SIZE }],
    });
    logger.info(
      { event_type: "backfill_pools_fetched", count: poolAccounts.length },
      "pool accounts fetched",
    );

    for (const { pubkey, account } of poolAccounts) {
      const view = decodePoolRaw(pubkey, account.data as Buffer);
      await prisma.pool.upsert({
        where: { pda: pubkey.toBase58() },
        create: {
          pda: pubkey.toBase58(),
          authority: view.authority.toBase58(),
          seedId: view.seedId,
          usdcMint: view.usdcMint.toBase58(),
          yieldAdapter: view.yieldAdapter.toBase58(),
          membersTarget: view.membersTarget,
          installmentAmount: view.installmentAmount,
          creditAmount: view.creditAmount,
          cyclesTotal: view.cyclesTotal,
          cycleDurationSec: view.cycleDurationSec,
          seedDrawBps: view.seedDrawBps,
          solidarityBps: view.solidarityBps,
          escrowReleaseBps: view.escrowReleaseBps,
          membersJoined: view.membersJoined,
          status: poolStatusEnum(view.status),
          startedAt: view.startedAt === 0n ? null : view.startedAt,
          currentCycle: view.currentCycle,
          nextCycleAt: view.nextCycleAt === 0n ? null : view.nextCycleAt,
          totalContributed: view.totalContributed,
          totalPaidOut: view.totalPaidOut,
          solidarityBalance: view.solidarityBalance,
          escrowBalance: view.escrowBalance,
          yieldAccrued: view.yieldAccrued,
          guaranteeFundBalance: view.guaranteeFundBalance,
          totalProtocolFeeAccrued: view.totalProtocolFeeAccrued,
          yieldPrincipalDeposited: view.yieldPrincipalDeposited,
          defaultedMembers: view.defaultedMembers,
          slotsBitmapHex: view.occupiedSlots.map((s) => s.toString(16).padStart(2, "0")).join(""),
        },
        update: {
          membersJoined: view.membersJoined,
          status: poolStatusEnum(view.status),
          startedAt: view.startedAt === 0n ? null : view.startedAt,
          currentCycle: view.currentCycle,
          nextCycleAt: view.nextCycleAt === 0n ? null : view.nextCycleAt,
          totalContributed: view.totalContributed,
          totalPaidOut: view.totalPaidOut,
          solidarityBalance: view.solidarityBalance,
          escrowBalance: view.escrowBalance,
          yieldAccrued: view.yieldAccrued,
          guaranteeFundBalance: view.guaranteeFundBalance,
          totalProtocolFeeAccrued: view.totalProtocolFeeAccrued,
          yieldPrincipalDeposited: view.yieldPrincipalDeposited,
          defaultedMembers: view.defaultedMembers,
        },
      });
      poolsTouched += 1;
    }

    // ─── Members ────────────────────────────────────────────────────
    const memberAccounts = await connection.getProgramAccounts(programId, {
      commitment: "confirmed",
      filters: [{ dataSize: MEMBER_ACCOUNT_SIZE }],
    });
    logger.info(
      { event_type: "backfill_members_fetched", count: memberAccounts.length },
      "member accounts fetched",
    );

    for (const { pubkey, account } of memberAccounts) {
      const view = decodeMemberRaw(pubkey, account.data as Buffer);
      const pool = await prisma.pool.findUnique({
        where: { pda: view.pool.toBase58() },
      });
      if (!pool) {
        logger.warn(
          {
            event_type: "backfill_orphan_member",
            memberPda: pubkey.toBase58(),
            poolPda: view.pool.toBase58(),
          },
          "orphan member — pool not in DB",
        );
        continue;
      }
      await prisma.member.upsert({
        where: { pda: pubkey.toBase58() },
        create: {
          pda: pubkey.toBase58(),
          poolId: pool.id,
          wallet: view.wallet.toBase58(),
          nftAsset: view.nftAsset.toBase58(),
          slotIndex: view.slotIndex,
          reputationLevel: view.reputationLevel,
          stakeBps: view.stakeBps,
          stakeDeposited: view.stakeDeposited,
          contributionsPaid: view.contributionsPaid,
          totalContributed: view.totalContributed,
          totalReceived: view.totalReceived,
          escrowBalance: view.escrowBalance,
          onTimeCount: view.onTimeCount,
          lateCount: view.lateCount,
          defaulted: view.defaulted,
          paidOut: view.paidOut,
          lastReleasedCheckpoint: view.lastReleasedCheckpoint,
          joinedAt: view.joinedAt,
          stakeDepositedInitial: view.stakeDepositedInitial,
          totalEscrowDeposited: view.totalEscrowDeposited,
          lastTransferredAt: view.lastTransferredAt,
        },
        update: {
          stakeDeposited: view.stakeDeposited,
          contributionsPaid: view.contributionsPaid,
          totalContributed: view.totalContributed,
          totalReceived: view.totalReceived,
          escrowBalance: view.escrowBalance,
          onTimeCount: view.onTimeCount,
          lateCount: view.lateCount,
          defaulted: view.defaulted,
          paidOut: view.paidOut,
          lastReleasedCheckpoint: view.lastReleasedCheckpoint,
          lastTransferredAt: view.lastTransferredAt,
        },
      });
      membersTouched += 1;
    }

    logger.info(
      {
        event_type: "backfill_complete",
        poolsTouched,
        membersTouched,
        durationMs: Date.now() - startedAt,
      },
      "backfill done",
    );
  } catch (err) {
    finalStatus = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(
      { event_type: "backfill_failed", error: err, poolsTouched, membersTouched },
      "backfill failed mid-flight",
    );
    throw err;
  } finally {
    await prisma.backfillRun.update({
      where: { id: runRow.id },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        poolsTouched,
        membersTouched,
        errorMessage,
      },
    });
    await prisma.$disconnect();
  }
}

function poolStatusEnum(s: string): "Forming" | "Active" | "Completed" | "Liquidated" | "Closed" {
  switch (s) {
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "liquidated":
      return "Liquidated";
    case "closed":
      // Adevar Labs SEV-005 — terminal post-close_pool state.
      return "Closed";
    default:
      return "Forming";
  }
}

main().catch((err) => {
  // The finally block in main() already persisted the failure; this
  // catches the rethrow + sets the exit code so the cron host marks
  // the run as failed.
  logger.error({ event_type: "process_exit", error: err }, "exiting non-zero");
  process.exit(1);
});
