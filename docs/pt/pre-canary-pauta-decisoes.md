# Pauta — Reunião de Decisões Bloqueadoras Pré-Canary

**Duração:** 30 minutos
**Formato:** decisões, não discussões. Cada item tem ≤5 min.
**Output:** 5 decisões registradas com **nome + data + artefato**.
**Quando:** ASAP — esta semana. Bloqueia Dia 1 do critical path.
**Participantes:** Alrimar (CTO), Gabriel (Sec), Yvina (CEO), Caio (CPO).

---

## Regras da reunião

1. Cada item tem **3 opções** pré-formuladas. Decidir entre as 3, não inventar uma quarta.
2. Toda decisão sai com **owner + deadline + artefato concreto** (issue, ADR, PR, ou doc).
3. Se um item não tiver consenso em 5 min, **owner do item leva pra decisão off-line em ≤48h**. Não trava reunião.
4. Sem "vamos pensar mais". A decisão pode ser ruim, mas não pode ser ausente.

---

## Decisão 1 — Schema do indexer (Alrimar + Gabriel)

**Contexto:** doc fundacional §5 marca essa decisão como **irrecuperável**. Se indexer só armazena status binário (pagou/não pagou), 70 dias de dados da Fase 1 perdem valor pro produto final (score). Decisão de 2h.

**Opções:**

- **(A)** 6 campos brutos: `paid_at`, `due_at`, `delta_seconds`, `grace_used`, `slot_position`, `cycle_number`. Sem `default_reason` no schema do beta — fica como ADR pós-fase, decisão separada.
- **(B)** 6 campos + `default_reason` agora (`'infra_outage' | 'missed_payment' | 'voluntary_exit' | null`). Adiciona contestabilidade do score como recurso desde o beta.
- **(C)** 7 campos (B) + também `pool_state_hash` por linha pra integridade futura. Maior storage, maior fidelidade.

**Recomendação implícita do fundacional + reviewer:** **(B).** `default_reason` não é só integridade operacional — é o que permite usuário contestar score no framework de CRA/FCRA. Sem ele on-chain com granularidade, não tem disputa.

**Decisão registrada:** ____________
**Owner:** ____________
**Deadline pra implementação no indexer:** ____________
**Artefato:** GitHub issue `indexer-schema-canary` com schema final + migration plan se já tem dados de devnet velhos

---

## Decisão 2 — Data layer mode (Alrimar + Caio)

**Contexto:** doc fundacional §2 marca "Não decidir o data layer (interno vs. exportável) antes do start do Canary" como **biggest strategic mistake**. Decisão afeta o schema da #1.

**Opções:**

- **(A) Interno-only.** Indexer armazena agregados/derivados. Pool history não é exportável via CPI. Score fica dentro do RoundFi. Sem integração com lending protocols possível no v1 mainnet.
- **(B) Exportável via CPI.** Indexer armazena eventos brutos verificáveis. Pool completion vira oracle consumível pra lending protocols. Implementa a "highest-upside opportunity" do §2 ("crédito undercollateralized em parceiro").
- **(C) Híbrido — exportável read-only via API HTTPS, sem CPI on-chain.** Permite integrações Web2 (fintechs Web2 consumindo via API com KYC RoundFi) mas não cumpre tese de "behavioral underwriting primitive como Plaid".

**Trade-offs:** (A) é mais fácil regulatoriamente, mata o upside. (B) é o caminho pro produto descrito no fundacional, exige opinion letter FCRA antes de qualquer post público. (C) é meio-termo que provavelmente não satisfaz nenhum stakeholder.

