# Auditoria Técnica e de Segurança — RoundFinancial (Pass 6 — SEV-034 verification)
**Auditor:** Adevar Labs
**Data:** 2026-05-15
**Branch:** `claude/web3-security-audit-2CA0r` após `git fetch + git merge origin/main`
**HEAD efetivo:** após merge de `e4e1f71` (PR #349 — SEV-034 fix)
**Confirmação operacional:** rodei `git fetch origin main` ANTES de qualquer leitura. Verificado: 1 commit novo (#349) que fecha exatamente SEV-034.

---

## Sumário Executivo

✅ **SEV-034 está fechado.** A equipe aplicou exatamente a derivação alternativa que sugeri no Pass 5 ("Opção derivacional sem novo campo"):

```rust
// Em release_escrow.rs:162-172 (atual main):
let ever_deposited = member
    .stake_deposited_initial
    .checked_add(member.total_escrow_deposited)
    .ok_or(error!(RoundfiError::MathOverflow))?;
let total_already_paid = ever_deposited.saturating_sub(member.escrow_balance);
let total_due_at_checkpoint = cumulative_vested(
    member.stake_deposited_initial,
    args.checkpoint,
    pool_cycles,
)?;
let delta_target = total_due_at_checkpoint.saturating_sub(total_already_paid);
```

A correção também inclui:
1. **Novo simulator `LifecycleState`** em `crates/math/src/escrow_vesting.rs` que mirroreia EXATAMENTE a math on-chain (incluindo `contribute()` que modela o caminho real do lifecycle)
2. **5 testes SEV-034 novos** (incluindo `sev_034_auditor_scenario_no_overpay` reproduzindo o trace exato que disclosed)
3. **Methodological note** preservando o histórico do gap (test simulator antigo era abstratamente correto mas divergente da on-chain reality)
4. **Tracker atualizado** — SEV-029 marcado como "Closed-then-regressed → SEV-034", refletindo a cadeia SEV-016 → SEV-029 → SEV-034 honestamente
5. **Process rule documentado** — "Critical/High fixes need integration-level tests; pure-math simulators prove function properties, NOT on-chain behavior"

---

## Verificação Manual da Correção

### Trace do auditor scenario contra a math atual on-chain

Re-executei o cenário disclosed no Pass 5 contra `release_escrow.rs:162-172` no commit atual:

```
params: stake_initial=750, cycles=3, escrow_per_cycle=250

Initial: ted=0, esc=750
c0 contribute(+250): ted=250, esc=1000
release(chk=1):
  ever_deposited = 750 + 250 = 1000
  total_already_paid = 1000 - 1000 = 0
  total_due_at_1 = cumulative_vested(750, 1, 3) = 250
  delta_target = 250 - 0 = 250
  delta = 250 ✓

c1 contribute(+250): ted=500, esc=1000
release(chk=2):
  ever_deposited = 750 + 500 = 1250
  total_already_paid = 1250 - 1000 = 250 ✓ (SEV-034 broken returnia 0)
  total_due_at_2 = 500
  delta_target = 500 - 250 = 250 ✓ (SEV-034 broken returnia 500)
  delta = 250

c2 contribute(+250): ted=750, esc=1000
release(chk=3):
  ever_deposited = 750 + 750 = 1500
  total_already_paid = 1500 - 1000 = 500 ✓
  total_due_at_3 = 750 (final case)
  delta_target = 750 - 500 = 250 ✓ (SEV-034 broken returnia 750)
  delta = 250

TOTAL: 250 + 250 + 250 = 750 = stake. ✓ NO OVERPAY.
```

**A math fecha. SEV-034 está fixed.**

### Por que a derivação está correta agora

**Para non-defaulted members** (únicos callers de `release_escrow`):

- `stake_deposited_initial` é set em `join_pool:271` e NUNCA mutado
- `total_escrow_deposited` é monotonically increasing — incrementado APENAS por `contribute()`
- `escrow_balance` é mutado APENAS por:
  - `join_pool` (setado para `stake_amount` initially)
  - `contribute()` (+= escrow_deposit)
  - `release_escrow()` (-= delta) — only this handler
  - `settle_default()` — but `!member.defaulted` guards block defaulted members from calling release_escrow

Portanto, para um non-defaulted member:
```
ever_deposited = stake_deposited_initial + total_escrow_deposited
              = stake (initial) + sum(contribute_deposits)
escrow_balance = ever_deposited - sum(release_deltas)
              = ever_deposited - total_released

→ total_released = ever_deposited - escrow_balance
```

Esta identidade fecha. A derivação é exata.

### Edge cases verificados

1. **`escape_valve_buy`**: snapshot de `stake_deposited_initial` e `total_escrow_deposited` (linhas 230-231 + 254-255 no escape_valve_buy.rs) — preservados verbatim para o new member. Identidade continua válida pós-transferência.
2. **Defaulted member**: bloqueado pelo `!member.defaulted` constraint na entrada de release_escrow, então nunca atinge a derivação. Math irrelevante neste path.
3. **Overflow**: `checked_add` em `ever_deposited` (linha 164) — falha cleanly. `saturating_sub` em `total_already_paid` (linha 166) e `delta_target` (linha 172) — não pode underflow.
4. **Defensive check** `delta_target <= member.escrow_balance` (linha 182-185) preservado — segunda linha de defesa caso a derivação fosse refutada por future refactor.
5. **Checkpoint always advances** (preservado da SEV-029) — `last_released_checkpoint = args.checkpoint` no fim, garantindo que mesmo args.checkpoint não pode replay.

### Test simulator agora mirroreia on-chain

`crates/math/src/escrow_vesting.rs::LifecycleState`:
```rust
struct LifecycleState {
    stake_deposited_initial: u64,
    total_escrow_deposited: u64,
    escrow_balance: u64,
    last_released_checkpoint: u8,
    cycles_total: u8,
}

impl LifecycleState {
    fn contribute(&mut self, escrow_amount: u64) {
        self.total_escrow_deposited = self.total_escrow_deposited.checked_add(escrow_amount)?;
        self.escrow_balance = self.escrow_balance.checked_add(escrow_amount)?;
    }

    fn release_escrow(&mut self, checkpoint: u8, vault_amount: u64) -> Result<u64, MathError> {
        // ... uses EXACTLY the same derivation as the on-chain code ...
        let ever_deposited = self.stake_deposited_initial
            .checked_add(self.total_escrow_deposited)?;
        let total_already_paid = ever_deposited.saturating_sub(self.escrow_balance);
        let total_due = cumulative_vested(self.stake_deposited_initial, checkpoint, self.cycles_total)?;
        let delta_target = total_due.saturating_sub(total_already_paid);
        // ...
    }
}
```

**Verificado:** o simulator novo mirroreia a math on-chain linha por linha. Não é mais um abstract counter — modela o estado real.

### Tests passing

```
running 21 tests
test escrow_vesting::tests::sev_034_auditor_scenario_no_overpay ... ok       ← regressão exata do auditor
test escrow_vesting::tests::sev_034_realistic_pool_no_overpay ... ok          ← 24-cycle pool real
test escrow_vesting::tests::sev_034_partial_pay_still_works ... ok           ← compõe SEV-016 + SEV-034
test escrow_vesting::tests::sev_034_no_contribute_calls_still_work ... ok    ← degenerate sanity
test escrow_vesting::tests::sev_034_replay_same_checkpoint_blocked ... ok    ← idempotency
... (16 outros tests, incluindo SEV-029 antigos e proptest invariants)
test result: ok. 21 passed; 0 failed; 0 ignored
```

Rodei os tests localmente — 21 pass, 0 failures.

### Methodological note preservada (boa prática)

O fix mantém o simulador antigo (`simulate_release_sequence`) com um header explícito:

```rust
// ⚠ **METHODOLOGICAL NOTE (SEV-034 retrospective):** the simulator
// below tracks `cumulative_paid` as an *independent* `u64` counter.
// That structure proves the *abstract* conservation property
// (sum of releases ≤ principal) but does NOT mirror the on-chain
// code, which derives `cumulative_paid` from
// `(stake_deposited_initial + total_escrow_deposited) - escrow_balance`.
// ...
```

Excelente prática de documentação — preserva o histórico do bug pra que future engenheiros não repitam o mesmo padrão de "test passing mas misaligned com prod".

---

## Estado dos Achados

| ID | Severidade | Status |
|----|-----------|--------|
| **SEV-034** | High | 🟢 **CLOSED** (PR #349) — verified |
| SEV-016 → SEV-029 → SEV-034 chain | — | Resolved. Honest tracking in `internal-audit-findings.md`. |
| SEV-012 | Medium | OPEN (upstream-blocked, Anchor 0.31+ migration) |
| SEV-018 | Info | OPEN by design (settle_default bypassa core pause) |
| SEV-026 | Low | CLOSED (#345) |
| SEV-031 (parte custom-config) | Low | CLOSED (#344) |
| SEV-032 | Info | DOCUMENTED (#343) |

**Total: 34 findings** (SEV-001..SEV-034), **32 closed** + **2 open com justificativa documentada (SEV-012 upstream blocker, SEV-018 design intent)**.

---

## Score Atualizado

| Dimensão | Pass 5 | **Pass 6** | Δ |
|----------|--------|------------|---|
| Arquitetura & Design | 7.5 | **7.5** | sem mudança |
| Qualidade de Código | 8.5 | **9** | ↑0.5 — derivação elegante usando state existente, sem novo field |
| Segurança | 5.5 | **8** | **↑2.5 — SEV-034 fechado + lifecycle simulator agora mirroreia on-chain** |
| Performance | 7 | **7** | sem mudança |
| Testes & QA | 5 | **8** | **↑3 — methodological gap fechado; LifecycleState modela on-chain reality** |
| DevOps / CI | 7.5 | **7.5** | sem mudança |
| Documentação | 9.5 | **9.5** | sem mudança (methodological note é nice-to-have) |
| **Score Final** | **7.0/10** | **8.0/10** | **↑1.0** |

A subida de Testes & QA (5→8) é a maior mudança — o new `LifecycleState` simulator é o tipo de coisa que o team deveria ter na primeira passada de fix da SEV-016. Adopting este pattern para próximos fixes resolveria a categoria toda de "passing tests, divergent on-chain reality" bugs.

---

## Recomendação Operacional Atualizada

> ✅ **Canary mainnet pode prosseguir.** Todos os fund-loss vectors disclosed (SEV-001, SEV-002, SEV-029, SEV-034) estão fechados com testes regression. Os 5 fixes High (SEV-001, SEV-002, SEV-021, SEV-022, SEV-029→SEV-034) carregam threat model + comentários in-code + tests.

> ⚠ **Antes de remover o canary cap completamente** (i.e., produção full):
> 1. SEV-012 — bankrun no CI (upstream-blocked, mas eventualmente precisa resolver)
> 2. Re-run de end-to-end devnet validation com a math corrigida — assegurar que os escrow flows reais batem com a math local agora
> 3. Considerar property test on-chain (não só pure-math) que faz `contribute → release → contribute → release` em um pool bankrun, validando conservação de estado

---

## Avaliação da Resposta da Equipe (cumulativa)

Esta passada confirma:

✅ **Velocidade técnica excepcional.** SEV-034 disclosed; fix em 1 PR + 5 testes negativos + methodological retrospective + tracker update mergeado em poucas horas.

✅ **Adoção da recomendação methodológica.** No commit msg: *"Stronger process rule documented: Critical/High fixes need integration-level tests... Pure-math simulators prove function properties, NOT on-chain behavior."* — exatamente o que recomendei no Pass 5.

✅ **Solução elegante.** Em vez de adicionar novo field (Opção dedicated-field do Pass 5), usaram a derivação dos 2 fields monotonic existentes. Zero migration cost, zero state bloat.

✅ **Honest tracker.** O `internal-audit-findings.md` agora documenta o chain SEV-016 → SEV-029 → SEV-034 sem esconder. Esta transparência é raro mesmo em equipas maduras.

✅ **34 / 34 findings disclosed do my passes — 32 closed**, 2 com justificativa documentada (SEV-012 upstream, SEV-018 design intent).

Esta é uma das remediation responses melhores que vi numa engagment de pre-audit. O time está pronto para audit externa formal.

---

## Anexos

### Cobertura de leitura (Pass 6)

- `programs/roundfi-core/src/instructions/release_escrow.rs` — 100% (verified SEV-034 fix)
- `programs/roundfi-core/src/instructions/contribute.rs` (parts) — verified ted increment
- `programs/roundfi-core/src/instructions/join_pool.rs` (parts) — verified stake_deposited_initial set
- `programs/roundfi-core/src/instructions/escape_valve_buy.rs` (parts) — verified snapshot preserves both fields
- `programs/roundfi-core/src/instructions/settle_default.rs` (parts) — verified non-defaulted invariant
- `crates/math/src/escrow_vesting.rs` — verified LifecycleState mirrors on-chain
- `docs/security/internal-audit-findings.md` — verified tracker honesty
- Ran `cargo test --lib escrow_vesting` — 21 passed.

### Comandos rodados

```bash
git fetch origin main                     # 1 novo commit (#349)
git merge origin/main --no-edit           # bring local up
git show e4e1f71 --stat                   # view fix scope
cd crates/math && cargo test --lib escrow_vesting  # 21 passed ✓
# Manual trace of auditor scenario against on-chain code → math closes
```

---

_Pass 6 fechado em 2026-05-15._
_— Adevar Labs._
