# Etapa 12C.2 — Fachada server-side da jornada de billing

> **Nada foi publicado.** Não há página, rota, server action, webhook ou item de
> menu que alcance esta camada — e `FC-10`/`FC-11` reprovam se aparecer.
> Billing continua **desligado**; o Asaas continua **não implementado** e
> reservado à 12D.
>
> **Zero migration nova.** As 18 RPCs da 12B/12C.1 bastaram, e a §7 abaixo
> demonstra nominalmente por quê — inclusive para a troca do formato de digest.
>
> **Estado de produção:** ledger remoto em **41**, produção em **41/41**, sem
> migration pendente. A 12C.3 não foi iniciada.

## 1. O que esta etapa entrega

Uma camada `src/lib/billing/facade/` entre o futuro frontend e os casos de uso,
com treze comandos e uma matriz de papéis explícita:

| Comando | Papel mínimo | Provider? | Caso de uso |
| --- | --- | --- | --- |
| `lerCatalogo` | **membro** | não | `readCatalogUseCase` |
| `lerAcesso` | **membro** | não | `resolveBillingAccess` |
| `lerAssinatura` | owner | não | `readSubscriptionState` |
| `iniciarTrial` | owner | não | `startTrial` |
| `atualizarEmailFinanceiro` | owner | não | `updateBillingEmail` |
| `aceitarTermos` | owner | não | `acceptTerms` |
| `registrarTrabalhadores` | owner | não | `recordWorkerCount` |
| `escolherPlano` | owner | não | `choosePlan` |
| `fazerUpgrade` | owner | não | `upgradeSubscription` |
| `agendarDowngrade` | owner | não | `scheduleDowngradeUseCase` |
| `cancelarNoFimDoPeriodo` | owner | não | `cancelAtPeriodEnd` |
| `prepararIntencaoDeCheckout` | owner | não | `prepareCheckoutIntent` |
| `criarCheckout` | owner | **sim** | `createCheckout` |

Cortesia, grandfathering e webhook **não** entram: são operações
administrativas ou de máquina, e expô-las numa fachada destinada ao cliente
convidaria a 12C.3 a criar tela para elas. `FC-18` reprova se aparecerem.

## 2. Por que uma fachada, se já há casos de uso

Os casos de uso recebem `UseCaseEnv` já montado. Alguém precisa montá-lo, e esse
alguém decide tudo o que importa: se a flag foi consultada, se a sessão foi
resolvida no servidor, se o `organizationId` do cliente foi comparado ou
obedecido, qual papel cada comando exige, se o provider foi construído.

Sem esta camada, cada server action da 12C.3 montaria o ambiente por conta
própria e a ordem de segurança viraria convenção — repetida em N lugares,
verificada em nenhum. Aqui ela é **uma função**, e as onze etapas são as onze
linhas de `executarComando`.

## 3. A ordem de segurança, e por que nesta ordem

| # | Etapa | Por quê |
| --- | --- | --- |
| 1–2 | flag, e `billing_disabled` | billing desligado **não faz I/O**: nem banco, nem provider, nem sessão |
| 3–4 | sessão, organização e papel | do servidor, nunca recebidos |
| 5 | papel mínimo | declarado **por comando**; ver §4 |
| 6 | comparação de tenant | o identificador do cliente é **comparado**, jamais obedecido |
| 7 | validação | **depois** da autorização: quem não está autorizado não aprende quais campos existem |
| 8 | contexto confiável | ator, organização, **papel real**, origem, relógio e correlação, do servidor |
| 9 | provider | só quando a operação precisa — só o checkout precisa |
| 10 | um caso de uso | exatamente um, **sem exceção** — inclusive o comando puro; ver §6 |
| 11 | tradução | `Result` vira `FacadeResult`, com mensagem escrita à mão |

As etapas **1 a 7 vivem numa função só**, `preflight`, e os dois executores a
reusam: o que monta repositório e provider, e o que atende comandos puros. Duas
cópias da sequência ficariam coerentes só por comentário, e comentário não impõe
nada — `FC-02` reprova se um executor trouxer a própria.

