/**
 * MUTAÇÕES DA APOSENTADORIA DO RUNTIME LEGADO — Etapa 12C.0
 *
 * Mesma mecânica das demais: o repositório é copiado, a mutação é aplicada ao
 * arquivo REAL dentro da cópia, a guarda REAL roda lá dentro, e o teste exige
 * REPROVAÇÃO. Nada é escrito na árvore de trabalho.
 *
 * ── POR QUE ESTAS MUTAÇÕES SÃO DE RESSURREIÇÃO ──────────────────────────────
 *
 * As outras suítes mutam código presente para provar que uma propriedade é
 * cobrada. Aqui a propriedade é a AUSÊNCIA, então cada mutação traz de volta
 * um pedaço do que foi aposentado — a rota, o server action, o import órfão, a
 * escrita direta, o interruptor inseguro, a seleção por presença de chave.
 *
 * Uma guarda de ausência que nunca viu o item de volta não provou nada: ela
 * pode estar procurando no lugar errado e passando por isso. `MUT-LR-00` é o
 * controle — sem mutação, tudo passa.
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

const COPIAR = ["tests", "src", "supabase", "scripts", ".github", "package.json", ".env.example"];
const copia = fs.mkdtempSync(path.join(os.tmpdir(), "billing-retire-mut-"));

for (const item of COPIAR) {
  const origem = path.join(raiz, item);
  if (!fs.existsSync(origem)) continue;
  fs.cpSync(origem, path.join(copia, item), { recursive: true });
}

const GUARDA = "tests/billing-legacy-retirement-guard.mjs";

function guarda(arquivo = GUARDA) {
  try {
    const out = execFileSync("node", [arquivo], { cwd: copia, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

const lerCopia = (rel) => fs.readFileSync(path.join(copia, rel), "utf8").replace(/\r\n?/g, "\n");
const escreverCopia = (rel, texto) => {
  fs.mkdirSync(path.dirname(path.join(copia, rel)), { recursive: true });
  fs.writeFileSync(path.join(copia, rel), texto, "utf8");
};

/** Cria um arquivo que não existia, roda a guarda e apaga. */
function ressuscitar(rel, conteudo, esperado) {
  const alvo = path.join(copia, rel);
  assert.ok(!fs.existsSync(alvo), `${rel} já existe na cópia — a mutação não descreve ressurreição`);
  escreverCopia(rel, conteudo);
  try {
    const r = guarda();
    assert.equal(r.code, 1, `a ressurreição de ${rel} passou:\n${r.out}`);
    assert.match(r.out, esperado);
  } finally {
    fs.rmSync(alvo, { force: true });
  }
}

/** Substitui texto num arquivo existente, roda a guarda e restaura. */
function mutar(rel, de, para, esperado) {
  const original = lerCopia(rel);
  const n = original.split(de).length - 1;
  assert.equal(n, 1, `a mutação em ${rel} casou ${n} vez(es), esperado 1 — reescreva-a`);
  escreverCopia(rel, original.replace(de, () => para));
  try {
    const r = guarda();
    assert.equal(r.code, 1, `a mutação em ${rel} passou:\n${r.out}`);
    assert.match(r.out, esperado);
  } finally {
    escreverCopia(rel, original);
  }
}

// ── Controle ────────────────────────────────────────────────────────────────

test("MUT-LR-00: sem mutação, a guarda PASSA na cópia", () => {
  const r = guarda();
  assert.equal(r.code, 0, `a guarda deveria passar sem mutação:\n${r.out}`);
  assert.match(r.out, /0 failed/);
});

// ── 1. Ressurreição de arquivo ─────────────────────────────────────────────

test("MUT-LR-01: restaurar a rota /api/webhooks/billing é DETECTADO", () => {
  ressuscitar(
    "src/app/api/webhooks/billing/route.ts",
    'export async function POST() {\n  return Response.json({ ok: true });\n}\n',
    /LR-01|LR-03/
  );
});

test("MUT-LR-02: restaurar lib/billing/actions.ts é DETECTADO", () => {
  ressuscitar(
    "src/lib/billing/actions.ts",
    '"use server"\n\nexport async function assinar() {\n  return null;\n}\n',
    /LR-01/
  );
});

