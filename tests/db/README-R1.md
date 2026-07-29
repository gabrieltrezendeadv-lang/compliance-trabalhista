# Testes pendentes — bloqueados pelo R1 e pela branch de onboarding

**Etapa:** 1 — Fundação de testes e CI
**Atualizado em:** 29/07/2026

> Este arquivo é um **contrato de testes pendentes**, não uma lista de desejos.
> Cada item descreve um teste que **deve existir**, o que ele precisa provar e
> qual requisito externo o desbloqueia.
>
> **Nenhum destes testes foi criado como `test.skip`.** A instrução da Etapa 1
> é explícita: não se cria coleção artificial de testes ignorados para
> representar funcionalidade ausente. `test.skip` só é aceitável quando o teste
> já está implementado e falta apenas infraestrutura externa identificada.
> Nenhum caso abaixo está nessa condição hoje — todos dependem de código ou de
> banco que não existem no repositório.
>
> **Testes ignorados não contam como cobertura nem como critério concluído.**

---

## Por que existem duas classes de bloqueio

| Bloqueio | Natureza | Desbloqueio |
|---|---|---|
| **R1** | O schema não está versionado: 19 tabelas e 7 funções usadas pela aplicação não têm definição no repositório | dump `pg_dump --schema-only` ou introspecção autorizada em branch descartável |
| **43582c3** | `requireTenant()` e a rota `/onboarding` existem apenas na branch `feat/onboarding-tenant-guard`, não em `main` | rebase daquela branch sobre `main` e passagem pelo novo gate `verify` |

---

## 1. Bloqueados pelo R1 — RLS

O cliente falso em `tests/fixtures/supabase-fake.ts` **não** aplica RLS, por
decisão de desenho documentada no próprio arquivo. Portanto **nada** do que a
suíte atual verifica constitui prova de isolamento no banco.

| # | Teste exigido | Deve provar |
|---|---|---|
| R1-RLS-01 | Policies de `SELECT` por tenant | Sessão do tenant A não lê linha do tenant B, mesmo sem filtro na consulta da aplicação |
| R1-RLS-02 | `USING` × `WITH CHECK` em cada policy de escrita | `INSERT`/`UPDATE` não conseguem gravar linha com `tenant_id` alheio |
| R1-RLS-03 | Policies de `complaints` por investigador | Investigador só alcança casos atribuídos a ele |
| R1-RLS-04 | Policies de `campaign_*` | Entregas e reconhecimentos isolados por tenant |
| R1-RLS-05 | `assessment_responses` desvinculado do convite | Resposta individual inalcançável, inclusive por admin |
| R1-RLS-06 | Limiar de anonimato nas agregações | Grupo abaixo do limiar não expõe contagem |
| R1-RLS-07 | Membership com soft delete | `deleted_at IS NOT NULL` perde acesso imediatamente |

## 2. Bloqueados pelo R1 — ACL, PUBLIC e SECURITY DEFINER

| # | Teste exigido | Deve provar |
|---|---|---|
| R1-ACL-01 | `proacl` de cada função exposta | `PUBLIC` não tem `EXECUTE` onde não deve |
| R1-ACL-02 | `prosecdef` e `proconfig` | Toda `SECURITY DEFINER` fixa `search_path` |
| R1-ACL-03 | Owner das funções | Nenhuma pertence a role com privilégio excessivo |
| R1-ACL-04 | Grants de tabela por role | `anon`, `authenticated`, `service_role` com o mínimo necessário |
| R1-ACL-05 | SEC-002 aplicado | `check_plan_limit` sem `EXECUTE` para qualquer role de API |
| R1-ACL-06 | Rollback exato de cada migration | Estado posterior idêntico ao anterior, ACL inclusive |

## 3. Bloqueados pelo R1 — objetos ausentes do repositório

Estas 7 funções são chamadas pelo código mas **não têm `CREATE FUNCTION`**
neste repositório. Nenhum teste de comportamento é possível: em um banco
reconstruído a partir daqui, elas simplesmente não existem.

| Função | Consumidor | Teste exigido quando existir |
|---|---|---|
| `fn_resolve_tenant_id` | `evidence/actions.ts`, `risks/actions.ts` **e 4 policies de RLS** | Resolve o tenant de `auth.uid()`; devolve vazio sem membership |
| `fn_process_webhook_event` | `api/webhooks/[provider]/route.ts` | Atomicidade de find→update→log; evento repetido não duplica efeito |
| `fn_seal_evidence_package` | `evidence/actions.ts` | Pacote selado torna-se imutável; hash preservado |
| `fn_get_evidence_report_detail` | `evidence/actions.ts` | Isolamento por tenant |
| `fn_get_evidence_package_detail` | `evidence/actions.ts` | Isolamento por tenant |
| `fn_get_risk_detail` | `risks/actions.ts` | Isolamento por tenant |
| `fn_get_risk_inventory_summary` | `risks/actions.ts` | Agregação sem vazar trabalhador |

