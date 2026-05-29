# 🏛️ RoundFi — Proposta v5.1 do Sistema de Reputação

> **Resposta aos 3 pontos críticos do time: classificação antes de calibração, fricção é diferente de inadimplência, dataset antes de fórmula.**

**Status:** Proposta conceitual para comparação com v5.0
**Autor:** Sessão de design com Alrimar
**Data:** 2026-05-29
**Escopo:** Refinamento da v5.0 incorporando feedback do time sobre (1) precisão falsa sem dataset, (2) penalidades ainda agressivas, (3) ausência de taxonomia comportamental
**Mudança principal:** Score público adiado · Penalidades quase nulas para fricção · Taxonomia de 6 categorias

---

## 📑 Índice

1. [O que muda entre v5.0 e v5.1](#-o-que-muda-entre-v50-e-v51)
2. [Princípios reforçados](#-princípios-reforçados)
3. [Ponto 1 — Dataset antes de matemática](#1️⃣-ponto-1--dataset-antes-de-matemática)
4. [Ponto 2 — Reputação recuperável, não punitiva](#2️⃣-ponto-2--reputação-recuperável-não-punitiva)
5. [Ponto 3 — Taxonomia de 6 categorias](#3️⃣-ponto-3--taxonomia-comportamental-de-6-categorias)
6. [Arquitetura faseada](#-arquitetura-faseada)
7. [MVP de Fase 0](#-mvp-de-fase-0-só-camadas-1-e-2)
8. [Schemas atualizados](#-schemas-atualizados)
9. [Comparativo v5.0 vs v5.1](#-comparativo-v50-vs-v51)
10. [Perguntas para o time](#-perguntas-em-aberto-para-o-time)
11. [Resumo executivo](#-resumo-executivo)

---

## 🔀 O QUE MUDA ENTRE v5.0 E v5.1

| Aspecto | v5.0 | **v5.1** |
|---|---|---|
| Score público | Calculado desde o dia 1 | **Adiado para Fase 1 com dataset real** |
| Pesos das métricas | Heurísticos definidos agora | **Definidos pós-calibração com dados** |
| Categorias de evento | 3 (MissReason) | **6 (EventClassification)** |
| Distinção fricção/inadimplência | Implícita | **Explícita, com prova on-chain** |
| Penalidades | Suavizadas mas presentes | **Quase nulas para fricção + temporal** |
| Camada 4 (Nível) | Promove na Fase 1 | **Adiada — só após dataset validar critérios** |
| MVP entrega | Histórico + métricas + nível | **Só Camadas 1 e 2** |
| Fórmulas (Reliability etc.) | Definidas no doc | **Descritivas, não normativas — calibração vem depois** |

---

## 🎯 PRINCÍPIOS REFORÇADOS

A v5.1 mantém as 4 camadas da v5.0 (Identidade · Histórico · Reputação · Nível), mas reescreve **3 princípios** sob influência do feedback:

### Princípio 1 — Modelagem antes de otimização
> *"Sem dataset, a matemática é teoria. Acertar o esqueleto (eventos, classificações, storage) vale mais do que calibrar pesos contra a intuição de uma sala."*

### Princípio 2 — Reputação recuperável, não punitiva
> *"O protocolo não pode parecer um social score punitivo. Precisa parecer um histórico verificável que perdoa fricção e registra inadimplência sem destruir o usuário."*

### Princípio 3 — Classificação antes de calibração
> *"Behavioral credit depende de distinguir incapacidade, irresponsabilidade, fricção e má fé. Tratar tudo igual é injustiça com aparência de objetividade."*

---

## 1️⃣ PONTO 1 — DATASET ANTES DE MATEMÁTICA

### O que o time apontou
Toda fórmula tipo `-67 × 1.41 × 1.6` é **precisão falsa**. Sem dataset real (comportamento, churn, taxa de recuperação, impacto emocional), os pesos são chute calibrado contra intuição, não contra dados.

### O que a v5.1 faz

**(a) Lança sem score público.**
- Fase 0 do MVP entrega **apenas** Camadas 1 (Identidade) e 2 (Histórico).
- Nenhum número agregado é exibido ao usuário.
- O usuário vê seu próprio extrato: *"você fez X pagamentos, Y no prazo, Z atrasos pequenos"* — sem nota.

**(b) Métricas internas só para análise.**
- Reliability, Punctuality, Commitment, Recovery existem como **views analíticas internas**, não como UI.
- Servem para o time medir, não para o usuário ser julgado.

**(c) Fórmulas viram descritivas, não normativas.**
- A v5.0 dizia: *"Reliability = on_time / total × 100"*.
- A v5.1 diz: *"Reliability é uma função do histórico de pontualidade, a ser calibrada na Fase 1 com dados reais. Forma exata definida pós-Fase 0."*
- O esqueleto é mantido para o time entender o destino. Os números, não.

**(d) Score público só na Fase 2.**
- Depois de ≥500–1.000 pools completos (número exato a definir com o time).
- Derivado de **regressão sobre dados reais** (que delta_seconds prediz default? em que base rate?).
- Apresentado como **probabilidade de comportamento futuro**, não como nota moral.

### Resultado
A v5.1 troca *"4 fórmulas definidas agora"* por *"4 fórmulas a serem definidas com dataset"*. O esqueleto da v5.0 fica; os números somem até existirem dados.

---

## 2️⃣ PONTO 2 — REPUTAÇÃO RECUPERÁVEL, NÃO PUNITIVA

### O que o time apontou
Mesmo na v5.0, exemplos como *"pool 12 meses, atraso 7 dias = −134"* sobrevivem. Isso é raciocínio bancário tradicional. Cria sensação de **"nunca consigo recuperar"** e o usuário abandona.

### O que a v5.1 faz

**(a) Atraso pequeno: zero impacto público.**
- `delta_seconds` < 7 dias **não altera** Reliability/Punctuality publicamente exibidos.
- Aparece no histórico granular (Camada 2) como evidência verificável.
- Quem quiser ver o detalhe (auditor, outro protocolo) acessa; o usuário comum vê resumo perdoado.

**(b) Smoothing forte por padrão.**
- Métricas usam janela móvel longa (ex: últimos 50 eventos) ou rolling average com decay.
- 1 atraso pequeno em 50 eventos limpos é matematicamente invisível.
- Equivale à intuição humana: *"um deslize isolado não muda quem você é"*.

**(c) Perdão estrutural explícito.**
- Atrasos pequenos isolados são **filtrados** como outliers benignos.
- Implementação: descartar 1–2 piores eventos da janela quando há histórico denso de bom comportamento.
- Análogo ao *"você tem direito a 1 deslize por ano"* de cartões premium.

**(d) Histórico é honesto, score é generoso.**
- Camada 2 (histórico) registra tudo com fidelidade — `delta_seconds: +86400` continua lá.
- Camada 3 (reputação) perdoa estruturalmente.
- Quem precisa de granularidade (instituição, terceiro) lê C2. Usuário comum lê C3.
- Não é mentira — é **resumo bem desenhado**.

**(e) Penalidades só onde fazem sentido (ver Ponto 3).**
- Fricção operacional → 0
- Fricção temporal → ~0 público
- Atraso comportamental → suave e recuperável
- Inadimplência → significativo mas recuperável em outro pool
- Má fé → permanente (único caso destrutivo)

### Cenário concreto: 10 meses limpos + 1 atraso de 1 dia

| Camada | Estado após o atraso |
|---|---|
| **C1 Identidade** | Inalterada (não tem por quê mudar) |
| **C2 Histórico** | Registra `PaymentMade { delta_seconds: +86400 }` — fato verificável |
| **C3 Reputação** | Reliability cai de 100 → 99 (1 evento em 11) — pode ser filtrado como outlier benigno |
| **C4 Nível** | **Inalterado** |
| **Sentimento do usuário** | *"o sistema entendeu que foi um deslize"* |

---

## 3️⃣ PONTO 3 — TAXONOMIA COMPORTAMENTAL DE 6 CATEGORIAS

### O que o time apontou
O conceito central que ainda não estava bem definido: **inadimplência ≠ fricção ≠ incapacidade ≠ má fé**. A v5.0 introduziu `MissReason` com 3 valores, mas isso era tímido demais.

### O que a v5.1 faz

Substitui `MissReason` por **`EventClassification` com 6 categorias** + sistema de **prova de classificação**.

### Tabela de classificação

| # | Categoria | Natureza | Exemplos típicos | Impacto reputacional | Prova necessária |
|---|---|---|---|---|---|
| 1 | 🟢 **Fricção operacional** | Externa ao usuário | RPC down, congestão Solana, gas spike, wallet bug, slot skip | **Zero** — neutro | Oráculo on-chain OU atestação admin com evidência |
| 2 | 🟡 **Fricção temporal** | Humana, baixíssimo risco | Esqueceu por 1–6h, fuso horário, atraso de minutos/horas | **Mínimo** — visível só em C2 granular | `delta_seconds` ≤ threshold |
| 3 | 🟠 **Atraso comportamental** | Humana, médio risco | Pagou com 1–7 dias de atraso mas pagou | **Suave e recuperável** | `delta_seconds` ≤ 7d + pagamento confirmado |
| 4 | 🔴 **Incapacidade temporária** | Liquidez | Sem fundos no prazo, mas honra em até N dias | **Moderado, recuperável** | Padrão de recuperação rápida |
| 5 | ⚫ **Inadimplência** | Abandono passivo | Não pagou, não comunicou, sumiu | **Significativo mas recuperável em OUTRO pool** | Default declarado + sem recovery no pool |
| 6 | ☠️ **Má fé / fraude** | Intenção adversária | Sybil, farming, rage quit, drain | **Permanente, irrecuperável** | Governança/admin com prova forte |

### Como cada categoria é decidida

**🟢 Fricção operacional**
- **Decisão automatizável** quando há prova on-chain:
  - Oráculo de gas-price/slot-confirmation registrando spike
  - TX falhada por slippage/congestão (hash + erro)
  - Janela de "RPC outage" declarada por validators
- **Decisão manual** (admin) quando prova é off-chain (com governança)
- Categoria reclassifica eventos negativos retroativamente

**🟡 Fricção temporal**
- Derivada de `delta_seconds` simples
- Sem necessidade de evidência adicional
- Threshold sugerido: `delta_seconds ≤ T_FRICTION_TEMPORAL` (ex: 6h, a calibrar)

**🟠 Atraso comportamental**
- Derivada de `delta_seconds`
- Pagou em até N dias após due (sugestão: 1–7 dias)
- O fato de ter honrado já é evidência de boa fé

**🔴 Incapacidade temporária**
- Detectada pelo **padrão pós-evento**:
  - Não pagou no prazo, mas pagou em até X dias com penalidade aceita
  - "Recuperação rápida" sinaliza incapacidade pontual, não inadimplência
- Diferente de inadimplência (que não recupera no pool)

**⚫ Inadimplência**
- Default sem comunicação, sem recuperação no pool
- Triple Shield acionado (Fundo, Escrow, Stake)
- **Mas o usuário pode reentrar em outro pool e reconstruir histórico**
- C2 registra para sempre; C3 perdoa com tempo + bom comportamento futuro

**☠️ Má fé**
- Único caso onde reputação é **destruída permanentemente**
- Requer **evidência forte** + atestação de governança
- Exemplos: padrão de sybil (mesmo IP/timing/funding source), rage quit coordenado, drain de pool
- Bloqueia reentrada e portabilidade

### Princípio de design
> **"Cada evento negativo nasce com classificação provisória. Tem janela de N dias para ser reclassificado mediante prova. Após a janela, classificação fica selada."**

---

## 🗂️ ARQUITETURA FASEADA

A v5.1 separa explicitamente **o que vai para produção e quando**.

```
┌─ FASE 0 (MVP) — 3 a 6 meses ───────────────────────────┐
│                                                          │
│  ✅ Camada 1: Identidade (wallet age, PoP, KYC)          │
│  ✅ Camada 2: Histórico (eventos + classificação 6 cat.) │
│  ❌ Camada 3: Reputação (interna, não exibida)           │
│  ❌ Camada 4: Nível (não existe ainda)                   │
│                                                          │
│  Stake/permissões: usam Camada 1 + contadores brutos     │
│  de Camada 2 (ex: "≥3 pools completos" para X)           │
│                                                          │
│  Foco: instrumentação correta, classificação rica,       │
│  storage adequado, antifarming na base                   │
└──────────────────────────────────────────────────────────┘
                          ↓
┌─ FASE 1 (Calibração) — 6 a 12 meses ───────────────────┐
│                                                          │
│  ✅ Camada 3 interna: análise retroativa do dataset      │
│      • Que delta_seconds prediz default subsequente?     │
│      • Que classificação correlaciona com churn?         │
│      • Qual base rate de cada categoria?                 │
│                                                          │
│  ❌ Score público: ainda não                             │
│  ❌ Nível público: ainda não                             │
│                                                          │
│  Foco: encontrar correlações reais, validar premissas,   │
│  desenhar fórmulas simples (1–2 parâmetros)              │
└──────────────────────────────────────────────────────────┘
                          ↓
┌─ FASE 2 (Score público) — 12+ meses ───────────────────┐
│                                                          │
│  ✅ Camada 3 pública: as 4 métricas baseadas em dados    │
│  ✅ Camada 4: níveis com critérios calibrados            │
│  ✅ Apresentado como probabilidade, não como nota moral  │
│  ✅ Integrações externas (CPF Web3)                      │
│                                                          │
│  Foco: produto público, parcerias, exportabilidade       │
└──────────────────────────────────────────────────────────┘
```

### Por que essa sequência

- **Fase 0** garante que a base está certa antes de qualquer juízo
- **Fase 1** garante que pesos vêm de dados, não de intuição
- **Fase 2** garante que o score público nasce já validado
- Risco invertido: em vez de lançar e calibrar sob pressão, lança discreto e calibra em paz

---

## 📦 MVP DE FASE 0 (só Camadas 1 e 2)

Para o time entender o escopo concreto:

### O que o usuário vê (Fase 0)
```
═══ MEU PERFIL ROUNDFI ═══

Identidade
  • Wallet ativa há 4.2 anos
  • Proof of Personhood verificado
  • 7 pools completados, 1 em andamento

Histórico
  • 84 pagamentos totais
  • 81 no prazo, 3 com pequeno atraso (todos <24h)
  • 0 defaults
  • 0 eventos de fricção operacional
  • Streak atual: 61 pagamentos consecutivos
```

**Notar:** **nenhum número agregado**. Sem "94/100". Sem "L4". Sem "Reliability". Só fatos verificáveis.

### O que o protocolo internamente usa (Fase 0)
- Contadores brutos da C2 podem alimentar regras de stake/permissão:
  - *"para entrar em pool ≥R$10k, precisa de ≥3 pools completos sem default nos últimos 12 meses"*
- Isso usa **fatos**, não score derivado — e é honesto sobre o que está medindo
- Métricas internas (C3) existem em ambiente analítico do time, não em UI

### Instruções on-chain (Fase 0)
```
✅ record_behavioral_event(event, classification_provisional)
✅ reclassify_event(event_id, new_classification, proof)
✅ attest_friction(event_id, friction_proof)
✅ update_identity(field, value, proof)
❌ recalculate_reputation_metrics — Fase 1
❌ promote_tier — Fase 2
```

### Contas/PDAs (Fase 0)
```
✅ IdentityProfile        [seed: "identity", wallet]
✅ BehavioralLog          [seed: "behavioral_log", wallet]
✅ EventClassification    [seed: "event_class", wallet, event_id]
❌ ReputationMetrics      — Fase 1 (interno)
❌ TierAssignment          — Fase 2
```

---

## 📐 SCHEMAS ATUALIZADOS

### EventClassification (substitui MissReason)

```rust
pub enum EventClassification {
    // Positivos
    PaymentOnTime,
    PaymentEarly,
    CycleComplete,
    PoolComplete,
    Recovery,

    // Negativos com gradação
    FrictionOperational {
        proof: FrictionProof,
    },
    FrictionTemporal {
        delta_seconds: i64,        // pequeno
    },
    LateBehavioral {
        delta_seconds: i64,        // 1–7d
    },
    TemporaryIncapacity {
        delta_seconds: i64,
        recovered_in_days: u32,
    },
    Default {
        amount_at_risk: u64,
        recovery_in_pool: bool,
    },
    BadFaith {
        evidence: BadFaithEvidence,
        attested_by: Pubkey,
    },
}

pub enum FrictionProof {
    OnChainOracleSpike { oracle: Pubkey, timestamp: i64 },
    FailedTransaction { tx_hash: [u8; 64], error_code: u32 },
    AdminAttested { admin: Pubkey, evidence_uri: String },
    ValidatorOutageWindow { start: i64, end: i64 },
}

pub enum BadFaithEvidence {
    SybilPattern { related_wallets: Vec<Pubkey> },
    RageQuit { pool: Pubkey, cycle_index: u32 },
    PoolDrainAttempt { tx_hash: [u8; 64] },
    GovernanceFinding { proposal_id: u64 },
}
```

### Evento com classificação provisória + janela de reclassificação

```rust
pub struct BehavioralEvent {
    pub wallet: Pubkey,
    pub pool: Pubkey,
    pub cycle_index: u32,
    pub timestamp: i64,
    pub event_data: EventData,

    // Classificação inicial (calculada do delta_seconds + contexto)
    pub classification: EventClassification,

    // Janela de reclassificação (ex: 7 dias)
    pub classification_sealed_at: i64,
    pub reclassification_history: Vec<Reclassification>,
}

pub struct Reclassification {
    pub from: EventClassification,
    pub to: EventClassification,
    pub reason: String,
    pub attested_by: Pubkey,
    pub timestamp: i64,
}
```

### Instruções

```rust
// Fase 0
record_behavioral_event(event_data, initial_classification)
reclassify_event(event_id, new_classification, proof) // dentro da janela
attest_friction(event_id, friction_proof)

// Fase 1 (interno)
recalculate_metrics_internal(window: u32) // não-permissionless

// Fase 2 (público)
publish_reputation_metrics(wallet)
promote_tier(wallet)
```

---

## 📊 COMPARATIVO v5.0 vs v5.1

| Dimensão | v5.0 | **v5.1** |
|---|---|---|
| **Filosofia** | Histórico é o produto | Histórico é o produto **+ classificação rica antes de fórmula** |
| **Score público no MVP** | Sim, calculado de fórmulas heurísticas | **Não. Só histórico verificável** |
| **Quando o score aparece** | Dia 1 | **Fase 2, após dataset** |
| **Pesos das métricas** | Heurísticos descritos no doc | **Indefinidos. Calibração pós-Fase 1** |
| **Categorias de evento** | 3 (PaymentMissed, InfraFailure, VoluntaryExit) | **6 (Fricção Op, Fricção Tmp, Atraso, Incapacidade, Inadimplência, Má fé)** |
| **Prova de fricção** | Mencionada vagamente | **Sistema formal de FrictionProof on-chain** |
| **Janela de reclassificação** | Inexistente | **N dias (sugestão 7) com reattestation** |
| **Penalidade fricção** | "Zero" mencionado | **Zero — formalizado em contrato** |
| **Penalidade atraso pequeno** | Suave | **Invisível publicamente, registrada granularmente** |
| **Filtro de outlier benigno** | Não | **Sim — smoothing estrutural** |
| **Camada 4 (Nível)** | Promove na Fase 1 | **Só na Fase 2, com critérios calibrados** |
| **Stake/permissões no MVP** | Derivados do score | **Derivados de fatos da Camada 1 + contadores brutos da Camada 2** |
| **Risco principal endereçado** | Apenas conceito | **Time foi explícito: precisão falsa, punição agressiva, falta de taxonomia** |

---

## ❓ PERGUNTAS EM ABERTO PARA O TIME

Estas são as decisões que precisam do time antes de escrever uma linha de código:

1. **Fricção operacional** — temos hoje algum oráculo de "Solana congestion" / gas-price spike que possamos usar como prova on-chain? Ou precisaremos construir/integrar com alguma fonte externa (Helius, Triton, Jito)?

2. **Limite incapacidade vs inadimplência** — qual o limite temporal que separa as duas? 7 dias? 30? Deve vir proporcional ao `cycle_duration`?

3. **MVP sem score público** — o time concorda em lançar **sem score público**? Isso é uma mudança de produto importante e provavelmente exige conversa com marketing/produto.

4. **Dataset mínimo para calibrar** — quantos pools completos antes de começar a desenhar fórmulas? 500 é palpite. Qual é o número real considerando margem de erro estatística aceitável?

5. **Má fé** — temos governance/admin pronto para atestar manualmente? Ou precisamos definir processo formal (proposta on-chain, voting period) antes de Fase 0?

6. **Janela de reclassificação** — 7 dias é um chute. Quanto tempo é razoável para um oráculo/admin reclassificar uma fricção depois do evento? Considera fuso, fim de semana, holidays?

7. **Smoothing / outlier filtering** — definir o "perdão estrutural" como regra publicada ou como característica emergente da fórmula? Implicação ética: transparência vs simplicidade de comunicação.

8. **Portabilidade do extrato** — o histórico verificável (C2) deve ser exportável como ZK-proof desde Fase 0 ou só após score público existir? Tem caso de uso de instituição parceira que precisaria já?

---

## 🎯 RESUMO EXECUTIVO

> A v5.1 mantém o esqueleto de 4 camadas da v5.0, mas obedece o feedback do time em 3 frentes: **(1)** adia toda matemática até existir dataset real — o MVP entrega só Identidade e Histórico, sem score público; **(2)** elimina penalidades agressivas substituindo-as por "perdão estrutural" — atrasos pequenos são registrados como fatos mas invisíveis no score; **(3)** introduz taxonomia formal de 6 categorias (Fricção Operacional, Fricção Temporal, Atraso Comportamental, Incapacidade, Inadimplência, Má fé) com sistema de prova on-chain e janela de reclassificação. O resultado é um protocolo que **classifica antes de calibrar, distingue antes de punir, e mede antes de julgar** — exatamente o que o time apontou como necessário.

---

## 📝 Histórico das iterações

- **v1** — Análise do sistema atual
- **v2** — Penalidades graduadas, bônus antecipação, streak, redenção, novo L4
- **v3** — Aceleração de progressão (L1→L2 em ~6m)
- **v4** — Sistema matemático com pesos dinâmicos por duração de pool, escala 0–1000
- **v5.0** — Arquitetura em 4 camadas, histórico como produto central
- **v5.1** ← **este doc** — Faseamento, taxonomia de 6 categorias, score público adiado

---

**Status:** Proposta para comparação com v5.0 e revisão de time.
**Não há código modificado.** Documento puro para discussão.
