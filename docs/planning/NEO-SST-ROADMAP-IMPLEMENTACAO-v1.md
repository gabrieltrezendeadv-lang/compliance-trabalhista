# Neo SST — Roadmap de Implementação

**Versão:** 1.0  
**Base:** `NEO-SST-ESCOPO-CONSOLIDADO-v2.md`  
**Forma de execução:** Claude Code e/ou Codex, com VS Code, Node.js, GitHub, Supabase e Vercel  
**Objetivo:** deixar o produto implementado e testado com adaptadores desacoplados, exigindo ao final apenas a configuração das contas e credenciais de Asaas, Resend e Evolution API  

---

## 1. Princípio de execução

A implementação será dividida em etapas pequenas, independentes e reversíveis. Nenhuma etapa será considerada concluída apenas porque compila ou porque uma tela aparece.

Cada etapa deverá passar por quatro gates:

1. **Gate de código:** lint, TypeScript e build.
2. **Gate funcional:** testes unitários, integração e jornadas aplicáveis.
3. **Gate de segurança:** isolamento de tenant, papéis, payloads inválidos e privilégios.
4. **Gate de banco/deploy:** aplicação e rollback em branch Supabase ou banco descartável, preview Vercel e smoke test.

Só depois dos quatro gates a alteração poderá ser candidata a merge.

---

## 2. Stack confirmada e ferramentas

### 2.1 Stack atual

- Next.js 16 com App Router;
- React 19;
- TypeScript;
- Tailwind CSS 4;
- React Hook Form;
- Zod;
- Supabase Auth;
- PostgreSQL/Supabase;
- Vercel;
- GitHub.

### 2.2 Ferramentas locais necessárias

Já disponíveis:

- VS Code;
- Node.js.

Confirmar ou instalar uma única vez:

- Git;
- GitHub CLI, recomendado;
- Supabase CLI;
- Vercel CLI, recomendado;
- Docker Desktop, opcional.

O Docker é útil para executar Supabase localmente. Se não for instalado, os testes de migrations poderão continuar sendo feitos em branches descartáveis do Supabase.

### 2.3 Contas externas que não são necessárias no início

O desenvolvimento poderá avançar sem:

- conta Resend configurada;
- conta Asaas configurada;
- Evolution API implantada;
- número de WhatsApp conectado.

Essas integrações serão representadas por adaptadores e provedores simulados. Em produção, provedores simulados deverão falhar fechados e permanecer desativados.

---

## 3. Fluxo padrão para Claude Code ou Codex

Para cada etapa:

1. criar uma issue ou tarefa com escopo fechado;
2. criar uma branch específica;
3. pedir ao agente diagnóstico somente leitura;
4. pedir plano por arquivo, migration e teste;
5. revisar o plano;
6. autorizar a implementação;
7. executar testes locais;
8. criar preview Vercel;
9. aplicar migration em branch Supabase;
10. executar testes positivos e negativos;
11. executar rollback;
12. comparar estado anterior e posterior;
13. reaplicar em staging;
14. criar PR em modo draft;
15. submeter a revisão de outro agente;
16. corrigir achados;
17. transformar em ready for review;
18. somente depois realizar merge e aplicação controlada.

Nunca permitir que um agente:

- aplique migration diretamente em produção sem confirmação explícita;
- use produção para desenvolver;
- altere dados reais para criar fixture;
- remova arquivos ou migrations anteriores para “limpar” o projeto;
- use `service_role` no frontend;
- silencie erro de segurança para fazer teste passar;
- marque como entregue sem apresentar evidências dos testes.

---

## 4. Convenções obrigatórias

### 4.1 Branches

```text
chore/test-foundation
refactor/provider-contracts
feat/employee-lifecycle
feat/campaign-engine
feat/email-provider
feat/whatsapp-provider
feat/document-vault
feat/cnpj-risk
feat/evidence-reports
feat/billing-provider
chore/security-release
```

### 4.2 Commits

Um commit deve representar uma alteração coerente. Evitar commits que misturem:

- migration;
- redesign;
- refatoração ampla;
- nova integração;
- correção não relacionada.

### 4.3 Migrations

Toda migration deverá conter documentação associada com:

- objetivo;
- dependências;
- assinatura exata das funções;
- estado anterior;
- estado posterior;
- rollback exato;
- consultas de verificação;
- impacto;
- testes positivos e negativos;
- ACL incluindo `PUBLIC`.

Rollbacks não poderão usar `GRANT ALL` nem restaurar permissões por aproximação.

### 4.4 Variáveis de ambiente

Manter:

```text
.env.example
.env.local
.env.test
```

Nunca versionar `.env.local` ou segredos reais.

As variáveis deverão ser validadas no backend por schema. O frontend só poderá acessar variáveis explicitamente públicas.

---

## 5. Arquitetura preparada para integrações futuras

### 5.1 Contratos

Criar contratos separados:

```text
EmailProvider
WhatsAppProvider
BillingProvider
DocumentSignerProvider
OrganizationRegistryProvider
```

