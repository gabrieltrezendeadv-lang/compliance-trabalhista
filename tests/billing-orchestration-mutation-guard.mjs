/**
 * TESTES DE MUTAÇÃO DA ORQUESTRAÇÃO — Etapa 12B
 *
 * Mesma mecânica da 12A: o repositório é copiado, cada mutação é aplicada ao
 * ARQUIVO REAL dentro da cópia, a guarda REAL é executada lá dentro, e o teste
 * exige reprovação. `MUT-B00` é o controle — sem mutação, tudo passa.
 *
 * Nada é escrito no repositório de trabalho; a cópia é removida ao final.
 *
 * ── AS DEZESSEIS MUTAÇÕES EXIGIDAS ──────────────────────────────────────────
 *
 * Cada item da lista da revisão tem aqui uma mutação correspondente, e cada
 * mutação tem uma guarda estática que a detecta. Nenhuma depende de um teste
 * que este harness não consegue executar.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function test(nome, fn) {
  try {
    fn();
    passed += 1;
    console.log(`[PASS] ${nome}`);
  } catch (erro) {
    failed += 1;
    console.error(`[FAIL] ${nome}: ${erro.message}`);
  }
}

const COPIAR = ["tests", "src", "supabase", "scripts", ".github", "docs", "package.json", ".env.example", "vitest.config.mts"];
const copia = fs.mkdtempSync(path.join(os.tmpdir(), "billing12b-mut-"));

for (const item of COPIAR) {
  const origem = path.join(raiz, item);
  if (!fs.existsSync(origem)) continue;
  fs.cpSync(origem, path.join(copia, item), { recursive: true });
}

const ler = (rel) =>
  fs.readFileSync(path.join(copia, rel), "utf8").replace(/\r\n?/g, "\n");
const escrever = (rel, texto) => fs.writeFileSync(path.join(copia, rel), texto, "utf8");

function guarda(arquivo, args = []) {
  try {
    const out = execFileSync("node", [arquivo, ...args], {
      cwd: copia,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/**
 * Aplica a mutação, roda a guarda e restaura.
 *
 * `de` precisa casar EXATAMENTE uma vez — zero significa que o código mudou e
 * a mutação deixou de descrever um defeito real. O teste reprova alto em vez
 * de passar em silêncio, que é como um harness de mutação apodrece.
 */
function mutar(rel, de, para, arquivoDaGuarda) {
  const original = ler(rel);
  const n = original.split(de).length - 1;
  assert.equal(n, 1, `a mutação em ${rel} casou ${n} vez(es), esperado 1 — reescreva-a`);

  escrever(rel, original.replace(de, () => para));
  try {
    return guarda(arquivoDaGuarda);
  } finally {
    escrever(rel, original);
  }
}

const GUARDA = "tests/billing-orchestration-guard.mjs";
const MIGRATION_12B = "supabase/migrations/20260802093000_billing_orchestration.sql";

// ── Controle ────────────────────────────────────────────────────────────────

test("MUT-B00: sem mutação, a guarda PASSA na cópia", () => {
  const r = guarda(GUARDA);
  assert.equal(r.code, 0, `a guarda deveria passar sem mutação:\n${r.out}`);
  assert.match(r.out, /0 failed/);
});

// ── 1. Fallback para mock em produção ──────────────────────────────────────

test("MUT-B01: mock com fallback em produção é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/providers/mock/deterministic.ts",
    '    if (env.NODE_ENV === "production") {\n      throw new MockProviderForbiddenInProductionError("NODE_ENV=production");\n    }',
    '    if (env.NODE_ENV === "production") {\n      console.warn("mock em production");\n    }',
    GUARDA
  );
  assert.equal(r.code, 1, `o fallback em produção passou:\n${r.out}`);
  assert.match(r.out, /BO-08/);
});

test("MUT-B02: deixar de barrar VERCEL_ENV=production é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/providers/mock/deterministic.ts",
    '    if (env.VERCEL_ENV === "production") {\n      throw new MockProviderForbiddenInProductionError("VERCEL_ENV=production");\n    }',
    "    // sem checagem de VERCEL_ENV",
    GUARDA
  );
  assert.equal(r.code, 1, `a porta do VERCEL_ENV passou:\n${r.out}`);
  assert.match(r.out, /BO-08/);
});