**Decisão registrada:** ____________
**Owner:** ____________
**Deadline:** ____________
**Artefato:** ADR novo `0009-data-layer-mode.md` (ou número que sobrar pós-merge do #401), citado em todos os outros bloqueadores

---

## Decisão 3 — Persona dos 7 newbies (Yvina + Caio)

**Contexto:** doc fundacional §9 P0 — se os 7 newbies vierem de crypto-native Twitter, Fase 1 mede crypto-natives. Mas o TAM real (per fundacional §2 dimensão 2) é diáspora/imigrante com ROSCA informal + autônomo/PME sem histórico bancário. **Dados serão válidos mas não respondem à pergunta certa.**

**Opções:**

- **(A) Sem pergunta-filtro.** Application aberta, primeiros 7 com wallet ativa ≥7d entram. Risco: amostra crypto-native, signal fraco pro produto real.
- **(B) Pergunta-filtro suave:** "Você se interessa por poupança em grupo?" — soft, baixa fricção, mas não filtra persona certa.
- **(C) Pergunta-filtro do fundacional:** "Você já enfrentou dificuldade de acessar crédito, alugar imóvel ou comprovar renda nos últimos 12 meses?" Filtra persona-alvo sem verificação formal. Recomendado pelo fundacional.

**Risco regulatório de (C):** descrever critério de seleção em termos de "dificuldade de crédito" pode ser interpretado como segmentação de credit-stressed consumers — vale validar com opinion letter (Decisão 4).

**Decisão registrada:** ____________
**Owner:** ____________
**Deadline:** ____________
**Artefato:** texto exato do formulário de application em Notion/GitHub issue

---

## Decisão 4 — Wyoming LLC + Registered Agent (Yvina)

**Contexto:** fundacional §3 — IP dos smart contracts precisa de dono legal antes de mainnet, mas filing leva 2-5 dias e pode ser feito em paralelo. Não bloqueia técnico, mas precisa **começar Dia 1**, não depois.

**Opções:**

- **(A) Auto-filing online** ($100-200 + $100-200/ano de registered agent). Yvina ou Caio assina como organizer. 2-5 dias. **Recomendado pelo fundacional.**
- **(B) Via advogado crypto-especializado.** Combina com a opinion letter do FCRA (Decisão 4 abaixo). Mais caro ($500-1500 extra) mas inclui revisão de operating agreement. 5-10 dias.
- **(C) BVI + Wyoming combo.** Pra captação institucional/token issuance. $1500-3000. **Não recomendado pra agora** — overkill pre-Série A.

**Operating agreement:** sai como item P2 (antes da Fase 1, não antes do Canary). LLC vazia é OK pro Canary.

**Decisão registrada:** ____________
**Owner:** ____________ (provavelmente Yvina como signing organizer)
**Deadline pra filing submetido:** ____________ (sugerido: Dia 1+2 do critical path, em paralelo com nomeações)
**Artefato:** comprovante de filing (state of Wyoming) + nome do registered agent

---

## Decisão 5 — v0.6 do plano (Alrimar)

**Contexto:** doc v0.5.3 está estrategicamente incompleto (não articula produto final = score). v0.6 absorve fundacional como premissa estratégica de 1 página + os 6 gaps do meu raciocínio anterior + os 2 itens que o reviewer apontou (default_reason por contestabilidade, grace per-pool em §13). **Mas v0.6 só documenta decisões já tomadas** — não é o processo de tomar decisões. Por isso vem **depois** desta reunião.

**Opções:**

- **(A) Alrimar escreve v0.6 em 3-5 dias** absorvendo as 4 decisões acima + adicionando §3 "Premissa estratégica" no topo + §9 crank SLA + §13 critérios de go/no-go (incluindo grace per-pool). Eu (Claude) faço primeiro draft, Alrimar revisa.
- **(B) Skip v0.6, criar issues por gap.** Cada gap vira issue no GitHub. Time executa por issue. Doc não cresce, mas perde rastreabilidade narrativa.
- **(C) v0.6 escrita pós-Canary com dados reais.** Beta começa em v0.5.3 com issues abertas por gap. v0.6 vira o documento de transição Canary → Fase 1, com dados.

**Recomendação:** **(A).** v0.5.3 ainda é tecnicamente sólida pra Canary, mas tem 8 gaps catalogados (6 meus + 2 do reviewer). Documentar agora evita que time descubra mid-Canary que esqueceu algo. Manter v0.5.3 como referência histórica.

**Decisão registrada:** ____________
**Owner:** ____________
**Deadline pra v0.6 mergeada:** ____________ (sugerido: Dia 5 do critical path, antes do bottleneck do backend referral começar)
**Artefato:** PR novo (não emenda do #400) com `docs/pt/pre-ceremony-beta-proposta-v0.6.md`

---

## O que NÃO está nesta pauta (e por quê)

Os seguintes itens são execução, não decisão. **Não desperdiçar tempo da reunião com eles:**

- Quem é lead eng / fuzz owner / on-call → já decidido (Alrimar / Gabriel / Yvina / backup Gabriel ou Caio)
- Criar label `sev-low-deadline-canary` → 1 clique do Yvina depois da reunião
- Mergear PR #401 → review do Alrimar fora da reunião
- Redeploy devnet, backend referral, fuzz → execução do critical path, depende destas 5 decisões

---

## Pós-reunião — checklist de 1h pra Yvina

Imediatamente após a reunião:

- [ ] Postar ata no canal interno com 5 linhas: cada decisão + owner + deadline + artefato
- [ ] Criar 5 issues no GitHub (1 por decisão) com label `pre-canary-blocker`, assignee = owner
- [ ] Atualizar checklist §10 do PR #400 marcando itens correspondentes
- [ ] Agendar follow-up de 15 min em 7 dias pra verificar status dos artefatos

Se algum owner não cumprir deadline: escala pro Alrimar como lead eng decidir. **Não democrático.**

---

## Risco que esta pauta NÃO resolve

Reviewer apontou que "três documentos separados com escopos limpos são três documentos sem as decisões mais importantes dentro deles" — e adicionou que "o erro mais provável de execução: o time vai usar a elegância da estrutura como sinal de que o trabalho de alinhamento está feito. Não está."

**Esta pauta também é um doc.** Se o time ler esta pauta e achar que decisões foram tomadas, repetimos o erro.

**Decisões só existem quando registradas com owner + deadline + artefato. Esta pauta é input, não output.**