### 5.2 Seleção por ambiente

Exemplo:

```text
EMAIL_PROVIDER=disabled|mock|resend
WHATSAPP_PROVIDER=disabled|mock|evolution|meta_cloud
BILLING_PROVIDER=disabled|mock|asaas
SIGNER_PROVIDER=disabled|manual|external
CNPJ_PROVIDER=manual|brasilapi
```

Regras:

- `mock` permitido apenas em teste, desenvolvimento e preview autorizado;
- produção falha fechada se `mock` estiver selecionado;
- provedor desconhecido é rejeitado;
- credencial ausente não ativa fallback silencioso;
- cada webhook valida o provedor esperado;
- nenhum segredo é enviado ao navegador.

### 5.3 Mocks

Os mocks deverão reproduzir:

- sucesso;
- falha;
- timeout;
- retorno inválido;
- webhook sem assinatura;
- assinatura inválida;
- evento repetido;
- evento fora de ordem;
- evento expirado;
- indisponibilidade temporária.

Isso permite implementar praticamente todo o produto antes das contas externas.

---

# ROADMAP

---

## Etapa 0 — Congelamento da linha de base

### Objetivo

Conhecer exatamente o estado atual e criar um ponto confiável para regressão.

### Implementações

- confirmar o commit atualmente em produção;
- confirmar o projeto Supabase conectado à Vercel;
- confirmar ambientes preview, staging e produção;
- verificar presença das variáveis sem revelar conteúdo;
- inventariar rotas, tabelas, functions, RLS, storage e cron jobs;
- listar migrations aplicadas;
- listar pendências conhecidas;
- registrar o risco aceito de default privileges;
- criar `docs/current-state.md`;
- criar `docs/architecture.md`;
- criar `docs/security-model.md`;
- criar `docs/database-inventory.md`;
- atualizar `README.md` com instalação local.

### Testes

- `npm ci`;
- `npm run lint`;
- `npx tsc --noEmit`;
- `npm run build`;
- smoke test somente leitura da produção;
- teste de login;
- teste de usuário sem tenant;
- teste das jornadas públicas;
- teste das rotas principais do dashboard;
- registro dos erros existentes sem corrigi-los nesta etapa.

### Segurança

- busca por segredos versionados;
- confirmação de ausência de `service_role` no bundle;
- confirmação das policies RLS;
- inventário de funções executáveis por `PUBLIC`;
- inventário dos buckets e policies.

### Saída

- relatório de baseline;
- commit e tag de referência;
- lista priorizada de problemas existentes.

### Gate

Nenhum desenvolvimento começa antes de lint, TypeScript e build da linha de base estarem compreendidos. Erro preexistente deve ser documentado.

---

## Etapa 1 — Fundação de testes e CI

### Objetivo

Permitir que agentes implementem com regressão automática.

### Dependências

- Etapa 0.

### Implementações

Adicionar:

- Vitest;
- Testing Library;
- ambiente de teste Node/jsdom conforme o caso;
- Playwright para E2E;
- mocks de Supabase;
- fixtures multi-tenant;
- scripts de teste;
- cobertura;
- workflow GitHub Actions.

Scripts esperados:

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:e2e": "playwright test",
  "typecheck": "tsc --noEmit",
  "verify": "npm run lint && npm run typecheck && npm run test && npm run build"
}
```

Criar fixtures para:

- usuário sem organização;
- viewer/collaborator;
- manager;
- admin;
- owner;
- investigator;
- auditor;
- tenant A;
- tenant B;
- service role apenas em testes server-side específicos.

### Pipeline de CI

Jobs:

1. instalação reprodutível com `npm ci`;
2. lint;
3. TypeScript;
4. testes unitários;
5. cobertura;
6. build;
7. E2E em preview ou ambiente controlado;
8. auditoria de dependências;
9. verificação de migrations e SQL.

### Testes mínimos

- schemas Zod;
- helpers de autorização;
- resolução de tenant;
- campanhas existentes;
- denúncias;
- avaliações;
- rotas públicas;
- erro tratado quando não há tenant.

### Segurança

- teste cross-tenant obrigatório;
- teste de papéis;
- teste de payload com campos extras;
- teste de ID inválido;
- teste de sessão ausente.

### Gate

PRs posteriores não poderão ser mergeadas se `verify` falhar.

---

## Etapa 2 — Contratos de provedores e infraestrutura de eventos

### Objetivo

Desacoplar o Neo SST de Resend, Evolution e Asaas.

### Dependências

- Etapa 1.

### Banco

Criar ou consolidar:

```text
provider_connections
provider_events
outbox_jobs
dead_letter_jobs
webhook_receipts
idempotency_keys
```

### Regras

- nenhuma API externa é chamada diretamente por page ou componente;
- toda chamada parte de serviço server-side;
- envios entram em outbox;
- worker reivindica jobs atomicamente;
- job possui chave idempotente;
- webhook bruto é validado antes do parse;
- evento original recebe hash;
- eventos repetidos não repetem efeitos;
- falhas permanentes vão para dead letter;
- falhas transitórias podem ser tentadas novamente;
- produção sem credenciais permanece desativada.

### Código

Criar:

```text
src/lib/providers/
  email/
  whatsapp/
  billing/
  signatures/
  registry/