test("MUT-B03: registry caindo no mock em vez de abortar é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/registry.ts",
    "  throw new BillingNotConfiguredError()",
    "  return getMockBillingProvider()",
    GUARDA
  );
  assert.equal(r.code, 1, `o fallback do registry passou:\n${r.out}`);
  assert.match(r.out, /BO-09/);
});

// ── 2. Erro de repository retornando allowed ───────────────────────────────

test("MUT-B04: resposta vazia convertida em sucesso é DETECTADA", () => {
  // `data` ausente não é "nada encontrado": é resposta que não entendemos.
  // Tratá-la como vazio bem-sucedido faria a camada superior decidir acesso
  // sobre um estado que ninguém leu.
  const r = mutar(
    "src/lib/billing/repositories/supabase.ts",
    "        return fail(\"repository_unavailable\", `${contexto}: resposta vazia`);",
    "        return ok(mapear({}) as T);",
    GUARDA
  );
  assert.equal(r.code, 1, `resposta vazia virando sucesso passou:\n${r.out}`);
  assert.match(r.out, /BO-23/);
});

test("MUT-B05: fromThrown aceitando código de sucesso é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/core/errors.ts",
    '  code: Extract<\n    BillingErrorCode,\n    "repository_unavailable" | "provider_unavailable" | "provider_timeout"\n  >,',
    "  code: BillingErrorCode,",
    GUARDA
  );
  assert.equal(r.code, 1, `o alargamento de fromThrown passou:\n${r.out}`);
  assert.match(r.out, /BO-05/);
});

// ── 3. Admin tratado como owner ────────────────────────────────────────────

test("MUT-B06: aceitar papel diferente de owner é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/usecases/shared.ts",
    '  if (auth.role !== "owner") {',
    '  if (auth.role === "nunca") {',
    GUARDA
  );
  assert.equal(r.code, 1, `admin como owner passou:\n${r.out}`);
  assert.match(r.out, /BO-06/);
});

// ── 4. Remoção da comparação de tenant ─────────────────────────────────────

test("MUT-B07: remover a comparação de tenant (IDOR) é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/usecases/shared.ts",
    "  if (requestedOrganizationId !== auth.organizationId) {",
    "  if (false) {",
    GUARDA
  );
  assert.equal(r.code, 1, `o IDOR passou:\n${r.out}`);
  assert.match(r.out, /BO-06/);
});

test("MUT-B08: recusa por tenant virando not_found é DETECTADA", () => {
  // `not_found` distingue "não existe" de "é de outro" — vira oráculo de
  // enumeração de organizações.
  const r = mutar(
    "src/lib/billing/usecases/shared.ts",
    '    return fail("not_owner", "somente o proprietário administra a assinatura");\n  }\n  return null;',
    '    return fail("not_found", "organização não encontrada");\n  }\n  return null;',
    GUARDA
  );
  assert.equal(r.code, 1, `o oráculo de enumeração passou:\n${r.out}`);
  assert.match(r.out, /BO-06/);
});

test("MUT-B09: RPC chamada por nome fixo, fora do tipo fechado, é DETECTADA", () => {
  // O ponto único de contato recebe `nome: NomeDeRpc`. Fixar um nome aqui
  // desliga a garantia de compilação — passaria a existir um caminho em que o
  // nome não vem da união fechada.
  const r = mutar(
    "src/lib/billing/repositories/supabase.ts",
    "      const { data, error } = await this.#db.rpc(nome, args);",
    '      const { data, error } = await this.#db.rpc("fn_billing_read_state", args);',
    GUARDA
  );
  assert.equal(r.code, 1, `o nome fixo fora do tipo passou:\n${r.out}`);
  assert.match(r.out, /BO-23/);
});

// ── 5 e 6. Idempotência e ordem ────────────────────────────────────────────

test("MUT-B10: remover a unicidade da idempotência é DETECTADO", () => {
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "  CONSTRAINT idempotency_chave_unica UNIQUE (organization_id, scope, provider, key)",
    "  CONSTRAINT idempotency_chave_unica CHECK (true)",
    GUARDA
  );
  assert.equal(r.code, 1, `evento duplicado criaria segunda cobrança:\n${r.out}`);
  assert.match(r.out, /BO-15/);
});

test("MUT-B11: tirar o provider da chave de idempotência é DETECTADO", () => {
  // Sem o provider na chave, um `event_id` do provider A silenciaria o do B.
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "UNIQUE (organization_id, scope, provider, key)",
    "UNIQUE (organization_id, scope, key)",
    GUARDA
  );
  assert.equal(r.code, 1, `a chave sem provider passou:\n${r.out}`);
  assert.match(r.out, /BO-15/);
});

