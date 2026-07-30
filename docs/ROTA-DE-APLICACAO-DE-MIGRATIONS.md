# Rota protegida de aplicação de migrations

**Fase 6B.1** · workflow `.github/workflows/migration-apply.yml` · environment `db-production`

Quando esta rota foi escrita não existia caminho nenhum entre o repositório e o banco: as duas migrations forward-only estavam corretas em `supabase/migrations/` e ausentes de produção. Este documento descreve o caminho que passou a existir — e, na §11, registra o encerramento da fase.

> **Estado atual: fase encerrada.** As duas migrations foram aplicadas pela rota, cada uma em sua execução, ambas auditadas. **Ledger remoto em 38/38, nenhuma migration pendente.** Detalhes, IDs e limites de cobertura na [§11](#11-encerramento-da-fase).

---

## 1. Desenho

```
workflow_dispatch (só a partir da main)
        │
        ├── preflight ......... sem credencial, sem environment
        │     confirmação literal · ref = main · guardas de congelamento
        │     e classificação · pré-condições P1–P5
        │
        └── apply ............. environment db-production → APROVAÇÃO HUMANA
              ledger antes · pré-condições P6–P8 · reserva das demais
              forward-only · dry-run · aplicação de UMA · devolução dos
              arquivos · ledger depois · delta = exatamente uma versão
```

O `preflight` roda **sem** environment de propósito. Ele decide se a aplicação é sequer legítima; só depois disso o revisor é convocado. Convocar alguém para aprovar algo que o próprio CI reprovaria seria desperdiçar a única atenção humana do processo.

## 2. As recusas

| # | Condição | Onde |
|---|---|---|
| P1 | arquivo inexistente ou fora do padrão | pré-condições |
| P2 | diretório de migrations com classificação quebrada | pré-condições |
| P3 | versão pertence à **faixa histórica congelada** | pré-condições |
| P4 | não é forward-only classificada | pré-condições |
| P5 | mais de uma migration, ou caminho em vez de nome | pré-condições |
| P6 | versão **já aplicada** no ledger remoto | pré-condições |
| P7 | ledger remoto com lacuna, duplicidade ou versão desconhecida | pré-condições |
| P8 | aplicação **fora de ordem** — não é a mais antiga pendente | pré-condições |
| — | execução fora da `main` | job + branch policy do environment |
| — | confirmação textual ausente | job |
| — | destino em loopback | job |
| — | dry-run identifica zero ou mais de uma versão | job |
| — | delta do ledger diferente de exatamente a versão selecionada | job |

**P8 existe porque a âncora B do `migration-rebuild-verify` aplica as forward-only em ordem crescente.** Permitir salto aqui quebraria, em produção, a equivalência que aquele workflow prova — e a quebra só apareceria muito depois, sem ligação óbvia com a causa.

## 3. Como "exatamente uma" é garantido

`supabase db push` aplica **todas** as pendentes; o CLI não tem flag para aplicar uma só. A rota resolve isso reservando temporariamente as demais fora de `supabase/migrations/`, como a âncora A do `migration-rebuild-verify` já faz. O CLI passa a enxergar uma única pendente — então o `--dry-run` tem de listar uma, e o push aplica uma.

**A reserva é orientada pelo ledger**, e essa distinção é o que faz a técnica funcionar a partir da segunda migration (`scripts/ci/reserve-forward-only.mjs`, PR #17):

| | |
|---|---|
| **Permanecem** | todas as históricas · **toda versão presente no ledger remoto** · a migration selecionada |
| **Reservadas** | só forward-only que **ainda não constam do ledger** e não são a selecionada |

Reservar por "toda forward-only diferente da selecionada" funciona enquanto nenhuma estiver aplicada e quebra na segunda: o CLI compara o histórico remoto com o diretório local e recusa quando uma versão registrada no banco não tem arquivo — `Remote migration versions not found in local migrations directory`. Foi assim que a execução nº 5 falhou, antes de aplicar coisa alguma.

Nada é decidido por nome fixo: a fonte é o ledger lido do banco naquela execução. **Fail-closed:** se qualquer versão do ledger não tiver arquivo local, a rota reprova com diagnóstico **antes** de chamar o CLI.

Ao final os arquivos voltam e `git diff --exit-code` prova que o diretório ficou intacto. O passo de devolução tem `if: always()`: mesmo com falha no meio, o repositório do runner não fica mutilado.

## 4. Entrada fechada

A migration é um input `choice` com lista fixa. **Não existe campo de SQL, query ou comando.** Acrescentar uma forward-only exige acrescentar a opção neste arquivo — o que passa por PR e revisão. `tests/migration-apply-guard.mjs` (AP-03) reprova se a lista divergir de `supabase/migrations/`, então a lista não pode ficar desatualizada em silêncio.

## 5. Credencial

Um único secret, **`SUPABASE_DB_URL`**, no environment `db-production`. Por decisão desta fase ele só foi cadastrado **depois** de as proteções do environment estarem confirmadas; hoje existe, e é o único. Sem ele, o workflow falha limpo no passo que o exige, sem tocar em nada.

`scripts/ci/parse-db-url.mjs` decompõe a URL em variáveis `PG*` e registra máscaras (`::add-mask::`) para senha, host e URL inteira **antes** de escrever qualquer coisa. Depois disso o `psql` conecta sem receber nada em `argv`.

**Destino amarrado.** Recusar loopback é a guarda mais fraca — não olha *para onde* a conexão vai. `scripts/ci/production-target.json`, versionado, declara o `project_ref` de produção e as duas conexões aceitas (direta e pooler). O par (host, usuário) precisa bater com uma delas, **e** o ref precisa aparecer em pelo menos um dos dois: no modo pooler o host é compartilhado entre projetos, então o vínculo vem só do usuário. Uma credencial trocada por engano é recusada antes de qualquer conexão.

**`sslmode` por lista de aceitos.** `require`, `verify-ca` e `verify-full` passam. `disable`, `allow` e `prefer` são **recusados**: `disable` garante texto claro, e os outros dois o aceitam em silêncio quando o servidor não oferece TLS. Ausente na URL vira `require` — nunca o default do libpq.

**Limite declarado:** `supabase db push` exige `--db-url`. Nesse único ponto a URL passa por `argv` de um processo dentro do runner efêmero. Não há alternativa no CLI, e gravar a credencial em arquivo seria pior. Nenhum passo usa `set -x` ou `--debug`, nenhum ecoa a URL, e AP-10 reprova se alguém tentar.

**Artefatos sanitizados.** Os logs crus do CLI **não são publicados** — vão para `/tmp` e passam por `scripts/ci/sanitize-log.mjs`, que redige em duas camadas: os valores conhecidos (URL, senha, usuário, host, inclusive percent-encoded) e, genericamente, qualquer URI postgres com credencial, qualquer `--db-url <algo>` e qualquer host Supabase. Se algo conhecido resistir, o script apaga a saída e falha. Antes da publicação ainda há uma varredura final sobre todo o `artifacts/`.

**Actions fixadas em SHA.** As quatro Actions da rota estão presas a commits imutáveis, não a tags ou branches. `supabase/setup-cli@v1` era um **branch** — alvo móvel — e agora está em `ab05898…` (v1.7.1). AP-21 reprova qualquer `uses:` que não seja um SHA de 40 dígitos.

### Como cadastrar o secret, quando for a hora

```bash
# NÃO execute com a URL na linha de comando — ela fica no histórico do shell.
gh secret set SUPABASE_DB_URL \
  --repo gabrieltrezendeadv-lang/compliance-trabalhista \
  --env db-production
# o comando pede o valor por stdin
```

Formato esperado: `postgresql://<usuário>:<senha>@<host>:5432/postgres`. O parser exige usuário e senha, recusa esquema diferente de `postgres:`/`postgresql:`, e força `sslmode=require` quando a URL não traz um.

## 6. Proteções do environment

Configuradas nesta fase e confirmadas por leitura da API:

| Proteção | Valor |
|---|---|
| Revisor obrigatório | `gabrieltrezendeadv-lang` |
| Prevenção de autoaprovação | **desativada** — ver §6.1 |
| **Wait timer** | **15 minutos** |
| Branches permitidas | somente `main` (política customizada) |
| Secrets | **0** |
| Variables | **0** |

Um environment **dedicado** foi criado em vez de reusar `Production`. `Production` e `Preview` pertencem à integração do Vercel (`creator=vercel[bot]`, `task=deploy`): acrescentar revisor obrigatório a `Production` passaria a **bloquear os deploys da aplicação**, que é um efeito colateral grave e sem relação com migrations.

### 6.1 Modo individual — decisão expressa

**O projeto tem um único colaborador**, `gabrieltrezendeadv-lang`, que é dono e administrador do repositório. Como ele é também quem dispara o workflow, manter a prevenção de autoaprovação tornaria a rota **protegida porém inutilizável**: não haveria ninguém para aprovar.

Diante disso, o **modo individual foi escolhido expressamente** pelo responsável pelo projeto: a prevenção de autoaprovação está **desativada**, e o mesmo usuário dispara e aprova.

**O controle compensatório é a espera de 15 minutos.** Ele não substitui um segundo par de olhos — nada substitui — mas troca a natureza do ato. Sem espera, disparar e aprovar são dois cliques seguidos, no mesmo estado de espírito, sob o mesmo impulso que motivou o disparo. Com quinze minutos de intervalo obrigatório, a aprovação vira uma **segunda decisão, tomada depois**, com tempo para reler o preflight, conferir a migration escolhida e desistir. É a diferença entre confirmar e reconsiderar.

O que a espera de fato oferece:

- **uma janela de arrependimento** — a execução pode ser cancelada antes de tocar o banco;
- **um segundo ato deliberado**, registrado com carimbo de tempo no log de deployment;
- **fricção proporcional ao risco** — quinze minutos são desprezíveis diante de uma migration pendente há dias, e caros o bastante para desencorajar a aplicação impulsiva.

O que ela **não** oferece, e é preciso dizer: nenhuma revisão independente. Quem aprova é quem propôs, e conhece a mudança pelos mesmos olhos com que a escreveu. Um erro de julgamento não é apanhado por espera nenhuma.

O que continua segurando a rota, e não depende de julgamento humano: as oito pré-condições (P1–P8), a restrição à `main`, o vínculo com o projeto de produção declarado, o `--dry-run` obrigatório, a conferência do ledger antes e depois, e a verificação independente pós-aplicação. **O revisor humano é a última camada, não a única.**

> **Esta decisão deve ser revista assim que existir um segundo colaborador técnico de confiança.** Nesse momento: adicione-o como revisor do environment, reative a prevenção de autoaprovação e considere reduzir ou remover a espera — que existe para compensar a ausência dele, e deixa de ter função quando ele existir. Atualize esta seção junto, para que o repositório não continue afirmando uma restrição que já não vale.

## 7. `EXECUTE` para `PUBLIC` — agora obrigatória

`scripts/ci/assert-no-public-execute.sql` passou a rodar **dentro do job `Verify`**, em todo push e todo PR para a `main`. Como `Verify` já é contexto obrigatório da branch protection, a asserção passa a bloquear sem depender de registrar um contexto novo — e um contexto que alguém esquece de registrar não protege nada.

Custo declarado: o job mais frequente do CI ganha o tempo de subir a stack descartável. É deliberado.

O estado avaliado é *as migrations do repositório aplicadas a um banco limpo* — que é o que um ambiente novo recebe, e é exatamente onde `fn_process_webhook_event` ficava exposta.

## 8. O que a rota NÃO faz

- **Não testa comportamento com dados.** As verificações pós-aplicação em `scripts/ci/verify-applied/<versão>.sql` conferem o **efeito no catálogo**, são somente leitura (`BEGIN TRANSACTION READ ONLY` … `ROLLBACK`) e são **independentes** das pós-condições da própria migration — que rodam na mesma transação, escritas pela mesma pessoa e com as mesmas suposições, e por isso erram junto quando a suposição está errada (Fase 5A e TG-12C). O que elas **não** fazem é criar fixtures: fabricar usuários e memberships em produção dispara gatilhos reais (`on_auth_user_created` escreve em `public.profiles`) e consome sequências. T1–T9 vivem no banco descartável do `migration-rebuild-verify`. AP-19 exige um arquivo de verificação para cada opção do `choice` e reprova `INSERT`/`UPDATE`/`DELETE`/`CREATE TEMP`/`set_config` neles.
- **Não aplica rollback.** Os rollbacks existem em `supabase/rollbacks/` e são aplicados à mão, com decisão humana.
- **Não cria, lê nem altera secrets.**
- **Não foi executada de ponta a ponta.** Ver §9.

## 9. O que foi testado, e o que não foi

Testado por simulação, contra o **código real** — `tests/migration-apply-simulation.mjs`, 16 asserções. As guardas de shell não são cópias: são extraídas do próprio workflow em tempo de teste, então alterar o workflow altera o que o teste executa.

| Demonstração | Asserções |
|---|---|
| recusa de migration histórica | SIM-01, SIM-02 |
| recusa de versão já aplicada | SIM-03 |
| recusa fora de ordem e de ledger inconsistente | SIM-04, SIM-05 |
| aceitação legítima, nas duas ordens | SIM-06, SIM-07 |
| recusa de mais de uma migration | SIM-08 |
| recusa de execução fora da main | SIM-09, SIM-10 |
| confirmação literal obrigatória | SIM-11 |
| dry-run identificando exatamente uma versão | SIM-12, SIM-13 |
| ausência de vazamento do secret | SIM-14, SIM-15 |
| recusa de destino em loopback | SIM-16 |
| destino amarrado ao projeto de produção | SIM-17, SIM-18 |
| `sslmode` fraco recusado | SIM-19, SIM-20, SIM-21 |
| sanitização dos artefatos | SIM-22, SIM-23, SIM-24 |
| verificação independente obrigatória | SIM-25 |
| reserva orientada pelo ledger | RES-01 a RES-10 |
| passo de reserva no cenário real da 2ª migration | SIM-36 |

Mais `tests/migration-apply-guard.mjs`, 26 asserções estáticas sobre as propriedades que tornam a rota segura, e `tests/reserve-forward-only-guard.mjs`, 10 sobre a decisão de reserva.

Todas as defesas foram verificadas **por mutação**: remover o `pipefail` de qualquer um dos três passos, tirar o `--yes`, desfixar uma Action, publicar log cru, remover a verificação independente, aceitar `sslmode=prefer`, declarar um destino sem o project ref, voltar a reservar toda forward-only diferente da selecionada, ou remover a conferência ledger × arquivos locais — todas reprovam.

**Resolvido na estreia:** a dúvida sobre o CLI pedir confirmação interativa em `db push` foi respondida pela primeira aplicação real. Ele **pede** — o `push.log` mostra `Do you want to push these migrations…? [Y/n] y` — e o `--yes` responde automaticamente. Sem a flag, o passo teria ficado pendurado até o timeout.

---

## 11. Encerramento da fase

**Fase encerrada.** A rota cumpriu integralmente aquilo para que foi construída: levar do repositório ao banco as duas migrations forward-only, uma por execução, com aprovação humana, verificação independente e evidência auditável.

### As duas migrations aplicadas

| Execução | ID | SHA executado | Migration | Ledger |
|---|---|---|---|---|
| **nº 4** | [`30572720665`](https://github.com/gabrieltrezendeadv-lang/compliance-trabalhista/actions/runs/30572720665) | `f199575b0689f264a3e0c4063e45147fc7e5617e` | `20260730123613_revoke_public_webhook_execute` | 36 → **37** |
| **nº 6** | [`30585425232`](https://github.com/gabrieltrezendeadv-lang/compliance-trabalhista/actions/runs/30585425232) | `905e026cac907535d735257de4238be437884914` | `20260731094500_make_tenant_resolution_deterministic` | 37 → **38** |

Ambas `success`, `attempt=1`, disparadas da `main`, com aprovação humana e o *wait timer* de 15 minutos cumprido integralmente (15 min 47 s e 15 min 14 s). Cada uma acrescentou **exatamente uma** linha ao ledger; nenhuma versão foi removida ou modificada.

**Continuidade comprovada entre as execuções:** o `ledger-antes.tsv` da nº 6 é byte a byte idêntico ao `ledger-depois.tsv` da nº 4 (SHA-256 `9f34704b97…`). Nada mexeu no banco entre uma e outra.

### Estado final

**Ledger remoto em 38/38.** As 36 históricas congeladas mais as duas forward-only. **Nenhuma migration pendente** — a correspondência entre `supabase/migrations/*.sql` e o ledger é exata nos dois sentidos: nenhum arquivo sem registro, nenhum registro sem arquivo.

### As falhas anteriores foram do ferramental

Quatro execuções falharam antes. **Nenhuma aplicou nada, nem parcialmente** — todas morreram antes do `db push`, e o ledger só mudou nas execuções nº 4 e nº 6.

| Execução | Onde parou | Causa | Corrigido em |
|---|---|---|---|
| nº 1 `30565821726` | 1º passo de guarda do preflight | `verify-recovered-migrations.mjs` invocada sem o diretório — saía com código 2 | **PR #15** |
| nº 2 `30567425801` | `Conferir o ledger ANTES` | ainda o mesmo defeito de leitura do ledger | **PR #16** |
| nº 3 `30569343187` | `Conferir o ledger ANTES` | `BEGIN`/`ROLLBACK` do psql entravam no TSV — 38 linhas para 36 registros | **PR #16** |
| nº 5 `30579297584` | `Dry-run obrigatório` | a reserva removia `20260730123613`, já aplicada | **PR #17** |

O desenho segurou onde devia. O preflight roda **sem credencial e sem environment**, então falha ali não toca produção nem consome a atenção do revisor; e as que passaram do preflight morreram em passos de **leitura**, antes de qualquer escrita.

### Os três hotfixes

- **[PR #15](https://github.com/gabrieltrezendeadv-lang/compliance-trabalhista/pull/15)** — passar o diretório para `verify-recovered-migrations.mjs`. Guardas: **AP-22** (estática) e **SIM-26**, que *executa* o passo de guardas do preflight e pega a família inteira do defeito.
- **[PR #16](https://github.com/gabrieltrezendeadv-lang/compliance-trabalhista/pull/16)** — leitura do ledger sem tags de status, com validação estrita por **lista de permitidos**. Sessão somente leitura via `PGOPTIONS` em vez de bloco `BEGIN`/`ROLLBACK`; fechou também o *fail-open* que classificava `BEGIN` e `ROLLBACK` como forward-only. Exercitada contra psql real no `Verify`.
- **[PR #17](https://github.com/gabrieltrezendeadv-lang/compliance-trabalhista/pull/17)** — reserva orientada pelo ledger (§3). Guardas **RES-01 a RES-10** e **SIM-36**, com o ledger real da execução nº 5 como fixture.

### Limites de cobertura — o que a rota NÃO prova

Registrado aqui porque um encerramento que só lista sucessos engana quem vier depois.

1. **O verificador independente da segunda migration não assere literalmente `ASC`, a qualificação por schema (`public.organization_members`) nem o alias (`om.`).** Ele prova que **ambos** os critérios `created_at` e `id` estão dentro do `ORDER BY` — critério total e determinístico —, mas não o texto exato da cláusula. Qualificação e alias estão na migration aplicada e no estado esperado da âncora B do `migration-rebuild-verify`; simplesmente não são cobertos por *este* verificador.

2. **T1–T9, os testes de comportamento com dados, rodaram somente no banco descartável** (`migration-rebuild-verify`, run `30556763063`). Em produção eles não rodam por decisão explícita: fabricar usuários e memberships dispararia gatilhos reais — `on_auth_user_created` escreve em `public.profiles` — e consumiria sequências. O que se afirma a partir de produção é o que o catálogo sustenta.

3. **O aviso `Node.js 20 is deprecated`, da action `supabase/setup-cli`, é informativo e permanece.** É da plataforma GitHub sobre o runtime da action, não do código nem das migrations; a action roda em Node 24 e o CLI funciona. Nas duas execuções bem-sucedidas: `##[error]` = 0. Quando a action publicar versão em Node 24, vale reavaliar o SHA fixado.

O que o verificador independente **prova**, em cada aplicação, por consulta de catálogo somente leitura: existência da função, `ORDER BY` presente e com critério total, filtro `deleted_at IS NULL`, linguagem, `STABLE`, `SECURITY DEFINER`, proprietário, tipo de retorno, `search_path`, ACL (`PUBLIC` e `anon` sem `EXECUTE`; `authenticated` e `service_role` com) e as 31 policies dependentes.

### Nenhuma nova aplicação deve ser disparada

**Não há o que aplicar.** Com o ledger em 38/38 e nenhuma pendente, um `workflow_dispatch` hoje seria recusado pela pré-condição **P6** (versão já consta do ledger) — a rota falha fechada, mas gastaria a espera de 15 minutos e uma aprovação à toa.

A rota só deve ser acionada de novo quando existir uma **nova migration forward-only aprovada e mergeada na `main`**, com sua opção acrescentada ao `choice` do workflow (AP-03 reprova se a lista divergir) e seu arquivo em `scripts/ci/verify-applied/<versão>.sql` (AP-19 exige um para cada opção).
