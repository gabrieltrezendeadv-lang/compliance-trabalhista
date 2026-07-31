# Decisão — Planos, precificação e cobrança do Neo SST

**Status:** aprovada e vigente para a fundação (Etapa 12A).
**Data da decisão:** 2026-07-30.
**Escopo desta etapa:** fundação. Nenhum preço público, nenhum checkout, nenhuma
chamada ao Asaas, nenhuma cobrança. A feature flag nasce desligada.

Este documento é a fonte única da especificação comercial. Onde ele divergir de
`docs/planning/NEO-SST-ESCOPO-CONSOLIDADO-v2.md` §18, **este documento prevalece**
— a §18 declara-se explicitamente "proposta comercial de referência […] deverá
ser validada antes da publicação", e esta é a validação.

---

## 1. Planos e preços

Dois planos comerciais — **Essencial** e **Completo** — precificados por faixa de
trabalhadores. Acima de 100 trabalhadores, **Enterprise sob proposta**, sem
checkout automático.

| Trabalhadores | Essencial/mês | Essencial/ano | Completo/mês | Completo/ano |
| ------------- | ------------: | ------------: | -----------: | -----------: |
| 1–20          |      R$ 99,90 |   R$ 1.078,92 |    R$ 249,90 |  R$ 2.698,92 |
| 21–50         |     R$ 169,90 |   R$ 1.834,92 |    R$ 399,90 |  R$ 4.318,92 |
| 51–100        |     R$ 349,90 |   R$ 3.778,92 |    R$ 799,90 |  R$ 8.638,92 |
| acima de 100  |  sob proposta |             — | sob proposta |            — |

### Regras de precificação

* **Centavos inteiros.** Todo valor monetário é `integer`, em centavos. Nenhum
  cálculo de preço usa ponto flutuante, em nenhuma camada.
* **Anual = 12 mensalidades com 10% de desconto**, isto é `(mensal × 12 × 9) / 10`.
  Os seis valores acima fecham exatos em centavos; o cálculo aborta se a divisão
  por 10 não for exata, em vez de arredondar em silêncio.
* Taxas do Asaas estão **incluídas** nos valores acima.
* **Sem limites comerciais** de usuários, estabelecimentos, departamentos ou
  campanhas. Proteção técnica contra abuso pode existir, mas **não é limite
  comercial e não pode ser apresentada como tal**.
* A quantidade de trabalhadores é **informada pelo proprietário** e **auditada**.
* Mudança de faixa entra em vigor **no próximo ciclo** e **nunca bloqueia dados**.

## 2. Recursos por plano

**Essencial**
estabelecimentos · departamentos · usuários · documentos e evidências ·
planos de ação · campanhas manuais · relatórios básicos · **2 GB** de
armazenamento.

**Completo** — tudo do Essencial, mais
Riscos · Denúncias · campanhas automáticas e alertas · relatórios avançados ·
histórico · selo/hash · suporte prioritário · **10 GB** de armazenamento.

Recursos exclusivos do Completo aparecem na interface **com cadeado**. O cadeado
é apresentação. **O bloqueio real é server-side** — uma interface que apenas
esconde o botão não é controle de acesso.

## 3. Trial e cobrança

* Trial de **7 dias**, **sem cadastrar meio de pagamento**.
* O cliente testa **o plano que escolheu**, não um plano genérico.
* **CNPJ obrigatório** para iniciar o trial.
* Meios: **PIX** e **cartão**.
* Cartão mensal: recorrente. PIX mensal: gera cobrança a cada mês.
* Anual: **PIX à vista** ou **cartão em até 12 vezes**.
* Cartão anual renova automaticamente; PIX anual gera nova cobrança.
* Aviso de renovação anual com **30 dias** de antecedência.
* Alteração de preço avisada com **30 dias** de antecedência da renovação.
* **Somente o proprietário** contrata, altera ou cancela.

## 4. Ciclo de vida

* Fim do trial sem contratação → **modo leitura**.
* Falha de pagamento → **7 dias com acesso normal** (tolerância), depois **modo
  leitura**.
* **Upgrade: imediato**, cobrando a diferença proporcional.
* **Downgrade: na renovação**, sem crédito retroativo.
* **Cancelamento: ao fim do período pago.**
* Sem devolução proporcional, **ressalvados erros e direitos legais**.
* Dados exclusivos de um plano anterior **permanecem visíveis em modo leitura**.
* **Nenhum dado é apagado** por downgrade ou por inadimplência.
* Após encerramento definitivo: **12 meses em modo leitura**.
* Antes de qualquer exclusão: avisos e **arquivo completo para retirada dos
  dados**.

## 5. Organizações existentes (grandfathering)

* **Somente organizações existentes na data de corte**, identificadas por
  `organization_id`, recebem **Essencial gratuito permanente**.