test("MUT-B12: remover a unicidade por comando é DETECTADA", () => {
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "  CONSTRAINT charges_comando_unico UNIQUE (organization_id, idempotency_key),",
    "",
    GUARDA
  );
  assert.equal(r.code, 1, `o checkout repetido criaria segunda cobrança:\n${r.out}`);
  assert.match(r.out, /BO-15/);
});

test("MUT-B13: esvaziar a prova de transação no CI é DETECTADO", () => {
  // "Evento antigo reativando assinatura" e "falha após persistência parcial"
  // só se provam contra PostgreSQL. Remover a prova é remover a garantia.
  const r = mutar(
    "scripts/ci/assert-billing-orchestration.sql",
    "    RAISE EXCEPTION 'ASSERÇÃO REPROVADA: paid → failed foi aceito';",
    "    RAISE NOTICE 'tudo bem';",
    GUARDA
  );
  assert.equal(r.code, 1, `a remoção da prova de transição passou:\n${r.out}`);
  assert.match(r.out, /BO-17/);
});

test("MUT-B14: tirar a integração da 12B do CI é DETECTADO", () => {
  const r = mutar(
    ".github/workflows/ci.yml",
    "      - name: Integração da orquestração de billing (12B)",
    "      - name: Passo neutro\n        run: 'true'\n      - name: Desativado",
    GUARDA
  );
  assert.equal(r.code, 1, `a remoção da integração passou:\n${r.out}`);
  assert.match(r.out, /BO-17/);
});

// ── 7, 8 e 9. Determinismo e dinheiro ──────────────────────────────────────

test("MUT-B15: relógio implícito no lugar do Clock injetado é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/usecases/payments.ts",
    "  const agora = env.clock.now();",
    "  const agora = new Date().toISOString();",
    GUARDA
  );
  assert.equal(r.code, 1, `o relógio implícito passou:\n${r.out}`);
  assert.match(r.out, /BO-01/);
});

test("MUT-B16: Math.random() no domínio é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/core/ports.ts",
    "      n += 1;",
    "      n += 1 + Math.floor(Math.random() * 0);",
    GUARDA
  );
  assert.equal(r.code, 1, `o aleatório passou:\n${r.out}`);
  assert.match(r.out, /BO-01/);
});

test("MUT-B17: gerar UUID dentro do domínio é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/core/ports.ts",
    "      return `${prefixo}_${String(n).padStart(6, \"0\")}`;",
    "      return `${prefixo}_${crypto.randomUUID()}`;",
    GUARDA
  );
  assert.equal(r.code, 1, `o UUID no domínio passou:\n${r.out}`);
  assert.match(r.out, /BO-01/);
});

test("MUT-B18: cálculo monetário em ponto flutuante é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/usecases/payments.ts",
    "  const valor = priceCents(sub.plan, sub.tier, sub.period);",
    "  const valor = priceCents(sub.plan, sub.tier, sub.period) ?? 99.90;",
    GUARDA
  );
  assert.equal(r.code, 1, `o ponto flutuante passou:\n${r.out}`);
  assert.match(r.out, /BO-04/);
});

test("MUT-B19: ler process.env dentro do caso de uso é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/usecases/access.ts",
    "  if (!input.billingEnabled) {",
    '  if (process.env.BILLING_ENABLED !== "true") {',
    GUARDA
  );
  assert.equal(r.code, 1, `a leitura de ambiente passou:\n${r.out}`);
  assert.match(r.out, /BO-02/);
});

// ── 10 a 13. Snapshot, grandfathering, cortesia, auditoria ─────────────────

test("MUT-B20: devolver escrita direta ao service_role é DETECTADO", () => {
  // A 12B fecha `billing` para todos os papéis do PostgREST: a porta é a RPC.
  // Devolver o USAGE no schema reabriria o acesso direto — e, como o
  // service_role tem BYPASSRLS, o filtro por organização escrito no cliente
  // voltaria a ser a única barreira entre dois tenants.
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "REVOKE USAGE ON SCHEMA billing FROM service_role;",
    "GRANT USAGE ON SCHEMA billing TO service_role;",
    GUARDA
  );
  assert.equal(r.code, 1, `o acesso direto restaurado passou:\n${r.out}`);
  assert.match(r.out, /BO-18/);
});

