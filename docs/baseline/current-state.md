# Neo SST — Estado Atual (linha de base)

**Etapa:** 0 — Congelamento da linha de base
**Commit de referência:** `3f616a5` (`origin/main`)
**Branch deste documento:** `chore/baseline`
**Data do levantamento:** 29/07/2026
**Método:** inspeção somente leitura do repositório + execução dos scripts de verificação existentes

> Este documento descreve **o que existe**, não o que deveria existir. Nenhum erro
> identificado aqui foi corrigido nesta etapa, por decisão do gate da Etapa 0.
> Nenhum acesso a banco remoto, produção ou Supabase foi realizado.

---

## 1. Escopo do levantamento

Confrontamos o código com:

- `docs/planning/NEO-SST-ESCOPO-CONSOLIDADO-v2.md`
- `docs/planning/NEO-SST-ROADMAP-IMPLEMENTACAO-v1.md`

O baseline é `origin/main` (`3f616a5`). A branch `feat/onboarding-tenant-guard`
(`43582c3`) existe, está publicada e **não** está incorporada aqui — ver §7.

---

## 2. Conclusão principal

O produto foi construído **na ordem inversa do roadmap**. Existem módulos
correspondentes às Etapas 5, 6, 9 e 12 (campanhas, Resend, evidências, Asaas)
em estado funcional, enquanto as Etapas 0, 1 e 2 — baseline, fundação de
testes/CI e contratos de provedores — não existem.

O achado mais grave é estrutural e está registrado como **bloqueante R1**: o
schema do banco não está versionado no repositório. Detalhe em
[`database-inventory.md`](./database-inventory.md).

---

## 3. Inventário de rotas (App Router)

Extraído do resultado de `npm run build` neste commit.

### Públicas

| Rota | Arquivo |
|---|---|
| `/` | `src/app/page.tsx` |
| `/login` | `src/app/(auth)/login/page.tsx` |
| `/signup` | `src/app/(auth)/signup/page.tsx` |
| `/auth/callback` | `src/app/(auth)/auth/callback/route.ts` |
| `/assessment/[token]` | `src/app/(public)/assessment/[token]/page.tsx` |
| `/report/[slug]` | `src/app/(public)/report/[slug]/page.tsx` |
| `/report/track` | `src/app/(public)/report/track/page.tsx` |

### Autenticadas (`/dashboard`)

`dashboard`, `assessments`, `assessments/[cycleId]`, `billing`, `campaigns`,
`campaigns/[id]`, `campaigns/new`, `complaints`, `complaints/[id]`,
`departments`, `employees`, `establishments`, `evidence`, `evidence/[id]`,
`evidence/packages`, `evidence/packages/[id]`, `members`, `reports`, `risks`,
`risks/[riskId]`, `risks/new`, `settings`.

### API

| Rota | Arquivo | Observação |
|---|---|---|
| `POST /api/webhooks/[provider]` | `src/app/api/webhooks/[provider]/route.ts` | Resend (Svix) e WhatsApp Cloud |
| `POST /api/webhooks/billing` | `src/app/api/webhooks/billing/route.ts` | Asaas |
| `GET /api/cron/close-assessment-cycles` | `src/app/api/cron/close-assessment-cycles/route.ts` | agendado em `vercel.json` (`5 3 * * *`) |

**Não existe rota `/onboarding` neste commit.** Ver §7.

---

## 4. Estado por módulo

Legenda: **Pronto** = implementado e coerente · **Parcial** = existe mas não
atende ao escopo · **Ausente** = sem código no repositório.

