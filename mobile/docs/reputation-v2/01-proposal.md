# 🏛️ RoundFi — Proposta v5.2 do Sistema de Reputação

> **Auditável por design · 4 camadas · 4 níveis · Fórmulas explícitas · Sem discricionariedade**

**Status:** Proposta conceitual para comparação com v5.0 e v5.1
**Autor:** Sessão de design com Alrimar
**Data:** 2026-05-29
**Escopo:** Refinamento da v5.0 mantendo auditabilidade total, incorporando as boas ideias da v5.1 (taxonomia de 6 categorias, FrictionProof) sem importar a discricionariedade (fases ocultas, score interno, smoothing opaco)
**Princípio guia:** *"Qualquer pessoa, sozinha, com o código aberto, refaz a conta e chega no mesmo número."*

---

## 📑 Índice

1. [Por que v5.2 (e não v5.1)](#-por-que-v52-e-não-v51)
2. [O que a v5.2 herda e o que descarta](#-o-que-a-v52-herda-e-o-que-descarta)
3. [Arquitetura de 4 camadas](#-arquitetura-de-4-camadas)
4. [Camada 1 — Identidade](#-camada-1--identidade)
5. [Camada 2 — Histórico Comportamental](#-camada-2--histórico-comportamental-com-6-categorias)
6. [Camada 3 — Reputação (fórmulas explícitas e gentis)](#-camada-3--reputação-fórmulas-explícitas-e-gentis)
7. [Camada 4 — 4 Níveis](#-camada-4--4-níveis)
8. [Taxonomia de 6 categorias determinística](#-taxonomia-de-6-categorias-determinística)
9. [FrictionProof — prova on-chain](#-frictionproof--prova-on-chain)
10. [Auditabilidade em prática](#-auditabilidade-em-prática)
11. [Comparativo v5.0 vs v5.1 vs v5.2](#-comparativo-v50-vs-v51-vs-v52)
12. [Schemas Rust](#-schemas-rust)
13. [Mudanças no código](#-mudanças-no-código)
14. [Resumo executivo](#-resumo-executivo)

---

## 🎯 POR QUE v5.2 (E NÃO v5.1)

A v5.1, ao tentar evitar "precisão falsa", **trocou determinismo por discricionariedade**. Isso é o oposto do que um protocolo DeFi deve ser.

| v5.1 | v5.2 |
|---|---|
| **Íntima** — confiar no time | **Auditável** — qualquer um verifica |
| Fórmulas "a calibrar" | Fórmulas **explícitas no código**, mesmo que simples |
| Score interno, time decide quando soltar | Score **público desde dia 1** |
| Smoothing por regra interna | Smoothing por **fórmula publicada** |
| Admin pode reclassificar dentro de janela | Classificação **determinística** + FrictionProof on-chain |
| Fases ocultas com discricionariedade | **Upgrades públicos** via governança |

A v5.2 obedece o mesmo feedback do time (penalidades gentis, classificação rica, sem "punição bancária"), mas **dentro de regras públicas e verificáveis** — não trocando rigor por opacidade.

---

## 🔀 O QUE A v5.2 HERDA E O QUE DESCARTA

### Herda da v5.0 (mantém o core auditável)
- ✅ Arquitetura de 4 camadas
- ✅ Score público desde dia 1
- ✅ Fórmulas explícitas no código
- ✅ As 4 métricas (Reliability, Punctuality, Commitment, Recovery)
- ✅ Nível como **derivado**, não como meta

### Herda da v5.1 (boas ideias que viraram regra pública)
- ✅ Taxonomia de **6 categorias** de evento — agora **determinística** (sem janela de admin)
- ✅ `FrictionProof` — agora obrigatoriamente **on-chain** (oráculo ou tx-hash verificável)
- ✅ Penalidades gentis para atrasos pequenos — agora **publicadas como constantes**, não como smoothing interno

### Descarta da v5.1 (anti-auditoria)
- ❌ Adiamento de fórmulas ("a calibrar com dataset") → **fórmulas simples mas públicas desde já**
- ❌ Score interno só para o time → **tudo público**
- ❌ Smoothing opaco → **fórmula de média móvel publicada como constante**
- ❌ Janela de reclassificação por admin → **classificação determinística**; mudança só via governança pública
- ❌ Fases de rollout escondidas → **upgrades de constantes** documentados

### Diferença da v5.0
- 🔄 **5 níveis → 4 níveis** (decisão de produto, custo técnico ~30 linhas)
- 🔄 **3 categorias de evento → 6 categorias** (mais expressivo)
- 🔄 **Penalidades agressivas → penalidades gentis** (mas explícitas)
- 🔄 **MissReason → EventClassification + FrictionProof**

---

## 🏗️ ARQUITETURA DE 4 CAMADAS

Idêntica à v5.0. As camadas inferiores não dependem das superiores. Camada 2 é append-only. Camadas 3 e 4 são funções puras das anteriores — qualquer terceiro pode recomputar.

```
┌──────────────────────────────────────────────────────────┐
│  CAMADA 4 — NÍVEL (derivado de C1+C3, função pura)       │
│  L1 · L2 · L3 · L4                                       │
└──────────────────────────────────────────────────────────┘
                          ↑ função pura
┌──────────────────────────────────────────────────────────┐
│  CAMADA 3 — REPUTAÇÃO (4 métricas, função pura de C2)    │
│  Reliability · Punctuality · Commitment · Recovery       │
└──────────────────────────────────────────────────────────┘
                          ↑ função pura
┌──────────────────────────────────────────────────────────┐
│  CAMADA 2 — HISTÓRICO (append-only, 6 categorias)        │
│  EventClassification + FrictionProof                     │
└──────────────────────────────────────────────────────────┘
                          ↑ ancorada em
┌──────────────────────────────────────────────────────────┐
│  CAMADA 1 — IDENTIDADE (fatos estáveis)                  │
│  Wallet Age · PoP · KYC · Pools                          │
└──────────────────────────────────────────────────────────┘
```

> **Garantia de auditabilidade:** dado o histórico (C2) e a identidade (C1) de uma wallet, qualquer parte com o código aberto consegue reproduzir bit-a-bit o score (C3) e o nível (C4). Sem zonas cinzentas.

---

## 📐 CAMADA 1 — IDENTIDADE

Inalterada vs v5.0.

```rust
pub struct IdentityLayer {
    pub wallet_pubkey: Pubkey,
    pub wallet_first_seen_at: i64,
    pub roundfi_first_join_at: i64,
    pub proof_of_personhood: bool,
    pub pop_verified_at: i64,
    pub pop_expires_at: i64,
    pub kyc_tier: u8,
    pub total_pools_joined: u32,
    pub total_pools_completed: u32,
}
```

---

## 📊 CAMADA 2 — HISTÓRICO COMPORTAMENTAL (com 6 categorias)

```rust
pub struct BehavioralEvent {
    pub wallet: Pubkey,
    pub pool: Pubkey,
    pub cycle_index: u32,
    pub timestamp: i64,
    pub due_timestamp: i64,
    pub paid_timestamp: Option<i64>,
    pub amount: u64,
    pub delta_seconds: i64,
    pub parcels_paid: u8,
    pub classification: EventClassification,  // determinística — ver §8
    pub friction_proof: Option<FrictionProof>, // se aplicável — ver §9
}
```

**Regras de imutabilidade:**
- Evento, uma vez registrado, **nunca é editado**
- `FrictionProof` pode ser **anexado** em até 7 dias do evento (única exceção, mas adicionar prova é determinístico — não há "atestação de admin discricionária")
- Sem prova válida no prazo: classificação inicial fica selada

---

## 🧮 CAMADA 3 — REPUTAÇÃO (fórmulas explícitas e gentis)

As 4 métricas são funções puras do histórico. Todos os parâmetros são **constantes públicas no código**.

### Reliability — "quão consistente esse usuário tem sido"

```rust
// Janela de cálculo
pub const RELIABILITY_WINDOW: u32 = 50;  // últimos 50 eventos

// Pesos por classificação (em basis points, 10_000 = 100%)
pub const W_PAYMENT_ON_TIME:        i32 =  100;  // +1.00
pub const W_PAYMENT_EARLY:          i32 =  100;  // +1.00 (mesmo peso)
pub const W_FRICTION_OPERATIONAL:   i32 =  100;  // +1.00 (NEUTRO — fricção comprovada não pune)
pub const W_FRICTION_TEMPORAL:      i32 =   95;  // -0.05
pub const W_LATE_BEHAVIORAL:        i32 =   70;  // -0.30
pub const W_TEMPORARY_INCAPACITY:   i32 =   40;  // -0.60
pub const W_DEFAULT:                i32 =    0;  // -1.00
pub const W_BAD_FAITH:              i32 = -200;  // -3.00 (penalidade composta)

// Reliability = média ponderada dos últimos N eventos × 100
fn reliability(events: &[BehavioralEvent]) -> u16 {
    let window = events.iter().rev().take(RELIABILITY_WINDOW as usize);
    let (sum, count) = window.fold((0i32, 0i32), |(s, c), e| {
        (s + weight_of(e.classification), c + 1)
    });
    let raw = (sum * 100) / (count * 100);  // normalizado para 0–100
    raw.clamp(0, 100) as u16
}
```

**O que isso significa na prática:**
- 50 eventos perfeitos → 100
- 49 eventos perfeitos + 1 atraso pequeno (`FrictionTemporal`) → **99.9** (não 90, não 50)
- 49 perfeitos + 1 atraso comportamental (`LateBehavioral`) → **99.4**
- 49 perfeitos + 1 default → **98.0** (recuperável com 50 OTs novos)
- 50 eventos com 1 má-fé → **94.0** (recuperação muito lenta — proteção)

> **Esse é o "smoothing estrutural" da v5.1, mas escrito como fórmula pública.** Qualquer um refaz a conta.

### Punctuality — "quão próximo do prazo paga em média"

```rust
pub const PUNCTUALITY_WINDOW: u32 = 50;
pub const PUNCTUALITY_FRICTION_GRACE_HOURS: u32 = 1;  // <1h não conta como atraso

fn punctuality(events: &[BehavioralEvent]) -> u16 {
    let window = events.iter().rev()
        .filter(|e| matches!(e.classification, PaymentOnTime | PaymentEarly | FrictionTemporal | LateBehavioral | TemporaryIncapacity))
        .take(PUNCTUALITY_WINDOW as usize);

    let avg_delta_secs: i64 = window.map(|e| e.delta_seconds).sum() / count;

    // Mapeamento linear público:
    // delta <= -3 dias  → 100
    // delta == 0        → 80
    // delta == 1 dia    → 60
    // delta == 7 dias   → 30
    // delta >= 30 dias  → 0
    let punct = match avg_delta_secs {
        d if d <= -259_200 => 100,
        d if d <=       0 => 80 + ((-d * 20) / 259_200) as u16,
        d if d <=  86_400 => 80 - ((d * 20) / 86_400) as u16,
        d if d <= 604_800 => 60 - ((d * 30) / 604_800) as u16,
        d if d <= 2_592_000 => 30 - ((d * 30) / 2_592_000) as u16,
        _ => 0,
    };
    punct.clamp(0, 100)
}
```

### Commitment — "termina o que começa"

```rust
fn commitment(identity: &IdentityLayer, history: &[BehavioralEvent]) -> u16 {
    if identity.total_pools_joined == 0 { return 0; }

    let completion_rate = (identity.total_pools_completed * 100) / identity.total_pools_joined;

    // Bônus por completar ciclos sem default
    let perfect_cycles = history.iter()
        .filter(|e| matches!(e.classification, CycleComplete))
        .count() as u32;
    let perfect_bonus = (perfect_cycles * 2).min(20);  // até +20

    (completion_rate + perfect_bonus).min(100) as u16
}
```

### Recovery — "quando tropeça, se levanta?"

```rust
fn recovery(history: &[BehavioralEvent]) -> Option<u16> {
    let stumbles = history.iter().filter(|e| matches!(e.classification,
        LateBehavioral | TemporaryIncapacity | Default
    )).count();

    if stumbles == 0 { return None; }  // sem tropeços = N/A, não penaliza

    let recoveries = history.iter().filter(|e| matches!(e.classification, Recovery { .. })).count();
    let rate = (recoveries * 100) / stumbles;
    Some(rate.min(100) as u16)
}
```

> **Auditabilidade:** todas as 4 funções são determinísticas, sem `now()`, sem aleatoriedade, sem leitura externa. Mesmo input → mesmo output.

---

## 🏆 CAMADA 4 — 4 NÍVEIS

Decisão tomada: **4 níveis** (em vez de 5 da v5.0). Custo técnico marginal (~30 linhas), comunicação mais simples, saltos mais significativos.

| Nível | Nome | Critérios (TODOS exigidos) | Stake |
|---|---|---|---|
| **L1** | Iniciante | Default | **50%** |
| **L2** | Comprovado | ≥1 pool completo · Reliability ≥70 · Punctuality ≥60 | **25%** |
| **L3** | Veterano | ≥3 pools completos · Wallet age ≥6 meses · Reliability ≥85 · Punctuality ≥75 · Recovery ≥80 (se aplicável) | **10%** |
| **L4** | Elite | ≥8 pools completos · Wallet age ≥2 anos · PoP ativo · Reliability ≥94 · Punctuality ≥88 · Commitment ≥90 · 0 eventos de má-fé | **3%** |

### Função `resolve_tier` determinística

```rust
fn resolve_tier(id: &IdentityLayer, rep: &ReputationMetrics, hist: &BehavioralStats) -> u8 {
    // L4 Elite
    if id.total_pools_completed >= 8
        && wallet_age_years(id) >= 2
        && id.proof_of_personhood
        && rep.reliability >= 94
        && rep.punctuality >= 88
        && rep.commitment >= 90
        && hist.bad_faith_count == 0
    { return 4; }

    // L3 Veterano
    if id.total_pools_completed >= 3
        && wallet_age_months(id) >= 6
        && rep.reliability >= 85
        && rep.punctuality >= 75
        && rep.recovery.map_or(true, |r| r >= 80)
    { return 3; }

    // L2 Comprovado
    if id.total_pools_completed >= 1
        && rep.reliability >= 70
        && rep.punctuality >= 60
    { return 2; }

    // L1 Default
    1
}
```

### Regra de promoção/rebaixamento

- **Promoção:** automática quando TODOS os critérios são atendidos
- **Rebaixamento:** automático quando QUALQUER critério cai abaixo do mínimo
- **Mas:** dado o smoothing forte da Reliability (janela de 50 eventos), rebaixamento por evento isolado é matematicamente improvável

---

## 🎨 TAXONOMIA DE 6 CATEGORIAS DETERMINÍSTICA

Diferença crítica vs v5.1: aqui a categoria é decidida por **função pura**, sem admin discricionário.

```rust
pub enum EventClassification {
    PaymentOnTime,
    PaymentEarly,
    FrictionOperational,      // requer FrictionProof on-chain
    FrictionTemporal,         // delta_seconds <= GRACE_TEMPORAL
    LateBehavioral,           // GRACE_TEMPORAL < delta_seconds <= 7d
    TemporaryIncapacity,      // 7d < delta_seconds, mas pagou
    Default,                  // não pagou, sem recovery no pool
    BadFaith { evidence: BadFaithEvidence },  // governança on-chain
    CycleComplete,
    PoolComplete,
    Recovery,
}

// Função PURA de classificação (auditável)
pub const GRACE_TEMPORAL_SECS: i64 = 21_600;  // 6 horas
pub const LATE_BEHAVIORAL_MAX_SECS: i64 = 604_800;  // 7 dias

fn classify_payment(
    delta_seconds: i64,
    paid: bool,
    friction_proof: Option<&FrictionProof>,
) -> EventClassification {
    // Prova de fricção operacional verificada on-chain tem precedência
    if let Some(proof) = friction_proof {
        if proof.is_valid_on_chain() {
            return EventClassification::FrictionOperational;
        }
    }

    if !paid {
        return EventClassification::Default;
    }

    match delta_seconds {
        d if d < 0                      => EventClassification::PaymentEarly,
        d if d <= GRACE_TEMPORAL_SECS   => EventClassification::PaymentOnTime,
        d if d <= 86_400 * 2            => EventClassification::FrictionTemporal,  // até 2 dias
        d if d <= LATE_BEHAVIORAL_MAX_SECS => EventClassification::LateBehavioral,
        _                               => EventClassification::TemporaryIncapacity,
    }
}
```

> **Crucial:** `classify_payment` é **função pura**. Mesmo input → mesma classificação. Sem admin que decide.

### Casos especiais

- **BadFaith** é a única categoria que requer atestação humana, **via proposta de governança on-chain** com voting period e quorum. Não é decisão de admin individual.
- **Recovery** é detectada por padrão: usuário que sofreu `LateBehavioral`/`TemporaryIncapacity`/`Default` e depois fez ≥5 `PaymentOnTime` consecutivos ganha um evento `Recovery` automaticamente.

---

## 🔍 FRICTIONPROOF — PROVA ON-CHAIN

A grande diferença vs v5.1: a prova precisa ser **verificável on-chain** ou **ancorada em tx-hash auditável**.

```rust
pub enum FrictionProof {
    OnChainOracle {
        oracle: Pubkey,
        slot: u64,
        spike_severity: u8,  // 1-10
    },
    FailedTransaction {
        tx_signature: [u8; 64],
        error_code: u32,
        slot: u64,
    },
    ValidatorOutageWindow {
        start_slot: u64,
        end_slot: u64,
        validators_affected: u32,
    },
    GovernanceAttested {
        proposal_id: u64,        // proposta on-chain aprovada
        attestation_block: u64,
    },
}

impl FrictionProof {
    fn is_valid_on_chain(&self) -> bool {
        match self {
            OnChainOracle { oracle, slot, .. } => {
                // verifica que oracle == ORACLE_WHITELIST && spike registrado naquele slot
                verify_oracle_record(*oracle, *slot)
            }
            FailedTransaction { tx_signature, error_code, slot } => {
                // verifica que a tx existe, falhou com aquele código, naquele slot
                verify_tx_failure(tx_signature, *error_code, *slot)
            }
            ValidatorOutageWindow { start_slot, end_slot, .. } => {
                // verifica janela registrada em programa de monitoring
                verify_outage_window(*start_slot, *end_slot)
            }
            GovernanceAttested { proposal_id, .. } => {
                // verifica que proposta foi aprovada com quorum
                verify_governance_approval(*proposal_id)
            }
        }
    }
}
```

> **Nenhum admin individual pode "perdoar" um evento.** A reclassificação como `FrictionOperational` exige prova verificável que qualquer terceiro pode validar.

### Janela de submissão da prova

```rust
pub const FRICTION_PROOF_WINDOW_HOURS: u32 = 168;  // 7 dias
```

- Usuário tem 7 dias para anexar `FrictionProof` ao evento
- Após esse prazo, classificação inicial fica selada
- A janela é **regra pública**, não decisão de admin

---

## 🔬 AUDITABILIDADE EM PRÁTICA

### O que qualquer terceiro pode fazer com a v5.2

```
1. Ler o estado on-chain de uma wallet (C1 + C2)
2. Pegar o código aberto do programa
3. Rodar localmente as funções puras: reliability, punctuality, commitment, recovery, resolve_tier
4. Chegar exatamente no mesmo score e nível que o protocolo mostra
5. Refazer a conta para qualquer ponto no histórico
```

### O que isso significa

- 🟢 **Auditoria externa trivial** (qualquer desenvolvedor faz)
- 🟢 **Disputas resolvíveis** (mostre a conta, não o resultado)
- 🟢 **Portabilidade do CPF Web3** (instituições parceiras refazem a conta sem precisar confiar)
- 🟢 **Governança transparente** (qualquer mudança de constante é PR público com impacto mensurável)
- 🟢 **Zero "magia"** — não há "ajuste interno", "calibração silenciosa", "atestação de admin"

### O que isso impede

- 🔴 Time não pode mudar peso de Reliability sem governança
- 🔴 Admin não pode "perdoar" um evento sem FrictionProof on-chain
- 🔴 Não há "score sombra" diferente do score público
- 🔴 Não há rollout faseado escondido — toda mudança é versionada

---

## 📊 COMPARATIVO v5.0 vs v5.1 vs v5.2

| Aspecto | v5.0 | v5.1 | **v5.2** |
|---|---|---|---|
| **Camadas** | 4 | 4 | **4** |
| **Níveis** | 5 (L1–L5) | 5 (L1–L5) | **4 (L1–L4)** |
| **Score público** | Dia 1 | Adiado (Fase 2) | **Dia 1** |
| **Fórmulas** | Heurísticas no doc | "A calibrar" | **Explícitas no código, gentis** |
| **Categorias de evento** | 3 | 6 (com janela admin) | **6 (determinística)** |
| **FrictionProof** | Inexistente | Mencionada, com admin | **On-chain obrigatório** |
| **Penalidade atraso 1d** | -50 | "invisível interna" | **Reliability cai ~0.6 ponto** (público, explícito, gentil) |
| **Smoothing** | Inexistente | Interno opaco | **Janela móvel de 50 eventos publicada** |
| **Reclassificação** | Inexistente | Janela admin | **Apenas anexar FrictionProof on-chain em 7 dias** |
| **BadFaith** | Penalidade pesada | Atestada por admin | **Governança on-chain com quorum** |
| **Auditável por terceiros** | 🟢 Sim | 🔴 Não | 🟢 **Sim, totalmente** |
| **Custo de implementar** | Alto | Médio (faseado) | **Alto, mas tudo no MVP** |
| **Discricionariedade do time** | Mínima | Alta | **Zero** |

---

## 📐 SCHEMAS RUST

```rust
// ───── Camada 1 ─────
pub struct IdentityLayer {
    pub wallet_pubkey: Pubkey,
    pub wallet_first_seen_at: i64,
    pub roundfi_first_join_at: i64,
    pub proof_of_personhood: bool,
    pub pop_verified_at: i64,
    pub pop_expires_at: i64,
    pub kyc_tier: u8,
    pub total_pools_joined: u32,
    pub total_pools_completed: u32,
}

// ───── Camada 2 ─────
pub struct BehavioralEvent {
    pub wallet: Pubkey,
    pub pool: Pubkey,
    pub cycle_index: u32,
    pub timestamp: i64,
    pub due_timestamp: i64,
    pub paid_timestamp: Option<i64>,
    pub amount: u64,
    pub delta_seconds: i64,
    pub parcels_paid: u8,
    pub classification: EventClassification,
    pub friction_proof: Option<FrictionProof>,
    pub classification_sealed_at: i64,  // = timestamp + 7d
}

pub enum EventClassification {
    PaymentOnTime,
    PaymentEarly,
    FrictionOperational,
    FrictionTemporal,
    LateBehavioral,
    TemporaryIncapacity,
    Default,
    BadFaith { proposal_id: u64 },
    CycleComplete,
    PoolComplete,
    Recovery,
}

pub enum FrictionProof {
    OnChainOracle { oracle: Pubkey, slot: u64, spike_severity: u8 },
    FailedTransaction { tx_signature: [u8; 64], error_code: u32, slot: u64 },
    ValidatorOutageWindow { start_slot: u64, end_slot: u64, validators_affected: u32 },
    GovernanceAttested { proposal_id: u64, attestation_block: u64 },
}

// ───── Camada 3 ─────
pub struct ReputationMetrics {
    pub reliability: u16,
    pub punctuality: u16,
    pub commitment: u16,
    pub recovery: Option<u16>,
    pub last_calculated_at: i64,
    pub source_event_count: u32,
}

// ───── Camada 4 ─────
pub struct TierAssignment {
    pub tier: u8,  // 1–4
    pub assigned_at: i64,
    pub assigned_from_score_snapshot: Pubkey,  // PDA da ReputationMetrics
}
```

---

## 🛠️ MUDANÇAS NO CÓDIGO

### Arquivos novos
- `programs/roundfi-reputation/src/state/behavioral_log.rs`
- `programs/roundfi-reputation/src/state/reputation_metrics.rs`
- `programs/roundfi-reputation/src/state/friction_proof.rs`
- `programs/roundfi-reputation/src/instructions/record_event.rs`
- `programs/roundfi-reputation/src/instructions/attach_friction_proof.rs`
- `programs/roundfi-reputation/src/instructions/recalculate_metrics.rs`
- `programs/roundfi-reputation/src/instructions/resolve_tier.rs`
- `programs/roundfi-reputation/src/math/reliability.rs` — função pura
- `programs/roundfi-reputation/src/math/punctuality.rs` — função pura
- `programs/roundfi-reputation/src/math/commitment.rs` — função pura
- `programs/roundfi-reputation/src/math/recovery.rs` — função pura

### Arquivos refatorados
- `programs/roundfi-reputation/src/constants.rs` — todos os pesos públicos, **4 níveis**
- `programs/roundfi-reputation/src/state/profile.rs` — campos antigos depreciados, novos adicionados
- `programs/roundfi-reputation/src/instructions/attest.rs` — vira wrapper sobre `record_event`
- `programs/roundfi-reputation/src/instructions/promote_level.rs` — usa `resolve_tier`
- `programs/roundfi-core/src/constants.rs` — `STAKE_BPS_LEVEL_1..4` (apenas)

### Constantes públicas (extrato — todas em `constants.rs`)
```rust
// ───── Stakes por nível ─────
pub const STAKE_BPS_LEVEL_1: u16 = 5_000;  // 50%
pub const STAKE_BPS_LEVEL_2: u16 = 2_500;  // 25%
pub const STAKE_BPS_LEVEL_3: u16 = 1_000;  // 10%
pub const STAKE_BPS_LEVEL_4: u16 =   300;  //  3%

// ───── Reliability ─────
pub const RELIABILITY_WINDOW: u32 = 50;
pub const W_PAYMENT_ON_TIME: i32 = 100;
pub const W_PAYMENT_EARLY: i32 = 100;
pub const W_FRICTION_OPERATIONAL: i32 = 100;
pub const W_FRICTION_TEMPORAL: i32 = 95;
pub const W_LATE_BEHAVIORAL: i32 = 70;
pub const W_TEMPORARY_INCAPACITY: i32 = 40;
pub const W_DEFAULT: i32 = 0;
pub const W_BAD_FAITH: i32 = -200;

// ───── Punctuality ─────
pub const PUNCTUALITY_WINDOW: u32 = 50;
pub const PUNCTUALITY_FRICTION_GRACE_HOURS: u32 = 1;

// ───── Classificação ─────
pub const GRACE_TEMPORAL_SECS: i64 = 21_600;        // 6h
pub const FRICTION_TEMPORAL_MAX_SECS: i64 = 172_800; // 2d
pub const LATE_BEHAVIORAL_MAX_SECS: i64 = 604_800;   // 7d

// ───── FrictionProof ─────
pub const FRICTION_PROOF_WINDOW_HOURS: u32 = 168;  // 7d

// ───── Tier thresholds (4 níveis) ─────
pub const L2_RELIABILITY_MIN: u16 = 70;
pub const L2_PUNCTUALITY_MIN: u16 = 60;
pub const L2_POOLS_MIN: u32 = 1;

pub const L3_RELIABILITY_MIN: u16 = 85;
pub const L3_PUNCTUALITY_MIN: u16 = 75;
pub const L3_RECOVERY_MIN: u16 = 80;
pub const L3_POOLS_MIN: u32 = 3;
pub const L3_WALLET_AGE_MONTHS_MIN: u32 = 6;

pub const L4_RELIABILITY_MIN: u16 = 94;
pub const L4_PUNCTUALITY_MIN: u16 = 88;
pub const L4_COMMITMENT_MIN: u16 = 90;
pub const L4_POOLS_MIN: u32 = 8;
pub const L4_WALLET_AGE_MONTHS_MIN: u32 = 24;
```

---

## 🎯 RESUMO EXECUTIVO

> A **v5.2** mantém o esqueleto de 4 camadas da v5.0 e incorpora as boas ideias da v5.1 (taxonomia de 6 categorias, FrictionProof), mas **descarta toda a discricionariedade da v5.1**: nada de adiamento de fórmulas, nada de score interno, nada de smoothing opaco, nada de janela de admin. Tudo é **função pura e auditável**: as 4 métricas (Reliability, Punctuality, Commitment, Recovery) têm fórmulas explícitas no código com pesos publicados como constantes; a classificação dos eventos é determinística por `delta_seconds` + prova on-chain; FrictionProof exige verificação por oráculo/tx-hash/governança — nunca admin individual. A taxa de **4 níveis** (em vez de 5) custa ~30 linhas de código e simplifica a comunicação. O resultado é um protocolo onde **qualquer terceiro, com o código aberto, refaz a conta e chega no mesmo número** — o que é exatamente o ativo central do RoundFi: **histórico verificável**.

---

## 📝 Histórico das iterações

- **v1** — Análise do sistema atual
- **v2** — Penalidades graduadas, bônus antecipação, streak, redenção, L4
- **v3** — Aceleração de progressão
- **v4** — Sistema matemático com pesos dinâmicos
- **v5.0** — Arquitetura em 4 camadas, 5 níveis
- **v5.1** — Faseamento, taxonomia de 6 categorias, score adiado (descartada — não auditável)
- **v5.2** ← **este doc** — v5.0 + boas ideias da v5.1 **sem discricionariedade**, 4 níveis

---

**Status:** Proposta para comparação direta com v5.0.
**Direção recomendada:** seguir v5.2 como base para implementação.
**Não há código modificado.** Documento puro para discussão.
