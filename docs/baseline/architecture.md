# Neo SST — Arquitetura (linha de base)

**Etapa:** 0 — Congelamento da linha de base
**Commit de referência:** `3f616a5` (`origin/main`)
**Data:** 29/07/2026

> Descreve a arquitetura **como ela está**, incluindo onde diverge do roadmap.
> Nenhuma alteração de código foi feita nesta etapa.

---

## 1. Stack

| Camada | Tecnologia | Versão |
|---|---|---|
| Framework | Next.js (App Router) | 16.2.11 |
| UI | React | 19.2.4 |
| Linguagem | TypeScript | 5.9.3 |
| Estilo | Tailwind CSS | 4 |
| Componentes | Radix UI + shadcn (`components.json`) | — |
| Formulários | React Hook Form + `@hookform/resolvers` | — |
| Validação | Zod | 4.4.3 |
| Banco / Auth | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) | — |
| Webhooks | Svix (verificação Resend) | — |
| Deploy | Vercel (região `gru1`) | — |

> **Atenção para agentes:** conforme `AGENTS.md`, esta versão do Next.js tem
> mudanças de ruptura em relação ao conhecimento pré-treinado. Consulte
> `node_modules/next/dist/docs/` **antes** de escrever código.

Ausências relevantes: **nenhuma biblioteca de PDF**, nenhum runner de testes
(Vitest/Playwright), nenhum `tsx`.

---

## 2. Camadas

```
Browser
  │
  ├─ proxy (src/proxy.ts) ──► updateSession (src/lib/supabase/proxy.ts)
  │     renova a sessão Supabase em toda requisição casada pelo matcher
  │
  ├─ Server Component / Page
  │     └─► Server Action ("use server", src/lib/<módulo>/actions.ts)
  │           ├─► Zod schema (src/lib/schemas/*.ts)   validação de entrada
  │           ├─► Supabase server client (anon + RLS) consulta comum
  │           ├─► RPC SECURITY DEFINER                operação autorizada
  │           └─► Gateway (src/lib/complaints/gateway.ts)
  │                 └─► Service client (service_role) apenas fluxo de denúncias
  │
  └─ Route Handler (src/app/api/**)
        ├─ /api/webhooks/[provider]  → verifica assinatura → fn_process_webhook_event
        ├─ /api/webhooks/billing     → verifica token      → billing_events
        └─ /api/cron/close-...       → CRON_SECRET         → service client
```

### Convenção `"use server"`

Toda a lógica de dados vive em Server Actions sob `src/lib/<módulo>/actions.ts`.
Componentes cliente recebem apenas dados serializados e chamam actions. Nenhum
componente `"use client"` importa `src/lib/supabase/service.ts` — verificado
pelo guard `tests/call-graph.test.ts`.

### Clientes Supabase

| Arquivo | Chave | Uso |
|---|---|---|
| `src/lib/supabase/client.ts` | anon | browser |
| `src/lib/supabase/server.ts` | anon | Server Components e Actions (respeita RLS) |
| `src/lib/supabase/proxy.ts` | anon | renovação de sessão no proxy |
| `src/lib/supabase/service.ts` | **service_role** | **apenas** `gateway.ts` e a rota de cron |

A fronteira do `service_role` é o ponto mais sensível da arquitetura e está
detalhada em [`security-model.md`](./security-model.md) §4.

---

## 3. Módulos de domínio

Cada módulo segue o mesmo formato: `src/lib/<módulo>/actions.ts` +
`src/lib/schemas/<módulo>.ts` + páginas em `src/app/(dashboard)/dashboard/<módulo>/`.

`assessments` · `campaigns` · `complaints` (+ `gateway.ts`) · `employees` ·
`evidence` · `organizations` · `reports` · `risks` · `billing` (+ `guard.ts`,
`registry.ts`, `providers/`) · `integrations` (+ `registry.ts`,
`send-campaign.ts`, `providers/`) · `dashboard`.

---

## 4. Camada de provedores — divergência da Etapa 2

### Como está

```
src/lib/integrations/
  types.ts                    contrato MessageProvider
  registry.ts                 resolução por canal, fail-closed
  send-campaign.ts            orquestrador de envio
  providers/{mock-email,mock-whatsapp,resend,whatsapp-cloud}.ts

src/lib/billing/
  types.ts  registry.ts  guard.ts
  providers/{asaas,mock-billing}.ts
```

### Como o roadmap (§5.1) exige

```
src/lib/providers/{email,whatsapp,billing,signatures,registry}/
  cada um com: contrato · provider disabled · provider mock · factory
               schemas · normalizador de eventos · testes de contrato
```

**Divergências concretas:**

1. Estrutura de diretórios diferente; billing e mensageria têm registries
   paralelos que repetem a mesma lógica em vez de compartilhá-la.
2. **Não existe estado `disabled` explícito.** O roadmap prevê três estados
   (`disabled` / `mock` / real); o código tem dois e lança exceção no terceiro
   caso. Funcionalmente é fail-closed, mas não expressa "desativado" como
   configuração válida.
3. **Faltam os contratos** `DocumentSignerProvider` e
   `OrganizationRegistryProvider` (assinatura e consulta de CNPJ).
4. Não há **normalizador de eventos** compartilhado nem **testes de contrato**
   comuns a todos os providers.
5. Não existe infraestrutura de eventos: `provider_connections`,
   `provider_events`, `outbox_jobs`, `dead_letter_jobs`, `webhook_receipts`,
   `idempotency_keys` — nenhuma existe.

### Consequência sobre envio