test("MUT-LR-03: restaurar um componente órfão é DETECTADO", () => {
  ressuscitar(
    "src/components/billing/plan-card.tsx",
    '"use client"\n\nexport function PlanCard() {\n  return null;\n}\n',
    /LR-01/
  );
});

test("MUT-LR-04: importar um módulo aposentado é DETECTADO", () => {
  // O arquivo aposentado nem precisa existir: importá-lo já é o defeito.
  mutar(
    "src/lib/billing/flag.ts",
    'export const BILLING_FLAG_ENV = "BILLING_ENABLED";',
    'import { assinar } from "@/lib/billing/actions";\nexport const BILLING_FLAG_ENV = "BILLING_ENABLED";\nvoid assinar;',
    /LR-02/
  );
});

// ── 2. Escrita direta nas tabelas legadas ──────────────────────────────────

for (const tabela of [
  "subscription_plans",
  "tenant_subscriptions",
  "invoices",
  "usage_records",
  "billing_events",
]) {
  test(`MUT-LR-05/${tabela}: escrita direta em ${tabela} é DETECTADA`, () => {
    mutar(
      "src/lib/billing/flag.ts",
      "export function isBillingEnabled(): boolean {",
      `export async function gravar(sb: { from: (t: string) => { insert: (v: unknown) => Promise<unknown> } }) {\n` +
        `  return sb.from("${tabela}").insert({});\n}\n\n` +
        "export function isBillingEnabled(): boolean {",
      /LR-04/
    );
  });
}

test("MUT-LR-06: chamar check_plan_limit é DETECTADO", () => {
  mutar(
    "src/lib/billing/flag.ts",
    "export function isBillingEnabled(): boolean {",
    'export async function limite(sb: { rpc: (n: string) => Promise<unknown> }) {\n' +
      '  return sb.rpc("check_plan_limit");\n}\n\n' +
      "export function isBillingEnabled(): boolean {",
    /LR-05/
  );
});

// ── 3. Interruptor inseguro ────────────────────────────────────────────────

test("MUT-LR-07: reintroduzir o interruptor inseguro é DETECTADO", () => {
  const nome = ["ALLOW", "INSECURE", "BILLING", "WEBHOOKS"].join("_");
  mutar(
    "src/lib/billing/flag.ts",
    "export function isBillingEnabled(): boolean {",
    `export function pularAssinatura(): boolean {\n  return process.env.${nome} === "true";\n}\n\n` +
      "export function isBillingEnabled(): boolean {",
    /LR-06/
  );
});

test("MUT-LR-08: o interruptor de volta ao .env.example é DETECTADO", () => {
  const nome = ["ALLOW", "INSECURE", "BILLING", "WEBHOOKS"].join("_");
  mutar("\u002Eenv.example", "\nBILLING_PROVIDER=\n", `\nBILLING_PROVIDER=\n${nome}=false\n`, /LR-06/);
});

// ── 4. Seleção de provider ─────────────────────────────────────────────────

test("MUT-LR-09: selecionar Asaas pela presença da API key é DETECTADO", () => {
  mutar(
    "src/lib/billing/registry.ts",
    "  const escolhido = seletorDeProvider(env);",
    '  if (env.ASAAS_API_KEY) return { name: "asaas" } as unknown as BillingProviderPort;\n' +
      "  const escolhido = seletorDeProvider(env);",
    /LR-07/
  );
});

test("MUT-LR-10: fallback automático para o Mock é DETECTADO", () => {
  mutar(
    "src/lib/billing/registry.ts",
    '  exigirConfiguracaoDoAsaas(env);\n  throw new BillingProviderNotImplementedError("asaas");',
    "  return new BillingProviderMock({\n    ids: sequentialIds(),\n    env: { NODE_ENV: env.NODE_ENV, VERCEL_ENV: env.VERCEL_ENV },\n  });",
    /LR-08/
  );
});

