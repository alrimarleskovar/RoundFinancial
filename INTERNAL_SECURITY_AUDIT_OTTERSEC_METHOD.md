# Relatório de Auditoria de Segurança Interna — RoundFinancial

**Conduzido por:** Adevar Labs (auditoria interna)
**Metodologia:** Padrão OtterSec — auditoria adversarial de Web3 (referência de método; sem envolvimento ou endosso da OtterSec)
**Data:** 2026-05-24
**Commit Auditado:** `fdf356f632ac55f2b72e4a21e5bf055ce2cad25e`
**Escopo:** Auditoria de segurança Web3 (off-chain + on-chain conforme detectado)

> _Auto-auditoria interna. Não representa uma auditoria conduzida ou endossada pela OtterSec. Achados são deste passe adversarial independente; a numeração `SEV-A…` é própria e não se confunde com o tracker interno `SEV-0xx` da equipe._

---

## Composição do Repositório e Escopo Adotado (Etapa 0)

Medição real (`git ls-files`), não declarada:

| Tipo | Arquivos | Observação |
|---|---|---|
| `.rs` (Rust/Anchor) | 83 (~11.4k LoC em `programs/` + 3k em `crates/math`) | **lógica de valor** |
| `.ts` / `.tsx` | 249 (~52k LoC em `app/`) | front-end Next.js |
| `.ts` (services) | ~4.6k LoC | `orchestrator` (ops/demo) + `indexer` (display) |

**Onde vive a lógica sensível (medido, não assumido):**

- **Movimento de valor, autorização e cálculo de saldo são 100% on-chain** nos 3 programas Anchor (`roundfi-core`, `roundfi-reputation`, `roundfi-yield-kamino`). A matemática econômica está isolada em `crates/math` (puro, testado com proptest + 6 alvos cargo-fuzz).
- **O `app/` não tem nenhuma rota de API, server action, verificação de assinatura no servidor nem manuseio de chaves** (`grep` por `use server|NextResponse|getServerSession|signMessage|nacl|ecrecover|jwt` → **zero matches**). É um dApp client-side puro: o usuário assina as próprias transações via wallet adapter. Não há trust boundary cliente/servidor monetário.
- **O `indexer/` é estritamente read-only/display** (Helius webhook → Postgres), idempotente por `txSignature UNIQUE`, e — confirmado no código — **nunca está no caminho de movimento de fundos**. O `orchestrator/` é ferramenta de ops/demo; chaves vêm de paths em env, não embutidas.

**Distribuição de esforço adotada:** ~85% on-chain (Seção 3A — é onde está todo o dinheiro), ~10% na ponte off/on-chain (indexer/idempotência) e na cadeia de suprimentos (deps), ~5% em segredos/histórico. Isto contraria o `AUDIT_SCOPE.md` (que marca `app/`, `indexer/`, `sdk/` como out-of-scope), mas a medição confirma que a decisão correta é concentrar fogo on-chain — não por respeitar o escopo declarado, e sim porque é factualmente onde o valor se move.

**Ferramentas:** disponíveis e executadas — `pnpm audit` (saída real no Anexo A), `cargo` (compilação/testes presentes), varredura de segredos por regex no histórico completo. **Não disponíveis no ambiente:** `gitleaks`, `cargo-audit`, `semgrep`, `slither`, `trivy` (não instalados; sem rede para instalar com confiança). Declaro isto explicitamente — onde uma ferramenta não rodou, não invento sua saída.

---

## Sumário Executivo

RoundFinancial é um protocolo ROSCA (consórcio/"junta" rotativa) on-chain na Solana. Membros entram em slots de um pool, depositam colateral (stake) proporcional ao seu **nível de reputação** (regra 50-30-10: L1=50%, L2=30%, L3=10% do crédito), contribuem por ciclo, e o recebedor rotativo de cada ciclo saca o crédito (`credit_amount`). Inadimplência é resolvida por um *crank* permissionless (`settle_default`) que apreende solidariedade → escrow → stake numa cascata determinística sujeita a um invariante D/C. Há um waterfall de yield (Kamino Lend CPI real) e um mercado secundário de posições ("escape valve") com NFTs mpl-core e commit-reveal anti-MEV.

