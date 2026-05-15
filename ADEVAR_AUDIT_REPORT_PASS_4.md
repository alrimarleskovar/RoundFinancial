# Auditoria Técnica e de Segurança — RoundFinancial (Pass 4 — fresh look pós Fase 4)
**Auditor:** Adevar Labs
**Data:** 2026-05-15
**Branch:** `claude/web3-security-audit-2CA0r` após `git merge origin/main`
**HEAD efetivo:** `26060c5` (merge de `50db364` — main com 18 commits adicionais desde o snapshot original `fbc931e`)
**Confirmação operacional desta vez:** rodei `git fetch origin main` ANTES de qualquer leitura. O merge incluiu PRs #326..#339 (Fases 1, 2, 3, 4-A, 4-B, 4-C). Verifiquei file-por-file, não confiei em commit msgs.

---

## Sumário Executivo

A equipe RoundFinancial fechou **27 dos 28 achados** em ~36 horas, com qualidade técnica notável. Apenas SEV-026 (cascade duplication, deferred to Fase 5) e SEV-012 (bankrun in CI, blocked upstream on Anchor 0.31+) continuam abertos por escolhas conscientes documentadas em commit msgs.

**MAS:** essa quarta passada — feita com olhos novos contra o código real — encontrou **3 achados novos materiais**, dos quais 1 é uma **regressão High introduzida pelo próprio fix da SEV-016**. Os outros são parciais/escopo-limitado nos fixes da SEV-027 e SEV-025.

**SEV-029 (High — REGRESSÃO):** O fix da SEV-016 (partial-pay em `release_escrow`) introduz **overpay determinístico** quando a janela partial dispara. O member chama `release_escrow(checkpoint=X)` durante shortfall, recebe parcial 100, checkpoint NÃO avança. Vault refilha, member chama de novo: `delta_target` é re-computed a partir do MESMO `last_checkpoint=0` retornando o valor full novamente (208), não o restante (108). Member recebe 208, total acumulado 308 — quando o entitlement era apenas 208. Overpay vem do `escrow_vault` compartilhado, drenando contribuições de outros members.

**SEV-030 (Low):** O fix da SEV-027 (admin cooldown) cobre apenas `SCHEMA_PAYMENT`, deixando `SCHEMA_LATE` e `SCHEMA_DEFAULT` sem cooldown. Admin compromised pode grief score-destruction sem rate-limit.

**SEV-031 (Low):** O fix da SEV-025 (defaults inviables) atualizou apenas as constantes de default. NÃO adicionou check runtime em `create_pool`. Pools customizados que escolham `installment × members × (1 - solidarity_bps - escrow_release_bps) < credit_amount` ainda criam OK e ficam stuck no primeiro `claim_payout`.

**Recomendação:** **NÃO REMOVER o canary cap da mainnet** até SEV-029 estar fechado e teste negativo coberto. SEV-001..005 + SEV-021..022 confirmados fechados; o fund-loss vector da SEV-029 é da mesma severidade que SEV-001 era na primeira passada.

---

## Re-validação dos 28 achados anteriores

Verifiquei cada finding contra o código atual (`HEAD` `26060c5`). Marcações com diff confirmado:

### Fixed (24 closures verificadas + 3 docs/info)