* O benefício **pertence à organização**, não ao usuário.
* Organizações **novas**, criadas pelos mesmos usuários, **não** recebem o
  benefício.
* Upgrade e posterior cancelamento **não extinguem** o direito adquirido: a
  organização retorna ao Essencial gratuito.
* **Cortesias administrativas** exigem prazo, motivo, autor e auditoria.
* **Sem cupons públicos** no lançamento.

**A data de corte NÃO é fixada nesta etapa.** O mecanismo é modelado de forma
determinística e auditável; sua ativação é fase posterior. Enquanto a data de
corte não estiver registrada, nenhuma organização é elegível — o padrão é negar.

## 6. Comunicações

* Avisos por **e-mail** e **dentro da plataforma**.
* Trial: **D−3**, **D−1** e encerramento.
* Cobrança: **D−3**, vencimento, **D+1**, **D+4** e **D+7**.
* Destinatários: proprietário e **e-mail financeiro configurável**.
* Enterprise: formulário e e-mail comercial.
* SLA de suporte: **Essencial até 2 dias úteis**, **Completo até 1 dia útil**.
* **Emissão automática de nota fiscal fica fora desta etapa.**

## 7. Sequência obrigatória de lançamento

1. provider **mock**;
2. Asaas **sandbox**;
3. **conta piloto interna**;
4. **produção**.

Preços públicos e checkout só podem ser ativados **depois de todos os gates**.

---

## 8. Decisões técnicas desta etapa

### 8.1 Schema próprio `billing`

Toda a estrutura nova vive no schema PostgreSQL `billing`, **não** em `public`.

**Por quê:**

1. **Inalcançável pelo cliente.** O schema não é exposto ao PostgREST. `anon` e
   `authenticated` não conseguem endereçar as tabelas — o requisito "nenhum
   cliente altera plano, preço, status, grandfathering ou cortesia" passa a ser
   propriedade da topologia, e não apenas de policy. RLS e grants explícitos
   entram como defesa em profundidade.
2. **Preserva as âncoras de verificação.** `supabase/baseline/schema.sql` é
   gerado com `pg_dump --schema=public`, e `scripts/ci/extract-security.sql`
   filtra `nspname = 'public'`. O schema `billing` é invisível para ambos —
   Âncora A, Âncora B e o diff de segurança do `migration-rebuild-verify`
   continuam valendo sem redeclaração de deltas estruturais.
3. **Isola o legado.** `public.subscription_plans` e `public.tenant_subscriptions`
   permanecem onde estão, sem que o modelo novo herde suas contradições.

**Custo declarado, e ele é real.** A mesma invisibilidade que protege as âncoras
é perda de cobertura: `scripts/ci/assert-no-public-execute.sql` só varre
`public`. A compensação é `scripts/ci/assert-billing-security.sql`, executado no
job `Verify` do CI **contra PostgreSQL de verdade**, na stack descartável, com
asserções de catálogo **e** teste comportamental de imutabilidade do price
snapshot.

**Consequência para as etapas seguintes.** A partir da 12B será preciso expor o
schema ao PostgREST ou criar funções `SECURITY DEFINER` em `public` como fachada.
Registrado aqui para que a escolha seja consciente, e não descoberta no meio da
implementação da interface.

### 8.1.1 `FORCE ROW LEVEL SECURITY`: ausência deliberada

RLS é habilitada em todas as tabelas, com **zero policies** — que no PostgreSQL
é negação total. `FORCE` **não** é usado, e a decisão é explícita.

`FORCE` faz a RLS valer também para o **dono** da tabela. Aqui isso quebraria
dois consumidores legítimos que se conectam como dono: o verificador
independente da rota de aplicação (`scripts/ci/verify-applied/20260801120000.sql`),
que lê `billing.price_catalog` e `billing.tiers` para conferir o efeito da
migration — com `FORCE` leria vazio e reprovaria uma aplicação correta —, e a
própria rota de migrations, que conecta com o usuário `postgres`.

O que `FORCE` acrescentaria seria proteção contra acesso em contexto de dono, e
nenhum caminho da aplicação usa esse contexto: o cliente PostgREST não alcança o
schema, e o servidor usará `service_role`.

A ausência de `FORCE` só é aceitável porque **`service_role` tem `BYPASSRLS`** —
é isso que torna "RLS ligada + zero policies" utilizável pelo servidor na Etapa
12B sem que nenhuma policy precise existir, e portanto sem nenhuma brecha para
`anon` ou `authenticated`. A migration **aborta** se essa premissa não valer no
banco onde for aplicada (pós-condição 12.8c), e a asserção do CI verifica as
duas condições juntas, porque só juntas fazem sentido.

### 8.2 Planos antigos: desativados, não removidos

`public.subscription_plans` (Starter / Professional / Enterprise, R$ 199 / 499 /
1.499) contradiz este documento em nome, em valor e em modelo de cobrança. A
migration os marca `is_active = false`.

