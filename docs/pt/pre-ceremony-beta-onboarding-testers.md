# Bem-vindo ao Pre-Ceremony Beta — Guia do Tester

**Pra você que acabou de receber o convite.** Tempo de leitura: ~10 min.

---

## 1. O que é o RoundFi (1 parágrafo)

RoundFi é um protocolo de **poupança em grupo** em Solana. A ideia é simples: 10 pessoas se juntam, cada uma deposita o mesmo valor por X ciclos, e em cada ciclo uma das pessoas recebe o pool completo. Todo mundo recebe o equivalente ao que pôs — não é loteria, é ROSCA (Rotating Savings and Credit Association), só que on-chain, com mecânicas extras de stake e reputação.

---

## 2. O que é este beta (3 frases)

Antes de abrir pro público, estamos rodando o protocolo com **10 testers selecionados** em **devnet** (rede de teste — USDC mintado, não tem valor real). O objetivo é **achar bugs e validar UX**, não ganhar dinheiro. Você foi convidado porque confiamos no seu feedback honesto.

---

## 3. Como funciona um pool — em uma frase

> Você paga X USDC por ciclo durante Y ciclos. Em algum ciclo (sorteado pela sua ordem de entrada), você recebe todo o pool de uma vez. No fim, você pagou o equivalente ao que recebeu — mas teve acesso ao capital antes ou depois, dependendo do seu slot.

---

## 4. As duas fases do beta

### Fase 0 — Genesis Canary

| | |
|---|---|
| Quanto você paga por ciclo | **10 USDC** (devnet) |
| Cada ciclo dura | **48 horas** |
| Quantos ciclos | **10** |
| Quanto tempo total | ~20 dias |
| O que você recebe quando chegar sua vez | 100 USDC (devnet) |

**Cadência:** pagamento a cada 2 dias. É rápido — quase um "stress test" do seu hábito. Se você esquecer, tem 24h de tolerância antes do default.

### Fase 1 — Pre-Ceremony Semanal

| | |
|---|---|
| Quanto você paga por ciclo | **50 USDC** (devnet) |
| Cada ciclo dura | **7 dias** |
| Quantos ciclos | **10** |
| Quanto tempo total | ~70 dias |
| O que você recebe quando chegar sua vez | 500 USDC (devnet) |

**Cadência:** pagamento semanal. Mais próximo do que será em mainnet.

---

## 5. Seu fluxo durante o beta — passo a passo

### Antes de começar

1. **Receber link de onboarding** — vai chegar via DM ou e-mail.
2. **Conectar sua wallet** — Phantom, Solflare, ou qualquer wallet Solana com suporte a devnet.
3. **Receber USDC devnet** — o time vai mintar e enviar pra você (instrução virá no canal dedicado).
4. **Ler e aceitar o termo de participação** — em `docs/pt/pre-ceremony-beta-termo-participacao.md`.
5. **Escolher sua preferência de privacidade** (só relevante na Fase 1):
   - Aparecer pelo nome nos posts públicos
   - Aparecer como "Tester A" (anônimo)
   - Opt-out completo (não aparece)

### Durante cada ciclo

1. **Notificação** (push ou no canal) avisa que ciclo começou.
2. **Você abre o app**, vai em "Meu Pool", e clica em "Pagar parcela".
3. **Assina a transação** na sua wallet. ~2 segundos.
4. **Confirmação** aparece no app + canal.

Se for o seu ciclo de receber payout:

1. **Notificação** avisa que você é o slot deste ciclo.
2. **Você abre o app**, vai em "Meu Pool", e clica em "Receber payout".
3. **Assina a transação**. USDC devnet chega na sua wallet.

### Quando algo dá errado

- **Não consigo pagar (erro na transação):** screenshot + post no canal. Time responde em ≤24h.
- **App está lento ou estranho:** print + descrição. Issue triada no GitHub.
- **Bug suspeito:** descrição detalhada + steps to reproduce. Se for grave (algo "errado" no protocolo), DM direto pra @yvina ou @gabriel.

---

## 6. Linha do tempo do seu participação

```
Dia 1     │ Você recebe link de onboarding + termo
Dia 1-3   │ Conecta wallet, recebe USDC, aceita termo
Dia 3     │ Pool forma com 10 pessoas (você entre elas)
Dia 3     │ Ciclo 1 começa
Dia 5     │ Ciclo 2 começa (você paga 10 USDC novamente)
Dia 7     │ Ciclo 3 começa
   …      │ … e assim sucessivamente
Dia 23    │ Ciclo 10 termina. Pool encerra.
Dia 23-30 │ Você responde pesquisa qualitativa (~10 min)
```

