> Extracted from 443dc63d-RoundFi_Reputation_v52_Spec.docx for git-friendly review.
> Source binary preserved in the same folder.

RoundFi

Sistema de Reputação v5.2

Especificação Técnica de Implementação

Data: 08 de junho de 2026

Versão: v5.2 — proposta conceitual para implementação

Status: Pré-canary · Freeze ativo · Requer aprovação de equipe

Destinatários: Dev lead · Equipe técnica · Produto

1. Contexto e Objetivo

Este documento apresenta a especificação técnica completa para implementação do sistema de reputação v5.2 no protocolo RoundFi. A proposta foi gerada a partir da análise comparativa das versões v5.0 e v5.1, com foco em auditabilidade determinística, eliminação de discricionariedade e compatibilidade com o estado atual do devnet.

Princípio guia:

Qualquer pessoa, sozinha, com o código aberto, refaz a conta e chega no mesmo número.

POR QUÊ v5.2

A v5.1 introduziu taxonomia valiosa de 6 categorias mas comprometeu auditabilidade ao adiar fórmulas e permitir discricionariedade de admin. A v5.2 preserva a taxonomia e elimina toda opacidade: fórmulas explícitas desde o dia 1, score público, zero intervenção individual.

2. Comparativo v5.0 · v5.1 · v5.2

Dimensão

v5.0

v5.1

v5.2

Score público

Dia 1 (heurístico)

Adiado 12+ meses

Dia 1 (fórmula explícita)

Fórmulas

Heurísticas no doc

A calibrar pós-dataset

Explícitas em constants.rs

Categorias de evento

3 (MissReason)

6 (com janela admin)

6 (determinística)

FrictionProof

Inexistente

Mencionada, admin atesda

On-chain obrigatório

Discricionariedade

Mínima

Alta (admin, fases)

Zero

Níveis

5 níveis

5 níveis

4 níveis (50/25/10/3%)

Auditável por terceiros

Sim

Não

Sim, totalmente

Compatível com devnet

Base

Regride features

Evolui o existente

3. Arquitetura de 4 Camadas

A v5.2 mantém a arquitetura de 4 camadas da v5.0. As camadas inferiores não dependem das superiores. C2 é append-only. C3 e C4 são funções puras — qualquer terceiro pode recomputar.

CAMADA 4 — NÍVEL (derivado de C1+C3, função pura)

  L1 Iniciante  · L2 Comprovado  · L3 Veterano  · L4 Elite

        ↑ função pura

CAMADA 3 — REPUTAÇÃO (4 métricas, função pura de C2)

  Reliability · Punctuality · Commitment · Recovery

        ↑ função pura

CAMADA 2 — HISTÓRICO COMPORTAMENTAL (append-only, 6 categorias)

  EventClassification + FrictionProof

        ↑ ancorada em

CAMADA 1 — IDENTIDADE (fatos estáveis)

  Wallet Age · PoP · KYC · Pools completados

3.1 Escada de Níveis (4 Níveis)

Mudança em relação à v5.0: 5 níveis reduzidos para 4. Custo técnico ~30 linhas. Comunicação mais simples.

Nível

Stake

Critérios (todos exigidos)

Stake %

L1

Iniciante

Padrão — sem histórico mínimo exigido

50%

L2

Comprovado

≥1 pool completo · Reliability ≥70 · Punctuality ≥60

25%

L3

Veterano

≥3 pools · Wallet age ≥6m · Reliability ≥85 · Punctuality ≥75 · Recovery ≥80

10%

L4

Elite

≥8 pools · Wallet age ≥2a · PoP ativo · Reliability ≥94 · Punctuality ≥88 · Commitment ≥90 · 0 BadFaith

3%

ATENÇÃO

A mudança de L2 de 30% para 25% precisa ser atualizada em todos os documentos institucionais: Architecture Spec, Whitepaper, User Guide e Behavioral Reputation Score. Inconsistência nesses documentos é crítica para parceiros B2B.

4. Fase 0 — Bloqueadores Pré-Implementação

Nenhum arquivo de programa deve ser criado ou modificado antes que os 3 bloqueadores abaixo estejam resolvidos.

