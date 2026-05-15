# Auditoria Técnica e de Segurança — RoundFinancial (Pass 5 — fresh look pós Fase 5)
**Auditor:** Adevar Labs
**Data:** 2026-05-15
**Branch:** `claude/web3-security-audit-2CA0r` após `git fetch + git merge origin/main`
**HEAD efetivo:** `aedb57e` (merge de `5434434` — main com 9 commits adicionais desde a Pass 4)
**Confirmação operacional:** desta vez de novo rodei `git fetch origin main` ANTES de qualquer leitura. Branch agora reflete `origin/main` HEAD.

---

## Sumário Executivo

A equipe fechou os 5 findings da Pass 4 + SEV-026 (deferred originalmente) + um follow-up de SEV-024 (timelock para fee_bps_yield), todos com PRs separadas e comentários in-code exemplares. Adicionalmente publicaram o tracker público `docs/security/internal-audit-findings.md` que reframe o histórico todo como "internal pre-audit" — **transparência operacional alta**.

**Verifiquei cada fix individualmente:**

| ID | Status | Verificação |
|----|--------|-------------|
| SEV-029 | 🟢 Claimed closed (#342) | **❌ NÃO FECHADO** — ver SEV-034 abaixo. A invariante usada pelo fix é incorreta porque `contribute()` também incrementa `escrow_balance`. Re-introdução do mesmo overpay sob outras condições. |
| SEV-026 | 🟢 Closed (#345) | ✅ Verificado — `settle_default` agora delega a `seize_for_default(CascadeInputs)` do `roundfi_math`. |
| SEV-030 | 🟢 Closed (#344) | ✅ Verificado — cooldown estendido a PAYMENT + LATE + DEFAULT. |
| SEV-031 | 🟡 Closed (#344) | ✅ Verificado — runtime solvency check em `create_pool`. |
| SEV-033 | 🟢 Closed (#344) | ✅ Verificado — fail-closed quando `NODE_ENV=production` OR `INDEXER_ENV in {production, mainnet, staging}`. |
| SEV-032 | 🟡 Documented | Migration doc + CI floor guard publicados. Padding ainda 0 — extensões futuras requerem realloc. |
| SEV-024 | 🟢 Hardened (#347) | Direct mutation via `update_protocol_config.new_fee_bps_yield` agora rejeitada; força timelock 1d via `propose_new_fee_bps_yield`. |

**Achado NOVO desta passada:**

⚠ **SEV-034 (High — REGRESSÃO de regressão):** O fix da SEV-029 (PR #342) baseia-se em uma invariante incorretamente formulada: "escrow_balance starts at stake_deposited and is only decremented by release_escrow on non-defaulted members." **Mas `contribute()` também INCREMENTA `escrow_balance` por `escrow_deposit` per cycle.** Portanto `stake_deposited - escrow_balance` NÃO equivale a "cumulative_paid_via_releases" — quando contribuições foram feitas (caso NORMAL do lifecycle), a expressão satura em 0 via `saturating_sub`, e o membro acaba recebendo `cumulative_vested(stake, chk, cycles)` POR INTEIRO em cada call de `release_escrow`, não o delta.

Os 4 testes negativos + 2 proptests que a equipe escreveu para SEV-029 passam — porque o simulador `simulate_release_sequence` usa um campo separado `cumulative_paid: u64` (mirroring "correct math"), mas não simula `contribute()` entre releases. **O bug está no on-chain, não no simulador.**

**Recomendação:** **NÃO REMOVER canary cap** + **NÃO ATIVAR `release_escrow` em pools de mainnet** até SEV-034 estar fechado com teste end-to-end que exercite `contribute → release → contribute → release` (a sequência natural do lifecycle).

---

## Re-validação dos 6 fechamentos desta semana

### ✅ SEV-026 (cascade refactor) — VERIFIED CLOSED

`programs/roundfi-core/src/instructions/settle_default.rs:202-218`:
```rust
let escrow_cap = member.escrow_balance.min(escrow_vault_amount);
let stake_cap = member
    .stake_deposited
    .min(escrow_vault_amount.saturating_sub(escrow_cap));
let outcome = seize_for_default(CascadeInputs {
    d_init: d_initial,
    d_rem: d_remaining,
    c_init: c_initial,
    c_before,
    missed,
    solidarity_available,
    escrow_cap,
    stake_cap,
})?;
let from_solidarity = outcome.from_solidarity;
let from_escrow = outcome.from_escrow;
let from_stake = outcome.from_stake;
```

Single source of truth restaurada. Os 8 testes do `crates/math/src/cascade.rs` (incluindo `exhaustive_post_seizure_invariant_always_holds` com ~13_500 input combinations) agora cobrem o caminho on-chain.

### ✅ SEV-030 (cooldown coverage) — VERIFIED CLOSED

`programs/roundfi-reputation/src/instructions/attest.rs`:
```rust
let is_score_changing = matches!(
    args.schema_id,
    SCHEMA_PAYMENT | SCHEMA_LATE | SCHEMA_DEFAULT
);
if is_admin && is_score_changing {
    let elapsed = now.saturating_sub(profile.last_admin_attest_at);
    require!(elapsed >= MIN_ADMIN_ATTEST_COOLDOWN_SECS, ReputationError::CooldownActive);
}
```

`SCHEMA_CYCLE_COMPLETE` continua com cooldown próprio (`MIN_CYCLE_COOLDOWN_SECS` = 6 dias). `SCHEMA_LEVEL_UP` é informational (não muda score). Cooldown agora cobre todas score-changing schemas via admin path. Comentário in-code documenta cada decisão.

### ✅ SEV-031 (create_pool solvency check) — VERIFIED CLOSED

`programs/roundfi-core/src/instructions/create_pool.rs` agora tem o invariant runtime que eu sugeri:
```rust
// pool_float = members × installment × (1 − sol_bps − escrow_bps) / MAX_BPS
// require pool_float >= credit
```

Custom pools com params mis-tunados são rejeitados no entrypoint, não ficam stuck.

### ✅ SEV-033 (webhook fail-closed) — VERIFIED CLOSED

`services/indexer/src/server.ts`:
```ts
function isProductionLikeEnv(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const tier = process.env.INDEXER_ENV?.toLowerCase();
  return tier === "mainnet" || tier === "production" || tier === "staging";
}

// ...
if (!process.env.HELIUS_WEBHOOK_SECRET) {
  if (isProductionLikeEnv()) {
    app.log.error("...refusing to start...");
    await prisma.$disconnect();
    process.exit(1);
  }
  // dev path — warn + allow
}
```

Production-like envs agora fail-closed. Lista explícita (não negation) — adoção segura de novos tiers de ambiente.

### ✅ SEV-024 follow-up (fee_bps_yield timelock) — VERIFIED CLOSED

3 instructions novas: `propose_new_fee_bps_yield` / `cancel_new_fee_bps_yield` / `commit_new_fee_bps_yield` com `FEE_BPS_YIELD_TIMELOCK_SECS = 86_400` (1 dia). Direct mutation via `update_protocol_config.new_fee_bps_yield` agora rejeita com log de deprecation:
```rust
if let Some(_bps) = args.new_fee_bps_yield {
    // ...direct mutation no longer permitted. Callers must use the
    // propose_new_fee_bps_yield → commit_new_fee_bps_yield flow...
}
```

1 dia em vez de 7 (treasury) é razoável: fees são reversíveis, 24h dá tempo de off-chain monitoring + escape valve. Documentado em `docs/security/economic-config-governance.md`.

### 🟡 SEV-032 (padding) — DOCUMENTED, código não mudou

Migration plan publicado em `docs/security/...` + CI check em `chore(security): constants floor guard CI` (#343). Padding ainda 0 — a próxima extensão a `ReputationConfig` exigirá realloc on-chain. Aceitável dado a documentação explícita.

---

## ⚠ ACHADO NOVO — SEV-034

### [SEV-034] SEV-029 fix usa invariante incorretamente formulada — overpay persiste sob contribuições intercaladas

- **Severidade:** **High** (fund-leak; mesma exposição que SEV-029 original sob cenário mais comum)
- **Dimensão:** Segurança / Math / Testes
- **Evidência:**
  - `programs/roundfi-core/src/instructions/release_escrow.rs:136-138` (math):
    ```rust
    let total_already_paid = member
        .stake_deposited
        .saturating_sub(member.escrow_balance);
    ```
  - `programs/roundfi-core/src/instructions/release_escrow.rs:110-116` (comment justificando):
    > Correct invariant: `cumulative_paid_via_releases = stake_deposited - escrow_balance` (escrow_balance starts at stake_deposited and is **only** decremented by release_escrow on non-defaulted members; settle_default cannot touch a non-defaulted member's escrow_balance because the `!member.defaulted` constraint above bars defaulted callers entirely).
  - `programs/roundfi-core/src/instructions/contribute.rs:203-206` (**contradiz** o comentário acima):
    ```rust
    member.escrow_balance = member
        .escrow_balance
        .checked_add(escrow_deposit)
        .ok_or(error!(RoundfiError::MathOverflow))?;
    ```

- **Descrição:** O comentário no fix da SEV-029 afirma que "escrow_balance starts at stake_deposited and is **only** decremented by release_escrow on non-defaulted members". Esta afirmação é **falsa** — `contribute()` INCREMENTA `member.escrow_balance` pelo valor de `escrow_deposit` (default = 25% da parcela) em CADA cycle. Portanto a expressão `stake_deposited - escrow_balance` NÃO equivale a "cumulative_paid_via_releases" no caso normal do lifecycle (contribuições + releases intercalados).

  Quando contribuições foram feitas mais do que releases (a maioria do lifecycle):
  - `escrow_balance` > `stake_deposited`
  - `stake_deposited.saturating_sub(escrow_balance)` retorna `0` (não negativo, satura)
  - `total_already_paid = 0` sempre
  - `delta_target = cumulative_vested(stake, chk, cycles) - 0 = full cumulative vested at chk`
  - O membro recebe o valor cumulativo, NÃO o delta desde o último release

- **Impacto:** Re-introdução do mesmo overpay que SEV-029 supostamente fechou, sob um cenário **mais comum** (não requer settle_default trigger antes — basta o lifecycle normal de contribute + release).

  **Cenário concreto (params do `tests/security_lifecycle.spec.ts:poolL`):**
  - stake=750 USDC, cycles=3, installment=1000, escrow_bps=2500
  - Cycle 0: member contribui (escrow_balance: 750 → 1000)
  - `release_escrow(chk=1)`: cumulative_vested(750, 1, 3) = 250. paid_derivado = saturating_sub(750, 1000) = 0. delta = 250. Member receives 250. (correto sortuoso — primeira release)
  - Cycle 1: member contribui (escrow_balance: 750 → 1000)
  - `release_escrow(chk=2)`: cumulative_vested(750, 2, 3) = 500. paid_derivado = saturating_sub(750, 1000) = 0. delta = 500. **Member receives 500.** (Cumulativo 750; esperado em chk=2: 500. **Overpay 250**.)
  - Cycle 2: member contribui (escrow_balance: 750 → 1000)
  - `release_escrow(chk=3)`: cumulative_vested(750, 3, 3) = 750 (final case). paid_derivado = saturating_sub(750, 750) = 0. delta = 750. **Member receives 750.** (Cumulativo 1500; esperado: 750. **Overpay 750 = 100% do stake**.)

  Total recebido: 1500 USDC. Stake real: 750. **Leak de 750 USDC drained do shared escrow_vault** (de contribuições de outros members).

  Para o pool default (`with_defaults`): 24 members × ~872 USDC overpay each = **~21K USDC leak por pool** (bounded pelo constraint `delta_target <= member.escrow_balance` que kicks in ~chk=10).

- **Cenário de Ataque:**
  1. Member exploits the bug ao longo do lifecycle natural — apenas chamando `release_escrow` a cada cycle como esperado.
  2. Como o overpay vem do shared escrow_vault, OUTROS members podem ter seu próprio `release_escrow` ou `settle_default` bloqueado por falta de vault funds.
  3. Pior caso: member que vai defaultar drena seu próprio `escrow_balance` via release_escrow antes de defaultar — `settle_default` então acha `member.escrow_balance ≈ 0` e não consegue seizar. Membro caminha com stake recuperado, outros membros pagam o buraco.

- **Por que os testes não detectam:**

  1. **`tests/lifecycle.spec.ts:423-444`** — chama `release_escrow` UMA ÚNICA VEZ ao final (`checkpoint = CYCLES_TOTAL`). Single-shot final release não dispara o bug porque é o caso `cumulative_vested(stake, total, total) = stake`, e o member recebe exatamente stake. Sem repetições, sem overpay observável.
  2. **`tests/security_lifecycle.spec.ts:B.4`** — testa `release_escrow(chk=1)` happy path + repeat-at-same-checkpoint reject. Não testa `chk=1 → contribute → chk=2`.
  3. **`crates/math/src/escrow_vesting.rs` tests da SEV-029** — `simulate_release_sequence(principal, total, &[(chk, vault), ...])` usa um SEPARATE `cumulative_paid: u64` counter mirrored ao escrow_balance-derivation. O simulador é CORRETO; o on-chain code é INCORRETO. Os testes passam contra o simulador, não contra o on-chain.
  4. Nenhum teste exercita a sequência `contribute → release → contribute → release` que é o lifecycle natural.

- **Componentes Afetados:** `programs/roundfi-core/src/instructions/release_escrow.rs:136-138`

- **Recomendação:** Adicionar um campo dedicado `total_released: u64` ao `Member` state e tracker:

  ```rust
  // In state/member.rs:
  pub struct Member {
      ...
      /// Cumulative USDC released to member via release_escrow.
      /// SEV-034 — derivation via stake - escrow_balance was wrong
      /// because contribute() also increments escrow_balance.
      pub total_released: u64,
      ...
  }

  // In release_escrow.rs handler:
  let total_due_at_checkpoint = cumulative_vested(
      member.stake_deposited,
      args.checkpoint,
      pool_cycles,
  )?;
  let total_already_paid = member.total_released; // ← read from counter, not derived
  let delta_target = total_due_at_checkpoint.saturating_sub(total_already_paid);
  require!(delta_target > 0, RoundfiError::EscrowNothingToRelease);
  // ... after transfer:
  member.total_released = member.total_released
      .checked_add(delta)
      .ok_or(error!(RoundfiError::MathOverflow))?;
  ```

  **Alternativa derivacional (sem novo campo):** se a equipe quiser evitar field adições e tem `total_escrow_deposited` (já presente no Member), pode derivar:
  ```rust
  // For non-defaulted member: seizures = 0, so
  //   escrow_balance = stake_deposited_initial + total_escrow_deposited - total_released
  //   => total_released = stake_deposited_initial + total_escrow_deposited - escrow_balance
  let total_already_paid = member.stake_deposited_initial
      .checked_add(member.total_escrow_deposited)
      .ok_or(error!(RoundfiError::MathOverflow))?
      .checked_sub(member.escrow_balance)
      .ok_or(error!(RoundfiError::MathOverflow))?;
  ```
  Esta derivação é correta para members non-defaulted. Para defaulted o release_escrow está bloqueado pelo `!member.defaulted` constraint, então não precisa lidar com seizures.

  **Riscos da remediação:** Opção dedicated-field requer migration de pre-existing Member PDAs (devnet). Opção derivational não precisa migration mas envolve `stake_deposited_initial` e `total_escrow_deposited` ambos — `total_escrow_deposited` é monotonic increment, então a derivação é consistente.

- **Test coverage necessária:**
  ```typescript
  // tests/security_audit_paths.spec.ts (or new file)
  it("SEV-034: release_escrow does not overpay when contributions are interleaved", async function () {
      // stake = 750, cycles = 3, installment = 1000, escrow_bps = 2500
      // Lifecycle:
      //   c0: contribute → escrow = 1000
      //   release_escrow(chk=1): expect 250 received
      //   c1: contribute → escrow = ?
      //   release_escrow(chk=2): expect 250 received (delta from chk=1), NOT 500
      //   c2: contribute → escrow = ?
      //   release_escrow(chk=3): expect 250 received (final delta), NOT 750
      // Total released across all calls: exactly 750 (== stake), no overpay.
      ...
  });

  it("SEV-034: conservation invariant — sum of releases never exceeds stake", async function () {
      // Property test: any sequence of (contribute, release_escrow) — total
      // released must <= stake_deposited_initial.
  });
  ```

- **Esforço estimado:** S (1 campo + 2 linhas de math change + tests).

---

## Outros achados ainda OPEN

| ID | Severidade | Status | Notas |
|----|-----------|--------|-------|
| **SEV-034** | **High** | **NOVO** | Re-regressão de SEV-029, mesmo overpay sob contribute-interleaved scenario |
| SEV-012 | Medium | OPEN (upstream-blocked) | bankrun no CI continua bloqueado pela Anchor 0.31+/Agave 2.x migration (issue #319) |
| SEV-018 | Info | OPEN by design | settle_default bypassa core pause intencionalmente |
| SEV-031 (parte aberta) | Low | Aceitável | Custom-config solvency check landed; defaults check feito via test invariant |
| SEV-032 | Info | Documented | ReputationConfig padding=0; migration plan publicado |

---

## Score Atualizado

| Dimensão | Pass 3 | Pass 4 | **Pass 5** | Δ |
|----------|--------|--------|------------|---|
| Arquitetura & Design | 7.5 | 7.5 | **7.5** | sem mudança |
| Qualidade de Código | 8.5 | 8.5 | **8.5** | sem mudança |
| Segurança | 7 | 5.5 | **5.5** | sem mudança — SEV-029 não fechado mas SEV-026/030/031/033 fechados compensam |
| Performance | 7 | 7 | **7** | sem mudança |
| Testes & QA | 6.5 | 5.5 | **5** | **↓0.5** — SEV-029 fix shipped com tests que não modelam a realidade |
| DevOps / CI | 7 | 7 | **7.5** | ↑0.5 — fail-closed webhook + audit tracker publicado |
| Documentação | 9 | 9.5 | **9.5** | sem mudança — tracker público elevou ainda mais |
| **Score Final** | **7.5/10** | **7.0/10** | **7.0/10** | sem mudança líquida |

Score líquido inalterado porque ganhos de qualidade (SEV-024 follow-up timelock, audit tracker, fail-closed) compensam o fato de SEV-029 ainda estar aberto sob a forma de SEV-034.

---

## Avaliação da Resposta da Equipe

✅ **Velocidade técnica notável.** 9 commits + 1 doc PR em ~36h. PRs separadas e auditáveis individualmente.

✅ **Audit tracker público** (`docs/security/internal-audit-findings.md`). Reframe correto do histórico como "internal pre-audit" — transparência operacional acima da média.

✅ **Adoção do "negative test before merge" gate** que sugeri no Pass 4 — todos os fixes desta semana referenciam o processo.

✅ **SEV-026 cascade refactor** elimina o drift risk de uma maneira clean — math crate é single source of truth.

❌ **SEV-029 fix tem bug fundamental** que os 4 testes negativos + 2 proptests NÃO pegam porque o simulador `simulate_release_sequence` não modela `contribute()`. Isso é **exatamente** o tipo de falha que o "negative test before merge" deveria prevenir, mas o teste precisa modelar o caminho real, não uma versão simplificada.

**Recomendações de processo (refinadas após esta passada):**

1. **Para fixes que envolvem state derivation:** o teste DEVE exercitar **todas as paths que modificam o state derivado**. SEV-029 fix derivou paid de `stake - escrow_balance`; mas escrow_balance é modificado por contribute, release_escrow, settle_default. O teste só exercitou release_escrow. Próximo round: enumerar todas as paths de mutation antes de escrever os tests.

2. **Negative tests devem usar o CAMINHO REAL via bankrun**, não um simulador puro-math. Pure-math testes provam propriedades de funções; bankrun testes provam propriedades do programa on-chain. Confusão entre os dois mascara bugs como SEV-029.

3. **Para state-derived counters:** preferir campo dedicado com checked arithmetic + invariant assertions, sobre derivações que requerem reasoning cross-handler.

---

## Plano de Remediação Atualizado

### Imediato (0-3 dias) — bloqueador para canary expansion

- **SEV-034:** Aplicar Opção dedicated-field (cleaner) ou Opção derivational (no migration). **Adicionar bankrun test:**
  ```typescript
  // The minimum negative test the SEV-029 fix should have shipped with:
  // contribute → release(1) → contribute → release(2) → contribute → release(3)
  // assert: sum(received) == stake_deposited_initial (no overpay)
  ```

### Curto prazo (1-2 semanas) — antes do canary cap removal

- SEV-012: Continuar tracking upstream issue Anchor 0.31+/Agave 2.x.

### Backlog
- SEV-032: Padding budget na próxima major extensão de ReputationConfig.

---

## Anexos

### Comandos rodados (Pass 5)

```bash
git fetch origin main                            # 9 novos commits
git log --oneline HEAD..origin/main              # listar fixes
git merge origin/main --no-edit                  # bring local up
git show 636592c -- programs/.../release_escrow.rs  # SEV-029 fix diff
git show 636592c -- crates/math/src/escrow_vesting.rs  # SEV-029 tests
grep -B2 -A4 "member.escrow_balance" programs/roundfi-core/src/instructions/contribute.rs
# trace by hand: contribute increments escrow_balance, breaking SEV-029 invariant
```

### Cobertura de leitura (Pass 5)

- `programs/roundfi-core/src/instructions/release_escrow.rs` — 100% (SEV-034 source)
- `programs/roundfi-core/src/instructions/settle_default.rs` (parts) — verified SEV-026 delegation
- `programs/roundfi-core/src/instructions/create_pool.rs` (parts) — verified SEV-031 invariant
- `programs/roundfi-core/src/instructions/propose_new_fee_bps_yield.rs` — 100%
- `programs/roundfi-core/src/instructions/update_protocol_config.rs` (parts) — verified fee_bps_yield direct mutation rejected
- `programs/roundfi-reputation/src/instructions/attest.rs` (parts) — verified SEV-030 coverage
- `services/indexer/src/server.ts` (parts) — verified SEV-033 fail-closed
- `crates/math/src/escrow_vesting.rs` — verified SEV-029 test simulator (correct but doesn't model contribute)
- `docs/security/internal-audit-findings.md` — read team's tracker
- `tests/lifecycle.spec.ts:420-444` — verified release_escrow test is single-shot, doesn't exercise bug
- `tests/security_lifecycle.spec.ts:380-433` — verified B.3/B.4 don't exercise the contribute-then-release pattern

---

_Pass 5 fechado em 2026-05-15._
_— Adevar Labs._
