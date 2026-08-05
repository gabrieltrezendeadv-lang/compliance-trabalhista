# Etapa 12C.0 — Aposentadoria do runtime legado de billing

**Status:** runtime legado removido. Billing **continua desligado**.
**Não** inicia a 12C.1, **não** cria migration, **não** ativa jornada comercial.

---

## 1. O problema

Até a 12B o repositório carregava **dois mundos de billing** ao mesmo tempo.

O **novo** (12A + 12B) estava correto e inerte: schema `billing` fechado, 16
RPCs em `public` com `EXECUTE` só para `service_role`, `service_role` sem
privilégio direto nas tabelas. Nada em `src/app/` ou `src/components/` o
importava.

O **antigo** estava parcialmente **vivo**:

| Item | O que fazia |
| --- | --- |
| `src/app/api/webhooks/billing/route.ts` | rota real; escrevia em `tenant_subscriptions`, `invoices` e `billing_events` com service-role, e **não consultava a feature flag** |
| `src/lib/billing/actions.ts` | `"use server"`; escrevia direto nas tabelas legadas e chamava `check_plan_limit`, cujo `EXECUTE` a SEC-002 revogou de todos os papéis |
| 4 componentes em `src/components/billing/` | órfãos, mas importando o `actions.ts` |
| interruptor de webhook inseguro | permitia pular a verificação de assinatura fora de produção |
| `registry.ts` | escolhia o provider **pela presença de `ASAAS_API_KEY`** |

Construir a jornada comercial por cima disso criaria **dois estados de
assinatura divergentes no mesmo tenant** — e o divergente seria justamente o
que não tem guarda. Por isso a aposentadoria vem antes da 12C.1.

## 2. O que foi removido

Os seis arquivos da tabela acima, o interruptor inseguro (nome literal
eliminado de todo código executável e do `.env.example`), e a seleção de
provider por efeito colateral.

## 3. O que **não** foi tocado

As **cinco tabelas legadas em `public`** — `subscription_plans`,
`tenant_subscriptions`, `invoices`, `usage_records`, `billing_events` —
**continuam no banco**. Tirar tabela é migration, com rollback e rodada própria
de aplicação; não é coisa de PR de limpeza de código.

O que esta etapa garante é outra coisa, e é suficiente por ora: **nenhum código
de aplicação sabe escrevê-las**. `LR-04` varre `src/` inteiro e reprova qualquer
`.from("<tabela legada>")`; `MUT-LR-05` prova isso uma tabela por vez.

Também intactos: migrations históricas, 12A, 12B, rollbacks, verificadores,
baseline, manifesto, denylist, schema `billing`, as 16 RPCs, a feature flag,
`/dashboard/billing`, landing, sidebar e as regras de acesso aos módulos.

## 4. Seleção de provider — de efeito colateral para intenção

**Antes:** se `ASAAS_API_KEY` existisse no ambiente, o Asaas real era
selecionado. Criar um secret — operação rotineira, feita por quem está
configurando outra coisa — **ligava cobrança real sem que ninguém tivesse
decidido ligar cobrança real**.

**Agora:** `BILLING_PROVIDER` vale `mock` ou `asaas`, e é a única coisa que
seleciona. A chave voltou a ser configuração.

| Situação | Desfecho |
| --- | --- |
| seletor ausente ou vazio | `BillingProviderNotConfiguredError` |
| seletor desconhecido | `BillingProviderNotConfiguredError`, citando o valor recebido |
| `mock` com `NODE_ENV=production` | `MockProviderForbiddenInProductionError` |
| `mock` com `VERCEL_ENV=production` | `MockProviderForbiddenInProductionError` |
| `asaas` com configuração incompleta | `BillingProviderNotConfiguredError`, nomeando o que falta |
| `asaas` completo | `BillingProviderNotImplementedError` — o adaptador é a 12D |
| `ASAAS_API_KEY` presente, sem seletor | **não seleciona nada** |

Nenhum caminho devolve provider degradado, e não há queda para lado nenhum.

O `asaas` **valida a configuração inteira antes** de recusar por não
implementado. A ordem importa: validar primeiro faz a mensagem dizer o que
falta configurar, em vez de esconder configuração incompleta atrás de "não
implementado".

O registry **não lê `BILLING_ENABLED`**. Quem decide se billing está ligado é o
chamador, antes de pedir provider — misturar as duas decisões faria "flag
desligada" e "provider não configurado" produzirem o mesmo diagnóstico, e são
problemas diferentes.

## 5. Provas

| Camada | Onde | O que prova |
| --- | --- | --- |
| Estática | `tests/billing-legacy-retirement-guard.mjs` (13) | ausência dos seis arquivos, dos cinco caminhos de escrita, de `check_plan_limit`, do interruptor; forma do registry; jornada desligada; tabelas legadas ainda declaradas na migration histórica |
| Mutação | `tests/billing-legacy-retirement-mutation-guard.mjs` (24) | que cada item **ressuscitado** reprova — inclusive remover a própria guarda do `verify` |
| Comportamento | `tests/unit/billing/registry.spec.ts` (18) | as sete linhas da tabela acima, mais determinismo do mock e não vazamento de secret na mensagem |
| E2E | `tests/e2e/billing-retired.spec.ts` (6) | que a **aplicação construída** não atende `/api/webhooks/billing`, e que nem a landing nem `/dashboard/billing` expõem plano, preço ou checkout |

O E2E existe porque asserção sobre arquivo não é a mesma coisa que asserção
sobre servidor: um `rewrite`, um middleware ou uma rota dinâmica poderiam servir
aquele caminho mesmo sem o arquivo. A rota vizinha `/api/webhooks/[provider]`
aceita apenas `whatsapp`; o resto cai em 404.

## 6. Asserções que mudaram de forma, e por quê

Nenhuma foi descartada para obter verde.

* **P0-05** e **P0-06** cobravam a forma correta de dois arquivos que deixaram
  de existir. Viraram asserções de **ausência** em `LR-01`/`LR-03` — mais forte:
  cobrar que um arquivo perigoso está certo é menos do que cobrar que ele não
  existe.
* **P0-04** e **BO-09** cobravam "nunca cair no mock" na forma antiga do
  registry; passaram a cobrar a mesma propriedade na forma nova.
* **MUT-B03** e **MUT-37** ancoravam em texto que sumiu; foram reancoradas
  preservando o defeito que detectam.
* **TG12-13** listava `actions.ts` entre os alvos; a regra continua cobrada nos
  nove restantes.

## 7. Limites que permanecem

* As cinco tabelas legadas **seguem no banco de produção**. A remoção física é
  migration futura, com rollback.
* O adaptador do Asaas para o contrato da 12B **não existe** — é a 12D.
* `providers/asaas.ts`, `providers/mock-billing.ts` e `types.ts` continuam no
  repositório, agora **inalcançáveis pelo registry**. Serão reavaliados na 12D,
  quando o adaptador novo for escrito.
* Billing continua **desligado**; não há UI, checkout nem preço público.
* **A 12C.1 não começou.**
