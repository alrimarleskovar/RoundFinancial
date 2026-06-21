# Re-Auditoria Criptoeconômica Interna v5.2 — RoundFinancial (Triple Shield)

**Conduzido por:** Adevar Labs (auditoria interna)
**Metodologia:** Padrão Chaos Labs — segurança econômica e simulação de risco (referência de método; **sem envolvimento ou endosso da Chaos Labs**)
**Data:** 2026-06-21
**Baseline anterior:** `fdf356f` (1ª auditoria) / `563020e` (reauditoria)
**Commit auditado:** `180df92` (main, 2026-06-18) — **+143 commits** desde a 1ª auditoria, 362 arquivos, +47k/−6.5k linhas
**Escopo:** modelo econômico Triple Shield + escada de tiers v5.2 (4 níveis) + subsistema comportamental novo + serviço de crank novo

> _Auto-auditoria interna. Não representa auditoria conduzida ou endossada pela Chaos Labs. Não substitui engagement independente. Viés estrutural mantém-se: mesma equipe modelando contra si mesma._

---

## Sumário Executivo

Desde a última passada o RoundFi mudou de escala, não de fundação. **O núcleo de invariantes econômicos on-chain (`crates/math`: cascade, D/C, waterfall, escrow_vesting, seed_draw) está byte-idêntico** ao que auditei e segue coberto por fuzz + property tests — nenhum dos achados sobre esses módulos precisou de revisão. As disposições ECO-001..008 da rodada anterior continuam válidas (`netSolvency` display-only com guard de reachability em CI; recuperação L1 otimista vs L2 conservador; etc.).

A mudança econômica **material** desta versão é a escada de stake de 3 para **4 tiers (50/25/10/3)**: o L2 caiu 30%→25% e nasceu um **L4 "Elite" com stake de 3%** = **33× de alavancagem** sobre a carta (era 10× no Veterano). Isso tem três consequências auditáveis: (a) o Stress Lab **não modela o L4 nem o L2 atualizado** — o stress canônico (`tripleVeteranDefault`, 10%) deixou de ser a pior configuração permitida; por execução, o **mesmo triplo-default num pool Elite fica em −$1.830** de solvência onde o Veterano fica em +$28 (ECO-V52-1); (b) a recuperação estrutural no default piora (saca 100% da carta, perde só 3% de stake) — assimetria real, porém **fortemente gateada** (L4 exige identidade verificada + 8 cycles × cooldown 30d ≈ 240 dias); (c) o L2 a 4× de alavancagem continua com gate fraco (`MIN_CYCLES=1`, sem identidade no default de devnet) — vetor de farming residual da família SEV-047.

Dois subsistemas novos foram avaliados. O **scoring comportamental** (Reliability/Punctuality no indexer + `BehavioralPayload` on-chain) é **100% display/analytics — zero call-sites em handlers**, confirmado por grep; não destrava economia hoje. O **serviço de crank** automatiza `settle_default` corretamente (espelha precondições on-chain, lease coopera entre réplicas), mas tem um furo operacional-econômico: **liquida o membro mesmo quando classifica a falha como `INFRA_FAILURE` da própria operação** — penalidade irreversível por falha possivelmente não-imputável ao membro (ECO-V52-5).

No lado positivo, três hardenings reais entraram: o **earmark de LP agora é subtraído do spendable em `claim_payout`** (fecha o ECO-007 do lado on-chain), `claim_payout` virou **score-neutro** (`PAYOUT_CLAIMED`, fim do farming de promoção por receber payout), e o **L4 tem hard-floor de identidade** independente de config. **Veredito:** nenhum achado novo é fund-drain; os invariantes on-chain seguem intactos. O gap mais acionável é de **modelagem** — o Stress Lab está uma versão de tier atrás da cadeia, e o claim de "solvente por construção" precisa ser re-derivado para o tier de 3% antes de qualquer uso B2B/lender. **Não bloqueia Canary devnet; bloqueia a narrativa de robustez para Phase 3 B2B oracle até o L4 ser modelado e validado.**

---

## O que mudou (Etapa 0 — re-discovery)

