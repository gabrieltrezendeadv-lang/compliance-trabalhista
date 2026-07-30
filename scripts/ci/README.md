# `scripts/ci/` — teste de reconstrução sequencial das migrations

Ferramental do workflow manual
[`migration-rebuild-verify.yml`](../../.github/workflows/migration-rebuild-verify.yml).

## A pergunta que o teste responde

Que os 36 arquivos de [`supabase/migrations/`](../../supabase/migrations/) sejam
cópia fiel do SQL registrado no banco está provado por `md5_norm`, 36/36, por
[`tests/verify-recovered-migrations.mjs`](../../tests/verify-recovered-migrations.mjs).

Isso **não prova** que aplicá-los em ordem, num banco vazio, produza o schema
registrado em [`supabase/baseline/`](../../supabase/baseline/). Fidelidade de
arquivo e reprodutibilidade de estado são afirmações diferentes: o histórico
aplicado pode ser fiel e ainda assim insuficiente — se algum objeto entrou no
banco por fora de migration, o dump o contém e nenhuma migration o cria.

## Duas comparações, porque o snapshot tem duas metades

| | Arquivo | Como se compara |
|---|---|---|
| **Estrutura** | `schema.sql` | `pg_dump` do banco reconstruído × o snapshot, com as mesmas opções de dump |
| **Segurança** | `security.sql` | extração de catálogo × extração de catálogo (ver abaixo) |

`schema.sql` foi gerado com `--no-privileges`: contém **0 `GRANT` e 0 `REVOKE`**.
Não responde por privilégios. Cobre apenas o schema `public`.

## Por que a comparação de segurança não é de texto

`security.sql` **não é saída de ferramenta**. É arquivo redigido à mão, com prosa
e com DDL que *reproduz* o estado observado. As consultas ad hoc que o
originaram foram executadas pelo conector MCP e **não ficaram preservadas** — o
README do baseline registra quais catálogos foram lidos (`pg_proc`, `pg_class`,
`pg_policy`, `pg_default_acl`, `pg_namespace`), não o texto das consultas.

Reconstruir de memória aquele texto seria alegação sem prova. O caminho adotado
é mecânico: [`extract-security.sql`](extract-security.sql) roda **duas vezes**,
no mesmo Postgres descartável —

1. contra o banco reconstruído pelas 36 migrations;
2. contra o banco restaurado de `schema.sql` + `security.sql`.

A comparação é entre as duas extrações. `security.sql` entra como **insumo**,
exatamente como está versionado, e não precisa ser reinterpretado.

## Piso de ruído

Terceira medida, e a que dá base empírica à normalização: o dump do banco
restaurado a partir de `schema.sql`, comparado com o próprio `schema.sql`.

Toda diferença aí é, **por construção**, ruído de round-trip do `pg_dump` — não
defeito de migration. Se o piso é vazio, o diff estrutural pode ser lido
literalmente. Se não é, o piso delimita o que naquele diff é ambiente e o que é
conteúdo, em vez de deixar isso por conta de asserção.

## Regras de normalização

Implementadas em [`normalize-schema-dump.mjs`](normalize-schema-dump.mjs), que
imprime cada linha removida e falha se alguma regra tocar linha com aparência de
DDL.

| Regra | O que remove | Por quê |
|---|---|---|
| N1 | CRLF/CR → LF | fim de linha é propriedade do checkout, não do schema |
| N2 | `\restrict` / `\unrestrict <token>` | o token é **aleatório em cada execução** do `pg_dump`; dois dumps do mesmo banco diferem nessas duas linhas |
| N3 | `-- Dumped from database version` e `-- Dumped by pg_dump version` | comentários de versão de servidor e cliente; as versões são registradas no log, não perdidas |
| N4 | espaço em branco no fim da linha | invisível, sem efeito semântico |
| N5 | linhas em branco no fim do arquivo | consequência mecânica de N2 |

**O que a normalização não faz:** não reordena linhas, não colapsa linhas em
branco internas, não remove comentários de objeto, não uniformiza identificadores
ou literais, não remove `SET` de cabeçalho. Nenhuma regra alcança tabela, coluna,
tipo, constraint, índice, função, trigger, policy ou RLS.

Normalização embutida na extração de segurança, também declarada: ACL explodida
com `aclexplode()` (a ordem interna de um array de ACL não é estável nem
significativa), grantee `0` impresso como `PUBLIC`, ACL nula impressa como
`<ACL-NULA>` — estado distinto de ACL vazia e de ACL explícita —, e espaços em
sequência colapsados dentro de expressões de policy, porque `pg_get_expr` quebra
linha conforme o comprimento.

## Ausência de acesso remoto

