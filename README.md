# Neo SST — Gestão de Conformidade

SaaS de gestão e evidência de conformidade trabalhista e SST para pequenas e
médias empresas: campanhas institucionais de saúde e prevenção, evidências de
envio e reconhecimento, avaliações de fatores psicossociais, inventário de
riscos, planos de ação, canal de denúncias e relatórios.

O Neo SST é uma **plataforma de gestão e evidência**. Não presta serviços
profissionais de medicina, psicologia ou engenharia, não armazena dados
individuais de saúde e não assume responsabilidade técnica por atos que dependam
de profissional habilitado. Os limites permanentes do produto estão em
[`docs/planning/NEO-SST-ESCOPO-CONSOLIDADO-v2.md`](docs/planning/NEO-SST-ESCOPO-CONSOLIDADO-v2.md) §2.

---

## ⚠️ Estado do projeto

**Este projeto está em desenvolvimento e não é um candidato a lançamento.**

O produto foi construído fora da ordem prevista no roadmap: existem módulos
avançados (campanhas, evidências, denúncias, avaliações, riscos) enquanto a
fundação — baseline, testes automatizados e contratos de provedores — ainda não
existe.

**Bloqueante em aberto (R1):** o schema do banco **não está versionado neste
repositório**. A aplicação consulta 27 tabelas e 25 funções, mas as migrations
versionadas criam 11 tabelas e 29 funções — restando **19 tabelas** e
**7 funções** sem definição alguma aqui. Um banco criado a partir deste
repositório **não roda a aplicação**.

Leia os documentos de linha de base antes de qualquer alteração:

| Documento | Conteúdo |
|---|---|
| [`docs/baseline/current-state.md`](docs/baseline/current-state.md) | módulos prontos/parciais/ausentes, divergências, resultado das verificações, problemas priorizados |
| [`docs/baseline/database-inventory.md`](docs/baseline/database-inventory.md) | tabelas, funções e migrations — **conhecidas e desconhecidas** |
| [`docs/baseline/architecture.md`](docs/baseline/architecture.md) | camadas, providers, webhooks, jobs e divergências arquiteturais |
| [`docs/baseline/security-model.md`](docs/baseline/security-model.md) | RLS, papéis, fronteira do `service_role`, fail-closed, pendências |

Escopo e plano de execução:

| Documento | Conteúdo |
|---|---|
| [`docs/planning/NEO-SST-ESCOPO-CONSOLIDADO-v2.md`](docs/planning/NEO-SST-ESCOPO-CONSOLIDADO-v2.md) | escopo de produto e limites permanentes |
| [`docs/planning/NEO-SST-ROADMAP-IMPLEMENTACAO-v1.md`](docs/planning/NEO-SST-ROADMAP-IMPLEMENTACAO-v1.md) | 19 etapas, gates e critérios de conclusão |

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5.9 · Tailwind CSS 4 ·
Radix UI / shadcn · React Hook Form + Zod 4 · Supabase (Auth + PostgreSQL) ·
Vercel (região `gru1`).

> **Para agentes de código:** conforme [`AGENTS.md`](AGENTS.md), esta versão do
> Next.js contém mudanças de ruptura em relação a modelos pré-treinados. Leia o
> guia correspondente em `node_modules/next/dist/docs/` **antes** de escrever
> código.

---

## Instalação local

### Pré-requisitos

- Node.js 20 ou superior (validado em v24.13.0)
- npm 10 ou superior (validado em 11.6.2)
- acesso a um projeto Supabase — **veja a ressalva do bloqueante R1 abaixo**

### Passos

```bash
git clone <url-do-repositorio>
cd compliance-trabalhista

# instalação reprodutível a partir do lockfile
npm ci

# variáveis de ambiente
cp .env.example .env.local
# preencha .env.local — NUNCA versione este arquivo
```

```bash
npm run dev     # http://localhost:3000
```

### Ressalva sobre o banco

`supabase/migrations/` **não é suficiente** para criar um banco funcional
(bloqueante R1). Rodar a aplicação contra um banco novo criado apenas com estas
migrations resultará em erro nas 19 tabelas e 7 funções ausentes, listadas em
[`docs/baseline/database-inventory.md`](docs/baseline/database-inventory.md).

Enquanto R1 não for resolvido — por dump de schema ou introspecção autorizada —
o desenvolvimento local depende de acesso a um banco já provisionado.

---

## Variáveis de ambiente

