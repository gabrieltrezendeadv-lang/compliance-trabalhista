# Baseline de banco — snapshot estrutural

**Data do snapshot:** 29/07/2026
**Etapa:** resolução do bloqueante **R1**

---

## ⚠️ Leia antes de usar

**Estes arquivos NÃO devem ser aplicados no banco principal.**

Eles descrevem um estado que o banco principal **já possui**. Aplicá-los ali é,
na melhor hipótese, redundante; na pior, destrutivo — `security.sql` contém
`REVOKE` amplos que retirariam privilégios em uso.

O destino correto é **exclusivamente ambiente descartável**: validação em CI,
reconstrução local para desenvolvimento, ou conferência por diferença.

---

## Origem

| | |
|---|---|
| Projeto Supabase | `tvwgzpgyfdfrbdaeoqzl` (`compliance-trabalhista`) |
| Organização | `qjngbyxpatjmwfpyffri` |
| Região | `sa-east-1` |
| PostgreSQL | 17.6.1.147 |
| Branch do banco | `main` (única; `is_default: true`, sem branches de preview) |
| Migrations aplicadas | 36 |

### Classificação do ambiente

> **ambiente não confirmado — banco `tvwgzpgyfdfrbdaeoqzl` identificado e tratado preventivamente como produção**

| Vínculo | Estado | Evidência |
|---|---|---|
| Repositório → banco | **CONFIRMADO** | o histórico de migrations do banco contém, textualmente, os nomes dos arquivos de `supabase/migrations/` — `20260728150000_fix_001_evidence_reports`, `20260728152500_priv_001_anonymous_assessments_*`, `20260728154500_sec_002_retire_plan_limit`, entre outros |
| Vercel (deploy) → banco | **NÃO CONFIRMADO** | sem CLI, token ou conector MCP da Vercel; o bundle público está atrás de Deployment Protection. Nome, região e datas são indícios, não prova |

Como o vínculo com o deploy não foi comprovado e não existe ambiente de
preview separado, o banco é tratado **preventivamente como produção**.

---

## Arquivos

| Arquivo | Bytes | SHA-256 |
|---|---:|---|
| `schema.sql` | 222.657 | `02c946b569240195e383845fe43f3b4661e606683168473c02a222f064466b04` |
| `security.sql` | 15.162 | `ce07cdc41f5c1ce6714335ca43b931706be040c9e312bf1c9e9515124de5ce78` |
| `verify.sql` | 12.811 | `a05916c10bce32ada9a8e3e471d34eac13296e03bdc5145e23e373a706b21084` |

Os três acima são o snapshot e não mudam. Acompanham a pasta, sem hash fixo
porque são documentação viva: [`README.md`](README.md),
[`applied-migrations.tsv`](applied-migrations.tsv) — a matriz das 36 versões
aplicadas — e
[`PHASE-4C-REBUILD-REPORT.md`](PHASE-4C-REBUILD-REPORT.md) — o resultado do teste
de reconstrução sequencial.

Conferência:

```bash
sha256sum -c <<'EOF'
02c946b569240195e383845fe43f3b4661e606683168473c02a222f064466b04  supabase/baseline/schema.sql
ce07cdc41f5c1ce6714335ca43b931706be040c9e312bf1c9e9515124de5ce78  supabase/baseline/security.sql
a05916c10bce32ada9a8e3e471d34eac13296e03bdc5145e23e373a706b21084  supabase/baseline/verify.sql
EOF
```

### Conteúdo

**`schema.sql`** — estrutura: 39 tabelas, 25 tipos (24 enums + o composto
`plan_limits`), 50 funções com corpo e assinatura exata, 31 triggers, 73
índices explícitos (os demais são criados implicitamente por PK/UNIQUE), 159
constraints, `ENABLE ROW LEVEL SECURITY` nas 39 tabelas e 78 policies com
`USING`/`WITH CHECK`.

**`security.sql`** — owners, ACL das 50 funções, grants de tabela e de schema,
default privileges, estado de RLS e de `FORCE RLS`, revogações e comentários
das decisões intencionais. Nenhuma ACL foi substituída por `GRANT ALL`.

**`verify.sql`** — 8 blocos de asserção que falham com `EXCEPTION` na primeira
divergência.

