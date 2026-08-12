# Etapa 12C.2 — Fachada server-side da jornada de billing

> **Nada foi publicado.** Não há página, rota, server action, webhook ou item de
> menu que alcance esta camada — e `FC-10`/`FC-11` reprovam se aparecer.
> Billing continua **desligado**; o Asaas continua **não implementado**.
>
> **Zero migration nova.** As 18 RPCs da 12B/12C.1 bastaram, e a §6 abaixo
> demonstra nominalmente por quê.
>
> **Estado de produção:** ledger remoto em **41**, sem pendência.

## 1. O que esta etapa entrega

Uma camada `src/lib/billing/facade/` entre o futuro frontend e os casos de uso,
com doze comandos:

| Comando | Autorização | Provider? | Caso de uso |
| --- | --- | --- | --- |
| `lerCatalogo` | owner | não | `repo.readCatalog` |
| `lerAssinatura` | owner | não | `repo.readState` |
| `lerAcesso` | owner | não | `resolveBillingAccess` |
| `iniciarTrial` | owner | não | `startTrial` |
| `atualizarEmailFinanceiro` | owner | não | `updateBillingEmail` |
| `aceitarTermos` | owner | não | `acceptTerms` |
| `registrarTrabalhadores` | owner | não | `recordWorkerCount` |
| `escolherPlano` | owner | não | `choosePlan` |
| `fazerUpgrade` | owner | não | `upgradeSubscription` |
| `agendarDowngrade` | owner | não | `scheduleDowngradeUseCase` |
| `cancelarNoFimDoPeriodo` | owner | não | `cancelAtPeriodEnd` |
| `criarCheckout` | owner | **sim** | `createCheckout` |

Cortesia, grandfathering e webhook **não** entram: são operações
administrativas ou de máquina, e expô-las numa fachada destinada ao cliente
convidaria a 12C.3 a criar tela para elas. `FC-18` reprova se aparecerem.

## 2. Por que uma fachada, se já há casos de uso

Os casos de uso recebem `UseCaseEnv` já montado. Alguém precisa montá-lo, e esse
alguém decide tudo o que importa: se a flag foi consultada, se a sessão foi
resolvida no servidor, se o `organizationId` do cliente foi comparado ou
obedecido, se o provider foi construído antes ou depois de a PII entrar em jogo.

Sem esta camada, cada server action da 12C.3 montaria o ambiente por conta
própria e a ordem de segurança viraria convenção — repetida em N lugares,
verificada em nenhum. Aqui ela é **uma função**, e as onze etapas são as onze
linhas de `executarComando`.

## 3. A ordem de segurança, e por que nesta ordem

| # | Etapa | Por quê |
| --- | --- | --- |
| 1–2 | flag, e `billing_disabled` | billing desligado **não faz I/O**: nem banco, nem provider, nem sessão |
| 3–4 | sessão, organização e papel | do servidor, nunca recebidos |
| 5 | owner | comandos comerciais exigem proprietário |
| 6 | comparação de tenant | o identificador do cliente é **comparado**, jamais obedecido |
| 7 | validação | **depois** da autorização: quem não está autorizado não aprende quais campos existem |
| 8 | contexto confiável | ator, organização, origem, relógio e correlação, do servidor |
| 9 | provider | só quando a operação precisa — só o checkout precisa |
| 10 | um caso de uso | exatamente um; a fachada não orquestra dois efeitos |
| 11 | tradução | `Result` vira `FacadeResult`, com mensagem escrita à mão |

As três primeiras propriedades não são afirmadas: são **medidas**.
`repositorio` e `provider` são fábricas instrumentadas na bancada, e cada teste
verifica que a contagem é zero quando deve ser.

## 4. Campos que nunca vêm do chamador

Todo schema é `.strict()`: campo a mais é **erro**, não campo ignorado. É a
diferença entre "o servidor ignorou `actorId`" e "o servidor recusou o pedido
que trazia `actorId`" — e só a segunda aparece quando alguém tenta.

`CAMPOS_PROIBIDOS` lista os 24 nomes; `FC-08` lê a lista do próprio arquivo e
confere que nenhum schema os declara.

Duas exceções, ambas declaradas:

* `organizationId` — aceito e **comparado**; nunca autoriza;
* `termsVersion` — a versão que a tela exibiu, comparada com `TERMS_VERSION`
  antes de qualquer efeito. O que se persiste é a constante.

O instante do aceite não é aceito em forma alguma: vem do `Clock` injetado.

## 5. Política de idempotência do checkout

A chave é **derivada no servidor**, nunca recebida:

```
chave = idem_checkout_ + FNV1a(op=checkout & org=<resolvida> & inicio=<período> & fim=<período>)
```

| Requisito | Como é cumprido |
| --- | --- |
| opaca, não autoriza | é um hash; toda RPC revalida ator e organização no banco |
| ligada a organização, operação e fingerprint | a chave cobre organização + operação + período; o **fingerprint**, calculado por `createCheckout`, cobre o pedido inteiro |
| retry reutiliza a mesma chave | nada é sorteado, nada depende de relógio, nada mora em memória |
| payload diferente = conflito | mesma chave, fingerprint diferente → `fingerprint_conflict` |
| cliente não escolhe nada | o schema é `.strict()` e não declara `idempotencyKey` |
| nenhuma ausência gera chave nova | não há ramo "se não veio, invente"; sem assinatura, não há checkout |

**A divisão entre chave e fingerprint é o ponto.** Se a chave também cobrisse o
meio de pagamento, trocar de PIX para cartão geraria uma cobrança nova em vez de
conflito — e o conflito é justamente o que a idempotência existe para produzir.

**A corrida que sobra falha fechada:** se o período mudar entre a leitura que
deriva a chave e a que `createCheckout` faz, a chave é a do período antigo e o
fingerprint é o do novo → `fingerprint_conflict`. Uma recusa, não uma cobrança
errada.

## 6. Persistência: por que zero migration

Cada comando mapeia para uma RPC existente, e nenhum precisou de operação nova:

* as leituras usam `fn_billing_read_state` / `fn_billing_read_catalog`;
* o ciclo de vida usa `start_trial`, `change_plan`, `schedule_downgrade`,
  `cancel_at_period_end`, `record_worker_count`;
* os metadados contratuais usam `update_billing_email` e `accept_terms`, criadas
  na 12C.1 exatamente para isto;
* o checkout usa `claim_idempotency` + `finalize_checkout`, que já são uma
  transação cada.

A única operação que a fachada acrescenta é a **derivação da chave**, e ela é
puro cálculo — não persiste nada. `FC-13` reprova migration nova, acesso direto
a tabela, `.schema("billing")`, `check_plan_limit` e qualquer menção às cinco
tabelas legadas.

## 7. Limites declarados, e não exercitados

* **Leitura por membro comum não é oferecida.** `BillingAuthContext.role` é o
  literal `"owner"` e `assertTenant` recusa qualquer outro papel. O banco
  permite que um membro leia o próprio estado (`fn_billing_read_state` não exige
  owner), mas ampliar isso é decisão de domínio, não de fachada.
* **Sessão real não é exercitada nos testes.** `requireBillingOwner` lê a sessão
  do Supabase e já tem cobertura própria; na fachada ela entra por injeção. O
  que se prova aqui é tudo o que vem depois.
* **O checkout não é exercitado contra o PostgREST.** A suíte de contrato da
  fachada cobre leitura, trial, IDOR e metadados; o checkout depende do provider
  e é coberto pela suíte de unidade com o mock. Fechar isso exigiria semear
  cobrança na stack descartável — trabalho da 12D, com o Asaas.
* **Nenhuma medição de concorrência real na fachada.** Duas requisições
  simultâneas derivando a mesma chave são resolvidas pelo `claim`, cuja corrida
  já é provada por `scripts/ci/assert-billing-concurrency.sh` com duas conexões.

## 8. O que esta etapa deliberadamente NÃO faz

Não cria página, rota, server action, webhook, middleware ou item de menu. Não
altera `/dashboard/billing`, que continua sendo o `redirect` da 12C.0. Não
publica preço, não cria checkout acessível, não habilita a feature flag, não
cria variável na Vercel e não chama o Asaas.

A 12C.3 criará os wrappers públicos e a interface — e encontrará a ordem de
segurança já escrita, medida e vigiada.
