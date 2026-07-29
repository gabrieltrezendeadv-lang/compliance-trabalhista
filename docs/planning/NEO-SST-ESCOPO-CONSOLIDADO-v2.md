# Neo SST — Escopo Consolidado de Produto

**Versão:** 2.0  
**Data de consolidação:** 28/07/2026  
**Status:** escopo de referência para planejamento e implementação  

---

## 1. Definição do produto

O **Neo SST — Gestão de Conformidade** será um SaaS tecnológico para pequenas e médias empresas organizarem:

- comunicações e campanhas institucionais de saúde e prevenção;
- evidências de envio, entrega, leitura e reconhecimento;
- avaliações organizacionais de fatores de riscos psicossociais;
- inventário de riscos e planos de ação;
- canal de denúncias;
- relatórios e pacotes de evidências;
- arquivo de documentos organizacionais de SST e compliance;
- ciclo de vida dos trabalhadores, inclusive desligamento e retenção.

O foco comercial inicial são empresas com **até 25 trabalhadores**, admitindo clientes ocasionais de até **100 trabalhadores por organização**.

O Neo SST é uma plataforma de gestão e evidência. Ele não presta serviços profissionais de medicina, psicologia, engenharia ou segurança do trabalho e não assume responsabilidade técnica por atos que dependam de profissional habilitado.

---

## 2. Limites permanentes do produto

O Neo SST não deverá:

- prestar atendimento médico, psicológico ou de engenharia;
- diagnosticar doenças ou avaliar a aptidão individual do trabalhador;
- armazenar prontuários, exames, atestados, ASOs ou dados individuais de saúde;
- solicitar pelo WhatsApp informações sobre diagnóstico, tratamento, vacinação ou exames pessoais;
- substituir visita técnica, medição ambiental ou avaliação profissional;
- declarar automaticamente que um PGR, LTCAT, PCMSO, AET ou laudo possui validade técnica;
- usar inteligência artificial para decidir direitos, aplicar sanções ou avaliar individualmente trabalhadores;
- prometer entrega ou leitura de WhatsApp quando o provedor não fornecer evento confiável;
- considerar “mensagem preparada” como mensagem entregue;
- excluir automaticamente registros apenas porque transcorreram dois anos do desligamento;
- usar um único número central do Neo SST para representar diversas empresas.

---

## 3. Público-alvo e capacidade comercial

### 3.1 Público principal

- microempresas;
- empresas com 1 a 10 trabalhadores;
- empresas com 11 a 25 trabalhadores;
- pequenas e médias empresas com até 100 trabalhadores;
- setores administrativos, jurídicos, de RH e responsáveis internos por SST.

### 3.2 Capacidade técnica pretendida

A arquitetura não terá limite técnico rígido por número de trabalhadores. O limite será comercial e operacional.

O primeiro alvo de homologação será:

- até 100 trabalhadores ativos por organização;
- campanhas com até 100 destinatários por organização;
- múltiplos estabelecimentos e departamentos;
- processamento em fila, sem depender de uma única requisição web;
- reavaliação dos destinatários no momento efetivo do envio.

Não será divulgada uma capacidade global de usuários ou organizações antes da realização de testes de carga. Os principais gargalos esperados são filas de campanha, geração de PDFs, armazenamento documental e provedores de comunicação, não o cadastro simples de trabalhadores.

---

## 4. Módulos estruturais

### 4.1 Organizações e onboarding

- criação de organização vinculada ao primeiro usuário como owner;
- usuário sem tenant direcionado para `/onboarding`;
- nome empresarial, nome fantasia, CNPJ e slug;
- estabelecimentos, endereços e departamentos;
- preferências de comunicação;
- guard de tenant em todas as rotas autenticadas;
- prevenção de duplicidade de organização e membership;
- trilha de auditoria das alterações cadastrais.

### 4.2 Membros e permissões

Papéis previstos:

- `owner`;
- `admin`;
- `manager`;
- `collaborator`;
- `investigator`;
- `auditor`.

Cada ação administrativa deve validar sessão, tenant e papel explicitamente, além das policies RLS. Remoções de membros serão feitas por soft delete quando a preservação do histórico for necessária.

### 4.3 Estabelecimentos e departamentos