> **Por que a separação importa:** o dump foi gerado com `--no-privileges`, de
> modo que `schema.sql` contém **zero** `GRANT`/`REVOKE`. As permissões vivem
> apenas em `security.sql`. Restaurar só o `schema.sql` produz um banco
> estruturalmente correto e **sem permissão alguma** para `anon`,
> `authenticated` ou `service_role`. Os dois arquivos são obrigatórios, nesta
> ordem.
>
> A Fase 4C não mudou isso. A estrutura passou a ter uma segunda via de
> reconstrução — as 36 migrations —, mas **`security.sql` continua necessário**
> para reconstrução completa pelo baseline, e é o único lugar do repositório
> onde as permissões observadas em produção estão registradas. Ver
> [`PHASE-4C-REBUILD-REPORT.md`](PHASE-4C-REBUILD-REPORT.md).

---

## Método de extração

Duas fontes, ambas somente leitura:

**1. `schema.sql` — `pg_dump`**, executado no runner do GitHub Actions
(workflow temporário, já removido), usando o Repository secret
`SUPABASE_DB_URL_DUMP`. O segredo nunca foi exposto ao agente nem impresso em
log.

```bash
pg_dump "$DB_URL" \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-privileges \
  --no-tablespaces \
  -f supabase/baseline/schema.sql
```

`pg_dump` 17.10 (PGDG) contra servidor 17.6.

**2. `security.sql` e `verify.sql`** — consultas somente leitura aos catálogos
(`pg_proc`, `pg_class`, `pg_policy`, `pg_constraint`, `pg_default_acl`,
`pg_namespace`) via conector MCP do Supabase.

### Confirmação de que é schema-only

`--schema-only` não emite dados. Verificado por asserção, no job de dump e
novamente em `baseline-verify.yml`:

| Padrão | Ocorrências |
|---|---:|
| `^COPY .* FROM stdin;` | 0 |
| `^INSERT INTO ` | 0 |
| `eyJ[A-Za-z0-9_-]{20,}` (JWT) | 0 |
| `postgres(ql)?://user:senha@` | 0 |

**Nenhuma linha de tabela foi lida em momento algum** — nem de denúncias, nem
de avaliações, nem de usuários, nem de qualquer outra tabela de negócio.

---

## Restauração

Precisa de uma stack Supabase, não de um PostgreSQL puro: o schema depende de
`auth.uid()` (71 referências), `auth.users` (21), `auth.role()` (5) e do
`pgcrypto` instalado no schema `extensions` (`crypt`, `gen_salt`, `digest`).

```bash
mkdir -p /tmp/sbtest && cd /tmp/sbtest
supabase init --force
supabase start

export DB_URL="$(supabase status -o env | grep '^DB_URL=' | cut -d= -f2- | tr -d '"')"
cd /caminho/do/repositorio

psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/baseline/schema.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/baseline/security.sql
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/baseline/verify.sql
```

`psql` precisa ser **17.6 ou superior**: o dump usa a diretiva `\restrict`,
introduzida nas versões recentes do `pg_dump` como proteção contra injeção na
restauração. Clientes mais antigos falham na primeira linha.

O workflow [`baseline-verify.yml`](../../.github/workflows/baseline-verify.yml)
executa esse ciclo automaticamente a cada alteração em `supabase/baseline/**`,
incluindo backup do descartável, restauração do backup e nova execução do
`verify.sql`.

---

## Snapshot ≠ migration

| | Snapshot (esta pasta) | Migration (`supabase/migrations/`) |
|---|---|---|
| Descreve | um **estado** observado | uma **transição** de estado |
| Idempotente | não | não |
| Aplicado ao banco principal | **nunca** | sim, uma vez, em ordem |
| Registrado em `supabase_migrations` | não | sim |
| Serve para | reconstruir do zero, conferir por diferença | evoluir o schema |

**É por isso que estes arquivos não estão em `supabase/migrations/`.** Colocá-los
lá faria a ferramenta tentar aplicá-los como se fossem uma transição pendente,
duplicando objetos que já existem e conflitando com as 36 migrations do
histórico.

---

## Limitações

1. **Somente o schema `public`.** Ficaram de fora `auth`, `storage`, `vault`,
   `graphql` e `extensions` — todos geridos pela plataforma Supabase.
