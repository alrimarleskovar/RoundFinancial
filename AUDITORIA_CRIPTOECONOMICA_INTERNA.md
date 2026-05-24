# Relatório de Auditoria Criptoeconômica Interna — RoundFinancial (Triple Shield)

**Conduzido por:** Adevar Labs (auditoria interna)
**Metodologia:** Padrão Chaos Labs — segurança econômica e simulação de risco (referência de método; **sem envolvimento ou endosso da Chaos Labs**)
**Data:** 2026-05-24
**Commit Auditado:** `fdf356f632ac55f2b72e4a21e5bf055ce2cad25e`
**Escopo:** Modelo econômico Triple Shield (cascade math, escrow_vesting, waterfall) + assumptions do Stress Lab L1

> _Auto-auditoria interna. Não representa uma auditoria conduzida ou endossada pela Chaos Labs. Não substitui engagement criptoeconômico independente. Existe viés estrutural: a mesma equipe que desenhou o Triple Shield escreveu o Stress Lab e este relatório._

---

## Mapeamento Econômico e Escopo Adotado

### Mecânica reconstruída a partir do código (não da documentação)

O Triple Shield é um ROSCA (consórcio) on-chain sobre Solana/Anchor, com dois corpos de cálculo:

1. **Camada on-chain (`crates/math` + `programs/roundfi-core`)** — aritmética inteira `u64`/`u128`:
   - `cascade.rs` / `dc.rs`: cascata de apreensão em `settle_default`, ordem **solidariedade → escrow → stake**, cada etapa limitada pelo invariante D/C (`D_rem·C_init ≤ C_rem·D_init`).
   - `escrow_vesting.rs`: vesting linear do escrow ao longo de checkpoints.
   - `waterfall.rs`: cascata de yield (fee → Fundo Garantido → LPs → participantes).
   - `seed_draw.rs`: guarda de retenção de 91,6% no ciclo 0 + `pool_is_viable`.
   - Parâmetros (`programs/roundfi-core/src/constants.rs`): 24 membros, **installment 600 USDC** (corrigido em SEV-025; o valor antigo 416 era inviável), credit 10.000 USDC, escrow-release 2.500 bps, solidariedade 100 bps, fee yield 2.000 bps, GF cap 150%.

2. **Camada de simulação L1 (`sdk/src/stressLab.ts`)** — aritmética de **ponto flutuante (`number`)**:
   - É o objeto da auditoria. Roda em três lugares (UI `/lab`, testes de paridade L1, harness L2 quando há RPC).
   - Deriva `installment = credit / N`, `stake = credit × stakePct`, escrow/upfront por nível (Iniciante 50/45/35% upfront, escrow 50/55/65%), drip linear, refund de stake no fim.
   - Calcula `netSolvency = poolBalance + solidarity + guaranteeFund − outstandingEscrow − outstandingStakeRefund` e dele deriva o veredito SOLVENTE/INSOLVENTE (comentário do código, linhas 113-118 e 608-617).

### Fluxos de valor

Entra: stake inicial (50/30/10% do credit) + installments mensais. Sai: upfront na contemplação + drips de escrow + refund de stake + waterfall de yield (LPs/participantes). Buckets segregados: Cofre Solidário (1% de cada installment) e Fundo Garantido (alimentado pelo yield, cap 150% do credit).

### Assumptions — classificação

- **Declaradas (código/config):** installment 600 USDC, credit 10k, 24 membros/ciclos, stake 50/30/10%, solidariedade 1%, escrow-release 25%, seed-draw 91,6%, GF cap 150%, fee yield 20%, grace 7 dias.
- **Implícitas (não escritas, necessárias para o modelo fechar):** (a) que installments futuros serão pagos (a `netSolvency` ignora essa receita futura, ver ECO-001); (b) que o escrow não-desembolsado conta como "recuperação" (ECO-004); (c) que a apreensão de colateral é instantânea e integral no default (ECO-002); (d) que defaults são raros, isolados e independentes (ECO-007); (e) que as condições de mercado/yield não mudam ao longo dos 24 ciclos.
- **Indeterminadas:** taxa de default real, churn, fluxo de novo membership — **não existem como variáveis no modelo**. O Stress Lab não tem nenhuma distribuição estocástica; é um reprodutor determinístico de cenários montados à mão (ECO-007). Não há dado histórico de base citado em lugar nenhum.

