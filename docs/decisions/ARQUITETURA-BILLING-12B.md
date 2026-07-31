# Etapa 12B — Orquestração server-side e provider mock

**Status:** implementada, **desligada e inalcançável**.
**Fonte normativa das regras comerciais:** `docs/decisions/PLANOS-E-PRECIFICACAO.md`.

> **O que esta etapa NÃO entrega, e é preciso dizer sem rodeio:**
> não há interface, não há checkout real, não há Asaas real, não há notificação.
> As duas migrations de billing (`20260801120000` e `20260802093000`) **permanecem
> pendentes** — nenhuma foi aplicada em produção. A feature flag **continua
> desligada**, e nenhuma variável precisa ser criada na Vercel.
> Billing **não está disponível**.

---

## 1. Arquitetura

```
usecases/            orquestração — autoriza, lê, decide com função pura, grava, audita
  ├── shared.ts      assertTenant · auditar · reservar (idempotência)
  ├── subscription   startTrial · choosePlan · expireTrial · renew · upgrade ·
  │                  scheduleDowngrade · cancelAtPeriodEnd · recordWorkerCount
  ├── payments.ts    createMockCheckout · recordPaymentSucceeded/Failed · advanceGracePeriod
  └── access.ts      resolveBillingAccess · resolveGrandfatheredAccess ·
                     grantCourtesy · revokeCourtesy
core/                contratos e portas
  ├── ports.ts       Clock · IdGenerator · BillingAuthContext · origem da ação
  ├── errors.ts      BillingError (código fechado) · Result<T>
  ├── repository.ts  BillingRepository
  └── provider.ts    BillingProviderPort
repositories/        in-memory (teste) · supabase (servidor, `server-only`)
providers/mock/      BillingProviderMock — determinístico, sem rede
plans/               [12A] catálogo, preços, entitlements, ciclo de vida, elegibilidade
```

O domínio da 12A permanece **intocado**: a 12B só orquestra. Nenhum cálculo
comercial foi reimplementado aqui.

## 2. Determinismo

Relógio, gerador de identificador, repositório, provider, contexto de
autorização e organização entram **por argumento**. No domínio são proibidos
`new Date()`, `Date.now()`, `Math.random()`, geração de UUID, `fetch` e leitura
de `process.env`. `BO-01`, `BO-02` e `BO-03` reprovam a reintrodução; `MUT-B15`
a `MUT-B19` provam que reprovam.

Sem isso, a borda "último milissegundo do trial" seria intestável e a
idempotência, indemonstrável.

## 3. Modelo de erro

`Result<T>` — nenhum caso de uso lança para o chamador. Códigos fechados:
`unauthorized`, `not_owner`, `tenant_mismatch`, `not_found`, `conflict`,
`invalid_state`, `invalid_input`, `repository_unavailable`,
`provider_unavailable`, `provider_timeout`, `duplicate_event`,
`out_of_order_event`, `misconfigured`.

**Nenhum código significa "deu errado, mas pode seguir".** `fromThrown` aceita,
por tipo, apenas códigos de indisponibilidade — o compilador impede que uma
exceção desconhecida vire sucesso.

`not_owner` cobre deliberadamente dois casos — organização inexistente e
organização alheia. Distingui-los entregaria "esta organização existe" a quem
varre identificadores.

## 4. Autorização

`assertTenant` roda em todo comando: exige `role === "owner"` e **compara** o
`requestedOrganizationId` vindo do cliente com o resolvido no servidor.
O identificador do cliente **nunca autoriza** — só é comparado.

O ator da auditoria vem do **contexto**, nunca do argumento: aceitá-lo por
parâmetro permitiria atribuir a ação a outra pessoa.

## 4.1 O caminho real até o banco

**`billing` NÃO é exposto ao PostgREST, e continua não sendo.**

A primeira versão desta etapa alcançava o schema com
`.schema("billing").from(...)`, e **nunca funcionou**: `.schema()` do
supabase-js não abre conexão SQL — define o cabeçalho HTTP `Accept-Profile`,
e o PostgREST recusa qualquer schema fora de `db-schemas` com **PGRST106**.
Nenhum teste percebeu porque nenhum teste instanciava a classe.

O acesso passou a ser exclusivamente por **dezesseis RPCs em `public`**, que é
o único schema exposto. Elas rodam como owner e alcançam `billing` por dentro;
o `service_role` perdeu todo privilégio direto, **inclusive `USAGE` no
schema**. A allowlist é um tipo fechado no repositório (`NomeDeRpc`), o que
torna erro de compilação chamar qualquer outra coisa.

## 4.2 Atomicidade — o que é e o que não é

**Cada RPC é uma transação.** Assinatura + snapshot + auditoria entram juntas
ou não entram.

**Não existe atomicidade entre o PostgreSQL e o provider**, e nenhuma parte
deste documento afirma que exista. A garantia real é outra, e é suficiente:

* efeitos **idempotentes** sob a chave declarada;
* estado **recuperável** — nenhuma falha deixa a operação presa;
* processamento **efetivamente único** sob aquela chave: no máximo uma cobrança
  lógica no provider, e no máximo uma cobrança, um snapshot e uma transição no
  banco.

O fluxo é `claim → provider → finalize | fail`, com o provider **fora** de
qualquer transação aberta.

**Erro ambíguo do provider não marca `failed`.** `provider_unavailable` e
`provider_timeout` não dizem se o recurso externo foi criado — uma conexão que
cai depois do commit do provider é indistinguível de uma que cai antes. Marcar
`failed` afirmaria "nada aconteceu", e a retomada imediata criaria a segunda
cobrança. Nesses casos a reserva fica `in_progress` e quem governa a retomada é
a **lease**. `failed` fica reservado às recusas determinísticas.