**O código é genuinamente de alta qualidade e fortemente endurecido.** A matemática está extraída em crate puro com proptests e conservação verificada; toda CPI externa (reputação, yield-adapter, Kamino) é tratada como não-confiável com guarda de program-id + contabilidade por *delta* de saldo; layouts de conta de CPI têm "oráculos" pinados por teste unitário (classe SEV-041); timelocks de 7 dias em rotação de tesouraria/autoridade; bitmap de slots correto; aritmética com `u128`/`checked_*` em toda parte. A maioria dos vetores clássicos (substituição de programa, reentrância via close, double-payout por slot, over-seizure, drift de fee caller-controlled) **já está fechada**.

**Os 3 riscos mais relevantes deste passe:**

1. **[SEV-A · High] Farming de reputação para baixar colateral.** O incremento de score `SCHEMA_PAYMENT` (+10) **não tem rate-limit global por subject** — só por-pool-por-ciclo. Um atacante cria N pools de 1 membro baratos, contribui uma vez em cada, e acumula score sem limite, chegando a L3 (stake de apenas 10%) por custo de centavos + taxas. Isso **derrota exatamente o controle anti-sybil que a equipe construiu** (o cooldown global de 6 dias do `CYCLE_COMPLETE`), porque o caminho `PAYMENT` o contorna. Com colateral L3, o ataque clássico "saca cedo e some" (early-payout-default) fica lucrativo. A mitigação real (camada de identidade Civic/Passport) **não está aplicada no `join_pool`/`promote_level`** (provider "TBD post-mainnet").
2. **[SEV-B · Medium] `lp_distribution_balance` não é reservado.** `claim_payout` e `deposit_idle_to_yield` só protegem `guarantee_fund_balance` ao calcular o saldo gastável; o earmark de LP (Anjos de Liquidez) que o waterfall acumula no mesmo cofre é tratado como gastável → subcolateralização latente da obrigação de LP quando o saque de LP (M3) entrar.
3. **[SEV-C · informativo/baixo] Cadeia de suprimentos:** `pnpm audit` real reporta **7 high / 12 moderate / 2 low / 0 critical** — destaque `bigint-buffer` (overflow, no caminho de decode Solana) e várias do `next` (DoS/XSS no app client-side). Saída real no Anexo A.

**Recomendação geral:** **requer correções antes de mainnet GA.** Nenhum *critical* explorável de drenagem direta foi encontrado neste passe no estado atual do código. SEV-A é o achado de maior impacto econômico e deve ser tratado antes de qualquer pool real com tiers de reputação ativos. As demais são endurecimento/dívida. Para um produto que adverte estar em caminho devnet→canary→GA com auditoria externa pendente, a postura é coerente; SEV-A é a lacuna que o passe externo precisa re-validar.

---

## Visão Geral do Protocolo e Invariantes Chave

Componentes críticos: Pool (PDA `[b"pool", authority, seed_id]`), Member (`[b"member", pool, wallet]`), 3 cofres por pool (escrow, solidariedade, yield), config global, perfil de reputação (`[b"reputation", wallet]`), listagens do mercado secundário, e o adapter de yield Kamino.

**Invariantes fundamentais (devem valer sempre):**

- **I1 — D/C:** após apreensão, `d_remaining · c_initial ≤ c_after · d_initial` (apreende menos a violar). ✔ verificado em `crates/math/src/dc.rs` + `cascade.rs` (sweep exaustivo).
- **I2 — Conservação do waterfall:** `fee + gf + lp + participants == yield`. ✔ verificado (`waterfall.rs`, proptest).
- **I3 — Slot único → payout único:** bitmap rejeita slot duplicado; `claim_payout` exige `slot_index == cycle` + `!paid_out`. ✔
- **I4 — Adapter/CPI não-confiável:** verdade é o delta de saldo on-chain, não o retorno do programa externo. ✔ (`cpi/yield_adapter.rs`, `harvest_yield.rs`).
- **I5 — Colateral por nível derivado on-chain:** `join_pool` lê `profile.level` do PDA de reputação, não do cliente. ✔ *mas o `profile.level` em si é forjável economicamente — ver SEV-A.* ⚠
- **I6 — GF nunca drenado por payout:** `claim_payout` reserva `guarantee_fund_balance`. ✔ **— mas não reserva o earmark de LP — ver SEV-B.** ⚠
- **I7 (ponte off/on):** DB nunca à frente do estado on-chain; idempotência por evento. ✔ por design (indexer read-only, `txSignature UNIQUE`).

---

## Sumário da Modelagem de Ameaças