test("MUT-B21: grandfathering por usuário é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/usecases/access.ts",
    "  const estado = await env.repo.readState(env.auth.userId, env.auth.organizationId);\n  if (!estado.ok) return estado;\n\n  if (estado.value.grandfathering !== null) {",
    "  const estado = await env.repo.readState(env.auth.organizationId, env.auth.organizationId);\n  if (!estado.ok) return estado;\n\n  if (estado.value.grandfathering !== null) {",
    GUARDA
  );
  assert.equal(r.code, 1, `o grandfathering por usuário passou:\n${r.out}`);
  assert.match(r.out, /BO-21/);
});

test("MUT-B22: cortesia sem expiração é DETECTADA", () => {
  // Sem a validação de prazo, `days: 0` produziria uma cortesia que começa e
  // termina no mesmo instante — ou, com número negativo, uma que já nasceu
  // vencida. Cortesia sem prazo é plano gratuito disfarçado.
  const r = mutar(
    "src/lib/billing/usecases/access.ts",
    "  if (!Number.isInteger(input.days) || input.days < 1) {",
    "  if (false) {",
    GUARDA
  );
  assert.equal(r.code, 1, `a cortesia sem prazo passou:
${r.out}`);
  assert.match(r.out, /BO-22/);
});

test("MUT-B23b: cortesia sem autor do contexto é DETECTADA", () => {
  const r = mutar(
    "src/lib/billing/repositories/in-memory.ts",
    "      grantedBy: ctx.actorId,",
    '      grantedBy: "desconhecido",',
    GUARDA
  );
  assert.equal(r.code, 1, `a cortesia sem autor passou:
${r.out}`);
  assert.match(r.out, /BO-22/);
});

test("MUT-B23: auditoria com ator em origem não humana é DETECTADA", () => {
  const r = mutar(
    "src/lib/billing/repositories/in-memory.ts",
    '      actorId: origin === "owner" || origin === "admin" ? actorId : null,',
    "      actorId,",
    GUARDA
  );
  assert.equal(r.code, 1, `o ator sem filtro de origem passou:\n${r.out}`);
  assert.match(r.out, /BO-07/);
});

test("MUT-B24: marcar `failed` em erro ambíguo do provider é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/usecases/payments.ts",
    "  if (AMBIGUOS.has(code)) return;",
    "  if (false) return;",
    GUARDA
  );
  assert.equal(r.code, 1, `marcar falha em erro ambíguo passou:\n${r.out}`);
  assert.match(r.out, /BO-24/);
});

// ── 14, 15 e 16. Rede, alcance público e feature flag ──────────────────────

test("MUT-B25: chamada a fetch na 12B é DETECTADA", () => {
  const r = mutar(
    "src/lib/billing/providers/mock/deterministic.ts",
    "    const cenario = this.#roteiro.shift() ?? \"approve\";",
    '    await fetch("https://api.asaas.com/v3/payments");\n    const cenario = this.#roteiro.shift() ?? "approve";',
    GUARDA
  );
  assert.equal(r.code, 1, `a chamada de rede passou:\n${r.out}`);
  assert.match(r.out, /BO-03/);
});

test("MUT-B26: remover a armadilha de rede da suíte é DETECTADO", () => {
  const r = mutar(
    "vitest.config.mts",
    '          setupFiles: ["./tests/setup/no-network.ts"],',
    "",
    GUARDA
  );
  assert.equal(r.code, 1, `a suíte sem armadilha passou:\n${r.out}`);
  assert.match(r.out, /BO-03/);
});

test("MUT-B27: importar a 12B numa página é DETECTADO", () => {
  const r = mutar(
    "src/app/(dashboard)/dashboard/billing/page.tsx",
    'import { redirect } from "next/navigation";',
    'import { redirect } from "next/navigation";\nimport { resolveBillingAccess } from "@/lib/billing/usecases/access";',
    GUARDA
  );
  assert.equal(r.code, 1, `o alcance pelo runtime público passou:\n${r.out}`);
  assert.match(r.out, /BO-12/);
});

test("MUT-B28: repositório real deixando de ser server-only é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/repositories/supabase.ts",
    'import "server-only";\n',
    "",
    GUARDA
  );
  assert.equal(r.code, 1, `o repositório importável pelo cliente passou:\n${r.out}`);
  assert.match(r.out, /BO-10/);
});