`send-campaign.ts` envia **de forma síncrona**, direto da server action, sem
outbox e sem worker. Não há reivindicação atômica de job
(`FOR UPDATE SKIP LOCKED`), retentativa controlada nem dead letter. A
idempotência existe apenas como coluna `idempotency_key` em
`campaign_deliveries`. Isso contraria a Etapa 2 (*"envios entram em outbox"*) e
a Etapa 13.

---

## 5. Configuração por ambiente — divergência do roadmap §5.2

### Como está

A seleção é feita **por presença de credencial**, não por seletor explícito:

```ts
// src/lib/integrations/registry.ts
if (process.env.RESEND_API_KEY) return new ResendProvider(...)
if (waToken && waPhoneId)       return new WhatsAppCloudProvider(...)
if (isMockAllowed())            return getMockProvider(channel)   // dev + opt-in
throw new ChannelNotConfiguredError(channel)                      // fail closed
```

### Como o roadmap exige

```
EMAIL_PROVIDER=disabled|mock|resend
WHATSAPP_PROVIDER=disabled|mock|evolution|meta_cloud
BILLING_PROVIDER=disabled|mock|asaas
SIGNER_PROVIDER=disabled|manual|external
CNPJ_PROVIDER=manual|brasilapi
```

com rejeição de provedor desconhecido e validação das variáveis por schema.

### Divergências de nomenclatura

| Roadmap | `.env.example` atual |
|---|---|
| `RESEND_FROM_EMAIL` | `RESEND_FROM_ADDRESS` |
| `RESEND_REPLY_TO` | ausente |
| `ASAAS_ENVIRONMENT=sandbox\|production` | `ASAAS_SANDBOX=true` |
| `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET` | ausentes |
| `.env.test` | ausente |

Não há validação das variáveis por schema no backend. A divergência é o risco
**R6**: os adaptadores Resend e Asaas já escritos precisarão de retrabalho na
Etapa 2.

---

## 6. WhatsApp — provider principal e adaptador futuro

**Decisão do proprietário, 29/07/2026:**

| Provider | Papel | Estado |
|---|---|---|
| **Evolution API** (`evolution_test`) | **provider experimental principal** — alvo da Etapa 7 | **não implementado** (zero ocorrências no repositório) |
| **Meta Cloud API** (`whatsapp-cloud.ts`) | **adaptador futuro**, para a migração ao provedor oficial | implementado, com 374 linhas de teste e webhook HMAC |

`whatsapp-cloud.ts` é **preservado**, não removido. A arquitetura de adaptador
já existente (`MessageProvider` em `src/lib/integrations/types.ts`) é o ponto de
extensão correto para acomodar `EvolutionWhatsAppProvider` ao lado dele.

Requisitos da Evolution ainda inexistentes: conexão por organização (uma
instância/número por empresa), estados de sessão, QR Code, caixa interna de
respostas, opt-in/opt-out, kill switch, bloqueio por desligamento.

---

## 7. Webhooks

| Rota | Verificação | Processamento |
|---|---|---|
| `/api/webhooks/resend` | HMAC-SHA256 via Svix | `fn_process_webhook_event` |
| `/api/webhooks/whatsapp` | HMAC-SHA256 + `crypto.timingSafeEqual` | `fn_process_webhook_event` |
| `GET /api/webhooks/whatsapp` | `hub.challenge` | verificação de assinatura do canal |
| `/api/webhooks/billing` | token do provedor | `billing_events` |

Propriedades declaradas no cabeçalho de `src/app/api/webhooks/[provider]/route.ts`:
fail-closed em produção, corpo bruto validado antes do parse, nenhum payload
bruto persistido (só metadados sanitizados), RPC transacional e idempotente por
`event_id`.

**Ressalva:** `fn_process_webhook_event` **não existe no repositório** (lacuna
nº 7 do inventário). As garantias de atomicidade e idempotência dependem
integralmente de código não versionado e **não foram verificadas** nesta etapa.

---

## 8. Jobs e automações

Existe **um único** agendamento, em `vercel.json`:

```json
{ "path": "/api/cron/close-assessment-cycles", "schedule": "5 3 * * *" }
```

Protegido por `CRON_SECRET` e usando service client. Ausentes, frente à Etapa 13:
inativação de trabalhadores, cancelamento de transmissões, alertas de retenção,
alertas de vencimento documental, marcação de planos de ação vencidos, preparo e
envio de campanhas em lote, consulta de status, retentativas, dead letter.

---

## 9. Segurança na borda

`next.config.ts` — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
(camera/microphone/geolocation negados), `Strict-Transport-Security`
(`max-age=31536000; includeSubDomains`), `poweredByHeader: false`, redirect
`/app → /dashboard`.

`vercel.json` repete quatro desses cabeçalhos (sem HSTS e sem DNS-prefetch) —
duplicação que convém consolidar em uma única fonte.

---

## 10. Resumo das divergências arquiteturais

| # | Divergência | Etapa que trata |
|---|---|---|
| A1 | Estrutura de providers fora de `src/lib/providers/**`; registries duplicados | 2 |
| A2 | Sem estado `disabled` explícito; seleção por presença de credencial | 2 |
| A3 | Contratos `DocumentSignerProvider` e `OrganizationRegistryProvider` inexistentes | 2 / 6 / 8 |
| A4 | Sem outbox, worker, dead letter ou idempotency store; envio síncrono | 2 / 13 |
| A5 | Contrato de variáveis divergente; sem validação por schema; sem `.env.test` | 2 |
| A6 | Evolution API não implementada (provider principal decidido) | 7 |
| A7 | Garantias do webhook dependem de função não versionada | 0 (R1) |
| A8 | Um único job agendado frente aos ~12 previstos | 13 |
| A9 | Cabeçalhos de segurança duplicados entre `next.config.ts` e `vercel.json` | 14 |
