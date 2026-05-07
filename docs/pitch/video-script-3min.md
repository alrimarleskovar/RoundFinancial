# RoundFi · 3-min Demo Video — Roteiro Completo

> Para a submissão do **Colosseum Hackathon 2026**. Duração-alvo: **2:50–3:00**.
> Tom: confiante, declarativo, técnico-mas-acessível. Português-BR (versão EN
> opcional na seção §6).

---

## Resumo executivo

| | |
|---|---|
| **Hook** | "Este é o RoundFi rodando ao vivo na Solana devnet. Todo número na tela vem on-chain." |
| **Tese** | ROSCA on-chain como **engine de aquisição** para um score comportamental B2B (Serasa of Web3) |
| **Prova** | Vídeo mostra dois txs reais (pay + receive) assinados pelo Phantom, mais settle_default capturando a Triple Shield em ação |
| **CTA** | github.com/alrimarleskovar/RoundFinancial · live demo em roundfinancial.vercel.app |

---

## §1 · Pré-flight (faça ANTES de gravar)

### Setup de browser

- **Tab 1**: `http://localhost:3000/home` (com Phantom conectado em devnet)
- **Tab 2**: `http://localhost:3000/admin` (Demo Studio com preset "Maria Vitoriosa" pronto)
- **Tab 3**: `http://localhost:3000/lab` (Stress Lab com preset "Triplo Calote")
- **Tab 4**: Solscan tab pré-aberta — `https://solscan.io/account/D9PS7QDGUsAwHa4T6Gibw6HV9Lx2sbB5aZM5GsNzpDE5?cluster=devnet` (Pool 3)
- **Tab 5**: Solscan tx do settle_default — `https://solscan.io/tx/34UyAtEPH5iWXrzhMGLRJVYzt2Z314f4S9DbwmfXA8bfS3SKahgEYkTgFz6KGuX441ktPVVnEvLk19fuVAkNeJeG?cluster=devnet`
- **Tab 6**: README do repo no GitHub

### Setup de wallet (Phantom)

- Conecta a member-3 (`DC5Dcf7j…`) no `/home` antes de começar — esse é o wallet que dá o **PROGRESSO + TRIPLE SHIELD** sections renderizando bonito (chain mode)
- Ou alternativa: aplica preset Maria no Demo Studio ANTES de gravar pra ter modo demo ativo

### Setup de gravação

- Resolução: 1920×1080
- FPS: 30 ou 60
- Áudio: gravação separada (narração via mic decente, depois sincroniza)
- Software: OBS (free) ou Loom Pro

---

## §2 · Roteiro cena-a-cena (3min total)

### Cena 1 — HOOK (0:00–0:12, 12s)

**Tela**: `/home` aberto, Phantom conectada (member-3), FeaturedGroup mostrando "Pool 3 · 3/3 members · $30 credit (devnet)" com label verde **ON-CHAIN · DEVNET**, dial girando, ROSTER com 3 chips.

**Narração**:
> "Este é o RoundFi rodando ao vivo na Solana devnet.
> Todo número que você vê — o ciclo, os membros, o valor — vem direto on-chain.
> Sem mock. Sem placeholder. Solscan na próxima aba confirma."

**Movimento**: zoom suave no card FeaturedGroup, hover no chip ROSTER, mostra que cada membro é um wallet real.

---

### Cena 2 — A TESE (0:12–0:35, 23s)

**Tela**: corte rápido pra landing `/` → tabela comparativa (Aave / RociFi / WeTrust / RoundFi) em destaque. Volta pra /home.

**Narração**:
> "DeFi resolveu trading. Resolveu liquidez.
> **Não resolveu crédito.**
> WeTrust e RociFi tentaram — fecharam.
> A diferença? RoundFi trata as ROSCAs como **engine de aquisição de dados**.
> Cada parcela paga gera uma atestação on-chain — SAS-compatible — que vira identidade de crédito portável.
> A ROSCA é a isca. **O score é o produto.**
> Endgame: oracle B2B que neobancos e protocolos DeFi consomem antes de emprestar.
> O Serasa do Web3."