2. **Sem dados.** Nem de negócio, nem de configuração, nem seeds.
3. **Sem objetos de plataforma:** papéis, JWT secret, configuração de Auth,
   buckets de Storage, Edge Functions, cron jobs e webhooks não estão aqui.
4. **Instantâneo com data.** Vale para 29/07/2026. Qualquer migration aplicada
   depois torna o snapshot defasado, e `verify.sql` passará a falhar — o que é
   o comportamento desejado, não um defeito.
5. **Extensões não incluídas.** O dump de `public` não traz `CREATE EXTENSION`.
   A stack do Supabase já provê `pgcrypto` e `uuid-ossp` em `extensions`.
6. **`--no-owner` e `--no-privileges`.** Ownership não é reproduzido; ACL vem
   de `security.sql`.

---

## Estado do R1 e reconciliação futura

> **Atualização de 30/07/2026.** As duas metades descritas abaixo foram
> resolvidas: o histórico foi reconciliado na Fase 3 e a reconstrução sequencial
> foi validada por hash na Fase 4C. O que permanece aberto do R1 é a metade de
> **permissões**, não a de estrutura. As subseções seguintes preservam o registro
> do diagnóstico original — com as consequências já marcadas como superadas onde
> for o caso — porque a cronologia é parte da evidência.

O R1 tinha duas metades, e no diagnóstico original só uma estava resolvida.

**✅ Estruturalmente resolvido.** O schema é reconstruível a partir do
repositório e a reconstrução foi validada por restauração em ambiente
descartável. As 19 tabelas e 7 funções antes marcadas como "lacuna" nos
documentos de baseline **existem** e estão capturadas aqui — incluindo
`fn_resolve_tenant_id`, usada por 31 policies em 15 tabelas.

**❌ Não totalmente resolvido — à época.** O histórico de migrations **não estava
reconciliado**. Havia então uma divergência real:

- o banco registra **36 versões** aplicadas;
- o repositório tem **13 arquivos** em `supabase/migrations/`, que cobrem **15**
  dessas versões (`priv_001` foi aplicada dividida em três);
- restam **21 versões sem arquivo correspondente antes da recuperação** —
  `foundation`, `onboarding_function`, `create_evidence_tables`,
  `evidence_security_definer_functions`, `create_profiles_table`,
  `assessment_tables`, `assessment_functions`, `migrate_pin_to_bcrypt`,
  `fix_rls_recursion_complaint_investigators`, `create_risk_inventory_tables`,
  `risk_inventory_functions`, `create_webhook_events_table`,
  `add_trialing_to_subscription_status`, `create_billing_tables_only`,
  `create_billing_functions` e a série `sec001`–`sec006`.