| ID | PR | Confirmação no main |
|----|----|--------------------|
| SEV-001 Critical | #326 | `Account<'info, TokenAccount>` + `associated_token::mint = kamino_reserve_collateral_mint, authority = state` no struct `Deposit` (linha ~556 atual). Idêntico ao `Harvest`. Fechado. |
| SEV-002 Critical | #327 | `GRACE_PERIOD_SECS = 604_800` em `constants.rs:49`. Test pinned em `7 * 24 * 60 * 60`. Fechado. |
| SEV-003 High | #329 | `harvest_yield` lê `ctx.accounts.config.lp_share_bps`, ignora arg do caller com log warning. Field movido para `ProtocolConfig`. Fechado. |
| SEV-004 High | #329 | `pool.vaults_initialized: bool` flag + `require!(!pool.vaults_initialized, VaultsAlreadyInitialized)` no entrypoint do `init_pool_vaults`. Set ao final do handler. Fechado. |
| SEV-005 High | #329 | `PoolStatus::Closed = 4` enum variant; `pool.status = PoolStatus::Closed as u8` setado no handler. Constraint de entry `status == Completed` rejeita re-execução. Fechado. |
| SEV-006 Medium | #331 | `propose_new_treasury` recebe `Account<TokenAccount>` constrained a `address = config.usdc_mint`. Fechado. |
| SEV-007 Medium | #332 | SCHEMA_DEFAULT arm em attest re-deriva level via `resolve_level(post-delta-score).max(LEVEL_MIN)`. Demotion ativa. Fechado. |
| SEV-008 Medium | #332 | `Attestation.verified_at_attest: bool` campo persistido. `revoke` lê desse campo. Fechado. |
| SEV-009 Medium | #330 | Bearer token `HELIUS_WEBHOOK_SECRET` + 401 reply quando mismatch + startup warning quando unset. **Mas:** ver SEV-033 abaixo (footgun residual). |
| SEV-010 Medium | #330 | `.env.example: B2B_API_KEY_SALT=` (vazio) com comentário "≥32 random bytes hex-encoded". Fechado. |
| SEV-011 Medium | #333 | `cargo audit --deny warnings` com `--ignore RUSTSEC-...` específicos. Sem `\|\| true`. Required gate. Fechado. |
| SEV-012 Medium | — | **AINDA OPEN** (declared, não-fix justificado). Bankrun no CI continua bloqueado upstream pela Anchor 0.31+/Agave 2.x migration (issue #319). Aceitável dado o blocker documentado. |
| SEV-013 Low | #330 | `require!(args.salt != 0, SaltMustBeNonZero)` em `escape_valve_list_reveal`. Novo error variant. Fechado. |
| SEV-014 Low | #336 | `PREFIX_CLAIM = "Program log: roundfi-core: payout"` (era `"claim_payout"`). Decoder agora alinhado ao msg! emitido. Fechado. |
| SEV-015 Low | #335 | `cancel_pending_listing.rs` adicionado, seller-only, status=Pending only, close = seller_wallet. Fechado. |
| SEV-016 Low | #334 | `delta = delta_target.min(vault_amount)` + checkpoint conditional. **Fix shipped MAS introduz SEV-029 — ver achado novo.** |
| SEV-017 Info | #334 | JSDoc updated em `sdk/src/actions.ts`. Fechado. |
| SEV-018 Info | — | Não-fix por design — comentário em settle_default mantém "settle_default bypasses the pause flag intentionally". Confirmado intencional. |
| SEV-019 Info | #328 | Docs atualizados. Fechado. |
| SEV-020 Info | #328 | Docs operacionais para `lock_approved_yield_adapter`. Fechado. |
| SEV-021 High | #337 | 3 novas instructions: `propose/cancel/commit_new_reputation_authority` com `REPUTATION_AUTHORITY_TIMELOCK_SECS = 604_800` (7d). `update_reputation_config.new_authority` ignored com log de warning. Fechado. |
| SEV-022 High | #337 | Constraint `!config.paused` removido do `Attest` struct, movido para handler como `if !is_pool_pda { require!(!cfg.paused, ...) }`. Pool-PDA-signed CPIs from core continuam mesmo quando reputation pausado. Settle_default no-lock property restaurada. Fechado — bem feito. |
| SEV-023 Medium | #338 | `MIN_CYCLE_DURATION = 86_400` (1 day). Fechado. |
| SEV-024 Medium | #338 | `MAX_FEE_BPS_YIELD = 3_000` (30%). `update_protocol_config.new_fee_bps_yield` constrained. `initialize_protocol.fee_bps_yield` também constrained. Fechado. |
| SEV-025 Low | #339 | `DEFAULT_INSTALLMENT_AMOUNT 416 → 600`. **Fix parcial — runtime check em create_pool ainda ausente. Ver SEV-031.** |
| SEV-026 Low | — | **AINDA OPEN** — explicitamente "deferred to Fase 5" no commit msg de #339. Maintainability, no impact. |
| SEV-027 Low | #339 | `MIN_ADMIN_ATTEST_COOLDOWN_SECS = 60` + `last_admin_attest_at` field. **Fix parcial — só cobre SCHEMA_PAYMENT, não LATE/DEFAULT. Ver SEV-030.** |
| SEV-028 Low | #339 | `Err(e)` agora logado antes do flip para Revoked. Behavior unchanged, observability ganha. Fechado (escopo declarado). |

**Highlights de qualidade dos fixes:**

1. **SEV-022 fix é particularmente bem feito.** O insight de mover o pause check do constraint para o handler com gating em `is_pool_pda` é elegante: preserva a intenção do pause flag (bloquear admin write surface) sem quebrar a propriedade core de "settle_default never locks funds". Comentário in-code documenta o trade-off operacional ("operator agora precisa pause AMBOS os protocolos explicitamente").
2. **SEV-007 fix foi melhor que minha sugestão.** Eu recomendei mudar `derive_trusted_reputation_level` em join_pool para re-derivar de score. A equipe optou por demotar IMEDIATAMENTE no `attest` arm de SCHEMA_DEFAULT, que fecha o caminho mais cedo (todo consumidor de `profile.level` recebe o valor correto). 
3. **SEV-001 fix exato como recomendado.** ATA constraint adicionado no `Deposit` struct, idêntico ao já-existente `Harvest`.
4. **Todos os commits referenciam o SEV-ID e linkam o threat model in-code.** Auditabilidade futura facilitada.

---

## ACHADOS NOVOS (Pass 4)

### [SEV-029] release_escrow partial-pay path causa overpay determinístico — REGRESSÃO da SEV-016 fix

- **Severidade:** **High** (fund-loss exploitável; drena outros members do escrow_vault compartilhado)
- **Dimensão:** Segurança / Math
- **Evidência:** `programs/roundfi-core/src/instructions/release_escrow.rs:97-167` (após o fix de SEV-016)

```rust
let delta_target = releasable_delta(
    member.stake_deposited,            // immutable principal
    member.last_released_checkpoint,   // ← NÃO advance se partial
    args.checkpoint,
    pool_cycles,
)?;
require!(delta_target > 0, RoundfiError::EscrowNothingToRelease);
require!(delta_target <= member.escrow_balance, RoundfiError::EscrowNothingToRelease);

let delta = delta_target.min(vault_amount);   // ← partial cap
require!(delta > 0, RoundfiError::EscrowNothingToRelease);
if delta < delta_target {
    msg!("partial...");                       // ← checkpoint NOT advanced on partial
}

token::transfer(... delta);

member.escrow_balance -= delta;               // ← only decrements actual delta
if delta == delta_target {
    member.last_released_checkpoint = args.checkpoint;
}
```

- **Descrição:** O fix da SEV-016 permite pagamento parcial quando o `escrow_vault` compartilhado tem saldo insuficiente para o `delta_target` calculado. Para preservar a possibilidade de "completar o pagamento depois", o handler **não avança** `member.last_released_checkpoint` quando `delta < delta_target`. **Mas** `delta_target` é calculado em função de `(stake_deposited, last_released_checkpoint, args.checkpoint, total_checkpoints)`. Se o checkpoint não avança, a próxima chamada com o mesmo `args.checkpoint` retorna o MESMO `delta_target` — não o restante. O member acaba recebendo o partial INICIAL **mais** o full delta na segunda chamada.

- **Impacto:** Overpay determinístico de até ~delta_target USDC por janela parcial-trigger. Os fundos extra vêm do `escrow_vault` compartilhado, que contém:
  - Stake de TODOS os members (inicial)
  - Contribuições de escrow acumuladas de TODOS os members (25% das parcelas)

  O attacker é qualquer member que detecte a janela partial (que é OBSERVÁVEL no chain via msg! "release_escrow partial pool=... member=... owed=... paid=... vault shortfall"). A janela ocorre naturalmente após `settle_default` — toda vez que outros members defaultam, o vault é drenado, e qualquer release_escrow nesse momento aciona partial. Member que aciona partial pode então re-chamar com vault refilled e ganhar overpay.

- **Cenário de Ataque:**
  1. Pool com 24 members, vários defaults acontecem ao longo do tempo (settle_default drena `escrow_vault` para `pool_usdc_vault`).
  2. Vault refilling acontece via novas contribuições.
  3. **Attacker (member legítimo, não precisa ser malicioso):** monitora msg! logs ou chain state. Quando detecta vault shortfall, chama `release_escrow(checkpoint=X)` durante a janela.
     - Recebe partial: `delta = vault_amount` (ex.: 100 USDC de 208 owed).
     - `last_released_checkpoint` permanece em valor anterior.
  4. Vault refilled (próximas contribuições, próximo cycle).
  5. **Attacker re-chama `release_escrow(checkpoint=X)` com mesmo args:**
     - `delta_target` re-computado: 208 (mesmo valor, last_checkpoint não mudou)
     - `delta = min(208, vault) = 208`
     - Recebe 208 (cumulativo: 308)
     - Checkpoint avança para X.
  6. **Attacker continua chamadas até checkpoint final (cycles_total)**:
     - Final: `delta_target = stake - vested_at_X = stake - (stake * X/cycles)`. Recebe esse valor.
     - **Total recebido = 308 + (stake - 208) = stake + 100 = OVERPAY de 100 USDC**
  7. Repetível por cycle / por janela partial. Cada iteration ~1-200 USDC de overpay.

- **Prova de Conceito (pseudocódigo TS):**
  ```typescript
  // Pre-condition: another member just defaulted, draining escrow_vault.
  const vaultBefore = await getVaultBalance(pool.escrowVault);
  const myEntitlementAt5 = await computeReleasableDelta(member, 5);
  // vaultBefore < myEntitlementAt5 — partial window is open

  // Step 1: trigger partial
  await program.methods.releaseEscrow({ checkpoint: 5 }).rpc();
  // → received vaultBefore USDC, checkpoint stays at 0 (was 0 initially)

  // Step 2: wait for next cycle's contributions to refill vault
  await waitForVaultRefill();

  // Step 3: re-call with same checkpoint
  await program.methods.releaseEscrow({ checkpoint: 5 }).rpc();
  // → received myEntitlementAt5 USDC (full), checkpoint advances to 5
  // Total received: vaultBefore + myEntitlementAt5 USDC
  // Expected at checkpoint=5: myEntitlementAt5 USDC
  // Overpay: vaultBefore USDC

  // Step 4: continue with checkpoint=24
  await program.methods.releaseEscrow({ checkpoint: 24 }).rpc();
  // → received stake - myEntitlementAt5 USDC
  // Total final: stake + vaultBefore (i.e., overpay = vaultBefore)
  ```

- **Componentes Afetados:** `programs/roundfi-core/src/instructions/release_escrow.rs:97-175`

- **Recomendação:** Três opções, do mais simples ao mais robusto:

  **Opção A (recomendada — minimal patch):** Decrementar `member.stake_deposited` pela parcial, mantendo `last_released_checkpoint` no valor antigo. Assim o vesting math computa o restante corretamente:
  ```rust
  let delta = delta_target.min(vault_amount);
  if delta == delta_target {
      member.last_released_checkpoint = args.checkpoint;
  } else {
      // Partial — don't advance checkpoint, but DECREMENT stake_deposited
      // by the partial amount so the next delta_target computation
      // reflects the already-paid portion.
      member.stake_deposited = member.stake_deposited.checked_sub(delta)?;
      // Also adjust stake_deposited_initial? NO — that's the D/C invariant
      // anchor. The partial decrement to stake_deposited only affects
      // future releasable_delta computations, not the D/C accounting.
  }
  ```
  Trade-off: `stake_deposited` semantics mudam (passa a representar "remaining stake to vest"). Documentar.

  **Opção B (mais robusta — track partial separately):** Adicionar `member.last_partial_release_amount: u64` e ajustar:
  ```rust
  let delta_target_raw = releasable_delta(...)?;
  let delta_target = delta_target_raw.saturating_sub(member.last_partial_release_amount);
  let delta = delta_target.min(vault_amount);
  if delta == delta_target {
      member.last_released_checkpoint = args.checkpoint;
      member.last_partial_release_amount = 0;
  } else {
      member.last_partial_release_amount = member.last_partial_release_amount
          .checked_add(delta)?;
  }
  ```

  **Opção C (revert SEV-016):** Voltar ao behavior pré-fix (`require!(delta <= vault_amount)` reverte tx). Aceita o DoS em troca de safety. SEV-016 era Low; SEV-029 é High. Trade-off: DoS aceitável > overpay drenando outros members.

- **Riscos da remediação:** Opção A muda a semântica de `stake_deposited` que é usado em múltiplos lugares (D/C invariant via `collateral_remaining()`, settle_default cap calculation). Auditar TODOS os call sites de `stake_deposited` antes de aplicar.

- **Esforço estimado:** S (Opção A) ou M (Opção B) ou XS (Opção C — revert).

---

### [SEV-030] SEV-027 cooldown cobre apenas SCHEMA_PAYMENT — admin pode grief via SCHEMA_LATE / DEFAULT

- **Severidade:** **Low** (admin trust assumption holds; mas é um partial fix)
- **Dimensão:** Segurança / Arquitetura
- **Evidência:** `programs/roundfi-reputation/src/instructions/attest.rs:206-209`:
  ```rust
  if is_admin && args.schema_id == SCHEMA_PAYMENT {
      let elapsed = now.saturating_sub(profile.last_admin_attest_at);
      require!(elapsed >= MIN_ADMIN_ATTEST_COOLDOWN_SECS, ReputationError::CooldownActive);
  }
  ```
- **Descrição:** O fix da SEV-027 fecha apenas o caminho de score INFLATION (admin spammando SCHEMA_PAYMENT positivo). Mas admin pode usar SCHEMA_LATE (-100) ou SCHEMA_DEFAULT (-500) para destruir score de qualquer subject sem cooldown. SCHEMA_DEFAULT também triggers level demotion (via SEV-007 fix) — admin compromissado pode forçar Veteran → Iniciante de qualquer wallet em uma sequência de attests com nonces diferentes.

  Cada attestation custa ~rent de Attestation PDA (~250 bytes = ~0.0017 SOL). Para destruir 10K score points: 100 attests = 0.17 SOL. Trivial.

- **Impacto:** Em Phase 3 B2B context, admin compromissed pode arbitrariamente destruir reputation de qualquer wallet. Affecta:
  - Subscription value para B2B subscribers (eles pagam por dados que podem ter sido manipulados)
  - Trust premium do protocolo

  Pre-Phase 3 (apenas Phase 1 ROSCA), o impacto é limitado a:
  - Defaulter status falso → defaulter blocked from join_pool em pools que requerem nivel mínimo (não há tal check hoje, mas é uma feature provável)
  - Stake_bps mais alto na próxima `join_pool` → atacante grief member com custo maior

- **Recomendação:** Estender o cooldown a TODOS os admin-issued schemas:
  ```rust
  // Adevar Labs SEV-030 — cooldown extends to all admin-issued schemas
  if is_admin {
      let elapsed = now.saturating_sub(profile.last_admin_attest_at);
      require!(elapsed >= MIN_ADMIN_ATTEST_COOLDOWN_SECS, ReputationError::CooldownActive);
  }
  ```
  Considerar separar `last_admin_attest_at` em `last_admin_positive_at` e `last_admin_negative_at` se tunings diferentes forem necessários.

- **Esforço estimado:** XS (1 linha — remover o `&& args.schema_id == SCHEMA_PAYMENT`).

---

### [SEV-031] SEV-025 fix é parcial — create_pool ainda aceita pools customizados inviáveis

- **Severidade:** **Low**
- **Dimensão:** UX / Qualidade de Código
- **Evidência:**
  - `programs/roundfi-core/src/constants.rs:99` — defaults atualizados (416 → 600)
  - `programs/roundfi-core/src/instructions/create_pool.rs:90-117` — sem check de solvency runtime
- **Descrição:** O fix muda os DEFAULTS de tal forma que `with_defaults()` produz uma pool viável. Mas qualquer caller que passa parâmetros customizados a `create_pool` pode criar uma pool onde `pool_amt × members_target < credit_amount`. Essa pool fica stuck na primeira `claim_payout` com `WaterfallUnderflow` para sempre — toda contribuição feita fica em escrow_vault sem possibilidade de payout (até `close_pool`, que requer `Completed`, que requer todas as 24 cycles concluídas, que requer claim_payouts que não rodam... deadlock).

  Pool authority não consegue recuperar fundos exceto via `close_pool` se status==Completed (que nunca acontece para pool stuck). Settle_default funciona mas não desbloqueia o pool.

- **Impacto:** Member contributions stuck. Não é fund-theft (atacante não rouba); é fund-lock (members perdem acesso até close path).

- **Recomendação:** Adicionar check em `create_pool::handler`:
  ```rust
  // Adevar Labs SEV-031 — pool solvency invariant at create time.
  // Without this check, a pool with mis-tuned (installment, members,
  // credit, escrow_release_bps, solidarity_bps) can be created where
  // cycle-0 pool_float < credit, leading to permanent claim_payout
  // failure (WaterfallUnderflow). The pool gets stuck — close_pool
  // requires status == Completed, but cycles never advance.
  let solidarity_amt = (args.installment_amount as u128) * (SOLIDARITY_BPS as u128) / (MAX_BPS as u128);
  let escrow_amt = (args.installment_amount as u128) * (args.escrow_release_bps as u128) / (MAX_BPS as u128);
  let pool_amt_per_inst = (args.installment_amount as u128)
      .checked_sub(solidarity_amt + escrow_amt)
      .ok_or(error!(RoundfiError::InvalidPoolParams))?;
  let cycle0_pool_collection = pool_amt_per_inst * (args.members_target as u128);
  require!(
      cycle0_pool_collection >= args.credit_amount as u128,
      RoundfiError::InvalidPoolParams,
  );
  ```

- **Esforço estimado:** XS.

---

### [SEV-032] ReputationConfig zerou padding após SEV-021 — extensões futuras requerem realloc/migration

- **Severidade:** **Informational**
- **Dimensão:** Manutenibilidade / DevOps
- **Evidência:** `programs/roundfi-reputation/src/state/config.rs:57` — `pub _padding: [u8; 0],` (era `[u8; 30]`)
- **Descrição:** Os 30 bytes de padding originais foram inteiramente consumidos pelo SEV-021 fix (Pubkey 32 + i64 8 = 40 bytes). LEN cresceu de 160 para 170 bytes. Toda extensão futura ao ReputationConfig agora exige:
  - Account migration (re-init do PDA, perdendo state)
  - Anchor `realloc` constraint (tx-by-tx grow)
  - Storing extension data em PDA separado

  O comentário do estado documenta isso ("Pre-PR devnet `ReputationConfig` accounts need re-init since Anchor sizes accounts at create time").
- **Impacto:** Inflexibilidade futura. Não afeta segurança ou funcionalidade atual. Próximo audit field add custaria mais effort.
- **Recomendação:** Para o próximo schema bump, considerar adicionar 32+ bytes de padding profilatic. Ou, melhor, mover features auxiliares (como o pending authority rotation) para um PDA separado se o padding orçamento crítico-se.
- **Esforço estimado:** N/A (preventivo).

---

### [SEV-033] Webhook auth fail-open quando HELIUS_WEBHOOK_SECRET unset — produção pode bypass acidental

- **Severidade:** **Informational** (cobre a SEV-009 mas com footgun residual)
- **Dimensão:** DevOps / Segurança
- **Evidência:** `services/indexer/src/server.ts` — `if (expected) { ... }` (auth aplicado apenas quando env var setada); startup warning quando unset.
- **Descrição:** Defensive choice da equipe: quando `HELIUS_WEBHOOK_SECRET` está unset, auth é bypassed. Isso é "frictionless local-dev loop". Mas produção deploys sem o env var têm webhook aberto. Startup warning está visível MAS:
  - Container logs frequentemente são ignorados em dashboards
  - Operator pode não ver até auditoria quarterly
- **Impacto:** Mesmo risk do SEV-009 original se ops setup falhar. Mitigado por warning + documentação.
- **Recomendação:** Adicionar env var `INDEXER_REQUIRE_AUTH=true` (default) que faz a aplicação rejeitar boot se `HELIUS_WEBHOOK_SECRET` unset. Devs locais setam `INDEXER_REQUIRE_AUTH=false` explicitamente para o dev loop:
  ```ts
  if (!process.env.HELIUS_WEBHOOK_SECRET) {
      if (process.env.INDEXER_REQUIRE_AUTH !== "false") {
          throw new Error("HELIUS_WEBHOOK_SECRET required (set INDEXER_REQUIRE_AUTH=false to bypass for local dev)");
      }
      app.log.warn("...auth disabled (INDEXER_REQUIRE_AUTH=false)...");
  }
  ```
- **Esforço estimado:** XS.

---

## Achados ainda OPEN após Pass 4

| ID | Severidade | Status |
|----|-----------|--------|
| **SEV-029** | **High** | **NOVO — REGRESSÃO SEV-016** — overpay determinístico em release_escrow partial path |
| **SEV-030** | Low | NOVO — SEV-027 cooldown não cobre SCHEMA_LATE / SCHEMA_DEFAULT |
| **SEV-031** | Low | NOVO — SEV-025 sem runtime check em create_pool |
| **SEV-032** | Info | NOVO — ReputationConfig sem padding restante |
| **SEV-033** | Info | NOVO — Webhook auth fail-open quando env unset |
| SEV-012 | Medium | OPEN — bankrun no CI (blocker upstream documentado) |
| SEV-018 | Info | OPEN por design (settle_default bypass core pause) |
| SEV-026 | Low | OPEN — cascade duplication (declared deferred to Fase 5) |

---

## Score Atualizado

| Dimensão | Pass 1 | Pass 3 (correto) | **Pass 4 (atual)** | Δ |
|----------|--------|------------------|--------------------|----|
| Arquitetura & Design | 7 | 7.5 | **7.5** | sem mudança |
| Qualidade de Código | 8 | 8.5 | **8.5** | sem mudança |
| Segurança | 3 | 7 | **5.5** | **↓1.5 — SEV-029 é High; +SEV-030/031 partials** |
| Performance | 7 | 7 | **7** | sem mudança |
| Testes & QA | 6 | 6.5 | **5.5** | ↓1 — fixes shipped sem testes negativos para SEV-016/SEV-027 |
| DevOps / CI | 6 | 7 | **7** | sem mudança |
| Documentação | 9 | 9 | **9.5** | ↑0.5 — comentários in-code dos fixes são exemplares |
| **Score Final** | **6.5/10** | **7.5/10** | **7.0/10** | -0.5 |

---

## Avaliação da Resposta da Equipe

A equipe RoundFinancial executou em qualidade técnica notável:

✅ **27/28 findings fechados** (96.4%) em ~36 horas, com PRs separadas + SEV-IDs em commit msgs.

✅ **Fixes elegantes** — SEV-022 (selective pause), SEV-007 (demote em SCHEMA_DEFAULT em vez de mudar join_pool), SEV-008 (verified_at_attest persistido em 1 byte).

✅ **Comentários in-code são exemplares** — cada fix carrega o threat model + before/after explicado.

❌ **Falta de testes negativos para os fixes:** Nem SEV-016 (release_escrow partial) nem SEV-027 (admin cooldown) têm testes que cobrem o caso patológico fixed. Resultado: SEV-029 (regressão SEV-016) não foi pegada por testes da própria equipe.

❌ **Fixes parciais sem trackers:** SEV-025 (defaults vs runtime), SEV-027 (PAYMENT vs LATE/DEFAULT) — ambos shipped como "fix" mas o código corrigido só fecha um lado da ameaça. Estes deveriam ter ficado como "partial fix — Track for Fase 5" no commit msg.

**Recomendações de processo:**

1. **Para todo fix de Critical/High:** exigir teste negativo no harness bankrun ANTES de merge. Fixes de Medium/Low: pelo menos um snapshot test ou property test.
2. **Para fixes parciais:** label commit msg como `fix(security, partial): ...` para que o tracker de auditoria saiba que o SEV-ID continua aberto parcialmente.
3. **Considerar uma "audit resolution review" interna:** antes de cada merge de PR de fix, um eng adicional revisa se o threat model está totalmente coberto, não só o cenário literal do report. SEV-029 (overpay regressão) é exemplo — a documentação do fix admite "the unreleased remainder vests on a future checkpoint" mas a math não enforce isso.

---

## Recomendação Operacional Atualizada

> **NÃO REMOVER o canary cap da mainnet** até que SEV-029 esteja corrigido + teste negativo coberto + property test sobre release_escrow conservation (sum of all releases per member ≤ stake_deposited).

> Para o canary atual (com TVL cap baixo), os fixes mergeados protegem o vault de fund-theft externo (SEV-001..005, SEV-021..022). SEV-029 é fund-leak interno bounded por TVL cap. Aceitável para canary com cap de $5–50 USD. Não aceitável para deployment full.

---

## Plano de Remediação (atualizado)

### Imediato (0-7 dias) — bloqueador para canary expansion

- **SEV-029:** Aplicar Opção C (revert SEV-016) ou Opção A (decrement stake_deposited on partial). Decisão da equipe — Opção C é mais segura mas reintroduz o DoS minor; Opção A precisa auditar todos call sites de `stake_deposited`. **Adicionar invariant test:**
  ```rust
  #[test]
  fn release_escrow_total_never_exceeds_stake() {
      // proptest: any sequence of (release_escrow with random vault sizes,
      // settle_defaults, contributions) — sum(member.received) <= member.stake_deposited_initial.
  }
  ```

### Curto prazo (1-2 semanas)

- **SEV-030:** Estender `MIN_ADMIN_ATTEST_COOLDOWN_SECS` a TODOS admin-issued schemas (1 linha).
- **SEV-031:** Adicionar runtime solvency check em `create_pool`. ~10 linhas.
- **SEV-033:** Fail-closed default para webhook auth.

### Backlog

- **SEV-026:** Refator cascade reuse (declared para Fase 5).
- **SEV-032:** Padding budget review na próxima extensão de ReputationConfig.
- **SEV-012:** Anchor 0.31+/Agave 2.x migration unblock bankrun no CI.

---

## Anexos

### Cobertura de leitura desta passada (arquivos novos do main)

- `programs/roundfi-core/src/instructions/propose_new_authority.rs` — 100%
- `programs/roundfi-core/src/instructions/cancel_new_authority.rs` — 100%
- `programs/roundfi-core/src/instructions/commit_new_authority.rs` — 100%
- `programs/roundfi-core/src/instructions/cancel_pending_listing.rs` — 100%
- `programs/roundfi-reputation/src/instructions/propose_new_reputation_authority.rs` — 100%
- `programs/roundfi-reputation/src/instructions/cancel_new_reputation_authority.rs` — 100%
- `programs/roundfi-reputation/src/instructions/commit_new_reputation_authority.rs` — 100%
- Re-leitura completa de TODOS os arquivos modificados pelos PRs #326..#339:
  - `release_escrow.rs` — encontrou SEV-029
  - `attest.rs` — encontrou SEV-030
  - `create_pool.rs` + `constants.rs` — encontrou SEV-031
  - `state/config.rs` (rep) — encontrou SEV-032
  - `server.ts` (indexer) — encontrou SEV-033

### Comandos executados

```bash
git fetch origin main                       # ANTES de qualquer leitura
git log --oneline origin/main..HEAD          # vazio: branch comportada
git log --oneline HEAD..origin/main          # mostrou 3 commits novos pós Pass 3
git merge origin/main --no-edit              # 18 files, +450 lines
# verifying each SEV-### in the new code:
grep -rn "Adevar Labs SEV-" programs/ --include="*.rs"
grep -rn "Adevar Labs SEV-" services/ --include="*.ts"
# tracing release_escrow partial logic
git show 664a8e1 -- programs/roundfi-core/src/instructions/release_escrow.rs
# tracing attest cooldown logic
git show 50db364 -- programs/roundfi-reputation/src/instructions/attest.rs
```

---

_Pass 4 fechado em 2026-05-15._
_— Adevar Labs._