---

## Sumário Executivo

O modelo econômico do Triple Shield **não está pronto economicamente para mainnet GA**, e — mais grave — a ferramenta usada para "provar" sua robustez (o Stress Lab L1) mede a coisa errada. Três achados Critical sustentam esse veredito.

Primeiro, a métrica `netSolvency` que produz o veredito SOLVENTE soma **todas as obrigações futuras** contra o caixa atual, mas **ignora a receita de installments futuros** que financia exatamente essas obrigações num ROSCA. Resultado executado: no cenário **perfeitamente saudável, sem nenhum default**, a métrica é **negativa em 23 dos 24 ciclos**, atingindo **−$229.857** no ciclo 1, e só vira positiva (+$3.205) no último frame. O veredito "solvente" é um artefato de amostrar o frame final — não uma propriedade do sistema.

Segundo, o mecanismo de recuperação que o simulador credita (apreensão **integral e instantânea** de escrow + stake no default) **não é o que o contrato implementa**: `settle_default` apreende apenas **uma parcela perdida** por chamada (`missed = installment.min(d_rem)`), dispara **uma única vez** por membro e é limitado pelo D/C. O grosso do colateral fica travado, não varrido para o float de pagamento. O modelo prova solvência assumindo uma recuperação que a cadeia não faz.

Terceiro, a margem é **fina como papel e não-monotônica**: o cenário canônico de 3 defaults dá **+$28,20** de solvência final (não os "+$4.152 por construção" do pitch deck — ver ECO-005), **4 defaults viram −$184 (INSOLVENTE)**, e 5 defaults voltam a +$24. O ponto de ruptura é **4 defaults pós-contemplação precoces em 24 membros (≈16,7%)**. Pior: **quanto mais membros dão default, maior a solvência reportada** (24 defaults → +$67.149, o melhor resultado de todos), porque o escrow não-desembolsado dos inadimplentes é contado como "retido/recuperado". A métrica recompensa o calote.

Os 16 presets do Stress Lab cobrem no máximo 3 defaults — exatamente a região que passa. Nenhum preset cruza o ponto de ruptura, testa correlação, churn em massa, seca de membership ou choque de yield. **Todos os achados materiais exigem engagement independente pago** (ex: Chaos Labs scoped) antes da Phase 3 B2B oracle — esta auto-auditoria, por viés estrutural, não basta.

---

## Invariantes Econômicos do Triple Shield

| # | Invariante | Propriedade matemática | Cobertura no Stress Lab L1 |
|---|-----------|------------------------|----------------------------|
| I1 | **Solvência real** — ativos ≥ obrigações *líquidas de receita futura* | `caixa_atual + installments_a_receber ≥ payouts_a_fazer` | **NÃO testado** — `netSolvency` ignora `installments_a_receber` (ECO-001) |
| I2 | **Conservação** — nada é criado/destruído | `Σ member.delta + protocol.delta + GF.delta + yield = 0` | Testado (mas trivial em contabilidade fechada; não prova paridade com a cadeia — ECO-006) |
| I3 | **D/C** — fração de dívida ≤ fração de colateral | `D_rem·C_init ≤ C_rem·D_init` | Testado **na cadeia** (cascade.rs, ~13.500 combos); **NÃO no L1** (o simulador não aplica o cap D/C) |
| I4 | **Waterfall em ordem** — sênior antes de júnior | `fee + GF + LP + part. = yield` | Testado (waterfall.rs proptests) |
| I5 | **Vesting ≤ principal** — nunca libera mais que o depositado | `Σ releases ≤ stake_inicial` | Testado (escrow_vesting.rs, SEV-029/034) |
| I6 | **Seed-draw** — float do ciclo 0 ≥ 91,6% das coletas do mês 1 | `vault + escrow ≥ members·inst·9160/10000` | Testado **na cadeia**; **NÃO no L1** (o simulador não modela a guarda) |
| I7 | **Cascata na ordem solidariedade→escrow→stake** | seizure order determinística | Testado **na cadeia**; **L1 apreende escrow+stake direto, sem solidariedade-primeiro** (ECO-002/006) |

