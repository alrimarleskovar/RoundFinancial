# Pre-Ceremony Beta — Proposta de Design (v0.2)

**Status:** rascunho para discussão de time
**Versão:** 0.2 — incorpora revisão do time sobre v0.1
**Data alvo de decisão:** TBD
**Mudanças vs. v0.1:** ver §11

---

## 1. Decisão de produto a ser tomada

Antes de qualquer engenharia, o time precisa decidir explicitamente:

**Pergunta 1: Devnet beta agora, ou mainnet beta após smoke + Squads + audit?**

- **Opção A — Devnet primeiro, mainnet depois:** rodamos o pre-ceremony em devnet com USDC mintado, validamos hábito e mecânica sem capital real em risco, **depois** repetimos em mainnet pós-audit.
- **Opção B — Mainnet beta direto, pós-audit:** atrasa beta em ~3 meses, mas o "hábito" testado é com dinheiro real (que é o que importa).

**Recomendação:** Opção A — porque a tese principal do beta ("hábito de pagamento recorrente") não depende de capital real. Devnet com USDC mintado é suficiente para validar adesão semanal. Mainnet pós-audit vira a segunda fase.

---

## 2. Parâmetros econômicos do beta

| Parâmetro | Valor | Comentário |
|---|---|---|
| Denominação | **USDC** (não EUR) | Remove fricção MiCA; mantém narrativa "stablecoin nativa" |
| Aporte por ciclo | **50 USDC** | Faixa aceitável: 40-70 USDC |
| Duração do ciclo | **7 dias** | Acima do piso `MIN_CYCLE_DURATION` |
| Membros por pool | **10** | Igual ao número de ciclos (1 slot/membro) |
| Duração total do pool | **10 semanas** | ~2,5 meses |
| Payout por slot | **500 USDC** | 10 × 50 USDC |
| Yield strategy | **`roundfi-yield-mock`** | Ver §4.2 |
| Grace period | **48 horas** | Reduzido dos 7 dias atuais (ciclo é curto) |
| Stake (nível 1) | **50%** (default atual) | Validar via fuzz — ver §5 |

**Por que USDC e não EUR:** EUR introduz exposição regulatória (MiCA) sem benefício de produto. Hábito de pagamento recorrente vale igualmente em USDC. Mudança de denominação fica para fase pós-audit, se for justificada por demanda do mercado-alvo.

---

## 3. Escala do beta

**Decisão proposta:** começar com **1 pool de 10**, decidir paralelos com base nos primeiros 2-3 ciclos de dados.

**Por que não 24-40 via paralelismo imediato:**

- Paralelizar 3-4 pools antes de qualquer dado significa 3-4× carga ops (suporte, monitoring, crank) sem saber ainda quais são os modos de falha reais.
- Após ciclos 1-3 do primeiro pool: já temos sinal sobre on-time rate, comportamento de defaults, fricção operacional.
- Decisão de escalar para N=24-40 é trivial pós-dados: spin up de mais pools usando os mesmos params.

**Critério explícito para escalar:** se on-time rate > 90% nos primeiros 3 ciclos e zero defaults, abrir +2 pools paralelos na semana 4.

---

## 4. Mudanças técnicas necessárias

### 4.1 Pool params — **nada a fazer no core**

Confirmado em `programs/roundfi-core/src/state/pool.rs:16-20`:

```rust
pub members_target:     u8,
pub installment_amount: u64,
pub cycles_total:       u8,
pub cycle_duration:     i64,
```

Todos já per-pool. **Configurar o beta é chamada de `create_pool` com os valores de §2** — zero código.

### 4.2 Yield strategy — usar `roundfi-yield-mock` existente

Confirmado em `programs/roundfi-yield-mock/src/lib.rs`: o crate já existe, expõe o mesmo discriminator/account-order que o Kamino adapter (linha 18-21 do header).

**O que fazer:**

1. Apontar o pool do beta para o programa `roundfi-yield-mock` no `create_pool`.
2. Pré-fundar o `yield_vault` com **zero surplus** — o mock só retorna o que sobra acima do `tracked_principal` no `harvest`.
3. Resultado: fluxo CPI completo (deposit/harvest preservados), yield real = 0, mecânica do core inalterada.

**Por que isso é melhor que `Option<Pubkey>` bypass:**

- Zero código novo no `roundfi-core`.
- Preserva o caminho de execução de produção (mesmo CPI, mesmo flow).
- Seed Draw permanece ativo, mas como yield é 0, ele não causa drift econômico — apenas exercita o código.
- O adapter de produção (Kamino) é drop-in conforme o header do mock.