test("MUT-B29: propagar a mensagem do driver é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/repositories/supabase.ts",
    "  const code = erro.code ?? null;",
    "  const code = erro.message ?? null;",
    GUARDA
  );
  assert.equal(r.code, 1, `o vazamento da mensagem do driver passou:\n${r.out}`);
  assert.match(r.out, /BO-10/);
});

test("MUT-B30: flag ativando por ausência é DETECTADA", () => {
  const r = mutar(
    "src/lib/billing/flag.ts",
    "  return process.env[BILLING_FLAG_ENV] === BILLING_FLAG_ON;",
    '  return process.env.BILLING_DISABLED !== "true";',
    GUARDA
  );
  assert.equal(r.code, 1, `a ativação por ausência passou:\n${r.out}`);
  assert.match(r.out, /BO-12/);
});

test("MUT-B31: migration da 12B tocando public é DETECTADA", () => {
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "CREATE TABLE IF NOT EXISTS billing.customers (",
    "CREATE TABLE IF NOT EXISTS public.customers (\n  id uuid PRIMARY KEY\n);\n\nCREATE TABLE IF NOT EXISTS billing.customers (",
    GUARDA
  );
  assert.equal(r.code, 1, `o objeto em public passou:\n${r.out}`);
  assert.match(r.out, /BO-14/);
});

test("MUT-B32: policy aberta na 12B é DETECTADA", () => {
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "CREATE INDEX IF NOT EXISTS charges_organization_idx",
    "CREATE POLICY p_leitura ON billing.charges FOR SELECT USING (true);\n\nCREATE INDEX IF NOT EXISTS charges_organization_idx",
    GUARDA
  );
  assert.equal(r.code, 1, `a policy aberta passou:\n${r.out}`);
  assert.match(r.out, /BO-14/);
});

test("MUT-B33: tirar a 12B da rota de aplicação é DETECTADO", () => {
  const r = mutar(
    ".github/workflows/migration-apply.yml",
    "          - 20260802093000_billing_orchestration.sql\n",
    "",
    GUARDA
  );
  assert.equal(r.code, 1, `a lista divergente passou:\n${r.out}`);
  assert.match(r.out, /BO-16/);
});

// ─── A fronteira de `public`: allowlist, privilégio e search_path ───────────
//
// A 12B abre a única exceção à regra "nenhum objeto de billing em public".
// As quatro mutações abaixo atacam essa fronteira pelos quatro lados por onde
// ela pode ceder.

test("MUT-B34: conceder EXECUTE a authenticated é DETECTADO", () => {
  // As RPCs são SECURITY DEFINER e rodam como owner. Um EXECUTE para
  // `authenticated` entregaria a qualquer usuário logado, pelo PostgREST, uma
  // função que escreve em billing como dono do schema.
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.assinatura);\n    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);",
    "    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.assinatura);",
    GUARDA
  );
  assert.equal(r.code, 1, `EXECUTE para authenticated passou:\n${r.out}`);
});

test("MUT-B35: RPC sem search_path fixado é DETECTADA", () => {
  // Sem `SET search_path = ''`, uma função SECURITY DEFINER resolve nomes pelo
  // caminho de QUEM CHAMA. Quem chama pode criar um `billing` falso à frente e
  // fazer a função escrever no lugar errado, com privilégio de dono.
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "CREATE OR REPLACE FUNCTION public.fn_billing_read_state(\n  p_actor_id uuid,\n  p_organization_id uuid\n) RETURNS jsonb\nLANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER\nSET search_path = ''",
    "CREATE OR REPLACE FUNCTION public.fn_billing_read_state(\n  p_actor_id uuid,\n  p_organization_id uuid\n) RETURNS jsonb\nLANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER",
    GUARDA
  );
  assert.equal(r.code, 1, `RPC sem search_path passou:\n${r.out}`);
  assert.match(r.out, /BO-14/);
});

test("MUT-B36: RPC extra fora da allowlist é DETECTADA", () => {
  // Acrescentar função a `public` sem declará-la é exatamente o que a exceção
  // nominal existe para impedir.
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "-- ─── 9.6 CORTESIA E DIREITO ADQUIRIDO ───────────────────────────────────────",
    "CREATE OR REPLACE FUNCTION public.fn_billing_backdoor(p_x uuid)\nRETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = ''\nAS $bd$ SELECT '{}'::jsonb $bd$;\n\n-- ─── 9.6 CORTESIA E DIREITO ADQUIRIDO ───────────────────────────────────────",
    GUARDA
  );
  assert.equal(r.code, 1, `RPC não declarada passou:\n${r.out}`);
  assert.match(r.out, /BO-14/);
});