[`assert-local-only.sh`](assert-local-only.sh) roda em quatro momentos: `pre`
(antes de instalar qualquer ferramenta), `config` (após `supabase init`), `dburl`
(após subir a stack) e `post` (ao final).

Os literais que a guarda de congelamento reprova em qualquer arquivo de
automação vivem em [`remote-access-denylist.txt`](remote-access-denylist.txt) —
um `.txt`, que não é varrido por ela. Um script de guarda precisa desses
literais como **dado** para procurá-los; mantê-los num arquivo de dados resolve
o conflito sem abrir exceção nominal em
[`tests/migration-freeze-guard.mjs`](../../tests/migration-freeze-guard.mjs).

Uma distinção que a guarda faz de propósito: `supabase init` **sempre** escreve
`project_id` no `config.toml`, e esse campo é o *nome local* do projeto — rótulo
dos contêineres Docker —, não um ref de projeto remoto. Reprová-lo por si
reprovaria todo uso legítimo do CLI local. A verificação precisa é outra: o
`project_id` tem de ser o nome do diretório do repositório, e o vínculo remoto
de verdade (`supabase/.temp/project-ref`) tem de continuar ausente.

## Limites deste teste

1. **Não prova ausência de deriva no banco de produção.** Prova ou refuta que as
   36 reproduzem o *snapshot de 29/07/2026*. Se o banco mudou depois, o snapshot
   está defasado e o teste não vê isso.
2. **Cobre apenas o schema `public`.** `auth`, `storage`, `vault`, `extensions` e
   `graphql` são da plataforma e ficam fora, como já ficavam do snapshot.
3. **A stack local não é o Supabase hospedado.** Default privileges, extensões
   pré-instaladas e configuração de Auth podem diferir. Diferença de ACL de
   tabela originada em *default privileges da plataforma* é diferença de
   ambiente, não defeito de migration — e precisa ser lida como tal.
4. **`SEC-005` não é migration.** O endurecimento de default privileges está em
   [`supabase/manual/`](../../supabase/manual/) e foi aplicado pelo dashboard;
   [`tests/reconciliation-guards.mjs`](../../tests/reconciliation-guards.mjs)
   exige que ele **não** esteja em `supabase/migrations`. Logo, é esperado que a
   extração de segurança do banco reconstruído não o contenha. Isso é uma lacuna
   real do histórico, não um erro do teste.
5. **Um diff vazio não é prova de equivalência semântica**, e sim de igualdade
   textual do dump após regras de normalização declaradas. É forte, não é total.

## Arquivos

| Arquivo | Papel |
|---|---|
| `assert-local-only.sh` | guarda de execução local; seções `pre`, `config`, `dburl`, `post` |
| `remote-access-denylist.txt` | padrões proibidos, como dado |
| `extract-security.sql` | extração somente leitura de ACL, RLS, propriedades de função e policies |
| `assert-no-public-execute.sql` | asserção geral: nenhuma rotina de `public` concede `EXECUTE` a `PUBLIC` |
| `normalize-schema-dump.mjs` | normalização auditável de dump estrutural |
| `check-ledger.mjs` | conferência do ledger local: 36 históricas + forward-only |

## A asserção de `EXECUTE` para `PUBLIC`

[`assert-no-public-execute.sql`](assert-no-public-execute.sql) roda contra o banco
reconstruído, depois de todas as migrations, e reprova se **qualquer** rotina de
`public` conceder `EXECUTE` a `PUBLIC`.

Três decisões que a tornam útil em vez de decorativa:

**Sem exceção nominal.** Nenhuma allowlist, nenhum nome citado, nenhum
`WHERE proname <> …`. `fn_process_webhook_event` não é tratada de forma especial:
se voltar a conceder, a asserção reprova como reprovaria qualquer outra.

**`COALESCE(proacl, acldefault('f', proowner))`.** `proacl` nulo não significa
"sem privilégios" — significa "privilégios default do PostgreSQL", e o default
para funções **inclui `EXECUTE` para `PUBLIC`**. Uma consulta que filtrasse
`proacl IS NOT NULL` deixaria passar exatamente o caso perigoso: a função
recém-criada que ninguém tocou.

**Cobre todas as rotinas executáveis**, sem filtro de `prokind`: funções,
procedures, agregados e window functions. A falha lista schema, nome, tipo,
assinatura obtida por `pg_get_function_identity_arguments` e a ACL encontrada.

Por que ela vive aqui e não em `supabase/checks/`: aquela pasta é reservada às
consultas de auditoria transpostas dos 13 arquivos pré-reconciliação, e **MF-17**
exige que seja estritamente leitura — a mensagem de erro desta asserção contém a
palavra `REVOKE` como orientação de correção, o que reprovaria MF-17. Trocar a
mensagem para agradar a guarda seria piorar a mensagem; o lugar certo é ao lado
do restante do ferramental de CI.
