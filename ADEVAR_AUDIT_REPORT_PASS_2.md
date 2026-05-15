# Auditoria Técnica e de Segurança — RoundFinancial (Segunda Passada)
**Auditor:** Adevar Labs
**Data:** 2026-05-15
**Commit auditado:** `fbc931e8c37a9a923cdcbba51f9d0e2d286a9b12`
**Branch:** `claude/web3-security-audit-2CA0r`
**Escopo:** Re-auditoria completa do mesmo commit, focada em (a) re-validar os achados SEV-001..SEV-020 da primeira passada, (b) buscar achados perdidos com leitura adicional dos arquivos `cascade.rs`, `bps.rs`, `update_reputation_config.rs`, `link_passport_identity.rs`, `refresh_identity.rs`, `unlink_identity.rs`, `get_profile.rs`, `state/profile.rs`, `state/identity.rs`, `state/attestation.rs`, `state/config.rs` (rep), scripts/mainnet, e fluxos de pool numéricos.

---

## Sumário Executivo

Re-validação de todos os 20 achados anteriores: **20/20 confirmados.** Detalhamento e PoC reforçados para SEV-001 (a vulnerabilidade crítica do `c_token_account` no adapter Kamino é mais grave do que a primeira passada relatou — combinada com permissionless `deposit_idle_to_yield`, é exploit one-shot).

A segunda passada identificou **8 achados adicionais** (SEV-021..SEV-028), dos quais dois são **High** com impacto operacional grave:

1. **SEV-021 (High):** `update_reputation_config` permite rotação de authority sem timelock — assimétrico com a rotação de treasury (que tem 7 dias). Compromisso da chave authority do reputation se torna IMEDIATAMENTE irreversível.
2. **SEV-022 (High):** Pausar o programa `roundfi-reputation` via `update_reputation_config(new_paused=true)` HALTA `contribute`, `claim_payout` e `settle_default` em **todos os pools de todos os authorities**, porque essas instruções fazem CPI obrigatório ao `attest`. Quebra a propriedade prometida por core ("settle_default never locks funds") porque settle_default depende do reputation CPI.

Os outros 6 achados (SEV-023..SEV-028) são Medium/Low/Informational mas relevantes para a maturidade do protocolo. Detalhes abaixo. **A recomendação geral permanece NÃO DEPLOY em mainnet** até que SEV-001..SEV-005 + SEV-021..SEV-022 estejam corrigidos.

A re-validação reforça que o projeto tem **boa engenharia em vários pontos** (D/C invariant fechado, fuzz coverage no `crates/math`, paridade Rust↔TS, treasury timelock, post-CPI verification em escape_valve_buy). Mas há um **buraco arquitetural cross-programa** entre core e reputation que não é coberto pelos timelocks/locks de core — e essa é a categoria de risco mais difícil de modelar pelos desenvolvedores que escreveram o código.

---

## Re-validação dos achados anteriores

Todos os 20 achados da primeira passada (SEV-001..SEV-020) foram re-verificados contra o código atual no commit `fbc931e8`. **Nenhum foi invalidado**. Atualizações materiais por achado:

### SEV-001 — re-confirmado com PoC mais detalhado

Confirmei via leitura linha-a-linha de:
- `programs/roundfi-yield-kamino/src/lib.rs:564-566` (`c_token_account: UncheckedAccount`)
- `programs/roundfi-yield-kamino/src/lib.rs:629-634` (constraint correta em `Harvest`)
- `programs/roundfi-core/src/instructions/deposit_idle_to_yield.rs:33` (caller permissionless)
- `programs/roundfi-core/src/instructions/deposit_idle_to_yield.rs:126-133` (remaining_accounts forward bruto)

