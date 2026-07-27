# SEC-BLOCK1-CONSOLIDATION v1.2.2

**Data:** 2026-07-27
**Escopo:** Bloco 1 — Canal de Denúncias (Security Consolidation)
**Estratégia:** Expand–Migrate–Contract (zero downtime)
**Projeto Supabase:** `tvwgzpgyfdfrbdaeoqzl`

---

## Resumo Executivo

O pacote v1.2.2 corrige todos os defeitos identificados na revisão do v1.2.1, incluindo bugs encontrados durante os testes locais em PostgreSQL. A migration única foi dividida em duas fases (EXPAND + CONTRACT) com rollbacks individuais e safety checks com `RAISE EXCEPTION`.

### Mudanças vs v1.2.1

1. **CONTRACT: `REVOKE ALL` → `REVOKE EXECUTE`** — Evita revogar permissões não relacionadas (USAGE, REFERENCES, etc.)
2. **CONTRACT: `RAISE WARNING` → `RAISE EXCEPTION`** — Safety check 2 agora aborta a transação em vez de apenas emitir aviso
3. **CONTRACT: Safety check 1 usa `pg_get_function_identity_arguments` + `array_length`** — Match exato de assinatura, não apenas nome
4. **CONTRACT: Safety check 2 usa variáveis separadas** — `v_dep_callers` (pg_depend) e `v_text_callers` (regex) consolidados via `concat_ws`, sem sobrescrita
5. **CONTRACT: Safety check 2b adiciona `p.prokind = 'f'`** — Exclui aggregate functions do scan de `pg_get_functiondef` (bug encontrado em testes locais PG 16)
6. **EXPAND rollback: `fn_submit_complaint` com PIN min 4 + enum casts** — Restaura corpo HOTFIX-1 correto
7. **CONTRACT rollback: `fn_send_reporter_message` com `'resolved','dismissed'`** — Restaura corpo HOTFIX-2 correto (não `'closed','archived'`)
8. **Default privileges script: assinaturas antigas corrigidas** — `fn_access_complaint(text,text)`, `fn_send_reporter_message(text,text,text)`, `fn_check_pin_rate_limit(text,integer,integer)`
9. **Arquivos históricos: cabeçalho "HISTÓRICO — NÃO APLICAR"** — Evita execução acidental da migration monolítica

---

## Estrutura do Pacote

```
SEC-BLOCK1-CONSOLIDATION-v1.2.2/
├── supabase/
│   ├── migrations/
│   │   ├── 20260727100000_sec_block1_expand.sql      ← FASE 1: EXPAND
│   │   └── 20260727200000_sec_block1_contract.sql     ← FASE 2: CONTRACT
│   ├── rollbacks/
│   │   ├── 20260727100000_sec_block1_expand_rollback.sql
│   │   └── 20260727200000_sec_block1_contract_rollback.sql
│   └── scripts/
│       └── sec001_alter_default_privileges_dashboard.sql
├── src/
│   └── lib/
│       ├── complaints/
│       │   ├── gateway.ts         ← Gateway com HMAC, _v2 RPCs
│       │   └── actions.ts         ← Server actions ("use server")
│       ├── schemas/
│       │   └── complaint.ts       ← Zod schemas (.strict(), .max())
│       └── supabase/
│           ├── service.ts         ← createServiceClient factory
│           └── server.ts          ← Stub para type-checking
├── src/components/complaints/
│   └── complaint-form.tsx         ← Formulário de denúncia
├── src/lib/campaigns/
│   └── actions.ts                 ← Server actions de campanhas
├── src/lib/integrations/
│   └── providers/whatsapp-cloud.ts ← Provider WhatsApp Cloud
├── src/app/api/webhooks/
│   └── [provider]/route.ts        ← Webhook route
├── docs/security/archive/
│   ├── 20260726200000_sec_block1_consolidation.sql        ← HISTÓRICO
│   └── 20260726200000_sec_block1_consolidation_rollback.sql ← HISTÓRICO
├── tests/
│   ├── bootstrap_test_db.sql      ← Bootstrap para testes locais
│   ├── seed_old_functions.sql     ← Funções pré-EXPAND (para testes)
│   ├── sec_block1_consolidation_test.sql  ← 43 testes funcionais SQL
│   ├── gateway.test.ts            ← 50 testes do gateway
│   ├── call-graph.test.ts         ← 25 testes de call graph
│   ├── whatsapp-cloud.test.ts     ← 25 testes WhatsApp
│   └── e2e-scenarios.md           ← 10 cenários E2E
└── SEC-BLOCK1-CONSOLIDATION.md    ← Este relatório
```

---

## Plano de Deploy (Expand–Migrate–Contract)

### Passo 1 — EXPAND (zero downtime)

```sql
-- Aplicar via Supabase SQL Editor ou supabase db push
-- Arquivo: supabase/migrations/20260727100000_sec_block1_expand.sql
```

**O que faz:**
- Cria funções `_v2` com novas assinaturas (3 funções)
- Cria `fn_record_pin_failure` (nova, sem predecessora)
- Atualiza funções existentes via `CREATE OR REPLACE` (mesma assinatura)
- Funções antigas permanecem intactas — zero breaking changes

**Funções _v2 criadas:**

| Função | Assinatura | ACL |
|--------|-----------|-----|
| `fn_check_pin_rate_limit_v2` | `(text, text, int, int, int)` | service_role |
| `fn_access_complaint_v2` | `(text, text, text)` | service_role |
| `fn_send_reporter_message_v2` | `(text, text, text, text)` | service_role |
| `fn_record_pin_failure` | `(text, text)` | service_role |

**Funções atualizadas (mesma assinatura):**

