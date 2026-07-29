# Neo SST — Inventário de Banco de Dados (linha de base)

**Etapa:** 0 — Congelamento da linha de base
**Commit de referência:** `3f616a5` (`origin/main`)
**Data:** 29/07/2026

> **Método: derivação a partir do código-fonte e das migrations versionadas.**
> Por decisão do proprietário, este inventário **não** foi obtido por dump nem
> por introspecção do banco. Nenhum acesso a Supabase remoto, branch ou produção
> foi realizado. Toda linha marcada como *lacuna* significa "não existe no
> repositório" — **não** significa "não existe no banco".

---

## 1. Bloqueante R1 — o schema não está versionado

O repositório versiona **11 tabelas** e **29 funções**. A aplicação consulta
**27 tabelas** e chama **25 funções**. O cruzamento revela:

- **19 tabelas** consultadas pela aplicação **sem `CREATE TABLE` no repositório**;
- **7 funções** chamadas pela aplicação ou por migrations **sem `CREATE FUNCTION` no repositório**.

### Por que isto é bloqueante

O roadmap (§1, gate 4) exige que toda alteração seja validada com *"aplicação e
rollback em branch Supabase ou banco descartável"*. Um banco criado a partir
das migrations deste repositório **não conterá** as 19 tabelas nem as 7 funções
listadas adiante — a aplicação falharia imediatamente. Portanto:

- não é possível reconstruir o banco a partir do repositório;
- não é possível validar migrations em branch descartável;
- não é possível comparar estado anterior × posterior de forma confiável;
- o gate de banco/deploy fica **parcialmente inviável** para todas as etapas.

### Como resolver (fora do escopo desta etapa)

Uma das duas ações, ambas dependentes do proprietário:

1. fornecer `pg_dump --schema-only` do projeto Supabase, a partir do qual se
   gera uma migration de baseline (`00000000000000_baseline.sql`); ou
2. autorizar introspecção somente leitura em branch descartável.

Enquanto nenhuma das duas ocorrer, **R1 permanece aberto** e este inventário
continua sendo uma aproximação derivada do código.

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

### 2.2 LACUNA — usadas pela aplicação, sem definição no repositório (19)

Origem: ocorrências de `.from("...")` em `src/`, subtraídas as versionadas.
**Nenhuma destas tabelas pode ser recriada a partir deste repositório.**

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

### 3.2 LACUNA — chamadas sem definição no repositório (7)

**Estas são as chamadas que produziriam erro imediato em um banco reconstruído
a partir deste repositório.**

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

## 5. Estado de aplicação desconhecido

Não é possível determinar, a partir do repositório, quais migrations estão
aplicadas em quais ambientes. Vários arquivos declaram explicitamente que são
propostas — por exemplo, o cabeçalho de
`20260728154500_sec_002_retire_plan_limit.sql`:

```
-- PROPOSTA: não executada automaticamente.
```

Consequência: as seções acima descrevem **o que o repositório define**, não o
que o banco contém. Registrado como risco **R7** em
[`current-state.md`](./current-state.md) §11.

---

## 6. Tipagem TypeScript do banco

`src/types/database.ts` (253 linhas) cobre **5 tabelas** — `organizations`,
`profiles`, `organization_members`, `establishments`, `departments` — e declara
4 RPCs: `fn_create_organization`, `fn_tenant_ids_for_user`, `fn_user_has_role`,
`fn_user_has_any_role`.

**Nenhuma dessas 4 funções é chamada pelo código atual.** O arquivo está
obsoleto: as 22 tabelas restantes e as 25 RPCs efetivamente usadas ficam sem
tipagem, e as consultas correspondentes perdem checagem estática. Registrado
como risco **R8**. A regeneração via `supabase gen types` depende da resolução
de R1.

---

## 7. Resumo quantitativo

| Métrica | Valor |
|---|---:|
| Tabelas consultadas pela aplicação | 27 |
| Tabelas versionadas no repositório | 11 |
| **Tabelas em lacuna** | **19** |
| Funções chamadas pela aplicação | 25 |
| Funções versionadas no repositório | 29 |
| **Funções em lacuna** | **7** |
| Migrations versionadas | 13 |
| Migrations sem rollback versionado | 4 |
| Tabelas cobertas por `src/types/database.ts` | 5 |
