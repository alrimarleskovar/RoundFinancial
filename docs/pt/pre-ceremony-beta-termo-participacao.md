# Termo de Participação — Pre-Ceremony Beta

**Documento para tester ler e aceitar antes de entrar no beta.**
**Versão:** 1.0
**Data:** 2026-05-21

Este termo descreve o que é o **Pre-Ceremony Beta** do RoundFi, o que você está aceitando ao participar, e o que você pode esperar (e não esperar). **Leia tudo antes de aceitar.**

---

## 1. O que é o Pre-Ceremony Beta

O RoundFi é um protocolo de poupança em grupo construído em Solana. Antes de abrirmos pro público, vamos testar o protocolo com um grupo pequeno e selecionado de pessoas — você é uma delas.

O beta acontece em **duas fases**:

- **Fase 0 — Genesis Canary:** 10 testers, ~20 dias, pagamentos a cada 48h
- **Fase 1 — Pre-Ceremony Semanal:** 10 testers (3 da Fase 0 + 7 novos), ~70 dias, pagamentos semanais

Você pode estar entrando em uma ou nas duas, dependendo de quando recebeu o convite.

---

## 2. Onde isso acontece — devnet

**Todo o beta acontece em devnet** (rede de teste da Solana), não em mainnet (rede de produção).

O que isso significa, em termos simples:

- O USDC que você vai usar **não vale dinheiro real**. É uma moeda de teste mintada pelo time pra você.
- **Você não pode perder dinheiro real participando do beta.**
- Você também **não pode ganhar dinheiro real**. O payout que você receber é em USDC devnet, simbólico.

Se isso é frustrante (você queria testar com dinheiro real), entendemos — mas o objetivo deste beta não é ganho financeiro. É descobrir bugs e validar a experiência antes de mainnet.

---

## 3. O que você vai fazer durante o beta

Como tester, você vai:

1. **Receber uma carteira** com USDC devnet pra participar (ou usar a sua, com USDC que vamos te dar via faucet/mint).
2. **Pagar uma parcela** a cada ciclo (48h na Fase 0, 7 dias na Fase 1).
3. **Receber seu payout** quando chegar a vez do seu slot.
4. **Reportar bugs e dúvidas** no canal dedicado (Discord/Telegram).
5. **Responder pesquisa qualitativa** pós-fase (~10 min).

Carga de tempo estimada: 5-15 minutos por ciclo. Total no Canary: ~3h. Total na Semanal: ~3h.

---

## 4. O que você está aceitando

Ao entrar, você confirma que entende:

### 4.1 Risco operacional real (sem risco financeiro)

- O protocolo pode ter bugs. É exatamente isso que estamos tentando descobrir.
- Se aparecer um bug grave, **podemos pausar o pool ou abortar a fase** sem aviso prévio (mas comunicamos em ≤24h o que aconteceu).
- Seu USDC devnet **pode ser refundado** se uma fase for abortada. Não há dano financeiro porque é dinheiro de teste.

### 4.2 Reputação on-chain

- Suas ações no beta (pagamentos em dia, atrasos, defaults) geram **pontos de reputação on-chain (XP)** que ficam registrados.
- Esses pontos terão valor quando o protocolo for pra mainnet — bons testers começam o mainnet com vantagem.
- **Você pode dar default** (não pagar uma parcela). Não tem multa em dinheiro real, mas você perde 500 XP e isso fica visível.

### 4.3 Comunicação pública (só Fase 1)

Durante a **Fase 1**, vamos fazer posts públicos quinzenais sobre o progresso do beta:

- **Posts mencionam testers de forma agregada** (ex: "8 de 10 pagaram em dia esta semana")
- **Posts podem mencionar testers individualmente** se você autorizar
- Você tem **3 opções:**
  - Aparecer pelo nome (default se você não escolher)
  - Aparecer anônimo (ex: "Tester A")
  - Opt-out completo (não aparece em nenhum post)

Marque sua escolha no formulário de inscrição. Pode mudar a qualquer momento.

**Na Fase 0 (Canary), não há posts públicos.** Tudo silencioso até a Fase 1 começar.

### 4.4 Dados coletados

Coletamos:

- Pagamentos on-chain (pubkey, valor, timestamp) — público por natureza da blockchain
- Mensagens no canal dedicado (pra entender dinâmica social) — internas, não republicadas
- Pesquisa qualitativa pós-fase — agregadas em relatório

Não coletamos: dados pessoais offline (CPF, endereço, etc). O termo é assinado **com a wallet**, não com identidade civil.

### 4.5 Direito de saída

Você pode sair do beta a qualquer momento:

- Se sair antes do seu slot receber payout: o stake fica no pool e é redistribuído aos demais. Você perde a oportunidade do payout deste pool.
- Se sair depois de receber payout mas antes de completar o pool: isso é tratado como default voluntário (-500 XP).
- Se quer sair sem prejuízo de XP: avise no canal dedicado **antes do próximo ciclo** com motivo, e a gente avalia caso a caso.

---

## 5. O que esperar do time RoundFi

- **Suporte ativo no canal dedicado** — primary on-call: Yvina (CEO).
- **Resposta em ≤24h** pra dúvidas durante horário comercial.
- **Comunicação honesta** sobre bugs e problemas. Sem esconder.
- **Refund de stake** se fase for abortada por bug nosso.
- **Reconhecimento explícito** dos primeiros testers no lançamento mainnet (com seu consentimento).

---

## 6. O que NÃO esperar

Sendo honesto pra evitar desencontro:

- **Não esperar retorno financeiro.** É devnet.
- **Não esperar 100% de uptime.** Vai haver pausas, redeploys, fix mid-fase.
- **Não esperar tudo ser intuitivo.** O beta existe pra achar o que NÃO é intuitivo. Reporte tudo que estranhar.
- **Não esperar que seu XP do beta = vantagem garantida em mainnet.** Vai dar vantagem, mas a engenharia da transição ainda está sendo desenhada (ver ADR de migração on-chain do referral, pendente).

---

## 7. Confidencialidade

Você **pode**:
- Falar publicamente que está participando do beta
- Postar screenshots da UI
- Discutir sua experiência

Você **não deve**:
- Compartilhar detalhes técnicos não-públicos do protocolo (smart contract internals, scripts internos, etc) durante o beta — espera o write-up oficial pós-fase
- Divulgar bugs publicamente antes do time corrigir e comunicar (responsible disclosure)

Se tiver dúvida do que é "público" vs "interno", pergunta no canal dedicado.

---

## 8. Aceite

Marcando o checkbox de inscrição (ou respondendo "aceito" no canal de onboarding), você confirma que:

- [ ] Leu este termo até o final
- [ ] Entende que é experimento em devnet, sem dinheiro real
- [ ] Entende as 3 opções de comunicação pública na Fase 1
- [ ] Aceita o direito de o time pausar/abortar fase em caso de bug ≥ Medium
- [ ] Aceita que dados de wallet são públicos por natureza da blockchain
- [ ] Aceita as regras de confidencialidade da §7

---

## 9. Contato

- Canal dedicado: [Discord/Telegram link — preencher antes de circular]
- DM direto: @yvina (primary on-call)
- E-mail: contact@roundfi.io (resposta ≤72h)

---

**Versão deste termo:** 1.0 — 2026-05-21
**Próximas versões serão comunicadas no canal dedicado com antecedência mínima de 7d.**