**"Zero I/O" só existe qualificado.** `prepararIntencaoDeCheckout` tem **zero I/O
de billing**: nenhum `BillingRepository` e nenhum provider são construídos.
Permanece o I/O necessário à autenticação e à autorização — a sessão e a
membership são consultadas, como em todo comando. Dizer "zero I/O" sem
qualificar sugeriria que este caminho não toca o banco, quando ele toca
`organization_members` para saber quem está chamando.

As três primeiras propriedades não são afirmadas: são **medidas**.
`repositorio` e `provider` são fábricas instrumentadas na bancada, e cada teste
verifica que a contagem é zero quando deve ser.

**Sobre a etapa 9 e a PII.** A validação (etapa 7) processa a entrada antes,
inclusive nome e e-mail do pagador — e isso é correto, porque validar é o que
impede um pedido malformado de circular. A propriedade que vale, e que
`ordem-de-seguranca.spec.ts` mede, é outra: **nenhuma PII é enviada ao provider
antes de ele ser resolvido e validado**, e **nenhum provider é resolvido fora do
checkout**.

## 4. Membro e proprietário — o critério, e por que não é "leitura × escrita"

A decisão comercial aprovada diz que **somente o proprietário contrata, altera
ou cancela**. Ela não diz que somente o proprietário pode consultar o que a
organização tem direito de usar — e tratar as duas coisas como uma só barraria
o colaborador de módulos que a organização pagou.

O critério é **o que a resposta carrega**:

* `lerCatalogo` devolve a tabela de preços publicada — a mesma que estará na
  página pública de planos. Nada diz sobre o contrato desta organização.
* `lerAcesso` devolve direitos e o motivo deles. Não devolve CNPJ, contato
  financeiro, preço praticado nem identificador externo.
* `lerAssinatura` devolve o **dossiê comercial inteiro**. É de proprietário, e
  continua sendo.

O banco nunca impôs a restrição antiga: `fn_billing_read_state` e
`fn_billing_read_catalog` chamam `fn_require_member(..., false)`. A porta estava
fechada só na aplicação.

**A ampliação é medida nos dois sentidos.** `tests/unit/billing/facade/autorizacao.spec.ts`
prova, comando a comando, o que membro **faz** e o que membro **não faz** — e a
segunda metade sem a primeira aprovaria a fachada travada que estamos
corrigindo, enquanto a primeira sem a segunda aprovaria uma que liberou tudo.
`FC-19` fixa a matriz por extenso e reprova qualquer rebaixamento; `MUT-FC-33`
a `MUT-FC-34g` provam que a guarda morde nas duas direções.

Duas propriedades **não** foram afrouxadas junto: membro de A continua sem
alcançar B, e tenant alheio continua indistinguível de tenant inexistente.
`requireBillingMemberFor` trata o identificador afirmado exatamente como
`requireBillingOwnerFor`, e `BF-27` cobra as duas.

### A resolução por tenant, e o defeito que ela tinha

As variantes `…For` faziam isto:

```ts
const r = await requireBillingOwner();   // resolve a PRIMEIRA membership
if (pedido !== r.principal.organizationId) return negar(...);
```

Isso não pergunta *"o usuário pertence ao tenant pedido?"*. Pergunta *"o tenant
pedido é justamente o primeiro que eu resolvi?"* — e as duas perguntas só
coincidem para quem tem uma organização só.

O efeito não era abrir acesso indevido: era **recusar acesso legítimo**. Quem é
owner de A e membro de B, com B ativo, era barrado de B. O mesmo valia para quem
é owner de duas organizações e administra a segunda.

Agora a consulta filtra por `user_id` **e** por `tenant_id = <pedido>` ao mesmo
tempo. O identificador do cliente continua sem autorizar — ele **restringe** a
consulta, e quem autoriza é a linha devolvida, conferida de novo em código:
tenant igual ao pedido e papel esperado. `deleted_at IS NULL` vai junto, erro de
consulta e resposta malformada NEGAM, e ausência de linha é `not_owner` — a
mesma recusa de tenant alheio e de tenant inexistente.

