/**
 * Attestation backfill (reputation v5.2 Hybrid, Phase C.2b).
 *
 * Scans every `Attestation` account under the reputation program via
 * `getProgramAccounts` (discriminator memcmp — same brittle-proof filter
 * as the Pool/Member backfill), decodes the on-chain bytes with the
 * IDL-free `@roundfi/sdk` `decodeAttestationRaw`, derives the
 * authoritative `EventClassification`, and upserts the structured row.
 *
 * The decode + derive logic is the C.2a primitive layer; this module is
 * the persistence wiring. The pure mapping (`attestationToRowFields`) is
 * factored out so it can be unit-tested WITHOUT a database
 * (`attestation_row.spec.ts`) — the DB round-trip itself is exercised by
 * the operator-run integration suite (same posture as the existing
 * `insights.spec.ts` / `admin_shared_store_pg.spec.ts`, which need a live
 * Postgres and are not part of the standard CI lane).
 *
 * Resolve-when-possible: the optional Member FK is set when the issuer
 * (a pool PDA) and subject (a wallet) resolve to a known Member row;
 * otherwise NULL (orphan attestation — e.g. the pool/member backfill
 * hasn't run, or the member was closed). Mirrors the event-ingest FK
 * convention (ADR 0009).
 */

import type { Connection, PublicKey } from "@solana/web3.js";
import type { PrismaClient } from "@prisma/client";

import { type RawAttestation, decodeAttestationRaw } from "@roundfi/sdk";

import { deriveEventClassification } from "./behavioralClassification.js";
import { accountDiscriminatorBase58 } from "./discriminator.js";

const ATTESTATION_DISCRIMINATOR = accountDiscriminatorBase58("Attestation");

/**
 * The structured, DB-shaped view of a decoded attestation — exactly the
 * columns added by the `attestation_behavioral_payload` migration. Pure
 * function output, no FK / audit fields (those are resolved by the
 * caller against the DB). `deltaSeconds` / `amount` / `issuedAt` are
 * `bigint` to match the `BigInt` columns and the on-chain i64/u64.
 */
export interface AttestationRowFields {
  issuer: string;
  subject: string;
  schemaId: number;
  nonce: bigint;
  payload: string; // 192-char lowercase hex of the 96 raw bytes
  payloadVersion: number | null; // NULL = legacy zero payload (pre-v5.2)
  classification: string; // EventClassification (authoritative)
  cycle: number;
  slotIndex: number;
  groupSize: number | null;
  parcelsPaid: number | null;
  deltaSeconds: bigint | null;
  amount: bigint | null;
  issuedAt: bigint;
  revoked: boolean;
}

/**
 * Pure mapper: decoded `RawAttestation` → the structured DB columns.
 * No DB, no RPC. When the payload is a legacy zero / unknown version
 * (`raw.payload === null`), every structured field is NULL and the
 * classification is `"unspecified"` — the only correct answer for bytes
 * that carry no v1 structure.
 */
export function attestationToRowFields(raw: RawAttestation): AttestationRowFields {
  const p = raw.payload;
  return {
    issuer: raw.issuer.toBase58(),
    subject: raw.subject.toBase58(),
    schemaId: raw.schemaId,
    nonce: raw.nonce,
    payload: raw.payloadRaw.toString("hex"),
    payloadVersion: p?.version ?? null,
    classification: deriveEventClassification(p),
    cycle: raw.cycle,
    slotIndex: raw.slotIndex,
    groupSize: p?.groupSize ?? null,
    parcelsPaid: p?.parcelsPaid ?? null,
    deltaSeconds: p ? p.deltaSeconds : null,
    amount: p?.amount ?? null,
    issuedAt: raw.issuedAt,
    revoked: raw.revoked,
  };
}

/** Minimal logger shape (matches `createLogger` output) so this module
 *  doesn't depend on the concrete logger implementation. */
interface MinimalLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

const NOOP_LOGGER: MinimalLogger = { info: () => {}, warn: () => {} };

/**
 * Scan + upsert every attestation under `reputationProgram`. Returns the
 * number of attestation rows touched. The optional Member FK is resolved
 * by `(issuer → pool.pda, subject → member.wallet)`.
 *
 * Idempotent: keyed by `pda`; re-runs refresh the structured fields
 * (a revoke that lands between scans flips `revoked` true).
 */
export async function backfillAttestations(
  prisma: PrismaClient,
  connection: Connection,
  reputationProgram: PublicKey,
  logger: MinimalLogger = NOOP_LOGGER,
): Promise<number> {
  const accounts = await connection.getProgramAccounts(reputationProgram, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 0, bytes: ATTESTATION_DISCRIMINATOR } }],
  });
  logger.info(
    { event_type: "backfill_attestations_fetched", count: accounts.length },
    "attestation accounts fetched",
  );

  let touched = 0;
  for (const { pubkey, account } of accounts) {
    const raw: RawAttestation = decodeAttestationRaw(pubkey, account.data as Buffer);
    const fields = attestationToRowFields(raw);

    // Resolve the optional Member FK: pool by issuer PDA, then member by
    // (poolId, wallet=subject). All-or-nothing — a half-resolved FK is
    // worse than NULL.
    const pool = await prisma.pool.findUnique({
      where: { pda: fields.issuer },
      select: { id: true },
    });
    const member = pool
      ? await prisma.member.findFirst({
          where: { poolId: pool.id, wallet: fields.subject },
          select: { id: true },
        })
      : null;

    await prisma.attestation.upsert({
      where: { pda: pubkey.toBase58() },
      create: {
        pda: pubkey.toBase58(),
        issuer: fields.issuer,
        subject: fields.subject,
        schemaId: fields.schemaId,
        nonce: fields.nonce,
        memberId: member?.id ?? null,
        payload: fields.payload,
        payloadVersion: fields.payloadVersion,
        classification: fields.classification,
        cycle: fields.cycle,
        slotIndex: fields.slotIndex,
        groupSize: fields.groupSize,
        parcelsPaid: fields.parcelsPaid,
        deltaSeconds: fields.deltaSeconds,
        amount: fields.amount,
        issuedAt: fields.issuedAt,
        revoked: fields.revoked,
        txSignature: null, // unknown at account-scan time
      },
      update: {
        // Refresh the structured view + FK + revoke flag; the immutable
        // identity columns (issuer/subject/schemaId/nonce) never change.
        memberId: member?.id ?? null,
        payload: fields.payload,
        payloadVersion: fields.payloadVersion,
        classification: fields.classification,
        groupSize: fields.groupSize,
        parcelsPaid: fields.parcelsPaid,
        deltaSeconds: fields.deltaSeconds,
        amount: fields.amount,
        issuedAt: fields.issuedAt,
        revoked: fields.revoked,
      },
    });
    touched += 1;
  }

  logger.info(
    { event_type: "backfill_attestations_complete", attestationsTouched: touched },
    "attestation backfill done",
  );
  return touched;
}
