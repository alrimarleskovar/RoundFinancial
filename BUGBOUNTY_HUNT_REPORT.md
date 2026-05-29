# Caça de Bug Bounty (Simulação Interna) — RoundFinancial
**Conduzido por:** Adevar Labs (auto-avaliação interna)
**Modelo:** Simulação de bug bounty live estilo Immunefi (sem envolvimento ou endosso de qualquer plataforma)
**Data:** 2026-05-29
**Commit:** `33b68d51670c6df6533a59ba3b77ab8a062ab263`
**Escopo:** App Web3 Solana / Next.js — signing (Phantom), fundos, autorização, alto payload

> _Simulação interna. NÃO é um programa de bug bounty real nem cobertura de pesquisadores externos. Não substitui um programa público com pesquisadores independentes — apenas reproduz o modo de pensar de um hunter caçando impacto de alto valor._

## Fila de Submissões (resumo)

| ID | Severidade | Asset / Superfície | Título | PoC |
|----|-----------|--------------------|--------|-----|
| — | — | — | **Nenhum finding Critical/High confirmado** | — |

**Resultado da caça: nenhum finding Critical ou High pagável foi confirmado** nas superfícies in-scope examinadas (signing/Phantom, movimento de fundos, autorização, alto payload). Abaixo declaro isso explicitamente, com a evidência do *porquê* cada vetor caçado se mostrou robusto.

Mas **isto não é um "all clear".** Três coisas seguem abaixo, e nenhuma delas é "tudo seguro":
1. **Leads abertos** (não descartados) — vetores que ainda exigem execução/análise para confirmar ou eliminar. Permanecem **em investigação ativa**, não foram fechados.
2. **Achados de defesa em profundidade** — gaps reais de hardening (rate-limit, auth do webhook, single-use SIWS multi-instância). Por regra do programa NÃO são submissões pagáveis (out-of-scope/Med-/Info), mas um hunter honesto reporta porque **reduzem a margem de segurança** das superfícies in-scope.
3. **Solicitação de expansão de escopo** — três módulos que *nós mesmos* identificamos como onde o risco real de mainnet vive, e que estão fora do alcance desta passada.

Conforme o ethos do programa: **não invento findings para preencher** nem inflo severidade. Mas "no findings" só vale para o que foi *de fato* caçado a fundo — e os itens abaixo delimitam exatamente onde essa afirmação **não** se aplica.

---

## Por que cada vetor in-scope fechou em "seguro"

### 1. Signing / Carteira (modais Phantom) — *o que o usuário assina é o que ele pretende?*

Os encoders de transação client-side (`app/src/lib/{contribute,claim-payout,release-escrow,escape-valve-buy,deposit-idle-to-yield,settle-default}.ts`) constroem instruções **IDL-free**, mas **nenhum parâmetro de destino/valor sensível é controlável pelo cliente de forma explorável**:

- **Destinatários e vaults são todos PDAs derivados** do endereço do pool + pubkey da carteira conectada + program IDs pinados (`devnet.ts`). Não há campo "para qual conta enviar" manipulável — ex.: `claim-payout.ts:97-98` deriva `memberUsdc`/`poolUsdcVault` por ATA, não por input.
- **O signatário é sempre a carteira conectada** (`feePayer = args.memberWallet/buyerWallet`), e o programa on-chain reforça `member.wallet == member_wallet.key()`.
- **`escape-valve-buy.ts:185-218`** busca `seller` e `priceUsdc` **da listing on-chain**, não de input do cliente — o comentário em `BuildEscapeValveBuyIxArgs` é literal: *"taken straight from the on-chain listing record so the caller can't accidentally redirect the USDC transfer."* Mesmo um RPC malicioso que mentisse o `seller` causaria *revert* (o programa re-deriva tudo do registro on-chain via constraint `seller_wallet.key() == listing.seller`), não roubo.
- **`SendModal.tsx` é explicitamente um mock** (`sendPayment` só decrementa estado local; sem assinatura Phantom real — comentário em `SendModal.tsx:13-16,224-235`). Não há transação assinável aqui hoje.
- **Replay de assinatura:** cada `send*` usa `getLatestBlockhash` fresco + `lastValidBlockHeight`; o blockhash é a proteção de replay nativa da Solana. O fluxo SIWS admin tem nonce HMAC + TTL + single-use set.

### 2. Fundos / Movimento de valor (programa on-chain `roundfi-core`)

