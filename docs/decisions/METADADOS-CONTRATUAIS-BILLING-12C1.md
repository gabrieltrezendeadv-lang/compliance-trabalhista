# Etapa 12C.1 — Metadados contratuais e contato financeiro

> **Estado de produção nesta etapa: 40/40, e assim permanece.**
> A migration `20260810120000_billing_contract_metadata.sql` fica **pendente**
> até autorização separada. Nada aqui foi aplicado ao banco remoto.
>
> Billing continua **desligado**. Nenhuma página, nenhum checkout, nenhum preço
> exposto. O Asaas continua **não implementado e não chamado**.

## 1. O que esta etapa entrega

Três colunas em `billing.subscriptions`:

| Coluna | Tipo | Obrigatória? |
| --- | --- | --- |
| `billing_email` | `text NULL` | **não** — contato financeiro é opcional |
| `terms_version` | `text NULL` | obrigatória em **trial novo**; nula nas linhas anteriores |
| `terms_accepted_at` | `timestamptz NULL` | sempre casada com `terms_version` |

E duas RPCs em `public`, elevando a exceção nominal de **16 para 18**:

* `fn_billing_update_billing_email(uuid, uuid, text, timestamptz, text)`
* `fn_billing_accept_terms(uuid, uuid, text, timestamptz, text)`

Mais a **troca de assinatura** de `fn_billing_start_trial`, que passa a receber
contato financeiro, versão dos termos e instante do aceite.

## 2. Por que duas RPCs novas, e não reaproveitamento

O contato financeiro muda **depois** do trial: alguém troca o e-mail do setor
financeiro. Uma versão nova dos termos também é aceita depois do trial. Nenhuma
das duas coisas é troca de plano nem contagem de trabalhadores.

Encaixar qualquer uma em `fn_billing_change_plan` ou em
`fn_billing_record_worker_count` seria abuso de responsabilidade: a RPC passaria
a aceitar parâmetros sem relação com o que o nome promete, e a auditoria
registraria `plan_change` para algo que não é troca de plano.

As duas novas são **estreitas de propósito** — cinco parâmetros cada, e nenhuma
aceita plano, faixa, estado ou contagem. Uma RPC que pode mudar duas coisas é
uma RPC que se pode enganar a mudar a segunda.

**Consequência declarada:** o conjunto autorizado em `public` deixou de ser 16.
Onde a documentação da 12B fala em dezesseis, ela descreve o estado daquela
etapa. O estado **vigente** é 18, e é o que a allowlist, o catálogo
independente e os dois verificadores cobram.

## 3. A prova do aceite vai para `billing.audit_events`

Nenhuma tabela nova. `audit_events` já carrega, desde a 12A e a 12B, tudo o que
o aceite precisa provar: `organization_id`, `subject`, `actor_id`, `origin`,
`occurred_at`, `new_value` (onde vai a versão) e `correlation_id`. É append-only
por regime de privilégio — ninguém tem `UPDATE`, `DELETE` nem `TRUNCATE`.

Criar uma segunda tabela com as mesmas colunas duplicaria a trilha e abriria a
pergunta de qual das duas vale.

O **conteúdo** dos termos fica fora do banco. Entra a **versão**, que identifica
o documento publicado de forma imutável. Guardar o texto faria de cada aceite
uma cópia de algo que já é público e já é versionado.

## 4. E-mail na auditoria: máscara, e o porquê

`audit_events` é append-only e ninguém a apaga. Gravar o endereço inteiro a cada
troca criaria um histórico **imutável** de dado pessoal — exatamente o que não
se consegue atender quando alguém pede correção ou eliminação. A coluna corrente
é corrigível; a trilha não seria.

A trilha grava a **máscara** (`f***@empresa.com.br`): preserva "mudou, de algo
neste domínio para algo naquele", que é o que uma auditoria de contato precisa,
sem imobilizar o endereço.

**Hash foi considerado e descartado:** hash de e-mail é reversível por
dicionário. Não seria menos pessoal, só menos legível.

O endereço também não aparece em mensagem de erro. Mensagem de erro vai para
log, tela e relatório — e um endereço rejeitado continua sendo o endereço de
alguém.

## 5. Onde a versão oficial é decidida

| Camada | O que garante |
| --- | --- |
| Banco (`20260810120000`) | par completo, versão não vazia, formato `AAAA-MM-DD`, e **proibição de regredir** para versão anterior à já aceita |
| Servidor (`src/lib/billing/terms.ts`) | que a versão persistida é a **vigente** |

O banco **não** conhece qual é a versão oficial, e isso é deliberado: fixá-la em
DDL exigiria uma migration a cada publicação de termos, e esta etapa existe
justamente para que um aceite novo **não** precise de DDL.

O formulário da 12C.3 vai mandar de volta a versão que exibiu. Isso é
necessário — é como se detecta a tela aberta antes da publicação de termos
novos. Mas o que chega é **afirmação**, conferida por `exigirVersaoVigente`
antes de qualquer chamada; e o que se persiste é a constante, nunca a string
recebida.