- cada departamento pertence a um estabelecimento;
- segmentação de trabalhadores, campanhas, avaliações e relatórios;
- manutenção do histórico quando o trabalhador muda de setor;
- relatórios agregados, respeitado o limiar de anonimato.

---

## 5. Cadastro e ciclo de vida dos trabalhadores

### 5.1 Dados permitidos

- nome;
- e-mail profissional ou informado para comunicação;
- telefone;
- cargo;
- data de admissão;
- estabelecimento;
- departamento;
- canais autorizados;
- datas e estados relacionados ao vínculo.

Não serão armazenados dados individuais de saúde.

### 5.2 Estados

```text
active
notice_period
inactive
archived
```

### 5.3 Campos de desligamento

```text
notice_communicated_at
effective_termination_at
transmission_stop_at
inactive_at
retention_review_at
legal_hold
legal_hold_reason
archived_at
anonymized_at
deleted_at
```

### 5.4 Fluxo de desligamento

1. O gestor informa a data da comunicação.
2. Informa o último dia efetivo de trabalho.
3. Define a data de interrupção das transmissões, que pode ser anterior ao último dia.
4. O trabalhador passa para `notice_period`.
5. Mensagens agendadas para depois de `transmission_stop_at` são canceladas.
6. No último dia, o sistema altera automaticamente o estado para `inactive`.
7. O trabalhador deixa de integrar listas operacionais e limites de ativos.
8. O histórico anterior permanece imutável.
9. Tokens e convites ainda não utilizados podem ser cancelados conforme sua finalidade.

O conjunto de destinatários será conferido novamente imediatamente antes do envio. Isso impede que uma campanha previamente agendada seja enviada a pessoa desligada posteriormente.

### 5.5 Retenção após desligamento

Dois anos após a extinção do contrato serão utilizados como **marco de revisão**, e não como exclusão automática.

Fluxo:

- no último dia: inativação e interrupção de transmissões;
- aos 23 meses: alerta de revisão e preparação de exportação;
- aos 24 meses: revisão obrigatória da base legal e da necessidade de conservação;
- havendo litígio, fiscalização, investigação ou outra obrigação: aplicação de `legal_hold`;
- não havendo necessidade: anonimização ou eliminação dos dados dispensáveis;
- documentos e históricos sujeitos a prazo próprio seguem sua regra específica.

O histórico do inventário de riscos do PGR seguirá a retenção mínima aplicável da NR-1, independentemente do desligamento individual.

### 5.6 Pacote de desligamento

O sistema deverá permitir gerar pacote contendo:

- campanhas destinadas ao trabalhador;
- conteúdo e versão de cada campanha;
- fonte oficial utilizada;
- eventos de envio;
- reconhecimentos;
- registros de opt-in e opt-out;
- falhas;
- PDF legível;
- CSV dos eventos;
- manifesto dos arquivos;
- hash de integridade;
- data e usuário responsável pela exportação.

---

## 6. Campanhas institucionais

### 6.1 Objetivo

Permitir que a empresa informe e conscientize trabalhadores sobre campanhas oficiais de saúde, prevenção, vacinação e acesso a serviços de diagnóstico, gerando evidências organizadas.

### 6.2 Conteúdo mínimo

O catálogo deverá contemplar:

- campanhas oficiais de vacinação;
- HPV;
- câncer de mama;
- câncer do colo do útero;
- câncer de próstata;
- informação sobre a possibilidade de ausência para exames preventivos, conforme a legislação aplicável;
- campanhas mensais de conscientização;
- calendário de saúde e datas oficiais;
- temas como saúde mental, ergonomia e prevenção compatíveis com o escopo do produto.

### 6.3 Calendário anual

O Neo SST manterá um catálogo anual com:

- título;
- tema;
- mês ou período;
- público geral;
- texto-base;
- resumo curto para WhatsApp;
- versão para e-mail;
- URL oficial;
- órgão de origem;
- data da publicação;
- data da última conferência;
- ano de referência;
- status `draft`, `reviewed`, `active` ou `superseded`.

Fontes prioritárias:

- Calendário da Saúde do Ministério da Saúde;
- Calendário Nacional de Vacinação;
- páginas oficiais de campanhas do Ministério da Saúde;
- materiais oficiais de outros órgãos públicos somente quando identificados.

