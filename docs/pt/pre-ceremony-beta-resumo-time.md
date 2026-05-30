# Resumo: Pre-Ceremony Beta — em 5 minutos

**Pra quem é este doc:** time RoundFi, sem precisar ler as 600 linhas da proposta v0.5.3.
**Versão do doc completo:** `docs/pt/pre-ceremony-beta-proposta.md` (PR #400)
**Data:** 2026-05-21

---

## O que vamos fazer, em uma frase

Antes de abrir o RoundFi pro mundo, vamos testar com um grupo pequeno em **devnet** (rede de teste, dinheiro de mentira) por uns **3 meses**, em **duas fases**. Sem capital real em risco. Foco é aprender, não ganhar.

---

## As duas fases

### Fase 0 — "Genesis Canary" (canário na mina)

| Parâmetro | Valor |
|---|---|
| Quantos testers | 10 (do círculo dos founders) |
| Quanto cada um paga | 10 USDC por ciclo |
| Cada ciclo dura | 48 horas |
| Quantos ciclos | 10 |
| Quanto dura no total | ~20 dias |

**Pra que serve:** descobrir bugs operacionais e ver como pessoas reagem em cadência rápida. O nome "canário" vem do canário que mineiros levavam pra mina — se o canário morre, tem coisa errada no ar antes de matar gente. Aqui o canário somos nós mesmos.

**O que NÃO testa:** "hábito" — 48 horas é muito rápido pra ser hábito, é stress test.

### Fase 1 — "Pre-Ceremony Semanal"

| Parâmetro | Valor |
|---|---|
| Quantos testers | 10 (3 da Fase 0 + 7 novos) |
| Quanto cada um paga | 50 USDC por ciclo |
| Cada ciclo dura | 7 dias |
| Quantos ciclos | 10 |
| Quanto dura no total | ~70 dias |

**Pra que serve:** ver se pessoas realmente pagam semana após semana, do jeito que seria em mainnet.

---

## Por que 3 veteranos + 7 novos na Fase 1?

- **Os 3 veteranos** já viveram o produto, viram bugs, sabem o fluxo. Funcionam como "âncoras sociais" — modelo de comportamento pra novos.
- **Os 7 novos** trazem a perspectiva de "primeira experiência". Sem essa cohort, a gente só mede como veteranos se comportam, e isso enviesa o sinal.
- Veteranos são escolhidos por uma fórmula: quanto pagaram em dia (60% do peso) + quanto conversaram no Discord (40%). Top 5 do Canary → 3 que aceitam continuar.
- Os 7 novos vêm de aplicação pública (anunciada por post depois do Canary).

---

## Regras de bug — quando para tudo

Adaptamos o padrão da Mozilla/OWASP/Chromium:

- **Bug Critical / High / Medium** → para tudo até resolver
- **Bug Low** → registra issue no GitHub, tem 30 dias pra resolver, mas não bloqueia
- **Bug Info** → ignora (é só observação)

**Separação importante:**
- **Quem decide a gravidade do bug:** a rubrica em `docs/security/internal-audit-findings.md`. Não é opinião do lead eng. Isso evita que alguém minimize bug pra não atrasar o que ele próprio empurrou.
- **Quem decide o que fazer com o bug** (corrigir / abortar fase): o lead eng. Não é votação democrática.

---

## Sistema de "convide um amigo" (referral)

| Evento | Convidado ganha | Convidador ganha |
|---|---|---|
| Convidado entra | +50 pontos | 0 (vai ganhando aos poucos) |
| Convidado completa 1 ciclo | nada | +20 pontos |
| Convidado dá calote | -500 pontos (já existe) | -100 pontos (novo) |
| Limite de convidados ativos | — | 3 ao mesmo tempo |

**Importante:** durante o beta, isso fica num banco de dados nosso (off-chain). Depois, com auditoria, migra pra blockchain.

---

## Time e papéis

Mapeamento sugerido, time confirma na call de capacity:

| Papel | Quem | Por que |
|---|---|---|
| **Lead engineer** (decide o que fazer em caso de bug) | **Alrimar** | É CTO, conhece o programa de ponta a ponta |
| **Fuzz owner** (rodar testes de stress) | **Gabriel** | O job dele é "quebrar o que Alrimar constrói" |
| **Plantão primário** (atende testers no dia a dia) | **Yvina** | Próxima dos testers, CEO presente |
| **Plantão reserva** (cobertura) | **Gabriel** (depois que fuzz terminar) ou **Caio** | Pra não sobrecarregar uma pessoa só |

**Regras de bom senso aplicadas:**

1. Lead eng e fuzz owner podem ser a mesma pessoa, mas separamos porque Gabriel é o adversário natural.
2. Lead eng **não** deve ser plantão primário — quem decide aborto não pode ser quem responde ticket. Senão fadiga vira viés.
3. Pelo menos 1 não-founder no plantão. Founders se queimam em 3 meses.
4. **Se não der pra preencher tudo com 2+ pessoas distintas, reduzimos escopo** (1 pool por fase em vez de 3). Honesto > heroico.

**Decisão pendente do time:** Yvina realmente tem 3-4h/dia disponível por 3 meses? Se não, troca pra Caio como primário. Decidir agora, não no meio.

---

## Antes de começar, precisa estar pronto

Lista do que **não pode faltar** no Dia 1 (estava implícito, agora explícito):

**Pessoas:**
- [ ] Lead eng nomeado
- [ ] Fuzz owner nomeado
- [ ] 2+ pessoas no plantão (preferencialmente 1 não-founder)
- [ ] Procedimento de "como abortar fase no meio" escrito

**Ferramentas:**
- [ ] Label `sev-low-deadline-canary` criada no GitHub (1 clique)
- [ ] Discord/Telegram com bot que conta mensagens (pra fórmula dos veteranos funcionar depois)
- [ ] Push notification confirmado funcionando

**Software:**
- [ ] Backend do referral pronto (banco + dashboard + script de atestar)
- [ ] Termo de participação escrito pros testers
- [ ] Doc de onboarding pros testers

**Devnet:**
- [ ] Programa redeployado com grace de 24h (vs 7 dias)
- [ ] Cranker rodando em 48h
- [ ] Indexer apontado pros novos IDs
- [ ] Como dar USDC devnet pros testers (faucet funciona? ou nós mintamos?)

**Validação:**
- [ ] Rodar fuzz com 6 testes × 1 milhão iterações cada (~24-48h de compute)
- [ ] Decidir o que fazer se ensaio geral encontrar bug Medium
- [ ] Ensaio geral com 10 carteiras simuladas, 1 ciclo completo

---

## Cronograma — 2 a 3 semanas pra começar

```
Dia 1-2   │ Nomear gente, criar label, rascunhar
          │ procedimento de aborto
Dia 3-5   │ Redeploy do programa + cranker + indexer
          │ + confirmar push notifications
Dia 5-8   │ ⚡ Bottleneck: construir backend do referral
          │   (3 dias de programação sólida)
Dia 8-11  │ ⚡ Bottleneck: rodar fuzz (24-48h compute)
          │   + analisar resultados
Dia 11-13 │ Termo + doc de onboarding + escolher 10 testers
          │ + distribuir USDC devnet
Dia 13-14 │ Ensaio geral com testers de verdade, 1 ciclo
Dia 15    │ START Canary
```

Com 1 dev: 3 semanas. Com 2 devs (paralelizando): 2 semanas.

---

## O que NÃO esperar dos dados

Importante pra qualquer apresentação que sair daqui:

1. **Taxa de calote do Canary NÃO é preditiva.** Em devnet com 10 USDC mintado, dar calote não dói. Vai ter muito mais calote que em mainnet. Conclusão útil: "o mecanismo de detectar calote funciona". Conclusão inválida: "vai ter X% de calote em produção".

2. **Hábito só é medido na Fase 1.** Pagar a cada 48h não é hábito — é stress. Só 7 dias começa a ser hábito.

3. **On-time rate da Fase 1 está inflado.** Como grace é 7 dias e ciclo também é 7 dias, alguém pode pagar com 6 dias de atraso e ainda contar como "em dia". Em mainnet (com grace de 24-48h), o número real seria menor. **Reportar dois números:** bruto (com grace de 7d) e estrito (paga dentro de 3,5 dias = `ciclo / 2`).

4. **Testers vêm do círculo dos founders → viés de "early adopter".** A Fase 1 traz 7 novos via aplicação pública pra mitigar, mas continua não-aleatório. Conclusão válida: "power users pagam recorrente". Conclusão inválida: "qualquer pessoa pagaria recorrente".

---

## O que aconteceu até aqui (status dos PRs)

- **PR #400** — proposta completa (v0.5.3 travada). Time precisa revisar e marcar `[ ]` → `[x]` na checklist conforme as decisões reais. https://github.com/alrimarleskovar/RoundFinancial/pull/400
- **PR #401** — ADR 0008 treasury (Squads multisig custody). Quando esse mergear, libera numeração dos ADRs futuros (0009 referral migration, 0010 grace per-pool). https://github.com/alrimarleskovar/RoundFinancial/pull/401

---

## Próximos passos (o que precisa acontecer)

**Esta semana:**

1. **Conversa de 15 min com Yvina** — confirma se ela tem banda como plantão primário, ou troca pro Caio. Decidir uma vez, não no meio.
2. **Criar label `sev-low-deadline-canary`** no GitHub (1 clique).
3. **Decidir mapeamento final** com Alrimar / Gabriel / Yvina presentes — gravar em ata ou Discord pinned message.
4. **Revisar PRs #400 e #401**, mergear quando ok.

**Próxima sessão de trabalho:**

5. Começar o critical path do Dia 1-2 (nomeações fechadas, drafts).
6. Rascunhar `scripts/devnet/referral-cycle-attest.ts` (o bottleneck de Dia 5-8) **com as decisões reais**, não com placeholders.

---

## Em uma frase, pra mandar pro time

> "Vamos rodar o RoundFi em devnet com 10 amigos por 20 dias (Canary) pra achar bugs e ver UX, depois com 10 pessoas (3 + 7 novos) por 70 dias (Semanal) pra ver se pagam toda semana. Tudo travado em v0.5.3. Falta 4 decisões de time pra começar: capacity da Yvina, label no GitHub, mapeamento final, e merge do PR #401."

---

## Onde está cada coisa

| Coisa | Onde |
|---|---|
| Proposta completa (600 linhas) | `docs/pt/pre-ceremony-beta-proposta.md` |
| Este resumo | `docs/pt/pre-ceremony-beta-resumo-time.md` |
| ADR 0008 (treasury) | PR #401 |
| Rubrica de severidade | `docs/security/internal-audit-findings.md` |
| Critical path (cronograma detalhado) | §10 da proposta |
| Caveats sobre dados | §4 da proposta |
| Decisões fechadas (D1-D5) | §13 da proposta |