| Área | Mudança | Impacto econômico |
|------|---------|-------------------|
| `crates/math/*` (invariantes) | **só `error.rs` +7 linhas** | Nenhum — núcleo intacto |
| `core/constants.rs` | escada 4-tier 50/25/10/3 + L4 Elite (3%); `GRACE_PERIOD_SECS` feature-gate `devnet-canary`→24h | **Alto** — alavancagem 10×→33×; ECO-V52-1/2 |
| `reputation/*` | novo `behavioral_payload.rs`, `LEVEL_4_THRESHOLD=5000`/`MIN_CYCLES=8`, identity hard-floor L4 | Médio — gate de L4 sólido; furo L2 residual |
| `claim_payout.rs` | `SCHEMA_PAYOUT_CLAIMED` (score-neutro) + reserva LP earmark do spendable | **Positivo** — fecha ECO-007 on-chain + HIGH#2 |
| `contribute.rs` | `SCHEMA_POOL_COMPLETE` na parcela final (+50/cycles) + `BehavioralPayload` | Positivo — anti-farming de promoção |
| `services/crank/*` (NOVO) | daemon que chama `settle_default` automaticamente | Médio — ECO-V52-5 |
| `services/indexer/*` | scoring comportamental off-chain (`reliability`/`punctuality`) | Baixo hoje (display-only) |
| `migrate_protocol_config.rs`, `lock_reputation_program.rs` (NOVOS) | resize de config + lock one-way do reputation program | Neutro — authority-gated |

**Invariantes I1–I7 da rodada anterior:** inalterados. O guard de reachability do `netSolvency` (`tests/parity.spec.ts` "ECO-001 reachability") continua no lane `js` do CI.

---

## Achados Detalhados

### [ECO-V52-1] Tier L4 Elite (3% stake) não é modelado no Stress Lab — o stress canônico deixou de ser a pior configuração permitida

- **Severidade:** Medium
- **Categoria:** Assumption frágil / paridade modelo↔cadeia
- **Fragilidade:** A cadeia passou a permitir stake de 3% (`STAKE_BPS_LEVEL_4 = 300`, `core/constants.rs:135`), alavancagem 33×. O Stress Lab (`sdk/src/stressLab.ts:11`) ainda só conhece `Iniciante|Comprovado|Veterano` e seu preset de stress mais agressivo (`tripleVeteranDefault`) usa Veterano (10%). A configuração mais arriscada que o protocolo **permite** não tem preset, não roda nos 45 testes de paridade, e não aparece no `/lab` público.
- **Evidência:** cadeia `core/constants.rs:131-138`; sim `sdk/src/stressLab.ts:179-200` (só 3 tiers, sem Elite).
- **Cenário de Ruptura / Simulação:** `EXECUTADO` (`scripts/stress/audit_v52_l4.mts`, tier Elite injetado em runtime com upfront/escrow extrapolados 0.30/0.70):
  ```
  Triplo default pós-contemplação, 24 membros, $10k, 6.5% APY:
    Veterano (10%) = HEADLINE     → netSolvency final  +28,20  (SOLVENTE)
    Elite    (3%)  = UNMODELED    → netSolvency final  −1.829,84 (INSOLVENTE pela métrica)
  A 0% APY (sem buffer de yield):  Veterano −3.750  vs  Elite −4.350
  ```
- **Impacto:** O claim "solvente por construção" foi re-derivado na rodada anterior só para Veterano. Para o tier de 3%, o mesmo triplo-default que o Veterano sobrevive fica **~$1.860 mais pobre** no mesmo yield. **Caveat honesto (consistente com ECO-001):** `netSolvency` é display-only, zero reachability on-chain — isto **não é fund-drain**; o D/C + seizure on-chain seguem limitando a perda ao colateral em qualquer tier. O que muda é o **tail risk estrutural** (saca 100% da carta contra 3% de colateral) e o fato de o instrumento de prova de robustez estar uma versão de tier atrás da realidade.
- **Mitigação Recomendada:** Adicionar tier Elite ao `LEVEL_PARAMS` com upfront/escrow **definidos** (hoje são indeterminados — não existem em lugar nenhum), criar preset `tripleEliteDefault`, e re-derivar o breakpoint sob $600 on-chain + 3% stake. Trade-off: nenhum de capital efficiency — é fechar o gap de modelagem antes de oferecer 33× a retail/B2B.
- **Requer engagement independente?** Sim — a calibração do upfront/escrow do tier de maior alavancagem é exatamente o que um red-team pago deve estressar.
- **Esforço Estimado:** M

---

### [ECO-V52-2] Stake do L2 defasado no Stress Lab (30% sim vs 25% on-chain)

