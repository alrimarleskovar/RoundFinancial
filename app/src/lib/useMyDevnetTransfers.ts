"use client";

/**
 * `useMyDevnetTransfers()` — durable history of plain SOL / USDC transfers
 * (in AND out) for the connected wallet, read straight from chain.
 *
 * `useMyDevnetTxHistory` deliberately scans only Member PDAs, so it captures
 * `join_pool` + `contribute` but NOT a bare wallet-to-wallet SOL/USDC transfer
 * — the kind a user makes through the /carteira Send modal (and the matching
 * receipt on the counterparty's wallet). Those never touch a Member account,
 * so they were invisible in Transações even though the signature confirmed.
 *
 * This hook fills that gap: it scans the wallet's OWN recent signatures,
 * decodes each tx, and surfaces the net SOL / USDC delta as a row. It survives
 * a full page reload (unlike the optimistic session ledger) and — crucially —
 * shows INCOMING transfers the local session never witnessed.
 *
 * Dedup: `join`/`contribute` signatures also touch the wallet (signer + fee
 * payer), so the consumer (TransactionsList) filters these rows against the
 * Member-PDA history's signatures — that scan owns the labelled
 * "Entrada / Parcela" rows; this hook only adds what it doesn't already cover.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import {
  LAMPORTS_PER_SOL,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from "@solana/web3.js";

import type { Transaction } from "@/data/carteira";
import { DEVNET_USDC_MINT } from "@/lib/devnet";
import { shortAddr } from "@/lib/wallet";

const USDC_MINT = DEVNET_USDC_MINT.toBase58();

// Ignore native-SOL deltas at/below this magnitude — they're fee-only dust
// from txs that did something else (a program call, a failed sim) rather than
// a transfer the user actually made. A real devnet transfer is orders of
// magnitude larger than the ~5_000-lamport fee.
const SOL_DUST = 0.0005;

function relative(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}m atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

// Net USDC change across every token account owned by `owner` in this tx
// (post − pre). Owner-scoped so a transfer that touches the counterparty's
// ATA doesn't bleed into our delta.
function usdcDelta(
  pre: TokenBalance[] | null | undefined,
  post: TokenBalance[] | null | undefined,
  owner: string,
): number {
  const sum = (arr: TokenBalance[] | null | undefined) =>
    (arr ?? [])
      .filter((b) => b.mint === USDC_MINT && b.owner === owner)
      .reduce((acc, b) => acc + (b.uiTokenAmount.uiAmount ?? 0), 0);
  return sum(post) - sum(pre);
}

// Best-effort counterparty for a native SOL System transfer: the destination
// when we sent, the source when we received. Returns null for anything that
// isn't a plain parsed system transfer.
function solCounterparty(tx: ParsedTransactionWithMeta, incoming: boolean): string | null {
  const ix = tx.transaction.message.instructions.find(
    (i) => "parsed" in i && i.program === "system" && i.parsed?.type === "transfer",
  ) as ParsedInstruction | undefined;
  const info = ix?.parsed?.info as { source?: string; destination?: string } | undefined;
  if (!info) return null;
  return (incoming ? info.source : info.destination) ?? null;
}

// Fetch parsed txs in small chunks, and if a CHUNK's batch call fails, fall
// back to one `getParsedTransaction` per signature. A single 25-signature
// `getParsedTransactions` call is heavy and some RPC tiers rate-limit or reject
// it outright — which previously blanked the whole transfer history silently
// (only the sender's optimistic session row survived, so an INCOMING transfer
// on a second wallet showed nothing). Per-signature recovery + per-chunk
// isolation means one heavy/unsupported call can't wipe the list.
async function fetchParsedChunked(
  connection: ReturnType<typeof useConnection>["connection"],
  sigs: string[],
  chunkSize: number,
): Promise<Array<ParsedTransactionWithMeta | null>> {
  const out: Array<ParsedTransactionWithMeta | null> = [];
  for (let i = 0; i < sigs.length; i += chunkSize) {
    const chunk = sigs.slice(i, i + chunkSize);
    try {
      const res = await connection.getParsedTransactions(chunk, {
        maxSupportedTransactionVersion: 0,
      });
      out.push(...res);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[RoundFi] getParsedTransactions batch failed; retrying per-signature", err);
      const singles = await Promise.all(
        chunk.map((s) =>
          connection
            .getParsedTransaction(s, { maxSupportedTransactionVersion: 0 })
            .catch(() => null),
        ),
      );
      out.push(...singles);
    }
  }
  return out;
}

export interface UseTransfersResult {
  status: "loading" | "ok" | "fallback";
  txs: Transaction[];
  refresh: () => Promise<void>;
}

export function useMyDevnetTransfers(refreshMs = 20_000): UseTransfersResult {
  const { connection } = useConnection();
  const { publicKey } = useAdapterWallet();
  const [state, setState] = useState<{ status: UseTransfersResult["status"]; txs: Transaction[] }>({
    status: "loading",
    txs: [],
  });
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    if (!publicKey) {
      setState({ status: "ok", txs: [] });
      return;
    }
    try {
      const me = publicKey.toBase58();
      const sigInfos = await connection.getSignaturesForAddress(publicKey, { limit: 25 });
      if (sigInfos.length === 0) {
        if (!cancelled.current) setState({ status: "ok", txs: [] });
        return;
      }
      const parsed = await fetchParsedChunked(
        connection,
        sigInfos.map((s) => s.signature),
        8,
      );
      if (cancelled.current) return;

      const txs: Transaction[] = [];
      parsed.forEach((tx, i) => {
        const info = sigInfos[i];
        // Skip missing / failed txs — a reverted send never moved funds.
        if (!tx || !tx.meta || tx.meta.err) return;
        const accountKeys = tx.transaction.message.accountKeys;
        const myIdx = accountKeys.findIndex((k) => k.pubkey.toBase58() === me);
        if (myIdx < 0) return;
        const when = info.blockTime ? info.blockTime * 1000 : 0;
        const date = when ? relative(when) : "—";

        // USDC moves take priority over the native-SOL delta: an SPL transfer
        // still nudges SOL (fee), and the token amount is the meaningful one.
        const usdc = usdcDelta(tx.meta.preTokenBalances, tx.meta.postTokenBalances, me);
        if (Math.abs(usdc) > 1e-6) {
          txs.push({
            label: usdc > 0 ? "USDC recebido" : "Envio de USDC",
            addr: info.signature,
            amount: usdc,
            denom: "USDC",
            ts: when,
            date,
          });
          return;
        }

        const sol = (tx.meta.postBalances[myIdx] - tx.meta.preBalances[myIdx]) / LAMPORTS_PER_SOL;
        if (Math.abs(sol) < SOL_DUST) return;
        const other = solCounterparty(tx, sol > 0);
        const who = other ? ` · ${shortAddr(other, 4, 4)}` : "";
        txs.push({
          label: (sol > 0 ? "SOL recebido" : "Envio de SOL") + who,
          addr: info.signature,
          amount: sol,
          denom: "SOL",
          ts: when,
          date,
        });
      });

      // Diagnostic: we found signatures but extracted no transfer rows. This
      // is the fingerprint of the "incoming transfer doesn't show" report —
      // either the RPC indexed the signature but the parse missed the delta, or
      // the wallet legitimately has only program txs. Logged (not thrown) so a
      // tester can confirm the cause from the browser console.
      if (sigInfos.length > 0 && txs.length === 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[RoundFi] transfers: scanned ${sigInfos.length} signature(s), 0 SOL/USDC transfer rows`,
        );
      }
      if (!cancelled.current) setState({ status: "ok", txs });
    } catch (err) {
      // RPC hiccup / rate-limit — keep whatever we had, mark fallback. No
      // throw: this ledger is a read-only convenience layered on the others.
      // Logged so a silent RPC failure (the suspected cause of missing incoming
      // transfers) is visible in the console instead of vanishing.
      if (cancelled.current) return;
      // eslint-disable-next-line no-console
      console.warn("[RoundFi] transfer history scan failed", err);
      setState((prev) => ({ status: "fallback", txs: prev.txs }));
    }
  }, [connection, publicKey]);

  useEffect(() => {
    cancelled.current = false;
    void load();
    const id = window.setInterval(load, refreshMs);
    return () => {
      cancelled.current = true;
      window.clearInterval(id);
    };
  }, [load, refreshMs]);

  return { ...state, refresh: load };
}
