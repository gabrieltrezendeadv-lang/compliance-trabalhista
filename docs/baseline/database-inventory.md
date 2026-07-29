# Neo SST — Inventário de Banco de Dados (linha de base)

**Etapa:** 0 — Congelamento da linha de base
**Commit de referência:** `3f616a5` (`origin/main`)
**Data:** 29/07/2026

> **ATUALIZADO EM 29/07/2026 — introspecção real do banco realizada.**
>
> A versão anterior deste documento derivava o inventário do código-fonte e
> marcava 19 tabelas e 7 funções como "lacuna", significando "não existe no
> repositório". A introspecção do projeto `tvwgzpgyfdfrbdaeoqzl` confirmou que
> **todas existem no banco**. As seções abaixo foram corrigidas.
>
> Snapshot estrutural versionado em [`supabase/baseline/`](../../supabase/baseline/README.md).

---

## 1. Estado do R1 — parcialmente resolvido

O R1 tem duas metades. Uma foi resolvida; a outra não.

### ✅ Estruturalmente resolvido

O schema é reconstruível a partir do repositório, e a reconstrução foi validada
por restauração em ambiente descartável (workflow `baseline-verify.yml`):

| Métrica | Valor real |
|---|---:|
| Tabelas em `public` | **39** |
| Com RLS habilitado | **39 (100%)** |
| Funções em `public` | **50** |
| Policies | **78** |
| Tipos | **25** (24 enums + `plan_limits`) |
| Triggers | **31** |
| Constraints | **159** |
| Índices | **124** |

As 19 tabelas e as 7 funções antes marcadas como lacuna **existem** e estão
capturadas no snapshot — inclusive `fn_resolve_tenant_id`, da qual dependem 31
policies em 15 tabelas.

### ❌ Não totalmente resolvido — histórico de migrations não reconciliado

| Origem | Migrations |
|---|---:|
| Registradas no banco | **36** |
| Versionadas em `supabase/migrations/` | **13** |
| **Nunca versionadas** | **23** |

Entre as não versionadas: `foundation`, `onboarding_function`,
`create_evidence_tables`, `create_profiles_table`, `assessment_tables`,
`create_risk_inventory_tables`, `create_billing_tables_only`,
`create_webhook_events_table` e a série `sec001`–`sec006`.