- **Severidade:** Low
- **Categoria:** Paridade modelo↔cadeia
- **Fragilidade:** v5.2 baixou o L2 de 30%→25% (`core/constants.rs:134`), mas o Stress Lab ainda usa `stakePct: 30` (`sdk/src/stressLab.ts:188`). O preset canônico `healthy`/`BASE_CONFIG` é Comprovado — logo todo preset baseado nele simula 30% de stake quando a cadeia entrega 25%. O sim **superestima** a recuperação de stake vs a realidade atual (5 pontos de carta = $500/default a mais de colateral no modelo do que on-chain).
- **Evidência:** `sdk/src/stressLab.ts:188` vs `core/constants.rs:134`.
- **Impacto:** Drift de paridade que torna os presets levemente otimistas. Não é fund-drain; é o mesmo tipo de divergência L1↔L2 já catalogada (classe ECO-002/006).
- **Mitigação:** Sincronizar `LEVEL_PARAMS.Comprovado.stakePct = 25` + atualizar números esperados nos presets; ou marcar o sim como "ilustrativo, parâmetros podem defasar da cadeia" e travar a paridade real na slice L2 (litesvm).
- **Requer engagement independente?** Não.
- **Esforço Estimado:** S

---

### [ECO-V52-3] L2 a 4× de alavancagem com gate de farming fraco (resíduo SEV-047)

- **Severidade:** Medium
- **Categoria:** Reflexividade/comportamento (farming de reputação)
- **Fragilidade:** `LEVEL_2_MIN_CYCLES = 1` (`reputation/constants.rs:135`) + L2 não exige identidade quando `required_min_level = 0` (default devnet). L2 dá stake 25% = **4× de alavancagem**. O gate de 1 cycle + score 500 (PAYMENT sem rate-limit global no path Pool-PDA) é alcançável com **1 pool sybil de 1 membro**. O cooldown de 30d/POOL_COMPLETE protege L3/L4 fortemente, mas o L2 a 1 cycle é a porta de menor resistência.
- **Evidência:** `reputation/constants.rs:135`; `reputation/state/profile.rs:125` (bypass de identidade com gate off); subagente de reputação V1.
- **Cenário de Ruptura:** atacante completa 1 pool sybil → L2 → entra pool real depositando $2.500, saca carta de $10.000 (4×); em default pós-payout o protocolo recupera só os 25%.
- **Impacto:** Alavancagem 4× destravável em ~1 ciclo. Gateado a 33× (L4) é difícil (240d+identidade), mas o degrau 4× é barato. **Quantificação dependente do default real** (não há distribuição — ECO-006 segue aberto).
- **Mitigação:** Subir `LEVEL_2_MIN_CYCLES` (ex: 2) ou exigir identidade para L2 em mainnet (`required_min_level = 3` já é item de checklist) e garantir rate-limit global por-subject no `SCHEMA_PAYMENT` via Pool-PDA.
- **Requer engagement independente?** Sim (threat-model de farming exaustivo, conluio multi-wallet).
- **Esforço Estimado:** M

---

### [ECO-V52-4] Assimetria de default no L4 — saca 100% da carta, perde 3% do colateral

- **Severidade:** Medium
- **Categoria:** Insolvência (tail) / reflexividade
- **Fragilidade:** No L4, o membro deposita 3% e acessa 100% da carta. Em default estratégico logo após o upfront, o seizure recupera escrow não-dripado + os 3% de stake; a carta já sacada saiu. O demotion por `SCHEMA_DEFAULT` é post-hoc e não recupera capital. Perda líquida potencial por default em L4 ≈ carta − recuperação, com a perna de stake valendo 1/3 da do Veterano.
- **Evidência:** `core/constants.rs:135` (3%); subagente de reputação V2; `settle_default.rs:183` (`missed = installment.min(d_rem)`, recuperação por-parcela, colateral residual fica travado — mecânica inalterada desde a auditoria anterior).
- **Cenário de Ruptura:** atacante com 1 identidade real + 240 dias atinge L4, entra pool real, saca $10k contra $300 de stake, defaulta. **Plausibilidade baixa** (gate de tempo+identidade), **impacto alto se alcançado**.
- **Impacto:** É o vetor que mais justifica engagement externo: o produto vende 33× de alavancagem e a recuperação estrutural cai proporcionalmente. Bounded pelos invariantes on-chain (não cria insolvência instantânea), mas o colchão real do tier mais alavancado nunca foi medido.
- **Mitigação:** Modelar o L4 (ECO-V52-1) e definir um colchão-alvo (ex: GF/solidariedade dimensionados para N defaults Elite correlatos); considerar cap de exposição L4 por pool. Trade-off: capital efficiency vs segurança do tier topo.
- **Requer engagement independente?** Sim.
- **Esforço Estimado:** L

---

### [ECO-V52-5] Crank liquida membro mesmo classificando a falha como `INFRA_FAILURE` da própria operação