test("MUT-LR-11: fallback automático para o Asaas é DETECTADO", () => {
  // Devolver o Asaas SEM validar a configuração é o espelho do defeito antigo.
  mutar(
    "src/lib/billing/registry.ts",
    '  exigirConfiguracaoDoAsaas(env);\n  throw new BillingProviderNotImplementedError("asaas");',
    '  throw new BillingProviderNotImplementedError("asaas");',
    /LR-08/
  );
});

test("MUT-LR-12: seletor com padrão implícito é DETECTADO", () => {
  mutar(
    "src/lib/billing/registry.ts",
    '  const bruto = (env.BILLING_PROVIDER ?? "").trim();',
    '  const bruto = (env.BILLING_PROVIDER ?? "mock").trim();',
    /LR-09/
  );
});

test("MUT-LR-13: aceitar seletor ausente é DETECTADO", () => {
  mutar(
    "src/lib/billing/registry.ts",
    '  if (bruto === "") {',
    '  if (false) {',
    /LR-09/
  );
});

test("MUT-LR-14: aceitar seletor desconhecido é DETECTADO", () => {
  mutar(
    "src/lib/billing/registry.ts",
    "  if (!(PROVIDERS_DE_COBRANCA as readonly string[]).includes(bruto)) {",
    "  if (false) {",
    /LR-09/
  );
});

test("MUT-LR-15: conjunto de providers deixando de ser fechado é DETECTADO", () => {
  mutar(
    "src/lib/billing/registry.ts",
    'export const PROVIDERS_DE_COBRANCA = Object.freeze(["mock", "asaas"] as const);',
    "export const PROVIDERS_DE_COBRANCA = (process.env.PROVIDERS ?? \"mock\").split(\",\") as readonly string[];",
    /LR-07/
  );
});

test("MUT-LR-16: mensagem de erro ecoando o secret é DETECTADA", () => {
  mutar(
    "src/lib/billing/registry.ts",
    "      `faltam variáveis do Asaas: ${faltando.join(\", \")}.`",
    "      `faltam variáveis do Asaas: ${faltando.join(\", \")}. Recebido: ${env.ASAAS_API_KEY}`",
    /LR-10/
  );
});

// ── 5. Religar a jornada, e remover a própria guarda ───────────────────────

test("MUT-LR-17: religar /dashboard/billing é DETECTADO", () => {
  mutar(
    "src/app/(dashboard)/dashboard/billing/page.tsx",
    'redirect("/dashboard");',
    "return null;",
    /LR-21/
  );
});

test("MUT-LR-18: apagar tabela legada da migration histórica é DETECTADO", () => {
  mutar(
    "supabase/migrations/20260724161707_create_billing_tables_only.sql",
    "CREATE TABLE public.usage_records",
    "CREATE TABLE public.usage_records_renomeada",
    /LR-19/
  );
});

test("MUT-LR-19: remover a guarda da suíte de reconciliação é DETECTADO", () => {
  mutar(
    "package.json",
    "node tests/billing-legacy-retirement-guard.mjs && ",
    "",
    /LR-20/
  );
});

// ── 6. Allowlist do webhook, 404 exato e ordem provider × PII ──────────────

test("MUT-LR-20: acrescentar `billing` à allowlist de webhooks é DETECTADO", () => {
  // É a porta pela qual o caminho antigo voltaria sem recriar arquivo nenhum:
  // a rota dinâmica já casa com /api/webhooks/billing; falta só o mapa aceitar.
  mutar(
    "src/app/api/webhooks/[provider]/route.ts",
    '  resend: "email",\n  whatsapp: "whatsapp",',
    '  resend: "email",\n  whatsapp: "whatsapp",\n  billing: "email",',
    /LR-14/
  );
});

test("MUT-LR-21: trocar a recusa de provider desconhecido de 404 para outro status é DETECTADO", () => {
  mutar(
    "src/app/api/webhooks/[provider]/route.ts",
    '      { error: `Unknown provider: ${providerName}` },\n      { status: 404 }',
    '      { error: `Unknown provider: ${providerName}` },\n      { status: 405 }',
    /LR-14/
  );
});