**B-roll insertion**: durante "DeFi não resolveu crédito" cortar pra a tabela comparativa do landing por 2-3 segundos.

---

### Cena 3 — DEMO LIVE: PAGAR (0:35–1:15, 40s)

**Tela**: `/home` FeaturedGroup. Aponta o cursor pro botão verde **"Pagar parcela"**.

**Narração**:
> "Vamos pagar uma parcela ao vivo.
> Member-3 conectada no Phantom. Pool 3, ciclo 1.
> Click em Pagar parcela."

**Ação**:
1. Click "Pagar parcela" → modal abre
2. Camera para no banner verde **"ON-CHAIN"** que diz "Wallet conectada (slot 0 · DC5D…) é membro do Pool 3. Confirmar dispara contribute(cycle=1) no devnet."

**Narração**:
> "O modal detectou que minha wallet é um membro real do pool.
> O encoder IDL-free constrói a transação de 18 contas — discriminator hardcoded, cada conta na ordem exata do programa.
> Nenhum SDK Anchor no browser. Direto na bytes."

**Ação**:
3. Click "Confirmar" → Phantom popa
4. Camera no Phantom popup mostrando os 18 accounts + fee
5. Click Confirm → spinner → success card aparece com tx hash + link Solscan

**Narração** (durante o sign):
> "Phantom assina. Transação vai pro devnet. Pool 3 atualiza."

**Ação**:
6. Click no link "on-chain tx · 37FZUtg7…wg6f" → abre Solscan na nova tab
7. Solscan mostra "Status: Success" + program logs

**Narração**:
> "Tx confirmada. Member-3 USDC: 45 → 35.
> O programa registrou contribute LATE, gravou uma atestação SAS no profile.
> Tudo verificável."

---

### Cena 4 — DEMO LIVE: RECEBER (1:15–1:55, 40s)

**Tela**: volta pro /home. Phantom switch pra **member-4** (slot 1 contemplado do cycle 1).

**Narração**:
> "Agora a outra metade do ciclo.
> Member-4 é o slot contemplado deste cycle.
> O front-end detectou — apareceu o botão roxo Receber R$ 165."

**Ação**:
1. Hover no botão **"Receber R$ 165"** roxo-teal
2. Click → ClaimPayoutModal abre
3. Câmera pausa no novo bloco **"PROGRESSO DE PAGAMENTO"**:
   - "Pago até agora: 0/3 parcelas"
   - "Restam pós-sorteio: 3 × R$ 55 = R$ 165"
4. Camera no bloco **"TRIPLE SHIELD · GARANTIA BLOQUEADA"**:
   - "Stake (Lv1): R$ 82 · Escrow acumulado: R$ 0 · Total colateral: R$ 82"

**Narração**:
> "O modal explica a regra do protocolo.
> Crédito é **antecipado** — recebe o valor inteiro agora, paga as parcelas restantes depois.
> Independe de level (level afeta só o stake de entrada).
> A Triple Shield bloqueia o stake + escrow como garantia da dívida remanescente.
> Se parar de pagar, settle_default aciona o waterfall."

**Ação**:
5. Click Confirmar → Phantom popa → assina → success card "Crédito recebido!"
6. Click no tx hash `LKickMQ1…SEv7Ym` → Solscan novo

**Narração**:
> "Recebido. Member-4 USDC: 35 → 65.
> Pool current_cycle avançou 1 → 2.
> SCHEMA_CYCLE_COMPLETE atestação gravada no reputation profile.
> Loop fechado."

---

### Cena 5 — TRIPLE SHIELD (1:55–2:25, 30s)

**Tela**: corte pra Solscan tab com a tx do `settle_default` (`34UyAtEP…`). Camera nos program logs.

**Narração**:
> "E quando alguém para de pagar?
> Pool 3 capturou isso ao vivo. Member-5 não pagou cycle 1.
> Depois do grace period — 60 segundos no devnet, 7 dias em produção — `settle_default` disparou."

