# Auditoria Técnica e de Segurança — RoundFinancial (Re-Audit Corrigido)
**Auditor:** Adevar Labs
**Data:** 2026-05-15
**Branch auditada agora:** `claude/web3-security-audit-2CA0r` após `git merge origin/main`
**HEAD efetivo:** `75a79f3` (merge de `e227d95` — main com 15 commits adicionais desde fbc931e)

---

## Correção de Erro Crítico — Reconhecimento

**A equipe RoundFinancial estava 100% correta.** A "segunda passada" anteriormente entregue (em `ADEVAR_AUDIT_REPORT_PASS_2.md`, commit `2bbc63e`) foi executada contra o snapshot `fbc931e` — o MESMO commit da primeira passada — e **NÃO** contra o `main` atual com 15 commits de fixes mergeados.

Procedimento que falhou: ao iniciar a re-auditoria, executei `git status` (que mostrou "branch up to date with origin") e procedi diretamente para a leitura dos arquivos no working tree. **Não fiz `git fetch origin main`** para verificar se o main remoto havia divergido. Como a branch `claude/web3-security-audit-2CA0r` estava forked de `fbc931e` (antes dos fixes da equipe), o working tree refletia o código vulnerável, e cada finding foi "re-confirmado" — quando na verdade os fixes existiam no main e eu não os tinha localmente.

Evidências da falha que a equipe corretamente apontou no próprio texto entregue:
1. Pass 2 cita `programs/roundfi-yield-kamino/src/lib.rs:564-566` como `UncheckedAccount` — mas o main atual tem `Account<'info, TokenAccount>` com constraint ATA (commit `3f7dfc3`).
2. Pass 2 cita `GRACE_PERIOD_SECS = 60` — mas o main tem `604_800` (commit `497700e`).
3. Pass 2 cita `harvest_yield.lp_share_bps` caller-controlled — mas o main lê de `config.lp_share_bps` (commit `c515a4a`).

**Os reports `ADEVAR_AUDIT_REPORT.md` e `ADEVAR_AUDIT_REPORT_PASS_2.md` continuam válidos como histórico do estado em `fbc931e`** — mas a leitura correta do main atual está abaixo.

---

## Estado real dos achados após o `main` atualizado

Re-verifiquei cada achado contra o `main` HEAD `e227d95` (após merge). Resultado:

### Fixed (16 achados resolvidos com PRs explícitos #325–#336)