test("MUT-LR-22: afrouxar o E2E para aceitar 405 é DETECTADO", () => {
  mutar(
    "tests/e2e/billing-retired.spec.ts",
    "    expect(resposta.status()).toBe(404);\n    expect(resposta.ok()).toBe(false);\n  });\n\n  test(\"GET no mesmo caminho também responde 404 exato\"",
    "    expect([404, 405]).toContain(resposta.status());\n    expect(resposta.ok()).toBe(false);\n  });\n\n  test(\"GET no mesmo caminho também responde 404 exato\"",
    /LR-15/
  );
});

test("MUT-LR-23: remover do E2E a prova de PROCEDÊNCIA do 404 é DETECTADO", () => {
  // Medir só o status deixaria passar um 404 vindo de outro lugar — por
  // exemplo, de um handler novo que recusa por conta própria.
  mutar(
    "tests/e2e/billing-retired.spec.ts",
    'expect(await doBilling.json()).toEqual({ error: "Unknown provider: billing" });',
    "expect(doBilling.ok()).toBe(false);",
    /LR-15/
  );
});

test("MUT-LR-24: entrypoint que envia PII ANTES de resolver o provider é DETECTADO", () => {
  // Hoje nenhum entrypoint toca o provider, então LR-16 passa por vacuidade.
  // Esta mutação cria o primeiro — com a ordem invertida — e prova que a regra
  // não é decorativa. É o teste que impede a guarda de nascer morta.
  ressuscitar(
    "src/app/api/checkout-mutante/route.ts",
    'import { resolveBillingProvider } from "@/lib/billing/registry";\n\n' +
      "export async function POST(request: Request) {\n" +
      "  const dados = await request.json();\n" +
      "  const provider = { createCustomer: async (x: unknown) => x };\n" +
      "  await provider.createCustomer({ nome: dados.nome, cpfCnpj: dados.cpfCnpj });\n" +
      "  const real = resolveBillingProvider();\n" +
      "  return Response.json({ ok: Boolean(real) });\n" +
      "}\n",
    /LR-16/
  );
});

test("MUT-LR-25: entrypoint que envia PII SEM resolver o provider é DETECTADO", () => {
  ressuscitar(
    "src/app/api/checkout-mutante/route.ts",
    "export async function POST(request: Request) {\n" +
      "  const dados = await request.json();\n" +
      "  const provider = { createCustomer: async (x: unknown) => x };\n" +
      "  await provider.createCustomer({ nome: dados.nome, cpfCnpj: dados.cpfCnpj });\n" +
      "  return Response.json({ ok: true });\n" +
      "}\n",
    /LR-16/
  );
});

test("MUT-LR-26: server action que envia PII sem resolver o provider é DETECTADA", () => {
  // A regra vale para as duas formas de entrypoint, não só para route handler.
  ressuscitar(
    "src/lib/billing/checkout-mutante.ts",
    '"use server"\n\n' +
      "export async function contratar(nome: string, cpfCnpj: string) {\n" +
      "  const provider = { createCharge: async (x: unknown) => x };\n" +
      "  return provider.createCharge({ nome, cpfCnpj });\n" +
      "}\n",
    /LR-16/
  );
});

test("MUT-LR-27: construir provider fora do registry é DETECTADO", () => {
  mutar(
    "src/lib/billing/flag.ts",
    "export function isBillingEnabled(): boolean {",
    'import { BillingProviderMock } from "./providers/mock/deterministic";\n' +
      "export function atalho() {\n" +
      "  return new BillingProviderMock({ ids: { next: () => \"x\" } });\n}\n\n" +
      "export function isBillingEnabled(): boolean {",
    /LR-17/
  );
});

test("MUT-LR-28: `.env.example` voltando a escolher `mock` é DETECTADO", () => {
  mutar(".env.example", "\nBILLING_PROVIDER=\n", "\nBILLING_PROVIDER=mock\n", /LR-18/);
});

test("MUT-LR-29: `.env.example` escolhendo `asaas` é DETECTADO", () => {
  mutar(".env.example", "\nBILLING_PROVIDER=\n", "\nBILLING_PROVIDER=asaas\n", /LR-18/);
});

// ─── Fim ────────────────────────────────────────────────────────────────────

fs.rmSync(copia, { recursive: true, force: true });

console.log("");
console.log(`Billing legacy retirement mutation guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
