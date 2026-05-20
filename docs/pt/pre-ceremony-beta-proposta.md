# Pre-Ceremony Beta — Proposta de Design

**Status:** rascunho para discussão de time
**Autor:** founders (via Claude)
**Versão:** 0.1
**Data alvo de decisão:** TBD

---

## 1. Objetivo

Lançar um **grupo beta fechado de early testers** com aporte reduzido e cadência semanal, para:

1. Validar o hábito de pagamento recorrente (variável-chave de adoção).
2. Estressar o protocolo em um ambiente real com risco financeiro **baixo**, mas não zero.
3. Construir um núcleo inicial de membros com reputação on-chain consolidada antes do lançamento aberto.
4. Testar mecânica de referral on-chain antes de abrir flow geral.

Este beta **não é uma promoção de marketing** — é um experimento controlado com regras econômicas próprias, distintas do protocolo geral.

---

## 2. Parâmetros econômicos do beta

| Parâmetro | Valor proposto | Comentário |
|---|---|---|
| Aporte por ciclo | **50 EUR** (faixa: 40-70 EUR) | 1/12 do `DEFAULT_INSTALLMENT_AMOUNT` atual (600 USDC) |
| Duração do ciclo | **7 dias** (semanal) | Acima do piso `MIN_CYCLE_DURATION = 86 400s` (1 dia) |
| Membros por pool | **10** (faixa: 8-12) | Igual ao número de ciclos (1 slot/membro) |
| Duração total do pool | **10 semanas** (~2,5 meses) | Cada membro recebe payout 1x durante o pool |
| Payout por slot | **500 EUR** | 10 membros × 50 EUR |
| Yield (Kamino) | **Desabilitado** | Ver §3.2 |
| Grace period | **48 horas** | Reduzido dos 7 dias atuais — ciclo é curto |
| Stake (nível 1) | **50%** (default atual) | Mantido — `stake_bps_for_level()` em `core/constants.rs:114-117` |

**Exposição total por membro:** 500 EUR ao longo de 10 semanas. Cabe em testers reais sem KYC pesado e sem necessidade de capital significativo travado.

---

## 3. Mudanças técnicas necessárias

### 3.1 Parametrização do aporte por pool

**Hoje:** `DEFAULT_INSTALLMENT_AMOUNT = 600_000_000` (`programs/roundfi-core/src/constants.rs:99`) é global e aplicado uniformemente.

**Mudança:** `create_pool` já aceita parâmetros — verificar se `installment_amount` é parametrizável ou se está hardcoded. Se hardcoded:

- Adicionar campo `installment_amount: u64` em `Pool` state (`programs/roundfi-core/src/state/pool.rs`).
- Validar `MIN_INSTALLMENT_AMOUNT` (sugestão: 10 EUR) e `MAX_INSTALLMENT_AMOUNT` no `create_pool`.
- Espelhar no SDK (`sdk/src/constants.ts`).

### 3.2 Flag de bypass do Kamino

**Hoje:** integração Kamino (yield strategy) é o caminho default. Para o beta:

- Adicionar `yield_strategy: Option<Pubkey>` no `Pool` state (ou flag `enable_yield: bool` se já existe estrutura semelhante).
- Em `claim_payout` e `contribute`: bypass das CPIs para Kamino quando `None`.
- **Consequência:** Seed Draw (`SEED_DRAW_BPS = 9_160` em `core/constants.rs:110`) deixa de ser necessário em pools sem yield — pool funciona como ROSCA pura.

**Justificativa:** 500 EUR × 7% APY × 2,5 meses ≈ 7 EUR de yield por membro. Ínfimo. Trade-off entre 7 EUR e remover dependência DeFi + reduzir superfície de auditoria do beta = trivial.

### 3.3 Cadência semanal — config-only

- `DEFAULT_CYCLE_DURATION: 2_592_000 → 604_800` (`programs/roundfi-core/src/constants.rs:102`).
- Espelhar em `sdk/src/constants.ts:46` (`cycleDurationSec`).
- Ajustar `DEFAULT_CYCLES_TOTAL: 24 → 10` para o beta (ou tornar parametrizável per-pool, se ainda não for).
- Revalidar teste de viabilidade do Seed Draw em `core/constants.rs:310-316` — para pools de beta sem Kamino, não importa; para pools de produção semanais, é obrigatório recalibrar.

### 3.4 Grace period reduzido

- `CRANK_DEFAULTS.defaultGraceSec: 604_800 → 172_800` (48h) em `sdk/src/constants.ts:100-104`.
- Sem isso, atraso = 1 ciclo inteiro perdido (grace = duração do ciclo).