`tests/integration/billing/authorization-multi-org.spec.ts` mede os dois
sentidos, com um fixture que **filtra de verdade**. É uma escolha oposta à do
fake compartilhado, e deliberada: lá o defeito temido é o código esquecer o
filtro e o fake consertar a falha; aqui é o código não enviar o filtro e recusar
quem é legítimo. Um fake que não filtrasse devolveria a membership certa de
qualquer jeito, e o teste passaria com o código velho. A disciplina é a mesma —
o fixture nunca pode ser o que faz o teste passar.

## 5. Campos que nunca vêm do chamador

Todo schema é `.strict()`: campo a mais é **erro**, não campo ignorado. É a
diferença entre "o servidor ignorou `actorId`" e "o servidor recusou o pedido
que trazia `actorId`" — e só a segunda aparece quando alguém tenta.

`CAMPOS_PROIBIDOS` lista os 24 nomes; `FC-08` lê a lista do próprio arquivo e
confere que nenhum schema os declara.

Três exceções, todas declaradas, e nenhuma delas decide:

* `organizationId` — aceito e **comparado**; nunca autoriza;
* `termsVersion` — a versão que a tela exibiu, comparada com `TERMS_VERSION`
  antes de qualquer efeito. O que se persiste é a constante;
* `checkoutIntentId` — cunhado pelo servidor e devolvido ao chamador, que o
  repete nos retries. Ver §6.

O instante do aceite não é aceito em forma alguma: vem do `Clock` injetado.

## 6. A intenção de checkout — retry técnico × nova tentativa comercial

### O defeito que isto corrige

A primeira versão derivava a chave de idempotência de
`(operação, organização, PERÍODO)`. Os três são invariantes dentro de um ciclo,
então **a chave era a mesma para todas as tentativas do período**. Medido contra
o banco real:

* PIX recusado, ou expirado sem pagamento? Tentar cartão devolvia
  `fingerprint_conflict`. **Para sempre** — `fn_billing_claim_idempotency`
  compara o fingerprint *antes* de olhar o status
  (`20260802093000_billing_orchestration.sql:1048`), então nem o estado `failed`
  liberava a segunda tentativa.
* Cobrança concluída e não paga? Toda nova tentativa era `replay` da cobrança
  morta.

A organização ficava presa a **uma cobrança por ciclo**, sem caminho de saída. E
havia um teste afirmando que o travamento era o comportamento correto. Ele foi
**removido**, e `FC-17` reprova se voltar.

### O conceito que faltava

A chave respondia "que período é este?". A pergunta certa é "que **tentativa
comercial** é esta?" — e um mesmo período comporta várias tentativas legítimas.

| | |
| --- | --- |
| **Retry técnico** | mesma intenção. Refresh, timeout, reenvio. Devolve o **mesmo** resultado — nunca uma segunda cobrança. |
| **Nova tentativa comercial** | intenção nova, pedida deliberadamente. Trocar de meio, recomeçar após recusa. Chave nova, cobrança nova. |

A diferença é uma **decisão de quem chama**, e por isso é explícita no protocolo
em vez de inferida de relógio ou de estado.

### O identificador

`ci_` + 32 hex, **128 bits** de `crypto.getRandomValues`, cunhado por
`prepararIntencaoDeCheckout` (owner, **zero I/O de billing**) e injetado como
dependência
para que os testes contem as cunhagens.

Ele **não autoriza nada**: ator, tenant, papel, preço, período e fingerprint
continuam resolvidos pelo servidor a cada chamada, e toda RPC revalida o membro
no banco antes de olhar a chave. Não é a chave, tampouco — quem deriva é
`chaveDeIdempotencia(operação, organização RESOLVIDA, intenção)`, dentro do caso
de uso. Nem o cliente nem a fachada calculam a chave.

