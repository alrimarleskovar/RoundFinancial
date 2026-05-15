# Auditoria Técnica e de Segurança — RoundFinancial
**Auditor:** Adevar Labs
**Data:** 2026-05-15
**Commit auditado:** `fbc931e8c37a9a923cdcbba51f9d0e2d286a9b12`
**Branch:** `claude/web3-security-audit-2CA0r`
**Escopo:** Auditoria completa (Técnica e de Segurança) — Anchor programs `roundfi-core`, `roundfi-reputation`, `roundfi-yield-kamino`, com referência ao crate `roundfi-math`, serviço `services/indexer` e front-end `app/`.

---

## Sumário Executivo

O RoundFi é uma **ROSCA on-chain em Solana** posicionada como engine de aquisição de dados comportamentais (Phase 1) com endgame em **oráculo de crédito B2B** (Phase 3). O codebase tem alto cuidado técnico em vários quesitos — D/C invariant fechado e cross-multiplied em u128, cargo-fuzz com 6 alvos sobre `roundfi-math`, paridade Rust↔TS, separação clara entre core/reputation/yield, e três camadas de defesa-em-profundidade (CPI program-id pin, balance-delta post-CPI, slippage guard). A documentação é extensa (CHANGELOG, MAINNET_READINESS, AUDIT_SCOPE, self-audit). Em termos de cultura de engenharia, o projeto está visivelmente acima da média do espaço hackathon.

Apesar disso, **não recomendamos deploy em mainnet** no estado atual. Identificamos uma **vulnerabilidade crítica de perda de fundos** no adapter Kamino, agravada pelo fato de `deposit_idle_to_yield` ser permissionless; uma **regressão de produção** crítica no `GRACE_PERIOD_SECS` ainda fixado em 60 segundos por um "DEVNET DEMO PATCH" não revertido; e uma **falha de controle de política** no `harvest_yield` que permite a qualquer caller manipular o split LP↔participantes via `lp_share_bps`. Quaisquer um destes três sozinhos basta para colocar o protocolo em estado de insolvência prática se ativado em mainnet.

Os top-5 riscos materiais, em ordem decrescente:

1. **SEV-001 (Critical):** `c_token_account` em `roundfi-yield-kamino::Deposit` é `UncheckedAccount` sem constraint de ATA. Combinado com `deposit_idle_to_yield` permissionless no core, qualquer usuário pode redirecionar o destino dos c-tokens da Kamino para uma conta sob seu controle e drenar o principal depositado.
2. **SEV-002 (Critical):** `GRACE_PERIOD_SECS = 60` (`programs/roundfi-core/src/constants.rs:29`). Patch de demo nunca revertido; em mainnet membros são `settle_default` 60 segundos após o vencimento.
3. **SEV-003 (High):** `harvest_yield.lp_share_bps` é arg do caller permissionless — não há policy autoritária. Caller hostil define `0` ou `10_000` para reroutear yield entre LP e participantes.
4. **SEV-004 (High):** `init_pool_vaults` incrementa `committed_protocol_tvl_usdc` sem flag de idempotência; chamada repetida pelo authority do pool inflaciona artificialmente o uso de TVL cap, podendo fazer DoS no protocol-wide cap.
5. **SEV-005 (High):** `close_pool` não muda `pool.status` ao terminar; pode ser invocado N vezes, decrementando `committed_protocol_tvl_usdc` a cada chamada — quebra o accounting global de TVL caps, permitindo violação do `max_protocol_tvl_usdc` por authority compromised/buggy.

**Recomendação geral:** **NÃO DEPLOY em mainnet.** Bloqueie a mainnet canary até que SEV-001..SEV-005 estejam corrigidos, retestados em devnet, e cobertos por testes negativos no harness bankrun. Após remediação, reauditar especificamente o caminho `deposit_idle_to_yield → roundfi-yield-kamino::deposit → Kamino CPI` e os caminhos de admin (TVL caps, treasury). Considerar também adotar o lock-flag `lock_approved_yield_adapter` apenas DEPOIS de o adapter estar travado por uma versão com o c_token_account corrigido.

---

## Arquitetura e Visão Geral do Protocolo

**Componentes deployados (4 programas Anchor em devnet):**

- **`roundfi-core`** (~6.1K LoC) — State machine de pool, contribute/claim_payout, escrow vesting linear, Solidarity Vault (1% das parcelas), Triple Shield (Seed Draw / Adaptive Escrow / Solidarity), yield waterfall (fee→GF→LP→participantes), `settle_default` com D/C invariant, escape valve (list/commit/reveal/buy) com NFT Metaplex Core, treasury timelock 7 dias, TVL caps per-pool e protocol-wide, pausa global.
- **`roundfi-reputation`** (~1.7K LoC) — Attestations SAS-compatíveis (PAYMENT/LATE/DEFAULT/CYCLE_COMPLETE/LEVEL_UP), perfil per-wallet com score, ladder 1→2→3 permissionless, Civic→Human Passport identity bridge (validador byte-level).
- **`roundfi-yield-kamino`** (~750 LoC) — CPI real para Kamino Lend (`deposit_reserve_liquidity` + `redeem_reserve_collateral`); harvest via redeem-all + redeposit-principal round-trip.
- **`roundfi-yield-mock`** (~348 LoC) — Devnet-only.

**Off-chain:** `services/indexer` (Fastify + Helius webhook + Postgres via Prisma), `services/orchestrator` (devnet crank/demo), `app/` (Next.js + wallet-adapter), `sdk/` (TS encoders), `crates/math` (pure-Rust com proptest + cargo-fuzz).

**Fluxo de fundos (USDC) por pool:**

```
member_usdc --[contribute]--> {solidarity_vault(1%), escrow_vault(esc%), pool_usdc_vault(rest)}
member_usdc --[join_pool]----> escrow_vault (stake locked)
pool_usdc_vault --[deposit_idle_to_yield]--> yield_vault(adapter) --[Kamino CPI]--> Kamino reserve
yield_vault --[harvest_yield]--> pool_usdc_vault (delta) --> {treasury(fee%), GF earmark, LP earmark, participants}
pool_usdc_vault --[claim_payout]--> recipient_member
escrow_vault --[release_escrow / settle_default]--> {member_usdc | pool_usdc_vault}
solidarity_vault --[settle_default]--> pool_usdc_vault
```

**Papéis privilegiados e trust boundaries:**

- `config.authority` — multisig na mainnet (Squads 3-of-5 segundo MAINNET_READINESS). Pode `pause`, `update_protocol_config` (fees, TVL caps, allowlist, commit-reveal), `propose_new_treasury` (+timelock 7d), `lock_treasury`, `lock_approved_yield_adapter`, e `close_pool` (qualquer pool).
- `pool.authority` — criador do pool. Pode `init_pool_vaults`, `close_pool` (somente o próprio).
- `config.reputation_program` — pinned em `initialize_protocol`. Imutável.
- `passport_attestation_authority` — bridge service off-chain. Pode escrever Passport attestations.
- `position_authority` PDA `[b"position", pool, slot_index]` — FreezeDelegate + TransferDelegate dos NFTs de posição. Movimentado por instruções do protocolo, nunca pelo membro diretamente.
- Pool PDA `[b"pool", authority, seed_id]` — autoridade de `pool_usdc_vault`; signs CPIs para attest, yield adapter.
- Vault authority PDAs — `[b"escrow", pool]`, `[b"solidarity", pool]`, `[b"yield", pool]`.

**Suposições de confiança identificadas:**

1. O **yield adapter program** é tratado como UNTRUSTED para fundos (delta-balance pattern), mas a substituição é restrita por program-id pin (`pool.yield_adapter` imutável após create + opcional allowlist global).
2. O **reputation program** é tratado como UNTRUSTED — só o program-id pin importa (`config.reputation_program`).
3. A **identity bridge service** é trusted dentro do escopo de identity (uma chave compromised gera attestations falsas, mas só afeta cycle attestations indiretamente via sybil-weighting).
4. O **caller de harvest/deposit/settle/cycle-attest** é UNTRUSTED, mas o caller pode escolher `lp_share_bps` (anomalia — ver SEV-003) e `min_realized_usdc` (opt-out documentado).
5. **mpl-core 0.8.0** é tratado como possivelmente buggy — escape_valve_buy faz post-CPI verification.
6. **Kamino Lend** é trusted no contrato (não validamos suas devoluções além de delta).
7. O `config.treasury` é a **TOKEN account pubkey** (não wallet owner) — uso correto requer cuidado operacional (ver SEV-006).

---

## Sumário da Modelagem de Ameaças

**Superfícies de ataque externas:**

1. **`deposit_idle_to_yield`** — `caller: Signer` permissionless, encaminha `remaining_accounts` ao adapter. **Quebra de confiança aqui é a porta para SEV-001.**
2. **`harvest_yield`** — `caller: Signer` permissionless, controla `lp_share_bps` e `min_realized_usdc`. Quebra parcial de policy (SEV-003).
3. **`settle_default`** — `caller: Signer` permissionless; bypassa `pause` por design. Grace check é o gate. **SEV-002** colapsa o gate para 60s.
4. **`escape_valve_buy`** — buyer-permissioned com 30s cooldown pós-reveal. Atomic re-anchor de Member + NFT (3 CPIs mpl-core).
5. **`commit_new_treasury`** — qualquer caller pode finalizar uma proposta após eta. Sem validação de USDC ATA no novo treasury (SEV-006).
6. **`close_pool`** — authority do pool ou config authority; SEM mudança de status pós-execução (SEV-005).
7. **`/webhook/helius`** (off-chain) — endpoint não autenticado (SEV-009).