**`fn_resolve_tenant_id` é o caso mais grave:** além da aplicação, é usada
dentro de policies criadas por
`supabase/migrations/20260728152500_priv_001_anonymous_assessments.sql`.
Aplicar essa migration em banco sem a função produz policies quebradas, com
efeito direto sobre isolamento de tenant.

## 4. Bloqueados pelo R1 — E2E autenticado

`tests/e2e/` cobre hoje apenas rotas públicas sem credenciais. Os 10 cenários
de `tests/e2e-scenarios.md` exigem banco com dados reais.

| # | Cenário | Requisito |
|---|---|---|
| R1-E2E-01 | Denúncia anônima ponta a ponta (E2E-01) | Banco + tenant semeado |
| R1-E2E-02 | Acesso à caixa segura com protocolo e PIN corretos (E2E-02) | Denúncia com PIN conhecido |
| R1-E2E-03 | Anti-enumeração ponta a ponta (E2E-03, E2E-04) | Idem |
| R1-E2E-04 | Rate limit por protocolo e por IP (E2E-05, E2E-06) | Banco + `RATE_LIMIT_HMAC_SECRET` |
| R1-E2E-05 | Mensagem do denunciante (E2E-07, E2E-08) | Denúncia aberta e uma encerrada |
| R1-E2E-06 | Jornada autenticada de dashboard | Usuário, organização e membership |
| R1-E2E-07 | Fluxo de campanha com destinatários | 19 tabelas ausentes |

> Correção pendente em `tests/e2e-scenarios.md`: o cenário E2E-01 aponta para
> `/denuncia/{tenant_slug}`; a rota real é `/report/[slug]`.

## 5. Bloqueados pela branch `feat/onboarding-tenant-guard` (43582c3)

`src/lib/tenant-guard.ts` e `src/app/onboarding/` **não existem em `main`**.
Escrever aqui um teste que os importe produziria erro de módulo inexistente;
marcá-lo como `skip` seria maquiar ausência de funcionalidade. Por isso os
casos ficam registrados como contrato.

`43582c3` deve ser o **primeiro PR de funcionalidade a atravessar o novo gate
`verify`**, e deve chegar com estes testes implementados:

### 5.1 `resolveTenantOrFail()`

| # | Entrada | Resultado esperado |
|---|---|---|
| TG-01 | sem sessão | `{ ok: false, reason: "not_authenticated" }` |
| TG-02 | autenticado, sem membership | `{ ok: false, reason: "no_tenant" }` |
| TG-03 | RPC devolve erro | `{ ok: false, reason: "db_error" }` |
| TG-04 | membership ativa | `{ ok: true, tenantId }` |
| TG-05 | membership com `deleted_at` | tratado como ausência de tenant |

### 5.2 `requireTenant()`

| # | Situação | Resultado esperado |
|---|---|---|
| TG-06 | sem sessão | `redirect("/login")` |
| TG-07 | sem tenant | `redirect("/onboarding")` |
| TG-08 | erro de banco | lança — **nunca** 500 silencioso nem redirect enganoso |
| TG-09 | tenant válido | devolve `{ tenantId }` |
| TG-10 | identidade do tenant A com identificador do tenant B | não devolve o tenant de B |

### 5.3 `fn_create_organization_with_owner` (retorno `jsonb`)

| # | Situação | Erro estruturado esperado |
|---|---|---|
| ON-01 | sem sessão | `NOT_AUTHENTICATED` |
| ON-02 | usuário já tem organização ativa | `ALREADY_HAS_ORGANIZATION` |
| ON-03 | nome com menos de 2 ou mais de 200 caracteres | `INVALID_NAME` |
| ON-04 | slug fora de `^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$` | `INVALID_SLUG` |
| ON-05 | slug já existente | `SLUG_TAKEN` |
| ON-06 | dados válidos | sucesso, com organização e membership de owner |
| ON-07 | tentativa de criar para `user_id` diferente de `auth.uid()` | impossível por construção |

> ON-01 a ON-07 dependem **também** do R1: `fn_create_organization_with_owner`
> manipula `organizations` e `organization_members`, ambas na lista de 19
> tabelas ausentes. A verificação completa exige banco.

### 5.4 Regressão do dashboard

| # | Situação | Comportamento exigido |
|---|---|---|
| TG-11 | usuário sem organização acessa `/dashboard` | redirecionado a `/onboarding` |
| TG-12 | usuário com múltiplas memberships | seleção determinística, sem exceção |

> **Defeito conhecido em `main`, a ser corrigido por `43582c3`:**
> `src/app/(dashboard)/layout.tsx` consulta memberships com `.single()`, que
> lança quando há mais de uma linha, e sem membership apenas exibe o rótulo
> `"Minha Organização"` em vez de redirecionar. TG-11 e TG-12 falham hoje.

---

## Como um item sai desta lista

1. O requisito externo é atendido (dump de schema, ou `43582c3` rebaseada).
2. O teste é **implementado e executado**, provando comportamento real.
3. A linha correspondente é removida deste arquivo.
4. O limiar de cobertura em `vitest.config.mts` é reavaliado com a nova medição.

Remover uma linha daqui sem um teste executando no lugar é regressão de
processo, não progresso.
