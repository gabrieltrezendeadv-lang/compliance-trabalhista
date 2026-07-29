# Neo SST — Modelo de Segurança (linha de base)

**Etapa:** 0 — Congelamento da linha de base
**Commit de referência:** `3f616a5` (`origin/main`)
**Data:** 29/07/2026

> Descreve os controles **como estão implementados**, incluindo pendências.
> Nenhuma correção foi feita nesta etapa. Nenhum segredo é reproduzido aqui —
> apenas **nomes** de variáveis. Nenhum acesso a banco remoto ou produção.

---

## 1. Camadas de controle

| Camada | Mecanismo | Estado |
|---|---|---|
| Sessão | `updateSession` no proxy (`src/proxy.ts`) | ativo |
| Autenticação | `supabase.auth.getUser()` nas actions e layouts | ativo, cobertura irregular (§3) |
| Autorização de aplicação | consulta a `organization_members` por papel | ativo, **sem helper único** (§3) |
| Autorização de banco | RLS + funções `SECURITY DEFINER` com `search_path` fixo | ativo nos módulos versionados |
| ACL | `GRANT`/`REVOKE` explícitos, incluindo `PUBLIC` | ativo nas migrations SEC |
| Fronteira de `service_role` | apenas gateway e cron (§4) | ativo, verificado por guard |
| Fail-closed de canais | `ChannelNotConfiguredError` (§5) | ativo, com testes |
| Cabeçalhos HTTP | `next.config.ts` + `vercel.json` | ativo |

---

## 2. Papéis

O escopo §4.2 prevê seis papéis: `owner`, `admin`, `manager`, `collaborator`,
`investigator`, `auditor`.

O código verifica papéis de forma pontual e inline, por exemplo em
`src/lib/employees/actions.ts`:

```ts
.from("organization_members")
.select("tenant_id, role")
.eq("user_id", user.id)
.in("role", ["owner", "admin"])
.is("deleted_at", null)
.limit(1).maybeSingle()
```

**Não existe** helper `requireRole()` nem matriz de papéis centralizada. A
verificação é repetida em cada action, com listas de papéis escritas à mão — o
que torna a matriz do escopo impossível de auditar num só lugar e fácil de
divergir entre módulos. Previsto para a Etapa 3 do roadmap.

Remoções de membro usam soft delete (`deleted_at`), conforme o escopo.

---

## 3. Resolução de tenant — ponto mais frágil deste baseline

### 3.1 Três padrões coexistindo

| Padrão | Onde | Problema |
|---|---|---|
| `resolveTenantId()` local chamando `fn_resolve_tenant_id` | `src/lib/evidence/actions.ts:18`, `src/lib/risks/actions.ts` | **duplicado** em dois arquivos; lança `Error` genérico |
| Consulta direta a `organization_members` com `.limit(1)` | employees, campaigns, complaints, assessments, reports, billing | escolhe um tenant **arbitrário** para usuário com mais de uma organização |
| Consulta com `.single()` | `src/app/(dashboard)/layout.tsx:30-35` | **lança exceção** para usuário com múltiplas memberships |

### 3.2 Usuário sem organização não é redirecionado

Em `src/app/(dashboard)/layout.tsx`, quando não há membership o código **não
redireciona** — apenas aplica um rótulo padrão e continua renderizando:

```ts
const orgName = (membership?.organizations as ...)?.name ?? "Minha Organização";
```