### 4.3 Cadência semanal — config-only

`cycle_duration` é per-pool. Setar `604_800` no `create_pool` do beta. Sem mudanças no default global de `DEFAULT_CYCLE_DURATION` — produção continua mensal até decisão separada.

### 4.4 Grace period

`CRANK_DEFAULTS.defaultGraceSec` em `sdk/src/constants.ts` precisa permitir override per-pool. Se já é overrideable, configurar 172_800s (48h) no setup do beta. Se não é, **essa é a única mudança real de SDK** — adicionar override.

**Action item:** confirmar com SDK owner se grace é per-pool ou global.

---

## 5. Validação obrigatória antes do beta — fuzz fixture

A v0.1 afirmou "stake de 50% cobre 1 default". **Isso é falso em parte do espaço de parâmetros.** Análise:

- Default no ciclo 1 (membro slot 1 dá calote após receber payout): pool perde 9 × 50 = 450 USDC de input futuro. Stake do membro = 50% × 500 = 250 USDC. **Não cobre.**
- Default no ciclo 9 (membro do último slot dá calote): pool perde apenas 50 USDC de input remanescente. Stake cobre 5×.

**Ação obrigatória antes de lançar:** rodar fuzz com fixture do beta nos targets existentes em `crates/math/fuzz/fuzz_targets/`:

| Target | O que valida |
|---|---|
| `seed_draw.rs` | Que o seed draw com yield-mock (yield = 0) não quebra |
| `cascade.rs` | Que defaults em diferentes posições de slot mantêm o pool solvente OU encerram graciosamente |
| `dc_invariant.rs` | Que invariantes de double-counting se mantêm com aporte 50 USDC × 10 |
| `waterfall.rs` | Que a ordem de pagamento + stake recovery cobre os cenários do beta |

**Critério de saída:** os 4 targets passam 1M iterações com fixture `installment=50e6, cycles=10, members=10, stake_bps=5000`.

**Sem esse passo, qualquer afirmação sobre "cobertura de default" é especulação.**

---

## 6. Sistema de referral — off-chain primeiro

### 6.1 Decisão arquitetural

**Pre-audit:** referral vive **off-chain** em DB do indexer/backend, com admin attestation.
**Pós-audit:** migração para on-chain via novo campo `Member.inviter` (ADR separado — ver §10).

**Por que off-chain primeiro:**

- Mudar `Member` (adicionar `inviter`, `invitees_active`, `invitees_completed`) é mudança de estado on-chain. Pre-audit, qualquer mudança em estado de membro arrasta superfície de auditoria que ainda não foi feita.
- Lógica de referral é experimental: vamos descobrir nas primeiras semanas quais incentivos funcionam. Iterar regra off-chain custa minutos; on-chain custa semanas + nova audit.
- Pre-beta, o time é pequeno. Admin attest é gargalo aceitável.

**Trade-off honesto:** introduz centralização temporária que contradiz a tese "reputação on-chain". **Mitigação:** comunicação externa clara de que XP do beta é provisório e será migrado on-chain pós-audit + ADR formal documentando a migração.

### 6.2 Implementação off-chain

**Storage:** tabela no DB do indexer:

```
referrals (
  invitee_pubkey       PUBKEY PRIMARY KEY,
  inviter_pubkey       PUBKEY NOT NULL,
  pool_address         PUBKEY NOT NULL,
  joined_at            TIMESTAMP NOT NULL,
  cycles_paid          INT DEFAULT 0,
  defaulted            BOOLEAN DEFAULT FALSE,
  admin_attested_by    PUBKEY NOT NULL,
  attested_at          TIMESTAMP NOT NULL
);
```

**Regras de XP** (aplicadas pelo backend, não pelo programa):

| Evento | XP convidado | XP convidador |
|---|---|---|
| Convidado joina o pool | +50 | 0 (vesting) |
| Convidado completa 1 ciclo | 0 | +20 |
| Convidado dá default | -500 (já existe on-chain) | -100 (off-chain) |
| Cap de convidados ativos por wallet | n/a | 3 |

**XP do convidador é off-chain ledger.** Quando migrar on-chain, indexer escreve XP acumulado via instrução administrativa de "bootstrap reputation" (também precisa ser projetada).

### 6.3 Guard-rails off-chain

- Cap 3 convidados ativos enforced no backend antes do convite ser gerado.
- Auto-referral bloqueado por check `inviter != invitee`.
- Imutabilidade: tabela é append-only; updates só em `cycles_paid` e `defaulted`.
- Admin attest: founders assinam manualmente os 10 primeiros referrals. Quando escalar, automatizar com whitelist.