Ataque end-to-end verificado:
1. Caller (qualquer signer) cria TokenAccount com `mint = state.kamino_reserve_collateral_mint`, `owner = attacker`.
2. Chama `deposit_idle_to_yield` com `remaining_accounts[6] = attacker_c_token`.
3. core valida `pool_usdc_vault.authority = pool` (✓), GF earmark (✓), `yield_adapter_program == pool.yield_adapter` (✓).
4. core inicializa metas: `source = pool_usdc_vault`, `destination = yield_vault (shadow)`, `authority = pool PDA`.
5. core appended remaining_accounts via plain copy. Nada valida `c_token_account.owner`.
6. core invoca adapter via `invoke_adapter("deposit", ix_data, ...)`.
7. adapter (Kamino variant) recebe accounts. `Deposit` struct valida `state`, `kamino_reserve`, `kamino_market`, `kamino_program` (via `address = ...`). Não valida `c_token_account`.
8. adapter Step 1 transfere `pool_usdc_vault → shadow_vault` (autorizado por pool PDA).
9. adapter Step 2 chama Kamino direto via `invoke_signed`, passando `c_token_account` como `user_destination_collateral`. Kamino mintira c-tokens para attacker.
10. attacker chama Kamino direto via `redeem_reserve_collateral` com sua c-token, recupera USDC.

Sem mitigação no fluxo atual. Severity confirmada como **Critical**.

### SEV-002..SEV-020 — re-confirmados sem mudança material

Re-leitura confirmou:
- SEV-002: `GRACE_PERIOD_SECS = 60` ainda no código. README linha 267 confirma que essa patch já é tratada como funcionalidade devnet ativa; nenhum mecanismo pre-flight em `scripts/mainnet/canary-flow.ts` valida o valor antes de mainnet deploy.
- SEV-003: `harvest_yield` caller-provided `lp_share_bps` confirmado em `harvest_yield.rs:43-49, 67-69, 154-156, 265`.
- SEV-004, SEV-005: TVL counter inconsistente confirmado.
- SEV-006: `propose_new_treasury` aceita `Pubkey` cru.
- SEV-007: `derive_trusted_reputation_level` em join_pool lê `profile.level.clamp(1, 3)` direto — não re-deriva de score. `promote_level` é monotonic-up. Confirmado.
- SEV-008..SEV-020: confirmados via re-leitura dos arquivos relevantes.

---

## Achados Novos (Segunda Passada)

### [SEV-021] update_reputation_config permite rotação de authority sem timelock — assimétrico com treasury

- **Severidade:** **High**
- **Dimensão:** Segurança / Arquitetura & Design
- **Evidência:**
  - `programs/roundfi-reputation/src/instructions/update_reputation_config.rs:14-19, 41-43`:
    ```rust
    pub struct UpdateReputationConfigArgs {
        pub new_authority:         Option<Pubkey>,
        ...
    }
    ...
    if let Some(a) = args.new_authority {
        cfg.authority = a;
    }
    ```
  - Comparar com `programs/roundfi-core/src/instructions/propose_new_treasury.rs` (7-dia timelock) + `lock_treasury` (one-way kill switch).
- **Descrição:** O `cfg.authority` do reputation pode ser rotacionado em uma única transação para qualquer Pubkey, sem timelock, sem validação, sem lock-flag. Comparado ao core's treasury rotation (`propose → 7d → commit` + `lock_treasury` permanente), esta é uma porta enormemente mais aberta para compromisso.
- **Impacto:** Se a `cfg.authority` do reputation for compromissed (multisig leak, chave roubada), o atacante:
  - Roda `update_reputation_config(new_authority = attacker)` → authority irreversivelmente attacker
  - Roda `update_reputation_config(new_passport_network = attacker_controlled)` → bridge attestations escopo-shifted
  - Roda `update_reputation_config(new_paused = true)` → halts CPI attest paths em todo o protocolo (ver SEV-022)
  - Issuer-admin attest paths: pode emitir SCHEMA_PAYMENT em massa, gratuitamente subindo wallets para L3
  - Combinado com SEV-007 (level não demota), o atacante cria wallets L3 que joinam pools com stake 10% e default

  O `roundfi_core_program` e `passport_attestation_authority` SÃO frozen na init (não mutáveis), mas a authority em si não tem proteção análoga à treasury.
- **Cenário de Ataque:** Multisig key leak → 1 transação rotaciona authority para attacker → todo o reputation system está sob controle do attacker, indefinidamente.
- **Recomendação:**
  - **Mirror do treasury rotation flow para reputation authority:**
    - Adicionar `propose_new_reputation_authority(new: Pubkey)` que armazena pending state + eta
    - Adicionar `commit_new_reputation_authority()` permissionless após eta
    - Adicionar `cancel_new_reputation_authority()` authority-only
    - Adicionar `lock_reputation_authority()` one-way kill switch
  - Como mitigação minimalista: aceitar o timelock cross-programa. O core e o reputation deveriam ter authority **a mesma multisig** com discoverability tooling (Squads ou similar) e rotação coordenada.
  - **Riscos de regressão:** mudar a interface de `update_reputation_config` quebra clients que usam o argumento `new_authority`. Idealmente, manter `update_reputation_config` para fields seguros (`paused`, `passport_network` — sob discussão se este último merece timelock também) e mover authority para o flow propose/commit.