Superfícies de ataque (on-chain): cranks permissionless (`settle_default`, `harvest_yield`, `deposit_idle_to_yield`), entrada de membros (`join_pool` lê reputação), mercado secundário (`escape_valve_*` + mpl-core), governança (config/treasury), e a CPI de reputação que **transforma eventos econômicos em score** que por sua vez **define colateral** — um laço de feedback econômico que é o alvo mais interessante.

Vetores priorizados por impacto econômico: (1) reduzir colateral artificialmente e dar calote cedo [SEV-A]; (2) consumir fundos earmarked [SEV-B]; (3) MEV no listing-race (já mitigado por commit-reveal + cooldown, ver doc da equipe); (4) substituição de adapter / over-withdraw (fechado por program-id pin + delta); (5) griefing via crank (fechado: grace de 7 dias + cascata limitada por D/C).

---

## Achados Detalhados

### [SEV-A] Reputação (e portanto colateral) é forjável economicamente via farming de `SCHEMA_PAYMENT`

- **Severidade:** High
- **Categoria:** Money handling / design econômico / anti-sybil
- **Vulnerabilidade:** O nível de reputação determina o colateral exigido (`stake_bps_for_level`: L1=5000bps, L2=3000, L3=1000 — `programs/roundfi-core/src/constants.rs:115`). O nível é derivado do `profile.score` (`promote_level.rs`, thresholds L2=500 / L3=2000 em `roundfi-reputation/src/constants.rs:59`). O score é incrementado por `SCHEMA_PAYMENT` (+10, `attest.rs:235`) emitido a cada `contribute`. **O único rate-limit sobre `SCHEMA_PAYMENT` emitido pelo caminho pool-PDA é estrutural "um por membro por ciclo por pool"** — não existe cooldown global por *subject* (o cooldown global de 6 dias só cobre `SCHEMA_CYCLE_COMPLETE`, `attest.rs:191-195` + `constants.rs:37`). O issuer-check em `is_valid_pool_issuer` (`attest.rs:328`) só exige que o issuer seja um PDA de pool válido derivado sob o `roundfi_core_program` — e **qualquer pessoa pode criar quantos pools quiser** (`create_pool` é permissionless).
- **Evidência:**
  - `programs/roundfi-reputation/src/instructions/attest.rs:191-239` — cooldown só em `CYCLE_COMPLETE`; `PAYMENT` aplica `+10` sem checagem temporal por subject.
  - `programs/roundfi-core/src/instructions/join_pool.rs:166-178` — colateral derivado de `profile.level` (sem exigência de identidade verificada).
  - `programs/roundfi-reputation/src/instructions/promote_level.rs:33-46` — promoção permissionless, sem gate de identidade.
  - `programs/roundfi-reputation/src/constants.rs:28-37` — o próprio docstring afirma que o objetivo do cooldown é "prevent a sybil farm from rapidly completing 10 fake pools and ladder-jumping to level 3" — exatamente o ataque que o caminho `PAYMENT` continua permitindo.
- **Impacto:** Um atacante chega a L3 (colateral 10% em vez de 50%) por custo desprezível (taxas de tx + rent largamente recuperável + USDC mínimo). Em pool real (default: crédito 10.000 USDC), entra como L3 com stake de **1.000 USDC**, pega o slot 0, contribui o ciclo 0 (600 USDC), saca **10.000 USDC** no `claim_payout` do ciclo 0, e então deixa de contribuir → `settle_default` só consegue apreender ~stake (1.000) + escrow do ciclo 0 (~150) limitado por D/C. **Lucro líquido da ordem de ~8.000 USDC por pool**, absorvido pelos demais membros + guarantee fund. Quebra o invariante econômico central (colateral só barato para confiança comprovada).
- **Cenário de Exploração:**
  1. Atacante (carteira W) roda em paralelo ~200–400 vezes: `create_pool(members_target=1, cycles_total=1, credit pequeno, installment viável)` → `init_pool_vaults` → `join_pool` (W, slot 0) → `contribute(cycle=0)`. Cada `contribute` emite `SCHEMA_PAYMENT` para W. ~200 (verificado, +10) ou ~400 (não-verificado, +5) eventos ⇒ score ≥ 2000.
  2. `promote_level(W)` → L3.
  3. W entra num pool real de 24 membros como L3 (stake 10%), escolhe slot 0.
  4. Demais membros contribuem o ciclo 0; W contribui 1 parcela e `claim_payout(cycle=0)` recebe o crédito cheio.
  5. W para de contribuir; após a janela de graça, `settle_default` apreende só a fração L3. W já saiu com o crédito.
