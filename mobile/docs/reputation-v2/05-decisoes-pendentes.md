> Extracted from 1009a36e-RoundFi_Decisoes_Pendentes_v52.docx for git-friendly review.
> Source binary preserved in the same folder.

RoundFi · Decisões Pendentes

Sistema de Reputação v5.2 — O que a equipe precisa decidir

Data: 08 de junho de 2026  ·  Para: Time de desenvolvimento + Alrimar

1. Onde o projeto está hoje

Verificado diretamente no repositório github.com/alrimarleskovar/RoundFinancial — não nos PDFs.

Componente

Status real (GitHub)

Observação

programs/roundfi-core

Estrutura criada, ping smoke

Step 4 = business logic ainda não escrito

programs/roundfi-reputation

Estrutura criada, ping smoke

Score v1 definido no architecture.md, não implementado

crates/math

Pasta existe no workspace

Onde as funções de score serão escritas

docs/architecture.md

749 linhas, 53 KB, fonte da verdade

Score arithmetic v1 já documentado aqui

sdk/

Scaffold presente

IDL gerado após deploy

app/

Next.js 15 estruturado

Flows de UI existem

services/orchestrator/

Presente

Crank demo-first, não chama settle_default

backend/

Definido no architecture.md §8

Indexer + API + crank — ainda a construir

PONTO-CHAVE

O architecture.md declara explicitamente: 'This document is the single source of truth. Every implementation step must conform to what is written here, or amend this document first.' A v5.2 precisa ser um PR de docs ANTES de ser um PR de código.

2. O que a v5.2 propõe

A v5.2 não é um refactor — é a primeira implementação real do sistema de reputação, com design melhor do que o score v1 descrito no architecture.md atual.

2.1 Score v1 (architecture.md atual) vs. Score v5.2

Score v1 (spec atual)

Score v5.2 (proposta)

+10 on-time / +50 ciclo completo / -100 atraso / -500 default

4 funções puras: Reliability, Punctuality, Commitment, Recovery

Thresholds L2=500, L3=2000

4 níveis L1/L2/L3/L4 com critérios explícitos (stake 50/25/10/3%)

3 categorias: Payment, Late, Default

6 categorias: FrictionOperational, FrictionTemporal, LateBehavioral, TemporaryIncapacity, Default, BadFaith

Contadores agregados no ReputationProfile

BehavioralEvent por ciclo — append-only, imutável após 7 dias

Sem mecanismo de contestação

FrictionProof on-chain: tx-hash, oráculo Switchboard, janela 7 dias

Score não auditável por terceiros

Funções puras em crates/math — qualquer um recomputa localmente

3. O que a equipe precisa decidir

URGENTE

São 5 decisões. Sem elas, o dev não tem como escrever o Step 4 (smart contracts). Nenhuma linha de Rust de reputação deve ser escrita antes dessas respostas.

Decisão 1 — Score v1 ou v5.2?

O architecture.md chama o sistema atual de 'Score arithmetic (v1)' — sinalizando que é provisório. A v5.2 é a v2 natural.

Opção

Implicação

Implementar score v1 agora

Mais simples, mais rápido. Mas vai precisar ser substituído após ter dados reais. Risco: parceiros B2B não conseguem verificar o score independentemente.

Pular v1, implementar v5.2 direto

Mais complexo, mas não precisa reescrever depois. O crates/math já existe para receber as funções puras. Risco: mais tempo antes do Step 4 estar pronto.

Híbrido: v1 na UI, v5.2 no storage

Implementar BehavioralEvent (v5.2) para coleta de dados, mas exibir métricas simples ao usuário. Permite calibrar pesos com dados reais antes de publicar score completo.

Decisão 2 — 3 níveis ou 4 níveis?

O README público, o architecture.md, o whitepaper e os documentos institucionais dizem 3 níveis (50/30/10%). A v5.2 propõe 4 (50/25/10/3%).