O Stress Lab L1 testa de fato I2, I4, I5. **I1 (a solvência de verdade) não é testada por nenhuma das camadas** — a cadeia não simula trajetória econômica multi-ciclo, e o L1 usa uma definição de solvência quebrada.

---

## Modelagem de Ameaças Econômicas

| Vetor | Variável-chave | Breaking point (executado) |
|-------|----------------|----------------------------|
| Cascata de defaults pós-contemplação precoces | nº de defaults / 24 | **4 defaults (16,7%)** → `netSolvency` final = −$184 |
| Death spiral (todos defaultam pós-payout) | — | Reportado como **+$67k SOLVENTE** (métrica invertida, ECO-004) |
| Choque de recuperação (cadeia ≠ modelo) | mecânica de `settle_default` | Recuperação real ≈ 1 installment/default vs. $7.500/default no modelo (ECO-002) |
| Seca de novo membership | inflow de membros | **Não modelável** — o L1 não tem variável de inflow |
| Mass churn / corrida via Escape Valve | nº de exits | **Não modelado** — `E` só marca `exited`, sem takeover (ECO-010) |
| Choque de yield / depeg / oráculo Kamino | APY, preço | **Não propagado** — APY é input determinístico estático (ECO-011) |
| Default estratégico | incentivo a defaultar | Reforçado pela métrica que premia default (ECO-004) |

---

## Auditoria das Assumptions do Stress Lab L1

- **Distribuições (default/churn/growth):** **não existem.** O simulador não tem nenhuma variável estocástica — é um reprodutor de cenários determinísticos montados à mão (matriz P/C/X/E). Não há taxa de default, nem distribuição, nem base histórica. A premissa implícita é "defaults são raros, isolados e colocados pelo auditor". Otimista por construção.
- **Cobertura de cauda:** ausente. O preset mais estressante (`tripleVeteranDefault`) tem 3/24 defaults — **abaixo** do ponto de ruptura de 4. Todos os 16 presets ficam na região segura.
- **Cenários conjuntos (correlated stress):** ausentes. Não há combinação de default + churn + seca de yield. Cada eixo é testado isolado (e a maioria nem é testada).
- **Limites estruturais do simulador:** (a) ponto flutuante em vez de `u64` (ECO-008); (b) installment derivado = `credit/N` = 416,67 USDC para Veterano — **exatamente o valor inviável rejeitado em SEV-025** — em vez do 600 USDC da cadeia (ECO-006); (c) sem guarda seed-draw, sem cap D/C, sem cascata solidariedade-primeiro; (d) métrica de solvência que não conta receita futura (ECO-001).
- **"Passou no Stress Lab" mascara:** que o modelo só foi testado onde sabidamente passa. Os 45 testes de paridade afirmam `Σ delta = 0` (conservação), que é **trivialmente verdadeiro** em qualquer sistema contábil fechado e **não prova solvência nem paridade com a cadeia**.

---

## Achados Detalhados

### [ECO-001] A métrica de veredito `netSolvency` não mede solvência — reporta insolvência em 23/24 ciclos do caso saudável

- **Severidade:** Critical
- **Categoria:** Insolvência / Invariante violado
- **Fragilidade:** `netSolvency = poolBalance + solidarity + GF − outstandingEscrow − outstandingStakeRefund` soma **todas as obrigações futuras** (escrow e refund a desembolsar) contra o **caixa atual**, mas **não soma os installments futuros** que, num ROSCA, financiam exatamente essas obrigações. É comparar um *estoque* contra um *total de fluxos futuros* sem o fluxo de entrada compensatório.
- **Evidência:** `sdk/src/stressLab.ts:612-617` (cálculo) e `:113-118` (comentário: _"The SOLVENT/INSOLVENT verdict derives from this — positive ≡ solvent"_).
- **Cenário de Ruptura:** Caso **saudável, zero defaults**, Veterano 24 membros. A métrica deveria ser confortavelmente positiva o tempo todo.
- **Impacto:** Por essa métrica, o protocolo está "insolvente" 96% do tempo no caminho feliz. O veredito "solvente" só aparece porque a UI/teste lê o **frame final**. Se a métrica está certa → insolvência crônica (Critical). Se está errada → toda a tese "solvente por construção" repousa numa régua que não mede solvência. Os dois caminhos invalidam a alegação.
- **Simulação:** `EXECUTADO` (`scripts/stress/audit_trace.mts`):
  ```
  HEALTHY Veterano 24 (sem defaults):
  ciclo  1: netSolvency = −229.856,7   (outstandingEscrow 239.166,7)
  ciclo 12: netSolvency = −118.153,0
  ciclo 23: netSolvency =   −6.858,0
  ciclo 24: netSolvency =   +3.205,2   ← único frame positivo
  ```