---

## 4. Sistema de referral on-chain

### 4.1 Storage

Adicionar à conta `Member`:

```rust
pub inviter: Option<Pubkey>,           // 1 + 32 bytes — quem convidou este membro
pub invitees_active: u8,               // 1 byte — quantos convidados ativos (cap em 3)
pub invitees_completed: u16,           // 2 bytes — convidados que completaram pelo menos um ciclo
```

O campo `inviter` é **gravado uma vez** no `join_pool` (se houver um referral code/pubkey passado) e é **imutável** dali em diante.

### 4.2 Constantes de XP

Adicionar em `programs/roundfi-reputation/src/constants.rs`:

```rust
// Convidado entra com bônus inicial
pub const SCORE_REFERRAL_JOIN_BONUS: i32 = 50;

// Convidador ganha XP vestado por ciclo do convidado
pub const SCORE_REFERRAL_CYCLE_COMPLETE: i32 = 20;

// Penalidade mútua (convidador e convidado) se um deles dá default
pub const SCORE_REFERRAL_DEFAULT_PAIR: i32 = -100;

// Cap de convidados ativos por wallet (anti-sybil)
pub const MAX_ACTIVE_INVITEES: u8 = 3;
```

### 4.3 Regras de aplicação

1. **No `join_pool` com referral:**
   - Convidado: +50 XP imediato.
   - Convidador: nada imediato. `invitees_active += 1`. Erro se `invitees_active >= MAX_ACTIVE_INVITEES`.

2. **A cada ciclo completo pago pelo convidado:**
   - Convidador: +20 XP. Após 5 ciclos completos, convidador acumulou +100 XP do referral. **Vesting natural** — não dá pra farmar.

3. **Default do convidado:**
   - Penalidade existente: `SCORE_DEFAULT = -500` no convidado (preservada).
   - **Adicional:** `-100` XP no convidador. Trigger: no instruction que marca o default, ler `member.inviter` e aplicar penalidade.
   - `invitees_active -= 1` no convidador.

4. **Default do convidador:**
   - Convidados ativos do convidador **não** são penalizados. Simétrico não é justo — quem assumiu responsabilidade foi o convidador.

5. **Conclusão bem-sucedida:**
   - Convidador: `invitees_completed += 1`. Sem XP extra além do que já vestou.

### 4.4 Guard-rails anti-gaming

| Risco | Mitigação |
|---|---|
| Sybil (1 pessoa convida 50 contas próprias) | Cap `MAX_ACTIVE_INVITEES = 3` |
| Farm de XP via referral instantâneo | Bônus do convidador vesta por ciclo (5 semanas no beta) |
| Convidar e abandonar | Sem ciclos pagos = sem XP pro convidador |
| Wallet abre 2 contas e se auto-convida | `inviter != member` check no instruction |
| Mudança de inviter retroativa | `inviter` imutável após gravação |

### 4.5 Pergunta aberta: penalidade mútua é severa demais?

Penalidade de `-100` no convidador parece justa, mas no beta de **10 membros** isso pode concentrar risco em "líderes de grupo" que convidam várias pessoas. Opções:

- **A:** Manter `-100` (proposta atual).
- **B:** Penalidade escalonada: `-50` no primeiro default de um convidado, `-100` no segundo, `-200` no terceiro. Premia convidadores que aprendem.
- **C:** Sem penalidade no convidador no beta — só vale a partir do v2.

Recomendação: **B**, mas é decisão de produto.

---

## 5. Progressão de níveis no beta

Thresholds em `roundfi-reputation/src/constants.rs:52-64`:

- **Nível 1 → 2:** 500 XP
- **Nível 2 → 3:** 2 000 XP

XP por ritmo regular = 60/ciclo (`SCORE_PAYMENT = 10` + `SCORE_CYCLE_COMPLETE = 50`).

| Cenário | Tempo até Nv2 | Tempo até Nv3 |
|---|---|---|
| Beta solo (sem referral) | ~9 ciclos (~9 semanas) | ~33 ciclos (~33 semanas, > 1 pool) |
| Beta + 1 referral ativo | ~7 semanas | ~30 semanas |
| Beta + 3 referrals ativos | ~5 semanas | ~25 semanas |

**Observação:** Pool beta dura 10 semanas. Membros que cumpriram o pool inteiro com 1+ referral ativo terminam o beta em **Nível 2** — sinal claro de adoção bem-sucedida.