## 5. Idempotência

`billing.idempotency_records`, com `UNIQUE (organization_id, scope, provider, key)`.

* **`provider_event`** — chave é o `event_id` do provider.
* **`command`** — chave é a do comando (checkout, upgrade).

A reserva é feita por `INSERT`, **sem `SELECT` antes**: entre o select e o
insert cabe outra transação, e é exatamente aí que a duplicata nasceria. Quem
perde a corrida recebe a violação de unicidade e lê o resultado já gravado.

`billing.charges` tem `UNIQUE (organization_id, idempotency_key)`, e é isso que
faz o checkout repetido **devolver a cobrança original** em vez de erro.

**Ordem:** todo evento carrega o instante do provider. Evento anterior ao início
da cobrança, ou cobrança de período já encerrado, é recusado com
`out_of_order_event` — um pagamento atrasado **não reativa** ciclo posterior.

## 6. Persistência acrescentada (`20260802093000`)

Quatro tabelas — `customers`, `charges`, `idempotency_records`,
`courtesy_revocations` — e quatro colunas em `billing.audit_events`
(`subscription_id`, `origin`, `idempotency_key`, `correlation_id`).

Todas com RLS ligada, zero policies, nada para `anon`/`authenticated`, `DELETE`
para ninguém. `charges` é a única tabela nova com `UPDATE` — o status da
cobrança muda ao longo do ciclo. A allowlist de `UPDATE` passou a ser
exatamente `{subscriptions, charges}`, fixada por `BO-18`.

**Revogação de cortesia é append-only:** a concessão original permanece, com
autor e motivo. Apagá-la apagaria a prova de que existiu.

## 7. Provider mock

Determinístico, sem rede, sem segredo, com relógio e identificadores injetados.
Cenários declarativos: `approve`, `decline`, `pix_pending`, `timeout`,
`unavailable_before_persist`, `unavailable_after_persist`, além de webhook
duplicado e fora de ordem.

**Impossível de instanciar em produção:** o construtor lança quando
`NODE_ENV=production` **ou** `VERCEL_ENV=production`. A recusa é no ato da
construção — não é aviso, não é degradação, não é fallback.

Consequência declarada: como preview da Vercel roda com `NODE_ENV=production`,
o mock também não é instanciável lá. É mais restritivo que o mínimo, e essa é a
direção segura do erro.

O mesmo vale para `InMemoryBillingRepository`.

## 8. Segurança

`SupabaseBillingRepository` é `server-only`: importá-lo de componente cliente é
**erro de build**. Não guarda credencial, não registra log, e **não propaga a
mensagem do driver** — só o `code`, porque mensagens de driver carregam host,
usuário e às vezes a URL de conexão inteira.

Toda consulta filtra `organization_id`, inclusive as que buscam por chave
primária. `service_role` tem `BYPASSRLS`, então o filtro no cliente é a barreira
efetiva — e é por isso que o isolamento entre dois tenants é provado contra
PostgreSQL de verdade, não apenas contra o dublê.

Nada de `cvv`, número de cartão, token ou chave de API entra em qualquer
estrutura persistida.

## 9. Plano de testes

| Camada | Onde | O que prova |
| --- | --- | --- |
| Unitária | `tests/unit/billing/usecases/` | ciclo de vida, bordas temporais, faixas, preços, pró-rata, autorização, IDOR, idempotência, ordem, falhas, mock proibido em produção. `resilience.spec.ts` **mede** as chamadas ao provider por cenário |
| Contrato | `tests/contract/shared-expectations.ts` | as MESMAS expectativas executadas contra o dublê **e** contra `SupabaseBillingRepository` pelo PostgREST local. É o arquivo que fecha o buraco de um repositório nunca exercitado |
| Estática | `tests/billing-orchestration-guard.mjs` (22) | determinismo, ausência de rede, fronteira do `service_role`, alcance público, integridade da migration |
| Mutação | `tests/billing-orchestration-mutation-guard.mjs` (35) | que as guardas acima reprovam quando a propriedade é removida |
| PostgreSQL real | `scripts/ci/assert-billing-orchestration.sql` | **o que o dublê não reproduz**: UNIQUE resolvendo concorrência, transação desfazendo escrita parcial, RLS/grants efetivos, trigger de imutabilidade sobre linha real |

`tests/setup/no-network.ts` transforma qualquer `fetch`/XHR/WebSocket num teste
em falha, com o alvo na mensagem.

## 10. Limites desta etapa

* Nenhum caso de uso é exposto como rota, action ou página. `BO-12` reprova
  qualquer import da 12B a partir do runtime público.
* O provider real (Asaas) **não foi alterado**, salvo por não ter sido tocado:
  o contrato da 12B é novo e separado.
* O repositório em memória **não** reproduz RLS, grants, transação real nem
  concorrência real — está declarado no próprio arquivo, e é a razão de existir
  a prova em PostgreSQL.

## 11. Gates para a 12C

1. As duas migrations aplicadas em produção pela rota protegida, **na ordem**, com
   autorização própria para cada uma.
2. Sandbox do Asaas configurado, com secret cadastrado no environment protegido.
3. Provider real implementando o contrato da 12B, com os mesmos testes de
   contrato do mock.
4. Conta piloto interna exercitando o ciclo completo.
5. Só então: interface, checkout e ativação da feature flag.

A sequência é a do documento normativo — mock → sandbox → piloto → produção — e
**nenhum passo pode ser antecipado**.