**Ação**: scrolla nos program logs do Solscan, foca no `msg!()` que mostra:

```
roundfi-core: settle_default cycle=1
  seized_total = 200_000   (= $0.20)
  solidarity   = 200_000   (drained)
  escrow       = 0         (intact)
  stake        = 0         (intact)
  d_rem = c_init = c_after = 30_000_000
```

**Narração**:
> "A Triple Shield drenou os 20 centavos da solidarity vault.
> Parou aí. Não tocou no escrow nem no stake.
> Por quê? O invariante D/C — a dívida remanescente não excedia o colateral.
> O programa **escolheu** não seizar mais do que o necessário.
> Solvência matemática. Não promessa."

**B-roll opcional**: rapidamente corta pra `/lab` mostrando o L1 simulator com mesmo cenário, depois volta pro Solscan. Prova: simulação L1 == programa L2.

---

### Cena 6 — PHASE 3 (2:25–2:45, 20s)

**Tela**: corte pra `/reputacao` mostrando o passport SAS, então pra um diagrama (slide ou direto na pitch deck) do B2B oracle.

**Narração**:
> "Cada parcela paga, cada cycle completo, cada default.
> 16 atestações SAS-compatible já on-chain.
> No produto final, neobancos e protocolos DeFi assinam um endpoint:
> `GET /b2b/score?wallet=…` — score comportamental por chamada.
> Esse é o modelo de receita.
> A ROSCA financia. O dado paga as contas."

---

### Cena 7 — NÚMEROS + CTA (2:45–3:00, 15s)

**Tela**: README do repo no GitHub, foca no badge "Devnet · 3 pools + settle_default" + tabela §10.

**Narração**:
> "131 PRs merged. 3 pools deployados. 18 instruções exercitadas on-chain.
> 10 workarounds Solana 3.x. 4 Triple Shield captures ao vivo.
> 1 bug do mpl-core descoberto e fixado em flight.
> Construído para o Colosseum 2026.
> Repo, live demo, deck — tudo no link da descrição."

**Card final** (5s, fade out): logo RoundFi + 3 links em texto:
- `github.com/alrimarleskovar/RoundFinancial`
- `roundfinancial.vercel.app`
- `colosseum.com/projects/roundfi` (ou link real da submissão)

---

## §3 · Ordem de gravação (B-roll)

A ordem do **roteiro acima** é a ordem de **edição final**. A ordem ÓTIMA pra **gravar** é diferente — agrupa por contexto pra economizar setup:

### Take 1 — Tela /home + interações (40min)

1. Phantom conectada com member-3, /home fresh
2. Grava cena 1 (hook) — múltiplos takes da dial girando + ROSTER
3. Grava cena 3 completa (Pagar) — click → modal → Phantom → success
4. **Não troque de wallet ainda** — captura o estado pós-pagamento (dial 1→2)

### Take 2 — Trocar pra member-4, repetir o claim (30min)

5. Disconnect → Connect com member-4
6. Grava cena 4 completa (Receber) — botão → modal com Progress + Shield → Phantom → success
7. Captura o post-state (member-4 com novo balance)

### Take 3 — Solscan beats (15min)

8. Cena 5: Solscan settle_default tx, foca nos program logs
9. Cena 3 e 4 contam com cortes rápidos pro Solscan dos respectivos txs (pode gravar separado)

### Take 4 — Demo Studio + Lab (20min)

10. Aplica preset Maria → /home → grava o caminho mock como BACKUP (caso queira mostrar o modal mock no lugar do chain)
11. Cena 6 / Phase 3: /reputacao + qualquer diagrama do oracle

### Take 5 — Landing + README (15min)

12. Cena 2: scroll no landing pra mostrar tabela comparativa
13. Cena 7: README scroll + close-up no badge "3 pools + settle_default"

### Take 6 — Narração (40min)

14. Grava todo o áudio em um take limpo, em ambiente silencioso
15. Use script § acima como teleprompter — dá pra escrever colado na webcam