- **Esforço estimado:** M.

---

### [SEV-022] reputation pause halts contribute / claim_payout / settle_default cross-protocol

- **Severidade:** **High**
- **Dimensão:** Segurança / Arquitetura & Design (cross-program)
- **Evidência:**
  - `programs/roundfi-reputation/src/instructions/update_reputation_config.rs:47-49` — `paused: bool` mutável por authority sem timelock
  - `programs/roundfi-reputation/src/instructions/attest.rs:56-58` — `constraint = !config.paused @ ReputationError::Unauthorized` no `Attest` struct
  - `programs/roundfi-core/src/instructions/contribute.rs:233, 262-282` — sempre faz `invoke_attest` quando `config.reputation_program != Pubkey::default()`
  - `programs/roundfi-core/src/instructions/claim_payout.rs:186-228` — mesmo padrão
  - `programs/roundfi-core/src/instructions/settle_default.rs:316-364` — mesmo padrão
  - `programs/roundfi-core/src/instructions/pause.rs` — Doc-string explicita: "Crucially, `settle_default` intentionally BYPASSES the pause flag (see its handler). A paused protocol must never create a path where funds can be locked indefinitely — defaults must still be settleable."
- **Descrição:** O `roundfi-core` foi projetado com o invariante "funds must never be locked indefinitely" — daí o bypass da pausa de core em `settle_default`. Mas esse invariante é **quebrado** pela dependência cross-programa: o `settle_default` (e `contribute` e `claim_payout`) fazem CPI obrigatório para `reputation::attest`, e essa CPI tem seu próprio guard `!config.paused`. Quando reputation está paused, todas as três instruções de core revertem.
- **Impacto:**
  - **Quebra de propriedade de safety crítica de core.** O autor do código documentou explicitamente que defaults devem ser settleable mesmo em pausa — mas o caminho atual permite que a reputation authority (sem timelock) pause o programa e instantaneamente bloqueie todos os flows core que mintam attestations. Inclui `settle_default`.
  - **Compromisso → DoS protocolo-wide em 1 tx.** Authority compromised → `update_reputation_config(paused = true)` → todos os pools de todos os authorities param de aceitar contributions, claim_payouts, settle_defaults. Stakes e contributions ficam congelados.
  - `release_escrow` e `escape_valve_*` ainda funcionam (não fazem attest CPI), então não é 100% fund-lock — usuários podem release escrow incrementalmente ou listar posições. Mas a função primária do pool é interrompida.
  - **Recuperação:** requer despausar reputation (1 tx pela reputation authority — but if authority compromised, attacker won't despausa). Sem path on-chain de recovery sem cooperação da authority compromised. Único caminho é redeploy do programa reputation com novo program-id e atualização do `config.reputation_program` em core via `update_protocol_config` — mas `config.reputation_program` está FROZEN em core (`update_protocol_config` não tem campo para mutá-lo). Resultado: PROTOCOLO PERMANENTEMENTE COMPROMETIDO sem upgrade do core program.
- **Cenário de Ataque:**
  1. Atacante compromete a multisig de reputation authority (ou phishing operacional, ou um único oficial errado).
  2. Roda 1 tx: `update_reputation_config(new_paused = Some(true))`.
  3. Imediatamente: nenhum membro pode contribuir, claim_payout, ou settle_default em nenhum pool do protocolo.
  4. Atacante negocia ransom com Adevar (recovery requires authority cooperation).
  5. Alternativa: atacante adiciona `update_reputation_config(new_authority = irrecoverable_random_key)` para destruir a authority.
- **Componentes Afetados:**
  - `roundfi-reputation`: `update_reputation_config`, `attest`
  - `roundfi-core`: `contribute`, `claim_payout`, `settle_default`
- **Recomendação:**
  - **Crítico:** Adicionar bypass-on-CPI-failure para o reputation attest dentro de core:
    ```rust
    // In settle_default.rs (apenas para esta ix, NÃO para contribute):
    match invoke_attest(...) {
        Ok(_) => msg!("attest emitted"),
        Err(e) => msg!("attest CPI failed, proceeding: {:?}", e),
    }
    ```
    Isso é uma escolha de design — se aceitar que defaults podem ocorrer sem attestation, então settle_default vira best-effort. Aceitável: a attestation é importante para reputation accuracy, mas a settle_default é importante para solvência. Solvência > accuracy. Documentar claramente.
  - **Melhor:** Refatorar de forma que core não dependa de reputation CPI para liveness. Idealmente, **emit-only**: core emite um evento `DefaultEmitted` que indexers/keepers pegam e CPI-relayed para reputation. Reputation pausa não bloqueia core.
  - **Mitigação parcial:** Adicionar timelock + lock-flag ao reputation pause (mirror do core pause não-existência de timelock, mas para o efeito cross-program, o impacto justifica).
  - **Riscos de regressão:** alterar o flow de attestation em settle_default precisa garantir que reputation profile state (e.g. `defaults` counter) está correto eventualmente. Considerar adicionar uma instrução `attest_retro(member, schema)` que keeper pode chamar quando reputation despausa, para "catching up" attestations perdidas.
- **Esforço estimado:** M-L.

---

### [SEV-023] MIN_CYCLE_DURATION = 60s — companheiro de SEV-002 (devnet-friendly)

- **Severidade:** **Medium**
- **Dimensão:** DevOps / Arquitetura
- **Evidência:** `programs/roundfi-core/src/constants.rs:91`:
  ```rust
  pub const MIN_CYCLE_DURATION: i64 = 60;   // 1 min — devnet test-friendly
  ```
- **Descrição:** Cycle duration mínimo é 60 segundos. Um pool pode ser criado com cycle_duration = 60s. Combinado com o whitepaper-intended cycle_duration = 30 dias (2_592_000s), 60s é 43_200× mais rápido. Não é fund-loss diretamente, mas:
  - Pool com cycle_duration = 60s e 24 cycles termina em 24 minutos. Membros têm 60s entre cycle para pagar.
  - Combinado com SEV-002 (grace = 60s), defaults são gatilhados 60s após cycle ends.
  - Combinado com cycle = 60s, um membro tem 60s para pagar AND mais 60s antes de ser defaultado. Total 120s para reagir, ou perde stake.
- **Impacto:** Pool com configurações "devnet-like" em mainnet → defaults em massa por timing. Pool authority malicioso pode criar pool com cycle=60s para extrair stakes via SEV-002 grace.
- **Recomendação:**
  - Bumping `MIN_CYCLE_DURATION` para 86_400 (1 day) ou 604_800 (7 days). Devnet pode opt-in via feature flag.
  - Combinar com SEV-002 fix.
- **Esforço estimado:** XS.

---

### [SEV-024] fee_bps_yield permite 100% — config update sem timelock pode zerar payouts

- **Severidade:** **Medium**
- **Dimensão:** Segurança / Arquitetura
- **Evidência:**
  - `programs/roundfi-core/src/instructions/update_protocol_config.rs:67-70` — `require!(bps <= MAX_BPS, ...)` (MAX_BPS=10_000=100%)
  - `programs/roundfi-core/src/instructions/harvest_yield.rs:264` — usa direto
- **Descrição:** O `fee_bps_yield` pode ser setado para 10_000 (100%) via `update_protocol_config`. Após, todo yield realizado vai para o treasury. Combinado com a falta de timelock em `update_protocol_config`, uma authority compromised pode bombear yield para treasury imediatamente — depois (se o atacante consegue 7 dias de timelock + rotacionar treasury) extrair.
- **Impacto:** Yield zerado para participants. LP earmark zerado. Mas o yield ainda fica no protocolo (treasury é controlled pelo multisig). Se treasury timelock funciona, o yield fica "limbo" até resolução.
- **Recomendação:**
  - Adicionar cap razoável em `fee_bps_yield`: 5_000 bps (50%) ou 3_000 bps (30%).
  - Considerar timelock em `update_protocol_config` para campos sensíveis (fee_bps_*, guarantee_fund_bps).
- **Esforço estimado:** XS-S.

---

### [SEV-025] Default constants formam uma pool inviável (pool float < credit em cycle 0)

- **Severidade:** **Low** (configuração; default rejeita por `WaterfallUnderflow`, não é fund-loss)
- **Dimensão:** Arquitetura / Qualidade de Código
- **Evidência:**
  - `programs/roundfi-core/src/constants.rs`:
    - `DEFAULT_INSTALLMENT_AMOUNT = 416_000_000` (416 USDC)
    - `DEFAULT_CREDIT_AMOUNT = 10_000_000_000` (10K USDC)
    - `DEFAULT_MEMBERS_TARGET = 24`
    - `DEFAULT_ESCROW_RELEASE_BPS = 2_500` (25%)
    - `SOLIDARITY_BPS = 100` (1%)
  - `programs/roundfi-core/src/instructions/claim_payout.rs:122-131`:
    ```rust
    let spendable = pool_usdc_vault.amount.saturating_sub(pool.guarantee_fund_balance);
    require!(spendable >= pool.credit_amount, RoundfiError::WaterfallUnderflow);
    ```
- **Descrição:** Math do pool default:
  - Per contribution: solidarity = 4.16, escrow_deposit = 104, pool_float = 307.84 (USDC)
  - Cycle 0 collection: 24 × 307.84 = 7388.16 USDC em `pool_usdc_vault`
  - credit_amount: 10_000 USDC
  - `spendable = 7388.16 - guarantee_fund(0) = 7388.16 < 10000` → **WaterfallUnderflow**

  A pool default com defaults é **inviável** — cycle-0 claim_payout sempre falha. Comparar com `tests/lifecycle.spec.ts:84-103` que escolhe params customizados explicitamente para evitar isso ("Pool parameters deliberately chosen so that pool_float_per_cycle = 4 × 925 USDC = 3700 USDC ≥ credit 3500 USDC").
- **Impacto:** UX degradado para deployers que usam os defaults. Pool fica em Active mas claim_payout permanece bloqueado até intervenção (cycle 1+ injects mais 7388 USDC, total 14_776 — agora `spendable >= 10_000`, e claim cycle 0 acontece DEPOIS de cycle 1's contributions... mas wait, `args.cycle == pool.current_cycle` força a sincronização cycle×slot, então não pode atrasar claim para cycle 1).
- **Cenário concreto:** Deployer testa pool com `CreatePoolArgs::with_defaults`. Pool ativa. Membros contribuem cycle 0. Slot 0 tenta `claim_payout(0)` → WaterfallUnderflow. Pool stuck.
- **Recomendação:**
  - Adicionar uma validation em `create_pool`:
    ```rust
    let solidarity_amt = installment * solidarity_bps / 10_000;
    let escrow_deposit = installment * escrow_release_bps / 10_000;
    let pool_amt = installment - solidarity_amt - escrow_deposit;
    let cycle0_pool_collection = pool_amt * members_target as u64;
    require!(cycle0_pool_collection >= credit_amount, RoundfiError::InvalidPoolParams);
    ```
  - Atualizar constants para defaults que funcionam (e.g. `credit = 7000` ou `installment = 540` ou `escrow_release_bps = 1500`).
  - Adicionar test que valida a `with_defaults` pool produz claims válidos.
- **Esforço estimado:** XS.

---

### [SEV-026] settle_default duplica logica de cascade — drift risk vs crates/math/src/cascade.rs

- **Severidade:** **Low** (drift hoje seria caught pelos parity tests, mas custo cognitivo é real)
- **Dimensão:** Qualidade de Código / Arquitetura
- **Evidência:**
  - `programs/roundfi-core/src/instructions/settle_default.rs:184-272` — implementação inline do cascade
  - `crates/math/src/cascade.rs:42-58` — `seize_for_default(CascadeInputs) -> CascadeOutcome` testado exaustivamente
- **Descrição:** O handler `settle_default` reimplementa a cascade seize logic em vez de chamar o helper testado. Os dois caminhos ATÉ HOJE convergem (verificado linha-a-linha), mas qualquer refactor futuro tem risco de drift.
- **Impacto:** Maintainability + drift risk. Sem impacto de segurança hoje.
- **Recomendação:** Refatorar `settle_default::handler` para chamar `seize_for_default`:
  ```rust
  let outcome = roundfi_math::seize_for_default(CascadeInputs {
      d_init: d_initial,
      d_rem: d_remaining,
      c_init: c_initial,
      c_before: c_before,
      missed,
      solidarity_available,
      escrow_cap: member.escrow_balance.min(escrow_vault_amount),
      stake_cap: member.stake_deposited.min(escrow_vault_amount.saturating_sub(/* prev */)),
  })?;
  // Execute the three transfers based on outcome.from_*
  ```
- **Esforço estimado:** S.

---

### [SEV-027] SCHEMA_PAYMENT não tem cooldown — admin attest pode bombar score arbitrariamente

- **Severidade:** **Low** (assume trusted admin)
- **Dimensão:** Segurança / Arquitetura
- **Evidência:**
  - `programs/roundfi-reputation/src/instructions/attest.rs:164-167` — cooldown só para `SCHEMA_CYCLE_COMPLETE`
  - `programs/roundfi-reputation/src/instructions/attest.rs:178-184` — SCHEMA_PAYMENT aplica `+10` (verified) ou `+5` (unverified) sem cooldown
- **Descrição:** Só `SCHEMA_CYCLE_COMPLETE` tem cooldown anti-spam. `SCHEMA_PAYMENT` (10 pontos cada) não tem. Um admin attest path pode emitir 200 PAYMENTS em sequência, levando uma wallet de score 0 → 2000 (L3) em 200 transações.
- **Impacto:** Se admin compromised, level inflation. Combinado com SEV-021 (no timelock em authority rotation), this is one-step compromise → L3 wallet army → join pools at 10% stake.
- **Recomendação:**
  - Adicionar cooldown per-subject-per-schema para SCHEMA_PAYMENT também:
    ```rust
    if args.schema_id == SCHEMA_PAYMENT {
        let elapsed = now.saturating_sub(profile.last_payment_at);
        require!(elapsed >= MIN_PAYMENT_COOLDOWN_SECS, ReputationError::CooldownActive);
    }
    ```
  - Adicionar campo `last_payment_at` ao `ReputationProfile`.
  - Tradeoff: real pool contribute fires PAYMENT once per cycle (cycle = 30d typically), so a cooldown of 1 day or even 6h não impede flow legítimo, mas bloqueia attack.
- **Esforço estimado:** S.

---

### [SEV-028] refresh_identity engolha structural errors silenciosamente

- **Severidade:** **Low**
- **Dimensão:** Qualidade de Código / Operacional
- **Evidência:** `programs/roundfi-reputation/src/instructions/refresh_identity.rs:81-89`:
  ```rust
  Err(_) => {
      // Structural failure (e.g. bridge service revoked the
      // attestation or its layout changed). Mark Revoked
      // conservatively rather than propagating the error
      rec.status = IdentityStatus::Revoked as u8;
  }
  ```
- **Descrição:** Quando `validate_passport_attestation` falha estruturalmente (e.g., bridge mudou o layout, conta foi fechada, mint mismatch), o handler marca status=Revoked e continua. Comentário documenta que isto é intencional ("we don't want a torn state where an indexer can never reach the failure path"). Mas:
  - Uma mudança de layout do bridge service NÃO necessariamente significa que o usuário foi revogado.
  - Um bug no bridge → mass-revoke silencioso (todos os subjects que executam `refresh_identity` no período do bug).
  - Em escala (Phase 3 B2B), isto pode causar consultas a um "identity status" que reflete um bug operacional como "revogação real".
- **Impacto:** Falsos negativos em verificação de identity. Score unverified weight (1/2) aplicado quando deveria ser verified (2/2). Não é fund-loss; degradação econômica.
- **Recomendação:**
  - Diferenciar entre erro estrutural (layout / dados inválidos) e revogação real (state byte == REVOKED). Hoje os dois colapsam em Revoked.
  - Aceitar erro estrutural como soft-fail: deixar status anterior, log warning, retornar Ok.
  - Adicionar um log estruturado quando o caminho de fallback dispara, e instrumentar o indexer para detectar bursts.
- **Esforço estimado:** XS.

---

## Atualizações ao Score Geral

Considerando os novos achados High (SEV-021, SEV-022), a nota de Segurança cai de 3 → **2.5**, e o score final cai de 6.5 → **6.0**. SEV-022 em particular invalidate uma propriedade de safety documentada do core (`settle_default never locks funds`).

| Dimensão | 1ª passada | 2ª passada | Δ |
|----------|-----------|------------|---|
| Segurança | 3 | **2.5** | -0.5 (SEV-021, SEV-022 — cross-program lock) |
| Arquitetura & Design | 7 | **6.5** | -0.5 (separação core/reputation tem buracos arquiteturais via CPI) |
| Documentação & Manutenibilidade | 9 | **9** | sem mudança |
| **Score Final** | **6.5/10** | **6.0/10** | -0.5 |

---

## Plano de Remediação — Atualizado

### Fase 1 — Imediato (0-7 dias) — BLOCKER PARA MAINNET

(Adições à lista da primeira passada):

- **SEV-021** (reputation authority sem timelock) — M
- **SEV-022** (reputation pause halts core paths) — M-L
- **SEV-023** (MIN_CYCLE_DURATION) — XS (resolver junto com SEV-002)

### Fase 2 — Curto prazo (1-4 semanas)

(Adições):

- **SEV-024** (fee_bps_yield cap)
- **SEV-027** (SCHEMA_PAYMENT cooldown)

### Fase 3 — Médio prazo (1-3 meses)

(Adições):

- **SEV-025** (defaults inviables — pool config validation)
- **SEV-026** (settle_default cascade refactor)
- **SEV-028** (refresh_identity error handling)

---

## Lista Final de Achados (1ª + 2ª passada)

| ID | Severidade | Status | Título |
|----|-----------|--------|--------|
| SEV-001 | Critical | re-confirmado | c_token_account não validado em yield-kamino::Deposit |
| SEV-002 | Critical | re-confirmado | GRACE_PERIOD_SECS = 60 em produção |
| SEV-003 | High | re-confirmado | harvest_yield lp_share_bps caller-controlled |
| SEV-004 | High | re-confirmado | init_pool_vaults double-count TVL |
| SEV-005 | High | re-confirmado | close_pool sem state-change repetível |
| **SEV-021** | **High** | **novo** | reputation authority rotation sem timelock |
| **SEV-022** | **High** | **novo** | reputation pause halts contribute/claim/settle cross-protocol |
| SEV-006 | Medium | re-confirmado | propose_new_treasury sem validação USDC ATA |
| SEV-007 | Medium | re-confirmado | reputation level monotonic-up — defaulter retém tier |
| SEV-008 | Medium | re-confirmado | revoke usa verification CURRENT, não at-attest-time |
| SEV-009 | Medium | re-confirmado | webhook helius sem auth |
| SEV-010 | Medium | re-confirmado | B2B_API_KEY_SALT placeholder |
| SEV-011 | Medium | re-confirmado | cargo audit advisory-only |
| SEV-012 | Medium | re-confirmado | bankrun não no CI |
| **SEV-023** | **Medium** | **novo** | MIN_CYCLE_DURATION = 60s |
| **SEV-024** | **Medium** | **novo** | fee_bps_yield permite 100% sem timelock |
| SEV-013 | Low | re-confirmado | commit-reveal salt u64 sem entropy floor |
| SEV-014 | Low | re-confirmado | indexer decoder dessincronizado |
| SEV-015 | Low | re-confirmado | commit-reveal sem cancel-Pending path |
| SEV-016 | Low | re-confirmado | shared escrow vault — DoS parcial após default |
| **SEV-025** | **Low** | **novo** | defaults constants formam pool inviável |
| **SEV-026** | **Low** | **novo** | settle_default duplica cascade logic |
| **SEV-027** | **Low** | **novo** | SCHEMA_PAYMENT sem cooldown |
| **SEV-028** | **Low** | **novo** | refresh_identity engole structural errors |
| SEV-017 | Info | re-confirmado | nft_asset signer arbitrário (cosmetic) |
| SEV-018 | Info | re-confirmado | settle_default bypassa pause core (intencional) |
| SEV-019 | Info | re-confirmado | CHANGELOG incompleto pré-audit |
| SEV-020 | Info | re-confirmado | risco de lock_approved_yield_adapter apontando ao adapter vulnerável |

**Total:** 28 achados — 2 Critical, 5 High, 9 Medium, 8 Low, 4 Informational.

---

## Recomendações Estratégicas — Atualizadas

Em adição às 6 recomendações da primeira passada:

7. **Auditar dependências cross-programa.** O caso SEV-022 (reputation pause → core DoS) revelou que a fronteira de trust entre programas não está bem modelada. Recomendamos:
   - Mapear TODAS as CPIs entre programas do protocolo.
   - Para cada uma, perguntar: "Se o programa B é compromised/paused/redeployed, qual é o pior caso para o programa A?"
   - Documentar o "trust topology" em um doc separado.
   - Sempre que possível, fazer CPIs serem **emit-only** (programa A emite evento, programa B observa via indexer e CPI-back). Isso desacopla failure modes.

8. **Symmetric trust controls cross-programa.** Treasury (core) tem 7-day timelock + lock-flag. Reputation authority (rep) tem ZERO proteções. Reputation pause + authority rotation devem ter mesma proteção que core's pause + treasury rotation. Aplicar uniformemente.

9. **Pool config validation em create_pool.** SEV-025 mostra que default params formam pool inviável. Adicionar uma validação `solvent_at_cycle_0(installment, members, credit, bps...)` no create_pool — uma "static analysis" do design do pool antes de aceitar a transação. Pessoas vão usar `with_defaults` em prod por engano.

10. **Reduzir surface de admin sem timelock.** O `update_protocol_config` muda fee_bps_yield, guarantee_fund_bps, TVL caps, allowlist (sem lock), e commit_reveal_required — TODOS sem timelock. Considerar timelock generalizado para qualquer field "policy-economic" — para a permanente reversibilidade dos params, o lock-flag pode opt-in. Isso protege contra compromisso pontual da multisig.

---

## Riscos Residuais Restantes — Atualizados

Adições à lista da primeira passada:

8. **Cross-program admin coordination.** Mesmo após SEV-021 (timelock em rep authority), o core authority e rep authority podem ser keys SEPARADAS. Recovery de um setup misconfigured (e.g., diferentes multisigs apontando uma para a outra) requer manual coordination. Documentar onboarding ops.
9. **Compile-time vs runtime constants.** SEV-002 + SEV-023 ambos vêm de constants compile-time. Mesmo após fix one-shot, o padrão volta a ser arriscado em futuras releases. Estratégia de longo prazo: mover policy para `ProtocolConfig` (runtime) e mantém só law-of-physics constants (e.g., `MAX_BPS = 10_000`) compile-time.

---

## Anexos — Comandos Adicionais (segunda passada)

```bash
# Re-validation pass
grep -rn "GRACE_PERIOD\|grace_period" --include="*.ts" --include="*.md"
grep -rn "MIN_CYCLE_DURATION" programs/ --include="*.rs"
grep -rn "deposit_idle_to_yield\|harvest_yield\|harvestYield" services/ --include="*.ts"
grep -B1 -A4 "pub c_token_account" programs/roundfi-yield-kamino/src/lib.rs
grep -n "DEVNET DEMO PATCH" programs/

# Cross-program CPI surface
grep -rn "invoke_attest\|reputation_program" programs/roundfi-core/ --include="*.rs"
grep -rn "config.paused" programs/roundfi-reputation/ --include="*.rs"
```

### Cobertura adicional da segunda passada (arquivos 100%)

- `crates/math/src/cascade.rs` (273 LoC)
- `crates/math/src/bps.rs` (88 LoC)
- `programs/roundfi-reputation/src/instructions/update_reputation_config.rs` (56 LoC)
- `programs/roundfi-reputation/src/instructions/link_passport_identity.rs` (106 LoC)
- `programs/roundfi-reputation/src/instructions/refresh_identity.rs` (96 LoC)
- `programs/roundfi-reputation/src/instructions/unlink_identity.rs` (30 LoC)
- `programs/roundfi-reputation/src/instructions/get_profile.rs` (164 LoC)
- `programs/roundfi-reputation/src/state/profile.rs` (135 LoC)
- `programs/roundfi-reputation/src/state/identity.rs` (75 LoC)
- `programs/roundfi-reputation/src/state/attestation.rs` (88 LoC)
- `programs/roundfi-reputation/src/state/config.rs` (61 LoC)
- `programs/roundfi-yield-mock/src/lib.rs` (~300 LoC, partial → completo nesta passada)
- `scripts/mainnet/canary-flow.ts` (partial — pré-flight checks)
- `tests/lifecycle.spec.ts` (head — parameters)

---

_Segunda passada da auditoria fechada em 2026-05-15._
_— Adevar Labs._
