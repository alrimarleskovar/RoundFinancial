/**
 * Real-mode driver for the app.
 *
 * Mirrors the shape of `runMockDemo` from `mockDemo.ts` — same config
 * inputs, same `(event) => void` callback, same `{ cancel }` handle —
 * so `page.tsx` can swap drivers by flipping one boolean without any
 * UI changes.
 *
 * Internally:
 *   1. Builds an `AnchorProvider` from a throwaway `Keypair` (authority).
 *      The connected browser wallet is *not* used to sign lifecycle txs
 *      because `@roundfi/orchestrator.lifecycleDemo` takes `authority:
 *      Keypair` and generates per-member keypairs internally. Wallet
 *      connect stays as a UX indicator for now; Step 9+ can thread it
 *      through as the admin signer.
 *   2. Loads IDLs from `/idls/*.json` (produced by the prepare-idls
 *      script after `anchor build`).
 *   3. Constructs a `RoundFiClient` and calls `lifecycleDemo(...)`
 *      with the UI's `onEvent` as the sink.
 *   4. Wraps the sink in a cancel filter so events emitted after the
 *      user hits "Stop" do not update the reducer.
 *   5. Converts any thrown error into a synthetic `action.fail` event
 *      so the EventsFeed surfaces it visibly instead of dumping to
 *      console.
 *
 * Cancellation is best-effort: once the orchestrator is mid-transaction
 * we cannot abort the RPC call, but we do stop feeding events to the UI.
 */

import { AnchorProvider } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import { createClient } from "@roundfi/sdk";
import { lifecycleDemo } from "@roundfi/orchestrator";
import type { LifecycleEvent } from "@roundfi/orchestrator";

import { loadIdls } from "./idls";

export interface RealConfig {
  memberNames: string[];
  cyclesTotal: number;
  installmentAmount: bigint;
  creditAmount: bigint;
  /** If set, member at this slot skips contribution during this cycle. */
  defaultScenario?: { memberSlotIndex: number; atCycle: number };
  /** RPC endpoint to connect to (localnet, devnet, custom). */
  endpoint: string;
  /**
   * SOL airdropped per participating wallet before the run.
   * Localnet default is 2 SOL to cover mint + many txs.
   * Pass 0 to skip airdrops entirely (funding must be external).
   */
  airdropLamports?: number;
  /** Cycle duration passed to createPool. Short for demo pacing. */
  cycleDurationSec?: number;
  /**
   * Wallet-adapter public key when a browser wallet is connected.
   * Real mode currently uses an ephemeral authority Keypair for signing,
   * so wallet connection is a UX gate rather than a signing requirement
   * — preflight still rejects unconnected runs so the user can't trip
   * into a run they didn't understand.
   */
  walletConnected: boolean;
  /** Short label for the connected wallet, if any (e.g. "Phantom"). */
  walletLabel?: string;
}

export interface RealHandle {
  cancel: () => void;
}

function nowFn(): number {
  return Date.now();
}

/**
 * Minimal browser-safe Anchor wallet for a local Keypair.
 *
 * Anchor's own `Wallet` class ships in a Node-only entrypoint; this
 * re-implements the three-member interface `AnchorProvider` expects.
 */
function makeWalletForKeypair(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      tx: T,
    ): Promise<T> {
      if (tx instanceof VersionedTransaction) {
        tx.sign([kp]);
      } else {
        (tx as Transaction).partialSign(kp);
      }
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> {
      for (const tx of txs) {
        if (tx instanceof VersionedTransaction) {
          tx.sign([kp]);
        } else {
          (tx as Transaction).partialSign(kp);
        }
      }
      return txs;
    },
    payer: kp,
  };
}

