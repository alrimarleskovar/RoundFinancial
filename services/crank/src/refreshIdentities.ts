/**
 * Refresh-identity crank pass — closes the SEV-E passive-expiry residual for
 * the L4 "Elite" tier.
 *
 * SEV-E (closed in #505) re-applies the identity floor to a profile's stored
 * level on `unlink_identity` / `refresh_identity`. The remaining sliver: an
 * identity that lapses by WALL-CLOCK (`expires_at` passes) is observed by
 * nothing until someone calls refresh/unlink — so a `join_pool` in between can
 * still consume the stale Elite (3% stake) tier. `roundfi-core` MUST NOT read
 * the IdentityRecord (the architecture boundary in `state/identity.rs`), so the
 * stored snapshot has to be corrected off-chain.
 *
 * This pass enumerates every L4 profile and, for each whose IdentityRecord is
 * "stale-verified" (status == Verified but `expires_at` has passed), fires the
 * permissionless `refresh_identity` — which re-reads the passport and, if it is
 * no longer Active, flips the record + demotes the profile to the identity
 * floor. Scoped to L4 because that is the only tier where the asymmetry bites.
 */

import {
  fetchIdentityRecord,
  listEliteProfiles,
  refreshIdentity,
  type IdentityRecordView,
  type RoundFiClient,
} from "@roundfi/sdk";

import { classifyError } from "./classifyError.js";
import { logger } from "./logger.js";

/** `IdentityStatus::Verified` — roundfi-reputation `state/identity.rs`. */
const IDENTITY_STATUS_VERIFIED = 1;

export interface RefreshResult {
  subject: string;
  status: "refreshed" | "failed";
  reason?: string;
  errorKind?: "INFRA" | "LOGIC" | "UNKNOWN";
}

/**
 * Pure: does this L4's IdentityRecord need a refresh? True ONLY when it still
 * CLAIMS `Verified` but its wall-clock expiry has passed (`expires_at != 0 &&
 * <= now`). A missing link (core already treats it as L1-floored), a
 * never-expiring record (`expires_at == 0`), a not-yet-expired one, or an
 * already-flipped record (status != Verified — the floor was already applied)
 * all need nothing.
 */
export function isStaleElite(identity: IdentityRecordView | null, nowEpochSecs: number): boolean {
  if (!identity) return false;
  if (identity.status !== IDENTITY_STATUS_VERIFIED) return false;
  if (identity.expiresAt === 0n) return false;
  return identity.expiresAt <= BigInt(nowEpochSecs);
}

/**
 * Enumerate L4 profiles and refresh the ones whose identity has lapsed by
 * wall-clock. Returns one entry per L4 that was ACTED ON (stale ones); fresh /
 * never-linked / never-expiring L4s are skipped silently. Per-subject errors
 * are isolated so one bad refresh doesn't stop the rest.
 */
export async function refreshStaleElites(
  client: RoundFiClient,
  nowEpochSecs: number = Math.floor(Date.now() / 1000),
): Promise<RefreshResult[]> {
  const elites = await listEliteProfiles(client);
  const results: RefreshResult[] = [];

  for (const profile of elites) {
    const identity = await fetchIdentityRecord(client, profile.wallet);
    if (!isStaleElite(identity, nowEpochSecs)) continue;

    const subject = profile.wallet.toBase58();
    try {
      logger.info({ event_type: "refresh.start", subject }, "Refreshing stale Elite identity");
      await refreshIdentity(client, {
        subject: profile.wallet,
        gatewayToken: identity!.gatewayToken,
      });
      logger.info({ event_type: "refresh.success", subject }, "refresh_identity confirmed");
      results.push({ subject, status: "refreshed" });
    } catch (err) {
      const errorKind = classifyError(err);
      const msg = err instanceof Error ? err.message : String(err);
      // LOGIC = on-chain state diverged from our read; escalate. INFRA/UNKNOWN
      // = transient; next sweep retries.
      const level = errorKind === "LOGIC" ? "error" : "warn";
      logger[level](
        { event_type: "refresh.failed", subject, errorKind, error: msg },
        `refresh_identity failed (${errorKind})`,
      );
      results.push({ subject, status: "failed", reason: msg, errorKind });
    }
  }

  return results;
}
