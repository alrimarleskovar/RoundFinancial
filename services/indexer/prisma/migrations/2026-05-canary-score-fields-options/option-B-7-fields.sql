-- Opção B — 7 campos (6 brutos + default_reason) ★ RECOMENDADA
--
-- Adiciona contestabilidade do score: usuário pode disputar default
-- ("por que meu score caiu? — solvency_guard? missed_deadline? eu paguei
-- a tempo, vou contestar"). Pré-requisito implícito de mainnet com
-- lending integration (FCRA §609 right-to-dispute).
--
-- ContributeEvent: mesmos 6 campos da Opção A.
-- DefaultEvent: 6 campos + default_reason (enum).

BEGIN;

-- ContributeEvent: 6 campos novos (mesma estrutura da Opção A)
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

UPDATE contribute_events
  SET paid_at = block_time,
      cycle_seq = cycle
  WHERE paid_at IS NULL;

-- DefaultEvent: 6 campos + default_reason (enum)
DO $$ BEGIN
  CREATE TYPE default_reason_enum AS ENUM (
    'SolvencyGuardTriggered',     -- Triple Shield disparou
    'MissedDeadline',             -- paid_at > due_at + GRACE_PERIOD_SECS
    'InsufficientStake',          -- D/C invariant violation
    'EscapeValveLeavingDefault',  -- saiu via escape valve estando em default
    'Other'                       -- fallback (auditoria evita)
  );
EXCEPTION WHEN duplicate_object THEN
  NULL;  -- migration idempotente
END $$;

ALTER TABLE default_events
  ADD COLUMN paid_at              BIGINT,
  ADD COLUMN due_at               BIGINT,
  ADD COLUMN delta_seconds        INTEGER,
  ADD COLUMN grace_used           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN payment_slot_position INTEGER,
  ADD COLUMN cycle_seq            INTEGER,
  ADD COLUMN default_reason       default_reason_enum;  -- nullable; backfill mais tarde

CREATE INDEX idx_default_events_due_at          ON default_events(due_at);
CREATE INDEX idx_default_events_delta_seconds   ON default_events(delta_seconds) WHERE delta_seconds IS NOT NULL;
CREATE INDEX idx_default_events_reason          ON default_events(default_reason) WHERE default_reason IS NOT NULL;

UPDATE default_events
  SET cycle_seq = cycle
  WHERE cycle_seq IS NULL;

-- Constraint: novos rows DEVEM ter default_reason setado pelo indexer.
-- Rows pré-existentes pre-Canary podem ficar NULL (backfill posterior se necessário).
ALTER TABLE default_events
  ADD CONSTRAINT check_new_defaults_have_reason
    CHECK (default_reason IS NOT NULL OR block_time < EXTRACT(EPOCH FROM '2026-06-01'::timestamp)::bigint)
    NOT VALID;  -- NOT VALID = não valida rows existentes, só novos

COMMIT;

-- Pós-migration: dev verificar
--   SELECT COUNT(*) FROM contribute_events WHERE paid_at IS NULL;  -- esperado: 0
--   SELECT COUNT(*) FROM default_events WHERE cycle_seq IS NULL;   -- esperado: 0
--   SELECT default_reason, COUNT(*) FROM default_events GROUP BY default_reason;