Todas as instruções que movem USDC derivam montantes de campos do pool (não de input arbitrário), usam **aritmética checada** (`checked_add`/`checked_sub`/`saturating_*` + `MathOverflow`), e assinam transferências de saída via **seeds de PDA do pool/escrow/solidarity**:

- `claim_payout.rs` — reserva o earmark GF **+** LP-distribution antes de pagar (`SEV-048`), exige `spendable >= credit_amount`, avança ciclo, marca `paid_out`. Constraints `!defaulted`, `!paid_out`, `slot_index == cycle`.
- `release_escrow.rs` — vesting via crate de math single-source (`compute_release_delta_target`), cap por `escrow_balance` E por disponibilidade do vault, checkpoint monotônico, gate `!defaulted` (cadeia `SEV-016 → SEV-029 → SEV-034`).
- `settle_default.rs` — cascata de seizure (solidarity → escrow → stake) delegada ao crate de math com invariante D/C verificada **pós-seizure**, caps por vault, transição irreversível.
- `contribute.rs` — três transferências autorizadas pela própria carteira do membro, split derivado de `pool.*_bps`, tudo checado.
- `harvest_yield.rs` — `lp_share_bps` agora é **autoritativo do config** e ignora o valor do caller (`SEV-003`); guarda de slippage `min_realized_usdc`; invariante `yield_vault_drop <= realized + 1` contra over-withdraw.
- `deposit_idle_to_yield.rs` — guarda de solvência (GF + LP earmark, `SEV-048`); checks `src_delta <= amount` e `slack == 0`.

### 3. Autorização / Controle de acesso

- **Console admin (`/api/admin/**`):** TODOS os endpoints de dados são **GET (read-only)** e chamam `requireAdmin(req)` como primeira linha (verificado em todos os 13 routes). Não há endpoint admin mutável. O gate vive no endpoint, não na UI.
- **SIWS:** sessão é HMAC-SHA256 sobre `{sub,exp}` (`session.ts`), comparada com `timingSafeEqual`; challenge é HMAC-bound a `(domain,pubkey,nonce,issuedAt)` com TTL de 5min + single-use; verificação ed25519 real via `node:crypto` (`siws.ts`). Allowlist = env operators ∪ `ProtocolConfig.authority` on-chain, **fail-closed** (secret <16 chars → 500; allowlist vazia → console inacessível).
- **IDOR on-chain:** impossível — todo `Member`/`Pool` é PDA selado por seeds (`[member, pool, wallet]`); trocar um id resulta em `ConstraintSeeds`.
- **Reputação:** `attest` exige issuer = `config.authority` **ou** PDA derivada sob `roundfi_core_program` com `args.pool == issuer_key` (`attest.rs:114-127`). Usuário não consegue forjar atestação (não pode assinar como PDA do pool).

### 4. Alto payload (CPIs externos / NFT)

- **Yield adapter tratado como UNTRUSTED:** guarda de program-id em toda chamada (`pool.yield_adapter`), contabilidade por **delta de saldo** (ignora retorno do adapter), e o próprio mock valida `destination == state.vault` / `authority == state.pool` — fechando o vetor "redirecionar deposit para conta do atacante".
- **`escape_valve_buy.rs`** tem **verificação pós-CPI** (re-deserializa o asset e exige `owner == buyer` + `FreezeDelegate.frozen`), re-delegação de plugins pós-TransferV1, e zera campos de identidade do `old_member` (reinit defense). NFT pinado a `old_member.nft_asset`.

---

## Leads Abertos (em investigação ativa — NÃO descartados)

> SEM severidade inflada e SEM declarar "seguro". Cada um é um caminho que **ainda exige execução/auditoria para confirmar OU eliminar**. Listo o que falta para fechar cada um — explicitamente como item aberto, não como finding descartado.