BLOQUEADOR 1

Bug aritmético em reliability(): a fórmula (sum * 100) / (count * 100) cancela para sum / count. Não normaliza para 0-100. Com W_BAD_FAITH = -200, a soma pode ser negativa antes do .clamp().

Correção obrigatória — reliability()

// ERRADO — denominador cancela

let raw = (sum * 100) / (count * 100);

// CORRETO — normaliza para 0-100

const MAX_WEIGHT: i32 = W_PAYMENT_ON_TIME; // 100

let raw = (sum * 100) / (count.max(1) * MAX_WEIGHT);

let score = raw.clamp(0, 100) as u16;

Testes unitários obrigatórios antes de qualquer instrução que consuma reliability():

50 eventos OnTime → resultado deve ser 100

49 OnTime + 1 BadFaith → deve retornar ~94 sem panic

Todos os eventos BadFaith → deve clampar para 0 sem underflow

Janela vazia → deve retornar 0 com guard de divisão por zero

1 Default em 50 eventos → deve retornar 98

BLOQUEADOR 2

Variável count usada sem declaração em punctuality(). O código não compila. Requer refactor do iterator para preservar count durante o fold.

Correção obrigatória — punctuality()

// Padrão correto — fold preserva sum e count

let (sum, count) = events.iter().rev()

    .filter(|e| matches!(e.classification,

        PaymentOnTime | PaymentEarly |

        FrictionTemporal | LateBehavioral | TemporaryIncapacity

    ))

    .take(PUNCTUALITY_WINDOW as usize)

    .fold((0i64, 0i64), |(s, c), e| {

        (s + e.delta_seconds, c + 1)

    });

if count == 0 { return 80; }  // sem dados = neutro

let avg = sum / count;

// ... aplicar mapeamento linear de -259200 até 2592000

BLOQUEADOR 3

ORACLE_WHITELIST referenciada em FrictionProof::OnChainOracle não existe em nenhum arquivo, constant, ou schema. Sem isso, attach_friction_proof não pode ser implementado com segurança.

Solução mínima — OracleConfig como account singleton

// programs/roundfi-reputation/src/state/oracle_config.rs

#[account]

pub struct OracleConfig {

    pub authority: Pubkey,          // upgrade authority por ora

    pub approved_oracles: Vec<Pubkey>,  // Switchboard feeds

    pub bump: u8,

}

// PDA seed: ["oracle_config"]

// Inicializado em deploy — governance vem na Fase 2

Para o canary: singleton estático com 1-2 feeds Switchboard gerenciados por upgrade authority. Governance on-chain é post-canary.

5. Fase 1 — Migração de Schema

O roundfi-reputation deployado (Hpo174...e9R2) usa o sistema de 3 valores (MissReason). A v5.2 usa EventClassification com 11 variantes. As duas precisam coexistir ou o histórico do devnet quebra.

5.1 Migration Prisma

-- Adicionar novo campo sem remover o antigo

ALTER TABLE "DefaultEvent"

  ADD COLUMN "event_classification" TEXT;

-- Mapear valores existentes

UPDATE "DefaultEvent" SET "event_classification" =

  CASE default_reason

    WHEN 'PAYMENT_MISSED'  THEN 'LateBehavioral'

    WHEN 'INFRA_FAILURE'   THEN 'FrictionOperational'

    WHEN 'VOLUNTARY_EXIT'  THEN 'VoluntaryExit'

    ELSE 'Default'

  END;

-- Manter default_reason por retrocompatibilidade — deprecar em M+2

5.2 Atualização de Documentos Institucionais

4 documentos precisam ser atualizados para refletir os 4 níveis com os novos stakes:

Architecture Spec — tabela de níveis e stake requirements

Whitepaper — seção de collateral ladder

User Guide — seção 8 (50-30-10 agora é 50-25-10-3)

Behavioral Reputation Score — reputation ladder

NOTA

Parceiros que leram os docs antigos podem ter modelado L2 como 30%. A mudança para 25% precisa aparecer em changelog institucional com justificativa técnica explícita.

6. Fase 2 — Implementação Core

Ordem de implementação obrigatória: cada etapa depende da anterior.