- **Mitigação Recomendada:** Redefinir solvência como `caixa + Σ(installments_contratados_a_receber) − Σ(obrigações)` OU avaliar solvência ciclo-a-ciclo contra o caixa necessário para o próximo payout (liquidez sequencial), não contra o passivo total. Trade-off: a régua correta vai revelar que o colchão real é muito menor — não há ganho de capital efficiency, só verdade.
- **Requer engagement independente?** Sim.
- **Esforço Estimado:** M

---

### [ECO-002] Mecanismo de recuperação do modelo (apreensão integral instantânea) diverge do contrato (`settle_default` apreende 1 parcela, 1 vez)

- **Severidade:** Critical
- **Categoria:** Dependência externa / Invariante violado (paridade modelo↔cadeia)
- **Fragilidade:** O L1, no default pós-contemplação, credita ao protocolo a apreensão de **todo o escrow não-dripado + todo o stake** de uma vez (`escrowSeized + stakeSeized`, ~$7.500/Veterano). O on-chain `settle_default` apreende apenas `missed = installment.min(d_remaining)` (**uma parcela**, ~$600), em cascata solidariedade→escrow→stake limitada pelo D/C, e **só pode disparar uma vez** (`require!(!member.defaulted)` → `member.defaulted = true`). O grosso do colateral do inadimplente **fica travado**, não é varrido para o `pool_usdc_vault` que paga os demais.
- **Evidência:** modelo: `sdk/src/stressLab.ts:514-531`. Cadeia: `programs/roundfi-core/src/instructions/settle_default.rs:182` (`missed = pool_installment.min(d_remaining)`) e `:69,:297` (one-shot).
- **Cenário de Ruptura:** 3 defaults Veterano. O modelo "recupera" $22.500 (totalRetained). A cadeia recupera ≈3×$600 = $1.800 imediatos; o resto do colateral fica preso e não financia payouts dos membros adimplentes que estão na fila.
- **Impacto:** A solvência real é **muito menor** que a simulada. O modelo que sustenta a tese de robustez assume uma recuperação que o contrato deployado não executa. Não foi possível localizar um mecanismo de varredura do colateral residual do inadimplente para o float — se não existir, a fragilidade é severa.
- **Simulação:** `EXECUTADO` (modelo) + leitura de código (cadeia). A quantificação on-chain exige harness bankrun multi-ciclo (`NÃO-EXECUTADO` do lado cadeia).
- **Mitigação Recomendada:** Ou (a) implementar varredura do colateral residual do inadimplente para o float no `settle_default`/`close_pool`, ou (b) corrigir o L1 para refletir a apreensão real (1 parcela/evento) — e então re-rodar a solvência. Trade-off: (a) muda o mecanismo (precisa re-auditar D/C e timing); (b) é honestidade de modelo e provavelmente revela insolvência em cenários hoje "verdes".
- **Requer engagement independente?** Sim — é o achado que mais precisa de validação externa.
- **Esforço Estimado:** L

---

### [ECO-003] Margem de solvência fina e não-monotônica — ponto de ruptura em 4 defaults (16,7%)