test("MUT-B37: sobrecarga de RPC autorizada é DETECTADA", () => {
  // `fn_billing_read_state(uuid, uuid, text)` seria outra função, com o mesmo
  // nome — e o PostgREST escolhe entre as duas pelos parâmetros que o chamador
  // mandar. Por isso a allowlist é por ASSINATURA, não por nome.
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "-- ─── 9.2 CICLO DE VIDA ──────────────────────────────────────────────────────",
    "CREATE OR REPLACE FUNCTION public.fn_billing_read_state(p_a uuid, p_b uuid, p_c text)\nRETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = ''\nAS $ov$ SELECT '{}'::jsonb $ov$;\n\n-- ─── 9.2 CICLO DE VIDA ──────────────────────────────────────────────────────",
    GUARDA
  );
  assert.equal(r.code, 1, `sobrecarga passou:\n${r.out}`);
  assert.match(r.out, /BO-14/);
});

test("MUT-B38: unicidade do evento externo voltando a ser por tenant é DETECTADA", () => {
  // Com `organization_id` na chave, o mesmo identificador do mesmo provider
  // pode existir em duas organizações — e a resolução do tenant pelo
  // identificador externo deixa de ser única.
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "  CONSTRAINT charges_externo_unico\n    UNIQUE (provider, provider_account_id, external_charge_id),",
    "  CONSTRAINT charges_externo_unico\n    UNIQUE (organization_id, provider, provider_account_id, external_charge_id),",
    GUARDA
  );
  assert.equal(r.code, 1, `unicidade por tenant passou:\n${r.out}`);
  assert.match(r.out, /BO-15/);
});

test("MUT-B39: remover o fingerprint da idempotência é DETECTADO", () => {
  // Sem fingerprint, a mesma chave com OUTRO pedido devolve o resultado do
  // primeiro, e o segundo pedido some sem aviso.
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "  request_fingerprint text NOT NULL CHECK (btrim(request_fingerprint) <> ''),",
    "  request_fingerprint text NULL,",
    GUARDA
  );
  assert.equal(r.code, 1, `idempotência sem fingerprint passou:\n${r.out}`);
  assert.match(r.out, /BO-15/);
});

test("MUT-B40: remover o estado in_progress é DETECTADO", () => {
  // Sem estado, o resultado volta a ser gravado ANTES do efeito, e uma falha no
  // meio prende a chave com um resultado que nunca aconteceu.
  const r = mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    "  status              billing.idempotency_state NOT NULL DEFAULT 'in_progress',",
    "",
    GUARDA
  );
  assert.equal(r.code, 1, `idempotência sem estado passou:\n${r.out}`);
  assert.match(r.out, /BO-15/);
});

test("MUT-B41: transformar a corrida real em INSERT sequencial é DETECTADO", () => {
  // Uma sessão não disputa nada consigo mesma. Sem a barreira, o teste volta a
  // ser o que a revisão reprovou: prova de constraint, não de concorrência.
  const r = mutar(
    "scripts/ci/assert-billing-concurrency.sh",
    "SELECT pg_advisory_xact_lock_shared(918273);",
    "SELECT 1;",
    GUARDA
  );
  assert.equal(r.code, 1, `corrida sem barreira passou:\n${r.out}`);
  assert.match(r.out, /BO-17/);
});

// ─── A âncora B e o splitter ────────────────────────────────────────────────

const REBUILD = ".github/workflows/migration-rebuild-verify.yml";

test("MUT-B42: remover o splitter da âncora B é DETECTADO", () => {
  const r = mutar(
    REBUILD,
    "          node scripts/ci/split-public-rpcs.mjs \\\n            artifacts/rebuilt-schema.sql \\\n            artifacts/rebuilt-sem-rpcs.sql \\\n            artifacts/rebuilt-rpcs.sql | tee artifacts/splitter.log",
    "          cp artifacts/rebuilt-schema.sql artifacts/rebuilt-sem-rpcs.sql",
    GUARDA
  );
  assert.equal(r.code, 1, `a âncora B sem splitter passou:\n${r.out}`);
  assert.match(r.out, /BO-25/);
});