---

## 7. Riscos e mitigações

| Risco | Severidade | Mitigação |
|---|---|---|
| Default em ciclo inicial inviabiliza pool | **Alta — não validada** | **Bloqueado por §5 fuzz fixture** |
| Centralização off-chain do referral contradiz narrativa | Média | Comunicação explícita + ADR de migração on-chain |
| Yield-mock + Seed Draw causa drift inesperado | Média | Fuzz `seed_draw.rs` com yield=0 |
| Devnet beta não testa hábito de pagamento real | Média (se opção A) | Aceitar como limitação; mainnet beta pós-audit fecha o gap |
| Grace 48h é agressivo demais | Baixa | Reverter para 72h se on-time rate < 85% no ciclo 1 |
| 1 pool de 10 = sinal estatístico pobre | Baixa | Critério de escala em §3 — abrir paralelos com dados |

---

## 8. Checklist de implementação

### Fase 1 — Validação (semana 1-2)

- [ ] **Rodar fuzz com fixture do beta** (§5) — bloqueia tudo
- [ ] Confirmar que `grace_period` é overrideable per-pool no SDK
- [ ] Decidir denominação (USDC confirmado pela §2, mas precisa selo do time)
- [ ] Decidir Opção A (devnet) ou B (mainnet pós-audit) na §1

### Fase 2 — Setup do pool (semana 3)

- [ ] Init do `roundfi-yield-mock` vault para o pool do beta
- [ ] Chamada de `create_pool` com params da §2
- [ ] Smoke test em devnet: 10 wallets de teste, 1 ciclo completo

### Fase 3 — Referral off-chain (paralelizável com Fase 2)

- [ ] Schema do DB de referrals
- [ ] Backend endpoints: gerar convite, atestar, calcular XP
- [ ] Cap enforcement e auto-referral check
- [ ] Dashboard interno para founders atestarem os primeiros 10

### Fase 4 — Operacional (semana 4)

- [ ] Seleção dos 10 testers
- [ ] Termo de participação (experimento, USDC, devnet)
- [ ] Canal dedicado
- [ ] Métricas: on-time rate, defaults, XP médio, NPS qualitativo

### Fase 5 — Pós-beta

- [ ] Análise de dados
- [ ] **ADR de migração referral off-chain → on-chain** (ver §10)
- [ ] Decisão sobre escalar para mainnet beta

---

## 9. Perguntas abertas remanescentes

Reduzidas após v0.2:

1. **§1 — Devnet ou mainnet beta?** Recomendação: devnet.
2. **§3 — Critério de escala:** > 90% on-time rate é o threshold certo, ou mais conservador?
3. **§5 — Quem rodará o fuzz?** Owner de `crates/math`?
4. **§6.2 — XP cap por convidador é 3 ativos ou 3 *totais lifetime*?**
5. **§7 — Critério de aborto:** se ciclo 1 tem 2+ defaults, abortamos beta?
6. **Critério de seleção dos 10:** open application, indicação de founder, ou misto?

---

## 10. ADR pendente — Migração de referral off-chain para on-chain

Quando o beta terminar e antes do v1 público:

- Novo ADR em `docs/adr/0008-referral-on-chain-migration.md`.
- Decisão: schema final de `Member.inviter` + `invitees_active` + `invitees_completed`.
- Path de migração: instrução administrativa "bootstrap reputation" que lê o ledger off-chain (assinado pelos founders) e escreve estado on-chain.
- Janela: snapshot do DB off-chain → freeze → emissão das instruções de bootstrap → unfreeze.

**Não é escopo desta proposta — é referência forward.**

---

## 11. O que mudou de v0.1 para v0.2

Feedback do time:

| Ponto | v0.1 → v0.2 |
|---|---|
| Pool params são per-pool | Removidas Fases 1+2+3 da v0.1 — confirmado em `pool.rs:16-20`, vira config do `create_pool` |
| Usar `roundfi-yield-mock` em vez de bypass | Reformulada §4.2 — yield-mock preserva CPI flow, zero código novo no core |
| USDC em vez de EUR | Decidido em §2 — remove fricção MiCA |
| N=24-40 via paralelos | Reformulado em §3 — 1 pool primeiro com critério explícito de escala |
| Referral off-chain primeiro | Refeito em §6 — DB + admin attest, ADR de migração futura |
| Fuzz com fixture do beta | Nova §5 — bloqueia qualquer afirmação de cobertura de default |
| Devnet vs mainnet explícito | Nova §1 — decisão de produto antes de engenharia |

**v0.1 está obsoleta. Substituída por esta v0.2.**