- **Severidade:** High (operacional-econômico)
- **Categoria:** Dependência externa / griefing involuntário
- **Fragilidade:** O serviço de crank (`services/crank/src/settleDefaults.ts:147-158`) classifica a causa do default como `PAYMENT_MISSED` vs `INFRA_FAILURE` (ex: o próprio RPC da operação esteve down sobre o deadline do membro), mas a classificação é **puramente cosmética** — ele dispara `settle_default` de qualquer forma. Isso apreende stake/escrow, grava attestation de DEFAULT **permanente** e −500 de reputação, com "reversão" apenas off-chain no score (a apreensão de fundos **não** é revertida).
- **Evidência:** `services/crank/src/settleDefaults.ts:104-110, 147-158`; subagente de crank §2.
- **Cenário de Ruptura:** falha de infra da operação (ou do RPC compartilhado) impede o membro de contribuir perto do deadline; o crank, sabendo que a falha pode ser da infra, ainda liquida. Combinado com `settle_default` permissionless, o membro honesto é penalizado irreversivelmente.
- **Impacto:** Penalidade econômica irreversível (stake + reputação) por falha potencialmente não-imputável ao membro. É o achado novo mais sério do lado operacional.
- **Mitigação:** Quando o crank detecta `INFRA_FAILURE` (RPC down sobre o deadline), **adiar** o settle e estender o grace efetivo (ou exigir confirmação humana), em vez de liquidar e logar. Idealmente, grace por-pool on-chain que possa ser estendido sob incidente de infra (já é follow-up reconhecido no doc do parceiro).
- **Requer engagement independente?** Não (correção de política operacional verificável).
- **Esforço Estimado:** M

---

### [ECO-V52-6] `GRACE_PERIOD_SECS` override de 24h via feature `devnet-canary` — floor-test não pega vazamento para mainnet

- **Severidade:** Low / Informational
- **Categoria:** Configuração (família SEV-002)
- **Fragilidade:** A feature `devnet-canary` baixa o grace para 86_400s (24h) em compile-time (`core/constants.rs:61-66`). O floor-test `grace_period_above_mainnet_floor` usa floor = 86_400 e **passa a 24h** — não detecta um vazamento da feature para mainnet. A proteção real é: (a) a feature **não está em nenhum path default/mainnet** (`Cargo.toml:26`, ausente de `Anchor.toml` e `mainnet-deploy.yml`), e (b) o pin de 7d (`grace_period_is_seven_days`) só roda em builds `not(devnet-canary)`.
- **Evidência:** `core/constants.rs:61-66, 320-345, 419-425`; `Cargo.toml:24-26`; subagente de crank §5.
- **Impacto:** Materialmente **melhor** que o SEV-002 original (constante runtime patchada) — agora é gate de compilação + process-guard. Risco residual: build de mainnet compilado manualmente com `--features devnet-canary` cairia para 24h silenciosamente, sem teste pegando. Sobre **griefing**: 24h vs 7d é diferença de robustez do membro honesto, não de reabrir o vetor de botnet da v1 (que era 60s) — um adversário liquida em `deadline+1` independentemente da janela.
- **Mitigação:** Adicionar ao `mainnet-hardening-check.ts` uma assertiva de que o binário deployado tem grace = 604_800 (lido do comportamento on-chain), fechando o gap process→test. Considerar grace por-pool on-chain (já é follow-up reconhecido).
- **Requer engagement independente?** Não.
- **Esforço Estimado:** S

---

### [ECO-V52-7] Scoring comportamental — risco futuro se migrado on-chain sem ancorar `delta_seconds` ao Clock

- **Severidade:** Informational
- **Categoria:** Dependência externa (risco prospectivo)
- **Fragilidade:** Hoje o scoring comportamental (Reliability/Punctuality) é off-chain, `v1-provisional`, **zero call-sites em handlers** (verificado por grep) — não gateia economia. Mas os docs declaram intenção de migrar os critérios "Elite" para esses scores num upgrade futuro. O indexer re-deriva tudo de `delta_seconds` do `BehavioralPayload`, valor fornecido pelo emissor (core/admin) sem prova on-chain de que `paid_ts`/`due_ts` correspondem ao `Clock` real.
- **Evidência:** `programs/roundfi-reputation/src/state/behavioral_payload.rs:27-29` (nunca lido de volta); `services/indexer/src/behavioralClassification.ts`; subagente de reputação V3.
- **Impacto:** Nenhum hoje. Se o gate Elite for ligado sobre esses scores sem ancorar os timestamps ao Clock, abre-se manipulação direta de alavancagem via payload forjado.
- **Mitigação:** Antes de gatear qualquer economia nos scores comportamentais, vincular `paid_ts`/`due_ts` ao `Clock` on-chain e à schedule real do pool. Manter o guard de reachability estendido para o `BehavioralPayload`.
- **Requer engagement independente?** Sim, quando/se a migração for planejada.
- **Esforço Estimado:** M (futuro)