| Função | Mudança |
|--------|---------|
| `fn_submit_complaint` | PIN min 6, validação numérica, enum casts |
| `check_plan_limit(text)` | Multi-org check, delega para overload |
| `check_plan_limit(uuid, text)` | Nova overload para multi-org |
| `fn_remove_member` | Advisory lock, tenant derivado do alvo |
| `fn_get_complaint_list` | Subquery pagination, multi-org |
| `fn_prepare_campaign_send` | both OR, jsonb_typeof, dedup, deliveries |

**Rollback do EXPAND:** `supabase/rollbacks/20260727100000_sec_block1_expand_rollback.sql`

### Passo 2 — MIGRATE (deploy da aplicação)

1. Deploy do gateway TS (`gateway.ts`, `actions.ts`) via Vercel
2. O gateway já chama funções `_v2` — transição transparente
3. Verificar em staging/preview que tudo funciona com `_v2`

### Passo 3 — CONTRACT (após validação completa)

```sql
-- SOMENTE após confirmar que NENHUM caller usa as assinaturas antigas
-- Arquivo: supabase/migrations/20260727200000_sec_block1_contract.sql
```

**O que faz:**
- Safety check 1: confirma que `_v2` existem (EXPAND aplicado)
- Safety check 2a: localiza funções antigas por OID + assinatura exata
- Safety check 2b: verifica pg_depend + busca textual em `pg_get_functiondef`
- `REVOKE EXECUTE` + `DROP FUNCTION` das 3 funções antigas
- Verificação pós-DROP: confirma remoção e preservação das `_v2`

**Safety checks usam `RAISE EXCEPTION`** — qualquer falha aborta a transação inteira, nada é removido parcialmente.

**Rollback do CONTRACT:** `supabase/rollbacks/20260727200000_sec_block1_contract_rollback.sql`

---

## Resultados dos Testes

### Testes SQL Funcionais (43 PASS / 0 FAIL)

Executados contra PostgreSQL 16.13 local com bootstrap + seed + EXPAND:

| Grupo | Testes | Resultado |
|-------|--------|-----------|
| fn_submit_complaint | T01–T04 | 4/4 PASS |
| fn_access_complaint_v2 | T05–T07 | 3/3 PASS |
| fn_record_pin_failure | T08 | 1/1 PASS |
| fn_check_pin_rate_limit_v2 | T09–T10 | 2/2 PASS |
| fn_send_reporter_message_v2 | T11, T41 | 2/2 PASS |
| check_plan_limit | T12–T14, T37–T38, T42 | 6/6 PASS |
| fn_remove_member | T15–T19 | 5/5 PASS (T15 = 2 assertions) |
| fn_get_complaint_list | T20–T23 | 4/4 PASS |
| fn_prepare_campaign_send | T24–T29, T34, T39 | 8/8 PASS |
| ACL/Segurança | T30–T32, T35–T36 | 5/5 PASS |
| Rate limit dual | T33, T40 | 2/2 PASS |

### Testes TypeScript (100 PASS / 0 FAIL)

| Suite | Testes | Resultado |
|-------|--------|-----------|
| gateway.test.ts | 50 | 50/50 PASS |
| call-graph.test.ts | 25 | 25/25 PASS |
| whatsapp-cloud.test.ts | 25 | 25/25 PASS |

### Ciclos de Migration/Rollback (5/5 PASS)

| Ciclo | Descrição | Resultado |
|-------|-----------|-----------|
| A | EXPAND → EXPAND rollback → estado pré-EXPAND restaurado | PASS |
| B | EXPAND → CONTRACT → CONTRACT rollback → coexistência restaurada | PASS |
| Neg-1 | CONTRACT sem EXPAND → RAISE EXCEPTION | PASS |
| Neg-2 | CONTRACT com funções antigas já removidas → RAISE EXCEPTION | PASS |
| Neg-3 | CONTRACT com caller dependente → RAISE EXCEPTION com nome do caller | PASS |

### Type Check (0 erros no Bloco 1)

```
npx tsc --noEmit
```

Todos os erros reportados são pré-existentes e de fora do escopo do Bloco 1 (componentes UI, schemas de campanha, registry de integrações).

---

## Convenções de Segurança Aplicadas

1. **SECURITY DEFINER + `SET search_path = ''`** — Todas as funções
2. **`REVOKE EXECUTE ... FROM PUBLIC`** — Nunca `REVOKE ALL`
3. **ACL service_role only** — Para funções _v2 chamadas via gateway confiável
4. **Anti-enumeração** — Dummy bcrypt + erro uniforme `invalid_credentials`
5. **Rate limit dual** — Por protocolo (5/15min) + por IP hash HMAC (20/15min)
6. **HMAC-SHA256** — IP pseudonimizado com secret do servidor
7. **Bcrypt rehash** — Legacy SHA-256 → bcrypt transparente
8. **Advisory locks** — `pg_advisory_xact_lock` para concorrência
9. **Zod .strict()** — Rejeita campos extras no gateway
10. **Correlation ID** — Tracking de erros sem PII

---

## Restrições de Escopo

Este pacote abrange exclusivamente o **Bloco 1 — Canal de Denúncias**. Não inclui: assinatura eletrônica, exportação por API, precificação, anexos públicos, documentos pessoais de trabalhadores, serviços profissionais de SST, ou alteração de funcionalidades fora do Bloco 1.

---

## Ações Pendentes (para Gabriel)

1. **Revisar** este pacote e aprovar para deploy
2. **Aplicar EXPAND** em staging/preview via SQL Editor
3. **Deploy** do código TS via Vercel (push ou PR)
4. **Validar** em staging que as funções _v2 funcionam
5. **Aplicar CONTRACT** quando todos os callers estiverem migrados
6. **Executar** o script de default privileges se necessário