- **Severidade:** Critical
- **Categoria:** Insolvência
- **Fragilidade:** A solvência final é essencialmente ruído em torno de zero e **não é monotônica** no nº de defaults, prova de que a régua não é uma medida de risco bem-comportada.
- **Evidência:** `sdk/src/stressLab.ts` via `scripts/stress/audit_harness.mts`.
- **Cenário de Ruptura:** Veterano 24, defaults pós-contemplação sequenciais a partir do ciclo seguinte à contemplação.
- **Impacto / Simulação:** `EXECUTADO`:
  ```
  3 defaults → netSolvency final = +28,20   (SOLVENTE)
  4 defaults → netSolvency final = −184,26   (INSOLVENTE)   ← breaking point
  5 defaults → netSolvency final = +23,58   (SOLVENTE)
  6 defaults → netSolvency final = +649,92
  ```
  Sobre um pool de ~$240.000, ±$200 de margem é ~0,01%. O canônico (+$28) é coincidência numérica, não robustez. A não-monotonicidade decorre de ECO-004 (defaults removem obrigações de membros "ok").
- **Mitigação Recomendada:** Não tratar como "robusto"; após corrigir ECO-001/002, recalibrar buffers (GF cap, solidariedade) para um colchão-alvo explícito (ex: sobreviver a 25% de default correlato com margem ≥ 1 credit). Trade-off: mais capital parado (menos capital efficiency) em troca de margem real.
- **Requer engagement independente?** Sim.
- **Esforço Estimado:** M

---

### [ECO-004] Reflexividade invertida — mais defaults aumentam a solvência reportada (métrica premia o calote)

- **Severidade:** High
- **Categoria:** Reflexividade/comportamento
- **Fragilidade:** Membros inadimplentes saem do estado `ok` e suas obrigações (`outstandingEscrow`, `outstandingStakeRefund`) **desaparecem** do cálculo, enquanto o escrow não-desembolsado deles é somado a `totalRetained`. Logo, defaultar **melhora** a solvência reportada.
- **Evidência:** `sdk/src/stressLab.ts:595-606` (obrigações só somam membros `ok`) + `:518-531` (retained infla com escrow não-dripado).
- **Cenário de Ruptura:** Death spiral — todos os 24 defaultam logo após o payout.
- **Impacto / Simulação:** `EXECUTADO`: 24 defaults → `netSolvency` final = **+$67.148,75** (o **maior** de todos os cenários), `totalRetained` = $239.500. Um evento que deveria ser catastrófico (100% de calote) é reportado como o mais solvente. Em produção, o incentivo racional individual (pegar upfront e defaultar) é mascarado pela métrica como inofensivo.
- **Mitigação Recomendada:** Contabilizar o passivo aos membros adimplentes *vítimas* (que pagaram e não receberão) e contar como recuperação **apenas caixa que efetivamente entrou** (stake depositado + parcelas), nunca escrow não-desembolsado. Trade-off: nenhum — é correção de contabilidade.
- **Requer engagement independente?** Sim (validação da nova contabilidade).
- **Esforço Estimado:** M

---

### [ECO-005] Alegação de pitch "+$4.152 solvente por construção" não reconcilia com a saída do simulador

- **Severidade:** High
- **Categoria:** Assumption frágil / risco de comunicação a lenders/investidores
- **Fragilidade:** O comentário canônico (`stressLab.ts:758-768`) decompõe: passivo bruto −$30.000 + escrow retido $19.500 + stake $3.000 + "cushion Sorteio Semente" $9.152 + solidariedade/yield $2.500 = **+$4.152**. Nenhuma dessas parcelas bate com a execução: o simulador dá `netSolvency` final **+$28,20**, `totalLoss` $3.750, `totalRetained` $22.500. O "passivo bruto $30.000" assume que cada inadimplente levou o credit **inteiro** ($10k), quando só recebeu o upfront ($3.500). O "+$9.152 do Sorteio Semente" trata a guarda seed-draw (que **bloqueia** payout se o float for insuficiente) como se fosse um caixa de recuperação — erro de categoria.
- **Evidência:** `sdk/src/stressLab.ts:758-787` vs. saída de `audit_harness.mts` (canônico = +28,20).
- **Cenário de Ruptura:** N/A (achado de modelagem/comunicação).
- **Impacto:** Número de marketing fabricado. Se apresentado a lender/investidor como evidência de robustez, é material misrepresentation. O número honesto do próprio simulador é +$28, e mesmo esse é frágil (ECO-003) e mal-medido (ECO-001).
- **Simulação:** `EXECUTADO`.
- **Mitigação Recomendada:** Remover a decomposição "+$4.152" de todo material; substituir pela saída real do simulador *após* corrigir ECO-001/002/004; nunca contar escrow não-desembolsado nem a guarda seed-draw como recuperação.
- **Requer engagement independente?** Sim.
- **Esforço Estimado:** S