- **Prova de Conceito (PoC):** `NÃO-EXECUTADO / análise estática`. Esboço determinístico (pseudo-TS sobre o SDK):
  ```ts
  // farm L3 — repetir N vezes em paralelo (pools independentes, sem rate-limit global)
  for (let i = 0; i < 400; i++) {
    const seed = randomU64();
    await core.createPool({ seedId: seed, membersTarget: 1, cyclesTotal: 1,
                            installmentAmount: 3n, creditAmount: 2n, escrowReleaseBps: 2500 });
    await core.initPoolVaults(seed);
    await core.joinPool({ seedId: seed, slotIndex: 0, reputationLevel: <atual>, uri: "https://x" });
    await core.contribute({ seedId: seed, cycle: 0 }); // emite SCHEMA_PAYMENT(+) p/ W
  }
  await reputation.promoteLevel(W); // score >= 2000 ⇒ level = 3
  // agora joinPool num pool real com stake 10% e executar early-payout-default
  ```
- **Mitigação Recomendada:**
  - **(Mínima)** Aplicar cooldown global por subject também a `SCHEMA_PAYMENT` (e/ou tornar `promote_level` para L2/L3 condicionado a `total_participated`/`cycles_completed` reais, que JÁ são limitados pelo cooldown de 6 dias). Tornar o ganho de nível função de ciclos *completados* (rate-limited) e não de pagamentos individuais fecha o vetor sem nova infra.
  - **(Arquitetural)** Exigir `IdentityRecord` verificado para promoção a L2/L3 (a camada Civic/Passport já tem scaffold) — torna o farming Sybil-resistant de fato. Hoje a resistência depende apenas do custo econômico, que é baixo.
  - Considerar exigir que o recebedor do payout esteja em dia (e/ou exigir N contribuições antes de slots de payout cedo) para reduzir a lucratividade do early-default independentemente do nível.
- **Esforço Estimado:** M

---

### [SEV-B] `lp_distribution_balance` não é reservado em `claim_payout`/`deposit_idle_to_yield`

- **Severidade:** Medium (latente; sobe para High quando o saque de LP — M3 — for implementado)
- **Categoria:** Money handling / contabilidade
- **Vulnerabilidade:** O waterfall (`harvest_yield.rs:326`) acumula a fatia de LP em `pool.lp_distribution_balance`, com os tokens permanecendo fisicamente no `pool_usdc_vault` (earmark lógico, igual ao Guarantee Fund). Porém o cálculo de saldo gastável só subtrai `guarantee_fund_balance`:
  - `claim_payout.rs:123-127` — `spendable = pool_usdc_vault.amount.saturating_sub(pool.guarantee_fund_balance)` (não subtrai `lp_distribution_balance`).
  - `deposit_idle_to_yield.rs:89-91` — `spendable_idle = vault_before.saturating_sub(gf_earmark)` (idem).
- **Evidência:** `programs/roundfi-core/src/instructions/claim_payout.rs:120-131`; `.../deposit_idle_to_yield.rs:84-91`; acúmulo em `.../harvest_yield.rs:320-329`.
- **Impacto:** Fundos destinados a LPs são gastáveis como crédito de payout (ou movidos ao adapter). Como o caminho de saque de LP ainda não existe, **não há perda direta hoje**; mas quando o saque de LP entrar, o cofre pode estar abaixo de `lp_distribution_balance` → obrigação de LP subcolateralizada / insolvência parcial do bucket de LP. É a mesma classe de bug que o earmark do GF foi explicitamente projetado para evitar — apenas omitida para o LP.
- **Cenário de Exploração:** Após harvests acumularem LP earmark, payouts sucessivos consomem o cofre até abaixo de `gf + lp`. Quando `withdraw_lp` (M3) tentar pagar `lp_distribution_balance`, falta lastro.
- **Prova de Conceito (PoC):** `NÃO-EXECUTADO / análise estática`. Diferença basta: `spendable` deveria ser `vault - guarantee_fund_balance - lp_distribution_balance`.
- **Mitigação Recomendada:** Subtrair também `lp_distribution_balance` em ambos os pontos:
  ```rust
  let reserved = pool.guarantee_fund_balance
      .checked_add(pool.lp_distribution_balance).ok_or(MathOverflow)?;
  let spendable = pool_usdc_vault.amount.saturating_sub(reserved);
  ```
  Risco de regressão baixo; alinha o LP ao tratamento já dado ao GF. Adicionar invariante de teste `vault >= gf + lp` pós-payout.
- **Esforço Estimado:** S