**Ativos críticos:**

- `pool_usdc_vault` (saldo flutuante / payout)
- `escrow_vault` (stakes + escrow vesting de TODOS os membros — vault compartilhado)
- `solidarity_vault` (Cofre Solidário)
- `yield_vault` (no adapter, depositado em Kamino → c-tokens)
- `treasury_usdc` (fee receiver)
- `ProtocolConfig.committed_protocol_tvl_usdc` (counter de TVL global)

**Vetores de ataque mais relevantes (modelados):**

1. **Redirecionar c-tokens da Kamino para conta atacante via deposit_idle_to_yield → exfiltrar via Kamino redeem direto.** SEV-001.
2. **Acelerar default de membros legítimos via grace de 60s** para extrair stake + escrow pré-vencimento. SEV-002.
3. **Manipular split LP↔participantes em cada harvest** definindo `lp_share_bps`. SEV-003.
4. **Inflar `committed_protocol_tvl_usdc` via init repetido** para DoS no protocol cap. SEV-004.
5. **Deflagrar `committed_protocol_tvl_usdc` via close repetido** para violar cap. SEV-005.
6. **Redirect de treasury para account não-USDC** que rejeita harvest. SEV-006.
7. **Front-run reveal-tx** com salt previsível (u64 sem entropia mínima exigida). SEV-013.
8. **MEV via TX ordering em escape_valve_list legacy** (cooldown=listed_at). Documentado, mitigado em mainnet por commit-reveal gate.
9. **Sybil/re-entry** com mesma wallet pós-default (level não demota). SEV-007.
10. **Replay/spoof de webhook** Helius para envenenar indexer. SEV-009.

---

## Score Geral

| Dimensão | Nota (0-10) | Comentário curto |
|----------|-------------|------------------|
| Arquitetura & Design | 7 | Boa separação core/reputation/yield; adapter swap por program-id; PDA scheme bem pensado. Penalidade: TVL accounting compartilhado entre create_pool e init_pool_vaults com idempotência frágil; close_pool sem state-machine final. |
| Qualidade de Código | 8 | Rust limpo, comentários detalhados explicando o WHY, sem `unwrap` em paths não-test, defensive checked_*. Penalidade: arquivo `escape_valve_buy.rs` longo e denso, decoder do indexer dessincronizado das `msg!`. |
| Segurança | 3 | Achados Critical (SEV-001, SEV-002) + High (SEV-003..SEV-005). D/C invariant e seed-draw bem implementados, mas a falha do c_token_account é catastrófica para o caminho de yield, e o grace=60s é dinamite operacional. |
| Performance & Escalabilidade | 7 | bitmap de slots eficiente; harvest CPI é redeem-all + redeposit (mais CU mas auditável); MAX_MEMBERS=64 razoável; pool fixed-size. Sem N+1 evidente. Penalidade: 8 PDA seed schemas dispersos. |
| Testes & Qualidade Garantida | 6 | 237 testes anunciados, fuzz com 6 targets, proptest no waterfall. Penalidade: bankrun NÃO roda no CI (Anchor 0.31 gap); `cargo audit` em advisory-only (`\|\| true`); claim de "237 tests gating" é misleading se boa parte não fecha o CI. |
| DevOps, CI/CD & Operacional | 6 | CI tem 7 lanes, branch protection é provável, fuzz scheduled. Penalidade: bankrun não bloqueia, `cargo audit` e `cargo deny` warn-only; webhook sem auth; `B2B_API_KEY_SALT=change-me-before-prod`. |
| Documentação & Manutenibilidade | 9 | Self-audit doc 228 linhas, AUDIT_SCOPE, MAINNET_READINESS, threat models de indexer e MEV, ADRs implícitos em comments. Onboarding alto. |
| **Score Final** | **6.5/10** | Boa engenharia compromissada por achados Critical/High que precisam fechar antes de mainnet. |

Critério: 9–10 excelente, 7–8 bom, 5–6 aceitável com ressalvas, 3–4 problemático, 0–2 crítico.

---

## Achados Detalhados

### [SEV-001] Fund-loss permissionless via c_token_account não validado em roundfi-yield-kamino::Deposit

- **Severidade:** **Critical**
- **Dimensão:** Segurança
- **Evidência:**
  - `programs/roundfi-yield-kamino/src/lib.rs:564-566` (declaração do account como `UncheckedAccount`)
  - `programs/roundfi-yield-kamino/src/lib.rs:196` (uso como `user_destination_collateral` na CPI Kamino)
  - `programs/roundfi-yield-kamino/src/lib.rs:629-634` (variante CORRIGIDA no `Harvest`, com `associated_token::mint + authority = state`)
  - `programs/roundfi-core/src/instructions/deposit_idle_to_yield.rs:33-34` (caller permissionless: `Anyone can crank this`)
  - `programs/roundfi-core/src/instructions/deposit_idle_to_yield.rs:126-133` (forwarding bruto de `remaining_accounts`)
- **Descrição:** No struct `Deposit` do adapter Kamino, o `c_token_account` — destino dos c-tokens mintados pela Kamino — é declarado como `UncheckedAccount` sem qualquer constraint:
  ```rust
  /// CHECK: c-token ATA owned by `state` PDA — receives minted c-tokens.
  #[account(mut)]
  pub c_token_account: UncheckedAccount<'info>,
  ```
  O comentário afirma que é "owned by state PDA", mas o Anchor não verifica isso. O `Harvest` struct, no mesmo arquivo, faz a verificação correta. Como `deposit_idle_to_yield` em `roundfi-core` é permissionless (`caller: Signer`) e simplesmente repassa `remaining_accounts` ao adapter, qualquer usuário pode passar uma c-token account que ele controla. A Kamino mintará c-tokens nessa conta. Os USDC do pool (que passaram pela shadow vault state-owned) entram no Kamino reserve, mas a "claim" (c-token) fica com o atacante.
- **Impacto:** **Perda de principal proporcional ao valor depositado em yield.** Para um pool padrão de 24×$416×24-ciclo (~$240K committed flow), todo USDC ocioso movido via `deposit_idle_to_yield` pode ser desviado em uma única transação. O atacante posteriormente chama `Kamino::redeem_reserve_collateral` diretamente (com seus c-tokens) e extrai o USDC + yield acumulado para sua wallet. O protocolo fica permanentemente underwater: `state.tracked_principal` reflete o depósito, mas os c-tokens correspondentes não estão em poder do `state` — o `harvest()` falha no guard `PrincipalLoss` (linha 329-332) e o principal é irrecuperável. A vulnerabilidade só é ativada na hora em que o protocolo migra do mock para o adapter Kamino (ou seja, no caminho de mainnet).
- **Cenário de Ataque:**
  1. Authority do protocolo deploya `roundfi-yield-kamino` em mainnet, seta `config.approved_yield_adapter` e inicializa pool A.
  2. Membros do pool A fazem `contribute` várias vezes, pool_usdc_vault acumula USDC ocioso.
  3. **Atacante** (não precisa ser membro) cria um TokenAccount com `mint = state.kamino_reserve_collateral_mint` e `owner = attacker_wallet`.
  4. Atacante chama `roundfi-core::deposit_idle_to_yield(amount = vault_idle)` passando em `remaining_accounts` os mesmos `kamino_*` accounts pinados (que ele lê on-chain de `state`) MAS substituindo `c_token_account` por sua própria conta do passo 3.
  5. Core valida `yield_adapter_program == pool.yield_adapter` (✓), GF earmark (✓), e invoca o adapter via CPI.
  6. Adapter valida `authority == state.pool` (✓), `destination == state.vault` (✓), `source.mint` (✓). Step 1 transfere pool_usdc_vault → shadow vault. Step 2 invoca Kamino com o c_token_account malicioso.
  7. Kamino verifica que o c_token_account é do mint certo (atacante criou com mint correto) e minta c-tokens para a conta do atacante.
  8. CPI retorna `Ok`. `state.tracked_principal += amount`. Pool perde `amount` USDC; atacante ganha c-tokens equivalentes.
  9. Atacante chama Kamino direto (`redeem_reserve_collateral`) com seus c-tokens → recebe `amount + yield_accrued` USDC líquido.
  10. Quando o protocolo tentar `harvest_yield`, o adapter chama redeem com `c_token_balance` da c-token state-owned (que é 0 ou estado anterior); a operação pode retornar muito menos que `tracked_principal` e disparar `PrincipalLoss`. Funds perdidos permanentemente.
- **Prova de Conceito (pseudocódigo TS):**
  ```typescript
  // Pre-requisite: protocol is using roundfi-yield-kamino in mainnet.
  const state = await fetchYieldState(poolPda);
  const attackerCToken = await createAssociatedTokenAccount(
    attackerWallet,
    state.kaminoReserveCollateralMint, // public, on-chain in state
    attackerWallet.publicKey,           // OWNER = attacker
  );

  const tx = await program.methods.depositIdleToYield(new BN(amountUsdc))
    .accounts({ /* normal accounts */ })
    .remainingAccounts([
      { pubkey: state.publicKey,                       isSigner: false, isWritable: true  },
      { pubkey: state.kaminoReserve,                   isSigner: false, isWritable: true  },
      { pubkey: state.kaminoMarket,                    isSigner: false, isWritable: false },
      { pubkey: kaminoMarketAuthority,                 isSigner: false, isWritable: false },
      { pubkey: kaminoReserveLiquiditySupply,          isSigner: false, isWritable: true  },
      { pubkey: state.kaminoReserveCollateralMint,     isSigner: false, isWritable: true  },
      { pubkey: attackerCToken,                        isSigner: false, isWritable: true  },  // ← !
      { pubkey: KAMINO_LEND_PROGRAM_ID,                isSigner: false, isWritable: false },
    ])
    .signers([attackerWallet])
    .rpc();

  // Drain via Kamino direct redeem
  await kaminoLendProgram.methods.redeemReserveCollateral(cTokenAmount)
    .accounts({ owner: attackerWallet, /* ... */ })
    .rpc();
  ```
