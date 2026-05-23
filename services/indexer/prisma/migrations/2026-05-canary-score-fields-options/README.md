# D1 (Schema indexer) — 3 alternativas prontas pra reunião

**Pauta:** Decisão 1 da reunião Canary (2026-05-23 briefing) — schema do indexer pra Canary começar com campos pro produto = score capturados desde Dia 1.

**Decisão na reunião:** time escolhe uma das 3 opções abaixo. Pós-reunião:

1. Renomeia o `.sql` da opção escolhida pra `migration.sql`
2. Deleta a pasta `2026-05-canary-score-fields-options/`
3. Move o `migration.sql` pra nova pasta `<timestamp>_canary_score_fields/`
4. Atualiza `services/indexer/prisma/schema.prisma` aplicando os mesmos campos (template pronto em `schema.diff.md`)
5. Rebuilda indexer e roda smoke

**Por que isso existe pré-reunião:** evitar 4h de eng escrevendo migration na hora errada (Dia 3-5). Eu pré-escrevi as 3 opções pra time só revisar e commitar a vencedora.

---

## TL;DR das 3 opções

| Campo                   | Opção A · 6 brutos | Opção B · 7 (recomendada) | Opção C · 8 |
| ----------------------- | ------------------ | ------------------------- | ----------- |
| `paid_at`               | ✅                 | ✅                        | ✅          |
| `due_at`                | ✅                 | ✅                        | ✅          |
| `delta_seconds`         | ✅                 | ✅                        | ✅          |
| `grace_used`            | ✅                 | ✅                        | ✅          |
| `payment_slot_position` | ✅                 | ✅                        | ✅          |
| `cycle_seq`             | ✅                 | ✅                        | ✅          |
| `default_reason`        | ❌                 | ✅                        | ✅          |
| `pool_state_hash`       | ❌                 | ❌                        | ✅          |

**Recomendação Claude:** Opção B. Contestabilidade do score (FCRA right-to-dispute) exige `default_reason`. Opção C adiciona integridade futura mas custa ~10-15% storage por evento — overkill pre-Fase 1.

**Recomendação fora-de-banda:** se time mainnet plan exige verificable cryptographic audit trail, vir Opção C. Caso contrário, B.

---

## Diff visual — qual campo serve pra quê

### `paid_at` (BigInt — segundos UTC)

Timestamp de quando o pagamento foi finalizado on-chain.
**Já temos:** `ContributeEvent.blockTime`. **Adicionar como alias semântico** explícito — `paid_at = blockTime` mas faz semântica do produto = score mais clara que "blockTime" (que é tx field, não product field).

### `due_at` (BigInt — segundos UTC)

Deadline calculado do ciclo: `pool.startedAt + (cycle * pool.cycleDurationSec)`.
**É derivado, não emitido on-chain.** Indexer computa no insert. Necessário pra calcular `delta_seconds` sem JOIN runtime.

### `delta_seconds` (Int — pode ser negativo)

`paid_at - due_at`. Negativo se pagou antes do deadline, positivo se atrasou.
**Calculado no insert.** Indexador grava direto pra evitar window functions on-read.

### `grace_used` (Boolean)

`true` se `paid_at > due_at` AND `paid_at < (due_at + GRACE_PERIOD_SECS)`. Mostra que o membro usou o buffer de tolerância mas não defaultou.
Pra score: indica padrão "paga só quando avisado" vs "paga no prazo". Sinal forte de hábito.

### `payment_slot_position` (Int — 1..membersTarget)

Ordem de pagamento neste ciclo. 1 = primeiro a pagar, 10 = último. Computed no insert via `COUNT(*) WHERE poolId=X AND cycle=Y AND blockTime<=current.blockTime`.
Pra score: peer pressure / behavioral pattern (sempre primeiro, sempre último).

### `cycle_seq` (Int)

Sequência global do ciclo no pool — alias semântico de `cycle` já existente. Redundante na schema atual; **incluído pra explicitar que score derived metrics referenciam isso** (`ContributeEvent.cycle` ainda fica como col, `cycle_seq` é o nome do produto).

**Decisão para implementação:** se redundância incomoda, pular este campo. Resto do schema usa `cycle` consistentemente.

### `default_reason` (enum — DefaultEvent ONLY)

Razão do default seizure:

- `SolvencyGuardTriggered` — Triple Shield disparou
- `MissedDeadline` — paid_at > due_at + GRACE_PERIOD
- `InsufficientStake` — D/C invariant violation
- `EscapeValveLeavingDefault` — saiu via escape valve mas estava em default
- `Other` — fallback (auditoria deve evitar)

**Por que crítico (Opção B+):** FCRA §609 (right-to-dispute) — usuário precisa saber por que score caiu. "default" sem razão = não-contestável = legal exposure se produto vai mainnet com lending integration.

### `pool_state_hash` (String — SHA-256 hex 64 chars)

Hash da state do pool no momento do evento (Pool account serialized + canonical sort).
Pra integridade futura: permite re-verificar consistency de série temporal contra on-chain mesmo se indexer for re-built. Útil pra disputa post-hoc.

**Custo:** ~10% storage por evento (64 chars/event × ~300 events/ciclo × 100 ciclos × 10 pools = ~20MB extra. Negligível pra Canary, importante a longo prazo.)

---

## Order of operations pós-reunião

1. **Yvina ou Caio:** decide-vencedora na pauta. Anuncia no canal interno: "Opção X eleita."
2. **Alrimar:** renomeia o `option-X.sql` pra `migration.sql`, move pra pasta nova, atualiza `schema.prisma`.
3. **Alrimar:** roda `pnpm prisma migrate dev` em devnet — confirma migration aplica.
4. **Indexer:** redeploya com nova schema. Backfill é opcional (pre-Canary = sem dados ainda).
5. **Smoke test Dia 13-14:** verifica que eventos novos vêm com campos preenchidos.

**Smoke critério (pass):**

```sql
-- Após 1 ciclo de smoke, esperado: 10 rows
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE paid_at IS NOT NULL) AS with_paid_at,
  COUNT(*) FILTER (WHERE due_at IS NOT NULL) AS with_due_at,
  COUNT(*) FILTER (WHERE delta_seconds IS NOT NULL) AS with_delta,
  COUNT(*) FILTER (WHERE grace_used) AS grace_used_count,
  COUNT(*) FILTER (WHERE default_reason IS NOT NULL) AS with_default_reason  -- só opções B/C
FROM contribute_events
WHERE pool_id = '<smoke_pool_id>';

-- Pass: total = with_paid_at = with_due_at = with_delta = 10
```

---

## Arquivos nesta pasta

```
2026-05-canary-score-fields-options/
├── README.md                    (este arquivo)
├── schema.diff.md               (3 versões do schema.prisma lado a lado)
├── option-A-6-fields.sql        (migration crua, 6 campos)
├── option-B-7-fields.sql        (migration crua, 7 campos — recomendada)
└── option-C-8-fields.sql        (migration crua, 8 campos)
```

---

## Cross-refs

- Briefing pré-reunião: `docs/pt/pre-canary-briefing.md` Decisão 1
- Slides: `docs/pitch/pre-canary-decisoes-slides.html` slide 02
- Verificação de infra original (achado): `docs/pt/pre-canary-verificacao-infra.md`
- Proposta v0.5.3 §10: contexto do "produto = score"
- Schema atual: `services/indexer/prisma/schema.prisma`