| ID | Commit | Estado em `main` |
|----|--------|------------------|
| **SEV-001** Critical | `3f7dfc3` (#326) | ✅ **CORRIGIDO** — `c_token_account: Account<'info, TokenAccount>` com `associated_token::mint = kamino_reserve_collateral_mint, associated_token::authority = state` em ambos `Deposit` e `Harvest`. Fund-loss vector fechado. |
| **SEV-002** Critical | `497700e` (#327) | ✅ **CORRIGIDO** — `GRACE_PERIOD_SECS = 604_800` (7 dias). Test pinned to `604_800`. |
| **SEV-003** High | `c515a4a` (#329) | ✅ **CORRIGIDO** — Handler lê `config.lp_share_bps`, args do caller logado mas ignorado. Field movido para `ProtocolConfig`, mutável via `update_protocol_config`. |
| **SEV-004** High | `c515a4a` (#329) | ✅ **CORRIGIDO** — `pool.vaults_initialized: bool` flag, `require!(!pool.vaults_initialized, VaultsAlreadyInitialized)` no entrypoint. |
| **SEV-005** High | `c515a4a` (#329) | ✅ **CORRIGIDO** — `pool.status = PoolStatus::Closed` set no handler. Novo enum variant `Closed = 4`. Repetição de close_pool rejeitada por `PoolNotCompleted`. |
| **SEV-006** Medium | `986b306` (#331) | ✅ **CORRIGIDO** — `propose_new_treasury` agora recebe `Account<TokenAccount>` constrained ao USDC mint via `address = config.usdc_mint`. |
| **SEV-007** Medium | `2808a3b` (#332) | ✅ **CORRIGIDO** — `SCHEMA_DEFAULT` arm em attest re-deriva level via `resolve_level(post_delta_score)` e clamps em `LEVEL_MIN`. Demotion ativo. |
| **SEV-008** Medium | `2808a3b` (#332) | ✅ **CORRIGIDO** — `Attestation.verified_at_attest: bool` armazenado no PDA; `revoke` usa esse valor em vez de `is_verified(now)`. Score-reversal exato. |
| **SEV-009** Medium | `86c48f0` (#330) | ✅ **CORRIGIDO** — Bearer-token check contra `HELIUS_WEBHOOK_SECRET` env var; startup warning quando unset. |
| **SEV-010** Medium | `86c48f0` (#330) | ✅ **CORRIGIDO** — `.env.example` agora `B2B_API_KEY_SALT=` (vazio) com comentário "≥32 random bytes hex-encoded". |
| **SEV-011** Medium | `1b85111` (#333) | ✅ **CORRIGIDO** — `cargo audit --deny warnings` com `--ignore RUSTSEC-...` específicos. Sem `|| true`. Required gate. |
| **SEV-013** Low | `86c48f0` (#330) | ✅ **CORRIGIDO** — `require!(args.salt != 0, SaltMustBeNonZero)` em `escape_valve_list_reveal`. Novo error variant. |
| **SEV-014** Low | `e227d95` (#336) | ✅ **CORRIGIDO** — `PREFIX_CLAIM` atualizado de `"claim_payout"` para `"payout"` para alinhar com o que o programa realmente emite. Schema e parser sincronizados. |
| **SEV-015** Low | `a4a44aa` (#335) | ✅ **CORRIGIDO** — `cancel_pending_listing.rs` adicionado; seller-only abort de listings `Pending`. |
| **SEV-016** Low | `664a8e1` (#334) | ✅ **CORRIGIDO** — `release_escrow` agora caps em `min(delta_target, vault_amount)`, log warn quando partial, não avança `last_released_checkpoint` em partial pay. |
| **SEV-017** Info | `664a8e1` (#334) | ✅ **CORRIGIDO (doc-only)** — `sdk/src/actions.ts` JSDoc para `JoinPoolArgs.nftAsset` expandido com a regra "always generate fresh keypair". |

Bônus além dos meus findings:
- `93fb774` (#323) — **Timelocked authority rotation for `roundfi-core`** (`propose_new_authority` / `commit_new_authority` / `cancel_new_authority`, 7-day timelock mirror of treasury rotation). Esta PR fecha um gap análogo ao SEV-021 mas só do lado de core, não de reputation.

### Re-classificações (não eram "fixes" porque eram Informational/operacional)

| ID | Status |
|----|--------|
| **SEV-018** Info | Não-fix — design intent preservado (settle_default bypass de pause core continua intencional). Comentário ainda visível em `settle_default.rs:51-54`. |
| **SEV-019** Info | `234f9f1` (#328) — docs/security updates merged. |
| **SEV-020** Info | `234f9f1` (#328) — op-guard documentation around `lock_approved_yield_adapter`. |

---

## Achados ainda OPEN (não corrigidos no main)

### Da primeira passada

| ID | Severidade | Status em `main` |
|----|-----------|------------------|
| **SEV-012** | Medium | ❌ **NÃO CORRIGIDO** — bankrun ainda não roda no CI. Dependência da Anchor 0.31+/Agave 2.x migration. Comentário em ci.yml mantém: "`pnpm test:bankrun` is deliberately NOT run here yet." Aceitável dado o blocker upstream documentado. |

### Da segunda passada (que eu detectei contra o snapshot antigo, mas que continuam relevantes contra o main)

Re-verifiquei estas contra o código atual; sem fix mergeado:

| ID | Severidade | Status em `main` |
|----|-----------|------------------|
| **SEV-021** | High | ❌ **NÃO CORRIGIDO** — `roundfi-reputation::update_reputation_config` ainda permite `if let Some(a) = args.new_authority { cfg.authority = a; }` em uma única transação. PR #323 (commit `93fb774`) adicionou o timelock análogo APENAS para core authority, não para reputation. Assimetria continua: core tem 7-day propose/commit + opcional lock; reputation tem rotação imediata. |
| **SEV-022** | High | ❌ **NÃO CORRIGIDO** — `roundfi-core::settle_default` (linha 318-319 atual) ainda condiciona `if config.reputation_program != Pubkey::default() { ... invoke_attest(...) }` sem catch-and-continue. Reputation pause via `update_reputation_config(paused = true)` ainda halta settle_default / contribute / claim_payout. A propriedade documentada de core ("funds must never be locked indefinitely") permanece quebrável por reputation pause. |
| **SEV-023** | Medium | ❌ **NÃO CORRIGIDO** — `MIN_CYCLE_DURATION = 60` (devnet test-friendly) ainda em `constants.rs`. Não é blocker em si para mainnet, mas combinado com cenários patológicos vira ataque. |
| **SEV-024** | Medium | ❌ **NÃO CORRIGIDO** — `update_protocol_config` ainda permite `new_fee_bps_yield <= MAX_BPS = 10_000` (100% fee). Sem timelock. Authority compromised pode redirecionar 100% do yield para treasury em 1 tx. |
| **SEV-025** | Low | ❌ **NÃO CORRIGIDO** — `create_pool` não validates `cycle0_pool_collection >= credit_amount`. Default constants ainda formam pool inviável. |
| **SEV-026** | Low | ❌ **NÃO CORRIGIDO** — `settle_default` ainda duplica cascade logic inline em vez de chamar `roundfi_math::seize_for_default`. Drift risk continua. |
| **SEV-027** | Low | ❌ **NÃO CORRIGIDO** — Só `SCHEMA_CYCLE_COMPLETE` tem cooldown em `attest`. SCHEMA_PAYMENT continua sem rate-limit. |
| **SEV-028** | Low | ❌ **NÃO CORRIGIDO** — `refresh_identity` ainda coerciza `Err(_)` → `IdentityStatus::Revoked`. |

---

## Score Atualizado contra `main` Real

| Dimensão | Pass 1 (fbc931e) | Pass 2 ERRADO (também fbc931e) | **Pass 3 CORRETO (main atual)** |
|----------|------------------|--------------------------------|--------------------------------|
| Arquitetura & Design | 7 | 6.5 | **7.5** ↑ (TVL counter, state-machine close, treasury USDC validation, level demotion alinha com docs) |
| Qualidade de Código | 8 | 8 | **8.5** ↑ (decoder synced, partial-pay graceful, doc improvements) |
| Segurança | 3 | 2.5 | **7** ↑↑ (16 fixes Critical/High/Medium/Low; SEV-001 + SEV-002 + SEV-003 + SEV-004 + SEV-005 todos fechados; cargo audit gate required) |
| Performance & Escalabilidade | 7 | 7 | **7** |
| Testes & QA | 6 | 6 | **6.5** ↑ (audit gate flipped from advisory) |
| DevOps / CI | 6 | 6 | **7** ↑ (cargo audit required, --deny warnings + targeted ignores) |
| Documentação | 9 | 9 | **9** |
| **Score Final** | **6.5/10** | 6.0 (errado) | **7.5/10** |

**Mudança de recomendação:** A primeira passada concluiu "NÃO DEPLOY em mainnet" pelos achados Critical SEV-001 e SEV-002. **Ambos estão fechados.** As 3 High que bloqueariam (SEV-003/004/005) também estão fechadas. A recomendação atualizada é:

> **DEPLOY EM CANARY MAINNET COM RESSALVAS.** Os 5 bloqueadores principais (SEV-001..SEV-005) estão remediados. As remanescentes SEV-021 e SEV-022 (High, mas operacionais e dependem de compromise de chave) devem ser fechadas antes da remoção do canary cap. As Medium/Low remanescentes não bloqueiam canary mas devem fechar antes da remoção do TVL cap geral.

---

## Achados ainda abertos — Plano de Remediação Atualizado

### Fase 1 — Antes da remoção do canary cap (próximas 2-4 semanas)

1. **SEV-021 (High):** Adicionar `propose_new_reputation_authority` / `commit_new_reputation_authority` / `cancel` no `roundfi-reputation`, espelhando o pattern do core (PR #323). Idealmente também `lock_reputation_authority`. Mover `new_authority` para fora de `update_reputation_config`.
2. **SEV-022 (High):** Escolher arquitetura:
   - **Opção A:** Refatorar `settle_default` (e opcionalmente `claim_payout`) para tratar `invoke_attest` falha como warning, não revert. Documentar trade-off.
   - **Opção B:** Adicionar timelock + lock-flag ao `paused` flag de reputation, igualando a proteção do treasury.
   - **Opção C:** Emit-only attestation flow — core emite evento, keeper relays. Idealmente arquiteturalmente, mas requer mais esforço (M-L).

### Fase 2 — Antes da remoção do TVL cap geral

3. **SEV-023:** Bumping `MIN_CYCLE_DURATION` para 86_400 (1 day) ou 604_800 (7 days). Devnet pode opt-in via feature flag se necessário.
4. **SEV-024:** Cap em `fee_bps_yield <= 5_000` (50%) no `update_protocol_config`. Considerar timelock generalizado para campos policy-econômicos.
5. **SEV-025:** Adicionar `require!(pool_amt * members_target as u64 >= credit_amount, InvalidPoolParams)` em `create_pool`. Update `with_defaults()` para gerar pool viável.

### Fase 3 — Backlog / maturidade

6. **SEV-026:** Refator `settle_default` para chamar `roundfi_math::seize_for_default`.
7. **SEV-027:** Cooldown em `SCHEMA_PAYMENT` (e.g., `MIN_PAYMENT_COOLDOWN_SECS = 86_400`).
8. **SEV-028:** Distinguir erro estrutural de revogação real em `refresh_identity`.
9. **SEV-012:** Migrar para Anchor 0.31+/Agave 2.x para liberar bankrun no CI.

---

## Observações Adicionais

**Qualidade das remediações:** Os 16 fixes mergeados são, em geral, **excelentes**:
- Cada commit referencia explicitamente o SEV-ID que fecha — rastreabilidade perfeita.
- Comentários in-code explicam o threat model + before/after.
- Fixes mínimos e cirúrgicos; nenhum adicionou superfície de ataque nova que pude detectar nessa terceira passada.
- O fix de SEV-001 é exatamente o ATA constraint que recomendei (4 linhas).
- O fix de SEV-007 inclui a re-derivação de level em SCHEMA_DEFAULT (uma escolha melhor do que apenas mudar o ler de score em join_pool — fecha o caminho mais cedo).
- O fix de SEV-008 usa o campo persistente `verified_at_attest` na `Attestation` PDA (consumindo 1 byte do padding), uma solução elegante que evita re-computar verification status retroativamente.

**Sugestões de processo:**
1. Considerar squash de commits de fix por SEV-ID em PRs separadas para auditabilidade granular — algo que a equipe JÁ está fazendo (PRs #326-#336 cada uma com 1-3 SEV-IDs).
2. Manter o `Adevar Labs SEV-### fix:` comment header convention para todos os fixes — facilita re-auditoria.
3. Considerar uma "audit trail file" (e.g., `docs/security/audit-resolutions.md`) que liste cada SEV-ID, commit hash, PR, e teste que comprova o fix.

---

## Reconhecimento e Calibragem

A equipe RoundFinancial executou em ritmo notavelmente alto: 14 commits de fix mergeados em ~36 horas após o report inicial. **Esse responsiveness é raro** e merece ser destacado num relatório de auditoria — credibilidade da equipe é tão importante quanto qualidade do código.

Quanto ao meu erro: a falha de não rodar `git fetch origin main` antes do "re-audit" foi metodologicamente grave e custou a credibilidade do segundo report. **Mea culpa.** Em futuras passadas:
- Sempre validar `git log origin/main..HEAD` e `git log HEAD..origin/main` ANTES de começar leitura de arquivos.
- Confirmar o commit SHA auditado no preâmbulo do report e cross-checar contra o `main` upstream.
- Quando a equipe alega divergência, validar primeiro com `git fetch` antes de defender a leitura anterior.

---

_Re-audit corrigido em 2026-05-15._
_— Adevar Labs._