export function runRealDemo(
  config: RealConfig,
  onEvent: (event: LifecycleEvent) => void,
): RealHandle {
  let cancelled = false;
  const emit = (e: LifecycleEvent) => {
    if (cancelled) return;
    onEvent(e);
  };

  const run = async () => {
    const startedAt = nowFn();

    // ── Preflight gate ─────────────────────────────────────────────
    // All preflight failures short-circuit into a single visible
    // action.fail + summary so the user sees exactly which prerequisite
    // is missing instead of cryptic "fetch /idls failed" or RPC timeout.
    const abortWith = (
      action: string,
      error: string,
      note: string,
    ): void => {
      emit({ kind: "action.fail", action, error, at: nowFn() });
      emit({
        kind: "summary",
        totalEvents: 0,
        okCount: 0,
        skipCount: 0,
        failCount: 1,
        startedAt,
        finishedAt: nowFn(),
        elapsedMs: nowFn() - startedAt,
        notes: [note],
      });
    };

    emit({
      kind: "phase.start",
      phase: "setup",
      label: "Preflight",
      at: startedAt,
    });

    // 1. Wallet connected — UX gate, not a signing requirement yet.
    if (!config.walletConnected) {
      abortWith(
        "preflight.wallet",
        "No wallet connected",
        "Connect a wallet (Phantom, Solflare, Backpack, …) before running real mode.",
      );
      return;
    }
    emit({
      kind: "action.ok",
      action: "preflight.wallet",
      detail: config.walletLabel
        ? `Wallet connected (${config.walletLabel})`
        : "Wallet connected",
      at: nowFn(),
    });

    // 2. Surface endpoint target before anything hits the network.
    emit({
      kind: "action.ok",
      action: "realDemo.connect",
      detail: `Connecting to ${config.endpoint}`,
      at: nowFn(),
    });

    const connection = new Connection(config.endpoint, "confirmed");

    // 3. RPC reachability — catch dead validator / wrong URL before
    //    the orchestrator's first tx, which would otherwise emit a
    //    generic "fetch failed" deep inside airdrop.
    try {
      const version = await connection.getVersion();
      emit({
        kind: "action.ok",
        action: "preflight.rpc",
        detail: `RPC reachable (solana-core ${version["solana-core"] ?? "?"})`,
        at: nowFn(),
      });
    } catch (err) {
      abortWith(
        "preflight.rpc",
        (err as Error).message ?? String(err),
        `RPC endpoint ${config.endpoint} is not reachable. ` +
          "Is the validator running? Is the URL correct?",
      );
      return;
    }

    // Throwaway authority funded by airdrop. Scoped to this run.
    const authority = Keypair.generate();
    emit({
      kind: "action.ok",
      action: "realDemo.authority",
      detail: `Ephemeral authority ${authority.publicKey.toBase58().slice(0, 8)}…`,
      at: nowFn(),
    });

    // 4. IDLs — loadIdls throws when /idls/*.json are missing (i.e.
    //    prepare-idls hasn't been run after anchor build).
    let idls;
    try {
      idls = await loadIdls();
      emit({
        kind: "action.ok",
        action: "preflight.idls",
        detail: "IDLs loaded (core + reputation + yield-mock)",
        at: nowFn(),
      });
    } catch (err) {
      abortWith(
        "loadIdls",
        (err as Error).message,
        "Real mode aborted — IDLs are missing. See app/public/idls/README.md.",
      );
      return;
    }

    emit({
      kind: "phase.end",
      phase: "setup",
      label: "Preflight",
      at: nowFn(),
      elapsedMs: nowFn() - startedAt,
    });

    const wallet = makeWalletForKeypair(authority);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });

    let client;
    try {
      client = createClient({ provider, idls });
    } catch (err) {
      emit({
        kind: "action.fail",
        action: "createClient",
        error: (err as Error).message,
        at: nowFn(),
      });
      return;
    }

    try {
      await lifecycleDemo({
        client,
        authority,
        airdropLamports: config.airdropLamports ?? 2_000_000_000, // 2 SOL
        pool: {
          memberNames: config.memberNames,
          installmentAmount: config.installmentAmount,
          creditAmount: config.creditAmount,
          cyclesTotal: config.cyclesTotal,
          cycleDurationSec: config.cycleDurationSec ?? 60,
        },
        defaultScenario: config.defaultScenario,
        sink: emit,
      });
    } catch (err) {
      // lifecycleDemo rethrows any unhandled on-chain error. Turn it
      // into a visible action.fail + summary so the UI leaves the user
      // with a clear error message.
      const msg = (err as Error).message ?? String(err);
      emit({
        kind: "action.fail",
        action: "lifecycleDemo",
        error: msg,
        at: nowFn(),
      });
      emit({
        kind: "summary",
        totalEvents: 0,
        okCount: 0,
        skipCount: 0,
        failCount: 1,
        startedAt: nowFn(),
        finishedAt: nowFn(),
        elapsedMs: 0,
        notes: [
          `Real demo failed: ${msg}`,
          "Check the validator is running, programs are deployed, and IDL program IDs match.",
        ],
      });
    }
  };

  void run();

  return {
    cancel: () => {
      cancelled = true;
    },
  };
}