Não são removidos: `public.tenant_subscriptions.plan_id` os referencia, e a
regra do repositório é forward-only não destrutivo. Desativar preserva toda
referência existente.

**O estado anterior é capturado antes da desativação**, linha a linha, em
`billing.legacy_plan_state`. `is_active` é `boolean DEFAULT true` e **não** é
`NOT NULL`: os valores possíveis são `true`, `false` e `NULL`. Um rollback que
fizesse `SET is_active = true` para os slugs conhecidos estaria errado em dois
casos reais — plano que já estivesse desativado antes da migration voltaria
ativo, e plano com `NULL` viraria `true`. O banco terminaria num estado que
nunca existiu, e o defeito seria invisível.

Por isso o rollback restaura a partir da captura (`billing.fn_restore_legacy_plans()`),
e não de uma suposição. O comportamento é exercido contra PostgreSQL real,
incluindo os dois cenários que a versão ingênua errava.

### 8.3 Fim do fail-open

`enforcePlanLimit` devolvia `{ allowed: true }` em qualquer erro de RPC. Como
`check_plan_limit` está com `EXECUTE` revogado de todos os papéis (SEC-002), o
erro era **garantido** — o guard aprovava sempre.

A regra nova, sem exceção:

* **erro ao verificar entitlement nunca produz `allowed: true`**;
* com billing **ativo**, falha de verificação **nega** a operação;
* com billing **desativado**, a permissão sai por um **bypass explícito e
  identificável da feature flag** (`reason: "billing_disabled"`,
  `bypass: true`), **jamais** por captura genérica de erro.

A distinção importa porque as duas situações são indistinguíveis no log quando
se usa `catch → allow`: "não havia assinatura" e "não consegui verificar"
colapsam no mesmo resultado. Aqui elas são estados diferentes.

O novo guard **não chama** `check_plan_limit`. SEC-002 permanece intacta e
nenhum `GRANT` é reconcedido.

### 8.4 Autorização

Somente `organization_members.role = 'owner'` administra billing. A verificação é
server-side (`src/lib/billing/authorization.ts`) **e** estrutural (o schema é
inalcançável pelo cliente). A interface nunca é o único controle.

O papel é **conferido no objeto devolvido**, além de filtrado na consulta. Não é
redundância: um filtro que deixasse de ser aplicado — por refatoração, por RLS
ausente — passaria despercebido se a decisão dependesse só dele.

**O identificador de organização vindo do cliente nunca autoriza.** A Etapa 12B
receberá `organizationId` de formulário, de rota ou de corpo de requisição, e
esse é o formato clássico do IDOR: o servidor confirma "é owner de alguma
coisa" e depois opera sobre o identificador que o cliente mandou. Por isso
`requireBillingOwnerFor()` já é entregue nesta etapa: ela resolve a organização
no servidor e **compara**; divergência é recusa, com `not_owner` tanto para
organização alheia quanto para inexistente — uma mensagem distinta viraria
oráculo de enumeração.

### 8.4.1 Fail-closed também para exceção e timeout

Toda entrada de verificação está dentro de `try`, e **todo `catch` nega**.

Sem isso, uma exceção — `createClient` falhando, `fetch` estourando por timeout,
resposta malformada quebrando a desestruturação — sairia por cima da decisão. O
chamador típico é `if (!guard.allowed) return { error }`, que nunca roda quando
a promessa rejeita: a operação aborta com erro não tratado. Abortar não
autoriza, então já era fail-closed — mas fail-closed **por acidente**, dependendo
de como cada chamador reage. Agora a exceção vira negação explícita, com motivo
nomeado, que todo chamador trata igual.

Resposta malformada (linha sem `tenant_id` utilizável) é `verification_failed`,
e não `no_organization`: "não consigo confiar no que recebi" é um estado
diferente de "não há organização".

### 8.5 Versionamento de preço

O preço contratado é **congelado num snapshot imutável** no momento da
contratação. Alteração futura de tabela de preços **não pode** reescrever fatura
ou período já emitido. A imutabilidade é imposta por trigger no banco
(`billing.tg_price_snapshot_immutable`), não apenas por convenção de código, e é
testada por comportamento contra PostgreSQL real.

### 8.6 Auditoria

Toda mudança de `worker_count`, faixa, plano (upgrade/downgrade), cortesia,
grandfathering e status de assinatura é registrada em `billing.audit_events`,
com autor, momento, valores anterior e novo. A tabela é append-only por trigger.

---

## 9. O que esta etapa NÃO faz

Landing com preços · checkout · página ativa de billing · upgrade/downgrade pela
interface · chamadas reais ao Asaas · secrets do Asaas · webhook exercitado
contra provider real · notificações reais · exportação de encerramento ·
exclusão após 12 meses · nota fiscal · ativação da feature flag · aplicação da
migration em produção.

Esses itens pertencem às Etapas 12B–12E.