Nomes e finalidade. **Os valores ficam apenas em `.env.local` (não versionado) e
no painel seguro da Vercel.** Consulte [`.env.example`](.env.example).

| Variável | Escopo | Obrigatória |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | público | sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | público | sim |
| `NEXT_PUBLIC_APP_URL` | público | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** | sim |
| `CRON_SECRET` | server-only | sim (rotina de ciclos) |
| `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_WEBHOOK_SECRET` | server-only | não — canal desativa sem elas |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | server-only | não |
| `ASAAS_API_KEY`, `ASAAS_SANDBOX`, `ASAAS_WEBHOOK_TOKEN` | server-only | não |
| `ALLOW_MOCK_PROVIDERS`, `ALLOW_MOCK_BILLING_PROVIDER`, `ALLOW_INSECURE_BILLING_WEBHOOKS` | dev/teste | **nunca em produção** |

Sem credencial configurada, o canal correspondente **falha fechado**: nenhum
envio é marcado como realizado e nenhum mock é usado em produção. Detalhes em
[`docs/baseline/security-model.md`](docs/baseline/security-model.md) §5.

---

## Scripts

| Script | Comando | Função |
|---|---|---|
| `npm run dev` | `next dev` | servidor de desenvolvimento |
| `npm run build` | `next build` | build de produção |
| `npm start` | `next start` | serve o build |
| `npm run lint` | `eslint` | lint de todo o projeto (o CI roda `eslint src/`) |
| `npm run test:reconciliation` | `node tests/reconciliation-guards.mjs` | guards de reconciliação |

Sem script correspondente no `package.json`:

```bash
npx --no-install tsc --noEmit        # typecheck
node tests/p0-runtime-guards.mjs     # guards P0 (rodam no CI)
```

> Use sempre `npx --no-install` para evitar download implícito de pacotes de
> terceiros. `npx tsc` **sem** essa flag baixa um pacote `tsc` do registro que
> **não é** o compilador TypeScript.

### Testes ainda não executáveis

`tests/fail-closed-channels.test.ts`, `tests/gateway.test.ts`,
`tests/call-graph.test.ts` e `tests/whatsapp-cloud.test.ts` — 2.249 linhas — são
escritos para `npx tsx`, mas **`tsx` não é dependência do projeto** e nenhum
runner de testes está instalado. Não rodam no CI. A Etapa 1 do roadmap
(Vitest + Playwright + gate `verify`) resolve isso.

---

## Estrutura

```
src/
  app/
    (auth)/          login, signup, callback OAuth
    (dashboard)/     área autenticada
    (public)/        avaliação por token, canal de denúncias
    api/
      cron/          rotina de encerramento de ciclos
      webhooks/      Resend, WhatsApp, Asaas
  components/        UI por domínio + primitivos shadcn em ui/
  lib/
    <módulo>/actions.ts    server actions por domínio
    schemas/               validação Zod
    supabase/              clientes: client · server · proxy · service
    integrations/          providers de mensageria + registry
    billing/               providers de cobrança + registry
  types/database.ts        tipos do banco (obsoleto — cobre 5 de 27 tabelas)

supabase/
  migrations/   rollbacks/   manual/   scripts/

tests/          docs/baseline/   docs/planning/
```

---

## Fluxo de contribuição

O roadmap (§3) exige, para cada etapa: diagnóstico somente leitura → plano
aprovado → branch própria → testes locais → preview Vercel → migration validada
em branch descartável com rollback → PR draft → revisão independente → merge.

Quatro gates obrigatórios: **código** (lint, TypeScript, build) · **funcional**
(testes e jornadas) · **segurança** (isolamento de tenant, papéis, payloads
inválidos, privilégios) · **banco/deploy** (aplicação e rollback em ambiente
descartável, preview e smoke test).

Nunca: aplicar migration em produção sem confirmação explícita · usar produção
para desenvolver · alterar dados reais para criar fixture · remover migrations
anteriores · expor `service_role` no frontend · silenciar erro de segurança para
fazer teste passar · marcar etapa como concluída sem evidência dos testes.

---

## Próxima etapa

**Etapa 1 — Fundação de testes e CI:** Vitest, Testing Library, Playwright,
fixtures multi-tenant, scripts `test` / `typecheck` / `verify` e CI com gate
`verify`. Ver [`docs/baseline/current-state.md`](docs/baseline/current-state.md) §12.

---

## Licença

Software proprietário. Todos os direitos reservados.