Links de referência:

- https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/c/calendario/saude
- https://www.gov.br/saude/pt-br/vacinacao/calendario
- https://www.gov.br/saude/pt-br/campanhas-da-saude/vacinacao

### 6.4 Atualização do catálogo

O sistema poderá consultar fontes oficiais periodicamente, mas não enviará automaticamente conteúdo novo sem revisão.

Fluxo:

1. detectar publicação ou alteração;
2. criar sugestão de atualização;
3. registrar a fonte e a data;
4. submeter à revisão administrativa;
5. publicar nova versão do template;
6. preservar a versão anteriormente enviada.

Quando não houver API ou feed oficial estável, a atualização será feita por curadoria administrativa. O sistema deve preferir paráfrase com link para a fonte, evitando cópia integral de materiais cuja licença não esteja confirmada.

### 6.5 Criação e envio

- campanha a partir de template ou do zero;
- seleção por organização, estabelecimento e departamento;
- envio imediato ou agendado;
- canais: e-mail, WhatsApp ou ambos;
- pré-visualização;
- aprovação antes do disparo;
- versionamento do conteúdo;
- cancelamento;
- fila idempotente;
- reprocessamento controlado de falhas;
- estatísticas agregadas.

### 6.6 Estados de entrega

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

Cada estado deve ter origem identificada. Eventos do usuário, do Neo SST e do provedor não podem ser confundidos.

### 6.7 Reconhecimento

O trabalhador poderá acessar um link para reconhecer o recebimento. O reconhecimento:

- não equivale a concordância com conteúdo;
- não autoriza tratamento de saúde;
- não substitui assinatura técnica;
- registra token, campanha, data e hash da versão apresentada.

---

## 7. E-mail

O e-mail será o canal automatizado mais estável da primeira versão.

Requisitos:

- provedor transacional;
- domínio autenticado;
- SPF, DKIM e DMARC;
- webhook assinado;
- eventos de envio, entrega, bounce e rejeição;
- idempotência;
- lista de supressão;
- nenhuma chave exposta ao frontend;
- modelo visual simples e responsivo;
- link para a fonte oficial e para o reconhecimento.

---

## 8. WhatsApp experimental

### 8.1 Decisão de escopo

Será admitida uma integração experimental por **Evolution API**, sem Chatwoot, para validação do produto.

O canal será identificado internamente como:

```text
evolution_test
```

Ele não terá SLA nem será apresentado como canal oficial da Meta.

### 8.2 Propriedade do número

- cada empresa utilizará seu próprio número;
- o número deverá identificar claramente a empresa;
- o Neo SST não compartilhará um número entre organizações;
- o número de teste não deverá ser crítico para a operação da empresa;
- a conexão será feita por QR Code em área administrativa protegida;
- sessões e chaves permanecerão exclusivamente no backend.

### 8.3 Comunicação bidirecional sem Chatwoot

A Evolution API realizará envio e recebimento. O Neo SST receberá respostas por webhook e terá uma caixa simples:

- conversas por trabalhador;
- campanha de origem;
- mensagens recebidas;
- mensagens enviadas;
- lida/não lida;
- resposta administrativa;
- encerramento;
- bloqueio;
- auditoria.

O Chatwoot não integra o escopo inicial. Poderá ser avaliado futuramente apenas se a caixa interna se mostrar insuficiente.

### 8.4 Dados e consentimento operacional

Registrar:

```text
whatsapp_opt_in_at
whatsapp_opt_in_source
whatsapp_opt_in_text_version
whatsapp_opt_out_at
preferred_channel
phone_verified_at
```

O trabalhador deverá dispor de canal alternativo. O WhatsApp não será o único meio possível de comunicação.

### 8.5 Respostas envolvendo saúde

As campanhas serão informativas. A caixa de resposta deverá apresentar aviso para que o trabalhador não envie diagnóstico, exame, atestado, situação vacinal ou informação médica.

Respostas administrativas poderão ser encaminhadas ao RH. O Neo SST não fará triagem clínica.

### 8.6 Requisitos técnicos

