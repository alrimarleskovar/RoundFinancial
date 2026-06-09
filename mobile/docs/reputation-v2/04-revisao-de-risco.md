> Extracted from f0f15627-RoundFi_Revisao_de_Risco_v52.docx for git-friendly review.
> Source binary preserved in the same folder.

RoundFi

Revisao de Risco — v5.2

O que o tech lead nao pergunta — e o que pode matar o projeto

08 de junho de 2026  ·  Uso interno  ·  Para: Alrimar + equipe

CONTEXTO

Este documento nao e sobre como implementar. E sobre o que pode matar o projeto antes de o codigo importar. A analise tecnica da v5.2 esta correta. Este documento existe porque revisao de risco e diferente de revisao de arquitetura.

1. A hipotese central ainda nao foi testada

O RoundFi e construido sobre uma cadeia de premissas. Cada elo precisa ser verdadeiro para o proximo fazer sentido. Nenhuma delas foi validada com dados reais.

#

Premissa

O que acontece se for falsa

1

Usuarios vao completar ciclos recorrentes em grupo

Sem dados, sem score, sem B2B. Colapso total.

2

Completar ciclos cria sinal de credito confiavel

Score existe mas nao prediz risco. Parceiros nao integram.

3

Parceiros vao consumir o score para decisoes de credito

B2B oracle nunca acontece. RoundFi vira app de poupanca sem moat.

4

Reducao de stake de 50% a 3% e incentivo suficiente

Cold start permanente. Usuarios nao geram historico.

5

Score resiste a farming e sybil em escala

Reputacao vira commodity. Parceiros perdem confianca.

QUESTAO PARA A EQUIPE

Qual das 5 premissas a equipe esta mais incerta? Essa e a primeira coisa a testar — nao a quinta.

2. Matriz de riscos

Organizado por severidade real, nao por conforto tecnico.

Risco

Severidade

Status

Se nao for tratado

Nenhum usuario completa um ciclo real

CRITICO

Nao testado

Sem dados, sem score, sem B2B. O produto nao existe.

Regulacao brasileira (ROSCA digital = captacao publica?)

CRITICO

Nao analisado

BCB pode enquadrar como captacao irregular. Responsabilidade civil do operador.

Score nao aceito por nenhum parceiro

CRITICO

Nao validado

O modelo de negocio B2B oracle nao acontece.

Sybil em escala destroi confianca do score

ALTO

Parcialmente mitigado

Parceiros descartam o score apos primeiro ataque bem-sucedido.

LGPD: score financeiro on-chain = dado pessoal sensivel

ALTO

Nao analisado

Direito de apagamento impossivel em blockchain. ANPD pode multar.

Cold start: score sem dados nao tem valor

ALTO

Estrutural

Primeiro parceiro exige historico antes de integrar. Loop quebrado.

Usuario perde stake por falha de infraestrutura

ALTO

Parcialmente endereçado

Dano financeiro real. Risco juridico.

Bug no settle_default drena pool

ALTO

Sem auditoria externa

Perda de fundos irreversivel on-chain.

Yield do Kamino cai ou para

MEDIO

Reconhecido

Proposta de valor diminui mas nao mata o projeto.

Score v5.2 com pesos errados sem dataset real

MEDIO

Reconhecido

Primeiros usuarios punidos injustamente, churn.

3. Os dois riscos que ninguem esta discutindo

3.1 Regulacao — a pergunta que precisa de advogado, nao de dev

Uma ROSCA digital no Brasil tem pelo menos 3 enquadramentos regulatorios possiveis, nenhum trivial:

Captacao de recursos do publico (Lei 7.492/86, art. 16) — intermediario que organiza grupos e capta depositos pode ser enquadrado como captacao irregular. Pena: 2 a 6 anos de reclusao para o operador.

Correspondente bancario (Resolucao BCB 4.935/2021) — plataformas que facilitam operacoes financeiras para terceiros podem precisar de autorizacao do Banco Central.

Bureau de credito (Lei 12.414/2011) — o CPF Web3 e o B2B oracle sao exatamente o que a lei define como banco de dados de adimplencia. Operacao exige autorizacao e impoe direitos ao consumidor.