**Nenhuma migration é irrecuperável.** O SQL original das 36 está preservado na
coluna `statements` de `supabase_migrations.schema_migrations` — cerca de
272 KB — e é dela que `supabase migration fetch` reconstrói arquivos locais
([documentação oficial](https://supabase.com/docs/reference/cli/supabase-migration-fetch)).

Sete correspondências estão **provadas** por MD5 de SQL normalizado: três
arquivos do repositório e quatro das seis migrations `sec001`–`sec006`
preservadas na branch `origin/security/block1-deploy` (commit `9f99a92`).

Consequência prática **até a Fase 3**: um banco criado a partir de
`supabase/migrations/` era incompleto, e o snapshot contornava o problema sem
resolvê-lo.

**Superado.** Depois da reconciliação (Fase 3) e da validação por reconstrução
sequencial (Fase 4C), um banco criado a partir de `supabase/migrations/` tem o
schema `public` **estruturalmente completo** — provado por igualdade de SHA-256
contra este snapshot. O que continua incompleto nesse banco são as
**permissões**: ver as pendências da Fase 4C acima e
[`PHASE-4C-REBUILD-REPORT.md`](PHASE-4C-REBUILD-REPORT.md).

### Risco resolvido na Fase 3 — divergência de histórico

Os 13 arquivos tinham prefixos de versão **ausentes** do histórico remoto
(interseção vazia). Como o CLI compara por timestamp, para ele os 13 estavam
pendentes, e um `supabase db push` tentaria aplicá-los contra um banco onde o
DDL equivalente já existe.

**Reconciliado.** `supabase/migrations/` passou a conter as 36 versões
aplicadas, com prefixos idênticos aos do banco; a interseção, antes vazia, é
total. Os 13 anteriores estão preservados em
[`supabase/history/pre-reconciliation/`](../history/pre-reconciliation/README.md).

A guarda `tests/migration-freeze-guard.mjs` continua em vigor e as proibições
não foram relaxadas — `db push`, `migration up`, `migration repair` e
`migration fetch` seguem bloqueados, agora sem nenhuma exceção nominal. Ver
[`supabase/migrations/README.md`](../migrations/README.md).

### Estratégia aprovada para a reconciliação

Fonte de verdade: **o histórico registrado no banco**.

1. **Fase 1 — congelamento.** Bloquear `db push` por documentação e guarda de
   CI. Sem alteração de banco. ✅ concluída
2. **Fase 2 — recuperação.** Recuperar as 36 versões com os timestamps remotos,
   por leitura de `supabase_migrations.schema_migrations`. ✅ concluída.

   O plano original previa `supabase migration fetch` num ambiente descartável.
   O workflow correspondente **falhou nas três tentativas**, sempre no mesmo
   passo e sem escrever nada — `failed to connect to postgres`, antes mesmo da
   validação de credencial. A recuperação saiu pelo plano B: leitura da coluna
   `statements` pelo conector já autenticado, sem CLI, sem secret e sem conexão
   direta ao banco.

   Fidelidade provada por `md5_norm`: 36/36 contra
   [`applied-migrations.tsv`](applied-migrations.tsv). O workflow temporário foi
   removido na Fase 3, e com ele a exceção que permitia `migration fetch`.
3. **Fase 3 — reconciliação.** Os 13 arquivos migram para
   `supabase/history/pre-reconciliation/` como evidência histórica — contêm
   comentários e queries de verificação que não foram aplicados — e
   `supabase/migrations/` passa a conter apenas o histórico canônico das 36.
   ✅ concluída
4. **Fase 4 — validação.** Aplicar as 36 em banco descartável e comparar com o
   snapshot. Executada em 30/07/2026 pelo workflow manual
   [`migration-rebuild-verify.yml`](../../.github/workflows/migration-rebuild-verify.yml);
   ferramental e limites em [`scripts/ci/README.md`](../../scripts/ci/README.md);
   resultado integral em
   [`PHASE-4C-REBUILD-REPORT.md`](PHASE-4C-REBUILD-REPORT.md).

   O critério tem **duas metades**, porque o snapshot também tem, e elas
   terminaram em estados diferentes:

   - **✅ Estrutural — APROVADA.** As 36 migrations, aplicadas em sequência num
     banco vazio, reproduzem `schema.sql` com **igualdade de SHA-256**:
     snapshot, banco reconstruído e banco restaurado do snapshot produzem dumps
     normalizados byte-idênticos
     (`1f938ed09ed834290729697e4db5e3e02c045d06ccda9d187ec7c4287d1c3c0c`). Diff
     estrutural normalizado vazio, piso de ruído vazio, 36/36 aplicadas sem
     falha, ledger com exatamente as 36 versões.
   - **❌ Segurança / ACLs — NÃO APROVADA.** Uma divergência material, uma de
     ambiente pendente de decisão, e duas categorias que ficaram não
     comparáveis por limitação do procedimento.

**O schema `public` é reconstruível pelas 36 migrations do repositório, e a
equivalência estrutural não depende mais exclusivamente deste snapshot.** Para
estrutura há agora duas vias independentes que provaram concordar. Para
permissões continua havendo uma só: `security.sql`.

### Pendências abertas pela Fase 4C

**`fn_process_webhook_event` — exige migration forward-only separada.** A função
`public.fn_process_webhook_event(text, …, timestamptz, jsonb)`, que é
`SECURITY DEFINER`, fica executável por **`PUBLIC`** — e portanto por `anon` —
num banco reconstruído a partir das 36 migrations. Nos extratos de segurança
usados no teste, o baseline mostra a função executável apenas por `postgres` e
`service_role`; nenhuma consulta ao banco de produção foi feita nessa
verificação.

A causa é preexistente e está no histórico já aplicado: `sec001` revoga de
`PUBLIC` apenas as funções **existentes** e registra
`ALTER DEFAULT PRIVILEGES skipped — requires superuser`, delegando a cada
migration posterior o seu próprio `REVOKE`. Sete das oito migrations que criam
função depois disso cumprem; `sec006_webhook_transactional_idempotent` não tem
nenhum `REVOKE`. Em produção a lacuna não se manifesta porque SEC-005 foi
aplicado manualmente pelo dashboard, fora das migrations — está em
[`../manual/`](../manual/), e `tests/reconciliation-guards.mjs` exige que não
esteja em `../migrations/`.

**Default privileges e ACLs de tabela — exigem decisão explícita posterior.**
Nenhuma das 36 migrations concede DML de tabela (exceção única:
`priv_001_…_fns2_grants`, sobre `assessment_dispatches`). Em produção esses
privilégios vieram dos *default privileges* da plataforma hospedada. O fato a
decidir é que **as ACLs de tabela de produção não estão no repositório**: ou
passam a ser parte do histórico versionado, ou se declara formalmente que a
contenção é a RLS — reproduzida com exatidão, 39/39 tabelas e 78/78 policies — e
que os grants de tabela são responsabilidade da plataforma. Não é diferença
cosmética, e não foi tratada no PR da reconciliação.

**`schema.sql` não contém privilégios.** Consequência do `--no-privileges`: 0
`GRANT`, 0 `REVOKE`. Restaurar só o `schema.sql` produz banco sem permissão
alguma para as roles de API.

Que as 36 reproduzam fielmente o SQL aplicado nunca provou que aplicá-las em
sequência produzisse o mesmo schema — e é justamente isso que a Fase 4C provou,
para a estrutura, por hash.

Também a corrigir na Fase 3: o cabeçalho de
`20260728154500_sec_002_retire_plan_limit.sql` diz "PROPOSTA: não executada
automaticamente", mas a migration **está aplicada** (versão `20260728191311`).

**Estado do R1 após a Fase 4C.** A metade estrutural está fechada: as quatro
fases se completaram e a reconstrução a partir de `../migrations/` é
byte-equivalente a este snapshot. Os testes de RLS que dependem de reconstrução
a partir das migrations **deixam de estar bloqueados** — RLS e policies foram
reproduzidas com exatidão, 39/39 tabelas e 78/78 policies.

Os testes de **ACL** continuam bloqueados, e agora por motivo conhecido e
documentado, não por incógnita: os grants de tabela de produção não estão no
repositório, e a decisão sobre isso está pendente (§ pendências da Fase 4C). Ver
[`tests/db/README-R1.md`](../../tests/db/README-R1.md) e
[`PHASE-4C-REBUILD-REPORT.md`](PHASE-4C-REBUILD-REPORT.md).

### Item separado — ausência de rollbacks

As 36 versões aplicadas têm a coluna `rollback` **vazia**. Não existe rollback
registrado para nenhuma alteração já em produção. É risco **independente** desta
reconciliação, não será resolvido com rollbacks retroativos inventados, e não
deve bloquear a reconciliação. Registrado para tratamento próprio.

---

## Achados registrados durante a extração

1. **`PUBLIC` não tem `EXECUTE` em nenhuma das 50 funções.** O endurecimento
   SEC-001/SEC-005 está aplicado: o default privilege de funções de `postgres`
   em `public` é `{postgres=X}`.
2. **SEC-002 está aplicada.** `check_plan_limit` tem ACL `{postgres=X}` nas duas
   assinaturas — nenhuma role de API a executa.
3. **Nenhuma tabela usa `FORCE ROW LEVEL SECURITY`.** O proprietário `postgres`
   ignora todas as policies. É o padrão do PostgreSQL, mas significa que
   migrations e acesso administrativo não são contidos por RLS.
4. **`fn_resolve_tenant_id` usa `LIMIT 1` sem `ORDER BY`.** A seleção de tenant
   é não determinística para usuário com múltiplas memberships — a causa está
   no SQL, não no TypeScript. Registrado como TG-12. `organization_members`
   possui `created_at` (`NOT NULL`, default `now()`) e `id` (PK), suficientes
   para uma ordenação determinística; a correção afeta 31 policies e ficará em
   migration isolada.
5. **`fn_import_risks_from_cycle`** tem grant a `authenticated` mas não a
   `service_role` — assimetria registrada, não corrigida.
6. **`search_path`:** 47 funções usam `''`; três — `fn_resolve_tenant_id`,
   `fn_create_organization_with_owner`, `fn_user_has_role` — usam
   `'public, pg_temp'`.
