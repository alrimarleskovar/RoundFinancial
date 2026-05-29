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

**Resultado da caça: nenhum finding Critical ou High pagável foi confirmado** nas superfícies in-scope examinadas (signing/Phantom, movimento de fundos, autorização, alto payload). Abaixo declaro isso explicitamente, com a evidência do *porquê* cada vetor caçado fechou em "seguro", e listo os leads que cheiraram a bug mas não fecharam em PoC de High+.

Conforme o ethos do programa: **não invento findings para preencher.** "Nenhum finding pagável encontrado nas superfícies X, Y, Z" é um resultado honesto e útil — especialmente num código com trilha de auditoria já densa.

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

## Leads Não-Confirmados (não são submissões — investigação futura)

> SEM severidade inflada. Cada um cheirou a bug mas **não fechou em PoC de High+** por uma razão concreta.

1. **Reputação "self-pool farming".** `create_pool` é permissionless (`authority: Signer`), e a PDA de qualquer pool é um issuer válido de `attest`. Em tese um atacante cria o próprio pool, entra nele e farma `SCHEMA_CYCLE_COMPLETE`/`PAYMENT` para subir de nível e baratear `stake_bps` em pools futuros. **Por que não fechou em High:** exige mover USDC real pelo próprio pool (stake + installments + float p/ `claim_payout`), está sujeito ao cooldown de 6 dias por subject (`MIN_CYCLE_COOLDOWN_SECS`) e ao Sybil-hint (peso ½ sem identidade verificada). É anti-gaming econômico conhecido, não perda direta de fundos. Caminho de exploração + quantificação de custo/benefício não confirmado.

2. **Single-use de challenge SIWS é in-memory (`challenge.ts:58`).** Em deploy multi-instância, o set `usedTokens` não é compartilhado → um challengeToken válido poderia ser "reusado" numa instância diferente dentro do TTL de 5min. **Por que não fechou em High:** o `/verify` ainda exige uma **assinatura ed25519 válida do pubkey allowlistado** sobre a mensagem; sem a chave privada do admin não há sessão. O replay sozinho não autentica ninguém. O próprio módulo documenta que a canary roda uma instância. Sem impacto financeiro demonstrável.

3. **`yield_vault` / `destination` como `UncheckedAccount` em `deposit_idle_to_yield`/`harvest_yield`.** O destino não é constraint-checado no core. **Por que não fechou:** a defesa está em camadas — o adapter valida `destination == state.vault` (mock) e o core exige `slack == 0` (delta src = delta dst). Para a Kamino seria necessário auditar o wrapper `roundfi-yield-kamino` (ver Nota de Cobertura) antes de afirmar qualquer coisa; no adapter atual o vetor está fechado.

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