O formato de data não é enfeite: é o que faz a comparação lexical coincidir com
a cronológica, e é assim que `fn_billing_accept_terms` proíbe regressão **no
banco**, sem tabela de versões publicadas.

## 6. Rollback: o que volta e o que não volta

`supabase/rollbacks/20260810120000_billing_contract_metadata_rollback.sql`
devolve a assinatura anterior de `fn_billing_start_trial` (mesmo corpo, não
"equivalente"), remove as duas RPCs desta etapa, restaura ACL e owner, e só
então remove as três colunas.

**Ele aborta antes de destruir prova**, e distingue duas situações que parecem
uma só:

| Situação | O rollback | Por quê |
| --- | --- | --- |
| Assinatura com e-mail, versão ou instante | **aborta**, com diagnóstico | o valor mora nas colunas que ele remove; removê-las apaga o dado |
| Trilha com `terms_acceptance`/`billing_email` | **avisa alto**, e segue | as linhas ficam onde estão: `audit_events` é append-only por gatilho, e o rollback não a toca |

Abortar pela trilha impediria a reversão por causa de um dado que **sobrevive**
a ela — e tornaria o próprio rollback impossível de ensaiar, já que o gatilho
append-only recusa qualquer `DELETE` na trilha, inclusive do dono da tabela.
O aviso é obrigatório: depois de reverter, a trilha continua atestando aceites
que o schema deixou de registrar.

O CI **exercita** a recusa: com dado contratual presente, exige que o rollback
recuse com `ABORTADO` e com diagnóstico; só então limpa as colunas da
assinatura — nunca a trilha — e reverte de verdade.

**O que não volta, e está dito:** os rótulos `terms_acceptance` e
`billing_email` permanecem em `billing.audit_subject`. O PostgreSQL não tem
`ALTER TYPE ... DROP VALUE`, e recriar o enum exigiria derrubar a coluna
`subject` de `audit_events` — a trilha inteira. Rótulo sem uso não concede
privilégio e não guarda dado, mas fingir reversão total seria mentira.

## 7. Estado de aplicação

| | |
| --- | --- |
| 12A `20260801120000_billing_foundation.sql` | **aplicada** — execução `30870009332` |
| 12B `20260802093000_billing_orchestration.sql` | **aplicada** — execução `31041386635` |
| Ledger remoto | **40**, sem pendência |
| 12C.1 `20260810120000_billing_contract_metadata.sql` | **pendente** |
| Estado de produção | **40/40** |

A 12C.1 é a **única** migration pendente, e é a mais antiga pendente — que é o
que a pré-condição **P8** (`scripts/ci/assert-apply-preconditions.mjs`) exige
para aceitar uma aplicação. Aplicá-la é decisão separada, e este documento não
a autoriza.

## 8. O que esta etapa deliberadamente NÃO faz

* **Não habilita billing.** `BILLING_ENABLED` continua ausente, e o registry
  continua fail-closed sob `BILLING_PROVIDER`.
* **Não cria página nem checkout**, não expõe preço e não cria server action.
  A interface é da **12C.3**; até lá, as duas RPCs novas existem e ninguém as
  chama em produção.
* **Não implementa o Asaas.** `resolveBillingProvider` continua levantando
  `BillingProviderNotImplementedError` para `asaas` — o adaptador é a 12D.
* **Não remove as cinco tabelas legadas** de `public`.
* **Não altera nenhuma das 40 migrations anteriores.** `CM-01` sela as 40 por
  hash e reprova qualquer mudança.

## 9. Onde cada propriedade é provada

| Propriedade | Onde |
| --- | --- |
| Colunas, tipos, nulidade, CHECKs validados | `scripts/ci/verify-applied/20260810120000.sql` |
| Versão vazia/malformada recusada, e-mail normalizado, máscara sem endereço | idem, executando os auxiliares |
| Autorização antes de tudo; recusa indistinguível entre alheia e inexistente | idem |
| Conjunto exato de 18, ACL, owner, `SECURITY DEFINER`, `search_path` | idem + `scripts/ci/assert-billing-rpcs.sql` |
| Trial sem aceite recusado **sem deixar rastro** | `scripts/ci/assert-billing-orchestration.sql` §B.7 |
| **Falha da auditoria desfazendo a operação inteira** | idem, com constraint temporária `NOT VALID` |
| CHECKs rejeitando linha real; membro comum recusado | idem §B.7/§B.8 |
| Máscara na trilha; idempotência; regressão proibida | idem §B.8 |
| Paridade memória × PostgREST | `tests/contract/shared-expectations.ts` |
| Versão vigente comparada no servidor | `tests/unit/billing/terms.spec.ts` e `.../usecases/contract-metadata.spec.ts` |
| Estrutura, rota, rollback, allowlist | `tests/billing-contract-metadata-guard.mjs` |
| Que as guardas acima têm dente | `tests/billing-contract-metadata-mutation-guard.mjs` |