É **obrigatório** no `criarCheckout`, e não opcional: um campo opcional
convidaria o ramo "se não veio, invente", e inventar em silêncio faria cada
retry técnico virar cobrança nova — o defeito oposto ao antigo e igualmente
grave. `FC-14` e `MUT-FC-25b` cobram isso.

### O que a 12C.3 terá de honrar

1. chamar `prepararIntencaoDeCheckout` e guardar o identificador com o
   formulário;
2. repetir o **mesmo** identificador em todo reenvio técnico;
3. pedir uma intenção **nova** apenas por ação deliberada do usuário.

O passo 2 é o único que a fachada não impõe sozinha — preservar o identificador
entre refresh e timeout é de quem tem estado de tela. O contrato existe para que
isso seja obrigação **nomeada** da 12C.3, e não descoberta tardia.

### Por que não há tabela de intenções

Persistir não compraria nada: a intenção não autoriza, então não há o que
revogar; quem pode inventar um identificador **já é proprietário do tenant** e já
pode pedir quantas intenções quiser — inventar uma equivale a clicar "tentar de
novo", faculdade que ele tem; e o efeito é governado por
`billing.idempotency_records`, que já é persistida, atômica e escopada por
`UNIQUE (organization_id, scope, provider, key)`. O formato é validado para que
a entrada continue fechada.

### O fingerprint cobre o pedido INTEIRO

A chave diz "é a mesma tentativa". O fingerprint diz "é o mesmo pedido" — e
para isso ele precisa cobrir tudo o que chega ao provider.

Não cobria. `createCheckout` enviava `cnpj`, `customerName` e `customerEmail` ao
provider, e nenhum dos três entrava na identidade do pedido. Consequência: um
retry sob a mesma intenção, com o mesmo plano e o mesmo meio, mas com **outro
pagador**, mantinha o fingerprint — o banco entendia "mesmo pedido" e devolvia
replay, enquanto o conteúdo destinado ao provider havia mudado.

O teste que existia trocava apenas PIX por cartão. Ele provava `method`, e nada
mais.

Agora o fingerprint cobre plano, faixa, periodicidade, valor, meio, início e fim
do período, **CNPJ, nome e e-mail do pagador**. `description` e `dueAt` não
entram nominalmente porque são *derivados* de campos já presentes — plano e
periodicidade a primeira, fim do período o segundo; acrescentá-los contaria a
mesma coisa duas vezes.

**A normalização, por extenso:**

| Campo | Regra | Por quê |
| --- | --- | --- |
| CNPJ | só os dígitos | máscara é apresentação, não identidade |
| Nome | `trim` | espaço **interno** é preservado: vai impresso na cobrança |
| E-mail | `trim` e caixa baixa | o usuário não vê diferença entre `F@x.com` e `f@x.com` |

O valor **normalizado** é o que vai ao fingerprint *e* ao provider. Normalizar
só para o fingerprint faria a identidade dizer "mesmo pedido" enquanto o
provider recebe bytes diferentes — a divergência que isto existe para impedir.

Só o SHA-256 é persistido: nenhuma PII nova entra em `idempotency_records`, na
auditoria, em mensagem de erro ou em log. `FC-21` reprova se algum desses campos
aparecer na reserva.

**O CNPJ não é alterável hoje** — entra por `start_trial` e é imutável por
trigger; não há RPC que o mude. O cenário "mudar o CNPJ sob a mesma intenção"
não é alcançável, e encená-lo seria encenar. O que se prova é a propriedade que
importa: duas organizações com CNPJ distinto produzem fingerprints distintos.

O mock também teve de mudar. Ele memoiza o cliente por organização e devolve o
existente sem olhar nome, e-mail ou CNPJ — então um teste que olhasse o
*resultado* passaria porque o mock **descarta** o campo, e não porque o produto
protege. `chamadasDeCliente` registra o que o provider de fato recebeu, e a
asserção passou a ser a certa: o conflito acontece antes, e a segunda versão
nunca chega lá.