O documento de riscos menciona esses riscos como roadmap. Mas mencionado como roadmap e muito diferente de analisado com assessoria juridica. Esses riscos nao podem ser resolvidos em codigo.

ACAO NECESSARIA

Antes de qualquer usuario real, o projeto precisa de uma opiniao juridica de advogado especializado em fintechs e criptoativos no Brasil. Nao e custo — e prerequisito de existencia.

3.2 Cold start — o problema que a v5.2 nao resolve

A v5.2 resolve como calcular o score corretamente. O problema mais dificil nao e o calculo — e o bootstrap.

O loop de valor e: score util → parceiros integram → mais usuarios participam → score fica mais rico → mais parceiros. Esse loop so funciona quando ja esta girando.

O que o parceiro quer

O que o RoundFi tem hoje

O gap

Historico de centenas de usuarios em condicoes reais

Zero usuarios reais, zero ciclos completos

O ativo mais valioso nao existe ainda

Score validado contra inadimplencia real

Modelo teorico sem calibracao empirica

Ninguem sabe se o score prediz risco de verdade

API estavel com SLA documentado

Scaffold de indexer, sem producao

Nao ha nada para integrar hoje

Score auditavel por terceiros

Sim, com v5.2 implementada

Esse gap a v5.2 resolve — o menor dos tres

Conclusao: a v5.2 resolve o problema certo, mas nao e o mais urgente. O mais urgente e conseguir os primeiros usuarios reais completando ciclos reais — com ou sem score perfeito.

4. O risco que o proprio projeto documenta e ignora na pratica

O documento de riscos (09-risk-and-compliance.md) lista corretamente: a maior variavel nao resolvida e o comportamento humano. O protocolo ainda nao tem evidencia em escala de producao.

O Stress Lab conclui: questoes criticas sem resposta incluem: como os usuarios reagem a mudancas de reputacao? A pressao social reduz defaults?

Essas perguntas nao sao respondidas implementando a v5.2. Sao respondidas colocando usuarios reais em pools reais com dinheiro real.

O PARADOXO

O projeto tem documentacao de risco excelente. Mas o nivel de atencao a implementacao tecnica e desproporcionalmente maior do que o esforco em validar as premissas de negocio. Isso e um risco de alocacao — nao de capacidade.

5. Prioridades reais — em ordem de risco, nao de codigo

#

Acao

Por que e urgente

Quem resolve

1

Opiniao juridica sobre ROSCA digital no Brasil

Sem isso, qualquer usuario real e risco juridico para o operador

Advogado externo

2

Recrutar 10-20 usuarios para testar ciclo completo

Validar se usuarios completam ciclos. Sem isso, tudo e especulacao

Alrimar + produto

3

Conversa real com 1 parceiro B2B (CREDO ou Huma)

Validar se o score seria consumido. LOI ou feedback documentado

Alrimar

4

Implementar crates/math com a v5.2

Habilita auditabilidade por parceiros. Prerequisito tecnico do B2B

Dev — Step 4

5

Auditoria externa antes de qualquer usuario com dinheiro real

Bug no settle_default = perda irreversivel de fundos

Empresa de auditoria

6. Veredicto

O RoundFi tem o melhor design tecnico que um projeto neste estagio poderia ter. O architecture.md e solido. A v5.2 e a especificacao certa para o sistema de reputacao.

O risco real nao e tecnico.

O risco real e construir o mecanismo perfeito para um produto que ninguem usa, em uma categoria que pode ser regulada antes de escalar, para parceiros que ainda nao confirmaram interesse.

RECOMENDACAO FINAL

Implementar a v5.2 e certo. Mas implementar a v5.2 antes de ter qualquer usuario real, qualquer opiniao juridica, e qualquer confirmacao de parceiro e otimizar o segundo problema antes de resolver o primeiro. O tech lead esta certo em perguntar como implementar. A equipe precisa perguntar para quem — antes de responder o como.

RoundFi · Revisao de Risco v5.2 · Documento interno · 08/06/2026

Este documento nao substitui assessoria juridica ou financeira profissional.