---

### [SEV-C] Vulnerabilidades de dependências (saída real de `pnpm audit`)

- **Severidade:** Low–Medium (contextual; maioria no app client-side, fora do caminho de fundos)
- **Categoria:** Cadeia de suprimentos
- **Vulnerabilidade / Evidência:** Saída **real** (Anexo A): **0 critical / 7 high / 12 moderate / 2 low**. Destaques:
  - `bigint-buffer` (**high**, buffer overflow em `toBigIntLE()`) — transitiva do stack `@solana/spl-token`; está no caminho de decode client-side. Impacto real baixo nesta utilização (buffers de tamanho controlado pelo protocolo), mas deve ser atualizada/substituída.
  - `next` (**várias high/moderate**: DoS via Server Components, SSRF em WebSocket upgrades, XSS no App Router, cache poisoning, smuggling) — app Next.js client-side; relevante para disponibilidade/integridade da UI, **não para os fundos** (que são on-chain). Atualizar `next` resolve a maioria (o `actions.update` do audit aponta `app>next`).
  - `serialize-javascript` (**high**, RCE via RegExp/Date) e `ws`/`postcss`/`uuid` (moderate) — provavelmente dev/build; confirmar se chegam a runtime.
- **Impacto:** Sem impacto direto on-chain. Risco de DoS/XSS no front e overflow de decode.
- **Mitigação Recomendada:** `pnpm update next` (cobre o grosso), e bump de `bigint-buffer`/`serialize-javascript`. Rodar `cargo-audit` no CI Rust (não disponível neste ambiente — ainda não executado).
- **Esforço Estimado:** S

---

### [SEV-D] Indexer confia em strings de `msg!` como fonte de eventos (spoofing de display)

- **Severidade:** Low / Informational
- **Categoria:** Ponte off/on-chain
- **Vulnerabilidade:** `services/indexer/src/webhook.ts` parseia `meta.logMessages` (`parseLogMessages`) sem filtrar por program-id/origem-CPI dentro deste handler. Se um atacante conseguir POSTar webhooks forjados (precisa do `HELIUS_WEBHOOK_SECRET`) ou emitir logs com o mesmo formato a partir de outro programa numa tx, eventos espúrios poderiam ser indexados.
- **Evidência:** `services/indexer/src/webhook.ts:60-151` (parse + upsert a partir de logs).
- **Impacto:** **Somente display.** Confirmado fora do caminho de movimento de fundos; `txSignature UNIQUE` garante idempotência. Sem perda de fundos.
- **Mitigação Recomendada:** Validar o `HELIUS_WEBHOOK_SECRET` no `server.ts` (confirmar que ocorre antes deste handler) e filtrar logs por `ROUNDFI_CORE_PROGRAM_ID`/program invocation antes de indexar. Tratado em parte por #234 (reconciler).
- **Esforço Estimado:** S

---

### Informativos / observações de menor risco

