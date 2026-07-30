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

O R1 tem duas metades, e só uma está resolvida.

**✅ Estruturalmente resolvido.** O schema é reconstruível a partir do
repositório e a reconstrução foi validada por restauração em ambiente
descartável. As 19 tabelas e 7 funções antes marcadas como "lacuna" nos
documentos de baseline **existem** e estão capturadas aqui — incluindo
`fn_resolve_tenant_id`, usada por 31 policies em 15 tabelas.

**❌ Não totalmente resolvido.** O histórico de migrations **não está
reconciliado**. Persiste uma divergência real:

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

Consequência prática: um banco criado a partir de `supabase/migrations/`
continua incompleto. Este snapshot contorna o problema para fins de
reconstrução e teste, mas **não o resolve**.

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
4. **Fase 4 — validação.** Aplicar as 36 em banco descartável e comparar com
   `schema.sql`. Critério de sucesso: diff estrutural vazio. ⬜ pendente

**Até a Fase 4 passar, este snapshot continua sendo a única via de reconstrução
com garantia.** Que as 36 reproduzam fielmente o SQL aplicado não prova que
aplicá-las em sequência produza o mesmo schema.

Também a corrigir na Fase 3: o cabeçalho de
`20260728154500_sec_002_retire_plan_limit.sql` diz "PROPOSTA: não executada
automaticamente", mas a migration **está aplicada** (versão `20260728191311`).

Enquanto as quatro fases não se completarem, **o R1 permanece parcialmente
aberto** e os testes de RLS/ACL que dependem de reconstrução a partir das
migrations continuam bloqueados. Ver
[`tests/db/README-R1.md`](../../tests/db/README-R1.md).

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