- **Componentes Afetados:**
  - `programs/roundfi-yield-kamino/src/lib.rs` — struct `Deposit`
  - Transitivamente: `programs/roundfi-core/src/instructions/deposit_idle_to_yield.rs` (caller permissionless + forwarding)
- **Recomendação:** Adicionar a mesma constraint que já existe em `Harvest`:
  ```rust
  // Em programs/roundfi-yield-kamino/src/lib.rs, struct Deposit:
  #[account(
      mut,
      associated_token::mint = kamino_reserve_collateral_mint,
      associated_token::authority = state,
  )]
  pub c_token_account: Account<'info, TokenAccount>,
  ```
  Além disso, considerar:
  - Pinar `kamino_reserve_collateral_mint`, `kamino_reserve_liquidity_supply`, e `kamino_market_authority` no `YieldVaultState` (apenas reserve/market estão pinados hoje), eliminando a categoria inteira de substituição de Kamino-side accounts. Defense-in-depth — Kamino já valida estes do lado dela, mas pinning local protege contra mudanças não anunciadas no IDL Kamino.
  - Restringir `roundfi-core::deposit_idle_to_yield` a `caller == pool.authority` (ou similar) como mitigação adicional, sem custo de UX (o crank é operacional, não user-facing).
  - Adicionar teste negativo no harness bankrun: tentativa de depósito com c-token de outro owner deve falhar com `ConstraintAssociated`/`ConstraintTokenOwner`.
  - **Riscos de regressão da correção:** mudar de `UncheckedAccount` para `Account<TokenAccount>` valida automaticamente que a c-token ATA já existe — o adapter NÃO cria via `init_if_needed`. Garanta que existe um setup-step que cria a state-owned c-token ATA antes do primeiro `deposit`. Isso já é necessário para a Kamino aceitar a mint mas é fácil esquecer no fluxo de canary rampup.
- **Esforço estimado:** S — 4 linhas de Anchor + testes + redeploy do adapter. Considerar bump de versão e re-canary.

---

### [SEV-002] GRACE_PERIOD_SECS = 60 em produção — devnet patch não revertido

