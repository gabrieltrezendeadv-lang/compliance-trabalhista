/**
 * GUARDA DA APOSENTADORIA DO RUNTIME LEGADO DE BILLING — Etapa 12C.0
 *
 * ── O QUE FOI APOSENTADO, E POR QUÊ ─────────────────────────────────────────
 *
 * Até a 12B o repositório carregava DOIS mundos de billing ao mesmo tempo. O
 * novo (schema `billing`, 16 RPCs, `service_role` sem privilégio direto) estava
 * correto e inerte — nada em `src/app` ou `src/components` o importava. O
 * antigo estava parcialmente VIVO:
 *
 *   /api/webhooks/billing ..... rota real, que escrevia em `tenant_subscriptions`,
 *                               `invoices` e `billing_events` com service-role, e
 *                               que NÃO consultava a feature flag;
 *   lib/billing/actions.ts .... `"use server"`, escrevia direto nas tabelas
 *                               legadas e chamava `check_plan_limit`, cujo
 *                               EXECUTE a SEC-002 revogou de todos os papéis;
 *   4 componentes ............. órfãos, mas importando o `actions.ts`;
 *   interruptor inseguro ...... permitia pular a verificação de assinatura do
 *                               webhook fora de produção.
 *
 * Construir a jornada nova por cima disso criaria dois estados de assinatura
 * divergentes no mesmo tenant — e o divergente seria justamente o que não tem
 * guarda. Por isso a aposentadoria vem ANTES da 12C.1.
 *
 * ── O QUE ESTA GUARDA COBRA ─────────────────────────────────────────────────
 *
 * Ausência, com diagnóstico nominal. Cada asserção diz QUAL item ressuscitou,
 * não apenas que "algo" falhou — uma guarda que responde "reprovado" sem dizer
 * o quê é uma guarda que ninguém consegue consertar.
 *
 * ── O QUE ESTA GUARDA NÃO COBRA, DE PROPÓSITO ───────────────────────────────
 *
 * As cinco tabelas legadas em `public` CONTINUAM no banco. A 12C.0 não as
 * remove: tirar tabela é migration, com rollback e rodada própria de aplicação.
 * O que esta etapa garante é que nenhum código de aplicação saiba escrevê-las.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8").replace(/\r\n?/g, "\n");
const existe = (p) => fs.existsSync(path.join(raiz, p));

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

/**
 * Fonte SEM comentários.
 *
 * `guard.ts` documenta em prosa por que NÃO chama `check_plan_limit`, e
 * `registry.ts` explica o defeito que substituiu. Cobrar o literal no arquivo
 * inteiro proibiria explicar a história — que é justamente o que impede o
 * defeito de voltar por esquecimento.
 */
function executavel(rel) {
  return ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

/** Todos os `.ts`/`.tsx` de `src/`. */
function fontesDeSrc() {
  const achados = [];
  const varrer = (dir) => {
    for (const e of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name).split(path.sep).join("/");
      if (e.isDirectory()) varrer(rel);
      else if (/\.(ts|tsx)$/.test(e.name)) achados.push(rel);
    }
  };
  varrer("src");
  return achados;
}

// ── 1. ARQUIVOS APOSENTADOS ────────────────────────────────────────────────

const APOSENTADOS = Object.freeze([
  "src/app/api/webhooks/billing/route.ts",
  "src/lib/billing/actions.ts",
  "src/components/billing/current-plan-card.tsx",
  "src/components/billing/invoice-table.tsx",
  "src/components/billing/plan-card.tsx",
  "src/components/billing/subscription-warning.tsx",
]);

test("LR-01: nenhum arquivo aposentado voltou a existir", () => {
  const ressuscitados = APOSENTADOS.filter(existe);
  assert.deepEqual(
    ressuscitados,
    [],
    `arquivo(s) aposentado(s) de volta:\n  ${ressuscitados.join("\n  ")}`
  );
});

