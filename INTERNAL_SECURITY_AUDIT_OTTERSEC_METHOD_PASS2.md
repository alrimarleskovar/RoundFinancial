# Relatório de Re-Auditoria de Segurança Interna — RoundFinancial (Passe 2)

**Conduzido por:** Adevar Labs (auditoria interna)
**Metodologia:** Padrão OtterSec — auditoria adversarial de Web3 (referência de método; sem envolvimento ou endosso da OtterSec)
**Data:** 2026-06-21
**Commit Auditado:** `180df926` (origin/main) — re-auditado a partir do passe anterior em `fdf356f`
**Escopo:** Re-auditoria após 143 commits — foco no delta on-chain + verificação dos achados anteriores

> _Auto-auditoria interna. Não representa auditoria conduzida/endossada pela OtterSec. Numeração `SEV-A…` é própria deste passe._

---

## 0. O que mudou desde o último passe (`fdf356f` → `180df92`)

143 commits, **+2.255 linhas on-chain**. Mudanças estruturais relevantes para segurança:

| Área | Mudança | PR(s) |
|---|---|---|
| **Reputação** | Escada de 4 tiers (50/25/10/3 + L4 Elite); gate de `cycles_completed`; gate de identidade configurável + piso duro de L4; `BehavioralPayload` (96B) | #464, #478, #467, #455-461 |
| **Taxonomia Pass-3** | `claim_payout` deixa de dar score; `POOL_COMPLETE` agora emitido por `contribute` na última parcela | #466 |
| **Toolchain** | Migração Agave 3.x / Anchor 1.0 / mpl-core 0.12 | #487 |
| **Novas ix core** | `skip_defaulted_payout`, `close_member`, `close_pool_vaults`, `lock_reputation_program`, `migrate_protocol_config` | #480, #483, #470 |
| **Novas ix rep** | `set_identity_gate`, `migrate_reputation_config` | #467 |
| **Kamino** | Teto de plausibilidade de yield (`MAX_HARVEST_YIELD_MULTIPLE`) | Wave 3 |

A composição da stack é a mesma do passe 1: lógica de valor 100% on-chain; `app/` client-side puro; `indexer/` read-only. Esforço deste passe: ~90% no delta on-chain (reputação + novas ix), ~10% em deps/toolchain.

---

## 1. Status dos achados do passe anterior

| Achado anterior | Status | Evidência |
|---|---|---|
| **SEV-A (High) — farming de reputação → colateral barato** | ✅ **Substancialmente corrigido** | `promote_level` agora exige `cycles_completed` (L2≥1, L3≥3, L4≥8) além do score; `cycles_completed` só sobe em `SCHEMA_POOL_COMPLETE`, com cooldown global de 30 dias por subject; L4 tem piso de identidade que nenhum config desliga. Score sozinho não promove (`profile.rs:93-117`, `resolve_level_cycles_gate_sev047` test). |
| **SEV-B (Medium) — `lp_distribution_balance` não reservado** | ✅ **Corrigido (SEV-048)** | `claim_payout.rs:137-144` e `deposit_idle_to_yield.rs:97-101` agora reservam `gf + lp_distribution_balance`. |
| **SEV-C (Low-Med) — deps vulneráveis** | ⚠️ **Piorou** | `pnpm audit` agora: **1 critical / 4 high / 6 moderate / 2 low** (era 0 critical). Ver §2 SEV-C2. |
| **SEV-D (Low/Info) — indexer confia em `msg!`** | ⏳ Inalterado | Display-only, fora do caminho de fundos. |

**O time fechou os dois achados materiais do passe 1.** A correção do SEV-A em particular é bem desenhada — o gate de `cycles_completed` é a defesa primária (relógio de parede inquebrável) e o piso de identidade é defesa-em-profundidade no topo.

---

## 2. Achados novos deste passe

### [SEV-A2] Cooldown de `POOL_COMPLETE` no caminho obrigatório de `contribute` pode bloquear a parcela final de um membro honesto