## 7. Persistência: por que zero migration, inclusive para o digest

Cada comando mapeia para uma RPC existente:

* as leituras usam `fn_billing_read_state` / `fn_billing_read_catalog`;
* o ciclo de vida usa `start_trial`, `change_plan`, `schedule_downgrade`,
  `cancel_at_period_end`, `record_worker_count`;
* os metadados contratuais usam `update_billing_email` e `accept_terms`;
* o checkout usa `claim_idempotency` + `finalize_checkout`.

`prepararIntencaoDeCheckout` não persiste nada, e a derivação da chave é puro
cálculo.

### O diagnóstico da troca de formato do digest

Trocar FNV-1a de 32 bits por SHA-256 **muda o valor** de todo fingerprint e de
toda chave. Se houvesse operação persistida, um replay legítimo passaria a
calcular um fingerprint diferente e receberia `fingerprint_conflict` — e a
correção exigiria migração de dados.

Não há. A demonstração, sem tocar em produção:

* a feature flag `BILLING_ENABLED` **nunca foi definida** em ambiente algum, e
  `isBillingEnabled()` só liga com a string exata `"true"`;
* nenhuma página, rota, server action ou webhook alcança as RPCs — a 12C.0
  aposentou o runtime legado e `/api/webhooks/billing` deixou de ter handler
  próprio; `FC-10`/`FC-11` reprovam qualquer consumidor novo;
* portanto `billing.idempotency_records` e `billing.charges` estão **vazias** em
  produção, e nenhum fingerprint foi persistido por caminho algum.

As únicas linhas que já existiram sob o formato antigo são fixtures da stack
descartável, semeadas e derrubadas a cada execução do CI.

**Conclusão: nenhuma migração de dados é necessária, e nenhum SQL foi criado.**
O prefixo de geração (`fp1_`, `idem1_`) existe justamente para que uma troca
futura — se um dia houver dado persistido — seja legível na linha do banco em
vez de virar um conflito inexplicado.

## 8. O digest, e por que 32 bits não serviam

`fingerprintDe` e `chaveDeIdempotencia` decidem se dois pedidos de **cobrança**
são o mesmo. FNV-1a de 32 bits dá 4.294.967.296 valores; pelo paradoxo do
aniversário, algumas dezenas de milhares de identidades já colidem com
probabilidade apreciável, e a consequência aqui não é cache errado — é checkout
legítimo recusado, ou dois pedidos distintos tomados por um.

`core/digest.ts` traz SHA-256 com prefixo de tipo e geração. E traz também uma
canonicalização **injetiva**: a antiga unia `chave=valor` por `&`, e
`{a: "x&b=y"}` produzia a mesma string que `{a: "x", b: "y"}`. Nenhum campo do
billing contém `&` hoje — mas "hoje" não é uma propriedade, e um nome de pagador
bastaria. Agora nome e valor vão prefixados pelo próprio comprimento.

## 9. Uma leitura, um caso de uso

A primeira versão lia `readState` **na fachada** para descobrir o período,
derivava a chave dele, decidia `not_found` por conta própria e só então chamava
`createCheckout` — que lia o estado de novo. Duas leituras independentes, TOCTOU
entre derivar a chave e reservá-la, e a regra "sem assinatura não há checkout"
escrita em duas camadas.

Agora a fachada não lê nada: `FC-20` reprova qualquer `env.repo.*` nela, qualquer
`fail(` e qualquer `"not_found"`. A chave deriva da intenção, que não vem do
banco — então **a janela de corrida desaparece em vez de ser mitigada**. E as
consultas que acessavam o repositório direto ganharam casos de uso próprios em
`usecases/queries.ts`, de modo que "um comando → um caso de uso" passou a valer
para os treze, e não para nove.

## 10. O checkout contra o PostgREST real