Tarefa

Arquivo / Local

Prioridade

Dependência

1. State accounts: BehavioralEvent, ReputationMetrics, TierAssignment

src/state/behavioral_log.rs · reputation_metrics.rs · tier_assignment.rs

ALTO

Bloqueadores Fase 0

2. Funções matemáticas puras com testes unitários completos

src/math/reliability.rs · punctuality.rs · commitment.rs · recovery.rs

ALTO

Correções bug aritmético

3. Instrução record_event + classificação determinística

src/instructions/record_event.rs

ALTO

State accounts + math

4. Instrução attach_friction_proof com validação OracleConfig

src/instructions/attach_friction_proof.rs

ALTO

record_event + OracleConfig

5. Instruções recalculate_metrics + resolve_tier

src/instructions/recalculate_metrics.rs · resolve_tier.rs

ALTO

math + state accounts

6. Constantes públicas em constants.rs + constants_version

src/constants.rs (refatorar)

ALTO

Definição de níveis aprovada

6.1 Regra Crítica — Sem Vec Ilimitado On-chain

Contas Solana têm tamanho fixo em alocação. Usar Vec sem bound explícito quebra a conta quando cresce. Pattern correto para o histórico de eventos:

// ERRADO — Vec cresce indefinidamente

pub reclassification_history: Vec<Reclassification>,

// CORRETO — account list pattern por batch

#[account]

pub struct BehavioralLog {

    pub wallet: Pubkey,

    pub event_count: u32,

    pub batch_count: u8,  // quantos PDAs filhos existem

}

// PDA filho por batch de 50 eventos

// seed: ["event_batch", wallet, batch_index]

6.2 Versioning de Constantes

Quando constantes mudam via governança, TierAssignments antigos ficam inconsistentes. Solução: campo constants_version que sinaliza staleness.

#[account]

pub struct TierAssignment {

    pub tier: u8,

    pub assigned_at: i64,

    pub constants_version: u8,   // incrementa a cada PR em constants.rs

    pub snapshot_pda: Pubkey,    // ReputationMetrics PDA usado

}

// Se constants_version != CURRENT_CONSTANTS_VERSION

// → tier está stale, recalcular antes de usar

6.3 Integração com Crank de Produção

O orchestrator atual (services/orchestrator/) nunca chama settle_default. O crank de produção (01-crank-railway.ts) precisa chamar record_event logo após settle_default, sem janela de slot entre os dois.

// Sequência correta no crank de produção

async function processMissedPayment(pool, member) {

  // 1. settle_default com default_reason obrigatório

  await settleDefault(pool, member, 'PAYMENT_MISSED');

  // 2. record_event via CPI imediatamente após

  // NUNCA deixar settle_default sem record_event

  // → score fica desatualizado silenciosamente

}

7. Fase 3 — Infra de Suporte (Paralela ao Core)

Pode ser desenvolvida em paralelo às instruções core. Não bloqueia Fase 2, mas é obrigatória antes do canary.

Tarefa

Arquivo / Local

Prioridade

Dependência

Crank: settle_default → record_event em sequência atômica

services/orchestrator/01-crank-railway.ts

ALTO

record_event deployado

Testes bankrun: ciclo completo com score v5.2

tests/reputation-lifecycle-v52.ts

ALTO

Fase 2 completa

Score Reader Program — CPI público para protocolos externos

src/instructions/query_score.rs

ALTO

recalculate_metrics

Indexer: captura de EventClassification no webhook Helius

services/indexer/ + schema Prisma

MÉDIO

record_event deployado

7.1 Score Reader Program — A Peça Que Falta

Esta é a instrução mais estratégica da v5.2. Sem ela, 'score auditável' e 'score consumível por parceiros' são coisas diferentes. Parceiros como CREDO e Huma Finance precisam de uma instrução read-only que qualquer protocolo possa chamar via CPI.

// Instrução read-only — permissionless, qualquer protocolo chama

