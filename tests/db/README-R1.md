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

> **ATUALIZADO EM 29/07/2026.** O R1 foi **parcialmente** resolvido.

| Bloqueio | Estado | Desbloqueio |
|---|---|---|
| **R1 — estrutural** | ✅ **RESOLVIDO** | Snapshot em [`supabase/baseline/`](../../supabase/baseline/README.md), validado por restauração descartável. As 19 tabelas e 7 funções **existem**; o banco tem 39 tabelas, 50 funções e 78 policies |
| **R1 — histórico** | ❌ **ABERTO** | 36 versões aplicadas × 13 arquivos (que cobrem 15 versões) — **21 versões sem arquivo correspondente antes da recuperação**. Nenhuma é irrecuperável: o SQL original das 36 está em `supabase_migrations.schema_migrations.statements`. Migrations **congeladas** até a reconciliação — ver [`supabase/migrations/README.md`](../../supabase/migrations/README.md) |
| **43582c3** | ❌ **ABERTO** | `requireTenant()` e `/onboarding` existem só em `feat/onboarding-tenant-guard`. A integração será por **nova branch a partir de `main`**, sem cherry-pick |

**O que mudou na prática:** os testes de RLS e ACL passam a ser executáveis,
porque agora é possível reconstruir o banco em ambiente descartável. O que
**não** mudou: nenhum desses testes foi escrito ainda, e nenhum caso abaixo
pode ser marcado como coberto antes de existir teste executado com sucesso.

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
| TG-12 | usuário com múltiplas memberships | **seleção determinística e documentada** |

> **CORREÇÃO DA PREMISSA (29/07/2026).**
>
> A versão anterior descrevia TG-12 como "`.single()` lança quando há mais de
> uma linha". **Estava errado.** O `postgrest-js` retorna erro em
> `{ data, error }` em vez de lançar (`dist/index.cjs:405-415`), o projeto não
> usa `throwOnError()`, e `.limit(1)` impede o `PGRST116` por multiplicidade.
>
> **O problema verdadeiro é a seleção não determinística — e está no SQL:**
>
> ```sql
> SELECT tenant_id FROM organization_members
> WHERE user_id = auth.uid() AND deleted_at IS NULL
> LIMIT 1;          -- ← sem ORDER BY
> ```
>
> **31 policies em 15 tabelas** dependem de `fn_resolve_tenant_id()`.
>
> **Escopo de TG-12, revisado:**
> - troca **manual** de organização permanece **fora do MVP**
>   (`org-switcher.tsx` é stub visual, com comentário explícito);
> - a seleção **automática** do tenant deve ser determinística e documentada;
> - coluna de ordenação **confirmada no schema real**:
>   `organization_members.created_at` é `NOT NULL` com default `now()`, e `id`
>   é PK — `ORDER BY created_at ASC, id ASC` dá ordem total. Semântica: *a
>   membership mais antiga vence*;
> - a correção **não entra** na integração do onboarding: será **migration
>   isolada**, com testes reais de RLS, após a reconciliação do histórico.
>
> **TG-11 permanece válido:** `src/app/(dashboard)/layout.tsx` não redireciona
> usuário sem membership — apenas exibe `"Minha Organização"` e segue
> renderizando. É defeito real, ainda presente em `main`.

---

## Como um item sai desta lista

1. O requisito externo é atendido (dump de schema, ou `43582c3` rebaseada).
2. O teste é **implementado e executado**, provando comportamento real.
3. A linha correspondente é removida deste arquivo.
4. O limiar de cobertura em `vitest.config.mts` é reavaliado com a nova medição.

Remover uma linha daqui sem um teste executando no lugar é regressão de
processo, não progresso.