---

### [ECO-006] Gap de paridade — o L1 simula um modelo econômico diferente do contrato

- **Severidade:** High
- **Categoria:** Assumption frágil (o objeto de prova ≠ o objeto deployado)
- **Fragilidade:** O L1 deriva `installment = credit/N` = **416,67 USDC** (Veterano 10k/24) — **exatamente o valor que SEV-025 rejeitou como inviável** — enquanto a cadeia usa `DEFAULT_INSTALLMENT_AMOUNT = 600 USDC` fixo. Além disso: o L1 usa escrow/upfront por nível (35/65% etc.), a cadeia usa `ESCROW_RELEASE_BPS = 2500`; o L1 não aplica seed-draw, nem `pool_is_viable`, nem cap D/C, nem cascata solidariedade-primeiro.
- **Evidência:** L1: `sdk/src/stressLab.ts:351` (`inst = credit / N`), `:149-171` (params por nível). Cadeia: `programs/roundfi-core/src/constants.rs:99` + `crates/math/src/seed_draw.rs:147-170` (o 416 é o caso *rejeitado*).
- **Impacto:** Os "testes de paridade econômica L1" comparam o simulador consigo mesmo (`Σ delta = 0`), não com a cadeia. A paridade real (L2) só roda "quando há RPC devnet" — provavelmente nunca em CI. Logo o artefato que "valida o Triple Shield" valida um modelo que diverge do contrato nos parâmetros mais sensíveis à solvência.
- **Simulação:** `EXECUTADO` (constatação de divergência de parâmetros).
- **Mitigação Recomendada:** Alinhar o L1 aos parâmetros on-chain (installment 600, escrow-release-bps, cascata real, seed-draw) **ou** marcar explicitamente o L1 como "modelo ilustrativo, não-paridade" e construir a paridade L2 obrigatória em CI via bankrun. Trade-off: esforço de engenharia vs. risco de falsa confiança.
- **Requer engagement independente?** Sim.
- **Esforço Estimado:** L

---

### [ECO-007] Ausência de modelo estocástico — default rate, churn e membership inflow não existem como variáveis

- **Severidade:** Medium
- **Categoria:** Assumption frágil / limite estrutural
- **Fragilidade:** O Stress Lab é um reprodutor determinístico de matrizes P/C/X/E. Não há distribuição de default, nem churn, nem inflow de novos membros, nem correlação. As "premissas" que esta auditoria deveria atacar (default rate, churn, growth) **não estão codificadas** — são implícitas e otimistas ("defaults raros, isolados, posicionados à mão").
- **Evidência:** `sdk/src/stressLab.ts` inteiro — `runSimulation` não recebe nenhum parâmetro probabilístico; `PRESETS` são cenários fixos.
- **Impacto:** Impossível responder "e se o default real for 2×/5×/10× o assumido?" porque não há valor assumido. Tail risk, correlação e seca de membership ficam fora do alcance do simulador por construção.
- **Simulação:** `NÃO-EXECUTADO / análise conceitual` (não há motor estocástico para rodar).
- **Mitigação Recomendada:** Adicionar um modo Monte Carlo (default ~ distribuição calibrada em dado de consórcio real, com correlação) por cima do `runSimulation`. Declarar a base histórica de cada distribuição — e, se não existir, dizer que é estimativa.
- **Requer engagement independente?** Sim — calibração de distribuições é núcleo do engagement Chaos-style.
- **Esforço Estimado:** L

---

### [ECO-008] Aritmética de ponto flutuante no L1 vs. inteiro `u64` na cadeia

