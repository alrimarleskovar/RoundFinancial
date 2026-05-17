# Auditoria Técnica e de Segurança — RoundFinancial (Pass 9)
**Auditor:** Adevar Labs
**Data:** 2026-05-16
**Branch:** `claude/web3-security-audit-2CA0r` synced com origin/main
**HEAD efetivo:** após merge de `9e65d3f` (last main commit, docs wave 5)
**Confirmação operacional:** `git fetch origin main` primeiro, conforme procedural fix da Pass 3.

---

## Sumário Executivo

A equipe entregou um **batch de progresso substancial** desde Pass 8:

| Categoria | Delta |
|-----------|-------|
| **NOVO finding (SEV-034b)** | Critical feature-break em `release_escrow`, fechado pela equipe sem precisar de audit pass externo |
| **Bankrun infra real** | mpl_core.so loader + bankrun_compat shim + ADR 0007 — fecha o gap "pure-math sims ≠ on-chain behavior" |
| **IDL gen restaurado** | Manual IdlBuild para `Payload` newtype + idl-build propagation — caminho para SEV-012 unblock |
| **Test fixture batch** | ~12 specs migradas/atualizadas pra cumprir SEV-031/SEV-038/MIN_CYCLE_DURATION |
| **Floor guards module** | Novo `mod floor_guards` em constants.rs assertando CRITICAL constants stay above mainnet-floor |
| **Clippy cleanup** | Workspace-wide sweep, 10 sites, no behavior change |
| **Docs waves 1-5** | README, MAINNET_READINESS, AUDIT_SCOPE, audit-readiness, security/, architecture/ todos atualizados |

**Resultado deste Pass 9:** SEV-034b fix verified mathematically correct, sem novos findings, **0 zonas críticas remanescentes**. Total cumulativo: **40 findings, 36 closed**, 1 upstream-blocked (SEV-012), 3 design-intentional.

**Mais importante:** SEV-034b foi o **primeiro finding encontrado pela INFRAESTRUTURA DE TESTE PRÓPRIA do time** (bankrun integration spec rodando end-to-end), não por audit externo. Isso valida empiricamente a recomendação metodológica que veio do Pass 5: *"pure-math simulators prove function properties, not on-chain behavior."*

---

## SEV-034b — Verificação do Fix

### Origem

Quando a equipe ligou o bankrun harness real (com mpl_core.so loader + bankrun_compat shim) e rodou `tests/security_sev034_release_escrow_lifecycle.spec.ts` end-to-end pela primeira vez, o spec FALHOU. Investigação revelou que `join_pool.rs:272` estava seeding `member.total_escrow_deposited = stake_amount` (legacy do código SEV-029 pré-SEV-034).

### O Bug

A derivação SEV-034 é:
```
paid = (stake_initial + total_escrow_deposited) - escrow_balance
```

