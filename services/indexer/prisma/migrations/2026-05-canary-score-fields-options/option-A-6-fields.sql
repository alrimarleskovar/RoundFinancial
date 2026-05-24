-- Opção A — 6 campos brutos (sem default_reason, sem pool_state_hash)
--
-- Adiciona campos pro produto = score em ContributeEvent + DefaultEvent.
-- ClaimEvent NÃO recebe paid_at/due_at — claim é payout, não pagamento.
--
-- Não-recomendada para mainnet (faltam contestabilidade FCRA).
-- Pode ser estendida pra Opção B post-Canary se time decidir.

BEGIN;

-- ContributeEvent: 6 campos novos
ALTER TABLE contribute_events
  ADD COLUMN paid_at              BIGINT,
  ADD COLUMN due_at               BIGINT,
  ADD COLUMN delta_seconds        INTEGER,
  ADD COLUMN grace_used           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN payment_slot_position INTEGER,
  ADD COLUMN cycle_seq            INTEGER;

CREATE INDEX idx_contribute_events_paid_at      ON contribute_events(paid_at);
CREATE INDEX idx_contribute_events_due_at       ON contribute_events(due_at);
CREATE INDEX idx_contribute_events_grace_used   ON contribute_events(grace_used) WHERE grace_used = TRUE;

-- Backfill pra rows pre-existentes (idempotent — pre-#321 rows skip; new rows fill)
-- paid_at = block_time (já existe, semantic alias)
-- cycle_seq = cycle (já existe, semantic alias)
UPDATE contribute_events
  SET paid_at = block_time,
      cycle_seq = cycle
  WHERE paid_at IS NULL;

-- DefaultEvent: mesmos 6 campos (paid_at vazio em default — não pagou)
ALTER TABLE default_events
  ADD COLUMN paid_at              BIGINT,    -- NULL se membro não pagou (default por silence)
  ADD COLUMN due_at               BIGINT,
  ADD COLUMN delta_seconds        INTEGER,
  ADD COLUMN grace_used           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN payment_slot_position INTEGER,  -- normalmente = membersTarget (last slot)
  ADD COLUMN cycle_seq            INTEGER;

CREATE INDEX idx_default_events_due_at          ON default_events(due_at);
CREATE INDEX idx_default_events_delta_seconds   ON default_events(delta_seconds) WHERE delta_seconds IS NOT NULL;

-- Backfill: cycle_seq = cycle (já existe)
UPDATE default_events
  SET cycle_seq = cycle
  WHERE cycle_seq IS NULL;

COMMIT;

-- Pós-migration: dev verificar
--   SELECT COUNT(*) FROM contribute_events WHERE paid_at IS NULL;  -- esperado: 0
--   SELECT COUNT(*) FROM default_events WHERE cycle_seq IS NULL;   -- esperado: 0