### Take 7 — Edição (90min)

16. Junta áudio + vídeo nas marcações de timing acima
17. Adiciona cards finais
18. Music bed: algo eletrônico discreto (ex: lo-fi ou ambient da YouTube Audio Library)
19. Export 1080p H.264

**Total estimado: ~3.5h de gravação + 1.5h de edição = 5h.**

---

## §4 · Texto de submissão (Colosseum form)

### Title (max 60 chars)

> **RoundFi — Behavioral-credit infrastructure for Solana**

### Tagline (max 120 chars)

> ROSCAs on Solana that mint a portable SAS-compatible credit score. The Serasa of Web3 — built for emerging-market retail.

### Description (1500-2000 chars)

> RoundFi is a behavioral-credit primitive disguised as a savings protocol. It runs on-chain ROSCAs (rotating savings circles) as a data-acquisition engine: every paid installment mints an SAS-compatible attestation, and the resulting score becomes a portable credit identity neobanks and DeFi protocols can subscribe to via a B2B oracle.
>
> **What's live on devnet (M3 milestone):** 3 pools deployed, 18 instructions exercised end-to-end, 16 reputation attestations on-chain, 4 Triple Shield guards captured firing on real funds (`WaterfallUnderflow` ×2, `EscrowLocked`, **shield-1-only seizure**). The full ROSCA cycle is browser-signed: pay (`contribute()`, tx `37FZUtg7…wg6f`) and receive (`claim_payout()`, tx `LKickMQ1…SEv7Ym`). The Triple Shield's settle_default fired live on Pool 3, drained $0.20 from solidarity, left escrow + stake intact thanks to the D/C invariant — captured in tx `34UyAtEP…NeJeG`.
>
> **What's structural, not feature-list:**
> - **Phase 3 from day 1.** Phase 1 (ROSCAs) is explicitly the data-acquisition engine for Phase 3 (per-call B2B oracle). WeTrust's protocol *was* the product; when retention slipped there was nothing left to sell. We sell the data layer.
> - **SAS-compatible from the first attestation.** Every payment mints to the Solana Attestation Service schema — score reads from any wallet, any protocol. RociFi's NFT score died with RociFi.
> - **Solvency is mathematical.** Triple Shield gives a 91.6% Month-1 retention floor as a deterministic property of the contract — encoded in `programs/roundfi-core/src/math/waterfall.rs`, parity-tested against the Stress Lab L1 simulator.
>
> **Beyond the demo:** front-end dashboard live on Vercel; IDL-free encoders for browser-signed write paths (anchor IDL gen blocked on Rust 1.95+, we replicate the offsets byte-for-byte); Helius webhook + Postgres indexer scaffold for Phase 3 already shipped; 10 Solana 3.x Box stack-overflow workarounds captured in commits.

### Tech stack (tag list)

`Solana` `Rust` `Anchor` `Metaplex Core` `SAS` `Next.js` `TypeScript` `Phantom Wallet Adapter` `Helius` `Prisma` `Postgres`

### Links

- **Repo**: https://github.com/alrimarleskovar/RoundFinancial
- **Live demo**: https://roundfinancial.vercel.app
- **Pitch deck (EN)**: https://github.com/alrimarleskovar/RoundFinancial/blob/main/docs/pitch/pitch-deck-en.html
- **Devnet evidence**: https://github.com/alrimarleskovar/RoundFinancial/blob/main/docs/devnet-deployment.md
- **Demo video**: _(YouTube link após upload)_

---

## §5 · Fallbacks de gravação

Se algo der errado durante o live demo:

| Falha | Fallback |
|---|---|
| Phantom não popa | Mostra a tx pré-gravada no Solscan + comenta o flow |
| Tx falha (RPC down) | Pula pra cena 5 (Solscan settle_default) e usa essa como prova de write path real |
| Localhost crasha | Vercel está sempre live — mesmo URL, mesma UI |
| Esqueceu a fala | O texto na descrição cobre o pitch — só fala "veja repo" |

