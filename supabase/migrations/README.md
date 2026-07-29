# ⛔ MIGRATIONS CONGELADAS — não execute `supabase db push`

**Congelamento em vigor desde:** 29/07/2026
**Motivo:** divergência entre o histórico de migrations do repositório e o do banco
**Situação:** temporária, até a conclusão da reconciliação (Fase 3)

---

## O problema, em uma frase

Os 13 arquivos `.sql` desta pasta têm **prefixos de versão que não existem no
histórico do banco**. Para o Supabase CLI, todos os 13 estão **pendentes**.

## Prova

O CLI compara migrations locais e remotas **por timestamp**
([documentação oficial](https://supabase.com/docs/reference/cli/supabase-migration-fetch)).
A interseção entre os dois conjuntos é **vazia**:

| Versões nos arquivos locais | Versões registradas no banco |
|---|---|
| `20260724130000`, `20260724140000`, `20260724150000`, `20260724160000` | `20260724121902`, `20260724122001`, `20260724122058`, `20260724122324` |
| `20260727100000`, `20260727200000` | `20260728005535`, `20260728010455` |
| `20260728150000` … `20260728155000` (7 arquivos) | `20260728190937` … `20260728191324` (9 versões) |

Nenhum dos 13 identificadores locais aparece entre as 36 versões aplicadas.

A causa é histórica: as migrations foram aplicadas pelo **dashboard/MCP**, não
por `db push`. O banco gravou o timestamp da aplicação; o arquivo do
repositório carrega um timestamp escolhido à mão. `created_by` é o e-mail do
proprietário em todas as 36 — confirma a via de aplicação.

## Consequência

Um `supabase db push` consideraria as 13 pendentes e tentaria aplicá-las
**contra um banco onde o DDL equivalente já existe**. Não é hipótese remota: é
o comportamento normal do CLI diante deste estado.

O que aconteceria depende de cada arquivo — de erro por objeto duplicado até
`CREATE OR REPLACE` sobrescrevendo função já corrigida por migration
posterior. Em ambos os casos, é escrita não intencional em banco tratado
preventivamente como **produção**.

---

## Regras durante o congelamento

**Proibido:**

- `supabase db push`
- `supabase migration repair`
- `supabase migration up`
- `supabase db reset` **contra o projeto remoto**
- adicionar arquivo `.sql` nesta pasta
- alterar os arquivos `.sql` existentes

**Permitido:**

- `supabase db reset` contra a stack **local descartável** — é o que
  [`baseline-verify.yml`](../../.github/workflows/baseline-verify.yml) faz, com
  `DB_URL` vindo de `supabase status`, nunca do projeto remoto
- leitura: `supabase migration list`, consultas a catálogos, `pg_dump --schema-only`

A proibição é verificada automaticamente por
[`tests/migration-freeze-guard.mjs`](../../tests/migration-freeze-guard.mjs),
executado por `npm run verify` — e `Verify` é check obrigatório na `main`.

---

## Como criar schema hoje

Para reconstruir o schema em ambiente descartável, **não use esta pasta**. Use
o snapshot estrutural, que é restaurável e validado:

```bash
psql "$DB_URL" -f supabase/baseline/schema.sql
psql "$DB_URL" -f supabase/baseline/security.sql
psql "$DB_URL" -f supabase/baseline/verify.sql
```

Ver [`supabase/baseline/README.md`](../baseline/README.md).

---

## Estado do histórico

| | |
|---|---:|
| Versões aplicadas no banco | **36** |
| Arquivos `.sql` nesta pasta | **13** |
| Versões cobertas por esses arquivos | **15** |
| **Versões sem arquivo correspondente** | **21** |

São 15 versões cobertas por 13 arquivos porque
`20260728152500_priv_001_anonymous_assessments.sql` foi aplicada **dividida em
três** versões (`_ddl`, `_fns1`, `_fns2_grants`).

**Nenhuma migration é irrecuperável.** As 36 têm o SQL original preservado na
coluna `statements` de `supabase_migrations.schema_migrations` — cerca de
272 KB. É dessa tabela que `supabase migration fetch` reconstrói arquivos.

Sete correspondências já estão **provadas** por MD5 de SQL normalizado
(comentários e espaços removidos):

| Arquivo / origem | Versão aplicada |
|---|---|
| `20260724130000_create_complaint_tables.sql` | `20260724121902` |
| `20260724150000_create_campaign_tables.sql` | `20260724122058` |
| `20260724160000_campaign_functions.sql` | `20260724122324` |
| `sec002_check_plan_limit_derive_tenant` (branch `security/block1-deploy`) | `20260726004028` |
| `sec004_remove_member_rpc` (idem) | `20260726004137` |
| `sec005_campaign_employee_profiles` (idem) | `20260726004204` |
| `sec006_webhook_transactional_idempotent` (idem) | `20260726004230` |

---

## Plano de saída do congelamento

1. **Fase 1 — esta.** Congelamento documentado e guarda de CI. Nenhuma
   alteração de banco.
2. **Fase 2.** `supabase migration fetch --linked` em ambiente descartável,
   recuperando as 36 com os timestamps remotos. Operação de **leitura** no
   banco.
3. **Fase 3.** Reconciliar: os 13 arquivos atuais migram para
   `supabase/history/pre-reconciliation/` como evidência histórica — eles
   contêm comentários e queries de verificação que **não** foram aplicados — e
   esta pasta passa a conter apenas o histórico canônico das 36 versões.
4. **Fase 4.** Validar: aplicar as 36 em banco descartável e comparar o
   resultado com `supabase/baseline/schema.sql`. Critério de sucesso: diff
   estrutural vazio.

O congelamento só é levantado ao fim da Fase 4.

---

## Itens correlatos, tratados à parte

**Ausência de rollbacks.** As 36 versões aplicadas têm a coluna `rollback`
**vazia**. Não existe rollback registrado para nenhuma alteração já em
produção. É risco independente desta reconciliação e **não** será resolvido
com rollbacks retroativos inventados — apenas registrado. Ver
[`docs/baseline/security-model.md`](../../docs/baseline/security-model.md).

**`20260729000000_onboarding_tenant_guard`.** Existe apenas na branch
`feat/onboarding-tenant-guard` (`43582c3`), **não** foi aplicada no banco e
**não** está autorizada. Não entra nesta pasta durante o congelamento.