| Módulo | Estado | Evidência / lacuna |
|---|---|---|
| Autenticação | Pronto | `src/app/(auth)/`, `src/lib/auth-actions.ts`, callback OAuth, `src/proxy.ts` |
| Organizações / estabelecimentos / departamentos | Pronto | `src/lib/organizations/actions.ts` + páginas |
| Membros e papéis | Pronto | `src/app/(dashboard)/dashboard/members/`, `fn_remove_member` |
| Denúncias | Pronto | `src/lib/complaints/{actions,gateway}.ts`; PIN com hash, anti-enumeração, rate limit, RLS por investigador |
| Avaliações psicossociais | Pronto | `src/lib/assessments/actions.ts`; token por hash (PRIV-001), reverse scoring (FIX-003), limiar de anonimato, lote anônimo |
| Riscos e planos de ação | Pronto | `src/lib/risks/actions.ts`; importação de ciclo, revisões de eficácia |
| Evidências | Pronto | `src/lib/evidence/actions.ts`; hash, selagem de pacote |
| Campanhas (núcleo) | Pronto | migrations `20260724150000`/`160000`, `fn_prepare_campaign_send`, deliveries, acknowledgments |
| Registry fail-closed de canais | Pronto | `src/lib/integrations/registry.ts` |
| **Onboarding / guard de tenant** | **Ausente** | não há `/onboarding` nem `src/lib/tenant-guard.ts` neste commit — ver §7 |
| Colaboradores | Parcial | só cadastro e listagem; `createEmployeeSchema` sem status nem datas de vínculo |
| Contratos de provedores | Parcial | Resend, WhatsApp Cloud, Asaas e mocks existem, mas fora da estrutura `src/lib/providers/**` da Etapa 2 e sem seletor por variável |
| Billing | Parcial | provider Asaas + mock, planos, faturas, `guard.ts`; `check_plan_limit` revogada (SEC-002), menu de assinatura removido, sem `getEntitlements/requireFeature/checkUsage` |
| Relatórios | Parcial | `src/lib/reports/actions.ts` monta estrutura canônica com SHA-256, mas **não há dependência de PDF** no `package.json`; sem manifesto nem pacote selado exportável |
| Testes / CI | Parcial | ver [§6](#6-testes) |
| Ciclo de vida e desligamento | **Ausente** | ver §5 |
| Catálogo oficial de campanhas / versionamento | Ausente | sem `campaign_versions`, `campaign_sources`, `campaign_schedules`, `campaign_template_versions` |
| WhatsApp Evolution API | Ausente | ver §8 |
| CNPJ / BrasilAPI / CNAE→grau de risco versionado | Ausente | `cnae_code` e `risk_grade` são campos manuais livres no formulário de estabelecimento |
| Arquivo documental | Ausente | sem `compliance_documents*`, sem bucket, sem código de storage |
| Outbox / dead letter / idempotency_keys / webhook_receipts / provider_connections | Ausente | nenhuma ocorrência no repositório |
| Worker e jobs | Ausente | único agendamento: `close-assessment-cycles` |
| Pacote de desligamento | Ausente | depende do ciclo de vida |
| Assinatura externa / IA | Ausente | fora do escopo inicial (escopo §15 e §14) |

---

## 5. Ciclo de vida do trabalhador — ausência verificada

Busca em `src/` e `supabase/` pelos campos exigidos pelo escopo §5.3 e pela
Etapa 4 do roadmap:

```
employment_status · notice_communicated_at · effective_termination_at
transmission_stop_at · inactive_at · retention_review_at
legal_hold · legal_hold_reason · archived_at · anonymized_at
```

**Resultado: zero ocorrências.**

Consequência direta: o critério de aceite do escopo §21 — *"empregado desligado
não recebe envio"* — é hoje **inatingível**, não apenas não testado.
`src/lib/integrations/send-campaign.ts` lê as entregas pendentes e dispara sem
reconferir elegibilidade do destinatário no momento do envio, contrariando o
escopo §5.4 e o gate da Etapa 4.

---

## 6. Testes

### Existentes

| Arquivo | Linhas | Executado por | Resultado nesta linha de base |
|---|---:|---|---|
| `tests/p0-runtime-guards.mjs` | 81 | CI + manual | **7 passed, 0 failed** |
| `tests/reconciliation-guards.mjs` | 197 | `npm run test:reconciliation` (fora do CI) | **11 passed, 0 failed** |
| `tests/fail-closed-channels.test.ts` | 761 | `npx tsx` manual | **não executado** — ver abaixo |
| `tests/gateway.test.ts` | 626 | `npx tsx` manual | **não executado** |
| `tests/call-graph.test.ts` | 488 | `npx tsx` manual | **não executado** |
| `tests/whatsapp-cloud.test.ts` | 374 | `npx tsx` manual | **não executado** |
| `tests/e2e-scenarios.md` | — | roteiro manual | — |
| `tests/bootstrap_test_db.sql`, `sec_block1_consolidation_test.sql`, `seed_old_functions.sql` | — | SQL manual | — |

### Limitações estruturais

1. **`tsx` não é dependência do projeto.** Ausente de `package.json` e de
   `package-lock.json`. Os quatro arquivos `.test.ts` — 2.249 linhas, o grosso
   do esforço de teste — não são executáveis de forma reprodutível e **não
   entram no CI**. Executá-los exigiria download implícito pelo `npx`, o que
   foi vetado nesta etapa.
2. **Os dois `.mjs` testam texto-fonte, não comportamento.** Usam
   `assert.match(source, /regex/)` sobre o código lido como string. Quebram com
   refatoração inofensiva e passam com lógica errada.
3. **O CI cobre apenas** `tsc --noEmit`, `eslint src/`, `p0-runtime-guards` e
   `next build` (`.github/workflows/ci.yml`). Sem cobertura, sem E2E, sem
   auditoria de dependências, sem verificação de migrations. O
   `test:reconciliation` do `package.json` nem sequer é chamado pelo CI.

### Lacunas de cobertura

Onboarding e guard de tenant; cross-tenant A × B em toda server action; matriz
de papéis (owner/admin/manager/collaborator/investigator/auditor); payload com
campo fora da allowlist; ID inválido; sessão ausente; RLS/ACL (`USING`,
`WITH CHECK`, `PUBLIC`, `search_path`, owner das funções); idempotência e replay
no nível da rota de webhook; colaboradores (nenhum teste); E2E automatizado.

---

## 7. Onboarding e guard de tenant — trabalho pendente fora do baseline

A branch **`feat/onboarding-tenant-guard`** (`43582c3`, publicada, 1 commit à
frente de `main`) contém o trabalho que fecha esta lacuna:

- `src/app/onboarding/page.tsx` e `onboarding-form.tsx`;
- `src/lib/tenant-guard.ts` com `resolveTenantOrFail()` / `requireTenant()`;
- migration `20260729000000_onboarding_tenant_guard.sql` + rollback, que endurece
  `fn_create_organization_with_owner` (retorno passa a `jsonb` com erros
  estruturados, valida nome/slug/CNPJ, impede duplicidade, usa `auth.uid()`
  exclusivamente) e cria `fn_check_active_tenant()`.

**Neste baseline (`main`), o comportamento é o seguinte:**
`src/app/(dashboard)/layout.tsx` autentica o usuário, mas quando não existe
membership **não redireciona** — apenas exibe o rótulo `"Minha Organização"` e
segue renderizando o dashboard. Ou seja, o usuário sem organização entra num
dashboard vazio em vez de ser direcionado ao onboarding, contrariando o escopo
§4.1 e a Etapa 3 do roadmap.

> **CORREÇÃO (29/07/2026).** Uma versão anterior deste documento afirmava que
> `.single()` **lançaria exceção** para usuário com múltiplas organizações.
> **Isso estava errado, em dois pontos:**
>
> 1. O `postgrest-js` **retorna** o erro em `{ data, error }` — não lança
>    (`dist/index.cjs:405-415`); o projeto não usa `throwOnError()`. Como o
>    código desestrutura apenas `data`, nenhuma exceção se propaga.
> 2. `.limit(1)` restringe o resultado a uma linha, de modo que o `PGRST116`
>    por multiplicidade **não pode** ocorrer.
>
> **O defeito real é outro: seleção não determinística.** Nenhuma das 11
> consultas de membership do projeto usa `ORDER BY` — e a causa raiz está no
> SQL, não no TypeScript: `fn_resolve_tenant_id()` é
> `SELECT tenant_id FROM organization_members WHERE user_id = auth.uid() AND
> deleted_at IS NULL LIMIT 1`, **sem `ORDER BY`**. Como 31 policies em 15
> tabelas comparam `tenant_id = fn_resolve_tenant_id()`, um usuário multi-org
> enxerga apenas o tenant sorteado. Registrado como TG-12.
>
> Troca manual de organização permanece **fora do MVP** — `org-switcher.tsx` é
> um stub visual, com comentário explícito nesse sentido.

Além disso, a resolução de tenant em `main` é **duplicada e inline**:
`src/lib/evidence/actions.ts:18` e `src/lib/risks/actions.ts` definem cada um
seu próprio `resolveTenantId()` chamando `fn_resolve_tenant_id`; os demais
módulos resolvem tenant por consulta direta a `organization_members` com
`.limit(1)`. Ver [`security-model.md`](./security-model.md) §3.

---

## 8. WhatsApp — decisão registrada

O escopo §8 define **Evolution API** (canal interno `evolution_test`) como o
provedor experimental da primeira versão, com a Cloud API oficial como troca
futura via adaptador.

O repositório implementa **Meta Cloud API**
(`src/lib/integrations/providers/whatsapp-cloud.ts`, 374 linhas de teste,
webhook com HMAC e `timingSafeEqual`). Não há **nenhuma** ocorrência de
"evolution" em `src/`, `supabase/` ou `tests/`.

**Decisão do proprietário, registrada em 29/07/2026:**

> **Evolution API é o provider experimental principal** e passa a ser o alvo da
> Etapa 7. `whatsapp-cloud.ts` é **preservado** e reclassificado como
> **adaptador futuro** para a migração ao provedor oficial. Nada é removido.

---

## 9. Divergências entre código e roadmap

| # | Divergência |
|---|---|
| D1 | Ordem de execução invertida: Etapas 0, 1 e 2 inexistentes; entregas parciais das Etapas 5, 6, 9 e 12 já em `main`. |
| D2 | **Schema não versionado** — 19 tabelas e 7 funções usadas sem definição no repositório. Ver `database-inventory.md`. Bloqueante **R1**. |
| D3 | `src/types/database.ts` obsoleto: 253 linhas cobrindo 5 tabelas e listando 4 RPCs (`fn_create_organization`, `fn_tenant_ids_for_user`, `fn_user_has_role`, `fn_user_has_any_role`) que o código **não chama mais**. As demais consultas ficam sem tipagem efetiva. |
| D4 | WhatsApp implementado em Cloud API, não Evolution — tratado em §8. |
| D5 | Contrato de variáveis de ambiente divergente do roadmap §5.2 — ver `architecture.md` §5. |
| D6 | Gate de campanhas do escopo §21 inatingível por ausência de ciclo de vida — ver §5. |
| D7 | ~~Estado real do banco desconhecido~~ — **RESOLVIDO** em 29/07/2026. **SEC-002 ESTÁ APLICADA** (histórico `20260728191311`; `check_plan_limit` com ACL `{postgres=X}`): o cabeçalho *"PROPOSTA: não executada automaticamente"* está desatualizado. A migration `20260729000000_onboarding_tenant_guard` **nunca foi aplicada**. |
| D8 | Convenção de branches do roadmap §4.1 não seguida: `feat/onboarding-tenant-guard` equivale ao PR#4 da tabela §8, executado antes dos PRs 1–3. |

---

## 10. Resultado das verificações nesta linha de base

Executado no commit `3f616a5`, em 29/07/2026, Node v24.13.0 / npm 11.6.2.
**Nenhuma falha foi corrigida** — este é o registro exigido pelo gate da Etapa 0.

| Verificação | Comando | Exit | Resultado |
|---|---|---:|---|
| Instalação | `npm ci` | 0 | 435 pacotes; **12 vulnerabilidades de severidade alta** reportadas pelo `npm audit` |
| Typecheck | `npx --no-install tsc --noEmit` | 0 | **Sem erros.** TypeScript 5.9.3 |
| Lint | `npm run lint` | 0 | **0 erros, 25 avisos** |
| Guards P0 | `node tests/p0-runtime-guards.mjs` | 0 | 7 passed, 0 failed |
| Guards de reconciliação | `node tests/reconciliation-guards.mjs` | 0 | 11 passed, 0 failed |
| Build | `npm run build` | 0 | **Sucesso**, sem variáveis de ambiente configuradas |

### Causas prováveis e observações

- **12 vulnerabilidades altas (`npm ci`)** — nenhuma auditoria de dependências
  existe no CI (Etapa 1 do roadmap prevê o job). Não investigadas nesta etapa;
  `npm audit fix` **não** foi executado. Causa provável: dependências
  transitivas desatualizadas. Tratar na Etapa 1 ou 15.
- **25 avisos de lint** — todos `@typescript-eslint/no-unused-vars`,
  concentrados em parâmetros de interface deliberadamente não usados nos mocks
  e adaptadores de provider (`_payload`, `_headers`, `_secret`, `_signature`) e
  em `_err` capturado sem uso em `gateway.ts:271` e `:361`. Causa provável: a
  convenção de prefixo `_` não está configurada em `argsIgnorePattern` no
  `eslint.config.mjs`. Não é defeito funcional.
- **Divergência CI × script local**: `npm run lint` executa `eslint` sem
  caminho, cobrindo também `tests/`; o CI executa `eslint src/`. Por isso os 3
  avisos em `tests/gateway.test.ts` não aparecem no CI.
- **Build sem variáveis de ambiente** — passou. Não confirma funcionamento em
  runtime: todas as rotas de dashboard são dinâmicas (`ƒ`), então a ausência de
  credenciais Supabase só se manifesta em execução, não na compilação.
- **`npx tsc` sem `--no-install`** baixou para o cache do npx um pacote
  `tsc@2.0.4` de terceiros, que **não é** o compilador TypeScript. Nada foi
  gravado no repositório e nenhum arquivo versionado mudou. O typecheck oficial
  acima usou o TypeScript 5.9.3 instalado pelo `package-lock.json`, via
  `npx --no-install`. Registrado por transparência.

---

## 11. Lista priorizada de problemas existentes

| # | Severidade | Problema | Etapa que trata |
|---|---|---|---|
| R1 | **Parcialmente resolvido** | **Estruturalmente resolvido** em 29/07/2026: snapshot em `supabase/baseline/`, validado por restauração descartável. O banco tem 39 tabelas, 50 funções e 78 policies. **Continua aberto** quanto ao histórico: 36 migrations aplicadas × 13 versionadas — 23 nunca versionadas | reconciliação pendente |
| R2 | **Bloqueante** | Sem runner de testes e sem gate `verify` no CI, a regra *"PR não mergeia se `verify` falhar"* não é aplicável | 1 |
| R3 | Alto | 7 funções chamadas sem definição no repo → erro garantido em qualquer ambiente criado a partir das migrations versionadas | 0 / 1 |
| R4 | Alto | Resolução de tenant inconsistente e sem redirecionamento de usuário sem organização (§7) | 3 (branch pendente) |
| R5 | Alto | Ausência de ciclo de vida do trabalhador torna o aceite "desligado não recebe envio" inatingível (§5) | 4 |
| R6 | Médio | Divergência do contrato de variáveis de ambiente força retrabalho nos adaptadores já escritos | 2 |
| R7 | Médio | Estado real do banco e dos ambientes desconhecido a partir do repo (D7) | requer autorização |
| R8 | Médio | `src/types/database.ts` obsoleto → maioria das queries Supabase sem checagem de tipo | 1 |
| R9 | Médio | 12 vulnerabilidades altas em dependências, sem auditoria no CI | 1 / 15 |
| R10 | Baixo | `onboarding-tenant-guard.patch` na raiz — artefato residual, conteúdo já contido em `43582c3`. **Mantido por decisão do proprietário**, fora do controle de versão | — |
| R11 | Baixo | 4 branches remotas obsoletas: `agent/fix-p0-runtime-guards` (já mergeada via PR#2), `agent/reconciliacao-supabase-fixes`, `sec-block1-v1.2.2`, `security/block1-deploy`. **Não removidas** por instrução do proprietário | — |

---

## 12. Próxima etapa recomendada

**Etapa 1 — Fundação de testes e CI**, em PR separado: Vitest + Testing Library
+ Playwright, fixtures multi-tenant (tenant A/B e os seis papéis), scripts
`test` / `typecheck` / `verify`, conversão dos quatro `.test.ts` para o runner e
CI com gate `verify`. É onde **R2**, **R3**, **R4** e **R8** passam a ser
cobertos por regressão automática.

**R1 permanece aberto** e não é resolvível por este documento: exige que o
proprietário forneça um dump de schema (`pg_dump --schema-only`) ou autorize
introspecção somente leitura em branch descartável.