- webhook autenticado;
- validação do corpo bruto;
- prevenção de replay;
- idempotência por identificador do evento;
- fila de saída;
- retentativas limitadas;
- botão geral de interrupção;
- detecção de sessão desconectada;
- alerta ao administrador;
- bloqueio de envio após `transmission_stop_at`;
- armazenamento dos eventos no Neo SST;
- adaptador de provedor para futura troca pela Cloud API oficial.

Arquitetura:

```text
Neo SST -> Evolution API -> WhatsApp
Neo SST <- webhooks <- Evolution API
```

### 8.7 Evidência do canal experimental

Os eventos serão apresentados conforme sua origem:

- processado pelo conector;
- aceito pelo conector;
- evento de entrega recebido;
- evento de leitura recebido.

O Neo SST não classificará esses eventos como prova absoluta de ciência.

---

## 9. Avaliação de fatores psicossociais

- ciclos de avaliação;
- questionários distribuídos por token;
- token armazenado por hash;
- respostas desvinculadas do convite após submissão;
- `submission_batch_id`;
- questões obrigatórias;
- escala validada;
- tratamento de itens com pontuação reversa;
- limiar mínimo de respostas por grupo;
- resultados agregados;
- filtros por estabelecimento e departamento;
- importação controlada para o inventário de riscos;
- bloqueio de qualquer exibição de resposta individual.

---

## 10. Inventário de riscos e planos de ação

- riscos cadastrados manualmente ou importados de avaliações;
- categoria, descrição, fonte, probabilidade, impacto e classificação;
- estabelecimento e departamento;
- controles existentes;
- plano de ação;
- responsável;
- datas e status;
- hierarquia de controles;
- revisões de eficácia;
- histórico imutável;
- relatórios agregados;
- retenção conforme NR-1.

O sistema deverá produzir informação de apoio ao gerenciamento de riscos. Não realizará medições ambientais nem assumirá responsabilidade técnica.

---

## 11. Canal de denúncias

- acesso público por slug;
- denúncia anônima ou identificada;
- protocolo de acompanhamento;
- credencial/PIN armazenada com hash lento e salt individual;
- resposta anti-enumeração;
- rate limiting;
- caixa segura denunciante-investigador;
- atribuição por caso;
- controle de acesso específico;
- nenhuma exposição da função verificadora como RPC pública desnecessária;
- relatórios gerenciais apenas agregados;
- conteúdo acessível somente a pessoas autorizadas.

Não haverá anexos no canal público na primeira versão.

---

## 12. Arquivo documental

### 12.1 Finalidade

Armazenar documentos organizacionais de SST e compliance já produzidos por terceiros ou responsáveis da empresa.

### 12.2 Tipos

- PGR;
- LTCAT;
- PCMSO;
- AET;
- laudos de insalubridade e periculosidade;
- medições ambientais;
- pareceres técnicos organizacionais;
- políticas internas;
- normas de conduta;
- atas de CIPA ou CIH;
- planos de ação;
- relatórios organizacionais;
- materiais de campanhas;
- outros documentos organizacionais.

### 12.3 Funcionalidades

- upload de PDF, DOC, DOCX e imagens permitidas;
- armazenamento privado;
- segregação por tenant;
- categorização;
- vinculação a estabelecimento;
- competência/período;
- emissão e validade;
- responsável ou emissor;
- versionamento;
- alerta de vencimento;
- busca;
- filtros;
- download;
- hash;
- trilha de auditoria.

### 12.4 Proibição de documentos individuais

Não serão aceitos:

- atestados;
- ASOs individuais;
- exames admissionais, periódicos ou demissionais;
- prontuários;
- fichas de saúde;
- documentos médicos identificáveis;
- documentos pessoais de trabalhadores;
- fichas individuais de EPI neste estágio.

A restrição deverá existir na interface, nas regras server-side e nas orientações contratuais. Não será prometida detecção infalível de conteúdo por IA.

---

## 13. Documentos produzidos pelo Neo SST

### 13.1 Sem IA, na primeira etapa

O sistema poderá gerar automaticamente, a partir de dados estruturados:

- relatório de campanha;
- relatório de evidências;
- pacote de evidências;
- relatório agregado de compliance;
- relatório agregado de avaliação psicossocial;
- inventário estruturado de riscos;
- plano de ação;
- relatório de acompanhamento;
- relatório agregado de denúncias;
- pacote de desligamento.

Esses documentos terão:

- organização e período;
- escopo;
- fonte dos dados;
- versão;
- data de geração;
- hash;
- trilha de eventos;
- limitações;
- disclaimer adequado.

### 13.2 Documentos técnicos

PGR, LTCAT, PCMSO, AET e laudos técnicos permanecerão inicialmente como documentos para upload, versionamento e controle de validade.

O Neo SST poderá produzir relatórios de apoio, anexos e estruturas baseadas nos dados da plataforma, mas não declarará que o documento substitui a elaboração, avaliação ou validação exigida do responsável competente.

### 13.3 PGR

No escopo inicial, o Neo SST poderá fornecer:

- inventário de riscos psicossociais;
- metodologia utilizada;
- resultados agregados;
- critérios de classificação;
- plano de ação;
- acompanhamento de eficácia;
- histórico de versões;
- relatório ou anexo para integração ao PGR da organização.

Não será prometida geração automática de um PGR completo e tecnicamente válido sem informações adicionais e validação da organização e dos profissionais envolvidos.

---

## 14. Inteligência artificial

IA não é prioridade de lançamento.

A arquitetura ficará preparada com:

- adaptador de provedor;
- prompts controlados no backend;
- templates versionados;
- entrada exclusivamente agregada;
- bloqueio de conteúdo de denúncias e dados individuais de saúde;
- revisão humana obrigatória;
- marcação de minuta;
- disclaimer inserido fora do modelo;
- registro do modelo e da versão utilizados.

Quando ativada, a IA poderá auxiliar na redação dos relatórios já previstos e em minutas de políticas e procedimentos. Ela não substituirá a validação profissional.

---

## 15. Assinaturas

Não será implementada assinatura eletrônica nativa na primeira etapa.

### 15.1 Primeira etapa

- download do documento;
- assinatura externa;
- upload da versão assinada;
- preservação do hash;
- identificação da versão assinada.

### 15.2 Etapa futura

Integração opcional com Clicksign, ZapSign, DocuSign ou outro provedor, preferencialmente utilizando a conta da própria empresa.

Registrar:

- provedor;
- envelope/documento externo;
- signatários;
- status;
- datas;
- arquivo final assinado;
- certificado ou relatório do provedor;
- hash antes e depois;
- webhooks idempotentes.

Integração com gov.br somente será incluída se houver meio oficial e contratualmente disponível para o fluxo pretendido. Não será anunciada antecipadamente.

---

## 16. Consulta de CNPJ e grau de risco

### 16.1 CNPJ

- integração inicial com BrasilAPI ou fonte equivalente;
- preenchimento de razão social, nome fantasia, endereço e CNAEs;
- cache;
- data da consulta;
- fallback manual;
- aviso quando a fonte estiver indisponível;
- validação e normalização;
- nenhuma dependência exclusiva de serviço gratuito.

### 16.2 Grau de risco

- tabela versionada baseada no Quadro I da NR-4;
- relação entre CNAE e grau de risco;
- identificação da versão normativa;
- atualização controlada;
- exibição do CNAE principal e atividades secundárias;
- resultado automático, com possibilidade de revisão administrativa documentada;
- histórico quando a regra normativa mudar.

A dificuldade não está no cálculo, mas na qualidade do dado cadastral, nas alterações de CNAE, no versionamento normativo e na necessidade de não apresentar resultado desatualizado como definitivo.

---

## 17. Evidências, relatórios e integridade

- hash SHA-256;
- conteúdo canônico;
- data e usuário gerador;
- versão da campanha ou relatório;
- verificação de integridade;
- pacote selado e imutável;
- visualização e download auditados;
- origem de cada evento;
- manifestação clara das limitações;
- preservação da versão efetivamente apresentada ao trabalhador.

Hash comprova integridade da versão, não veracidade material de todos os dados nem ciência do destinatário.

---

## 18. Pagamentos e planos

### 18.1 Estrutura sugerida

