# Rota protegida de aplicação de migrations

**Fase 6B.1** · workflow `.github/workflows/migration-apply.yml` · environment `db-production`

Até aqui não existia rota nenhuma. As duas migrations forward-only — `20260730123613` e `20260731094500` — estão corretas no repositório e **ausentes do banco**, e não havia caminho autorizado entre uma coisa e outra. Este documento descreve o caminho que passa a existir.

**Nada foi aplicado nesta fase.** O ledger remoto continua com as 36 históricas.

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

`supabase db push` aplica **todas** as pendentes; o CLI não tem flag para aplicar uma só. A rota resolve isso reservando temporariamente as demais forward-only fora de `supabase/migrations/`, exatamente como a âncora A do `migration-rebuild-verify` já faz e onde a técnica se provou. O CLI passa a enxergar uma única pendente — então o `--dry-run` tem de listar uma, e o push aplica uma.

Ao final os arquivos voltam e `git diff --exit-code` prova que o diretório ficou intacto. O passo de devolução tem `if: always()`: mesmo com falha no meio, o repositório do runner não fica mutilado.

## 4. Entrada fechada

A migration é um input `choice` com lista fixa. **Não existe campo de SQL, query ou comando.** Acrescentar uma forward-only exige acrescentar a opção neste arquivo — o que passa por PR e revisão. `tests/migration-apply-guard.mjs` (AP-03) reprova se a lista divergir de `supabase/migrations/`, então a lista não pode ficar desatualizada em silêncio.

## 5. Credencial

Um único secret, **`SUPABASE_DB_URL`**, no environment `db-production`. **Ele não existe ainda** — por decisão desta fase, a credencial só entra depois de as proteções estarem confirmadas. Sem ele, o workflow falha limpo no passo que o exige, sem tocar em nada.

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

Mais `tests/migration-apply-guard.mjs`, 21 asserções estáticas sobre as propriedades que tornam a rota segura.

Todas as defesas foram verificadas **por mutação**: remover o `pipefail` de qualquer um dos três passos, tirar o `--yes`, desfixar uma Action, publicar log cru, remover a verificação independente, aceitar `sslmode=prefer` ou declarar um destino sem o project ref — as nove reprovam.

**NÃO testado, e não simulado:** a conexão ao banco, o comportamento real do `supabase db push` e o efeito das migrations. Exigem credencial e banco de produção, que esta fase não autoriza.

**Ponto específico a observar na estreia:** não foi possível confirmar se esta versão do CLI pede confirmação interativa em `db push`. Se pedir, o passo travará até o timeout em vez de aplicar. É falha segura — trava, não aplica errado — mas é o primeiro ponto a verificar.