```

Cada diretório terá:

- contrato;
- provider disabled;
- provider mock;
- factory;
- schemas;
- normalizador de eventos;
- testes de contrato.

### Interface administrativa

- status dos provedores;
- “não configurado”;
- “ativo”;
- “degradado”;
- “desconectado”;
- última verificação;
- último erro sanitizado;
- botão de teste disponível apenas a owner/admin.

### Testes

- mock com sucesso;
- mock com falha;
- timeout;
- evento duplicado;
- evento expirado;
- webhook inválido;
- provider desconhecido;
- mock selecionado em produção;
- ausência de segredo em produção.

### Segurança

- nenhum segredo no banco em texto aberto;
- nenhuma credencial no frontend;
- logs sem corpo sensível;
- allowlist de provedores;
- webhook fail-closed.

### Gate

Todos os fluxos devem funcionar com mocks antes da primeira integração real.

---

## Etapa 3 — Autorização, tenant e onboarding

### Objetivo

Garantir que nenhuma funcionalidade nova repita os erros de usuário sem organização ou de privilégio.

### Dependências

- Etapas 1 e 2.

### Implementações

- consolidar `requireUser`;
- consolidar `requireTenant`;
- consolidar `requireRole`;
- padronizar respostas e redirects;
- remover guards de página dependentes de RPC insegura;
- implementar página de onboarding;
- validar retorno de `fn_create_organization_with_owner`;
- impedir duplicidade;
- garantir que usuário com membership inativa não use o tenant;
- revisar seleção de organização;
- criar tratamento de erro compreensível.

### Testes

- anônimo;
- confirmado sem profile;
- profile sem membership;
- membership inativa;
- membro do tenant A;
- tentativa contra tenant B;
- owner;
- admin;
- manager;
- viewer/collaborator;
- retorno inesperado da RPC.

### Banco e segurança

- migration testada em branch;
- rollback exato;
- ACL incluindo `PUBLIC`;
- RLS em organizações, memberships e profiles;
- nenhuma criação de organização para usuário diferente de `auth.uid()`.

### Gate

Todas as rotas autenticadas devem tratar tenant nulo sem erro 500.

---

## Etapa 4 — Ciclo de vida e desligamento

### Objetivo

Implementar admissão operacional, aviso, desligamento, interrupção de transmissões e retenção.

### Dependências

- Etapa 3.

### Banco

Adicionar ou ajustar:

```text
employment_status
notice_communicated_at
effective_termination_at
transmission_stop_at
inactive_at
retention_review_at
legal_hold
legal_hold_reason
archived_at
anonymized_at
```

Estados:

```text
active
notice_period
inactive
archived
```

### Implementações

- formulário de desligamento;
- validação cronológica;
- interrupção antecipada configurável;
- cancelamento de jobs futuros;
- mudança automática para inativo;
- remoção das listas operacionais;
- preservação do histórico;
- tela de inativos;
- filtros;
- legal hold;
- alerta de revisão de retenção;
- solicitação de exportação;
- auditoria das mudanças.

### Regra crítica

A elegibilidade para campanha deve ser conferida novamente pelo worker no momento do envio.

### Automação

- job de inativação;
- job de cancelamento;
- job de alerta de revisão;
- nenhum job elimina dados automaticamente.

### Testes funcionais

- aviso trabalhado;
- interrupção imediata;
- aviso indenizado;
- data inválida;
- trabalhador já inativo;
- campanha criada antes do desligamento;
- campanha executada depois da data de corte;
- reativação controlada;
- legal hold.

### Testes de segurança

- manager sem permissão de desligar, se essa for a matriz aprovada;
- tenant A não altera trabalhador do tenant B;
- payload não altera campos fora da allowlist;
- histórico não pode ser reescrito.

### Gate

Nenhum trabalhador com transmissão interrompida poderá ser selecionado ou enviado por qualquer canal.

---

## Etapa 5 — Motor de campanhas

### Objetivo

Transformar campanhas em fluxo confiável, versionado e automatizável.

### Dependências

- Etapas 2 e 4.

### Banco

Criar ou revisar:

```text
campaigns
campaign_versions
campaign_sources
campaign_templates
campaign_template_versions
campaign_schedules
campaign_deliveries
campaign_acknowledgments
campaign_audit_events
```

### Implementações

- editor estruturado;
- template ou campanha do zero;
- rascunho;
- revisão;
- aprovação;
- agendamento;
- cancelamento;
- segmentação;
- preview;
- versão curta para WhatsApp;
- versão HTML/texto para e-mail;
- fonte oficial;
- link “mais informações”;
- reconhecimento;
- fila;
- retentativas;
- estatísticas;
- reenvio controlado apenas para falhas elegíveis.

### Estados

```text
draft
scheduled
queued
provider_accepted
sent
delivered
read
acknowledged
failed
cancelled
rejected
```

### Catálogo oficial

Criar registros para:

- vacinação;
- HPV;
- câncer de mama;
- câncer do colo do útero;
- câncer de próstata;
- informação sobre exames preventivos;
- campanhas mensais de conscientização;
- temas de saúde mental e prevenção compatíveis com o produto.

Cada conteúdo:

- fonte;
- órgão;
- URL;
- data de conferência;
- período;
- versão;
- status;
- ano de referência.

### Atualização automática assistida

Criar serviço que:

1. consulta páginas oficiais;
2. detecta alteração de título, data ou conteúdo relevante;
3. cria sugestão;
4. nunca publica ou envia automaticamente;
5. exige revisão;
6. preserva a versão anterior.

Quando a fonte não puder ser consultada, registrar falha sem substituir conteúdo válido.

### Testes

- campanha para todos;
- por estabelecimento;
- por departamento;
- destinatário sem canal;
- destinatário desligado;
- destinatário com opt-out;
- campanha duplicada;
- worker executado duas vezes;
- link oficial ausente;
- versão alterada depois da aprovação;
- reconhecimento de versão antiga;
- lote de 100 destinatários.

### Segurança

- HTML sanitizado;
- URL oficial validada;
- autorização para criar, aprovar e enviar;
- tenant cruzado;
- conteúdo não editável depois de enviado.

### Gate

Uma campanha só pode ser enviada se estiver aprovada, versionada, com fonte e destinatários revalidados.

---

## Etapa 6 — Resend preparado, sem credenciais

### Objetivo

Implementar integralmente o adaptador Resend usando mock e testes de contrato.

### Dependências

- Etapas 2 e 5.

### Implementações

- `ResendEmailProvider`;
- templates HTML e texto;
- remetente configurável;
- reply-to;
- schema das respostas;
- normalização de eventos;
- webhook;
- bounce;
- rejeição;
- entrega;
- lista de supressão;
- teste de conexão;
- health check;
- feature flag.

### Variáveis esperadas

```text
RESEND_API_KEY
RESEND_WEBHOOK_SECRET
RESEND_FROM_EMAIL
RESEND_REPLY_TO
EMAIL_PROVIDER=resend
```

### Sem conta real

Enquanto as variáveis não existirem:

- o provider fica `disabled`;
- o botão de envio informa “e-mail não configurado”;
- nenhuma campanha é marcada como enviada;
- previews e testes com mock continuam funcionando.

### Testes

- envio aceito;
- bounce;
- rejeição;
- timeout;
- webhook inválido;
- replay;
- evento fora de ordem;
- domínio não configurado;
- segredo ausente;
- HTML e texto.

### Gate

O adaptador deve passar pelos mesmos testes do mock antes da inclusão das credenciais reais.

---

## Etapa 7 — Evolution API preparada, sem servidor real

### Objetivo

Implementar WhatsApp experimental bidirecional e deixar apenas implantação, credenciais e QR Code para o final.

### Dependências

- Etapas 2, 4 e 5.

### Implementações

- `EvolutionWhatsAppProvider`;
- conexão por organização;
- uma instância/número por empresa;
- estados da sessão;
- health check;
- geração/recebimento do QR Code;
- envio;
- eventos de entrega e leitura;
- recebimento de mensagens;
- opt-in;
- opt-out;
- caixa interna de respostas;
- resposta administrativa;
- alerta contra envio de informações de saúde;
- kill switch;
- bloqueio por desligamento;
- reconexão controlada;
- feature flag;
- documentação de implantação.

### Arquivos preparados

- `.env.example`;
- documentação das variáveis;
- exemplo de configuração;
- guia de deploy;
- checklist de conexão;
- checklist de desconexão;
- runbook de número bloqueado;
- runbook de sessão expirada.

### Variáveis esperadas

```text
EVOLUTION_BASE_URL
EVOLUTION_API_KEY
EVOLUTION_WEBHOOK_SECRET
WHATSAPP_PROVIDER=evolution
```

### Caixa interna

- conversas;
- mensagens;
- campanha relacionada;
- lida/não lida;
- resposta;
- encerramento;
- bloqueio;
- auditoria;
- separação por tenant.

### Testes com mock server

- criar instância;
- conectar;
- desconectar;
- enviar;
- receber;
- entrega;
- leitura;
- falha;
- sessão expirada;
- evento duplicado;
- mensagem de número desconhecido;
- opt-out;
- trabalhador inativo;
- tenant A/Tenant B;
- payload alterado;
- webhook sem assinatura.

### Segurança

- segredo somente server-side;
- sessão isolada por organização;
- nenhuma credencial no browser;
- corpo bruto;
- replay;
- idempotência;
- sem anexos inicialmente;
- sem coleta de saúde.

### Gate

O fluxo completo deverá funcionar com mock local antes de conectar qualquer número.

---

## Etapa 8 — Consulta de CNPJ e grau de risco

### Objetivo

Automatizar o onboarding sem criar dependência cega de API gratuita.

### Dependências

- Etapa 3.

### Implementações

- contrato `OrganizationRegistryProvider`;
- provider manual;
- adaptador BrasilAPI;
- cache;
- timestamp da consulta;
- timeout;
- fallback manual;
- normalização de CNPJ;
- CNAE principal e secundários;
- tabela versionada de CNAE/grau de risco;
- origem normativa;
- histórico;
- revisão administrativa documentada.

### Testes

- CNPJ válido;
- inválido;
- inexistente;
- API indisponível;
- resposta incompleta;
- CNAE desconhecido;
- mudança de regra normativa;
- cache expirado;
- override sem justificativa;
- tenant cruzado.

### Gate

Falha da API não pode impedir permanentemente o onboarding nem inventar grau de risco.

---

## Etapa 9 — Arquivo documental

### Objetivo

Criar arquivo privado e versionado para documentos organizacionais.

### Dependências

- Etapas 1 e 3.

### Banco

Criar:

```text
compliance_documents
compliance_document_versions
compliance_document_events
document_retention_rules
document_expiry_alerts
```

### Storage

- bucket privado;
- path com tenant;
- policy de upload;
- policy de leitura;
- policy de substituição;
- nenhuma URL pública permanente;
- download por URL temporária ou endpoint autenticado.

### Implementações

- upload;
- validação de extensão;
- validação de MIME e magic bytes;
- limite de tamanho;
- categorização;
- estabelecimento;
- período;
- validade;
- emissor;
- versionamento;
- filtros;
- busca;
- alertas;
- download;
- hash;
- auditoria;
- aviso e bloqueio de documentos individuais.

### Segurança

- arquivo permanece em quarentena até validação;
- nome original sanitizado;
- conteúdo servido como attachment quando necessário;
- nenhuma execução;
- SVG/HTML ativos não serão aceitos inicialmente;
- tenant cruzado;
- IDOR;
- arquivo com dupla extensão;
- MIME falso;
- arquivo grande;
- arquivo corrompido.

### Antivírus

Preparar interface para scanner. No lançamento de baixo custo:

- validação de magic bytes;
- tipos restritos;
- storage privado;
- download controlado;
- possibilidade de integrar scanner posteriormente.

Não declarar que arquivos estão “livres de vírus” sem scanner real.

### Gate

Um usuário de outro tenant não poderá descobrir metadados nem obter bytes do arquivo.

---

## Etapa 10 — Relatórios, evidências e exportações

### Objetivo

Padronizar documentos produzidos sem IA e torná-los reproduzíveis.

### Dependências

- Etapas 4, 5 e 9.

### Implementações

- estrutura canônica de relatório;
- gerador de PDF;
- hash do conteúdo canônico;
- manifesto;
- versão;
- fonte dos dados;
- disclaimer;
- pacote selado;
- verificação;
- download;
- auditoria;
- pacote de desligamento.

### Relatórios

- campanha;
- evidências;
- compliance agregado;
- avaliação psicossocial;
- inventário de riscos;
- plano de ação;
- acompanhamento;
- denúncias agregadas;
- anexo de apoio ao PGR;
- desligamento.

### Regras

- relatório agregado não expõe trabalhador;
- denúncia gerencial não contém narrativa;
- versão selada não pode ser alterada;
- regeneração cria nova versão;
- hash não é apresentado como prova absoluta de veracidade;
- PGR completo não é declarado automaticamente válido.

### Testes

- PDF determinístico quando os dados são iguais;
- alteração gera hash diferente;
- pacote adulterado falha na verificação;
- versão selada bloqueia update;
- tenant cruzado;
- relatório vazio;
- caracteres especiais;
- grande quantidade de eventos;
- exportação do ex-trabalhador.

### Gate

Toda evidência deve ser vinculada à versão exata do conteúdo e aos eventos que a originaram.

---

## Etapa 11 — Regressão dos módulos de compliance

### Objetivo

Fortalecer os módulos já existentes antes da cobrança comercial.

### Escopo

- avaliações psicossociais;
- inventário de riscos;
- planos de ação;
- denúncias;
- evidências;
- relatórios;
- membros;
- estabelecimentos;
- departamentos.

### Testes de avaliações

- token válido;
- inválido;
- expirado;
- reutilização;
- perguntas obrigatórias;
- duplicidade;
- escala;
- reverse scoring;
- limiar de anonimato;
- grupo pequeno;
- importação para riscos.

### Testes de riscos

- criação;
- edição;
- classificação;
- plano;
- revisão;
- importação;
- tenant cruzado;
- campos não permitidos.

### Testes de denúncias

- anônima;
- identificada;
- protocolo inválido;
- PIN inválido;
- rate limit;
- mensagem;
- investigador incorreto;
- anti-enumeração;
- tenant cruzado.

### Segurança

- matriz completa de papéis;
- `USING`;
- `WITH CHECK`;
- ACL;
- `PUBLIC`;
- `search_path`;
- owner das funções;
- service role;
- funções sem consumidor.

### Gate

Os testes públicos legítimos e os testes de abuso deverão passar conjuntamente.

---

## Etapa 12 — Planos e Asaas preparados, sem conta real

### Objetivo

Implementar catálogo, entitlements e cobrança com mock; deixar apenas credenciais e validação sandbox.

### Dependências

- Etapas 2 e 11.

### Banco

Consolidar:

```text
plans
plan_limits
subscriptions
billing_customers
billing_events
invoices
payment_attempts
entitlements
```

### Regra arquitetural

Páginas não deverão chamar diretamente uma RPC de limite e transformar erro de permissão em 500.

Criar serviço server-side:

```text
getEntitlements()
requireFeature()
checkUsage()
```

O serviço deverá distinguir:

- não contratado;
- inadimplente;
- provedor indisponível;
- configuração ausente;
- erro interno.

### Implementações

- planos Essencial e Completo;
- faixas 1–10, 11–25 e 26–100;
- escolha de plano;
- checkout preparado;
- portal de faturas;
- alteração de plano;
- cancelamento;
- período de tolerância;
- degradação gradual;
- webhook Asaas;
- idempotência;
- conciliação.

### Variáveis esperadas

```text
ASAAS_API_KEY
ASAAS_ENVIRONMENT=sandbox|production
ASAAS_WEBHOOK_SECRET
BILLING_PROVIDER=asaas
```

### Testes

- pagamento confirmado;
- pendente;
- vencido;
- estornado;
- chargeback;
- webhook duplicado;
- assinatura inválida;
- evento atrasado;
- downgrade;
- cancelamento;
- provedor indisponível;
- usuário sem subscription;
- limite de trabalhadores.

### Segurança

- webhook autenticado;
- nenhuma confiança em valor vindo do frontend;
- preços lidos do servidor;
- tenant do pagamento validado;
- evento duplicado idempotente.

### Gate

Todo fluxo comercial deverá funcionar com `BillingProviderMock` antes do sandbox Asaas.

---

## Etapa 13 — Jobs e automações

### Objetivo

Executar tarefas recorrentes sem intervenção manual e sem duplicidade.

### Arquitetura recomendada

Usar:

- `pg_cron` para alterações exclusivamente internas ao banco;
- worker protegido para chamadas externas;
- outbox com lock;
- `FOR UPDATE SKIP LOCKED` ou mecanismo equivalente;
- chave idempotente;
- dead letter;
- auditoria.

### Jobs internos

- fechar ciclos expirados;
- inativar trabalhadores;
- cancelar transmissões;
- gerar alertas de retenção;
- gerar alertas de vencimento documental;
- marcar planos de ação vencidos.

### Jobs externos

- preparar campanhas;
- enviar lotes;
- consultar status;
- processar retentativas;
- enviar alertas;
- gerar relatórios programados.

### Testes

- worker simultâneo;
- execução duplicada;
- job expirado;
- lock abandonado;
- falha no meio do lote;
- retentativa;
- dead letter;
- desligamento durante processamento;
- provedor desativado.

### Segurança

- endpoint do worker protegido;
- service role somente no servidor;
- segredo de cron;
- logs sem credenciais;
- limite de lote.

### Gate

Executar o mesmo job duas vezes não pode criar dois envios, duas cobranças ou duas inativações.

---

## Etapa 14 — Interface, acessibilidade e operação

### Objetivo

Fechar a experiência do usuário e reduzir dependência de suporte.

### Implementações

- estados vazios;
- erros compreensíveis;
- loading;
- retry seguro;
- acessibilidade por teclado;
- labels;
- contraste;
- mobile;
- área de configurações;
- status dos provedores;
- logs administrativos;
- central de alertas;
- onboarding guiado;
- tela de plano;
- tela de inativos;
- caixa WhatsApp;
- arquivo documental;
- catálogo de campanhas;
- relatórios;
- ajuda contextual.

### Testes

- viewport desktop;
- tablet;
- celular;
- navegação por teclado;
- formulários;
- erros server-side;
- sessão expirada;
- refresh;
- links públicos.

### Gate

Nenhuma falha previsível deverá resultar em página branca ou erro 500 genérico.

---

## Etapa 15 — Segurança final e capacidade

### Objetivo

Produzir candidato de lançamento.

### Auditoria de aplicação

- sessão;
- autorização;
- tenant;
- allowlist;
- validação;
- IDOR;
- CSRF conforme arquitetura;
- XSS;
- upload;
- SSRF em URLs externas;
- webhooks;
- rate limiting;
- segredos;
- logs;
- tratamento de erro.

### Auditoria de banco

Para cada função exposta:

- schema;
- assinatura;
- owner;
- `prosecdef`;
- `proconfig`;
- `proacl`;
- `PUBLIC`;
- consumidores;
- rota;
- papel necessário.

Para cada tabela:

- grants;
- RLS;
- policies;
- `USING`;
- `WITH CHECK`;
- papéis.

### Matriz obrigatória

- anônimo;
- usuário sem organização;
- viewer/collaborator;
- manager;
- admin;
- owner;
- investigator;
- auditor;
- tenant A contra tenant B;
- service role;
- payload inválido;
- campo não permitido.

### Capacidade

Testar:

- organização com 10 trabalhadores;
- organização com 25;
- organização com 100;
- campanha para 100;
- geração de relatório;
- exportação;
- jobs simultâneos;
- múltiplos tenants.

Medir:

- tempo de página;
- duração do worker;
- consultas lentas;
- índices;
- tamanho de PDF;
- memória;
- erros;
- fila.

### Dependências

- auditoria de pacotes;
- atualização controlada;
- secret scanning;
- análise estática;
- verificação do bundle.

### Banco

- branch descartável;
- backup;
- teste de restauração;
- todas as migrations;
- todos os rollbacks;
- comparação de ACL;
- comparação de contagens.

### Gate

O candidato só é aprovado com:

- CI verde;
- build verde;
- E2E verde;
- zero falha cross-tenant;
- zero segredo exposto;
- apply e rollback validados;
- smoke test do preview.

---

## Etapa 16 — Integração final do Resend

### Ações do proprietário

1. criar ou acessar conta;
2. cadastrar domínio;
3. adicionar registros DNS;
4. gerar API key;
5. criar webhook;
6. fornecer os valores ao ambiente seguro da Vercel.

### Ações do agente

1. verificar presença sem exibir valores;
2. ativar `EMAIL_PROVIDER=resend`;
3. testar conexão;
4. enviar apenas para endereços de teste;
5. validar webhook;
6. testar bounce;
7. verificar logs;
8. executar smoke test;
9. liberar piloto.

### Gate

Nenhum envio para trabalhadores antes da validação com endereços controlados.

---

## Etapa 17 — Integração final da Evolution API

### Ações do proprietário

1. contratar ou disponibilizar servidor;
2. comprar ou separar número de teste;
3. autorizar o deploy;
4. escanear QR Code;
5. aprovar o uso experimental.

### Ações do agente

1. implantar Evolution;
2. configurar HTTPS;
3. criar chave;
4. configurar webhook;
5. cadastrar variáveis;
6. conectar uma organização piloto;
7. testar envio para números controlados;
8. testar recebimento;
9. testar entrega/leitura;
10. testar opt-out;
11. testar desligamento;
12. testar desconexão;
13. testar kill switch;
14. liberar piloto sem SLA.

### Gate

O piloto só começa após o número de teste completar fluxo bidirecional sem duplicidade.

---

## Etapa 18 — Integração final do Asaas

### Ações do proprietário

1. criar conta;
2. concluir cadastro;
3. criar credenciais sandbox;
4. depois criar credenciais de produção;
5. definir conta de recebimento;
6. aprovar preços e políticas comerciais.

### Ações do agente

1. configurar sandbox;
2. cadastrar webhook;
3. executar pagamentos simulados;
4. testar duplicidade;
5. testar vencimento;
6. testar cancelamento;
7. testar estorno;
8. verificar entitlements;
9. reconciliar eventos;
10. somente depois configurar produção.

### Gate

Nenhum checkout público antes da conciliação correta de todos os estados sandbox.

---

## Etapa 19 — Lançamento controlado

### Sequência

1. preview final;
2. staging completo;
3. smoke test;
4. backup;
5. migrations;
6. verificações pós-migration;
7. deploy;
8. smoke test de produção;
9. ativação por feature flag;
10. organização piloto;
11. grupo reduzido de trabalhadores;
12. expansão controlada.

### Monitoramento

- erros 500;
- falhas de autenticação;
- erros de RLS;
- jobs presos;
- dead letters;
- webhooks inválidos;
- sessões desconectadas;
- falhas de PDF;
- uploads rejeitados;
- tempo de resposta.

### Rollback

Cada etapa de lançamento deverá ter:

- versão anterior da aplicação;
- rollback exato de migration quando seguro;
- feature flag;
- possibilidade de desativar provider;
- preservação dos eventos já recebidos.

---

## 6. O que os agentes podem deixar totalmente pronto

Claude Code ou Codex poderão implementar sem suas contas externas:

- banco e migrations;
- RLS e ACL;
- telas;
- validações;
- testes;
- mocks;
- contratos de providers;
- adaptadores Resend, Asaas e Evolution;
- rotas de webhook;
- filas;
- jobs;
- catálogo;
- desligamento;
- arquivo documental;
- PDFs;
- hash;
- exportações;
- entitlements;
- checkout em modo mock;
- documentação;
- CI;
- deploy preview;
- scripts de verificação.

---

## 7. O que continuará dependendo do proprietário

- criar e validar contas externas;
- configurar DNS do e-mail;
- fornecer chaves pelo painel seguro;
- disponibilizar servidor da Evolution;
- conectar número por QR Code;
- validar dados comerciais no Asaas;
- aprovar preços;
- aprovar conteúdo institucional;
- aprovar migrations de produção;
- aceitar riscos operacionais;
- decidir quando ativar feature flags.

---

## 8. Ordem recomendada de PRs

| Ordem | PR | Conteúdo |
|---:|---|---|
| 1 | Baseline | Documentação e diagnóstico |
| 2 | Test Foundation | Vitest, Playwright e CI |
| 3 | Provider Contracts | Mocks, outbox, eventos e webhooks |
| 4 | Tenant Guards | Autorização e onboarding |
| 5 | Employee Lifecycle | Desligamento e retenção |
| 6 | Campaign Engine | Catálogo, versões e fila |
| 7 | Resend Adapter | Adaptador desativado por padrão |
| 8 | Evolution Adapter | Adaptador, inbox e webhooks |
| 9 | CNPJ/Risk | Consulta e tabela normativa |
| 10 | Document Vault | Storage, versões e alertas |
| 11 | Reports | PDFs, hashes e exportação |
| 12 | Compliance Regression | Avaliações, riscos e denúncias |
| 13 | Billing | Entitlements e Asaas mock |
| 14 | Jobs | Cron, worker e dead letters |
| 15 | UI/Operations | UX e monitoramento |
| 16 | Security RC | Auditoria, carga e release candidate |

Cada PR deve ser revisável isoladamente. Não criar uma única PR com todo o roadmap.

---

## 9. Prompt padrão para cada etapa

```text
Leia integralmente:
- NEO-SST-ESCOPO-CONSOLIDADO-v2.md
- NEO-SST-ROADMAP-IMPLEMENTACAO-v1.md
- AGENTS.md
- CLAUDE.md
- documentação local do Next.js instalada em node_modules