- **INF-1 — Pin do Kamino não verificado contra mainnet vivo.** `KAMINO_LEND_PROGRAM_ID` e o layout de 12 contas estão pinados por teste de oráculo, mas a verificação contra o IDL/endereço publicado da Kamino é declaradamente pendente (#233 part B). Risco operacional, não de código; manter o gate pré-mainnet.
- **INF-2 — `fee_bps_cycle_l1/l2/l3` capadas em 100% (`MAX_BPS`) e aparentemente não aplicadas em `claim_payout`** (não há dedução de fee de ciclo no payout). Campos possivelmente vestigiais; remover ou aplicar para evitar confusão e cap perigoso latente.
- **INF-3 — Sem `cargo-audit`/`gitleaks`/`semgrep`/`slither` no ambiente.** Não executados (não instalados, sem rede confiável). Recomendo adicioná-los ao CI; este relatório não substitui suas saídas.
- **INF-4 — Segredos:** `.env.example` usa placeholders e *paths* de keypair (`./keypairs/*.json`), `keypairs/` só tem `.gitkeep`, e a varredura por regex no histórico completo (`git log -p --all`) **não encontrou chaves privadas, byte-arrays de keypair, nem tokens de API**. Bom higiene. (Varredura por regex, não por entropia — um `gitleaks` real ainda é recomendado.)

---

## Invariantes Sugeridos para Teste / Verificação Formal

1. **Reputação não-farmável:** "score ganho por unidade de tempo real por subject é limitado independentemente do número de pools" — property test sobre `attest` com N pools paralelos (cobre SEV-A).
2. **Reserva de earmarks:** pós-`claim_payout` e pós-`deposit_idle_to_yield`, `pool_usdc_vault.amount >= guarantee_fund_balance + lp_distribution_balance` (cobre SEV-B).
3. **Conservação de valor por pool:** `Σ contribuições + Σ yield realizado == Σ payouts + Σ apreensões + saldos de cofre + fees à tesouraria` (fuzzing de sequências contribute/claim/harvest/settle).
4. **Lucratividade de default limitada:** para qualquer nível L, `credit_recebido_cedo − colateral_apreendível` não deve exceder a cobertura de solidariedade+GF (modela o risco econômico residual de early-default).
5. **D/C sob concorrência:** sequência `settle_default` vs `contribute` tardio na mesma fronteira de ciclo (já parcialmente coberto; formalizar).

---

## Riscos Residuais e Considerações Finais

- **Early-payout-default é um risco econômico estrutural do modelo ROSCA, não só do SEV-A.** Mesmo em L1 (50%), receber 100% do crédito cedo e dar calote é parcialmente lucrativo; o protocolo depende de solidariedade + guarantee fund + slashing de reputação + (futuramente) camada social/legal para desincentivar. SEV-A amplifica isso ao baratear o colateral. Monitorar a distribuição de `credit/colateral` por nível e a saúde do GF é essencial em mainnet.
- **A camada de identidade (Civic/Passport) é o pilar anti-sybil que ainda não está aplicado.** Enquanto promoção de nível e `join_pool` não exigirem identidade verificada, a resistência a Sybil é puramente econômica e fraca (SEV-A).
- **O código está bem à frente da média de protocolos pré-auditoria** — a disciplina de extração de math pura, oráculos de layout de CPI, contabilidade por delta e timelocks é exemplar. As lacunas remanescentes são de design econômico (SEV-A), contabilidade latente (SEV-B) e dívida operacional/cadeia de suprimentos.

---

## Anexos

### Anexo A — `pnpm audit` (saída real, resumo)

```
vulnerabilities: { info: 0, low: 2, moderate: 12, high: 7, critical: 0 }
high  bigint-buffer       Buffer Overflow via toBigIntLE()
high  serialize-javascript RCE via RegExp.flags / Date.prototype.toISOString()
high  next  DoS with Server Components (múltiplas entradas)
high  next  SSRF em aplicações usando WebSocket upgrades
high  next  Middleware/Proxy bypass (Pages Router + i18n)
moderate next  DoS via Image Optimizer / smuggling / XSS App Router (CSP nonces) / cache poisoning
moderate ws    Uninitialized memory disclosure
moderate postcss XSS via Unescaped </style>
moderate uuid  Missing buffer bounds check (v3/v5/v6)
low      next  cache poisoning / middleware redirect
(actions.update aponta `app>next` como principal resolução)
```

### Anexo B — Comandos executados

```bash
git rev-parse HEAD                     # fdf356f632ac55f2b72e4a21e5bf055ce2cad25e
git ls-files | sed 's/.*\.//' | sort | uniq -c | sort -rn   # composição de stack
grep -rniE "use server|NextResponse|signMessage|nacl|ecrecover|jwt" app/src  # → 0 matches (sem backend monetário)
pnpm audit --json                      # Anexo A (0 critical / 7 high / 12 mod / 2 low)
git log -p --all -- '*.env' '*.json' '*.ts' '*.rs' | grep -iE '<regex de segredos>'  # → 0 matches
```

### Anexo C — Arquivos on-chain revisados manualmente (linha a linha)

`roundfi-core`: `settle_default.rs`, `claim_payout.rs`, `contribute.rs`, `harvest_yield.rs`, `escape_valve_buy.rs`, `escape_valve_list_commit.rs`, `escape_valve_list_reveal.rs`, `release_escrow.rs`, `deposit_idle_to_yield.rs`, `join_pool.rs`, `create_pool.rs`, `update_protocol_config.rs`, `cpi/reputation.rs`, `cpi/yield_adapter.rs`, `math/mod.rs`, `state/pool.rs`, `constants.rs`.
`crates/math`: `waterfall.rs`, `cascade.rs`, `bps.rs`.
`roundfi-reputation`: `instructions/attest.rs`, `instructions/promote_level.rs`, `constants.rs`.
`roundfi-yield-kamino`: `lib.rs` (deposit/harvest CPI + oráculos de layout).
Off-chain: `services/indexer/src/webhook.ts`.