pub fn query_score(

    ctx: Context<QueryScore>,

    wallet: Pubkey,

) -> Result<ScoreSummary> {

    let metrics = &ctx.accounts.reputation_metrics;

    let tier    = &ctx.accounts.tier_assignment;

    Ok(ScoreSummary {

        tier:             tier.tier,

        reliability:      metrics.reliability,

        punctuality:      metrics.punctuality,

        is_stale:         tier.constants_version != CURRENT_CONSTANTS_VERSION,

    })

}

// Esta instrução transforma o score em primitiva de infraestrutura

// — diferença entre 'app com score' e 'protocolo de reputação'

8. Fase 4 — Pós-Canary

Estas funcionalidades não entram no MVP canary, mas o design das fases anteriores deve não bloquear sua implementação futura.

Tarefa

Arquivo / Local

Prioridade

Dependência

Governance program para BadFaith e atualização de constantes

programs/roundfi-governance/ (novo)

MÉDIO

Canary concluído

Multisig (Squads) como upgrade authority

Squads Protocol integration

MÉDIO

Governance program

ZK-proof de score para portabilidade privada

A definir

BAIXO

Score Reader + parceiros

B2B Reputation Oracle API (Helius webhook → score API)

services/indexer/src/score-api.ts

MÉDIO

≥500 pools completos

NOTA BadFaith

O mecanismo de BadFaith precisa de governance antes de ser ativado em produção. Até lá, qualquer evento classificado como BadFaith em devnet deve ser tratado como 'proposta pendente de aprovação' — não como classificação selada.

9. Checklist de Aprovação para Tirar o Freeze

Para justificar a saída do freeze de pré-canary, a equipe precisa aprovar os seguintes itens como 'críticos e estruturais':

9.1 O que justifica sair do freeze

Os 3 bloqueadores (bugs matemáticos + ORACLE_WHITELIST) impedem que o módulo de reputação existente seja considerado correto

A migration de MissReason → EventClassification precisa acontecer antes de qualquer novo ciclo de devnet gerar dados com o schema antigo

A v5.2 não é scope creep — é a especificação que formaliza o que o sistema de reputação já pretende ser

9.2 O que NÃO justifica sair do freeze

Adicionar novas features de produto não relacionadas à correção do score

Qualquer mudança no roundfi-core sem teste de regressão completo

Deploy em devnet antes de todos os testes unitários das funções math passarem

9.3 Argumento recomendado para a equipe

Não apresentar a v5.2 como 'preciso tirar o freeze para implementar isso'. Apresentar como:

ARGUMENTO

A v5.2 é a especificação que deve guiar o próximo ciclo — não uma mudança no canary atual. Ela pode ser mergeada como documento de design em docs/ agora, e implementada como upgrade planejado após o canary, com seus próprios testes e evidência Solscan. Isso respeita o freeze e coloca a v5.2 no lugar certo: spec do próximo milestone.

10. Resumo Executivo

A v5.2 mantém o esqueleto de 4 camadas da v5.0 e incorpora as boas ideias da v5.1 (taxonomia de 6 categorias, FrictionProof), descartando toda discricionariedade: nada de adiamento de fórmulas, nada de score interno, nada de smoothing opaco, nada de janela de admin.

Tudo é função pura e auditável: as 4 métricas têm fórmulas explícitas no código com pesos publicados como constantes; a classificação dos eventos é determinística por delta_seconds + prova on-chain; FrictionProof exige verificação por oráculo/tx-hash/governança — nunca admin individual.

O resultado é um protocolo onde qualquer terceiro, com o código aberto, refaz a conta e chega no mesmo número — o ativo central do RoundFi: histórico verificável como infraestrutura.

Item

Status

Bugs matemáticos (reliability, punctuality)

Correção obrigatória antes de qualquer PR

ORACLE_WHITELIST indefinida

Design necessário antes de attach_friction_proof

Migration MissReason → EventClassification

Necessária antes de novos ciclos de devnet

Docs institucionais com 3 níveis

Atualizar para 4 níveis em paralelo

Score Reader Program (query_score)

Prioridade alta — habilita integração B2B

Governance program (BadFaith)

Post-canary — design não deve ser bloqueado

RoundFi · Sistema de Reputação v5.2 · Documento interno — não distribuir externamente

Este documento é técnico e estratégico. Não constitui conselho financeiro, jurídico ou de investimento.