**Consequência:** um banco criado a partir de `supabase/migrations/` continua
incompleto. O snapshot contorna isso para reconstrução e teste, mas não
substitui a reconciliação. Estratégia proposta no
[README do baseline](../../supabase/baseline/README.md#estratégia-proposta-para-a-reconciliação).

---

## 2. Tabelas

### 2.1 Versionadas no repositório (11)

Origem: `CREATE TABLE` em `supabase/migrations/**`.

| Tabela | Migration de origem |
|---|---|
| `complaints` | `20260724130000_create_complaint_tables.sql` |
| `complaint_contents` | `20260724130000` |
| `complaint_messages` | `20260724130000` |
| `complaint_investigators` | `20260724130000` |
| `complaint_audit_log` | `20260724130000` |
| `campaigns` | `20260724150000_create_campaign_tables.sql` |
| `campaign_templates` | `20260724150000` |
| `campaign_recipients` | `20260724150000` |
| `campaign_deliveries` | `20260724150000` |
| `campaign_acknowledgments` | `20260724150000` |
| `assessment_dispatches` | `20260728152000_fix_004_assessment_submission.sql` |

### 2.2 CONFIRMADAS NO BANCO — não versionadas como migration (19)

**Correção:** estas tabelas **existem** no banco e estão capturadas em
`supabase/baseline/schema.sql`. O que falta é a migration que as criou estar
versionada — elas vieram das 23 migrations não reconciliadas (§1).

| # | Tabela | Consumidor principal |
|---:|---|---|
| 1 | `organizations` | `src/lib/organizations/actions.ts`, layout do dashboard |
| 2 | `profiles` | layout do dashboard, `src/lib/auth-actions.ts` |
| 3 | `organization_members` | resolução de tenant em praticamente todos os módulos |
| 4 | `establishments` | `src/lib/organizations/actions.ts` |
| 5 | `departments` | `src/lib/organizations/actions.ts` |
| 6 | `employee_profiles` | `src/lib/employees/actions.ts` |
| 7 | `assessment_cycles` | `src/lib/assessments/actions.ts` |
| 8 | `assessment_invitations` | `src/lib/assessments/actions.ts` |
| 9 | `questionnaire_templates` | `src/lib/assessments/actions.ts` |
| 10 | `risk_items` | `src/lib/risks/actions.ts` |
| 11 | `risk_action_plans` | `src/lib/risks/actions.ts` |
| 12 | `risk_reviews` | `src/lib/risks/actions.ts` |
| 13 | `evidence_reports` | `src/lib/evidence/actions.ts` |
| 14 | `evidence_packages` | `src/lib/evidence/actions.ts` |
| 15 | `evidence_package_items` | `src/lib/evidence/actions.ts` |
| 16 | `subscription_plans` | `src/lib/billing/actions.ts` |
| 17 | `tenant_subscriptions` | `src/lib/billing/{actions,guard}.ts` |
| 18 | `invoices` | `src/lib/billing/actions.ts` |
| 19 | `billing_events` | `src/app/api/webhooks/billing/route.ts` |

### 2.3 Versionadas, sem consulta direta da aplicação (3)

Acessadas apenas via funções `SECURITY DEFINER` ou por junção — o que é o
comportamento **desejado** para dados sensíveis.

| Tabela | Observação |
|---|---|
| `complaint_contents` | conteúdo da denúncia, acessível só por RPC autorizada |
| `complaint_investigators` | atribuição por caso |
| `campaign_recipients` | acessada por junção em `campaign_deliveries` |

### 2.4 Referenciadas em migrations, sem `CREATE TABLE` no repositório

Citadas em corpo de função ou policy, mas nunca criadas aqui — subconjunto
adicional da lacuna: `assessment_responses`, `assessment_questions`.
Confirmação depende do dump pendente (R1).

---

## 3. Funções

### 3.1 Versionadas no repositório (29)

Origem: `CREATE [OR REPLACE] FUNCTION public.*` em `supabase/migrations/**`.

**De negócio, chamadas pela aplicação:**
`fn_access_complaint_v2`, `fn_assessment_cycle_summary`,
`fn_assessment_group_results`, `fn_assessment_participation_stats`,
`fn_close_expired_assessment_cycles`, `fn_generate_evidence_report`,
`fn_get_campaign_stats`, `fn_get_complaint_detail`, `fn_get_complaint_list`,
`fn_get_questionnaire_for_token`, `fn_import_risks_from_cycle`,
`fn_prepare_campaign_send`, `fn_remove_member`, `fn_send_reporter_message_v2`,
`fn_submit_assessment`, `fn_submit_complaint`, `fn_update_complaint_status`.

**Internas (triggers, imutabilidade, rate limit):**
`fn_audit_log_immutable`, `fn_campaign_templates_immutable_tenant`,
`fn_campaign_updated_at`, `fn_campaigns_immutable_tenant`,
`fn_check_pin_rate_limit_v2`, `fn_complaints_immutable_tenant`,
`fn_complaints_updated_at`, `fn_record_delivery_event`, `fn_record_pin_failure`.

**Legadas / em retirada:**
`fn_access_complaint` (substituída por `_v2`),
`fn_send_reporter_message` (substituída por `_v2`),
`check_plan_limit` (duas assinaturas; `EXECUTE` revogado de todas as roles pela
migration `20260728154500_sec_002_retire_plan_limit.sql`).

### 3.2 CONFIRMADAS NO BANCO — não versionadas como migration (7)

**Correção:** todas as 7 **existem** no banco e estão em
`supabase/baseline/schema.sql`. O erro ocorreria apenas num banco reconstruído
somente a partir de `supabase/migrations/`, sem o snapshot.

| # | Função | Chamada em | Papel |
|---:|---|---|---|
| 1 | `fn_resolve_tenant_id` | `src/lib/evidence/actions.ts:31`, `src/lib/risks/actions.ts:29` e **4 policies** da migration `20260728152500_priv_001_anonymous_assessments.sql` | resolve o tenant do usuário — usada dentro de RLS |
| 2 | `fn_seal_evidence_package` | `src/lib/evidence/actions.ts` | sela pacote de evidências (imutabilidade + hash) |
| 3 | `fn_get_evidence_report_detail` | `src/lib/evidence/actions.ts` | detalhe do relatório de evidência |
| 4 | `fn_get_evidence_package_detail` | `src/lib/evidence/actions.ts` | detalhe do pacote |
| 5 | `fn_get_risk_detail` | `src/lib/risks/actions.ts` | detalhe do risco |
| 6 | `fn_get_risk_inventory_summary` | `src/lib/risks/actions.ts` | resumo do inventário |
| 7 | `fn_process_webhook_event` | `src/app/api/webhooks/[provider]/route.ts` | processamento transacional e idempotente de webhook |

**Agravante — `fn_resolve_tenant_id`:** além de ser chamada pela aplicação, é
usada **dentro de policies de RLS** criadas pela migration `20260728152500`.
Aplicar essa migration em um banco que não tenha a função resulta em policies
quebradas, com efeito direto sobre isolamento de tenant. É a lacuna de maior
risco desta lista.

---

## 4. Migrations versionadas

| Arquivo | Rollback | Objetivo |
|---|---|---|
| `20260724130000_create_complaint_tables.sql` | — | tabelas e RLS do canal de denúncias |
| `20260724140000_complaint_security_definer_functions.sql` | — | funções autorizadas do canal |
| `20260724150000_create_campaign_tables.sql` | — | tabelas e RLS de campanhas |
| `20260724160000_campaign_functions.sql` | — | preparo de envio e estatísticas |
| `20260727100000_sec_block1_expand.sql` | ✅ | SEC-BLOCK1 — fase expand |
| `20260727200000_sec_block1_contract.sql` | ✅ | SEC-BLOCK1 — fase contract |
| `20260728150000_fix_001_evidence_reports.sql` | ✅ | FIX-001 — alinha consulta ao schema real |
| `20260728151000_fix_003_reverse_scoring.sql` | ✅ | FIX-003 — pontuação reversa |
| `20260728152000_fix_004_assessment_submission.sql` | ✅ | FIX-004 — trava de convite e `assessment_dispatches` |
| `20260728152500_priv_001_anonymous_assessments.sql` | ✅ | PRIV-001 — token por hash, lote anônimo, limiar |
| `20260728153000_sec_006_table_privileges.sql` | ✅ | SEC-006 — privilégios de tabela |
| `20260728154500_sec_002_retire_plan_limit.sql` | ✅ | SEC-002 — revoga `check_plan_limit` |
| `20260728155000_fix_005_close_expired_cycles.sql` | ✅ | FIX-005 — encerramento de ciclos |

**As 4 primeiras migrations não possuem rollback versionado** em
`supabase/rollbacks/`, contrariando o roadmap §4.3.

### Fora do fluxo automático

| Arquivo | Natureza |
|---|---|
| `supabase/manual/sec_005_default_function_privileges_dashboard.sql` (+ rollback) | etapa manual de dashboard — o guard `reconciliation-guards.mjs` verifica que **não** bloqueia migrations automáticas |
| `supabase/scripts/sec001_alter_default_privileges_dashboard.sql` | script de default privileges |
| `supabase/scripts/data001_seed_inventory_readonly.sql` | inventário somente leitura |
| `supabase/seed_campaigns.sql`, `supabase/seed_complaints.sql` | seeds |
| `docs/security/archive/20260726200000_sec_block1_consolidation.sql` (+ rollback) | consolidação arquivada |

---

## 5. Estado de aplicação — agora conhecido

**Correção.** A versão anterior dizia que o estado era indeterminável. A
introspecção resolveu isso.

**SEC-002 ESTÁ APLICADA.** O cabeçalho de
`20260728154500_sec_002_retire_plan_limit.sql` diz "PROPOSTA: não executada
automaticamente", e isso está **desatualizado**: a migration consta do
histórico do banco como versão `20260728191311`, e `check_plan_limit` tem ACL
`{postgres=X/postgres}` nas duas assinaturas — nenhuma role de API a executa.

As 13 migrations versionadas correspondem a entradas do histórico remoto. O que
não corresponde é o inverso: 23 migrations aplicadas no banco não têm arquivo
no repositório (§1).

**Não aplicada:** `20260729000000_onboarding_tenant_guard` — a migration da
branch `feat/onboarding-tenant-guard` **nunca foi executada**. O banco mantém
`fn_create_organization_with_owner` retornando `uuid` e lançando
`RAISE EXCEPTION`, e `fn_check_active_tenant` **não existe**.

---

## 6. Tipagem TypeScript do banco

`src/types/database.ts` (253 linhas) cobre **5 tabelas** — `organizations`,
`profiles`, `organization_members`, `establishments`, `departments` — e declara
4 RPCs: `fn_create_organization`, `fn_tenant_ids_for_user`, `fn_user_has_role`,
`fn_user_has_any_role`.

**Nenhuma dessas 4 funções é chamada pelo código atual.** O arquivo está
obsoleto: cobre 5 das **39** tabelas reais, e as 25 RPCs efetivamente usadas
ficam sem tipagem. Registrado como risco **R8**.

Com o R1 estruturalmente resolvido, a regeneração via `supabase gen types`
**está desbloqueada** e pode ser feita em PR próprio.

---

## 7. Resumo quantitativo

| Métrica | Repositório | **Banco real** |
|---|---:|---:|
| Tabelas | 11 versionadas | **39** |
| Com RLS | — | **39 (100%)** |
| Funções | 29 versionadas | **50** |
| Policies | ~20 versionadas | **78** |
| Tipos | — | **25** |
| Triggers | — | **31** |
| Constraints | — | **159** |
| Índices | — | **124** |
| Migrations | 13 versionadas | **36 aplicadas** |
| Migrations sem rollback versionado | 4 | — |
| Tabelas em `src/types/database.ts` | 5 | de 39 |

**Divergência central:** 23 migrations aplicadas no banco não têm arquivo no
repositório. É o que mantém o R1 parcialmente aberto.