- **Severidade:** Medium
- **Categoria:** Dependência/precisão
- **Fragilidade:** O L1 usa `number` (f64); a cadeia usa `u64`/`u128` com floor + teto D/C. `Σ delta = 0` em float pode mascarar drift de arredondamento que a cadeia trata de forma diferente (e potencialmente acumulativa em 24 ciclos × 24 membros).
- **Evidência:** `sdk/src/stressLab.ts` (todo cálculo em `number`); cadeia em `crates/math/*` (inteiros).
- **Impacto:** Paridade ao centavo não comprovada; um drift de poucas unidades por ciclo pode, no agregado, mudar quem cruza o limiar de seed-draw ou D/C on-chain.
- **Simulação:** `NÃO-EXECUTADO / análise conceitual`.
- **Mitigação Recomendada:** Reescrever o L1 com aritmética inteira em base units (BigInt) espelhando o floor/ceil da cadeia, e adicionar teste de paridade ao-centavo.
- **Requer engagement independente?** Não (correção interna verificável).
- **Esforço Estimado:** M

---

### [ECO-009] Membros contemplados tarde ficam estruturalmente sub-protegidos no encerramento do pool

- **Severidade:** Medium
- **Categoria:** Invariante violado (obrigações abertas no fim) / reflexividade
- **Fragilidade:** Mesmo o pool **saudável** encerra com `outstandingEscrow = $13.000` + `outstandingStakeRefund = $4.000` ainda devidos a membros `ok`, contra um colchão de só +$3.205. O membro contemplado no ciclo 24 acabou de receber o upfront e ainda tem o escrow inteiro a vencer quando o pool termina.
- **Evidência:** saída de `audit_trace.mts` (ciclo 24 saudável). Mecânica: `stressLab.ts:437` (`refundMonths = N − monthContemplated − releaseMonths` pode ser ≤ 0 para contemplados tarde).
- **Impacto:** A "vítima" de qualquer default é sempre o último membro adimplente da fila — que pagou 24 parcelas e pode não receber o credit completo. A métrica atual não destaca esse risco distributivo.
- **Simulação:** `EXECUTADO`.
- **Mitigação Recomendada:** Estender o horizonte do pool além de N ciclos para drenar escrow/refund dos contemplados tarde, ou pré-financiar a cauda via GF. Trade-off: capital parado por mais tempo.
- **Requer engagement independente?** Sim.
- **Esforço Estimado:** M

---

### [ECO-010] Escape Valve e mass churn não modelados na solvência

- **Severidade:** Low
- **Categoria:** Eficiência/cobertura
- **Fragilidade:** A ação `E` apenas marca `exited` e pula installments/drips futuros; o takeover pelo comprador (fase 2) não é modelado. Uma corrida de saída via Escape Valve não é estressada.
- **Evidência:** `sdk/src/stressLab.ts:544-552`.
- **Impacto:** O impacto de saídas em massa no mercado secundário sobre a solvência é desconhecido.
- **Simulação:** `NÃO-EXECUTADO / análise conceitual`.
- **Mitigação Recomendada:** Modelar a continuação comprador-assume-posição e um cenário de churn ≥ 30% via Escape Valve.
- **Requer engagement independente?** Sim.
- **Esforço Estimado:** M

---

### [ECO-011] Dependência de yield externo (Kamino) sem propagação de choque

- **Severidade:** Informational
- **Categoria:** Dependência externa
- **Fragilidade:** No L1 o yield é um APY determinístico estático. O preset `zeroYieldTripleDefault` só testa APY=0 fixo, não um colapso de yield a meio do pool, yield negativo, oracle stale ou depeg do USDC propagando pelo waterfall e GF.
- **Evidência:** `sdk/src/stressLab.ts:359,563-584`; preset `:897-911`.
- **Impacto:** O Fundo Garantido é alimentado pelo yield; uma seca de yield reduz o segundo escudo justamente quando defaults sobem (correlação adversa não modelada).
- **Simulação:** `NÃO-EXECUTADO / análise conceitual`.
- **Mitigação Recomendada:** Modelar yield como série temporal com choques e correlação com o ambiente de default; testar GF sob seca de yield + cluster de defaults.
- **Requer engagement independente?** Sim.
- **Esforço Estimado:** M

---

## Pontos de Ruptura e Análise de Solvência