- **Severidade:** Medium
- **Categoria:** Liveness / correção de contabilidade de reputação (regressão introduzida pelo Pass-3)
- **Vulnerabilidade:** O Pass-3 (#466) moveu a emissão de `SCHEMA_POOL_COMPLETE` para dentro de `contribute`, disparada na **última parcela** do pool (`contribute.rs:259-266`). A emissão é via `invoke_attest(...)?` — propaga erro. Em `attest.rs:207-217`, o cooldown de `MIN_POOL_COMPLETE_COOLDOWN_SECS` (**30 dias**) é checado para `SCHEMA_POOL_COMPLETE` **incondicionalmente — inclusive no caminho pool-PDA** (não é gated por `is_admin`, ao contrário do cooldown de PAYMENT). Logo, se o membro completou **outro** pool há menos de 30 dias, a CPI de attest reverte com `CooldownActive` e **a transação `contribute` inteira reverte**.
- **Evidência:**
  - `programs/roundfi-core/src/instructions/contribute.rs:257-339` — `is_final_installment` → `SCHEMA_POOL_COMPLETE` → `invoke_attest(...)?` (sem fallback).
  - `programs/roundfi-reputation/src/instructions/attest.rs:207-217` — cooldown de 30 dias aplicado ao schema, independente do issuer.
  - `programs/roundfi-core/src/constants.rs:159` — `MIN_CYCLE_DURATION = 86_400` (1 dia): pools de ciclo curto são permitidos, então a janela para pagar a parcela final pode ser **menor que o cooldown de 30 dias**.
- **Impacto:** Um membro participando de dois (ou mais) pools cujas conclusões caem dentro de uma janela de 30 dias — situação normal para um usuário ativo com pools concorrentes — fica **impedido de fazer sua última contribuição** no segundo pool. Consequências:
  1. Perde permanentemente o reward `POOL_COMPLETE` (+50 score, `cycles_completed += 1`) que cumpriu honestamente — uma vez que o pool atinge `Completed` (outro membro saca o slot final), `contribute` rejeita por `status != Active`. Não há como pagar depois.
  2. O pool fica uma parcela a menos no float, o que pode fazer o `claim_payout` do slot final falhar o guard `spendable >= credit` (`claim_payout.rs:145`), travando aquele payout (não há `skip` para membro vivo não-pago).
  3. Dano de reputação a um usuário que se comportou corretamente — ironicamente o oposto do objetivo do sistema.
  Não é drenagem direta por atacante, mas é uma regressão de liveness/correção que atinge **usuários honestos sob uso normal**, e o cooldown está agora no caminho crítico de movimento de fundos.
- **Cenário de Exploração / Reprodução:** `NÃO-EXECUTADO / análise estática`.
  1. Membro M conclui o pool A hoje (última parcela → `POOL_COMPLETE`, `last_cycle_complete_at = T`).
  2. Pool B (do qual M também participa) chega à última parcela de M em `T + 20 dias`.
  3. M chama `contribute(última)` no pool B → CPI attest `POOL_COMPLETE` → `now - last_cycle_complete_at = 20d < 30d` → `CooldownActive` → `contribute` reverte.
  4. M não consegue completar até `T + 30d`; se o pool B fechar antes (ou for de ciclo curto), o bloqueio é permanente.
- **Mitigação Recomendada:** A tensão é real — o cooldown de 30 dias é *load-bearing* contra o farming de `cycles_completed` via pools de 1 membro/1 ciclo. Opções, da mais segura à mais simples:
  1. **Tornar a emissão de `POOL_COMPLETE` em `contribute` best-effort:** se a CPI de attest falhar por `CooldownActive`, registrar `msg!` e seguir (a contribuição em USDC não deve depender do reward de reputação). Requer capturar o erro específico em vez de `?`. *Trade-off:* o membro ainda perderia o `cycles_completed` daquele pool — aceitável, mas idealmente combinar com (2).
  2. **Substituir o cooldown temporal por um anti-farming estrutural:** só contar `cycles_completed` (e aplicar o reward) para pools com `members_target >= N` e `cycle_duration >= MIN` "reais", lendo `BehavioralPayload.group_size`/duração. Isso remove a necessidade do cooldown no caminho de `contribute` sem reabrir o farming de pools triviais.
  3. **Exigir `cycles_total >= MIN_CYCLES_FOR_REWARD` no `create_pool`** para que um pool conte para reputação — fecha o farming de pools de 1 ciclo na origem.
- **Esforço Estimado:** M

---

### [SEV-E] Nível Elite (L4, stake 3%) persiste após expiração/revogação de identidade

- **Severidade:** Low
- **Categoria:** Design econômico / identidade
- **Vulnerabilidade:** O piso de identidade do L4 (`cap_level_for_identity`, `IDENTITY_HARD_FLOOR_LEVEL`) é aplicado **apenas no momento da promoção** (`promote_level`). `join_pool` confia em `profile.level` diretamente (`join_pool.rs`, `profile.level.clamp(1,4)`) e o nível é monotônico-para-cima (só cai em `SCHEMA_DEFAULT`). Um membro que atinge L4 com identidade verificada e depois deixa a identidade **expirar/ser revogada** mantém `profile.level == 4` e continua usufruindo do stake de 3% em pools futuros.
- **Evidência:** `promote_level.rs:84-99` (cap só na promoção); `join_pool.rs` (lê `profile.level`, não reavalia identidade); `profile.rs:146-162` (`cap_level_for_identity` é puro, chamado só em promote).
- **Impacto:** Exposição econômica limitada — um Elite legítimo que perde verificação mantém o maior desconto de colateral (3% vs 50%). Não é farming barato (exige ter sido genuinamente verificado + 8 pools completos antes), mas desalinha o invariante "L4 sempre exige identidade".
- **Mitigação Recomendada:** Reavaliar o piso de identidade também em `join_pool` para níveis ≥ `IDENTITY_HARD_FLOOR_LEVEL` (passar a conta `IdentityRecord` + `IdentityGateConfig`, aplicar `cap_level_for_identity` sobre o nível lido). Alternativa mais leve: cron off-chain que dispara re-derivação/demote quando a identidade expira.
- **Esforço Estimado:** S

---

### [SEV-C2] `pnpm audit` agora reporta 1 crítico (regressão de cadeia de suprimentos)

- **Severidade:** Low (contextual) / Info
- **Categoria:** Cadeia de suprimentos
- **Vulnerabilidade / Evidência:** Saída **real** atual: **1 critical / 4 high / 6 moderate / 2 low**.
  - **critical — `shell-quote@1.8.3`** (quote() não escapa newlines): entra via `react-devtools-core` (`pnpm-lock.yaml:6771` → dev/debug tooling). **Não está no caminho de produção nem perto de fundos** (que são on-chain). Risco real ~nulo na utilização atual, mas é um crítico no inventário.
  - high: `bigint-buffer` (overflow no decode Solana — mesmo do passe 1), `serialize-javascript` (RCE), `ws` (DoS por fragmentos).
- **Impacto:** Nenhum on-chain. O crítico é dev-only.
- **Mitigação Recomendada:** Resolver/override de `shell-quote` (ou remover `react-devtools-core` do bundle de produção), bump de `bigint-buffer`/`serialize-javascript`/`ws`. Rodar `cargo-audit` no CI Rust (segue indisponível neste ambiente — **não executado**).
- **Esforço Estimado:** S

---

## 3. Áreas verificadas e confirmadas sólidas (delta)

- **Migração Anchor 1.0 / mpl-core 0.12 (#487):** limpa. As trocas `to_account_info()` → `key()` em `CpiContext::new` acompanham a nova assinatura; lifetimes `Context<'info, T<'info>>` corretos. A verificação pós-CPI do `escape_valve_buy` (owner==buyer + re-freeze) permanece intacta.
- **`skip_defaulted_payout`:** preenche um gap de liveness **real e correto** — um membro contemplado que deu default antes do seu slot deixaria o pool travado para sempre (`claim_payout` exige `!defaulted`). A nova ix avança o ciclo sem disbursar (pot fica no float), com os mesmos guards de slot-monotonicidade. Bem feito.
- **Kamino harvest:** ganhou teto de plausibilidade simétrico ao `PrincipalLoss` (`MAX_HARVEST_YIELD_MULTIPLE`), com `checked_mul`. Defesa-em-profundidade correta.
- **`BehavioralPayload` (96B):** **write-only on-chain** — confirmado que o programa nunca lê o payload para gatear nada (docstring + ausência de call sites de `decode` no fluxo de execução); apenas escreve. Sem nova superfície de confiança. Arredondamento/encoding determinístico com pad zerado.
- **`set_identity_gate` / `lock_reputation_program` / `close_member`:** autorização correta (assinatura da `config.authority` viva; idempotência; piso de validade de `required_min_level ∈ {0}∪[2,LEVEL_MAX]`).
- **`migrate_protocol_config` / `migrate_reputation_config`:** rescues de devnet com guards sólidos (discriminator + PDA seeds + authority bytes lidos crus antes de desserializar; `resize` Anchor 1.0; único campo não-zero `lp_share_bps` escrito por offset). O offset mágico `343` é frágil mas documentado e coberto; é caminho devnet, não mainnet.
- **Validador Passport (identidade):** endurecido — `owner == passport_attestation_authority`, binding do owner-wallet ao signer, escopo de rede, teto de horizonte (`MAX_PASSPORT_HORIZON_SECS` 180d) contra bridge comprometida emitindo TTL implausível. Trust boundary explícita (bridge = multisig). Resíduo conhecido e documentado: a força do link de identidade = a chave da bridge.

---

## 4. Invariantes sugeridos para teste (delta)

1. **Liveness da parcela final (SEV-A2):** "um membro que completou o pool A pode sempre fazer a última contribuição do pool B" — teste com duas conclusões em < 30 dias; hoje **falha** (revert por `CooldownActive`).
2. **Piso de identidade no join (SEV-E):** "`join_pool` nunca concede stake de L4 a wallet sem identidade verificada vigente" — hoje não reavalia.
3. **Anti-farming de cycles (regressão da correção SEV-A):** property test — score arbitrariamente alto + `cycles_completed` farmado o mais rápido possível (com cooldown) nunca atinge L3 em < 60 dias / L4 em < 210 dias + identidade. (Já coberto em parte por `resolve_level_cycles_gate_sev047`.)

---

## 5. Conclusão

O time **fechou os dois achados materiais do passe anterior** (SEV-A reputação-farming e SEV-B earmark de LP) com correções bem desenhadas, e adicionou hardening genuíno (gate de cycles, piso de identidade, teto Kamino, `skip_defaulted_payout`, locks de confirmação). A migração de toolchain foi feita sem introduzir regressões de CPI visíveis.

O passe 2 encontra **1 Medium (SEV-A2)** — uma regressão de liveness onde o cooldown anti-farming, agora no caminho obrigatório de `contribute`, pode bloquear a parcela final de um membro honesto — e **2 Low (SEV-E, SEV-C2)**. Nenhum *critical* explorável de drenagem direta on-chain.

**Recomendação:** **requer correção do SEV-A2 antes de mainnet GA** (é a interseção mais provável de uso real × dano), além da limpeza de deps (SEV-C2) e do endurecimento opcional do SEV-E. A postura geral de segurança do protocolo **melhorou** em relação ao passe anterior.

---

## Anexos

### Anexo A — `pnpm audit` (saída real, atual)

```
vulnerabilities: { info: 0, low: 2, moderate: 6, high: 4, critical: 1 }
critical shell-quote@1.8.3  quote() não escapa newlines   (via react-devtools-core — dev tooling)
high     bigint-buffer       Buffer Overflow via toBigIntLE()
high     serialize-javascript RCE via RegExp.flags / Date.toISOString()
high     ws (x2)             Memory exhaustion DoS from tiny fragments
```

### Anexo B — Comandos executados

```bash
git log --oneline fdf356f..origin/main | wc -l          # 143 commits
git merge origin/main                                    # working tree → c224a7a (= main 180df92 + relatórios)
git diff --stat fdf356f..origin/main -- programs/ crates/
pnpm audit --json                                        # 1 critical / 4 high / 6 mod / 2 low
grep -n "shell-quote" pnpm-lock.yaml                     # via react-devtools-core
```

### Anexo C — Arquivos do delta revisados manualmente

`reputation`: `promote_level.rs`, `attest.rs`, `constants.rs`, `state/profile.rs`, `state/identity_gate.rs`, `state/behavioral_payload.rs`, `instructions/set_identity_gate.rs`, `identity/passport.rs`.
`core`: `contribute.rs`, `claim_payout.rs`, `deposit_idle_to_yield.rs`, `skip_defaulted_payout.rs`, `close_member.rs`, `lock_reputation_program.rs`, `migrate_protocol_config.rs`, `constants.rs`, `escape_valve_buy.rs` (diff).
`yield-kamino`: `lib.rs` (diff — migração + teto de plausibilidade).