O usuário recém-cadastrado entra num dashboard vazio em vez de ser levado a um
fluxo de onboarding. Não existe rota `/onboarding` neste commit. Isso contraria
o escopo §4.1 (*"usuário sem tenant direcionado para `/onboarding`"*) e o gate
da Etapa 3 (*"todas as rotas autenticadas devem tratar tenant nulo sem erro
500"*).

### 3.3 Trabalho pendente que corrige isto

A branch `feat/onboarding-tenant-guard` (`43582c3`, publicada, **não** incluída
neste baseline) entrega `src/lib/tenant-guard.ts` com união discriminada
(`not_authenticated` → `/login`, `no_tenant` → `/onboarding`, `db_error` →
erro tratado), a rota `/onboarding` e a migration `20260729000000`, que endurece
`fn_create_organization_with_owner` (retorno `jsonb` com erros estruturados,
validação de nome/slug/CNPJ, prevenção de duplicidade, `auth.uid()` exclusivo) e
cria `fn_check_active_tenant()`.

Mesmo com ela, a adoção seria **parcial**: o guard é consumido por 2 dos ~10
módulos. Registrado como risco **R4**.

---

## 4. Fronteira do `service_role`

A chave `SUPABASE_SERVICE_ROLE_KEY` é usada em exatamente **dois** lugares:

| Consumidor | Justificativa |
|---|---|
| `src/lib/complaints/gateway.ts` | denunciante anônimo não tem sessão Supabase |
| `src/app/api/cron/close-assessment-cycles/route.ts` | rotina sem usuário, protegida por `CRON_SECRET` |

A rota `/api/webhooks/[provider]` cria seu próprio cliente service-role inline,
com as credenciais lidas do ambiente e erro explícito quando ausentes.

Invariantes verificadas automaticamente por `tests/call-graph.test.ts`:

- nenhum módulo `"use client"` importa `service.ts`;
- `service.ts` é importado somente por `gateway.ts` (no escopo de denúncias);
- `actions.ts` consome o gateway, sem contorná-lo;
- `submitComplaint` permanece no fluxo público, sem gateway.

**Ressalva:** esse guard **não roda no CI** e exige `tsx`, que não é dependência
do projeto (§8).

---

## 5. Canais fail-closed

`src/lib/integrations/registry.ts` implementa o comportamento exigido pelo
roadmap §5.2:

- em produção, mock **nunca** é selecionável — `isMockAllowed()` retorna `false`
  quando `NODE_ENV === "production"`, mesmo com `ALLOW_MOCK_PROVIDERS=true`;
- `getMockProvider()` lança em produção, ainda que chamado diretamente;
- credencial ausente **não** ativa fallback silencioso: lança
  `ChannelNotConfiguredError`;
- configuração de provedor desconhecida também lança, sem cair em mock;
- `getActiveProviderName()` retorna `"not-configured"` em vez de expor nomes de
  mock na interface;
- `areChannelsReady()` exige **todos** os canais quando a campanha usa `"both"`.

`src/lib/billing/registry.ts` replica o padrão com
`ALLOW_MOCK_BILLING_PROVIDER` e `BillingNotConfiguredError`.

Cobertura: `tests/fail-closed-channels.test.ts` (761 linhas) e o guard P0-04,
este último **sim** executado pelo CI.

---

## 6. Canal de denúncias

Controles implementados (escopo §11):

- acesso público por slug, sem exigir conta;
- PIN armazenado com hash lento e salt individual — o gateway envia o PIN bruto
  validado para o hasher **no banco**, nunca hasheia no cliente (guard P0-02);
- **resposta anti-enumeração**: protocolo inexistente e PIN incorreto produzem
  mensagem idêntica (testado em `gateway.test.ts`);
- rate limiting por hash de IP — HMAC-SHA256 determinístico, cadeia
  `x-forwarded-for` (primeiro IP), fallback `x-real-ip`, `null` quando ausente;
- correlation ID em respostas de erro, sem vazar detalhe interno;
- caixa segura denunciante ↔ investigador, com RLS por atribuição;
- trilha de auditoria imutável (`fn_audit_log_immutable`);
- sem anexos no canal público, conforme escopo.

---

## 7. Privacidade nas avaliações

Implementado pela migration `20260728152500_priv_001_anonymous_assessments.sql`:

- token de convite armazenado **apenas como hash**, com migração do legado;
- resposta **desvinculada** do convite após submissão, via lote anônimo;
- supressão de contagens e taxas em grupos abaixo do limiar de anonimato;
- exibição de resposta individual bloqueada.

Verificado pelos guards de reconciliação (PRIV-001, FIX-003, FIX-004).

**Ressalva importante:** quatro policies dessa migration usam
`public.fn_resolve_tenant_id()`, função que **não existe no repositório**
(lacuna nº 1 do inventário). Aplicar a migration em um banco sem essa função
resulta em policies quebradas, com efeito direto sobre isolamento de tenant.
É a lacuna de maior risco do bloqueante **R1**.

---

## 8. Cobertura de teste de segurança

### O que é verificado automaticamente no CI

Apenas `tests/p0-runtime-guards.mjs` (7 checagens): delegação ao gateway, PIN
bruto ao hasher do banco, webhooks fora do redirect de sessão, billing sem
fallback de mock em produção, checkout tratando provedor ausente antes de expor
PII, webhook de billing exigindo provedor e token, mock de billing sem registrar
PII.

### O que existe mas não roda no CI

`fail-closed-channels.test.ts`, `gateway.test.ts`, `call-graph.test.ts`,
`whatsapp-cloud.test.ts` — 2.249 linhas exigindo `tsx`, que não é dependência do
projeto.

### O que não existe

Cross-tenant A × B em server actions; matriz completa dos seis papéis; payload
com campo fora da allowlist; ID inválido; sessão ausente; auditoria de RLS
(`USING` × `WITH CHECK`); ACL por função (`proacl`, `PUBLIC`, `prosecdef`,
`proconfig`, owner); idempotência e replay no nível da rota de webhook;
qualquer teste de onboarding ou de resolução de tenant.

---

## 9. Segredos

Nenhum segredo está versionado. `.gitignore` cobre `node_modules/`, `.next/` e
`*.tsbuildinfo`; `.env.local` não é versionado. `.env.example` contém apenas
placeholders.

Variáveis por natureza (**nomes apenas**):

| Escopo | Variáveis |
|---|---|
| Público (browser) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` |
| Server-only | `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `RESEND_FROM_ADDRESS`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_SANDBOX`, `CRON_SECRET` |
| Opt-in dev/teste | `ALLOW_MOCK_PROVIDERS`, `ALLOW_MOCK_BILLING_PROVIDER`, `ALLOW_INSECURE_BILLING_WEBHOOKS` |

**Pendências:** não há validação das variáveis por schema no backend; não existe
`.env.test`; `ALLOW_INSECURE_BILLING_WEBHOOKS` é um interruptor perigoso cuja
neutralização em produção **não** é coberta por nenhum teste versionado.

---

## 10. Risco aceito — default privileges

Conforme escopo §19, permanece registrado o risco relativo aos *default
privileges*. O tratamento é **manual e deliberado**:

- `supabase/manual/sec_005_default_function_privileges_dashboard.sql` (+ rollback);
- `supabase/scripts/sec001_alter_default_privileges_dashboard.sql`.

O guard de reconciliação verifica que SEC-005 permanece etapa manual e **não**
bloqueia migrations automáticas. Compensação exigida pelo escopo: **revisão
explícita dos grants de toda nova função**, sem exceção.

---

## 11. Pendências de segurança priorizadas

| # | Severidade | Pendência |
|---|---|---|
| S1 | **Alta** | Policies de PRIV-001 dependem de `fn_resolve_tenant_id`, não versionada (§7) |
| S2 | **Alta** | Usuário sem organização não é redirecionado; resolução de tenant em três padrões distintos (§3) |
| S3 | **Alta** | Nenhum teste cross-tenant A × B; matriz de papéis não auditável (§8) |
| S4 | Média | Guards de segurança mais extensos não rodam no CI por falta de `tsx` (§8) |
| S5 | Média | Garantias de idempotência do webhook dependem de `fn_process_webhook_event`, não versionada |
| S6 | Média | 12 vulnerabilidades de severidade alta reportadas por `npm ci`; sem auditoria de dependências no CI |
| S7 | Média | Variáveis de ambiente sem validação por schema; `ALLOW_INSECURE_BILLING_WEBHOOKS` sem teste de neutralização em produção |
| S8 | Baixa | Ausência de `requireRole()` centralizado; listas de papéis repetidas por action |

---

## 12. Antes de qualquer alteração futura

Regras do roadmap §3 que permanecem válidas e **não** foram exercidas nesta etapa:

- nenhuma migration aplicada diretamente em produção sem confirmação explícita;
- produção nunca usada para desenvolver;
- dados reais nunca alterados para criar fixture;
- migrations e arquivos anteriores nunca removidos para "limpar" o projeto;
- `service_role` nunca no frontend;
- erro de segurança nunca silenciado para fazer teste passar;
- nada marcado como entregue sem evidência dos testes.