---

## Hardenings confirmados desde a última auditoria (lado positivo)

| Item | Evidência | Efeito |
|------|-----------|--------|
| **ECO-007 fechado on-chain** | `claim_payout.rs`: spendable agora subtrai `guarantee_fund_balance + lp_distribution_balance` | LP earmark não é mais gastável por claim_payout — fim da sub-colateralização da obrigação LP |
| **HIGH#2 (review parceiro) resolvido** | `claim_payout` → `SCHEMA_PAYOUT_CLAIMED` (score-neutro); +50/cycles movido p/ `SCHEMA_POOL_COMPLETE` na parcela final | Receber payout não gera mais progresso reputacional — fecha farming de promoção |
| **L4 identity hard-floor** | `IDENTITY_HARD_FLOOR_LEVEL = LEVEL_MAX`; `cap_level_for_identity` capa não-verificado em L3 mesmo com gate off | Elite (33×) inalcançável sem Proof-of-Personhood, independente de config |
| **Núcleo de invariantes intacto** | `crates/math/*` só `error.rs` mudou | Toda a matemática de cascade/D/C/waterfall/vesting/seed-draw validada antes segue válida |

---

## Pontos de Ruptura e Análise de Solvência (atualizado v5.2)

| Cenário | Plausibilidade | Resultado (métrica display-only) | Leitura honesta |
|---------|----------------|----------------------------------|-----------------|
| Triplo default Elite (3%) @ 6.5% | Moderada (se L4 popular) | −$1.830 vs Veterano +$28 | Pior config permitida, **não modelada**; tail risk real, não fund-drain |
| L2 farming → 4× alavancagem | Moderada (gate fraco) | — | Destravável em ~1 cycle sybil; sem identidade no devnet default |
| L4 default assimétrico (saca 100%/perde 3%) | Baixa (240d+identidade) | — | Impacto alto se alcançado; bounded por invariantes on-chain |
| Crank liquida sob INFRA_FAILURE | Moderada (depende da infra) | — | Penalidade irreversível por falha não-imputável |
| Vazamento `devnet-canary` p/ mainnet | Baixa (process-guard) | grace 24h | Melhor que SEV-002; gap process→test |

---

## Riscos Residuais e Recomendação de Engagement Externo

O que esta auto-auditoria **não cobre** por viés/ferramenta, agravado pelo L4: (a) **calibração do upfront/escrow e do colchão do tier de 3%** — parâmetros que hoje sequer existem no modelo; (b) **threat-model de farming exaustivo** (conluio multi-wallet, timing promote/join) sob a nova escada de 4 tiers; (c) **distribuição real de default/churn** (ECO-006 segue aberto) — agora mais crítica porque 33× amplifica a cauda.

**Recomendação:** o **Canary devnet permanece desbloqueado** — invariantes on-chain intactos, achados novos são de modelagem/operação, não fund-drain. **Para Phase 3 B2B oracle / mainnet GA com o tier Elite ativo**, o engagement criptoeconômico independente passa a ser **mais necessário que na rodada anterior**, com escopo adicional explícito: modelar e estressar o L4 (33×) antes de oferecê-lo a retail/lenders. Enquanto o L4 não for modelado e validado, **a narrativa de "solvente por construção" não deve ser estendida ao tier de 3%**.

---

## Anexos

**Comandos executados:**
```bash
node --experimental-strip-types scripts/stress/audit_v52_l4.mts   # quantificação L4
git diff fdf356f..HEAD -- crates/math/                            # núcleo intacto (só error.rs)
grep -rn 'BehavioralPayload\|decode' programs/                    # reachability comportamental (zero handlers)
grep -rn 'devnet-canary' Anchor.toml .github/workflows/mainnet-deploy.yml  # feature não está em path mainnet
```

**Saídas-chave (execução):**
- Triplo-default por tier @ 6.5% APY: Iniciante +$16.127 / Comprovado +$7.164 / **Veterano +$28 / Elite −$1.830**.
- 0% APY (estrutural): Veterano −$3.750 / Elite −$4.350.
- Núcleo de invariantes `crates/math`: byte-idêntico exceto `error.rs (+7)`.
- Scoring comportamental: zero call-sites de `decode`/`.classification` em handlers de programa.

**Subagentes:** auditoria de incentivos do scoring comportamental + auditoria de risco do crank service (relatórios completos no histórico da sessão).

**Continuidade:** disposições ECO-001..008 da rodada anterior reafirmadas. Novos achados numerados ECO-V52-1..7.