A versão anterior pulava o checkout no contrato da fachada, alegando que ele
"depende do provider e fica para a 12D". A alegação não se sustentava: o checkout
depende do `BillingProviderMock`, que é código local sem rede. O que ficava sem
prova eram `claimIdempotency` e `finalizeCheckout` — as RPCs com lease, takeover
e conflito de fingerprint, isto é, as de maior consequência financeira.

`tests/contract/facade-postgrest.spec.ts` agora roda a fachada com
`SupabaseBillingRepository` real, PostgREST local, `BillingProviderMock`, stack
descartável e zero rede externa, cobrindo:

checkout aprovado (uma cobrança, um snapshot, auditoria com a chave derivada) ·
replay · provider não retocado depois da conclusão · payload diferente sob a
mesma intenção · nova intenção · PIX recusado seguido de cartão · recusa
determinística liberando repetição · indisponibilidade ambígua preservando
`in_progress` · retomada após lease com o mesmo recurso externo · falha de
`finalize` sem duplicar · plano trocado no meio · isolamento entre organizações ·
IDOR no checkout · leitura por membro e seu limite.

`FC-17b` exige cada um desses casos **nominalmente** e reprova qualquer `skip`
ou `only`; o passo do CI reprova se a suíte for pulada lá; e `MUT-FC-36` a
`MUT-FC-37b` provam que essas guardas mordem.

A faixa de fixtures foi de 60–79 para **60–99**, disjunta da do contrato do
repositório (0–59), e a suíte aborta nominalmente ao esgotá-la em vez de
reciclar organização.

**Um cenário novo teve de ser criado no mock.** `payments.ts` divide as falhas do
provider em ambíguas e determinísticas e trata cada uma de um jeito — mas nenhum
cenário do roteiro produzia um código determinístico, e o ramo `failed` de
`talvezMarcarFalha` estava **inalcançável por teste**. O cenário `rejected`
fecha isso.

A 12D permanece reservada ao **adaptador Asaas** e ao sandbox externo.

## 11. Limites ainda não exercitados

* **Sessão real não é exercitada nos testes.** `requireBillingOwner` e
  `requireBillingMember` leem a sessão do Supabase e têm cobertura própria; na
  fachada elas entram por injeção. O que se prova aqui é tudo o que vem depois.
* **Nenhuma medição de concorrência real na fachada.** Duas requisições
  simultâneas sob a mesma intenção são resolvidas pelo `claim`, cuja corrida já
  é provada por `scripts/ci/assert-billing-concurrency.sh` com duas conexões.
* **O pagamento efetivo não é exercitado ponta a ponta.** `simulatePayment` e o
  webhook têm cobertura própria, mas nenhum teste da fachada leva uma cobrança
  de criada a paga: a fachada não expõe webhook, por decisão da §1.

Sobre a resolução de tenant: as variantes **sem argumento** continuam escolhendo
a primeira membership, e continuam sem saber qual tenant o usuário está olhando
— adivinhar não é resolver. Os wrappers da 12C.3 devem passar o `organizationId`
do tenant ativo, e, desde a correção das variantes `…For`, informar a
organização de fato elimina a ambiguidade: elas consultam a membership
**naquele** tenant em vez de resolver um padrão e comparar depois.

Isto deixou de ser um limite aceito e passou a ser um requisito do contrato com
a 12C.3. Unificar a resolução de tenant do produto inteiro continua sendo decisão
maior do que esta etapa: `src/lib/tenant-guard.ts` é onde ela terá de acontecer.

## 12. O que esta etapa deliberadamente NÃO faz

Não cria página, rota, server action, webhook, middleware ou item de menu. Não
altera `/dashboard/billing`, que continua sendo o `redirect` da 12C.0. Não
publica preço, não cria checkout acessível, não habilita a feature flag, não
cria variável na Vercel e não chama o Asaas.

A 12C.3 criará os wrappers públicos e a interface — e encontrará a ordem de
segurança já escrita, medida e vigiada, a matriz de papéis pronta para o
enforcement de entitlements, e o contrato da intenção esperando para ser
honrado.