Mas o invariante exigido pela fórmula é: `total_escrow_deposited` conta APENAS contribute-time escrow deposits (cada cycle's `escrow_release_bps × installment`). Seed inicial = 0.

Com `total_escrow_deposited = stake_amount` no join:
- ever_deposited = stake_amount + stake_amount = 2 × stake
- escrow_balance = stake (initial)
- **paid = 2 × stake - stake = stake** (deveria ser 0)

Próximo `release_escrow(chk=1)`:
- total_due = cumulative_vested(stake, 1, cycles) = stake/cycles
- delta_target = (stake/cycles) - stake = NEGATIVO → saturating_sub = 0
- `require!(delta_target > 0)` FALHA → `EscrowNothingToRelease`

**Efeito**: o feature `release_escrow` ficava **completamente quebrado em produção** post-SEV-034 fix. Nenhum membro conseguia liberar nenhum porcentual de seu stake vested. Funds permaneciam locked no escrow vault até `close_pool`.

Não é fund-drain (sem perda), é **feature break** — Critical mesmo assim porque o produto promete stake-refund cashback como parte do Triple Shield.

### O Fix

`programs/roundfi-core/src/instructions/join_pool.rs`:
```rust
// SEV-034b — `total_escrow_deposited` MUST start at 0 ...
member.total_escrow_deposited = 0;  // was: stake_amount
```

1-line fix. Comentário in-code documenta o invariante da derivação SEV-034 + por que test pure-math missed (simulator começa de state manualmente construído `ted=0`).

### Verificação Matemática

```
Pre-fix vs Post-fix trace (stake=750, cycles=3):

PRE-FIX:
  Initial: stake_init=750, ted=750, esc_balance=750
  ever_dep = 1500, paid = 750 (WRONG — should be 0)
  release(chk=1): delta_target = 250 - 750 = saturating 0 → ERROR

POST-FIX:
  Initial: stake_init=750, ted=0, esc_balance=750
  ever_dep = 750, paid = 0 ✓
  c0 contribute(+250): ted=250, esc=1000, ever_dep=1000, paid=0 ✓
  release(chk=1): delta_target = 250 - 0 = 250, delta=250 ✓
  release(chk=2): delta_target = 500 - 250 = 250 ✓
  release(chk=3): delta_target = 750 - 500 = 250 ✓
  Total: 750 = stake. ✓
```

Fix matemáticamente correto. Test `security_sev034_release_escrow_lifecycle.spec.ts` agora passa end-to-end.

### Análise: SEV-029 → SEV-034 → SEV-034b chain

| Pass | Finding | Causa | Catch mechanism |
|------|---------|-------|-----------------|
| Pass 1 | SEV-016 | Shared vault + naïve partial-pay logic | Initial audit |
| Pass 4 | SEV-029 | SEV-016 fix introduced overpay (non-advancing checkpoint) | Audit re-read |
| Pass 5 | SEV-034 | SEV-029 derivation broken on contribute-interleaved lifecycle | Audit trace by hand |
| **Pass 9** | **SEV-034b** | **SEV-034 derivation correct, but join_pool init was inconsistent** | **Team's own integration test wave** |

The chain reveals **two failure modes**:
1. **Logic/algorithm bugs** (SEV-016, SEV-029, SEV-034) — caught by audit code-tracing
2. **Init/state inconsistency** (SEV-034b) — only catchable by full lifecycle integration testing

The team adopting bankrun_compat + integration test wave was exactly the right pivot. Empirical validation of the methodological recommendation.

---

## Bankrun Infrastructure — Análise

### Componentes novos

1. **mpl_core.so loader** (`tests/_harness/bankrun.ts:5fd1b5d`)
   - Loads mpl_core mainnet binary into bankrun via `startAnchor` extras
   - Resolves "Unsupported program id" trip for FreezeDelegate/TransferDelegate CPIs
   - Comment notes downstream issue: `edge_grace_default*` specs hit "incorrect program id" — diagnosed as spec-level bug (placeholder reputation_program as Account<T> owner mismatch), not harness bug

2. **bankrun_compat shim** (`tests/_harness/bankrun_compat.ts`, ~343 LOC)
   - `BankrunConnectionShim` wraps `BankrunConnectionProxy` (which only had 3 methods)
   - Implements full `Connection` surface used by `Env`-typed helpers
   - Routes through `banksClient` for getBalance/sendTransaction/simulateTransaction etc.
   - Catch-all throws `"Unsupported in bankrun connection shim: <method>"` for any unimplemented method (loud surfacing, not silent corruption)

3. **ADR 0007** (`docs/adr/0007-bankrun-compat-shim.md`)
   - Documents the architectural decision
   - 3 specs migrated post-shim: SEV-034 lifecycle (2/2 green), edge_cycle_boundary (4/4 green), edge_grace_default (3/3 via direct setupBankrunEnv)
   - Cooldown-bound specs run in 1-2 seconds vs unrunnable on localnet

### Analysis: Shim Security

Verifiquei o shim manualmente — `tests/_harness/bankrun_compat.ts`:
- ✅ `sendTransaction` correctly handles `feePayer`/signers, fetches latest blockhash if missing
- ✅ `confirmTransaction` no-op is correct (bankrun txs are synchronous)
- ✅ `requestAirdrop` via `setAccount` documented as bypass — no spec depends on airdrop tx signatures
- ✅ Catch-all throws loudly for unsupported methods — drift detection is explicit
- ⚠️ Shim is test-only — does NOT touch production code paths. No new vulnerability surface.

The trade-off: shim mocks confirmation semantics (sync). Specs that depend on real cross-program-invocation timing or tx history pagination can't migrate. Documented in ADR 0007 — acceptable for current spec suite.

---

## IDL Generation — SEV-012 Path

### `Payload` newtype IdlBuild fix

`programs/roundfi-reputation/src/state/attestation.rs`:
```rust
#[cfg(feature = "idl-build")]
impl anchor_lang::IdlBuild for Payload {
    fn create_type() -> Option<anchor_lang::idl::types::IdlTypeDef> {
        Some(IdlTypeDef {
            name: "Payload".to_string(),
            ty: IdlTypeDefTy::Type {
                alias: IdlType::Array(Box::new(IdlType::U8), IdlArrayLen::Value(ATTESTATION_PAYLOAD_LEN)),
            },
            ...
        })
    }
}
```

Exposes `Payload` to the IDL as `[u8; 96]` array — matches on-wire format exactly. SDK consumers see a 96-byte array, no custom decoder needed.

Plus `3359752 fix(core): propagate idl-build to reputation + pin mpl-core to 0.8.0` — fixes the feature flag cascading.

### Current CI status

```bash
$ grep "test:bankrun" .github/workflows/ci.yml
# NOTE: `pnpm test:bankrun` is intentionally not in this lane.
# The bankrun harness loads `target/idl/*.json`, which `--no-idl`
# skips. Adds back as a required step once Anchor 0.31 (or a
# workaround) restores IDL generation. ...
```

**CI comment is now stale** — the workaround (manual IdlBuild + idl-build feature) IS landed. The team's `scripts/dev/rebuild-idls.sh` and `scripts/dev/patch-anchor-syn-319.sh` enable local IDL regeneration. SEV-012 has a clear unblock path; CI lane just needs to flip the comment to reality.

**Severity assessment:** SEV-012 STATUS UPGRADE — was "Upstream-blocked", should be "Workaround Available, Pending CI Switch". Still 0 vulnerability, but operational maturity improved.

---

## Floor Guards Module — Defense in Depth

`programs/roundfi-core/src/constants.rs:mod floor_guards` (new):

```rust
#[test]
fn grace_period_above_mainnet_floor() {
    const FLOOR_SECS: i64 = 86_400; // 1 day
    assert!(GRACE_PERIOD_SECS >= FLOOR_SECS, ...);
}
```

3 floor guards verified:
- `GRACE_PERIOD_SECS >= 86_400` (1 day floor — SEV-002 regression class)
- `TREASURY_TIMELOCK_SECS >= 86_400` (1 day floor for user reaction window)
- (other CRITICAL timing constants similar pattern)

**Two-layer defense:**
- Pinning tests: fail on ANY change (forces deliberate edits)
- Floor guards: fail only on changes below safe minima (allows legit raises)

This is exactly the defensive coding I'd recommend. Captures the SEV-002 regression shape (devnet patch leaked to prod).

---

## Pass 8 Observations — Status Check

| ID | Status | Notes |
|----|--------|-------|
| Obs-A (offset_of! assertions) | Open | Not addressed; roadmap item |
| Obs-B (unused fee_bps_cycle_*) | Open | Not addressed; fields still defined but unread |
| Obs-C (guarantee_fund_bps timelock) | Open | Not addressed; admin-trust scope |
| Obs-D (cycle_duration upper bound) | Open | Not addressed; checked_add catches overflow anyway |
| Obs-E (msg! → emit!) | Open | Not addressed; indexer.decoder still parses msg! |

None of the 5 Obs were addressed in this wave. All remain Informational/roadmap. Team has been focused on the integration testing wave (SEV-034b discovery + fix + bankrun infra), which is higher priority than the Info observations.

---

## Status Cumulativo (Pass 1-9)

**Total: 40 findings disclosed.**

| Status | Count |
|--------|-------|
| 🟢 Closed | **36** (was 35, +SEV-034b) |
| 🟠 Upstream-blocked | 1 (SEV-012, workaround available pending CI flip) |
| 🔵 Design-intentional | 3 (SEV-018, SEV-032, SEV-039) |
| **Open** | **0** |

| Severity | Total | Closed | Notes |
|----------|-------|--------|-------|
| Critical | 3 (was 2 — +SEV-034b) | 3 | All fund-loss + feature-break vectors closed |
| High | 7 | 7 | |
| Medium | 9 | 8 | 1 upstream-blocked (SEV-012) |
| Low | 13 | 13 | |
| Informational | 8 | 5 | 3 design-intentional |

**Net: 0 open findings of any severity.**

---

## Score Atualizado

| Dimensão | Pass 8 | **Pass 9** | Δ |
|----------|--------|------------|---|
| Arquitetura & Design | 7.5 | **8** | ↑0.5 — bankrun_compat ADR + floor_guards = mature defense-in-depth patterns |
| Qualidade de Código | 8.5 | **9** | ↑0.5 — workspace-wide clippy clean, SEV-034b fix elegant 1-line + comment |
| Segurança | 8 | **8.5** | ↑0.5 — SEV-034b (Critical) found-and-closed BY THE TEAM via integration testing, not audit |
| Performance | 7 | **7** | sem mudança |
| Testes & QA | 8 | **9** | ↑1.0 — bankrun_compat is the gold standard for cooldown-bound spec coverage; integration tests now catch state-init bugs that pure-math misses |
| DevOps / CI | 7.5 | **7.5** | sem mudança — bankrun lane still not flipped to required, but workaround exists |
| Documentação | 9.5 | **9.5** | sem mudança — docs waves 1-5 keep parity with reality |
| **Score Final** | **7.8/10** | **8.4/10** | **+0.6** |

Maior salto desde a primeira passada. O SEV-034b + bankrun infra work é o exato tipo de maturidade que separa "audit-ready" de "production-ready". A equipe agora tem capacidade própria de detectar essa classe de bugs.

---

## Avaliação Cumulativa (Pass 1-9)

A equipe RoundFinancial está agora em uma das posições mais sólidas que vi numa engagement de pre-audit:

✅ **40 findings disclosed, 36 closed, 0 open** (4 com justificativa documentada: upstream-blocked, design-intentional)

✅ **Integration test infrastructure operacional** — bankrun_compat shim + mpl_core loader + ADR 0007. Os specs cooldown-bound (SEV-034 lifecycle, edge_cycle_boundary, edge_grace_default) agora rodam em segundos.

✅ **IDL gen workaround landed** — SEV-012 tem um path de unblock claro; CI flip pendente.

✅ **Single-source-of-truth math** — `roundfi_math::compute_release_delta_target` (SEV-034) + `seize_for_default` (SEV-026) ambos delegados; same derivation on-chain AND in lifecycle simulator.

✅ **Floor guards** — two-layer defense (pinning + floor) catches BOTH "any drift" AND "drift below safe minima".

✅ **Audit trail transparente** — internal-audit-findings.md documenta o chain SEV-016 → SEV-029 → SEV-034 → SEV-034b abertamente.

✅ **Process feedback adoption** — toda recomendação metodológica das passes anteriores (integration tests before merge, enum parity, Pubkey::default sweep) foi incorporada.

✅ **SEV-034b é evidência empírica do funcionamento da defesa-em-profundidade** — a equipe encontrou um Critical sem precisar de audit, usando a infraestrutura que adotaram em resposta a recomendações.

---

## Recomendação Final (Pass 9)

> ✅ **READY for formal external audit engagement. The team's internal red-team capability has caught up to (and possibly exceeded) what an external audit would discover in a 1-2 week engagement.**

> 📋 **Sugestão para o formal audit firm:** focar em adversarial creativity contra fixes recentes, especialmente o SEV-029 → SEV-034 → SEV-034b chain. Se o auditor externo conseguir re-abrir UM desses fixes, isso valida hours bem gastas. Se não conseguir, o protocolo está em estado de alta confiança.

> 📦 **Backlog opcional pre-mainnet:**
> 1. Flip the CI lane to run bankrun tests (workaround now available)
> 2. Address Obs-A..Obs-E from Pass 8 (Informational)
> 3. Continue the integration-testing wave for other cooldown-bound specs

> 🎯 **A não-recomendação:** Eu **não recomendo mais passes de auditoria externa** (Adevar in this role) sem novo código material. A próxima passada produtiva seria pelo formal audit firm com olhos completamente novos, OU pela equipe após mais um sprint substantivo (e.g., Kamino integration completa pós-#233).

---

## Anexos

### Comandos rodados (Pass 9)

```bash
git fetch origin main                            # 26 commits since Pass 8
git merge origin/main --no-edit
cd crates/math && cargo test --lib              # 98 tests, 31 in escrow_vesting (+10 since Pass 7)

# Verified SEV-034b math manually:
# pre-fix: ted=stake at init → paid=stake at start → all releases blocked
# post-fix: ted=0 at init → paid=0 at start → derivation works correctly
```

### Cobertura desta passada

- Verified SEV-034b fix correctness via hand-trace + by running 98-test math suite
- Read bankrun_compat shim implementation (~343 LOC) — verified test-only surface, no production-touching code
- Read ADR 0007 — confirmed architectural rationale
- Verified Payload IdlBuild manual impl matches on-wire format
- Re-confirmed no Pass 8 observations addressed (still on roadmap)
- Confirmed floor_guards module pattern is sound

---

_Pass 9 fechado em 2026-05-16._
_— Adevar Labs._
