# schema.prisma — diff visual das 3 opções

Estes são os blocos do `schema.prisma` que MUDAM em cada opção. Pós-reunião, time copia o bloco da opção vencedora e cola no `services/indexer/prisma/schema.prisma`.

---

## Opção A — 6 campos brutos

### `ContributeEvent`

```prisma
model ContributeEvent {
  // ... fields existentes (id, txSignature, poolId, memberId, etc) ...
  blockTime           BigInt
  slot                BigInt

  // NOVOS — Opção A
  paidAt              BigInt?   // semantic alias de blockTime
  dueAt               BigInt?   // computed: pool.startedAt + (cycle * pool.cycleDurationSec)
  deltaSeconds        Int?      // paidAt - dueAt (pode ser negativo)
  graceUsed           Boolean   @default(false)
  paymentSlotPosition Int?      // ordem cronológica no ciclo (1..membersTarget)
  cycleSeq            Int?      // alias de `cycle` — redundante, debate em comments

  orphaned            Boolean   @default(false)
  resolvedAt          DateTime?

  @@index([paidAt])
  @@index([dueAt])
  @@index([poolId, cycle])
  @@index([orphaned, slot])
  @@map("contribute_events")
}
```

### `DefaultEvent`

```prisma
model DefaultEvent {
  // ... fields existentes ...
  blockTime     BigInt
  slot          BigInt

  // NOVOS — Opção A
  paidAt              BigInt?   // null se membro não pagou
  dueAt               BigInt?
  deltaSeconds        Int?
  graceUsed           Boolean   @default(false)
  paymentSlotPosition Int?
  cycleSeq            Int?

  orphaned      Boolean   @default(false)
  resolvedAt    DateTime?

  @@index([dueAt])
  @@index([poolId, slotIndex])
  @@index([orphaned, slot])
  @@map("default_events")
}
```

---

## Opção B — 7 campos (recomendada)

Tudo da Opção A **+ `default_reason` em DefaultEvent**.

### `ContributeEvent`

Igual à Opção A — sem mudanças adicionais.

### `DefaultEvent`

```prisma
enum DefaultReason {
  SolvencyGuardTriggered
  MissedDeadline
  InsufficientStake
  EscapeValveLeavingDefault
  Other
}

model DefaultEvent {
  // ... fields existentes ...
  blockTime     BigInt
  slot          BigInt

  // NOVOS — Opção B
  paidAt              BigInt?
  dueAt               BigInt?
  deltaSeconds        Int?
  graceUsed           Boolean   @default(false)
  paymentSlotPosition Int?
  cycleSeq            Int?
  defaultReason       DefaultReason?  // ⭐ FCRA contestability

  orphaned      Boolean   @default(false)
  resolvedAt    DateTime?

  @@index([dueAt])
  @@index([defaultReason])
  @@index([poolId, slotIndex])
  @@index([orphaned, slot])
  @@map("default_events")
}
```

---

## Opção C — 8 campos

Tudo da Opção B **+ `pool_state_hash` em ContributeEvent, ClaimEvent, DefaultEvent**.

### `ContributeEvent`

```prisma
model ContributeEvent {
  // ... fields existentes + Opção A fields ...

  // NOVO — Opção C
  poolStateHash       String?   @db.VarChar(64)  // SHA-256 hex

  // ...
  @@index([poolStateHash])
  @@map("contribute_events")
}
```

### `ClaimEvent`

```prisma
model ClaimEvent {
  // ... fields existentes ...

  // NOVO — Opção C
  poolStateHash       String?   @db.VarChar(64)

  @@index([poolStateHash])
  @@map("claim_events")
}
```

### `DefaultEvent`

```prisma
model DefaultEvent {
  // ... fields existentes + Opção B fields (paidAt, dueAt, ..., defaultReason) ...

  // NOVO — Opção C
  poolStateHash       String?   @db.VarChar(64)

  // ...
  @@index([poolStateHash])
  @@map("default_events")
}
```

---

## Custos comparativos

| Métrica                           | Opção A                 | Opção B   | Opção C                  |
| --------------------------------- | ----------------------- | --------- | ------------------------ |
| Storage / event                   | +24 bytes               | +25 bytes | +89 bytes                |
| Indexes adicionais                | 3                       | 4         | 7                        |
| Indexer CPU / event               | +0.1ms (computa due_at) | +0.1ms    | +0.6ms (+SHA-256)        |
| Pre-Canary backfill               | trivial                 | trivial   | trivial (NULL)           |
| Migration risk                    | Baixo                   | Baixo     | Médio (NOT VALID checks) |
| FCRA compliance                   | ❌                      | ✅        | ✅                       |
| Cryptographic audit trail         | ❌                      | ❌        | ✅                       |
| **Custo total (1 ano, 10 pools)** | ~5MB                    | ~5MB      | ~20MB                    |

---

## Decisão na reunião — pergunta única

> **"Time, vamos com A (6 campos sem default_reason), B (7 com default_reason — meu rec), ou C (8 com pool_state_hash + integridade futura)?"**

3 trade-offs:

1. **Backfill incremental:** A → B é incremental (só adicionar enum + col). B → C também é incremental (adicionar 1 col em 3 tabelas). Time pode escolher A agora e bumpar pra B pre-Fase 1 se opinion letter FCRA exigir. **Mas:** dados Canary vão sem default_reason, então precisa backfill manual via SEV triage records — pode falhar.
2. **Lending integration roadmap:** se time tem lending partner planejado pra Q3 2026, pular pra C agora evita migration em produção. Se sem partner concreto, B suficiente.
3. **Storage cost:** todas opções são <100MB pra 1 ano de Canary + Fase 1 dados. Não material.