Trabalhe exclusivamente na Etapa [NÚMERO E NOME].

Antes de qualquer escrita:
1. faça diagnóstico somente leitura;
2. liste arquivos, tabelas, functions, rotas e testes afetados;
3. identifique dependências e riscos de regressão;
4. proponha migrations com rollback exato;
5. apresente plano de testes funcionais e de segurança;
6. pare e solicite aprovação.

Depois da aprovação:
- implemente em branch própria;
- não altere produção;
- não remova alterações existentes não relacionadas;
- mantenha isolamento multi-tenant;
- use allowlist de campos;
- não exponha service_role;
- não use mock ou fallback silencioso em produção;
- escreva testes antes de declarar conclusão;
- execute lint, TypeScript, testes e build;
- valide migrations e rollbacks em branch Supabase;
- produza relatório com evidências;
- abra PR draft.

Não marque a etapa como concluída se algum gate estiver pendente.
```

---

## 10. Prompt padrão para revisão independente

```text
Revise a PR [NÚMERO] do Neo SST sem alterar código inicialmente.

Compare a implementação com:
- NEO-SST-ESCOPO-CONSOLIDADO-v2.md;
- Etapa correspondente da roadmap;
- AGENTS.md;
- CLAUDE.md.

Verifique:
- escopo;
- regressões;
- autenticação;
- autorização;
- RLS;
- tenant A contra tenant B;
- ACL incluindo PUBLIC;
- service_role;
- allowlist;
- validação;
- webhooks;
- idempotência;
- replay;
- secrets;
- mocks em produção;
- migrations;
- rollback;
- testes;
- build;
- experiência de erro.

