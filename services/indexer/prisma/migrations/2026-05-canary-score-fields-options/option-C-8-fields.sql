-- Opção C — 8 campos (Opção B + pool_state_hash)
--
-- Adiciona integridade futura: hash da Pool account state no momento
-- do evento (SHA-256 hex 64 chars). Permite re-verificação cryptographic
-- contra on-chain mesmo se indexer for re-built ou comprometido.
--
-- Custo: ~10% storage por evento. Negligível pra Canary, importante
-- a longo prazo se time prevê audit-grade verifiability pre-mainnet.
--
-- Use se: produto vai ter lending integration com auditoria externa
--          OU se há risco de indexer state ser disputado em tribunal.
-- Skip se: pre-mainnet, validation feita via on-chain RPC backstop.

BEGIN;

-- ContributeEvent: 6 brutos + pool_state_hash
ALTER TABLE contribute_events
  ADD COLUMN paid_at              BIGINT,
  ADD COLUMN due_at               BIGINT,
  ADD COLUMN delta_seconds        INTEGER,
  ADD COLUMN grace_used           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN payment_slot_position INTEGER,
  ADD COLUMN cycle_seq            INTEGER,
  ADD COLUMN pool_state_hash      VARCHAR(64);  -- SHA-256 hex (64 chars)

CREATE INDEX idx_contribute_events_paid_at         ON contribute_events(paid_at);
CREATE INDEX idx_contribute_events_due_at          ON contribute_events(due_at);
CREATE INDEX idx_contribute_events_grace_used      ON contribute_events(grace_used) WHERE grace_used = TRUE;
CREATE INDEX idx_contribute_events_pool_state_hash ON contribute_events(pool_state_hash) WHERE pool_state_hash IS NOT NULL;

UPDATE contribute_events
  SET paid_at = block_time,
      cycle_seq = cycle
  WHERE paid_at IS NULL;

-- DefaultEvent: 6 brutos + default_reason + pool_state_hash
DO $$ BEGIN
  CREATE TYPE default_reason_enum AS ENUM (
    'SolvencyGuardTriggered',
    'MissedDeadline',
    'InsufficientStake',
    'EscapeValveLeavingDefault',
    'Other'
  );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

ALTER TABLE default_events
  ADD COLUMN paid_at              BIGINT,
  ADD COLUMN due_at               BIGINT,
  ADD COLUMN delta_seconds        INTEGER,
  ADD COLUMN grace_used           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN payment_slot_position INTEGER,
  ADD COLUMN cycle_seq            INTEGER,
  ADD COLUMN default_reason       default_reason_enum,
  ADD COLUMN pool_state_hash      VARCHAR(64);

CREATE INDEX idx_default_events_due_at             ON default_events(due_at);
CREATE INDEX idx_default_events_delta_seconds      ON default_events(delta_seconds) WHERE delta_seconds IS NOT NULL;
CREATE INDEX idx_default_events_reason             ON default_events(default_reason) WHERE default_reason IS NOT NULL;
CREATE INDEX idx_default_events_pool_state_hash    ON default_events(pool_state_hash) WHERE pool_state_hash IS NOT NULL;

UPDATE default_events
  SET cycle_seq = cycle
  WHERE cycle_seq IS NULL;

-- ClaimEvent também recebe pool_state_hash (integridade do payout)
ALTER TABLE claim_events
  ADD COLUMN pool_state_hash      VARCHAR(64);

CREATE INDEX idx_claim_events_pool_state_hash      ON claim_events(pool_state_hash) WHERE pool_state_hash IS NOT NULL;

-- Constraint: novos rows DEVEM ter pool_state_hash setado.
ALTER TABLE contribute_events
  ADD CONSTRAINT check_new_contributes_have_hash
    CHECK (pool_state_hash IS NOT NULL OR block_time < EXTRACT(EPOCH FROM '2026-06-01'::timestamp)::bigint)
    NOT VALID;

ALTER TABLE default_events
  ADD CONSTRAINT check_new_defaults_have_reason_and_hash
    CHECK ((default_reason IS NOT NULL AND pool_state_hash IS NOT NULL) OR block_time < EXTRACT(EPOCH FROM '2026-06-01'::timestamp)::bigint)
    NOT VALID;

COMMIT;

-- Pós-migration: dev verificar
--   SELECT COUNT(*) FROM contribute_events WHERE pool_state_hash IS NULL AND block_time >= 1748764800;
--   SELECT COUNT(*) FROM default_events WHERE (default_reason IS NULL OR pool_state_hash IS NULL) AND block_time >= 1748764800;
--   -- ambos esperados: 0 (novas rows preenchem; pre-Canary rows isentos pela WHERE clause)

-- Considerações de cost:
--   - Storage: VARCHAR(64) × ~300 events/ciclo × 100 ciclos × 10 pools = ~20MB extra. OK.
--   - CPU: indexer computa SHA-256 do Pool account serialized (~200 bytes) por evento. ~0.5ms. OK.
--   - On-chain dependency: indexer precisa de RPC read da Pool account no momento do evento (já tem via reconciler).