test("MUT-B43: comparar o dump BRUTO na âncora B é DETECTADO", () => {
  // O bruto contém as dezesseis RPCs; compará-lo faria a âncora divergir — ou,
  // pior, alguém "consertaria" a baseline para caber.
  const r = mutar(
    REBUILD,
    "normalize-schema-dump.mjs artifacts/rebuilt-sem-rpcs.sql artifacts/rebuilt-schema.norm.sql",
    "normalize-schema-dump.mjs artifacts/rebuilt-schema.sql artifacts/rebuilt-schema.norm.sql",
    GUARDA
  );
  assert.equal(r.code, 1, `a comparação do dump bruto passou:\n${r.out}`);
  assert.match(r.out, /BO-25/);
});

test("MUT-B44: afrouxar a contagem de 16 blocos é DETECTADO", () => {
  const r = mutar(
    REBUILD,
    '[ "$BLOCOS" -eq 16 ]',
    '[ "$BLOCOS" -ge 1 ]',
    GUARDA
  );
  assert.equal(r.code, 1, `a contagem afrouxada passou:\n${r.out}`);
  assert.match(r.out, /BO-25/);
});

test("MUT-B45: omitir o catálogo das RPCs na âncora B é DETECTADO", () => {
  // A retirada textual não prova owner, SECURITY DEFINER, search_path, nomes de
  // parâmetro nem ACL: o dump é tirado com --no-owner --no-privileges.
  const r = mutar(
    REBUILD,
    "      - name: Âncora B — catálogo das RPCs no banco reconstruído\n        run: '\"$PGBIN/psql\" \"$DB_URL\" -v ON_ERROR_STOP=1 -f scripts/ci/assert-billing-rpcs.sql'",
    "      - name: Âncora B — catálogo das RPCs no banco reconstruído\n        run: 'echo pulado'",
    GUARDA
  );
  assert.equal(r.code, 1, `a âncora B sem prova de catálogo passou:\n${r.out}`);
  assert.match(r.out, /BO-25/);
});

test("MUT-B46: ignorar o exit code do splitter é DETECTADO", () => {
  const r = mutar(
    REBUILD,
    "            artifacts/rebuilt-rpcs.sql | tee artifacts/splitter.log",
    "            artifacts/rebuilt-rpcs.sql | tee artifacts/splitter.log || true",
    GUARDA
  );
  assert.equal(r.code, 1, `o exit code ignorado passou:\n${r.out}`);
  assert.match(r.out, /BO-25/);
});

test("MUT-B47: rodar o splitter na âncora A é DETECTADO", () => {
  // Lá as dezesseis ainda não existem: o splitter reprovaria por assinatura
  // ausente, e sugeriria que o dump histórico precisa de tratamento.
  const r = mutar(
    REBUILD,
    '            -f artifacts/historicas-schema.sql\n          wc -c artifacts/historicas-schema.sql',
    '            -f artifacts/historicas-schema.sql\n          node scripts/ci/split-public-rpcs.mjs artifacts/historicas-schema.sql /tmp/a.sql /tmp/b.sql\n          wc -c artifacts/historicas-schema.sql',
    GUARDA
  );
  assert.equal(r.code, 1, `o splitter na âncora A passou:\n${r.out}`);
  assert.match(r.out, /BO-25/);
});

// ─── Limpeza ────────────────────────────────────────────────────────────────

// ── LEASE DA RESERVA ────────────────────────────────────────────────────────
//
// A lease FALTOU no SQL enquanto existia no dublê, e nenhum teste percebeu:
// o contrato compartilhado não a exercitava e as duas variantes passavam
// 23/23. Estas oito mutações existem para que isso não volte a acontecer em
// silêncio — cada peça da lease, removida ou trocada, tem de reprovar.

test("MUT-B50: remover a comparação temporal da lease é DETECTADO", () => {
  const r = mutar(
    MIGRATION_12B,
    "IF p_now < v_rec.started_at + c_lease THEN",
    "IF true THEN",
    GUARDA
  );
  assert.equal(r.code, 1, `a lease sem expiração passou:\n${r.out}`);
  assert.match(r.out, /BO-26/);
});

test("MUT-B51: trocar a borda `<` por `<=` é DETECTADO", () => {
  // Com `<=` a lease valeria no limite exato, e o dublê discordaria — a
  // divergência voltaria, agora de um caractere.
  const r = mutar(
    MIGRATION_12B,
    "IF p_now < v_rec.started_at + c_lease THEN",
    "IF p_now <= v_rec.started_at + c_lease THEN",
    GUARDA
  );
  assert.equal(r.code, 1, `a borda trocada passou:\n${r.out}`);
  assert.match(r.out, /BO-26/);
});