- **Severidade:** **Critical**
- **Dimensão:** Segurança / DevOps
- **Evidência:**
  - `programs/roundfi-core/src/constants.rs:20-29` — declaração:
    ```rust
    /// **DEVNET DEMO PATCH (2026-05-07)**: lowered from 604_800 (7 days) to
    /// 60 seconds so the settle_default flow can be exercised against a
    /// freshly-built pool 3 within a single session. Production deploys
    /// MUST restore the 7-day value before mainnet — search the repo for
    /// `GRACE_PERIOD_SECS = 60` and the canonical `7 * 24 * 60 * 60` test
    /// in this file's `#[cfg(test)]` module to revert atomically.
    pub const GRACE_PERIOD_SECS: i64 = 60;
    ```
  - `programs/roundfi-core/src/constants.rs:202-209` — teste pinning a 60s (i.e. assegura que a patch fica):
    ```rust
    #[test]
    fn grace_period_is_devnet_demo_patch() {
        assert_eq!(GRACE_PERIOD_SECS, 60);
    }
    ```
  - `programs/roundfi-core/src/instructions/settle_default.rs:166-172` — uso direto:
    ```rust
    let grace_deadline = pool_next_cycle_at.checked_add(GRACE_PERIOD_SECS)…
    require!(clock.unix_timestamp >= grace_deadline, RoundfiError::GracePeriodNotElapsed);
    ```
- **Descrição:** A constante `GRACE_PERIOD_SECS` está hardcoded em 60 segundos (1 minuto) em vez de 604_800 (7 dias). O comentário admite ser um patch de devnet "for the hackathon demo" e diz explicitamente "Production deploys MUST restore the 7-day value before mainnet". O teste anexo (`grace_period_is_devnet_demo_patch`) pinou a versão patcheada — passar no CI **não** garante o valor de produção; ao contrário, prende-o no valor errado. Não há mecanismo de runtime para diferenciar devnet/mainnet (a constante é compile-time).
- **Impacto:** Em mainnet, qualquer cranker pode chamar `settle_default` 60 segundos após `pool.next_cycle_at` para um membro que não pagou. A consequência:
  - **Stake do membro (50%/30%/10% do credit_amount) confiscado.**
  - **Escrow_balance confiscado.**
  - **Default attestation gravada permanentemente.** (`SCHEMA_DEFAULT`, sticky).
  - **Reputation score −500 + count de defaults incrementado.**

  Membros legítimos com falha temporária de conectividade, atraso de wallet, ou diferença de timezone serão liquidados antes de ter chance de pagar. Para um pool padrão (10.000 USDC credit × 50% stake L1 = 5.000 USDC), o membro perde **5.000 USDC + escrow acumulado** por estar 61 segundos atrasado. Adicionalmente, este caminho **bypassa o `paused` flag** por design — não há "emergency stop" para esta janela.
- **Cenário de Ataque (griefing organizado):**
  1. Atacante monitora o mempool/RPC esperando o `next_cycle_at` de qualquer pool.
  2. T = `next_cycle_at + 61s` — atacante envia `settle_default` para todos os membros que ainda não pagaram naquele cycle.
  3. Stakes + escrows são confiscados para `pool_usdc_vault`.
  4. Atacante não ganha financeiramente diretamente (os fundos vão para o pool), mas:
     - O pool fica com slot defaulted, atacante recebe rent refunds dos `attestation` PDAs criados, lucro marginal por confisco.
     - Pool effetivamente bloqueia membros do upside (escrow vesting, payout futuro).
     - Reputation score do membro destruído; recuperação requer pagar várias cycle attestations.
  5. Em escala — botnet espalhada pelos pools — destrói retenção real do protocolo.
- **Prova de Conceito:** N/A — basta esperar 60s após `next_cycle_at` e chamar `settle_default(cycle = pool.current_cycle)` com membro alvo.
- **Componentes Afetados:** `programs/roundfi-core/src/constants.rs`, `settle_default.rs`, `release_escrow.rs` (membros defaulted não podem release), todos os testes que dependem do timing.
- **Recomendação:**
  ```rust
  pub const GRACE_PERIOD_SECS: i64 = 604_800; // 7 days
  ```
  E reverter o teste:
  ```rust
  #[test]
  fn grace_period_is_seven_days() {
      assert_eq!(GRACE_PERIOD_SECS, 7 * 24 * 60 * 60);
  }
  ```
  Adicionalmente:
  - Mover `GRACE_PERIOD_SECS` para `ProtocolConfig` (mutable por authority com `update_protocol_config`), permitindo ajustar pós-deploy sem redeploy. Esta também é uma armadilha menor que constantes compile-time.
  - **Adicionar build-time check:** macro `compile_error!` ou `cargo deny` rule que rejeita `GRACE_PERIOD_SECS < 86_400` quando feature flag `mainnet` está ativa.
  - **Adicionar deploy gate:** script CI separado que valida valores de constantes contra um perfil mainnet antes de aceitar o `anchor deploy`.
  - **Auditar todas as outras DEVNET DEMO PATCH** — `grep -rn "DEVNET DEMO PATCH\|temporary"` no repo. (Já fiz; só o `GRACE_PERIOD_SECS` apareceu, mas a disciplina geral merece um check antes de mainnet.)
- **Esforço estimado:** XS (2 linhas) + S (mover para config / build gate).

---

### [SEV-003] harvest_yield caller-provided lp_share_bps quebra policy de distribuição

- **Severidade:** **High**
- **Dimensão:** Segurança / Arquitetura & Design
- **Evidência:**
  - `programs/roundfi-core/src/instructions/harvest_yield.rs:43-49` (declaração do arg)
  - `programs/roundfi-core/src/instructions/harvest_yield.rs:67-69` (`caller: Signer` sem authority constraint)
  - `programs/roundfi-core/src/instructions/harvest_yield.rs:154-156` (única validação: `lp_share_bps <= 10_000`)
  - `programs/roundfi-core/src/instructions/harvest_yield.rs:265` (passado direto ao `waterfall`)
  - `programs/roundfi-core/src/constants.rs:61-64` (`DEFAULT_LP_SHARE_BPS = 6_500` — só o default)
- **Descrição:** O argumento `lp_share_bps` do `harvest_yield` controla o split entre LP earmark e participants — i.e., entre `pool.lp_distribution_balance` (futuros LPs / Anjos de Liquidez) e `pool.yield_accrued` (prêmio de paciência dos participantes do pool). O argumento vem do caller, que é qualquer signer. A única validação é `lp_share_bps <= MAX_BPS` (i.e., 100%). Não há policy autoritativa — nem no `Pool`, nem no `ProtocolConfig`. Documento diz "caller (typically the pool creator or a protocol crank) provides this" — sem enforcement on-chain.
- **Impacto:**
  - Qualquer caller pode rotear 100% do yield após-fee-e-GF para LP earmark (`lp_share_bps = 10_000`), zerando o "prêmio de paciência" dos participantes. Ou o inverso (0% para LP, todos para participants).
  - Não é fund-loss direto (o yield fica no pool_usdc_vault em ambos os casos), mas é uma quebra de policy material. Em mainnet, com LPs B2B reais (Anjos de Liquidez), esses LPs subscreveram o contrato esperando 65% do yield líquido (`DEFAULT_LP_SHARE_BPS`). Um caller hostil pode bombear todo o yield para um lado ou outro a cada harvest, criando inconsistência económica e potencialmente quebrando relação contratual com investidores.
  - Adicional: numa pool com LP e participants concorrentes, isso vira ataque económico cross-stakeholder. Um participant chama com `lp_share_bps = 0`; um LP chama com `10_000`; ambos podem corrida cada harvest.
- **Cenário de Ataque:** Trivial — caller chama `harvest_yield(lp_share_bps = 0, min_realized_usdc = 0)`. Todo yield realizado vai para participants. LPs nunca recebem.
- **Componentes Afetados:** `harvest_yield.rs`, `state/pool.rs::lp_distribution_balance`, futuro pathway de LP withdrawal.
- **Recomendação:**
  - **Mover `lp_share_bps` para `ProtocolConfig`** (mutável por authority, com lock-flag opcional pós-canary) ou para `Pool` (imutável após create, declarado pelo pool authority em `CreatePoolArgs`).
  - Remover o argumento do call site:
    ```rust
    pub fn harvest_yield<'info>(...) -> Result<()> {
        let lp_share_bps = ctx.accounts.config.lp_share_bps; // OR pool.lp_share_bps
        ...
    }
    ```
  - Se há razão para parametrizar (e.g. canary rampup), aceitar como override **apenas se** `caller.key() == config.authority || caller.key() == pool.authority`.
  - **Riscos de regressão da correção:** alguma fixture de teste devnet possivelmente passa lp_share_bps explicitamente — atualizar. Pool antigos perdem a flexibilidade per-pool — assumir que a versão default é suficiente.
- **Esforço estimado:** S — adicionar campo ao state, migrar default, atualizar handler.

---

### [SEV-004] init_pool_vaults double-counts committed_protocol_tvl_usdc em chamadas repetidas

- **Severidade:** **High**
- **Dimensão:** Segurança / Qualidade de Código
- **Evidência:**
  - `programs/roundfi-core/src/instructions/init_pool_vaults.rs:119-150` — TVL increment incondicional:
    ```rust
    let pool_committed = (ctx.accounts.pool.credit_amount as u128)
        .checked_mul(ctx.accounts.pool.cycles_total as u128)?;
    ...
    config.committed_protocol_tvl_usdc = config
        .committed_protocol_tvl_usdc
        .checked_add(pool_committed)?;
    ```
  - `programs/roundfi-core/src/instructions/init_pool_vaults.rs:152-203` — chamadas `create_idempotent` para as 4 ATAs, garantem sucesso na 2ª chamada (no-op).
- **Descrição:** As 4 chamadas `create_idempotent` são, como o nome indica, idempotentes — a 2ª invocação de `init_pool_vaults` para o mesmo pool é um no-op nas ATAs. Mas o incremento de `config.committed_protocol_tvl_usdc` é **incondicional**: roda toda vez. Não há flag tipo `pool.vaults_initialized: bool` para gate isso.
- **Impacto:**
  - Operacional: se o pool authority chama `init_pool_vaults` duas vezes por erro (retry, race entre interfaces), o `committed_protocol_tvl_usdc` é dobrado para aquele pool, consumindo headroom do `max_protocol_tvl_usdc`. Em canary com bound pequeno ($5–50), isso pode bloquear NOVOS pools legítimos.
  - Adversarial: pool authority hostil chama `init_pool_vaults` repetidamente para inflar artificialmente o counter de TVL e DoS-ar o protocol-wide cap durante canary rampup. Pool authority pode ser qualquer um (não precisa ser protocol authority).
  - O `close_pool` só decrementa por `credit × cycles` uma vez (saturating), portanto o dobro injetado por init repetido não pode ser "limpo" — fica preso até overflow / migration.
- **Cenário de Ataque:**
  1. Atacante (qualquer um com SOL para fees) cria pool A com `credit × cycles = max_protocol_tvl_usdc - epsilon`.
  2. Chama `init_pool_vaults` para A duas vezes. `committed_protocol_tvl_usdc` agora reflete `2 × (credit × cycles)` > `max_protocol_tvl_usdc`.
  3. Pool B legítimo tenta `init_pool_vaults` → falha com `ProtocolTvlCapExceeded`.
  4. Atacante chama `close_pool` em A → counter reduz `credit × cycles`. Ainda restante `credit × cycles` no counter "fantasma".
  5. Atacante repete N vezes — counter fica permanentemente inflado, mainnet canary morre.
- **Recomendação:**
  - Adicionar bool ao `Pool` state — `vaults_initialized: bool` — e gate o TVL increment + ATA creation:
    ```rust
    require!(!pool.vaults_initialized, RoundfiError::VaultsAlreadyInitialized);
    // ... TVL increment + create_idempotent calls ...
    pool.vaults_initialized = true;
    ```
  - Alternativa minimal: detectar se `pool_usdc_vault` já existe (`account.data.borrow().len() > 0`) e skip o TVL increment nesse caso. Menos elegante, mais defensivo contra estado pré-flag.
  - **Riscos de regressão:** pool já criado em devnet sem a flag — assumir que `vaults_initialized = false` (default bool) e detectar via vault existence check. Migration zero-impact.
- **Esforço estimado:** S — 1 campo no Pool + 1 guard.

---

### [SEV-005] close_pool não muda pool.status — invocação repetida deflaciona committed_protocol_tvl_usdc

- **Severidade:** **High**
- **Dimensão:** Segurança / Arquitetura & Design
- **Evidência:**
  - `programs/roundfi-core/src/instructions/close_pool.rs:43-46` — entrada exige `Completed`:
    ```rust
    constraint = pool.status == PoolStatus::Completed as u8 @ RoundfiError::PoolNotCompleted,
    ```
  - `programs/roundfi-core/src/instructions/close_pool.rs:54-94` — handler **não muda `pool.status`** ao final. Estado fica em `Completed` indefinidamente.
  - `programs/roundfi-core/src/instructions/close_pool.rs:78-80` — decrement saturating:
    ```rust
    config.committed_protocol_tvl_usdc = config
        .committed_protocol_tvl_usdc
        .saturating_sub(pool_committed);
    ```
  - Doc-string do arquivo admite o gap: "Flips `pool.status` back to a sentinel `Completed`" (o status JÁ É `Completed` na entrada — não há "flip").
- **Descrição:** `close_pool` é idempotente nas ATAs (não fecha) e nos logs, mas decrementa `committed_protocol_tvl_usdc` em cada chamada por `credit × cycles`. Como `pool.status` permanece `Completed` após o handler, nada bloqueia a próxima invocação. `saturating_sub` evita underflow mas não evita perda de informação.
- **Impacto:**
  - Authority compromised (pool authority OR config authority) chama `close_pool` N vezes em pools `Completed` para deflacionar artificialmente o counter global. Resultado: `committed_protocol_tvl_usdc` reflete menos uso que realidade, permitindo violar `max_protocol_tvl_usdc` na próxima criação de pool.
  - Em canary, esta é uma escalada de privilégio: um pool authority com poder limitado (só cria seus próprios pools) ganha capacidade de impactar headroom global.
  - Conjunto com SEV-004, o counter de TVL fica completamente confiável apenas até o primeiro misuso.
- **Cenário de Ataque:**
  1. Pool A do atacante completa naturalmente, status = `Completed`. `committed_protocol_tvl_usdc` decrementa por `pool_committed_A`.
  2. Atacante chama `close_pool(A)` mais 5 vezes. Counter decrementa por `5 × pool_committed_A` (saturating em 0 eventualmente). Mas durante o processo, fica em um valor menor que o real.
  3. Atacante cria pool B com `credit × cycles` que excederia `max_protocol_tvl_usdc` — mas como counter está inflado para baixo, passa.
- **Recomendação:**
  - Adicionar uma transição de estado terminal:
    ```rust
    pub enum PoolStatus {
        Forming    = 0,
        Active     = 1,
        Completed  = 2,
        Liquidated = 3,
        Closed     = 4,   // NEW — terminal post-close_pool
    }
    ```
    E no handler:
    ```rust
    let pool = &mut ctx.accounts.pool;
    require!(pool.status == PoolStatus::Completed as u8, RoundfiError::PoolNotCompleted);
    pool.status = PoolStatus::Closed as u8;
    ```
    Garante que `close_pool` só roda uma vez.
  - Alternativa minimal: usar uma flag `pool.closed: bool` (1 byte).
  - **Riscos de regressão:** garantir que nenhum fluxo downstream se baseia em `Completed` perpétuo. Buscas no codebase mostram que apenas o constraint do close_pool referencia, OK.
- **Esforço estimado:** S — 1 campo state + 1 transição.

---

### [SEV-006] propose_new_treasury aceita qualquer Pubkey sem validar USDC ATA

- **Severidade:** **Medium**
- **Dimensão:** Segurança / Qualidade de Código
- **Evidência:**
  - `programs/roundfi-core/src/instructions/propose_new_treasury.rs:24-27` (args só carrega `new_treasury: Pubkey`)
  - `programs/roundfi-core/src/instructions/commit_new_treasury.rs:60` (commit aplica direto sem validação)
  - `programs/roundfi-core/src/instructions/harvest_yield.rs:111-116` (uso em runtime: `treasury_usdc.key() == config.treasury` AND `mint == pool.usdc_mint`)
- **Descrição:** `propose_new_treasury` e `commit_new_treasury` só armazenam um `Pubkey` cru. Não há validação de que essa Pubkey seja uma TokenAccount existente, com o mint correto (USDC), e não-frozen. Validação só acontece no `harvest_yield`, quando já é tarde.
- **Impacto:**
  - **Tipo cenário 1 (erro operacional):** Authority digita um pubkey errado (wallet em vez de ATA) no propose. Aguarda 7 dias do timelock. Commit acontece. Próximo `harvest_yield` reverte em todos os pools com `Unauthorized` ou `InvalidMint`. **Yield harvest fica bloqueado em todos os pools até a authority publicar nova proposta + esperar 7 dias.** DoS de 7+ dias em todo o protocolo.
  - **Tipo cenário 2 (authority malicioso/compromised):** Authority compromised propõe um ATA controlado pelo atacante (mas com USDC mint correto). Após 7 dias, todos os fees de yield fluem para o atacante. O timelock é o gate, mas se o ataque envolveu coordenação interna, o gate pode passar sem detecção.
  - **Tipo cenário 3 (lock_treasury timing):** Authority faz `propose_new_treasury(bad)` → comunidade detecta → authority tenta `lock_treasury` para impedir o commit. Mas o `lock_treasury` **não bloqueia commits in-flight** (per design — ver `commit_new_treasury.rs:19-22`). O commit ainda dispara.
- **Recomendação:**
  - Em `propose_new_treasury`, exigir o TokenAccount como input:
    ```rust
    pub struct ProposeNewTreasury<'info> {
        ...
        #[account(token::mint = usdc_mint)]
        pub new_treasury: Account<'info, TokenAccount>,
        pub usdc_mint: Account<'info, Mint>,
        ...
    }
    ```
    E armazenar `new_treasury.key()`. Isso valida que a Pubkey é uma TokenAccount real, no mint certo, no momento da proposta.
  - Permitir `cancel_new_treasury` durante o timelock (já existe) E permitir `lock_treasury` bloquear commits in-flight como opção (mudança breaking — discutir).
  - Adicionar instrução `validate_pending_treasury` permissionless que re-valida o pending treasury durante o timelock window — chama-se off-chain por bots de monitoramento.
  - **Riscos de regressão:** mudar `args.new_treasury: Pubkey` para `Account<TokenAccount>` é breaking para a TS SDK. Atualizar encoder + scripts.
- **Esforço estimado:** S.

---

### [SEV-007] Reputation level monotonic-up — defaulter retém tier (e baixo stake_bps) em re-entry

- **Severidade:** **Medium**
- **Dimensão:** Segurança / Arquitetura & Design
- **Evidência:**
  - `programs/roundfi-reputation/src/instructions/promote_level.rs:38-48` ("Monotonic up: the ladder is advance-only")
  - `programs/roundfi-reputation/src/instructions/attest.rs:190-193` (SCHEMA_DEFAULT reduz score MAS não toca level)
  - `programs/roundfi-core/src/instructions/join_pool.rs:368-380` (`derive_trusted_reputation_level` lê `profile.level` direto, não re-deriva de score)
- **Descrição:** O `promote_level` move o nível UP somente — quando o score cai (via SCHEMA_DEFAULT ou SCHEMA_LATE), o nível não demota. Comentário diz "the next join_pool re-snapshots whatever the current level is, which IS allowed to be lower if the score has dropped" — mas o código em `derive_trusted_reputation_level` lê `profile.level.clamp(1, 3)`, não re-deriva a partir de `profile.score`. Inconsistência: comentário promete demotion, código não entrega.
- **Impacto:**
  - Um membro alcança Veteran (L3, stake 10%) com pagamentos exemplares. Default em um pool — score −500, mas `profile.level` permanece em 3.
  - Próximo pool: joinPool com o mesmo wallet → trusted_level = 3 → stake_bps = 10%. O membro entra com colateral baixo.
  - Para um credit de 10.000 USDC, o member empenha 1.000 USDC em vez de 5.000 USDC. Se este membro defaultar de novo, a perda do pool é maior. Quebra a premissa "1× = 50%, 10× = veteran".
  - Severidade Medium porque: (a) o defaulter já carrega o stigma do default count e on-chain logs visíveis, então B2B subscribers podem (Phase 3) penalizar; (b) o defaulter pode evitar o problema rotacionando wallets, mas perde o histórico de score.
- **Recomendação:** Escolher entre as duas semânticas e fechar a discrepância. Recomendado: **demote em SCHEMA_DEFAULT no `attest`**:
  ```rust
  SCHEMA_DEFAULT => {
      profile.apply_score_delta(SCORE_DEFAULT);
      profile.defaults = profile.defaults.saturating_add(1);
      // Re-derive level from new score immediately
      profile.level = ReputationProfile::resolve_level(
          profile.score, LEVEL_2_THRESHOLD, LEVEL_3_THRESHOLD,
      ).max(LEVEL_MIN);
  }
  ```
  Alternativamente, mudar `derive_trusted_reputation_level` em `join_pool.rs` para re-derivar de `score`, alinhando com a documentação. Vantagem deste lado: não muda comportamento do reputation program, só do core.
- **Esforço estimado:** S.

---

### [SEV-008] reputation::revoke usa identity verification CURRENT, não at-attest-time → score over-reversal

- **Severidade:** **Medium**
- **Dimensão:** Qualidade de Código / Segurança
- **Evidência:**
  - `programs/roundfi-reputation/src/instructions/revoke.rs:53-68` — lê `now`, computa `verified` LIVE
  - `programs/roundfi-reputation/src/instructions/attest.rs:170-205` — aplica delta com weight at-attest-time, mas NÃO persiste o weight no `Attestation` PDA
- **Descrição:** `attest` aplica score delta com peso 1/2 se unverified, 2/2 se verified. `revoke` reverse o delta com peso CURRENT do identity record. Se um wallet passa de unverified para verified entre attest e revoke, a reversão é maior que a aplicação original — score sai negativo.
- **Impacto:**
  - Membro recebe SCHEMA_PAYMENT enquanto unverified: score += 5 (10 × 1/2).
  - Membro linka Passport → verified.
  - Issuer revoga a attestation original: score -= 10 (10 × 2/2).
  - Resultado: score = -5 em vez de 0.
  - Severidade Medium porque: (a) `revoke` só é callable pelo issuer original; (b) o issuer é o Pool PDA (não há instrução em `roundfi-core` que cause revoke; só admin manual). Mas se o admin chega a revogar uma attestation antiga após upgrade de identity, o score fica inconsistente.
- **Recomendação:** Persistir o weight numa flag de 1 byte na `Attestation` (ou armazenar uma cópia do verified-status no payload), e usar essa flag em `revoke` em vez de `is_verified(now)`:
  ```rust
  pub struct Attestation {
      ...
      pub verified_at_attest: bool,  // NEW
  }
  ```
  Ou alternativamente, simplificar: SEMPRE aplicar peso 2/2 (sem sybil hint), removendo o ramo de halving. O sybil-hint atual já tem complicações (ver self-audit) e o benefício é marginal.
- **Esforço estimado:** XS (flag) ou S (remoção do sybil-hint).

---

### [SEV-009] /webhook/helius accepts unauthenticated POST — indexer event poisoning

- **Severidade:** **Medium**
- **Dimensão:** Segurança / DevOps
- **Evidência:**
  - `services/indexer/src/server.ts:21-22, 105-128` — "we don't sign or verify the body in v0 since the URL is a per-environment secret."
- **Descrição:** O webhook do indexer aceita qualquer POST com payload bem-formado. A "autenticação" é a obscuridade da URL. Qualquer um que descobre/vaza a URL pode injetar eventos arbitrários (contributes, claims, defaults) no Postgres. Esses eventos eventualmente lastreiam o behavioral score / Phase 3 B2B API.
- **Impacto:**
  - Fora do trust path de movimentação de fundos on-chain (correto — AUDIT_SCOPE marca isto como out-of-scope), MAS afeta a integridade do dado que é vendido pra B2B.
  - URL leaks via logs, CI, GitHub artifacts, ou tooling de proxy. Solana RPCs públicos não tipicamente expõem webhooks, mas a URL fica em Helius dashboard config — se a dashboard for comprometida, atacante pode reproduzir requests.
  - Reconciler off-chain (issue #234) deveria detectar discrepância between webhook events e canonical state, mas hoje não está implementado.
- **Recomendação:**
  - Helius webhook suporta auth header. Usar:
    ```ts
    app.post("/webhook/helius", async (req, reply) => {
      const auth = req.headers["authorization"];
      if (auth !== `Bearer ${process.env.HELIUS_WEBHOOK_SECRET}`) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      ...
    });
    ```
  - Adicionalmente, validar `req.ip` contra Helius CIDR ranges em produção (defense-in-depth).
  - Apertar o reconciler para que o **canonical state on-chain seja a única source of truth** e webhook events sejam só hints (já é a filosofia, mas o atual decoder está dessincronizado — ver SEV-014).
- **Esforço estimado:** XS.

---

### [SEV-010] B2B_API_KEY_SALT placeholder em .env.example — risco se copiado direto

- **Severidade:** **Medium**
- **Dimensão:** Segurança / Documentação
- **Evidência:** `.env.example:32` — `B2B_API_KEY_SALT=change-me-before-prod`. Grep mostra que a constante não é usada no código atual (confirmado via `grep -rn "B2B_API_KEY_SALT"`).
- **Descrição:** Placeholder fica como "honeypot" pra deployers descuidados. Apesar de não ser usado hoje (Phase 3 não shipped), quando for plugado, há risco real de deployers copiarem `.env.example` para `.env` sem editar.
- **Impacto:** Quando o B2B API surge, salt previsível torna API keys forjáveis se o salt vaza junto com o ciphertext. Mitigação fácil mas precisa ser feita ANTES do Phase 3 lançar.
- **Recomendação:** Trocar para `B2B_API_KEY_SALT=` (vazio, exige preenchimento) e adicionar validação em startup do serviço B2B: rejeitar boot se `B2B_API_KEY_SALT.length < 32`.
- **Esforço estimado:** XS.

---

### [SEV-011] cargo audit / cargo deny em advisory-only (|| true) — CVEs ignorados silenciosamente

- **Severidade:** **Medium**
- **Dimensão:** DevOps / Segurança
- **Evidência:** `.github/workflows/ci.yml:130, 162` — `run: cargo audit || true` e `cargo deny check ... || true`.
- **Descrição:** Os jobs estão marcados "advisory-only" com `|| true` no comando. Resultado: green CI mesmo com CVEs ativos. Comentário admite que é devido a transients do Solana 1.18 / mpl-core 0.8 (`curve25519-dalek`, `ed25519-dalek-bip32`), tracked pra Agave 2.x migration.
- **Impacto:** Novas CVEs em deps não-Solana (e.g. `serde`, `tokio`, `prisma`) não são vistas até alguém olhar manualmente. Falsa sensação de segurança.
- **Recomendação:**
  - Manter o gate como "required" mas com `--ignore RUSTSEC-XXX` específicos para os IDs conhecidos do Solana 1.18 transients. Documentar cada `--ignore` com link à issue upstream. Quando Agave 2.x retirar, remover o `--ignore`.
  - Adicionar lane separada para `cargo audit` sobre `services/`, `sdk/`, `app/` (não-Solana deps) com gate REQUIRED.
- **Esforço estimado:** S.

---

### [SEV-012] bankrun tests não rodam no CI — claim de "237 tests" misleading

- **Severidade:** **Medium**
- **Dimensão:** Testes & DevOps
- **Evidência:**
  - `.github/workflows/ci.yml:198-244` — anchor lane roda `anchor build --no-idl`. Comentário: "`pnpm test:bankrun` is intentionally not in this lane. The bankrun harness loads `target/idl/*.json`, but `--no-idl` skips that generation."
  - README anuncia "237 tests across 21 spec files (53 security-specific bankrun + ...)".
- **Descrição:** Os 53+ testes de segurança bankrun são listados como cobertura mas NÃO bloqueiam merges. Estão presentes no repo mas só são executáveis manualmente quando IDL está disponível.
- **Impacto:** Regressões em fluxo on-chain (e.g., uma mudança em `escape_valve_buy` quebrar o re-anchor) só são detectadas em devnet ou pós-deploy. Para um protocolo lidando com USDC real em mainnet, esse gap é material.
- **Recomendação:**
  - Resolver o blocker do Anchor 0.31 (issue #230). Alternativas:
    - Migrar para Anchor 0.31+ que restaura IDL gen.
    - Patch local em anchor-syn `Span::source_file` ou usar `nightly` toolchain só para IDL.
  - Enquanto não resolve, adicionar pelo menos um "smoke bankrun" lane que roda os testes críticos de segurança contra uma IDL pré-gerada committed no repo (re-gera em PR que toca os programas).
- **Esforço estimado:** M (Anchor migration) ou S (committed IDL workaround).

---

### [SEV-013] Commit-reveal salt é u64 sem entropy floor — seller pode comprometer privacidade

- **Severidade:** **Low**
- **Dimensão:** Segurança
- **Evidência:**
  - `programs/roundfi-core/src/instructions/escape_valve_list_reveal.rs:34-36` (args: `price_usdc: u64, salt: u64`)
  - `programs/roundfi-core/src/instructions/escape_valve_list_commit.rs` (commit_hash = SHA256(price || salt), no enforcement de entropia de salt)
- **Descrição:** O salt é u64 (8 bytes). Suficiente em teoria (2^64 = 1.8e19), mas se o seller usa salt=0 ou salt previsível (e.g. timestamp visível, slot atual), um searcher pode brute-force a faixa esperada de preço (e.g. <2^40 base units = $1M USDC) em CPU-segundos.
- **Impacto:** Quebra parcial da mitigação MEV. O cooldown ainda dá 30s de head-start ao buyer legítimo, então o impacto é gradual e não crítico. Sem fund-loss; só leak de preço pré-reveal.
- **Recomendação:**
  - Documentar claramente no SDK que salt deve ser `crypto.randomBytes(8)`.
  - Aumentar salt para `[u8; 16]` (16 bytes = 2^128) sem custo significativo.
  - Adicionar guard de runtime: `require!(args.salt != 0, RoundfiError::SaltMustBeNonZero)` — fraco mas barato.
- **Esforço estimado:** XS.

---

### [SEV-014] Indexer decoder dessincronizado dos msg! do programa — eventos indexed incorretos

- **Severidade:** **Low**
- **Dimensão:** Qualidade de Código (Out-of-scope per AUDIT_SCOPE mas crítico para Phase 3)
- **Evidência:**
  - `services/indexer/src/decoder.ts:127-138` (`parseContribute` espera keys `member`, `installment`, `pool_float`, `on_time`)
  - `programs/roundfi-core/src/instructions/contribute.rs:226-229` (`msg!` emite keys `slot`, `on_time`, `solidarity`, `escrow`, `pool` — não `member` nem `installment`)
  - `programs/roundfi-core/src/instructions/claim_payout.rs:181-184` (msg começa com "payout", não "claim_payout"; emite `credit` em vez de `amount`; sem `recipient` ou `next_cycle`)
- **Descrição:** O decoder do indexer parsa formato diferente do que o programa emite. `parseContribute` joga exceções em `readBigInt` para keys ausentes; webhook handler engole. Resultado: eventos não populam o DB do indexer.
- **Impacto:** Indexer mostra eventos vazios. B2B oracle (Phase 3) terá data quality crítica baixa. Phase 1/2 ainda funcionam on-chain.
- **Recomendação:** Atualizar decoder + parity test entre `decoder.test.ts` e o output real do programa. Idealmente, gerar um teste de propriedade que compara msg! → decoder.parse → decoder.parse(msg!()) → roundtrip.
- **Esforço estimado:** S.

---

### [SEV-015] Commit-reveal listing sem cancel-path para Pending — slot DoS

- **Severidade:** **Low**
- **Dimensão:** Arquitetura & Design
- **Evidência:** `programs/roundfi-core/src/instructions/escape_valve_list_commit.rs` (cria listing Pending) — não há `cancel_pending_listing` instruction.
- **Descrição:** Seller commit cria `EscapeValveListing` em status `Pending`. O `escape_valve_list_reveal` só transiciona Pending → Active. Não há instrução para cancelar Pending. Seller pode abandonar o reveal indefinidamente, locking o slot.
- **Impacto:** Seller (não-adversário): perde acesso ao escape valve se mudou de ideia entre commit e reveal. Adversarial: um membro pode commitar listings em loop em vários slots (mesmo slot é um, mas múltiplos pools) — não é vetor de extração mas é polêmica UX.
- **Recomendação:** Adicionar `cancel_pending_listing` ix:
  ```rust
  pub fn cancel_pending_listing(ctx: Context<CancelPendingListing>) -> Result<()> {
      require!(listing.status == EscapeValveStatus::Pending as u8, ...);
      // close = seller_wallet — rent refunds to seller
      Ok(())
  }
  ```
  Sem time-lock — o seller pagou o rent, deve poder recuperar.
- **Esforço estimado:** S.

---

### [SEV-016] Shared escrow vault — defaults seizam tokens visíveis a release_escrow de outros membros

- **Severidade:** **Low**
- **Dimensão:** Arquitetura & Design
- **Evidência:**
  - `programs/roundfi-core/src/instructions/settle_default.rs:194-272` — transferem do escrow_vault (compartilhado) para pool_usdc_vault
  - `programs/roundfi-core/src/instructions/release_escrow.rs:104-105` — `require!(delta <= vault_amount)` (limita por vault total, não per-member)
- **Descrição:** O `escrow_vault` ATA é compartilhado entre todos os membros do pool. `settle_default` transfere do vault. Se o vault tem $V e member B quer release $X tal que `X > V_after_seizure` mas `X <= member_B.escrow_balance`, o release falha pelo guard de `vault_amount`. A invariância sum(member.balances) ≤ vault.amount é matematicamente correta no caminho normal, então este caso é improvável — mas é possível em edge cases de ordering / concurrent settle.
- **Impacto:** DoS temporário para release_escrow legítimo após default. Bookkeeping permanece correto; sem perda real.
- **Recomendação:** Substituir `require!(delta <= vault_amount, EscrowNothingToRelease)` por `delta = delta.min(vault_amount)` com log de warning — aceita parcial release. Ou aceitar que defaults são raros e deixar como é, documentando a corner case.
- **Esforço estimado:** XS.

---

### [SEV-017] join_pool aceita nft_asset como Signer arbitrário — colisão de wallet de membro

- **Severidade:** **Informational**
- **Dimensão:** Qualidade de Código
- **Evidência:** `programs/roundfi-core/src/instructions/join_pool.rs:103-106` — `pub nft_asset: UncheckedAccount<'info>` com `#[account(mut, signer)]`. É documentado como "fresh keypair".
- **Descrição:** O caller fornece um Keypair fresh como `nft_asset`. Anchor não valida que é fresh — só que assina. Se o caller passa um signer existente (e.g. mainnet wallet com saldo), mpl-core's `CreateV2` falha pois o address já existe — OK. Mas o caller pode fazer engenharia social com display names "RoundFi Position #X" e usar isso para confundir users.
- **Impacto:** Phishing potential (display name). Não há fund-loss direto. Esthético/UX risk.
- **Recomendação:** Documentar no SDK que o `nft_asset` keypair deve ser gerado pelo client e descartado após. Não precisa fix on-chain.
- **Esforço estimado:** XS.

---

### [SEV-018] settle_default bypassa pause flag — design intencional, mas merece destaque

- **Severidade:** **Informational**
- **Dimensão:** Segurança / Arquitetura
- **Evidência:** `programs/roundfi-core/src/instructions/settle_default.rs:51-54` (comment) — "settle_default bypasses the pause flag intentionally — funds must never be locked indefinitely"
- **Descrição:** Decisão de design boa em princípio (evita lock perpétuo), mas combina perigosamente com SEV-002 (grace de 60s). Se mainnet for live com grace=60s e admin pausa pra investigar um incidente, defaults continuam a 60s. Membros default mid-pause.
- **Recomendação:** Reverter SEV-002 (grace=7d) fecha grande parte do risco. Adicionalmente, considerar um "emergency_pause_grace_override" que ESTENDE a janela quando paused (não bypassa, mas adiciona tempo). Ou aceitar e documentar.
- **Esforço estimado:** N/A — propagado por SEV-002.

---

### [SEV-019] CHANGELOG não menciona o yield-kamino c_token_account fix — auditoria de hardening pré-engagement incompleta

- **Severidade:** **Informational**
- **Dimensão:** Documentação
- **Evidência:** AUDIT_SCOPE.md lista 6 findings fechados pré-audit (#122-#127, #155) — nenhum sobre o c_token_account em yield-kamino.
- **Descrição:** Diz "harvest path promovido in-scope" — mas o **deposit path** também merece scrutiny, e o c_token_account é um achado clássico de Anchor que deveria ter sido pego no internal review.
- **Recomendação:** Após corrigir SEV-001, ajustar AUDIT_SCOPE.md e self-audit doc para refletir o que foi encontrado. Comunicação honest com auditores externos = relação de confiança.
- **Esforço estimado:** XS.

---

### [SEV-020] approved_yield_adapter pode ser locked apontando ao adapter vulnerável

- **Severidade:** **Informational** (consequencial a SEV-001)
- **Dimensão:** Arquitetura & Design / Segurança
- **Evidência:** `programs/roundfi-core/src/instructions/lock_approved_yield_adapter.rs:42-58`
- **Descrição:** O lock-flag é one-way. Se a authority dispara `lock_approved_yield_adapter` antes do SEV-001 ser corrigido, o protocolo fica permanentemente preso ao adapter vulnerável. Recovery exige deploy de um adapter v2 com program-id diferente E mudança via `update_protocol_config` — mas o `update_protocol_config` rejeita por `AdapterAllowlistLocked`. Único caminho é redeployar o `roundfi-core` inteiro (com program-id imutável → na prática, redeploy via Squads e migration completa).
- **Recomendação:** **NÃO** chamar `lock_approved_yield_adapter` em mainnet até que SEV-001 esteja patched e a versão patched do adapter esteja deployed e canary-validated. Documentar isto explicitamente no playbook ops.
- **Esforço estimado:** N/A — operacional.

---

## Plano de Remediação

### Fase 1 — Imediato (0-7 dias) — BLOCKER PARA MAINNET

- **SEV-001** (c_token_account unchecked) — S — Sem dependências. Inclui redeploy do `roundfi-yield-kamino`.
- **SEV-002** (GRACE_PERIOD_SECS=60) — XS — Sem dependências. Inclui redeploy do `roundfi-core`.
- **SEV-003** (lp_share_bps caller-controlled) — S — Inclui adição de campo em `ProtocolConfig` ou `Pool`. Redeploy `roundfi-core`.
- **SEV-004** (init_pool_vaults double-count) — S — Adicionar `vaults_initialized: bool`. Redeploy `roundfi-core`.
- **SEV-005** (close_pool sem state change) — S — Adicionar `PoolStatus::Closed`. Redeploy `roundfi-core`.
- **SEV-020** (não ativar lock_approved_yield_adapter) — N/A — Garantia operacional.

Total estimado: ~3-5 dias de dev + 2 dias de QA/canary devnet.

### Fase 2 — Curto prazo (1-4 semanas) — antes de canary mainnet

- **SEV-006** (treasury Pubkey validation) — S
- **SEV-007** (reputation level demotion) — S
- **SEV-008** (revoke weight at-attest-time) — XS-S
- **SEV-009** (webhook auth) — XS
- **SEV-011** (cargo audit gate) — S
- **SEV-012** (bankrun in CI) — M
- **SEV-013** (salt entropy guidance) — XS

### Fase 3 — Médio prazo (1-3 meses) — qualidade & maturidade

- **SEV-010** (B2B_API_KEY_SALT placeholder)
- **SEV-014** (indexer decoder)
- **SEV-015** (cancel_pending_listing)
- **SEV-016** (release_escrow partial)
- **SEV-017** (nft_asset doc)
- **SEV-018** (emergency-pause grace)
- **SEV-019** (CHANGELOG)
- Migration Anchor 0.31+ / Agave 2.x para destravar `cargo audit` real + IDL + bankrun no CI.
- Adoção do **lock_approved_yield_adapter** apenas APÓS canary mainnet validar a versão corrigida do adapter.

---

## Recomendações Estratégicas

1. **Implementar canary devnet stage entre dev e mainnet.** O salto direto de "DEVNET DEMO PATCH" para mainnet é como o `GRACE_PERIOD_SECS` chegou aqui. Um pre-mainnet stage com configurações idênticas à mainnet (grace=7d, todas as caps, todas as locks DESLIGADAS para testar mudanças) pega regressões antes que o codigo deployado seja imutável.
2. **Adotar build-time / deploy-time validation profiles.** Crie `mainnet.toml` e `devnet.toml` com constantes esperadas. Use `compile_error!` ou script CI para rejeitar deploy se o build atual não bate com o profile alvo.
3. **Externalizar mais policy para `ProtocolConfig`.** Constantes em código devem ser **tuneáveis em runtime** quando representam policy (não law-of-physics). Candidatos: `GRACE_PERIOD_SECS`, `REVEAL_COOLDOWN_SECS`, `DEFAULT_LP_SHARE_BPS`, todos os `STAKE_BPS_LEVEL_X`. Mantém constants para tipos puros (`MAX_BPS`, `MAX_MEMBERS`).
4. **Restringir permissionlessness do crank.** `deposit_idle_to_yield`, `harvest_yield`, `settle_default` são permissionless por liveness — bom em princípio. Mas o argumento que vem do caller (lp_share_bps, slippage, c_token_account via remaining_accounts) deve sempre ser tratado como adversarial. Auditar TODO call site permissionless com checklist: "Se um atacante chama isto com argumentos máximos hostis, o pior caso é DoS — nunca fund loss / policy break".
5. **Bug bounty antes de mainnet — não só "Q4 2026" pós-launch.** Bug bounty no devnet (mesmo com payouts pequenos) cria pressure pra encontrar achados como SEV-001 antes que sejam fund-loss reais.
6. **Adevar Labs follow-up: re-auditar após Fase 1 + bankrun-em-CI live.** A correção do c_token_account é o caminho crítico que merece um re-look específico antes do canary mainnet.

---

## Testes Sugeridos

### Cargo-fuzz / proptest (adicionar ao `crates/math/fuzz`)

- **fuzz_target: lp_share_bps oracle** — Verificar que para todos `(yield, gf_room, fee_bps, lp_bps)`, o `waterfall` retorna conservação e nenhum bucket excede limites (já existe, mas ampliar para descobrir oscilações em valores extremos de gf_room).
- **fuzz_target: tvl_cap_cascade** — Sequência de `create_pool / init_pool_vaults / close_pool` random, alegando que `committed_protocol_tvl_usdc` corresponde a `sum(pool_committed for pools in active set)`.

### Bankrun negativos (adicionar ao `tests/security_audit_paths.spec.ts` ou similar)

- **SEV-001 negative test:** Construir `deposit_idle_to_yield` tx com `c_token_account` de outra owner, esperar revert. **Bloqueador para SEV-001 fix accept.**
- **SEV-002 negative test:** Setar grace para 7 dias, advance clock 6 days, settle_default deve falhar com `GracePeriodNotElapsed`.
- **SEV-003 negative test:** Não-pool-authority caller tenta `harvest_yield(lp_share_bps = 0)`, deve falhar com `Unauthorized` (após fix).
- **SEV-004 negative test:** Pool authority chama `init_pool_vaults` 2x, segunda chamada falha com `VaultsAlreadyInitialized`.
- **SEV-005 negative test:** `close_pool` chamado 2x — segunda falha com `PoolNotCompleted` (pois status = `Closed`).
- **SEV-006 negative test:** Propose treasury com pubkey de wallet (sem ATA): falha.
- **SEV-007 positive test:** Membro Veteran → default → join novo pool → assert trusted_level == 1.

### Invariant tests (encoder property + on-chain)

- **inv: Sum of all member.escrow_balance + member.stake_deposited == pool.escrow_balance == escrow_vault.amount**, em qualquer ponto do lifecycle (já parcialmente coberto, formalizar).
- **inv: committed_protocol_tvl_usdc == sum(p.credit_amount * p.cycles_total for p in active_pools)**.
- **inv: After settle_default, dc_invariant_holds(d_init, d_rem, c_init, c_rem) is true** (já no handler como require, levantar para teste contínuo).

### Verificação formal (Coq/Lean) — opcional

- D/C invariant (`crates/math/src/dc.rs`) é o candidato mais maduro. Sketch: provar que `max_seizure_respecting_dc` retorna um `seizure` tal que `dc_invariant_holds(d_init, d_rem, c_init, c_before - seizure)` para todos os inputs onde a invariant já vale pre-seizure.
- Conservação do waterfall (`crates/math/src/waterfall.rs`) também é direto.

---

## Riscos Residuais Restantes

1. **Compromisso de chave authority** (multisig 3-of-5). Padrão para qualquer protocolo. Mitigado por Squads + treasury timelock + lock-flags, mas residual.
2. **Reorg / RPC pintura.** Indexer pode reportar estado obsoleto se Helius webhook chega antes da finality. Documentado em `docs/security/indexer-threat-model.md`, fora do trust path on-chain.
3. **Kamino program update** — Kamino é um deps externo. Se Kamino mudar IDL ou semântica de `deposit_reserve_liquidity`, o adapter pode quebrar silenciosamente. Mitigado pelo `state.kamino_reserve/market` pin + discriminator-stable tests, mas mudanças semânticas downstream não são detectáveis sem re-CPI testing.
4. **mpl-core 0.8 confusão de Pubkey** — Documentado no CI lane do anchor; rastreado para post-Agave-2.x. Hoje só BPF build.
5. **Front-end → Wallet → On-chain trust path** — Out-of-scope per AUDIT_SCOPE. Phishing-resistance via hardware wallet badge é mitigação parcial.
6. **Phase 3 B2B oracle abuse** — Subscription model não auditado aqui; quando shipped, requer auditoria separada (rate limiting, sybil em querents, etc.).
7. **Defaulted member re-entry com wallet nova** — Já documentado (não conta como bug, mas reduz qualidade do behavioral score se sybil grande).

---

## Anexos

### Comandos executados durante a auditoria

```bash
# Repo inspection
git log -1 --format="%H %s"   # → fbc931e8c37a9a923cdcbba51f9d0e2d286a9b12
git status                     # → clean
find programs -name "*.rs" | xargs wc -l   # → 8593 total
find crates -name "*.rs" | xargs wc -l     # → 1764 total
find tests -name "*.ts" | xargs wc -l      # → 12957 total

# Static patterns
grep -rn "DEVNET DEMO PATCH\|HACK\|temporary" --include="*.rs"
grep -rn "unwrap()\|expect(" programs/ --include="*.rs" | grep -v test
grep -rn "saturating_sub\|saturating_add" programs/roundfi-core/src/instructions/
grep -rn "permissionless\|anyone can\|any caller" programs/roundfi-core/src/ -i
grep -rn "UncheckedAccount" programs/roundfi-yield-kamino/src/lib.rs
grep -rn "B2B_API_KEY_SALT\|change-me-before-prod" --include="*.ts"
```

### Cobertura de leitura manual (arquivos > 50% lidos integralmente)

- `programs/roundfi-core/src/lib.rs` (185 LoC) — 100%
- `programs/roundfi-core/src/instructions/escape_valve_buy.rs` (440 LoC) — 100%
- `programs/roundfi-core/src/instructions/settle_default.rs` (371 LoC) — 100%
- `programs/roundfi-core/src/instructions/harvest_yield.rs` (331 LoC) — 100%
- `programs/roundfi-core/src/instructions/claim_payout.rs` (235 LoC) — 100%
- `programs/roundfi-core/src/instructions/contribute.rs` (288 LoC) — 100%
- `programs/roundfi-core/src/instructions/join_pool.rs` (380 LoC) — 100%
- `programs/roundfi-core/src/instructions/create_pool.rs` (218 LoC) — 100%
- `programs/roundfi-core/src/instructions/init_pool_vaults.rs` (212 LoC) — 100%
- `programs/roundfi-core/src/instructions/escape_valve_list.rs` (116 LoC) — 100%
- `programs/roundfi-core/src/instructions/escape_valve_list_commit.rs` (107 LoC) — 100%
- `programs/roundfi-core/src/instructions/escape_valve_list_reveal.rs` (99 LoC) — 100%
- `programs/roundfi-core/src/instructions/release_escrow.rs` (147 LoC) — 100%
- `programs/roundfi-core/src/instructions/close_pool.rs` (96 LoC) — 100%
- `programs/roundfi-core/src/instructions/deposit_idle_to_yield.rs` (180 LoC) — 100%
- `programs/roundfi-core/src/instructions/update_protocol_config.rs` (161 LoC) — 100%
- `programs/roundfi-core/src/instructions/propose_new_treasury.rs` (69 LoC) — 100%
- `programs/roundfi-core/src/instructions/commit_new_treasury.rs` (70 LoC) — 100%
- `programs/roundfi-core/src/instructions/cancel_new_treasury.rs` (55 LoC) — 100%
- `programs/roundfi-core/src/instructions/lock_treasury.rs` (51 LoC) — 100%
- `programs/roundfi-core/src/instructions/lock_approved_yield_adapter.rs` (58 LoC) — 100%
- `programs/roundfi-core/src/instructions/pause.rs` (45 LoC) — 100%
- `programs/roundfi-core/src/instructions/initialize_protocol.rs` (125 LoC) — 100%
- `programs/roundfi-core/src/constants.rs` (228 LoC) — 100%
- `programs/roundfi-core/src/error.rs` (145 LoC) — 100%
- `programs/roundfi-core/src/state/pool.rs` (242 LoC) — 100%
- `programs/roundfi-core/src/state/member.rs` (233 LoC) — 100%
- `programs/roundfi-core/src/state/config.rs` (137 LoC) — 100%
- `programs/roundfi-core/src/state/listing.rs` (61 LoC) — 100%
- `programs/roundfi-core/src/cpi/yield_adapter.rs` (144 LoC) — 100%
- `programs/roundfi-core/src/cpi/reputation.rs` (173 LoC) — 100%
- `programs/roundfi-core/src/math/mod.rs` (171 LoC) — 100%
- `programs/roundfi-reputation/src/lib.rs` (105 LoC) — 100%
- `programs/roundfi-reputation/src/instructions/attest.rs` (276 LoC) — 100%
- `programs/roundfi-reputation/src/instructions/promote_level.rs` (65 LoC) — 100%
- `programs/roundfi-reputation/src/instructions/revoke.rs` (101 LoC) — 100%
- `programs/roundfi-reputation/src/instructions/initialize_reputation.rs` (60 LoC) — 100%
- `programs/roundfi-reputation/src/instructions/init_profile.rs` (53 LoC) — 100%
- `programs/roundfi-reputation/src/constants.rs` (52 LoC) — 100%
- `programs/roundfi-reputation/src/identity/passport.rs` (245 LoC) — 100%
- `programs/roundfi-yield-kamino/src/lib.rs` (755 LoC) — 100%
- `programs/roundfi-yield-mock/src/lib.rs` — parcial (deploy path para entender simetria com Kamino)
- `crates/math/src/dc.rs` (269 LoC) — 100%
- `crates/math/src/waterfall.rs` (259 LoC) — 100%
- `crates/math/src/seed_draw.rs` (133 LoC) — 100%
- `crates/math/src/escrow_vesting.rs` (127 LoC) — 100%
- `services/indexer/src/server.ts` (149 LoC) — 100%
- `services/indexer/src/webhook.ts` (164 LoC) — 100%
- `services/indexer/src/decoder.ts` (169 LoC) — 100%
- `app/src/lib/walletAllowlist.ts` (88 LoC) — 100%

### Cobertura parcial (lido o suficiente para inferir intent)

- `.github/workflows/ci.yml`, `fuzz.yml`
- Vários arquivos auxiliares de `app/`, `sdk/`, `services/orchestrator/`
- AUDIT_SCOPE.md, SECURITY.md, .env.example

### Não auditado em profundidade — recomenda-se análise complementar

- **Caminho completo `services/orchestrator`** — devnet-only, mas cranks rodam contra programas em produção também.
- **`sdk/src/onchain-raw.ts`** e demais encoders TS — paridade já testada, mas property tests + fuzz seriam reforço.
- **App / wallet adapter / phishing flow** — out-of-scope per AUDIT_SCOPE.
- **`crates/math/src/cascade.rs`** — lido só superficialmente; usado por `seize_for_default`.
- **Reputation: link_passport_identity, refresh_identity, unlink_identity, update_reputation_config, get_profile** — lido parcialmente; sem achados em scaling rápido, mas merecem segunda passada.
- **Reproducible-build attestation flow** (`docs/verified-build.md`) — não auditado.

---

_Relatório fechado em 2026-05-15._
_— Adevar Labs._