| Cenário | Plausibilidade | Resultado (métrica do modelo) | Leitura honesta |
|---------|----------------|-------------------------------|-----------------|
| 4 defaults pós-contemplação / 24 (16,7%) | **Moderada** (calote precoce é o caso clássico de ROSCA) | −$184 INSOLVENTE | Quebra; e a margem dos vizinhos (3 e 5) é ruído |
| Caso saudável, 0 defaults | Base case | −$229k→+$3,2k ao longo do pool | Insolvente 23/24 ciclos pela própria régua (ECO-001) |
| Recuperação real on-chain (1 parcela/default) | **Certa** (é o que o contrato faz) | não simulado no L1 | Solvência real << simulada (ECO-002) |
| Death spiral (100% default) | Baixa | +$67k "SOLVENTE" | Métrica invertida (ECO-004) |
| Seca de membership / churn em massa | Moderada (early-stage) | não modelável | Fora do alcance (ECO-007/010) |

Classificação: o modelo é **"quebra no caso base com assumption realista"** — porque (a) a régua de solvência não mede solvência, e (b) a recuperação simulada não é a recuperação implementada.

---

## Invariantes Sugeridos para Simulação Contínua / Monitoramento

1. **Liquidez sequencial:** a cada ciclo, `caixa ≥ payout do próximo contemplado`. Alerta se a folga < 1 installment.
2. **Solvência real:** `caixa + installments_contratados_a_receber − obrigações ≥ 0`. Alerta em qualquer ciclo negativo.
3. **Taxa de default observada vs. assumida:** instrumentar `pool.defaulted_members / members` em produção; alerta a partir de 12,5% (metade do breaking point de 16,7%).
4. **Cobertura D/C agregada do pool:** somatório de colateral travado vs. dívida remanescente.
5. **Razão GF/credit e GF/yield-acumulado:** alerta se o GF cair abaixo de X% durante seca de yield.
6. **Passivo a vítimas:** obrigações abertas a membros adimplentes no fim do pool (ECO-009).

---

## Riscos Residuais e Recomendação de Engagement Externo

Esta auto-auditoria **não consegue cobrir**, por viés estrutural e limite de ferramenta:

- **Calibração de distribuições** de default/churn/growth contra dado histórico de consórcios reais (não existe motor estocástico nem dataset citado — ECO-007).
- **Paridade L1↔on-chain ao centavo** sob trajetória multi-ciclo (exige bankrun/devnet harness completo — ECO-002/006/008).
- **Validação independente da contabilidade de solvência** corrigida (ECO-001/004) — quem corrige a régua é a mesma equipe que a quebrou.

**Recomendação:** **NÃO PRONTO para mainnet GA.** Antes da Phase 3 B2B oracle, contratar engagement criptoeconômico independente (ex: Chaos Labs scoped no Triple Shield) com escopo mínimo: (1) redefinir e validar a métrica de solvência; (2) reconciliar modelo↔contrato no mecanismo de recuperação; (3) calibrar distribuições de default/churn em dado real; (4) re-estabelecer o ponto de ruptura com a contabilidade corrigida. Os achados ECO-001 a ECO-006 bloqueiam GA.

---

## Anexos

**Comandos executados:**
```bash
node --experimental-strip-types scripts/stress/audit_harness.mts
node --experimental-strip-types scripts/stress/audit_trace.mts
```

**Scripts de simulação (evidência):** `scripts/stress/audit_harness.mts`, `scripts/stress/audit_trace.mts` — importam o `runSimulation` real de `sdk/src/stressLab.ts` (sem reimplementar a matemática).

**Saídas-chave reproduzidas no corpo do relatório:**
- Healthy Veterano 24 — `netSolvency` por ciclo: −229.857 (c1) … +3.205 (c24).
- Veterano 24 — varredura de defaults: 3→+28,20 / 4→−184,26 / 5→+23,58 / 24→+67.148,75.
- Canônico `tripleVeteranDefault`: `netSolvency` final +28,20; `totalRetained` 22.500; `totalLoss` 3.750 (≠ decomposição "+$4.152" do pitch).

**Parâmetros usados:** Veterano, 24 membros, credit $10.000, APY 6,5%, fee yield 20% (= config dos presets canônicos).