test("MUT-B52: tornar a duração da lease um PARÂMETRO é DETECTADO", () => {
  const r = mutar(
    MIGRATION_12B,
    "c_lease constant interval := interval '5 minutes';",
    "c_lease interval := coalesce(p_lease_seconds * interval '1 second', interval '5 minutes');",
    GUARDA
  );
  assert.equal(r.code, 1, `duração vinda do cliente passou:\n${r.out}`);
  assert.match(r.out, /BO-26/);
});

test("MUT-B53: remover o FOR UPDATE do registro de idempotência é DETECTADO", () => {
  const r = mutar(
    MIGRATION_12B,
    "   FOR UPDATE;\n\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'billing: chave de idempotencia em disputa'",
    "   ;\n\n  IF NOT FOUND THEN\n    RAISE EXCEPTION 'billing: chave de idempotencia em disputa'",
    GUARDA
  );
  assert.equal(r.code, 1, `claim sem FOR UPDATE passou:\n${r.out}`);
  assert.match(r.out, /BO-27/);
});

test("MUT-B54: não renovar `started_at` no takeover é DETECTADO", () => {
  // Sem renovar, a chave poderia ser retomada em cascata: toda tentativa
  // seguinte veria a mesma lease vencida e venceria de novo.
  const r = mutar(
    MIGRATION_12B,
    "       SET started_at     = p_now,\n           error_code     = NULL,",
    "       SET error_code     = NULL,",
    GUARDA
  );
  assert.equal(r.code, 1, `takeover sem renovar started_at passou:\n${r.out}`);
  assert.match(r.out, /BO-27/);
});

test("MUT-B55: conferir o fingerprint DEPOIS da lease é DETECTADO", () => {
  // Ordem importa: expirar libera o MESMO pedido, nunca outro. Conferido
  // depois, um pedido diferente tomaria a reserva de quem chegou primeiro.
  const original = ler(MIGRATION_12B);
  const conflito =
    "  IF v_rec.request_fingerprint IS DISTINCT FROM p_fingerprint THEN\n" +
    "    RETURN jsonb_build_object('outcome', 'fingerprint_conflict');\n" +
    "  END IF;\n";
  const i = original.indexOf(conflito, original.indexOf("fn_billing_claim_idempotency"));
  assert.ok(i >= 0, "a mutação não encontrou o bloco de fingerprint — reescreva-a");

  const semConflito = original.slice(0, i) + original.slice(i + conflito.length);
  const j = semConflito.indexOf("  IF v_rec.status = 'in_progress' THEN");
  const movido = semConflito.slice(0, j) + conflito + semConflito.slice(j);

  escrever(MIGRATION_12B, movido);
  try {
    const r = guarda(GUARDA);
    assert.equal(r.code, 1, `fingerprint conferido depois da lease passou:\n${r.out}`);
    assert.match(r.out, /BO-27/);
  } finally {
    escrever(MIGRATION_12B, original);
  }
});

test("MUT-B56: ler o relógio do BANCO em vez do instante explícito é DETECTADO", () => {
  const r = mutar(
    MIGRATION_12B,
    "IF p_now < v_rec.started_at + c_lease THEN",
    "IF now() < v_rec.started_at + c_lease THEN",
    GUARDA
  );
  assert.equal(r.code, 1, `relógio do banco passou:\n${r.out}`);
  assert.match(r.out, /BO-29/);
});

test("MUT-B57: remover o cenário de lease do contrato compartilhado é DETECTADO", () => {
  // O contrato é o que faz memória e PostgREST responderem igual. Uma
  // expectativa removida daqui some das DUAS variantes de uma vez.
  const r = mutar(
    "tests/contract/shared-expectations.ts",
    'it("4: em T+5m EXATOS a lease já venceu — `claimed`", async () => {',
    'it.skip("4: em T+5m EXATOS a lease já venceu — `claimed`", async () => {',
    GUARDA
  );
  assert.equal(r.code, 1, `cenário de lease removido do contrato passou:\n${r.out}`);
  assert.match(r.out, /BO-30/);
});

fs.rmSync(copia, { recursive: true, force: true });
console.log("");
console.log(`Billing orchestration mutation guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
