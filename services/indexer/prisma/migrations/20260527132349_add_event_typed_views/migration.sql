-- ADR 0009 close-out criterion #7: typed-shaped views over the canonical
-- normalized `events` table. These reproduce the contribute/claim/default
-- typed columns ON TOP OF `events`, extracting the type-specific fields
-- from the `details` JSONB. This also proves `details` carries every
-- type-specific field (criterion #3) and is the forward-compat path toward
-- a future true collapse (the views can replace the base typed tables).
--
-- NOTE (FALLBACK shape): under ADR 0009 the base typed tables remain the
-- ingestion surface and `events` is the projected layer, so these views
-- expose only RESOLVED, non-orphaned rows (everything `events` holds).
-- The base `contribute_events` / `claim_events` / `default_events` tables
-- remain the place to inspect unresolved/orphaned rows.

CREATE VIEW "contribute_events_v" AS
SELECT
  e."txSig"                                   AS "txSignature",
  e."poolId",
  e."poolPda",
  e."memberId",
  e."subjectWallet",
  e."cycle",
  e."slotIndex",
  e."slotNumber"                              AS "slot",
  e."onChainTs"                               AS "blockTime",
  e."dueTs",
  e."deltaSeconds",
  e."graceUsed",
  (e."details" ->> 'schemaId')::int           AS "schemaId",
  (e."details" ->> 'onTime')::boolean         AS "onTime",
  (e."details" ->> 'solidarityAmt')::numeric  AS "solidarityAmt",
  (e."details" ->> 'escrowAmt')::numeric      AS "escrowAmt",
  (e."details" ->> 'poolFloatAmt')::numeric   AS "poolFloatAmt",
  e."resolvedAt"
FROM "events" e
WHERE e."eventType" = 'Contribute';

CREATE VIEW "claim_events_v" AS
SELECT
  e."txSig"                              AS "txSignature",
  e."poolId",
  e."poolPda",
  e."memberId",
  e."subjectWallet",
  e."cycle",
  e."slotIndex",
  e."slotNumber"                         AS "slot",
  e."onChainTs"                          AS "blockTime",
  e."dueTs",
  (e."details" ->> 'amountPaid')::numeric AS "amountPaid",
  e."resolvedAt"
FROM "events" e
WHERE e."eventType" = 'Claim';

CREATE VIEW "default_events_v" AS
SELECT
  e."txSig"                                   AS "txSignature",
  e."poolId",
  e."poolPda",
  e."subjectWallet"                           AS "defaultedWallet",
  e."cycle",
  e."slotIndex",
  e."slotNumber"                              AS "slot",
  e."onChainTs"                               AS "blockTime",
  e."dueTs",
  e."defaultReason",
  e."defaultReasonProvenance",
  (e."details" ->> 'seizedSolidarity')::numeric AS "seizedSolidarity",
  (e."details" ->> 'seizedEscrow')::numeric     AS "seizedEscrow",
  (e."details" ->> 'seizedStake')::numeric      AS "seizedStake",
  (e."details" ->> 'dInit')::numeric            AS "dInit",
  (e."details" ->> 'dRem')::numeric             AS "dRem",
  (e."details" ->> 'cInit')::numeric            AS "cInit",
  (e."details" ->> 'cAfter')::numeric           AS "cAfter",
  e."resolvedAt"
FROM "events" e
WHERE e."eventType" = 'Default';
