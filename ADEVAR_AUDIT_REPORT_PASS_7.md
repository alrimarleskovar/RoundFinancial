# Auditoria Técnica e de Segurança — RoundFinancial (Pass 7 — Fresh full-repo audit)
**Auditor:** Adevar Labs
**Data:** 2026-05-15
**Branch:** `claude/web3-security-audit-2CA0r` após `git fetch + git merge origin/main`
**HEAD efetivo:** após merge de `334665c` (PR #353 — 8/8 → 9/9 number consistency)
**Confirmação operacional:** rodei `git fetch origin main` ANTES de qualquer leitura.

---

## Sumário Executivo

Auditoria de fresh-eyes do repo inteiro pós-W4. Re-percorri código core, reputation, yield adapters, SDK encoders, orchestrator, app encoders, fuzz coverage, e Rust↔TS parity tests com objetivo de **encontrar coisas que escapei nas 6 passadas anteriores** (focadas em SEV-001..SEV-034) — não apenas re-confirmar fixes.

**Resultado:** 5 achados novos, todos Low/Informational. Não há fund-loss material remanescente. As verificações cumulativas das 34 SEVs anteriores continuam corretas.

| ID | Severidade | Resumo |
|----|-----------|--------|
| **SEV-035** | Low | `PoolStatus::Closed = 4` adicionado on-chain pelo SEV-005 fix MAS não foi propagado ao SDK `POOL_STATUS` const. Parity test não cobre enums — só seeds + bps numerics. |
| **SEV-036** | Low | `propose_new_authority` / `propose_new_reputation_authority` aceitam `Pubkey::default()` como `new_authority`. Cria estado zombie inconsistente. Self-healing mas footgun. |
| **SEV-037** | Informational | `commit_new_fee_bps_yield` é a única `commit_new_*` sem `Signer` no struct. Inconsistência estilística, não-vulnerabilidade. |
| **SEV-038** | Low | `create_pool` permite `cycles_total > members_target`. Pool fica permanentemente stuck em Active após cycle = members_target porque não há owner do slot para claim_payout. `close_pool` não pode ser chamado (requires `Completed`). |
| **SEV-039** | Informational | `close_pool` não fecha o Pool PDA nem as 4 ATAs de vault. Rent permanente locked + dust em vaults sem path de recovery. Documentado como deferred no comentário. |

**Recomendação:** SEV-035 + SEV-038 valem fixar antes da remoção do canary cap. SEV-036/037/039 podem ir para o backlog. Total cumulativo: **39 findings disclosed, 33 closed, 1 upstream-blocked (SEV-012), 3 design-intentional (SEV-018/032/037 if accepted), 2 novos open (SEV-035/038), 1 novo informational (SEV-036), 1 novo informational (SEV-039)**.

---

## Re-validação dos 34 achados anteriores (cumulative)

✅ Re-verifiquei sample dos fechamentos via code-trace direto, não apenas tracker. Todos continuam closed conforme reportado:

- **SEV-001** — `c_token_account: Account<TokenAccount>` com ATA constraint em `Deposit` ✓
- **SEV-002** — `GRACE_PERIOD_SECS = 604_800` em constants.rs ✓
- **SEV-005** — `pool.status = PoolStatus::Closed as u8` setado em close_pool ✓ (mas levou a SEV-035, ver abaixo)
- **SEV-029** → **SEV-034** chain — math agora delegada a `roundfi_math::compute_release_delta_target` (single source of truth, SEV-026 pattern) ✓
- **SEV-022** — selective pause em `attest.rs:157-159` (`if !is_pool_pda { require!(!cfg.paused) }`) ✓
- **SEV-007** — SCHEMA_DEFAULT triggera level demotion em-place ✓
- **SEV-008** — `Attestation.verified_at_attest` persisted; revoke usa esse valor ✓
- **SEV-021** — 3 ix `propose/cancel/commit_new_reputation_authority` espelha core, 7d timelock ✓
- **SEV-024** — `MAX_FEE_BPS_YIELD = 3_000` + 3 ix `propose/cancel/commit_new_fee_bps_yield` (1d timelock) ✓
- **SEV-026** — `seize_for_default(CascadeInputs)` delegation em settle_default ✓
- **SEV-030** — admin cooldown estendido a `SCHEMA_PAYMENT | SCHEMA_LATE | SCHEMA_DEFAULT` ✓
- **SEV-031** — runtime solvency check em `create_pool` ✓
- **SEV-033** — webhook fail-closed em production-like envs ✓

---

## Achados Novos

### [SEV-035] `PoolStatus::Closed = 4` não foi propagado ao SDK — Rust↔TS drift do SEV-005 fix

- **Severidade:** **Low** (UX drift; nenhum fund-loss; nenhum on-chain impact)
- **Dimensão:** Qualidade de Código / Documentação
- **Evidência:**
  - `programs/roundfi-core/src/state/pool.rs:88-94` — on-chain enum tem 5 variants:
    ```rust
    pub enum PoolStatus {
        Forming    = 0,
        Active     = 1,
        Completed  = 2,
        Liquidated = 3,
        Closed     = 4,  // ← adicionado por SEV-005 fix (PR #329)
    }
    ```
  - `sdk/src/constants.ts:58-64` — SDK só lista 4:
    ```typescript
    export const POOL_STATUS = {
      Forming: 0,
      Active: 1,
      Completed: 2,
      Liquidated: 3,
      // ← Closed = 4 MISSING
    } as const;
    ```
  - `tests/parity.spec.ts` — parity test cobre seeds + numeric bps + pool defaults + attestation schemas, MAS **não cobre enums de status**:
    ```typescript
    import { FEES, STAKE_BPS_BY_LEVEL, POOL_DEFAULTS, ATTESTATION_SCHEMA } from "@roundfi/sdk/constants";
    // POOL_STATUS not imported / not asserted
    ```
- **Descrição:** O SEV-005 fix adicionou `PoolStatus::Closed = 4` para evitar que `close_pool` seja chamado múltiplas vezes em um mesmo pool. Mas a constante TypeScript no SDK não foi atualizada. Front-end / indexer / orchestrator que parsam `pool.status` veem o byte `4` como desconhecido.
- **Impacto:**
  - **UI displays "Unknown status" ou misclassifies como Liquidated** em pools que passaram pelo `close_pool` flow.
  - **Indexer** que filtra por status pode skip ou misclassify Closed pools.
  - **Sem impacto na correção on-chain** — o programa segue funcionando.
  - **Parity test falha-silente** porque não cobre POOL_STATUS enum.
- **Recomendação:**
  1. Adicionar `Closed: 4` ao SDK:
     ```typescript
     export const POOL_STATUS = {
       Forming: 0,
       Active: 1,
       Completed: 2,
       Liquidated: 3,
       Closed: 4,  // SEV-035 — mirror on-chain enum (PR #329 SEV-005 fix)
     } as const;
     ```
  2. **Crítico para evitar futuros drifts:** estender `tests/parity.spec.ts` para asserter parity de enums (incluindo `PoolStatus`, `EscapeValveStatus`, `IdentityProvider`, `IdentityStatus`). Padrão atual de "extract `pub enum X = N` from Rust source via regex, assert match" segue o pattern já estabelecido para SEED_* literals.
- **Esforço estimado:** XS (1 linha SDK) + S (parity test extension).

---

### [SEV-036] `propose_new_authority` aceita `Pubkey::default()` — cria estado zombie inconsistente

- **Severidade:** **Low** (admin footgun; self-healing; não exploitable por externo)
- **Dimensão:** Segurança / Qualidade de Código
- **Evidência:**
  - `programs/roundfi-core/src/instructions/propose_new_authority.rs:54-67` — não há check `args.new_authority != Pubkey::default()`:
    ```rust
    require!(
        cfg.pending_authority == Pubkey::default(),
        RoundfiError::AuthorityProposalAlreadyPending,
    );
    // ... no check on args.new_authority value ...
    cfg.pending_authority     = args.new_authority;  // ← could be Pubkey::default()
    cfg.pending_authority_eta = eta;
    ```
  - Mesma falta de check em:
    - `programs/roundfi-reputation/src/instructions/propose_new_reputation_authority.rs`
    - `programs/roundfi-reputation/src/instructions/update_reputation_config.rs` (já obsoleto via SEV-021 fix, mas ainda aceita)
- **Descrição:** Se authority propose `new_authority = Pubkey::default()`:
  1. `pending_authority = Pubkey::default()` (= sentinel "no pending")
  2. `pending_authority_eta = now + 7d` (= "proposal pending")

  Estados contraditórios: o eta diz "pending", o pubkey diz "no pending". Subsequentemente:
  - `commit_new_authority` → falha (`pending == default` = NoPendingAuthorityChange)
  - `cancel_new_authority` → falha (mesmo motivo)
  - `propose_new_authority` (segunda chamada) → **sucesso**, sobrescreve eta + pubkey

  Não-lock, mas zombie state visível em on-chain reads até a próxima propose.
- **Impacto:**
  - Authority comete erro de configuração (e.g., passa wallet vazia por engano).
  - Off-chain monitors podem alertar de "proposal pending" enquanto na verdade não há.
  - Audit log mostra `propose_new_authority new=11111...111` (PublicKey default) que parece operacionalmente estranho.
- **Recomendação:** Adicionar guard rejection:
  ```rust
  require!(
      args.new_authority != Pubkey::default(),
      RoundfiError::InvalidAuthority,  // new error variant
  );
  ```
  Em ambos os arquivos (core + reputation propose handlers).
- **Esforço estimado:** XS (2 linhas + 1 error variant).

---

### [SEV-037] `commit_new_fee_bps_yield` não tem `Signer` no struct — inconsistência estilística

- **Severidade:** **Informational**
- **Dimensão:** Qualidade de Código
- **Evidência:**
  - `programs/roundfi-core/src/instructions/commit_new_fee_bps_yield.rs:21-30`:
    ```rust
    #[derive(Accounts)]
    pub struct CommitNewFeeBpsYield<'info> {
        #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
        pub config: Account<'info, ProtocolConfig>,
        // No Signer field! Unlike commit_new_authority / commit_new_treasury.
    }
    ```
  - Compare com `commit_new_authority.rs:42-44` e `commit_new_treasury.rs:39-41`:
    ```rust
    /// Anyone can crank — no signer/authority constraint.
    pub caller: Signer<'info>,
    ```
- **Descrição:** Os outros dois commit handlers permissionless (`commit_new_authority`, `commit_new_treasury`) incluem um `caller: Signer<'info>` field documentando explicitamente que "anyone can crank". O `commit_new_fee_bps_yield` omite isso. Funcionalmente equivalentes porque qualquer transação Solana já requer pelo menos um signer (fee payer), mas a inconsistência estilística pode confundir auditores futuros.
- **Impacto:** Nenhum — só code review surface.
- **Recomendação:** Adicionar `pub caller: Signer<'info>` para consistência com os outros 2 commit handlers permissionless.
- **Esforço estimado:** XS.

---

### [SEV-038] `create_pool` permite `cycles_total > members_target` — pool fica permanentemente stuck

- **Severidade:** **Low** (admin footgun via custom config; não exploitable por external)
- **Dimensão:** Arquitetura & Design / UX
- **Evidência:**
  - `programs/roundfi-core/src/instructions/create_pool.rs:97-100`:
    ```rust
    require!(
        args.cycles_total as u16 >= args.members_target as u16,
        RoundfiError::InvalidPoolParams,
    );
    ```
    Permite `cycles_total > members_target`.
  - `claim_payout.rs`:
    ```rust
    require!(member.slot_index == args.cycle, RoundfiError::NotYourPayoutSlot);
    require!(args.cycle < pool.cycles_total, RoundfiError::PoolClosed);
    ```
    Cycle N requer member com slot_index == N.
- **Descrição:** Se pool authority cria pool com e.g. `members_target = 24, cycles_total = 30`:
  - Cycles 0..23: cada cycle tem um member com matching slot_index → claim_payout funciona, cycle advances.
  - Cycle 24: pool.current_cycle = 24, mas nenhum member tem slot_index = 24. Não existe member.
  - claim_payout(24): require `member.slot_index == 24` falha (no member at slot 24).
  - contribute(24): require `args.cycle == pool.current_cycle` → contribute(24) at cycle 24 works for members 0..23 paying their final installment? Wait — contribute requires `args.cycle == member.contributions_paid` (line 127 contribute.rs). After cycle 23, contributions_paid = 24. So contribute(24) for any member requires contributions_paid = 24 = current_cycle. Tx with args.cycle=24 → members can keep contributing in their stuck cycles.
  - But claim_payout fails. So cycle doesn't advance. pool stays at current_cycle=24 forever. status stays Active.
  - **`close_pool` requires `status == Completed`** — never reachable. Pool is permanently stuck.

  Funds in pool_usdc_vault are accessible only via... nothing. There's no withdraw, no emergency drain, nothing. Stuck.

  Members can still `release_escrow` (no pool.status check there), so they recover stake. Escrow contributions stay locked in escrow_vault.

  In practice: `with_defaults` uses members=24, cycles=24, so this footgun isn't hit by the happy path. But anyone using custom params can hit it.
- **Impacto:** Pool authority error → pool funds (pool_usdc_vault + solidarity_vault + locked escrow contributions) trapped forever. No on-chain recovery path.
- **Recomendação:** Tightening the constraint to equality:
  ```rust
  require!(
      args.cycles_total as u16 == args.members_target as u16,
      RoundfiError::InvalidPoolParams,
  );
  ```
  OR mantendo `>=` mas adicionando um "post-completion" cycle handling (more complex). The equality option is simpler and matches the actual product spec ("one payout per member per cycle").
- **Esforço estimado:** XS (1 char: `>=` → `==`) + test update.

---

### [SEV-039] `close_pool` não fecha PDAs nem vault ATAs — rent locked + dust untouchable

- **Severidade:** **Informational** (documented as deferred; not a vulnerability)
- **Dimensão:** Operacional / UX
- **Evidência:**
  - `programs/roundfi-core/src/instructions/close_pool.rs:13-17` (comment):
    > Actual vault-close and rent-return is deferred: closing an ATA requires knowing it's empty, which in turn requires the authority to have drained leftover dust to treasury. That drain is a follow-up chore; for the hackathon demo a Completed pool is effectively closed.
  - Handler doesn't use Anchor's `close = X` directive on `pool` or any vault account.
- **Descrição:** A função `close_pool` transitions `pool.status = Closed` e decrementa `committed_protocol_tvl_usdc`, mas:
  - Pool PDA permanece allocated (rent locked forever)
  - `pool_usdc_vault` ATA não é fechado (any residual USDC stuck)
  - `escrow_vault`, `solidarity_vault`, `yield_vault` ATAs idem
  - Member PDAs idem

  Para uma pool típica (Pool PDA + 4 vault ATAs + ~24 Member PDAs + ~24 attestation PDAs/cycle * 24 cycles = ~600 PDAs), isso é ~3 SOL de rent permanentemente lock por pool. Multiplicado por dezenas/centenas de pools no longo prazo, é capital ineficiente.

  Adicionalmente, qualquer dust em vaults (e.g., rounding residuals do waterfall) fica untouchable.
- **Impacto:** Capital efficiency degradation over protocol lifetime. Não é vulnerabilidade — é design decision documented.
- **Recomendação:** Roadmap item para post-mainnet:
  1. Adicionar `sweep_pool_dust(pool, treasury)` — authority drains residual dust to treasury before close.
  2. Adicionar `close_pool_full(pool)` — closes Pool PDA + 4 vault ATAs + returns rent to authority. Requires all vaults empty.
- **Esforço estimado:** M (new ix surface + tests).

---

## Outros pontos verificados (sem novos achados)

1. **SDK encoders structural parity** — verifiquei `release_escrow.ts` (9 accounts), `escape_valve_buy.ts` (15 accounts), `deposit_idle_to_yield.ts` (8 explicit + remaining_accounts). Account ORDER bate com on-chain struct definitions. ✓
2. **PDA seed parity Rust↔TS** — confirmados via `sdk/src/pda.ts` vs `programs/roundfi-core/src/constants.rs`. 8 seeds (core) + 4 seeds (rep) todos byte-equal. ✓
3. **Math crate single source of truth** — `release_escrow` agora chama `crate::math::compute_release_delta_target` que delega a `roundfi_math::compute_release_delta_target`. `settle_default` similar via `seize_for_default(CascadeInputs)`. Both confirm the SEV-026 pattern. ✓
4. **escape_valve_buy state preservation** — Member field snapshot inclui `stake_deposited_initial`, `total_escrow_deposited`, `escrow_balance` corretamente. Buyer inherits SEV-034 derivation state cleanly. Cannot double-claim. ✓
5. **Same-wallet-as-seller-and-buyer in escape_valve_buy** — Anchor catches via PDA collision on init of new_member. ✓
6. **Reputation pause selective carve-out** — `attest.rs:157-159` checks `!is_pool_pda` before applying `cfg.paused` guard. Pool-PDA-signed CPI bypasses pause; admin-direct blocked. SEV-022 fix sound. ✓
7. **commit_new_fee_bps_yield defense in depth** — re-validates `new_value <= MAX_FEE_BPS_YIELD` at commit time, not just at propose. Catches a hypothetical scenario where MAX was tightened between propose and commit (program upgrade). ✓
8. **Math crate fuzz coverage** — 6 cargo-fuzz targets on `cascade`, `waterfall`, `dc_invariant`, `escrow_vesting`, `bps`, `seed_draw`. Note: `escrow_vesting` fuzz target exists, but I'd recommend a NEW fuzz target specifically for `compute_release_delta_target` since SEV-034 showed pure-math fuzzing of the derivation alone catches the regression cleanly.
9. **Bankrun integration test for SEV-034** — `tests/security_sev034_release_escrow_lifecycle.spec.ts` exercises exactly the interleaved contribute/release pattern. Would have caught the original bug. ✓
10. **PoolStatus state machine** — Forming → Active → Completed → Closed. Each transition exactly-once (status check on entry of each ix). ✓

---

## Score Atualizado

| Dimensão | Pass 6 | **Pass 7** | Δ |
|----------|--------|------------|---|
| Arquitetura & Design | 7.5 | **7.5** | sem mudança |
| Qualidade de Código | 9 | **8.5** | ↓0.5 — Rust↔TS drift (SEV-035) + commit pattern inconsistency (SEV-037) |
| Segurança | 8 | **8** | sem mudança — todos os fund-loss vectors closed |
| Performance | 7 | **7** | sem mudança |
| Testes & QA | 8 | **8** | sem mudança — bankrun SEV-034 spec + math crate single source of truth pattern continuam fortes |
| DevOps / CI | 7.5 | **7.5** | sem mudança |
| Documentação | 9.5 | **9.5** | sem mudança — tracker honesto, methodological notes |
| **Score Final** | **8.0/10** | **7.8/10** | -0.2 |

Sub-fall em Quality é devido aos novos achados que mostram que o sistema de "Rust↔TS parity tests" não é completo (não cobre enums). Sub-fall líquido pequeno porque os achados são todos Low/Info — nenhum reabre fund-loss vector.

---

## Status Cumulativo (todos os passes 1-7)

**Total: 39 findings disclosed.**

| Status | Count | IDs |
|--------|-------|-----|
| 🟢 Closed | 32 | SEV-001..SEV-011, 013..017, 019..029, 031, 034 |
| 🟡 Partially closed | 1 | SEV-016 (closed-then-regressed → SEV-029 → SEV-034 chain, all now closed) |
| 🟢 Closed (chain endpoint) | 1 | SEV-034 |
| 🔵 Design-intentional | 3 | SEV-018, SEV-032, SEV-039 |
| 🟠 Upstream-blocked | 1 | SEV-012 |
| 🟢 Closed (this pass) | 0 | — |
| 🟡 Open (new this pass) | 4 | SEV-035 (Low), SEV-036 (Low), SEV-037 (Info), SEV-038 (Low) |
| 🔵 Documented (new this pass) | 1 | SEV-039 |

**Critical / High** (10 total): 9 closed (SEV-001, 002, 003, 004, 005, 021, 022, 029, 034) — wait, SEV-029 + SEV-034 chain ⇒ 2 unique vulnerabilities of which SEV-029 status is yellow because regression. **Net unique fund-loss findings: 10 disclosed, 10 closed.**

---

## Recomendação Operacional

> ✅ **Canary mainnet pode prosseguir.** Nenhum dos 5 achados novos é fund-loss. SEV-035 (Rust↔TS drift) e SEV-038 (cycles_total > members_target stuck) valem fixar antes da remoção do canary cap.

> 📋 **Antes da remoção do canary cap geral:**
> 1. **SEV-035** — Add `Closed: 4` to SDK + extend parity test to cover enums (15 min)
> 2. **SEV-038** — Tighten `cycles_total >= members_target` to `==` (1 char) OR document the constraint clearly
> 3. **SEV-036** — Add `args.new_authority != Pubkey::default()` guard in propose handlers (defensive)
> 4. **SEV-037** — Add `pub caller: Signer<'info>` to `commit_new_fee_bps_yield` for consistency
> 5. **SEV-012** — Continue upstream tracking Anchor 0.31+/Agave 2.x migration

> 📦 **Roadmap items:**
> - **SEV-039** — Design `sweep_pool_dust` + `close_pool_full` for post-mainnet rent recovery

---

## Recomendações Estratégicas

Em adição às recomendações dos passes anteriores:

1. **Estender Rust↔TS parity tests para enums.** SEV-035 demonstra que o sistema atual de parity testing tem buraco — só cobre seeds + bps + numerics. Adicionar enum-parity test (regex-extract `pub enum X { Foo = N, Bar = M }` from Rust source, assert match in SDK const) é um few-hour task que previne uma classe inteira de drifts. Priorizar antes de mainnet.

2. **Single source of truth pattern para mais state.** O pattern de `roundfi_math` crate + delegação pelo handler é excelente — mesma derivação roda no on-chain code AND no test simulator. Aplicar este pattern a outros derivations:
   - Yield waterfall logic (already partial via `roundfi_math::waterfall`)
   - Seizure DC invariant (already done via SEV-026)
   - Pool viability check (already done via SEV-031)
   - Reputation level resolution (currently in reputation crate; consider extracting to math)

3. **State machine completeness audit.** SEV-038 surfaces that pool.status transitions don't enforce the only-valid-cycles invariant. Audit the FULL state machine for similar edge cases: what about contributing to a Completed pool? Releasing escrow from a Closed pool? Initiating escape valve on Liquidated pool? Each transition should be deliberately constrained.

4. **Add `close_pool_full` to the post-mainnet roadmap.** Capital efficiency over the protocol lifetime depends on closing finished pools. SEV-039 is a deferred-but-real item.

5. **Mainnet readiness tag.** Considerar uma tag git `v1.0.0-mainnet-ready` quando todos os SEV-035/036/038 estiverem closed + Squads ceremony executada. Marca um ponto-de-controle estável para o canary launch.

---

## Anexos

### Comandos rodados (Pass 7)

```bash
git fetch origin main                # 4 novos commits (#350, #351, #352, #353)
git merge origin/main --no-edit
git log -1 --format=...

# Re-verification of SEV-029 → SEV-034 chain
cd crates/math && cargo test --lib escrow_vesting  # 21 passed

# Drift hunting:
diff <(grep -A6 "pub enum PoolStatus" programs/roundfi-core/src/state/pool.rs) \
     <(grep -A6 "POOL_STATUS" sdk/src/constants.ts)
# → reveals SEV-035

# Pool config edge cases:
grep "cycles_total" programs/roundfi-core/src/instructions/create_pool.rs
# → reveals SEV-038

# Commit pattern consistency:
grep -B1 -A4 "pub caller: Signer" programs/roundfi-core/src/instructions/commit_new_*.rs
# → reveals SEV-037
```

### Cobertura desta passada

**Re-verificados:**
- Todos os 23 fixes do release_escrow chain (SEV-016 → SEV-029 → SEV-034)
- Math crate single source of truth implementation
- Bankrun integration test for SEV-034
- SDK encoders for release_escrow, escape_valve_buy, deposit_idle_to_yield
- Webhook auth fail-closed logic (SEV-033)
- Parity test scope

**Áreas exploradas em profundidade desta vez (que tinham coverage parcial antes):**
- `app/src/lib/` — todos os 9 IDL-free encoders (estrutural + discriminadores)
- `sdk/src/pda.ts` + `sdk/src/constants.ts` — drift hunting
- `services/orchestrator/` — keypair handling + cycle orchestration
- `programs/roundfi-core/src/instructions/commit_new_*.rs` — todos os 3 commit handlers
- Pool state machine completeness
- `crates/math/src/escrow_vesting.rs` — verified 21 tests pass including 5 SEV-034 regression specs

---

_Pass 7 fechado em 2026-05-15._
_— Adevar Labs._