| Plano | Até 10 | 11 a 25 | 26 a 100 |
|---|---:|---:|---:|
| **Essencial** | R$ 99,90/mês | R$ 169,90/mês | R$ 349,90/mês |
| **Completo** | R$ 249,90/mês | R$ 399,90/mês | R$ 799,90/mês |

### 18.2 Essencial

- organizações, estabelecimentos e departamentos;
- trabalhadores;
- campanhas;
- e-mail;
- WhatsApp experimental durante piloto;
- reconhecimentos;
- evidências;
- relatórios de campanha;
- arquivo documental;
- desligamento e pacote de exportação.

### 18.3 Completo

Tudo do Essencial, mais:

- avaliação psicossocial;
- inventário de riscos;
- planos de ação;
- revisões de eficácia;
- canal de denúncias;
- relatórios agregados completos.

### 18.4 IA

Não será comercializada no lançamento. Futuramente poderá ser:

- adicional por organização;
- franquia de documentos;
- consumo adicional por geração.

### 18.5 WhatsApp

Durante o piloto da Evolution API, o recurso será beta, sem SLA e sem promessa de estabilidade.

Quando houver migração para provedor oficial:

- poderá existir adicional por número conectado;
- custos do provedor poderão ser repassados;
- o cliente continuará proprietário do número;
- os preços deverão ser revistos conforme a tarifa vigente.

### 18.6 Cobrança

Integração prevista com Asaas ou equivalente:

- PIX;
- boleto;
- cartão;
- cobrança recorrente;
- webhook autenticado;
- portal de faturas;
- alteração de plano;
- tratamento gradual de inadimplência, sem apagar dados.

Os preços acima são proposta comercial de referência e deverão ser validados antes da publicação.

---

## 19. Segurança e privacidade

- RLS em todas as tabelas com dados de tenant;
- autorização explícita nas server actions;
- allowlist de campos;
- validação de tenant;
- menor privilégio;
- controle de `PUBLIC`, `anon`, `authenticated` e `service_role`;
- webhooks autenticados;
- corpo bruto na validação;
- proteção contra replay;
- idempotência;
- nenhum fallback mock em produção;
- segredos apenas no backend;
- audit logs;
- soft delete quando necessário;
- legal hold;
- backups e testes de restauração;
- segregação dos arquivos por organização;
- política de retenção por categoria.

A pendência aceita relativa a default privileges deverá permanecer registrada como risco técnico e ser compensada por revisão explícita dos grants de toda nova função.

---

## 20. Ordem de implementação

### Fase 0 — Base operacional

1. confirmar estabilidade do onboarding;
2. garantir guard de tenant;
3. corrigir qualquer rota ainda dependente de dados inexistentes;
4. configurar jobs de ciclos;
5. concluir smoke tests.

### Fase 1 — Trabalhadores e campanhas

1. ampliar o ciclo de vida dos trabalhadores;
2. implementar desligamento;
3. bloquear destinatários no momento do envio;
4. configurar e-mail;
5. criar catálogo anual oficial;
6. melhorar criação, segmentação e aprovação de campanhas;
7. gerar relatórios e pacotes de campanha.

### Fase 2 — WhatsApp experimental

1. implantar Evolution API;
2. criar conexão por organização;
3. implementar adaptador `evolution_test`;
4. implementar envio em fila;
5. implementar webhooks;
6. implementar caixa simples de respostas;
7. implementar opt-in, opt-out e kill switch;
8. homologar somente com contatos de teste;
9. executar piloto controlado.

### Fase 3 — CNPJ e enquadramento

1. integrar consulta;
2. implementar fallback;
3. criar tabela versionada de CNAE e grau de risco;
4. registrar a origem e a versão da classificação.

### Fase 4 — Arquivo documental

1. bucket privado;
2. tabela e policies;
3. upload;
4. categorização;
5. versionamento;
6. validade;
7. alertas;
8. filtros;
9. bloqueio de documentos individuais;
10. hash e auditoria.

### Fase 5 — Comercial

1. validar planos;
2. implementar checkout;
3. integrar cobrança;
4. implementar limites por faixa;
5. atualizar landing page;
6. criar portal financeiro.

### Fase 6 — Assinatura externa

1. fluxo de upload de documento assinado;
2. adaptador de provedor;
3. primeira integração;
4. webhooks;
5. preservação de evidências.

