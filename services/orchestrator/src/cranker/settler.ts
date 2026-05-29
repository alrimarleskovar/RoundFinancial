/**
 * Settler — turns a SettleCandidate into a signed + sent settle_default tx.
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ ALRIMAR: implementação real aqui.                                ║
 * ║                                                                  ║
 * ║ Copia o tx-building manual de scripts/devnet/seed-default.ts —   ║
 * ║ ele já tem TUDO que precisamos:                                  ║
 * ║   - anchorIxDiscriminator("settle_default")                      ║
 * ║   - encodeU8 helper                                              ║
 * ║   - poolPda / memberPda / attestationPda derivations             ║
 * ║   - account meta list (linhas ~200-260 do seed-default.ts)       ║
 * ║   - ComputeBudgetProgram.setComputeUnitLimit(400_000) prefix     ║
 * ║                                                                  ║
 * ║ Diferenças vs script one-shot:                                   ║
 * ║   - sem env vars (recebe candidate + caller + connection)        ║
 * ║   - sem console.log decorativo (usa o log: callback)             ║
 * ║   - retry com backoff exponencial: 3 tentativas (1s, 2s, 4s).    ║
 * ║     RPC pode falhar transiente — não derruba o loop.             ║
 * ║   - retorna {ok, sig?, error?} em vez de jogar throw             ║
 * ║                                                                  ║
 * ║ Refactor opcional (não-bloqueador): extrair a encoding compartil-║
 * ║ hada pra services/orchestrator/src/cranker/encoding.ts e fazer   ║
 * ║ seed-default.ts importar dali. Pode ficar pra outro PR.          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import type { Connection, Keypair, PublicKey } from "@solana/web3.js";

import type { SettleCandidate } from "./detector.js";
import type { CrankerState } from "./state.js";

export interface SettlerDeps {
  connection: Connection;
  caller: Keypair;
  usdcMint: PublicKey;
  coreProgram: PublicKey;
  reputationProgram: PublicKey;
}

export type Logger = (msg: string) => void;

export async function attemptSettle(
  deps: SettlerDeps,
  candidate: SettleCandidate,
  state: CrankerState,
  log: Logger,
): Promise<void> {
  state.settlementsAttempted++;

  // TODO(alrimar): replace this stub with the real settle_default tx.
  // Until it lands, the cranker is a "dry-run" — it detects + logs
  // candidates without firing. Safe to deploy at this stage; no
  // on-chain side effects.
  log(
    `[DRY-RUN] would settle pool=${candidate.pool.toBase58().slice(0, 8)}… ` +
      `member=${candidate.memberWallet.toBase58().slice(0, 8)}… ` +
      `slot=${candidate.slotIndex} cycle=${candidate.cycle}`,
  );

  // When implementation lands, increment ONE of these per attempt:
  //   state.settlementsSucceeded++;     on confirmed signature
  //   state.settlementsFailed++;        on terminal failure (post-retry)
  //   state.lastError = `…`;            human-readable summary

  // Silence unused-deps lint until the real tx-building lands.
  void deps;
}
