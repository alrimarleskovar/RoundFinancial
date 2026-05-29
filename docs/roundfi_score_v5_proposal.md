# 🏛️ RoundFi — Proposta v5.0 do Sistema de Reputação

> **Histórico Verificável + Score Recuperável + Nível como Consequência**

**Status:** Proposta conceitual para avaliação de time
**Autor:** Sessão de design com Alrimar
**Data:** 2026-05-29
**Escopo:** Redesenho do sistema de pontuação/reputação do protocolo RoundFi

---

## 📑 Índice

1. [Mudança de Paradigma](#-mudança-de-paradigma)
2. [Arquitetura de 4 Camadas](#-a-arquitetura-de-4-camadas)
3. [Camada 1 — Identidade](#-camada-1--identidade)
4. [Camada 2 — Histórico Comportamental](#-camada-2--histórico-comportamental-o-ativo-central)
5. [Camada 3 — Reputação](#-camada-3--reputação-métricas-calculadas-mutáveis)
6. [Camada 4 — Nível](#-camada-4--nível-consequência-não-meta)
7. [Filosofia de Penalidade](#️-a-nova-filosofia-de-penalidade)
8. [Proteções contra Abuso](#️-como-o-sistema-evita-ser-fraco-demais)
9. [Eventos a Registrar](#-eventos-a-registrar--a-lista-definitiva)
10. [Evidências Verificáveis](#-evidências--como-tornar-cada-evento-verificável)
11. [Correlação com Confiabilidade Futura](#-correlação-com-confiabilidade-futura)
12. [Exemplo de Perfil Público](#-exemplo-completo--perfil-público-de-um-usuário-v5)
13. [Mudanças no Código](#-mudanças-no-código-alto-nível)
14. [Resumo Executivo](#-resumo-em-1-parágrafo)
15. [Próximos Passos](#-próximos-passos-que-eu-sugeriria-se-quiser-continuar)
16. [Anexo — Análise do Sistema Atual](#-anexo--análise-do-sistema-atual-baseline)

---

## 🎯 MUDANÇA DE PARADIGMA

| Modelo antigo (v1–v4) | Modelo v5 |
|---|---|
| Score é o produto | **Histórico é o produto** |
| Pontos definem confiança | **Evidência define confiança** |
| Atraso = punição imediata | **Atraso = evento registrado** |
| Score quebra → usuário abandona | **Score recupera, histórico persiste** |
| Nível é meta | **Nível é consequência** |
| 1 fórmula | **4 camadas independentes** |

> 💡 **Princípio fundamental:** *Quem paga 10 meses certinho e atrasa 1 dia continua sendo um bom pagador — e os dados precisam dizer isso.*

### Problemas concretos que motivam a mudança

- **Atraso de 1 dia após 10 meses limpos** custando -50 pontos cria sensação de "perdi meses de progresso" → usuário abandona o protocolo
- Tratar "atrasou 1 dia" como "quebrou compromisso sério" não corresponde à realidade humana (boleto vence sexta, salário cai segunda, pessoa paga segunda — atrasou, mas não virou risco)
- Discutir se 6 horas vale -12 ou -14 é tempo mal gasto; o ativo real do RoundFi é **histórico verificável**, não calibração de pesos
- Score atual não separa **identidade**, **comportamento bruto**, **métricas derivadas** e **nível** — tudo vive em um único `i64` que pune e recupera no mesmo lugar

---

## 🏗️ A ARQUITETURA DE 4 CAMADAS

```
┌─────────────────────────────────────────────────────────┐
│  CAMADA 4 — NÍVEL (derivado, consequência)              │
│  L1 · L2 · L3 · L4 · L5                                 │
└─────────────────────────────────────────────────────────┘
                          ↑ deriva de
┌─────────────────────────────────────────────────────────┐
│  CAMADA 3 — REPUTAÇÃO (métricas calculadas, mutáveis)    │
│  Reliability · Punctuality · Commitment · Recovery       │
└─────────────────────────────────────────────────────────┘
                          ↑ calculadas de
┌─────────────────────────────────────────────────────────┐
│  CAMADA 2 — HISTÓRICO COMPORTAMENTAL (imutável on-chain) │
│  Pagamentos · Atrasos · Defaults · Recuperações          │
└─────────────────────────────────────────────────────────┘
                          ↑ ancorada em
┌─────────────────────────────────────────────────────────┐
│  CAMADA 1 — IDENTIDADE (fatos estáveis)                  │
│  Wallet Age · Proof of Personhood · Pools · KYC          │
└─────────────────────────────────────────────────────────┘
```

**Regras de fluxo:**
- Cada camada **só lê** das camadas abaixo dela
- Camadas inferiores **nunca dependem** das superiores
- Camada 2 é **append-only** (imutável)
- Camadas 3 e 4 são **recalculáveis** a qualquer momento a partir de 1 e 2

---

## 📐 CAMADA 1 — IDENTIDADE

**Fatos imutáveis ou que mudam muito devagar.** São o "RG" do usuário.

### Schema:
```rust
pub struct IdentityLayer {
    pub wallet_pubkey: Pubkey,
    pub wallet_first_seen_at: i64,       // primeira tx on-chain
    pub roundfi_first_join_at: i64,      // primeiro join_pool
    pub proof_of_personhood: bool,       // Human Passport ativo
    pub pop_verified_at: i64,            // quando foi verificado
    pub pop_expires_at: i64,             // quando expira
    pub kyc_tier: u8,                    // 0=none, 1=basic, 2=enhanced
    pub total_pools_joined: u32,         // contador permanente
    pub total_pools_completed: u32,      // contador permanente
}
```

### Exemplo de leitura pública:
```
Wallet Age:            4.2 years
RoundFi Member Since:  2.1 years
Proof of Personhood:   ✓ Verified (expires in 8 months)
Pools Joined:          12
Pools Completed:       7
KYC Tier:              Basic
```

> 🔒 **Não muda** com pagamentos. Não pode ser "perdida" por atraso. É a fundação.

---

## 📊 CAMADA 2 — HISTÓRICO COMPORTAMENTAL (o ativo central)

**Eventos imutáveis, registrados on-chain, com evidência verificável.**

Esta é a **camada mais importante** — o "extrato" verificável que nenhum outro protocolo possui.

### Eventos registrados:

```rust
pub enum BehavioralEvent {
    PaymentMade {
        pool: Pubkey,
        cycle_index: u32,
        amount: u64,
        due_timestamp: i64,
        paid_timestamp: i64,
        delta_seconds: i64,         // negativo = adiantado, positivo = atrasado
        on_time_strict: bool,       // delta ≤ 0
        parcels_paid: u8,           // lump-sum: quantas parcelas de uma vez
    },
    PaymentMissed {
        pool: Pubkey,
        cycle_index: u32,
        missed_timestamp: i64,
        reason: MissReason,         // PaymentMissed, InfraFailure, Voluntary
    },
    DefaultDeclared {
        pool: Pubkey,
        cycle_index: u32,
        amount_at_risk: u64,
        recovery_outcome: Option<RecoveryOutcome>,
    },
    CycleCompleted {
        pool: Pubkey,
        cycle_index: u32,
        cycle_duration_days: u32,
    },
    PoolCompleted {
        pool: Pubkey,
        total_cycles: u32,
        on_time_count: u32,
        late_count: u32,
        defaults: u32,
    },
    Recovery {
        pool: Pubkey,
        recovery_type: RecoveryType, // RepaidLate, RestakedAfter, etc
        days_to_recover: u32,
    },
}

pub enum MissReason {
    PaymentMissed,        // voluntário/inadimplência
    InfraFailure,         // RPC down, gas spike, evidência verificável
    VoluntaryExit,        // saiu organizadamente do pool
}
```

### Leitura pública agregada:
```
═══ BEHAVIORAL HISTORY ═══
Total Contributions:        84
On-Time Rate:               96.4%   (81/84)
Early Payment Rate:         42%     (35/84)
Late Payment Rate:          3.6%    (3/84)
  └─ <24h:                  2
  └─ 1–7d:                  1
  └─ >7d:                   0
Defaults:                   0
Recovery Success:           100%    (2/2 recuperações)
Consecutive Contributions:  61      (streak atual)
Longest Streak Ever:        38      (já fez 38 seguidos)
Average Delta (seconds):    -8,400  (paga ~2.3h adiantado em média)
```

> 🔒 **Esta camada NUNCA é alterada por punição.** Cada evento é uma evidência permanente. Mesmo que o score caia, a história continua lá — verificável por qualquer parte.

---

## 🧮 CAMADA 3 — REPUTAÇÃO (métricas calculadas, mutáveis)

**Aqui mora o "score" — mas dividido em dimensões interpretáveis.**

Em vez de um número opaco, **4 ratings de 0 a 100**, cada um derivado de fórmulas explícitas sobre a Camada 2.

### As 4 dimensões:

#### 🎯 **Reliability** (Confiabilidade)
*"Quão consistente esse usuário tem sido?"*
```
Reliability = (on_time_payments + 0.5 × minor_late_payments) / total_payments × 100
```
- Atrasos pequenos contam metade
- Default zera para 0 temporariamente
- **Decai com inatividade** lentamente, mas **recupera com 5–10 OTs**

#### ⏱️ **Punctuality** (Pontualidade)
*"Quão próximo do prazo (ou antes) ele paga em média?"*
```
Punctuality = 100 - normalize(avg(delta_seconds_positive))
```
- Quem paga adiantado: 95–100
- Quem paga no dia: 75–90
- Quem paga com horas de atraso: 50–70
- Quem paga com dias de atraso: 20–50

#### 🤝 **Commitment** (Comprometimento)
*"Ele termina o que começa?"*
```
Commitment = (pools_completed / pools_joined) × cycle_completion_rate × 100
```
- Pool abandonado pesa
- Saída voluntária (`VoluntaryExit`) pesa menos
- Pools completos longos pesam mais

#### 🔄 **Recovery** (Recuperação)
*"Quando ele tropeça, ele se levanta?"*
```
Recovery = successful_recoveries / total_stumbles × 100
```
- Atrasou e pagou em até 7 dias = recovery success
- Sofreu default e voltou a entrar em novo pool = recovery
- Nunca tropeçou = N/A (não penaliza, exibe "—")

### Leitura pública:
```
═══ REPUTATION SCORES ═══
Reliability:    94/100   ████████████░  ↑+2 (este mês)
Punctuality:    88/100   ███████████░░  →
Commitment:     91/100   ████████████░  ↑+1
Recovery:      100/100   ██████████████ →
```

> 💡 **Estas métricas SOBEM E DESCEM**, mas como são **estatísticas sobre o histórico**, mesmo uma queda pequena depois de muitos eventos bons mal aparece — exatamente o comportamento desejado.

> **Exemplo:** 10 meses de OT + 1 atraso de 1 dia →
> Reliability cai de **100 → 99.0** (não de "L2 perfeito" para "L1 zerado")

---

## 🏆 CAMADA 4 — NÍVEL (consequência, não meta)

**O nível agora é apenas um label legível** que reflete o estado das outras camadas.

### 5 níveis (não mais 4):

| Nível | Nome | Critério (todos exigidos) | Stake |
|---|---|---|---|
| **L1** | Novo participante | Default | 50% |
| **L2** | Disciplina básica | ≥1 pool completo · Reliability ≥70 · Punctuality ≥60 | 30% |
| **L3** | Consistência comprovada | ≥3 pools completos · Reliability ≥85 · Punctuality ≥75 · Recovery ≥80 (se aplicável) | 15% |
| **L4** | Confiabilidade de longo prazo | ≥6 pools completos · Wallet age ≥1 ano · Reliability ≥92 · Commitment ≥85 | 7% |
| **L5** | Elite | ≥12 pools completos · Wallet age ≥2 anos · Reliability ≥96 · Punctuality ≥90 · 0 defaults · PoP ativo | 3% |

### Regra-chave:
> **Promoção é automática quando todos os critérios são atendidos. Rebaixamento ocorre apenas quando uma métrica cai abaixo do mínimo do nível atual — não por evento único.**

**Exemplo:** Usuário L3 com Reliability 86 sofre atraso pequeno. Reliability cai para **85.4** → continua L3. Só rebaixa se cair **abaixo de 85**, o que exigiria múltiplos atrasos significativos.

---

## ⚖️ A NOVA FILOSOFIA DE PENALIDADE

### ❌ NÃO faz mais sentido perguntar:
- "Quantos pontos perde com atraso de 6h?"
- "Quantos pontos ganha pagando 3 parcelas?"

### ✅ Agora se pergunta:
- "**Esse evento foi registrado?**" → sempre sim
- "**Esse evento move alguma das 4 métricas estatísticas?**" → naturalmente, na proporção do total
- "**Esse evento gera evidência verificável?**" → sim, com `delta_seconds`, `reason`, `cycle_duration` etc

### Exemplo concreto: pool 12 meses, 10 meses limpos + 1 atraso 1 dia

| Sistema | Resultado |
|---|---|
| **v3/v4 (rígido)** | Score: 800 → 750 (perde 50, vira drama) |
| **v5 (estatístico)** | Reliability: 100 → 90.9 (1 atraso menor em 11 pagamentos = 1 evento de "minor late" em 11 OTs) · Punctuality: 95 → 93 · Nível: **inalterado** · Histórico: agora mostra 1 "minor late" + tag "Recovered in 1 day" |

> ✅ **Continua L4. Continua confiável. Histórico é honesto. Usuário não abandona.**

---

## 🛡️ COMO O SISTEMA EVITA SER FRACO DEMAIS

A grande preocupação: "se tudo é estatística, não fica fácil demais?"

### Proteções estruturais:

1. **Volume mínimo de evidência**
   - L3 exige ≥3 pools completos: não dá para fingir consistência com 1 pool curto
   - L5 exige ≥12 pools E ≥2 anos: tempo é incomprável

2. **Defaults têm peso desproporcional permanente**
   - L5 exige **0 defaults históricos** — irrecuperável por estatística
   - L4 permite 1 default antigo (>2 anos) com recovery successful
   - Reflete realidade: bancos também tratam default diferente de atraso

3. **Wallet age é fator obrigatório nos níveis altos**
   - Não dá para criar wallet hoje e ser L5 amanhã, mesmo com comportamento perfeito
   - Tempo é o anti-sybil mais barato e mais forte

4. **Proof of Personhood vira gate em L4+**
   - Identidade verificada é obrigatória para níveis altos
   - Sybil farms ficam capadas em L3

5. **Métricas com cooldown**
   - Reliability não sobe acima de 90 sem ≥30 OT
   - Punctuality precisa de ≥20 amostras para "estabilizar"
   - Não dá para fazer 5 pagamentos e ter 100/100

---

## 📋 EVENTOS A REGISTRAR — A LISTA DEFINITIVA

**Pergunta crítica:** *"Quais eventos vamos registrar?"*

```rust
pub enum RoundFiBehavioralEvent {
    // === Pagamentos ===
    PaymentMade { delta_seconds, parcels, infra_proof },
    PaymentMissed { reason: MissReason },
    PaymentRecovered { days_to_recover },

    // === Ciclo / Pool ===
    PoolJoined { pool_duration_days, stake_amount },
    CycleCompleted { cycle_index, on_time_in_cycle },
    PoolCompleted { full_cycles, perfect_pool: bool },
    PoolExited { reason: ExitReason },

    // === Default ===
    DefaultDeclared { amount, day_in_cycle },
    DefaultResolved { resolution_type, days_elapsed },

    // === Identidade ===
    PoPVerified { provider, expiry },
    KYCUpgraded { from_tier, to_tier },

    // === Sociais (opcional Layer 5) ===
    PeerVouch { voucher_wallet, stake_amount },
    PeerVouchPaidOff { successful_completion: bool },
}
```

---

## 🔍 EVIDÊNCIAS — Como Tornar Cada Evento Verificável

**Pergunta crítica:** *"Quais evidências queremos produzir?"*

Cada evento precisa de:

1. **Timestamp on-chain** (`clock.unix_timestamp`)
2. **Pool ID + cycle index** (contexto único)
3. **Amount + token** (skin in the game)
4. **Delta vs due** (`paid - due`)
5. **Reason code** (para eventos de exceção)
6. **Optional: infra proof** (para `InfraFailure`, ex: oráculo de gas-price spike)

Isso vira o equivalente Web3 do **extrato bancário verificável** — assinado pelo protocolo, hospedado on-chain, exportável como ZK-proof.

---

## 🔬 CORRELAÇÃO COM CONFIABILIDADE FUTURA

**Pergunta crítica:** *"Como provar que essas evidências têm correlação com confiabilidade futura?"*

**Estratégia em 3 fases:**

### Fase 1 (Bootstrap — 0 a 6 meses)
- Pesos das métricas são **heurísticos** (baseados em scoring de crédito tradicional adaptado)
- Sistema **registra tudo**, mas nível L3+ é gated por humanos / governança

### Fase 2 (Calibração — 6 a 24 meses)
- Quando houver ≥1.000 pools completos, rodar **análise retroativa**:
  - "Usuários com Reliability ≥90 sofreram quantos defaults nos pools subsequentes?"
  - "Punctuality ≥85 prediz on-time-rate de 95%+?"
- **Ajustar pesos** das fórmulas com base em correlação real

### Fase 3 (Aprendizagem — 24+ meses)
- Publicar **dataset agregado** (anonimizado) como bem público
- Modelos externos (terceiros) podem auditar e propor melhorias
- RoundFi vira **fonte de verdade comportamental** do ecossistema DeFi LATAM

---

## 📈 EXEMPLO COMPLETO — Perfil Público de um Usuário v5

```
╔════════════════════════════════════════════════════╗
║  ROUNDFI BEHAVIORAL PROFILE                         ║
║  wallet: AbCd…XyZ                                   ║
╠════════════════════════════════════════════════════╣
║                                                     ║
║  ━━━ IDENTITY ━━━                                   ║
║  Wallet Age:              4.2 years                 ║
║  RoundFi Member:          2.8 years                 ║
║  Proof of Personhood:     ✓ Verified                ║
║  Pools Joined:            8                         ║
║  Pools Completed:         7                         ║
║                                                     ║
║  ━━━ BEHAVIOR ━━━                                   ║
║  Total Contributions:     84                        ║
║  On-Time Rate:            97%                       ║
║  Early Payment Rate:      42%                       ║
║  Late Payment Rate:       3%   (all <24h, 0 >7d)    ║
║  Defaults:                0                         ║
║  Recoveries:              2/2  (100%)               ║
║  Consecutive:             61   ← streak atual       ║
║  Longest Streak:          38                        ║
║                                                     ║
║  ━━━ REPUTATION ━━━                                 ║
║  Reliability:             94  ████████████░         ║
║  Punctuality:             88  ███████████░░         ║
║  Commitment:              91  ████████████░         ║
║  Recovery:               100  ██████████████        ║
║                                                     ║
║  ━━━ TIER ━━━                                       ║
║  Current Tier:            L4  ·  Stake 7%           ║
║  Eligibility for L5:      Falta 1 pool completo     ║
║                                                     ║
╚════════════════════════════════════════════════════╝
```

> **Esse é o "CPF Web3" que a RoundFi pode fundar.** Portável, verificável, valioso — e que **outros protocolos vão querer integrar**.

---

## 🆕 MUDANÇAS NO CÓDIGO (alto nível)

### Novas contas on-chain:
```rust
// PDA: ["behavioral_log", wallet]
pub struct BehavioralLog {
    pub wallet: Pubkey,
    pub event_count: u64,
    pub last_event_at: i64,
    // events armazenados via append-only ring buffer ou off-chain w/ merkle root
}

// PDA: ["reputation_metrics", wallet]
pub struct ReputationMetrics {
    pub reliability: u16,    // 0-10000 bps
    pub punctuality: u16,
    pub commitment: u16,
    pub recovery: u16,
    pub last_calculated_at: i64,
    pub calculation_window: u32,  // últimos N eventos considerados
}

// PDA: ["identity", wallet] — já existe parcialmente
pub struct IdentityProfile {
    // existing fields ...
    pub wallet_first_seen_at: i64,  // NOVO
    pub pop_history: Vec<PoPRecord>, // NOVO
}
```

### Novas instruções:
```rust
record_behavioral_event(event: BehavioralEvent)
recalculate_reputation_metrics(window: u32)
promote_tier()           // permissionless, lê metrics + identity
attest_infra_failure()   // admin com prova on-chain (gas oracle, etc)
```

### Arquivos afetados:
- `programs/roundfi-reputation/src/state/behavioral_log.rs` — **NOVO**
- `programs/roundfi-reputation/src/state/reputation_metrics.rs` — **NOVO**
- `programs/roundfi-reputation/src/state/profile.rs` — refatorar
- `programs/roundfi-reputation/src/instructions/record_event.rs` — **NOVO**
- `programs/roundfi-reputation/src/instructions/recalc_metrics.rs` — **NOVO**
- `programs/roundfi-reputation/src/instructions/attest.rs` — deprecar lógica de delta direto
- `programs/roundfi-core/src/constants.rs` — adicionar `STAKE_BPS_LEVEL_4/5`

---

## 🎯 RESUMO EM 1 PARÁGRAFO

> RoundFi v5 deixa de ser um **"score game"** e vira uma **plataforma de evidência comportamental**. A Camada 1 (identidade) prova quem você é. A Camada 2 (histórico) registra tudo de forma imutável — e nunca pune retroativamente. A Camada 3 (reputação) calcula 4 métricas estatísticas legíveis (Reliability, Punctuality, Commitment, Recovery) que sobem ou caem de forma proporcional ao total de eventos — um atraso de 1 dia depois de 10 meses limpos mal move o ponteiro. A Camada 4 (nível) é apenas uma consequência legível dessas métricas, com proteções estruturais (wallet age, PoP, pools mínimos) que impedem progressão fácil. O ativo central não é o número — é o **extrato comportamental verificável**, que nenhum protocolo DeFi possui hoje.

---

## 📌 PRÓXIMOS PASSOS QUE EU SUGERIRIA (se quiser continuar)

1. **Definir o schema completo de `BehavioralEvent`** (campos, enums, evidências)
2. **Modelar as 4 fórmulas de reputação** com parâmetros explícitos e janelas de cálculo
3. **Detalhar a estratégia de armazenamento** (compactação, ring buffer vs merkle root off-chain)
4. **Desenhar o "Public Profile API"** (como terceiros consomem esse extrato)
5. **Plano de migração** dos perfis atuais para o novo modelo

---

## 📎 ANEXO — Análise do Sistema Atual (baseline)

Resumo do que existe hoje no protocolo, para contextualizar a proposta:

### Localização

- Constantes: `programs/roundfi-reputation/src/constants.rs`
- Perfil: `programs/roundfi-reputation/src/state/profile.rs`
- Atestação: `programs/roundfi-reputation/src/instructions/attest.rs`
- Promoção: `programs/roundfi-reputation/src/instructions/promote_level.rs`
- Stake por nível: `programs/roundfi-core/src/constants.rs`

### Pontuação atual

| Evento | Δ Score | Observação |
|---|---|---|
| Pagamento no prazo | +10 (verif) / +5 (não-verif) | constants.rs:53 |
| Pagamento atrasado | −100 | constants.rs:55 — binário, sem gradação |
| Pagamento adiantado | **0** | não existe schema próprio |
| Ciclo completo | +50 / +25 | constants.rs:54 |
| Default | −500 + rebaixamento | constants.rs:56 |

### Tiers atuais

| Nível | Score | Ciclos mín. | Stake |
|---|---|---|---|
| L1 Iniciante | 0–499 | 0 | 50% |
| L2 Comprovado | 500–1.999 | ≥1 | 30% |
| L3 Veterano | ≥2.000 | ≥3 | 10% |

### Gaps identificados (que motivam v5)

- **Sem granularidade temporal**: 5min de atraso = 5 dias de atraso = −100
- **Sem recompensa por antecipação**: pagar 10 dias antes = pagar no último segundo
- **Score binário punitivo**: 1 atraso destrói meses de progresso
- **Mistura camadas**: identidade, comportamento, métricas e nível em um único `i64`
- **Não captura `delta_seconds`** apesar do campo existir no schema do indexer
- **Sem distinção entre causas** (falha de infra vs inadimplência)
- **Tempo de progressão**: L1→L2 leva ~50 ciclos, L2→L3 leva ~150 ciclos — irrealista

---

## 📝 Histórico da Discussão

Esta proposta v5 é o resultado de iterações sucessivas:

- **v1 (Análise)**: Documentação do sistema atual existente
- **v2 (Refinamento)**: Penalidades graduadas, bônus antecipação, streak, redenção, novo L4
- **v3 (Aceleração)**: Recalibração para L1→L2 em ~6 meses
- **v4 (Matemática)**: Sistema com pesos dinâmicos por duração de pool, escala 0–1000, lump-sum
- **v5 (Paradigma)** ← **esta proposta**: Arquitetura em 4 camadas, histórico como produto central, score recuperável, nível como consequência

A v5 incorpora o insight crítico de que **o ativo da RoundFi não é o score em si, mas o histórico comportamental verificável** — algo que nenhum protocolo DeFi possui hoje e que pode virar a fundação de um "CPF Web3" portável.

---

**Status:** Proposta para revisão de time.
**Não há código modificado.** Nenhum commit foi criado.