Se a equipe escolher 4 níveis, os seguintes documentos precisam ser atualizados antes de qualquer code review: README, architecture.md §3.1 ProtocolConfig, docs/ institucionais.

Se mantiver 3 níveis, a v5.2 pode ser implementada com L4 como roadmap — sem mudar docs públicos agora.

Decisão 3 — FrictionProof: qual oráculo?

A v5.2 define FrictionProof::OnChainOracle que valida contra uma ORACLE_WHITELIST — que não existe em nenhum arquivo do repo.

Para o devnet: Switchboard já está referenciado no architecture.md. Bastam 1-2 feeds para a whitelist inicial, gerenciada por upgrade authority.

Pergunta para a equipe: 

Qual feed Switchboard usar no devnet para detectar congestão de rede?

A whitelist inicial pode ser gerenciada por upgrade authority, ou precisa de governance desde o início?

Decisão 4 — BadFaith: quem pode atestar?

BadFaith é a única categoria que exige atestação humana. O architecture.md §4.2 diz: 'Direct wallet-signed attest calls are only allowed from the ReputationConfig.authority (used for manual corrections in Step 9 forward).'

A v5.2 propõe que BadFaith exija proposta de governance on-chain com quorum.

Para o devnet (hackathon): governance completa é overkill. A equipe precisa decidir:

Usar o authority do ReputationConfig para atestar BadFaith durante o hackathon?

Ou desativar BadFaith completamente no MVP e implementar governance depois?

Decisão 5 — upgrade ou redeploy do roundfi-reputation?

O program ID atual é Hpo174...e9R2. Se a v5.2 mudar a estrutura de accounts (adicionar BehavioralEvent, OracleConfig), há duas abordagens:

Abordagem

Consequência

Upgrade do programa existente

Mantém o mesmo Program ID. As evidências Solscan atuais continuam válidas. Requer que as novas accounts sejam compatíveis com o state existente.

Redeploy com novo Program ID

IDs novos nos documentos. Evidências Solscan antigas ficam desconectadas do programa atual. Mais limpo tecnicamente.

4. O que a v5.2 não toca

Para deixar claro o escopo — estes componentes não são afetados:

Componente

Status

roundfi-core (pool state machine)

Intacto — nenhuma instrução muda

Triple Shield (Seed Draw, Escrow, Solidarity)

Intacta — lógica econômica preservada

Escape Valve (NFT Metaplex Core)

Intacta

Yield adapters (mock + kamino)

Intactos

D/C invariant e settle_default

Intactos — grace period de 7 dias mantido

PDAs existentes do roundfi-core

Intactos — apenas roundfi-reputation recebe novas accounts

Frontend e SDK

Precisarão de atualização após Step 4, mas não bloqueiam as decisões acima

5. Próximo passo concreto

PROPOSTA

Se a equipe aprovar a v5.2 como direção, o primeiro PR deve ser apenas documentação — sem código Rust. Amender o architecture.md com as 5 decisões acima resolvidas. Só depois o dev começa a escrever crates/math/*.rs.

Sequência proposta após decisões aprovadas:

PR de docs: amender architecture.md §3.4, §4.2, §7 com decisões da v5.2

crates/math: escrever reliability(), punctuality(), commitment(), recovery() com testes unitários

programs/roundfi-reputation: BehavioralEvent state + record_event instrução

programs/roundfi-reputation: attach_friction_proof + OracleConfig

programs/roundfi-reputation: recalculate_metrics + resolve_tier

programs/roundfi-reputation: query_score (Score Reader — CPI público)

Integração: roundfi-core chama record_event via CPI após settle_default

Testes bankrun: ciclo completo com v5.2

RoundFi · Decisões Pendentes v5.2 · Documento interno · 08/06/2026

Baseado em análise direta do repositório github.com/alrimarleskovar/RoundFinancial + docs/architecture.md