---

## 6. Riscos e mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| Default de 1+ membros mata o pool de 10 | Alta | Stake de 50% cobre 1 default. Para 2+ defaults: pool encerra antecipadamente, capital remanescente devolvido pro-rata. |
| Sem Kamino = ROSCA pura sem yield para compensar atraso | Média | Grace 48h. Aporte 50 EUR é baixo o bastante pra não ser blocker. |
| Referral vira spam fora do app (links externos) | Média | Cap de 3 referrals ativos + on-chain only (sem off-chain link tracking). |
| Beta cria precedente legal/regulatório | Média | Conversa com legal antes de aceitar EUR. Considerar denominar em USDC mesmo no beta para evitar regras MiCA estritas em EUR. |
| Pool de 10 testers concentra risco social | Baixa | Seleção criteriosa dos primeiros 10. Não escalar até validar. |

---

## 7. Checklist de implementação

### Fase 1 — Parametrização (sem novas features)

- [ ] Tornar `installment_amount` parametrizável per-pool.
- [ ] Validar bounds (`MIN/MAX_INSTALLMENT_AMOUNT`).
- [ ] Tornar `cycles_total` parametrizável per-pool (se ainda não for).
- [ ] Testes: criar pool com 50 EUR × 10 ciclos × 10 membros em devnet.

### Fase 2 — Bypass do Kamino

- [ ] Campo `yield_strategy: Option<Pubkey>` (ou flag equivalente) no `Pool`.
- [ ] Branch no `contribute` / `claim_payout` para skip Kamino quando `None`.
- [ ] Bypass do Seed Draw quando `yield_strategy == None`.
- [ ] Testes de integração: pool sem yield completa 10 ciclos.

### Fase 3 — Cadência semanal (para uso geral, não só beta)

- [ ] Decisão de produto: manter `DEFAULT_CYCLE_DURATION` mensal e usar parâmetro per-pool, ou trocar default global para semanal?
- [ ] Atualizar SDK para espelhar.
- [ ] Recalibrar Seed Draw para pools semanais **com** Kamino (se aplicável).

### Fase 4 — Sistema de referral

- [ ] Adicionar campos `inviter`, `invitees_active`, `invitees_completed` no `Member`.
- [ ] Novas constantes em `roundfi-reputation/constants.rs`.
- [ ] Modificar `join_pool` para aceitar `inviter: Option<Pubkey>`.
- [ ] Hooks de XP no `claim_payout` (vesting do convidador) e no instruction de default.
- [ ] Validações: cap, auto-referral, imutabilidade.
- [ ] Testes: cenário feliz, default do convidado, cap excedido, auto-referral rejeitado.

### Fase 5 — Operacional

- [ ] Lista de 10 testers selecionados (founders, círculo próximo, comunidade técnica).
- [ ] Termo de participação (não vinculante, mas deixa claro: experimento, risco real).
- [ ] Canal dedicado (Telegram/Discord) para os 10.
- [ ] Métricas pós-beta: taxa de pagamento on-time, defaults, XP médio acumulado, NPS qualitativo.

---

## 8. Perguntas abertas para o time

1. **Denominação:** EUR ou USDC? EUR cria fricção regulatória (MiCA), USDC perde a familiaridade do "isto é dinheiro de verdade".
2. **Slot order:** Manter determinístico (`slot_index` na ordem do join) ou revelar publicamente no ceremony para gerar antecipação?
3. **Penalidade do referral:** opção A, B ou C (§4.5)?
4. **Beta múltiplos pools:** rodar 1 pool de 10 ou 2 pools de 8 simultâneos? Mais dados, mais complexidade operacional.
5. **Bônus de "founding member":** dar +100 XP one-shot pros 10 do beta como reconhecimento permanente da reputação on-chain? Cria narrativa, mas distorce o ranking.
6. **Critério de seleção:** open application, indicação por founder, ou misto?

---

## 9. Próximos passos sugeridos

1. **Hoje:** circular este doc com o time. Decidir §8.
2. **Sprint 1:** Fases 1+2 (parametrização + Kamino bypass). É a base mínima para o beta rodar.
3. **Sprint 2:** Fase 4 (referral). Pode ser paralelizada se houver capacidade.
4. **Sprint 3:** Selecionar 10 testers, executar dry-run em devnet, lançar mainnet beta.

**Tempo total estimado até pre-ceremony rodando:** 3-4 semanas de engenharia + 1 semana de seleção/onboarding = **~4-5 semanas** do go-decision ao primeiro ciclo pago.