**Plan B do hook**: se o /home não tem a wallet conectada na hora de gravar, abre o admin e aplica preset Maria — modo demo já dá o "Receber" colorido pra mostrar.

---

## §6 · Versão EN (narração alternativa)

Se quiser gravar uma versão em inglês pro alcance global, esse é o equivalente cena-a-cena:

### Cena 1 — Hook
> "This is RoundFi running live on Solana devnet. Every number you see — the cycle, the members, the credit — comes from on-chain. No mock. No placeholder."

### Cena 2 — Thesis
> "DeFi solved trading. DeFi solved liquidity. DeFi never solved credit. WeTrust and RociFi tried — both shut down. Our difference? We treat ROSCAs as a data-acquisition engine. Every paid installment mints an SAS-compatible attestation that becomes a portable credit identity. The ROSCA is the bait. The score is the product. Endgame: a B2B oracle neobanks and DeFi protocols subscribe to before lending. The Serasa of Web3."

### Cena 3 — Pay live
> "Let's pay an installment live. Member-3 connected via Phantom. Pool 3, cycle 1. Click Pagar parcela. The modal detected the wallet is a real member of the pool. The IDL-free encoder builds the 18-account transaction — hardcoded discriminator, exact account ordering. No Anchor SDK in the browser. Straight to bytes. Phantom signs. Tx lands. Solscan confirms. Member-3 USDC: 45 → 35. The program logged contribute LATE, wrote a SAS attestation. All verifiable."

### Cena 4 — Receive live
> "Now the other half of the cycle. Member-4 is the contemplated slot for cycle 1. Front-end detected it — the purple Receber R$ 165 button appeared. Click. The modal explains the protocol rule. Credit is anticipated — you receive the full amount now, you pay the remaining installments later. Independent of level. The Triple Shield locks stake plus escrow as collateral against the remaining debt. If you stop paying, settle_default fires the waterfall. Sign. Tx lands. Member-4 USDC: 35 → 65. Pool current_cycle 1 → 2. Loop closed."

### Cena 5 — Triple Shield
> "What happens when someone stops paying? Pool 3 captured this live. Member-5 didn't pay cycle 1. After the grace period — 60 seconds on devnet, 7 days in production — settle_default fired. The Triple Shield drained 20 cents from the solidarity vault. Stopped there. Didn't touch escrow or stake. Why? The D/C invariant — the remaining debt didn't exceed the collateral. The program chose not to seize more than necessary. Mathematical solvency. Not a promise."

### Cena 6 — Phase 3
> "Every paid installment, every completed cycle, every default. 16 attestations SAS-compatible already on-chain. In production, neobanks and DeFi protocols subscribe to an endpoint: GET /b2b/score?wallet=… — behavioral score per call. That's the revenue model. The ROSCA funds. The data pays the bills."

### Cena 7 — Numbers + CTA
> "131 PRs merged. 3 pools deployed. 18 on-chain instructions. 10 Solana 3.x workarounds. 4 Triple Shield captures live. 1 mpl-core bug discovered and fixed in flight. Built for Colosseum 2026. Repo, live demo, deck — all in the description."

---

## §7 · Checklist final antes de subir

- [ ] Vídeo exportado em 1080p H.264, stereo audio
- [ ] Duração entre 2:50 e 3:10
- [ ] Sem cortes onde Phantom mostra a wallet privada (nunca)
- [ ] Solscan tabs com `?cluster=devnet` (não mainnet por engano)
- [ ] Música em volume baixo (-20dB ou menos vs narração)
- [ ] Closed captions / legendas (acessibilidade + alguns clusters Colosseum reviewers tem audio off)
- [ ] Upload YouTube como **unlisted** primeiro pra preview, depois **public** pra Colosseum
- [ ] README + Colosseum form populados com link do vídeo
- [ ] Tweet/post no X anunciando: "RoundFi · Colosseum 2026 · YouTube link · GitHub link"