test("LR-02: nada em src/ importa um arquivo aposentado", () => {
  const modulos = APOSENTADOS.map((a) =>
    a.replace(/^src\//, "@/").replace(/\.(ts|tsx)$/, "")
  );
  const culpados = [];
  for (const arquivo of fontesDeSrc()) {
    const src = executavel(arquivo);
    for (const m of modulos) {
      const curto = m.replace(/^@\//, "");
      if (src.includes(m) || new RegExp(`from\\s+["'][^"']*${curto}["']`).test(src)) {
        culpados.push(`${arquivo} → ${m}`);
      }
    }
  }
  assert.deepEqual(culpados, [], `import de módulo aposentado:\n  ${culpados.join("\n  ")}`);
});

test("LR-03: a rota /api/webhooks/billing não existe em forma alguma", () => {
  // Diretório, `route.ts`, `route.tsx` e qualquer arquivo sob ele.
  const dir = path.join(raiz, "src/app/api/webhooks/billing");
  assert.ok(
    !fs.existsSync(dir),
    "o diretório src/app/api/webhooks/billing voltou a existir"
  );
  // E nenhuma outra rota assumiu o caminho.
  const rotas = fontesDeSrc().filter((f) => /^src\/app\/api\/.*\/route\.tsx?$/.test(f));
  const usurpadoras = rotas.filter((f) => f.includes("/webhooks/billing/"));
  assert.deepEqual(usurpadoras, [], `rota de webhook de billing recriada: ${usurpadoras.join(", ")}`);
});

// ── 2. TABELAS LEGADAS: SEM CAMINHO DE ESCRITA ─────────────────────────────

const TABELAS_LEGADAS = Object.freeze([
  "subscription_plans",
  "tenant_subscriptions",
  "invoices",
  "usage_records",
  "billing_events",
]);

test("LR-04: nenhuma fonte de src/ endereça as cinco tabelas legadas", () => {
  const acessos = [];
  for (const arquivo of fontesDeSrc()) {
    const src = executavel(arquivo);
    for (const t of TABELAS_LEGADAS) {
      if (new RegExp(`\\.from\\(\\s*["'\`]${t}["'\`]`).test(src)) {
        acessos.push(`${arquivo} → ${t}`);
      }
    }
  }
  assert.deepEqual(
    acessos,
    [],
    `acesso a tabela legada de billing:\n  ${acessos.join("\n  ")}\n` +
      "As cinco continuam no banco de propósito; o que não pode voltar é código que as escreva."
  );
});

test("LR-05: `check_plan_limit` não é chamada por código executável", () => {
  const chamadas = [];
  for (const arquivo of fontesDeSrc()) {
    if (/check_plan_limit/.test(executavel(arquivo))) chamadas.push(arquivo);
  }
  assert.deepEqual(
    chamadas,
    [],
    `check_plan_limit — cujo EXECUTE a SEC-002 revogou — voltou a ser chamada em:\n  ${chamadas.join("\n  ")}`
  );
});

// ── 3. INTERRUPTOR INSEGURO ────────────────────────────────────────────────

test("LR-06: o interruptor que dispensava a assinatura do webhook não existe", () => {
  // O nome literal não é reproduzido aqui: ele é montado, para que a própria
  // guarda não seja o último lugar do repositório onde o interruptor aparece.
  const nome = ["ALLOW", "INSECURE", "BILLING", "WEBHOOKS"].join("_");
  const alvos = [...fontesDeSrc(), ".env.example"];
  const sobreviventes = alvos.filter((a) => existe(a) && ler(a).includes(nome));
  assert.deepEqual(
    sobreviventes,
    [],
    `o interruptor inseguro reapareceu em:\n  ${sobreviventes.join("\n  ")}`
  );
});

// ── 4. SELEÇÃO DE PROVIDER ─────────────────────────────────────────────────

test("LR-07: o provider é escolhido por seletor, nunca por presença de secret", () => {
  const src = executavel("src/lib/billing/registry.ts");

  assert.match(src, /BILLING_PROVIDER/, "o seletor explícito sumiu do registry");
  assert.match(
    src,
    /PROVIDERS_DE_COBRANCA = Object\.freeze\(\["mock", "asaas"\] as const\)/,
    "o conjunto de providers aceitos deixou de ser fechado"
  );

  // Nenhum `if` pode ramificar seleção a partir da chave.
  assert.doesNotMatch(
    src,
    /if\s*\([^)]*ASAAS_API_KEY[^)]*\)\s*\{?\s*return/,
    "a presença de ASAAS_API_KEY voltou a selecionar o provider"
  );
  assert.doesNotMatch(
    src,
    /ALLOW_MOCK_BILLING_PROVIDER/,
    "o opt-in antigo do mock voltou ao registry"
  );
});

test("LR-08: não há fallback automático em direção alguma", () => {
  const src = executavel("src/lib/billing/registry.ts");
  const iResolve = src.indexOf("export function resolveBillingProvider");
  assert.ok(iResolve > 0, "resolveBillingProvider sumiu");
  const corpo = src.slice(iResolve, src.indexOf("\n}\n", iResolve));

  // O mock só pode nascer dentro do ramo do seletor.
  const iRamo = corpo.indexOf('escolhido === "mock"');
  assert.ok(iRamo > 0, "o ramo do seletor para o mock sumiu");
  const depoisDoRamo = corpo.slice(iRamo + corpo.slice(iRamo).indexOf("\n  }"));
  assert.doesNotMatch(
    depoisDoRamo,
    /new BillingProviderMock/,
    "fallback para o mock depois do ramo do seletor"
  );

  // E o caminho do Asaas não pode devolver provider sem validar configuração.
  const iAsaas = corpo.indexOf("exigirConfiguracaoDoAsaas");
  assert.ok(iAsaas > iRamo, "a validação da configuração do Asaas sumiu ou mudou de lugar");
});

test("LR-09: ausência e valor desconhecido do seletor REPROVAM", () => {
  const src = executavel("src/lib/billing/registry.ts");
  const iSel = src.indexOf("export function seletorDeProvider");
  assert.ok(iSel > 0, "seletorDeProvider sumiu");
  const corpo = src.slice(iSel, src.indexOf("\n}\n", iSel));

  const throws = (corpo.match(/throw new BillingProviderNotConfiguredError/g) ?? []).length;
  assert.ok(
    throws >= 2,
    `seletorDeProvider tem ${throws} recusa(s); precisa de duas — ausente e desconhecido`
  );
  assert.match(corpo, /bruto === ""/, "a ausência do seletor deixou de reprovar");
  assert.match(corpo, /includes\(bruto\)/, "o valor desconhecido deixou de reprovar");
  assert.doesNotMatch(corpo, /\?\?\s*"mock"|\|\|\s*"mock"/, "o seletor ganhou um padrão");
});

test("LR-10: o erro de configuração não reproduz valor de secret", () => {
  const src = executavel("src/lib/billing/registry.ts");
  // As mensagens podem nomear a VARIÁVEL, nunca interpolar o VALOR.
  assert.doesNotMatch(
    src,
    /\$\{[^}]*ASAAS_API_KEY[^}]*\}/,
    "a mensagem de erro interpola a chave do Asaas"
  );
  assert.doesNotMatch(
    src,
    /\$\{[^}]*ASAAS_WEBHOOK_TOKEN[^}]*\}/,
    "a mensagem de erro interpola o token do webhook"
  );
});

