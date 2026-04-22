/**
 * Anchor event parsing from transaction logs.
 *
 * Anchor encodes `emit!(SomeEvent { … })` as a base64-encoded Borsh
 * blob prefixed with the 8-byte event discriminator, wrapped in a
 * `Program data: <b64>` log line. The on-chain program is responsible
 * for emitting; the TS SDK rebuilds structured events by walking the
 * `meta.logMessages` array of a confirmed tx.
 *
 * Coverage targets:
 *   - `ProfileSnapshot` (from reputation::get_profile)
 *   - attestation events from core→reputation CPI
 *
 * We use anchor's own EventParser so decoding is driven by the IDL
 * rather than hand-written Borsh schemas.
 */

import { EventParser, Program, Event, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

export interface ParsedEvent<T = Record<string, unknown>> {
  name: string;
  data: T;
}

/**
 * Parse every anchor event emitted by `program` in the tx identified
 * by `signature`. Returns an empty array if the tx emitted none.
 */
export async function eventsFromTx(
  connection: Connection,
  program: Program<Idl>,
  signature: string,
): Promise<ParsedEvent[]> {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta?.logMessages) return [];

  const parser = new EventParser(program.programId, program.coder);
  const out: ParsedEvent[] = [];
  for (const ev of parser.parseLogs(tx.meta.logMessages)) {
    const e = ev as Event;
    out.push({ name: e.name, data: e.data as Record<string, unknown> });
  }
  return out;
}

/**
 * Filter helper — return only events whose name matches `wanted`.
 * Useful for assertions like "exactly one Payment event was emitted".
 */
export function filterEvents<T = Record<string, unknown>>(
  events: ParsedEvent[],
  wanted: string,
): ParsedEvent<T>[] {
  return events.filter((e) => e.name === wanted) as ParsedEvent<T>[];
}

/**
 * Parse events emitted by multiple programs in the same tx. Anchor's
 * EventParser is program-scoped, so we run it once per program and
 * merge. Tag each event with the emitting program ID so callers can
 * tell `roundfi_core::Emitted` from `roundfi_reputation::Emitted`.
 */
export async function eventsFromTxMulti(
  connection: Connection,
  programs: Program<Idl>[],
  signature: string,
): Promise<(ParsedEvent & { programId: PublicKey })[]> {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta?.logMessages) return [];

  const out: (ParsedEvent & { programId: PublicKey })[] = [];
  for (const program of programs) {
    const parser = new EventParser(program.programId, program.coder);
    for (const ev of parser.parseLogs(tx.meta.logMessages)) {
      const e = ev as Event;
      out.push({
        name: e.name,
        data: e.data as Record<string, unknown>,
        programId: program.programId,
      });
    }
  }
  return out;
}
