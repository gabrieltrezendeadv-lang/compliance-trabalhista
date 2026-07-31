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

test("MUT-B04: catch devolvendo sucesso no repositório é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/repositories/supabase.ts",
    '      return fromThrown(causa, "repository_unavailable", "assinatura");\n    }\n  }\n\n  /**\n   * Último snapshot',
    '      return ok(null);\n    }\n  }\n\n  /**\n   * Último snapshot',
    GUARDA
  );
  assert.equal(r.code, 1, `o catch positivo passou:\n${r.out}`);
  assert.match(r.out, /BO-05/);
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

test("MUT-B09: repositório lendo sem filtrar organização é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/repositories/supabase.ts",
    '        .eq("organization_id", organizationId)\n        .eq("provider", provider)\n        .eq("external_charge_id", externalChargeId)',
    '        .eq("external_charge_id", externalChargeId)',
    GUARDA
  );
  assert.equal(r.code, 1, `a leitura sem tenant passou:\n${r.out}`);
  assert.match(r.out, /BO-11/);
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
    "      'ASSERÇÃO REPROVADA: cobrança órfã sobreviveu à falha (% linha(s)) — '",
    "      'ok (% linha(s)) — '",
    GUARDA
  );
  assert.equal(r.code, 1, `a remoção da prova de transação passou:\n${r.out}`);
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

test("MUT-B15: Date.now() no domínio é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/usecases/payments.ts",
    "function ms(iso: string): number {\n  const t = Date.parse(iso);",
    "function ms(iso: string): number {\n  const t = iso ? Date.parse(iso) : Date.now();",
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
    "  const inicio = env.clock.now();\n  const fim = addDays(inicio, input.days);",
    '  const inicio = process.env.AGORA ?? env.clock.now();\n  const fim = addDays(inicio, input.days);',
    GUARDA
  );
  assert.equal(r.code, 1, `a leitura de ambiente passou:\n${r.out}`);
  assert.match(r.out, /BO-02/);
});

// ── 10 a 13. Snapshot, grandfathering, cortesia, auditoria ─────────────────

test("MUT-B20: permitir UPDATE em price_snapshots é DETECTADO", () => {
  const r = mutar(
    "scripts/ci/assert-billing-security.sql",
    "       OR (a.privilege_type = 'UPDATE' AND c.relname NOT IN ('subscriptions', 'charges'))",
    "       OR (a.privilege_type = 'UPDATE' AND c.relname NOT IN ('subscriptions', 'charges', 'price_snapshots'))",
    GUARDA
  );
  assert.equal(r.code, 1, `o snapshot mutável passou:\n${r.out}`);
  assert.match(r.out, /BO-18/);
});

test("MUT-B21: grandfathering por usuário é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/usecases/access.ts",
    "  const jaTem = await env.repo.findGrandfathering(env.auth.organizationId);",
    "  const jaTem = await env.repo.findGrandfathering(env.auth.userId);",
    GUARDA
  );
  assert.equal(r.code, 1, `o grandfathering por usuário passou:\n${r.out}`);
  // A guarda de 12A já proíbe `userId` na elegibilidade; aqui a detecção é a
  // do alcance do domínio pela guarda de determinismo/tenant.
  assert.match(r.out, /BO-0[16]/);
});

test("MUT-B22: cortesia sem expiração é DETECTADA", () => {
  // Sem a validação de prazo, `days: 0` produziria uma cortesia que começa e
  // termina no mesmo instante — ou, com número negativo, uma que já nasceu
  // vencida. Cortesia sem prazo é plano gratuito disfarçado.
  const r = mutar(
    "src/lib/billing/usecases/access.ts",
    "  if (!Number.isInteger(input.days) || input.days <= 0) {",
    "  if (false) {",
    GUARDA
  );
  assert.equal(r.code, 1, `a cortesia sem prazo passou:
${r.out}`);
  assert.match(r.out, /BO-22/);
});

test("MUT-B23b: cortesia sem autor do contexto é DETECTADA", () => {
  const r = mutar(
    "src/lib/billing/usecases/access.ts",
    "    grantedBy: env.auth.userId,",
    '    grantedBy: "desconhecido",',
    GUARDA
  );
  assert.equal(r.code, 1, `a cortesia sem autor passou:
${r.out}`);
  assert.match(r.out, /BO-22/);
});

test("MUT-B23: auditoria sem ator do contexto é DETECTADA", () => {
  const r = mutar(
    "src/lib/billing/usecases/shared.ts",
    '    actorId: env.origin === "owner" || env.origin === "admin" ? env.auth.userId : null,',
    "    actorId: input.actorId ?? null,",
    GUARDA
  );
  assert.equal(r.code, 1, `o ator vindo do argumento passou:\n${r.out}`);
  assert.match(r.out, /BO-07/);
});

test("MUT-B24: falha de auditoria deixando a operação seguir é DETECTADA", () => {
  const r = mutar(
    "src/lib/billing/usecases/shared.ts",
    "  if (!r.ok) return r;\n  return ok(true);",
    "  return ok(true);",
    GUARDA
  );
  assert.equal(r.code, 1, `a escrita sem trilha passou:\n${r.out}`);
  assert.match(r.out, /BO-07/);
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
    "    code: erro.code ?? null,",
    "    code: erro.message ?? null,",
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

// ─── Limpeza ────────────────────────────────────────────────────────────────

fs.rmSync(copia, { recursive: true, force: true });

console.log("");
console.log(`Billing orchestration mutation guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