A linha do tempo acima é pra Canary. Pra Semanal, é a mesma estrutura mas com ciclos de 7d em vez de 48h.

---

## 7. O que você ganha

**Material:** USDC devnet (sem valor real).

**Real:**

- **XP on-chain** registrado na sua wallet. Quando o RoundFi for pra mainnet, esse XP vira reputação real.
- **Vantagem inicial em mainnet** — testers do beta começam com nível avançado quando mainnet abrir.
- **Reconhecimento público** no lançamento (com seu consentimento, opt-out disponível).
- **Influência real no produto** — feedback do beta vira features na v1.

---

## 8. O que você perde se der default

- **-500 XP** na sua wallet (penalidade existente do protocolo).
- **Sem multa em dinheiro real** (porque é devnet).
- **Time entende** que vai haver defaults — é exatamente o que o beta serve pra observar. **Não estresse.**
- Se você decidir sair em vez de dar default: avise antes do próximo ciclo, a gente avalia caso a caso e provavelmente é OK sem penalidade.

---

## 9. Comunicação — onde achar o time

| Canal | Pra que |
|---|---|
| **[Discord/Telegram link]** | Dúvidas gerais, bugs, dinâmica social |
| **@yvina (DM)** | Suporte direto, primary on-call |
| **@gabriel (DM)** | Bugs de segurança / suspeitas técnicas (responsible disclosure) |
| **@alrimar (DM)** | Reservado pra escalações técnicas — provavelmente você não precisa |
| **e-mail: contact@roundfi.io** | Tópicos formais, ≤72h resposta |

**Horário de resposta no canal:** seg-sex, 9h-18h BRT. Fora desse horário, melhor esforço.

---

## 10. Calendário de comunicação pública (só Fase 1)

A Fase 0 (Canary) é **silenciosa** — nada de posts públicos sobre o experimento durante.

A Fase 1 tem **marker posts quinzenais** (a cada 2 semanas):

- Semana 0: anúncio "Genesis Canary terminou, aprendemos X, agora abrindo Fase 1"
- Semana 2: progresso (sem nomes individuais a menos que você opt-in)
- Semana 4: progresso
- Semana 6: progresso
- Semana 8: progresso
- Semana 10: encerramento + agradecimento aos testers (com seu consentimento)

Você sempre pode revisar seu nível de exposição via mensagem no canal.

---

## 11. FAQ rápido

**Q: Posso participar de mais de um pool simultaneamente?**
A: No beta, não. Um pool por tester, pra simplificar análise dos dados.

**Q: E se eu quiser convidar amigos?**
A: Sistema de referral está ativo. Você pode convidar até **3 amigos** simultaneamente, ganha +20 XP a cada ciclo que eles completarem, e perde -100 XP se algum der default. Cap híbrido sai pós-beta.

**Q: O USDC devnet conta como ativo real?**
A: Não. É moeda de teste mintada pelo time. Não vale nada em mainnet, não é tributável, não pode ser trocada por USDC real.

**Q: Quando isso vai pra mainnet?**
A: Pós-beta + auditoria + Squads multisig setup. Sem prazo cravado — vai depender do que aprendermos no beta. Estimativa razoável: 3-6 meses pós-conclusão.

**Q: Posso desistir no meio?**
A: Sim, ver seção 4.5 do termo. Saída antes de receber payout = stake fica no pool. Saída depois de receber payout = default voluntário (-500 XP). Saída com aviso prévio + boa razão = caso a caso, geralmente sem penalidade.

**Q: O que acontece se o time abortar a fase?**
A: Seu USDC devnet é refundado (trivial — é mintado). Você é avisado em ≤24h. Próxima fase começa pós-fix, e você é convidado de novo.

---

## 12. Antes de você começar — checklist do tester

- [ ] Li este guia até o final
- [ ] Li o termo de participação
- [ ] Conectei minha wallet ao app do beta
- [ ] Recebi o USDC devnet (confirmar saldo > 0)
- [ ] Aceito as regras de comunicação pública (escolhi minha opção)
- [ ] Entrei no Discord/Telegram dedicado
- [ ] Sei como abrir issue no canal se algo der errado

Quando todos os 7 itens estão verdes, você está pronto pro Dia 3 (pool forma).

---

## 13. Lembrete final

O beta existe pra **achar problemas**, não pra esconder. Quanto mais você reportar, melhor o produto fica pra próxima rodada — incluindo você mesmo em mainnet.

Bem-vindo.

— Time RoundFi (Yvina, Caio, Alrimar, Gabriel)