1. **Reputação "self-pool farming" — ABERTO.** `create_pool` é permissionless (`authority: Signer`), e a PDA de qualquer pool é um issuer válido de `attest` (`attest.rs:114-127` + `create_pool.rs:48,61`). Hipótese: um atacante cria o próprio pool, entra nele e farma `SCHEMA_CYCLE_COMPLETE`/`PAYMENT` para subir de nível e baratear `stake_bps` em pools legítimos futuros — amplificando a perda num default posterior, já que `join_pool` confia no `profile.level`.
   **O que falta para confirmar/eliminar:** modelar o custo real (stake + installments + float p/ `claim_payout`) **vs.** o ganho de tier ao longo de N pools, considerando o cooldown de 6 dias (`MIN_CYCLE_COOLDOWN_SECS`) e o Sybil-hint (peso ½ sem identidade). Se o ROI for positivo sob qualquer configuração de `LEVEL_*_THRESHOLD`/`stake_bps`, isto vira candidato a High (movimento não-autorizado material via colateral subdimensionado). **Requer ambiente de execução (lead #SE-1 abaixo).**

2. **Single-use de challenge SIWS é in-memory (`challenge.ts:58`) — ABERTO.** Em deploy multi-instância o set `usedTokens` não é compartilhado → um `challengeToken` válido pode ser apresentado a uma instância que não o consumiu, dentro do TTL de 5min. Hoje o `/verify` ainda exige assinatura ed25519 válida do pubkey allowlistado, então o replay **isolado** não autentica ninguém.
   **O que falta para confirmar/eliminar:** verificar se o roadmap de mainnet escala o admin console para >1 instância (o módulo só afirma que *a canary* roda uma). Se sim, combinar com qualquer vazamento de assinatura SIWS (logs, telemetria, extensão de browser) reabre uma janela de replay de sessão. Tratado também como D-i-D #3 abaixo (a correção independe da confirmação de impacto).

3. **`yield_vault` / `destination` como `UncheckedAccount` em `deposit_idle_to_yield`/`harvest_yield` — ABERTO para adapters não-mock.** O destino não é constraint-checado no core; a segurança depende inteiramente de o adapter validar o próprio vault. O **mock** valida (`destination == state.vault`), e o core exige `slack == 0`.
   **O que falta para confirmar/eliminar:** auditar o wrapper **`roundfi-yield-kamino`** (1169 linhas, fora do escopo desta passada) — se a Kamino-glue não reproduzir a validação de destino do mock, um cranker (qualquer signer; `deposit_idle_to_yield` é permissionless) poderia redirecionar float idle. **NÃO posso afirmar "fechado" para mainnet sem ler esse arquivo.** É a razão #1 do pedido de expansão de escopo (lead #SE-1).

---

## Achados de Defesa em Profundidade (hardening — NÃO são submissões pagáveis)

> **Conformidade com as regras do programa:** rate-limit "sem impacto direto demonstrável" e issues sem caminho de exploração concreto são explicitamente **out-of-scope / não-pagáveis**. Registro estes **sem severidade Critical/High** — são gaps de hardening que estreitam a margem das superfícies in-scope, não submissões. Incluídos por honestidade, não para inflar a fila.

- **D-i-D #1 — Sem rate-limit nos endpoints de auth admin.** `POST /api/admin/auth/nonce` e `POST /api/admin/auth/verify` (`app/src/app/api/admin/auth/*`) emitem challenges e processam tentativas de verificação **sem qualquer throttle**. Brute-force de ed25519 é inviável, então **não há impacto financeiro direto** (por isso NÃO é submissão). Mas a emissão ilimitada de challenges é um vetor de abuso/custo, e a ausência de rate-limit no `/verify` remove a primeira linha contra futuras fraquezas no fluxo. **Rec.:** rate-limit por IP+pubkey nesses dois handlers.

- **D-i-D #2 — Webhook do indexer usa Bearer estático, não HMAC do corpo, com compare não-constant-time.** `services/indexer/src/server.ts:108-131` (fix SEV-009) autentica `/webhook/helius` com `auth !== \`Bearer ${expected}\``. Três pontos: **(a)** comparação de string **não-constant-time** (`!==`) — side-channel de timing teórico sobre o segredo; **(b)** é um **bearer estático sem integridade do corpo** — não há HMAC assinando o payload, então um token capturado/vazado é replayável e um corpo adulterado não é detectado; **(c)** o `server.ts:186-217` **pula a auth** quando `HELIUS_WEBHOOK_SECRET` está unset fora da allowlist de prod — exatamente o resíduo que o SEV-009 tentou matar. Impacto é sobre dados do indexer (read-only downstream), não fundos → **não é submissão**. **Rec.:** trocar por **HMAC-SHA256 do corpo** com `timingSafeEqual` + tornar o segredo obrigatório (fail-closed) em todo ambiente deployado.

- **D-i-D #3 — Single-use de challenge SIWS apenas in-memory (multi-instância).** `challenge.ts:58` mantém `usedTokens` num `Set` de processo. Em >1 instância a garantia de single-use quebra (ver lead aberto #2). **Não-pagável isolado** (ainda exige assinatura do admin), mas a correção é barata e remove a dependência implícita de "rodar 1 instância". **Rec.:** mover o single-use para um store compartilhado (Redis/DB) com TTL = `CHALLENGE_TTL_MS`, ou tornar o challenge intrinsecamente single-use ligando-o a um nonce persistido.

---

## Solicitação de Expansão de Escopo

Esta passada cobriu o que está in-scope hoje (app Next.js + signing + core on-chain). Mas a própria análise apontou três módulos **fora do escopo atual** onde, por construção, mora o maior risco de mainnet. **Solicito formalmente a inclusão dos três no escopo** para uma segunda passada com PoC executável:

| # | Módulo | Por que o risco real vive aqui | Impacto-alvo |
|---|--------|-------------------------------|--------------|
| **SE-1** | `programs/roundfi-yield-kamino/src/lib.rs` (1169 ln) | Maior superfície de CPI externo do protocolo; é o adapter que **realmente** roda em mainnet (o mock auditado aqui não). O lead aberto #3 só pode ser fechado lendo este arquivo: se a glue não validar o vault de destino como o mock faz, `deposit_idle_to_yield` (permissionless) pode redirecionar float idle. | Drenagem de principal / movimento não-autorizado de fundos |
| **SE-2** | `services/orchestrator/*` | Detém (potencialmente) a chave do deployer que faz top-up de pools e roda cranks. Custódia mal-configurada ou uma instrução de top-up sem checagem = alvo direto de fundos do protocolo. Zero cobertura nesta passada. | Comprometimento de custódia / perda de fundos do protocolo |
| **SE-3** | `services/indexer/*` | É o SSOT que alimenta o console admin e (futuramente) decisões on/off-chain. Além do D-i-D #2 (auth do webhook), a resolução de FK via reconciler e o pipeline de ingestão podem ser envenenados por eventos forjados se a auth do webhook cair. | Integridade de dados / envenenamento de estado downstream |

Sem esses três no escopo, a afirmação "no Critical/High" vale **apenas** para o app + core já endurecidos — **não** para o que efetivamente custodia e movimenta valor em produção.

---

## Nota de Cobertura (honestidade sobre pontos cegos)

Um único caçador simulado, com tempo limitado e **sem ambiente de execução on-chain** (sem deploy/fork/estado real), não reproduz a diversidade nem a persistência de dezenas de hunters reais. O que **NÃO** foi caçado a fundo:

- **`programs/roundfi-yield-kamino/src/lib.rs` (1169 linhas)** — o maior componente e o de maior superfície de CPI externo (Kamino). Marcado out-of-execution-scope nos comentários do mock ("Step 5c"), mas é exatamente onde um adapter de mainnet introduz risco real de drenagem de principal. **Recomendação: priorizar este arquivo num programa real.**
- **`crates/math/*`** — toda a lógica financeira foi tratada como "fonte única confiável" via os comentários; não re-derivei manualmente as provas de `waterfall`, `seize_for_default`, `escrow_vesting` nem fiz fuzzing das fronteiras. Os testes existentes (incl. sweep de ~13.500 combinações) cobrem isso, mas um hunter de math-heavy protocols olharia overflow/rounding nas bordas.
- **`services/orchestrator` e `services/indexer`** — não auditados; um orchestrator com chave de deployer que faz top-up de pools é um alvo de custódia se mal-configurado.
- **Nenhum PoC foi EXECUTADO** — não havia validator/deploy disponível. Todas as conclusões acima são por **análise estática do caminho de exploração**; nenhuma alega ter drenado/explorado algo.
- O código carrega uma trilha densa de fixes prévios (`SEV-003` … `SEV-048`, oráculos de layout de conta, post-CPI checks), o que reduz — mas não elimina — a probabilidade de um Critical/High remanescente nas superfícies *já* endurecidas. O sinal de maior valor para um programa real é olhar o que ainda **não** passou por esse moinho: o adapter Kamino e os serviços off-chain.

---

_Para cobertura de verdade no signing e nos CPIs de mainnet, um programa de bug bounty público com pesquisadores independentes continua necessário. Esta simulação não o substitui._