Classifique os achados em bloqueante, alto, médio e baixo.
Apresente evidências por arquivo e função.
Não aprove a PR enquanto houver bloqueante ou alto sem tratamento.
```

---

## 11. Definição de concluído

Uma etapa estará concluída somente quando:

- escopo implementado;
- documentação atualizada;
- lint verde;
- TypeScript verde;
- testes unitários verdes;
- integração verde;
- E2E aplicável verde;
- build verde;
- migrations aplicadas em branch;
- rollback executado;
- estado restaurado;
- ACL conferida;
- cross-tenant negado;
- preview Vercel funcional;
- revisão independente concluída;
- PR pronta para aprovação.

“Funcionou na minha máquina” não é critério de conclusão.

---

## 12. Primeira ação recomendada

Começar pela **Etapa 0 — Congelamento da linha de base** e, em seguida, pela **Etapa 1 — Fundação de testes e CI**.

Não iniciar simultaneamente WhatsApp, cobrança, documentos e campanhas. Sem a fundação de testes, os agentes produzirão alterações difíceis de revisar e os bugs só aparecerão depois da aplicação em produção.

Após a Etapa 2, os três provedores externos poderão ser desenvolvidos integralmente em modo mock e permanecer desativados até a configuração final.

---

**Este documento define ordem e critérios de execução. Não autoriza aplicação automática de migrations ou alterações em produção.**