### Fase 7 — IA

1. definir templates;
2. validar qualidade;
3. implementar adaptador;
4. revisar segurança;
5. ativar apenas para dados agregados;
6. comercializar como adicional.

---

## 21. Critérios mínimos de aceite

### Campanhas

- empregado desligado não recebe envio;
- conteúdo enviado permanece versionado;
- fonte oficial é exibida;
- evento duplicado não duplica entrega;
- falha do provedor não vira sucesso;
- reconhecimento aponta para a versão correta.

### WhatsApp

- cada organização enxerga apenas sua sessão;
- sessão desconectada interrompe a fila;
- webhook inválido é rejeitado;
- evento repetido é idempotente;
- opt-out bloqueia novos envios;
- resposta aparece apenas para o tenant correto.

### Documentos

- arquivo privado;
- download auditado;
- tenant diferente não acessa;
- versão anterior permanece íntegra;
- vencimento gera alerta;
- upload proibido é bloqueado e orientado.

### Desligamento

- datas distintas são aceitas;
- transmissão para na data correta;
- status muda automaticamente;
- histórico não é apagado;
- legal hold impede eliminação;
- pacote de exportação possui hash.

### Avaliações e denúncias

- anonimato preservado;
- tenant cruzado bloqueado;
- limiar aplicado;
- protocolo inexistente não permite enumeração;
- investigador acessa somente casos autorizados.

---

## 22. Fora do escopo inicial

- assinatura eletrônica nativa;
- integração gov.br prometida;
- IA em produção;
- Chatwoot;
- API pública de exportação;
- anexos no canal público de denúncias;
- documentos médicos individuais;
- prontuário ocupacional;
- eSocial;
- ERP/RH customizado;
- infraestrutura dedicada;
- SLA enterprise;
- serviços profissionais de SST;
- geração automática de laudos;
- decisão clínica ou trabalhista automatizada.

---

## 23. Decisões consolidadas

1. O produto começa focado em empresas de até 25 trabalhadores e aceita até 100.
2. Haverá faixa competitiva específica para empresas de até 10 trabalhadores.
3. Campanhas serão baseadas em fontes oficiais e terão links para o Ministério da Saúde.
4. Atualizações oficiais gerarão rascunhos para revisão, não disparos automáticos cegos.
5. E-mail será o canal estável inicial.
6. Evolution API poderá ser usada em piloto experimental.
7. Não haverá Chatwoot no escopo inicial.
8. O Neo SST receberá respostas de WhatsApp diretamente por webhook.
9. Cada empresa utilizará seu próprio número.
10. O desligamento interromperá automaticamente transmissões.
11. Dois anos serão marco de revisão, não exclusão automática.
12. O sistema gerará pacote de exportação por ex-trabalhador.
13. Arquivo documental aceitará somente documentos organizacionais.
14. PGR e outros documentos técnicos completos serão inicialmente anexados, não produzidos como válidos automaticamente.
15. Relatórios estruturados e evidências serão produzidos sem IA.
16. IA ficará preparada para etapa posterior.
17. Assinatura será inicialmente externa, com integração futura opcional.
18. A classificação CNAE/grau de risco será versionada e terá fallback.
19. Hash demonstrará integridade, sem ser apresentado como prova absoluta de ciência ou veracidade.
20. O Neo SST continuará sendo SaaS tecnológico, sem prestação de serviços profissionais de SST.

---

## 24. Referências principais

- LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm
- Constituição Federal, art. 7º, XXIX: https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm
- NR-1: https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadoras/normas-regulamentadoras-vigentes/nr-01-atualizada-2025-i-1.pdf
- Calendário da Saúde: https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/c/calendario/saude
- Calendário Nacional de Vacinação: https://www.gov.br/saude/pt-br/vacinacao/calendario
- WhatsApp Messaging Guidelines: https://www.whatsapp.com/legal/messaging-guidelines
- WhatsApp Business Messaging Policy: https://whatsappbusiness.com/policy/
- Evolution API: https://github.com/evolution-foundation/evolution-api

---

**Este documento consolida decisões de produto. Ele não executa migrations, não altera banco de dados, não edita a aplicação e não autoriza implantação automática.**