// ── 5. O QUE NÃO PODE TER MUDADO ───────────────────────────────────────────

test("LR-11: a jornada comercial continua desligada", () => {
  assert.match(
    ler("src/app/(dashboard)/dashboard/billing/page.tsx"),
    /redirect\("\/dashboard"\)/,
    "a página de billing deixou de redirecionar"
  );
  assert.ok(
    !ler("src/components/dashboard/sidebar-nav.tsx").includes("/dashboard/billing"),
    "a sidebar ganhou entrada de billing"
  );
  assert.doesNotMatch(ler("src/app/page.tsx"), /R\$|\bpre[çc]o/i, "a landing passou a citar preço");
});

test("LR-12: as cinco tabelas legadas continuam declaradas na migration histórica", () => {
  // A aposentadoria é do CÓDIGO, não do dado. Se alguém tentar antecipar a
  // remoção física por aqui, esta asserção reprova: tirar tabela é migration
  // própria, com rollback e rodada de aplicação.
  const historica = ler("supabase/migrations/20260724161707_create_billing_tables_only.sql");
  const ausentes = TABELAS_LEGADAS.filter((t) => !historica.includes(`public.${t}`));
  assert.deepEqual(
    ausentes,
    [],
    `a migration histórica foi alterada; tabela(s) ausente(s): ${ausentes.join(", ")}`
  );
});

test("LR-13: a guarda roda na suíte de reconciliação", () => {
  const pkg = JSON.parse(ler("package.json"));
  assert.match(
    pkg.scripts["test:reconciliation"],
    /tests\/billing-legacy-retirement-guard\.mjs/,
    "a guarda da 12C.0 saiu do verify — uma guarda que não roda não é guarda"
  );
});

// ─── Fim ────────────────────────────────────────────────────────────────────

console.log("");
console.log(`Billing legacy retirement guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
