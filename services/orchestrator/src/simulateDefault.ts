/**
 * Explicit default simulator — a thin, opinionated wrapper around
 * `runCycle` for the "one member misses cycle X" demo beat.
 *
 * Deliberately limited surface area:
 *   - the caller names exactly which member defaults and at which cycle,
 *   - the simulator never chooses randomly, never retries, never
 *     settles — it just skips the contribution and lets the on-chain
 *     book reflect the missed payment,
 *   - on-chain settlement (`settle_default`) requires the 7-day grace
 *     window, which the demo localnet can't warp; this is covered in
 *     the bankrun edge test instead. The orchestrator announces the
 *     "would-be-settled" consequence in the log so the demo narrative
 *     stays coherent.
 */

import type { PublicKey } from "@solana/web3.js";

import type { RoundFiClient } from "@roundfi/sdk";

import type { EventSink } from "./events.js";
import { now } from "./events.js";
import { runCycle, type RunCycleResult } from "./runCycle.js";
import type { DemoMember } from "./setup.js";

export interface SimulateDefaultArgs {
  client: RoundFiClient;
  pool: PublicKey;
  usdcMint: PublicKey;
  members: DemoMember[];
  /** Zero-based cycle index during which the default occurs. */
  atCycle: number;
  /** Slot index of the member that will miss the contribution. */
  memberSlotIndex: number;
  sink: EventSink;
}

export async function simulateDefault(args: SimulateDefaultArgs): Promise<RunCycleResult> {
  const defaulter = args.members.find((m) => m.slotIndex === args.memberSlotIndex);
  if (!defaulter) {
    throw new Error(`simulateDefault: no member found at slot ${args.memberSlotIndex}`);
  }

  args.sink({
    kind: "action.ok",
    action: "simulateDefault",
    actor: defaulter.name,
    detail:
      `Scenario: ${defaulter.name} (slot ${defaulter.slotIndex}) will skip ` +
      `contribution for cycle ${args.atCycle}`,
    at: now(),
  });

  const result = await runCycle({
    client: args.client,
    pool: args.pool,
    usdcMint: args.usdcMint,
    members: args.members,
    cycle: args.atCycle,
    skipContribute: [defaulter.slotIndex],
    sink: args.sink,
  });

  args.sink({
    kind: "action.ok",
    action: "simulateDefault.note",
    actor: defaulter.name,
    detail:
      `On mainnet, ${defaulter.name}'s position would be flagged for ` +
      `settle_default after a 7-day grace period. The orchestrator does ` +
      `not advance real time, so the economic recovery waterfall is ` +
      `demonstrated in the bankrun edge suite (tests/edge_grace_default.spec.ts).`,
    at: now(),
  });

  return result;
}
