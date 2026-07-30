/**
 * GUARDA ESTÁTICA DO TG-12
 *
 * Asserções que NÃO precisam de banco. Os testes de comportamento — os que
 * realmente provam a resolução determinística — vivem em
 * `scripts/ci/assert-tenant-resolution.sql` e rodam contra o banco descartável
 * do workflow de reconstrução.
 *
 * O que se verifica aqui é o que dá para verificar por texto: que a migration
 * existe e é forward-only, que o rollback existe e restaura o estado anterior,
 * que o estado esperado é reprodutível, e que o `src/` resolve tenant com a
 * MESMA regra da função — o desalinhamento entre aplicação e RLS é justamente
 * o modo como este defeito se manifestaria de novo.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8");

const VERSAO = "20260731094500";
const MIGRATION = `supabase/migrations/${VERSAO}_make_tenant_resolution_deterministic.sql`;
const ROLLBACK = `supabase/rollbacks/${VERSAO}_make_tenant_resolution_deterministic_rollback.sql`;

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

test("TG12-01: a migration existe e é forward-only (posterior à faixa congelada)", () => {
  assert.ok(fs.existsSync(path.join(raiz, MIGRATION)), `${MIGRATION} ausente`);
  assert.ok(VERSAO > "20260728191324", "versão não é posterior à última histórica");
  assert.ok(VERSAO > "20260730123613", "versão deveria ser posterior à forward-only anterior");
});

test("TG12-02: a migration usa CREATE OR REPLACE e preserva as propriedades", () => {
  const sql = ler(MIGRATION);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_resolve_tenant_id\(\)/);
  assert.match(sql, /RETURNS uuid/);
  assert.match(sql, /LANGUAGE sql/);
  assert.match(sql, /\bSTABLE\b/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path TO 'public', 'pg_temp'/);
});

test("TG12-03: a ordenação é total e o filtro de inativa foi mantido", () => {
  const sql = ler(MIGRATION);
  assert.match(sql, /ORDER BY om\.created_at ASC, om\.id ASC/);
  assert.match(sql, /om\.deleted_at IS NULL/);
  assert.match(sql, /FROM public\.organization_members om/, "referência não qualificada por schema");
});

test("TG12-04: a migration não toca policy, índice, constraint ou outra função", () => {
  const sql = ler(MIGRATION).replace(/--[^\n]*/g, " ");
  assert.doesNotMatch(sql, /CREATE\s+POLICY|DROP\s+POLICY|ALTER\s+POLICY/i);
  assert.doesNotMatch(sql, /CREATE\s+(UNIQUE\s+)?INDEX/i);
  assert.doesNotMatch(sql, /ADD\s+CONSTRAINT/i);
  assert.doesNotMatch(sql, /ALTER\s+TABLE/i);
  // A única função criada/substituída é fn_resolve_tenant_id.
  const funcoes = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_.]+)/gi)]
    .map((m) => m[1])
    .filter((n) => !n.startsWith("pg_temp"));
  assert.deepEqual(funcoes, ["public.fn_resolve_tenant_id"]);
});

test("TG12-05: a migration não emite GRANT nem REVOKE (ACL é preservada por CREATE OR REPLACE)", () => {
  const sql = ler(MIGRATION).replace(/--[^\n]*/g, " ");
  assert.doesNotMatch(sql, /^\s*GRANT\s/im);
  assert.doesNotMatch(sql, /^\s*REVOKE\s/im);
});

test("TG12-06: o rollback existe e restaura a definição SEM ORDER BY", () => {
  const sql = ler(ROLLBACK);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.fn_resolve_tenant_id\(\)/);
  const corpo = sql.slice(sql.indexOf("AS $$"), sql.indexOf("$$;") + 3);
  assert.doesNotMatch(corpo, /ORDER\s+BY/i, "o rollback não pode conter ORDER BY");
  assert.match(corpo, /LIMIT 1;/);
  assert.match(sql, /SET search_path TO 'public', 'pg_temp'/);
});

test("TG12-07: o rollback reproduz literalmente o corpo do snapshot", () => {
  const snapshot = ler("supabase/baseline/schema.sql").replace(/\r\n?/g, "\n");
  const corpoSnapshot = `  SELECT tenant_id
  FROM organization_members
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;`;
  assert.ok(
    snapshot.includes(corpoSnapshot),
    "o corpo esperado não foi encontrado em schema.sql — a premissa do rollback mudou"
  );
  assert.ok(
    ler(ROLLBACK).replace(/\r\n?/g, "\n").includes(corpoSnapshot),
    "o rollback não reproduz o corpo do snapshot byte a byte"
  );
});

test("TG12-08: o rollback não desfaz a forward-only anterior", () => {
  // Comentários são removidos antes de avaliar: o cabeçalho do rollback CITA
  // `fn_process_webhook_event` justamente para declarar que não a toca. O que
  // importa é o SQL executável, não a prosa que o explica.
  const executavel = ler(ROLLBACK)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
  assert.doesNotMatch(executavel, /fn_process_webhook_event/);
});

test("TG12-09: 20260730123613 permanece intacta e independente", () => {
  const anterior = ler("supabase/migrations/20260730123613_revoke_public_webhook_execute.sql");
  assert.match(anterior, /REVOKE EXECUTE ON FUNCTION public\.fn_process_webhook_event/);
  assert.doesNotMatch(anterior, /fn_resolve_tenant_id/);
  assert.doesNotMatch(ler(MIGRATION), /fn_process_webhook_event/);
});

test("TG12-10: o manifesto histórico continua com 36 versões e sem a TG-12", () => {
  const tsv = ler("supabase/baseline/applied-migrations.tsv");
  assert.doesNotMatch(tsv, new RegExp(VERSAO), "a TG-12 não pode entrar no manifesto histórico");
  assert.doesNotMatch(tsv, /20260730123613/, "forward-only não entra no manifesto histórico");
});

test("TG12-11: o snapshot histórico não foi alterado", () => {
  // schema.sql tem de continuar com a definição ANTIGA: ele é o registro do
  // estado de 29/07/2026, não um espelho do repositório.
  const snapshot = ler("supabase/baseline/schema.sql");
  const trecho = snapshot.slice(snapshot.indexOf("CREATE FUNCTION public.fn_resolve_tenant_id"));
  const corpo = trecho.slice(0, trecho.indexOf("$$;") + 3);
  assert.doesNotMatch(corpo, /ORDER\s+BY/i, "schema.sql foi alterado — o baseline histórico é imutável");
});

test("TG12-12: o estado esperado existe e contém a definição determinística", () => {
  const esperado = ler("supabase/baseline/schema-after-forward-only.sql");
  const trecho = esperado.slice(esperado.indexOf("CREATE FUNCTION public.fn_resolve_tenant_id"));
  const corpo = trecho.slice(0, trecho.indexOf("$$;") + 3);
  assert.match(corpo, /ORDER BY om\.created_at ASC, om\.id ASC/);
  // O delimitador de corpo tem de ser `$$` — um `$` sozinho indicaria que a
  // geração corrompeu o arquivo (replace com `$$` em string é escape no JS).
  assert.match(trecho, /AS \$\$/, "delimitador de corpo corrompido no estado esperado");
});

test("TG12-13: src/ resolve tenant com a MESMA regra da função", () => {
  const alvos = [
    "src/app/(dashboard)/layout.tsx",
    "src/app/(dashboard)/dashboard/settings/page.tsx",
    "src/lib/assessments/actions.ts",
    "src/lib/billing/actions.ts",
    "src/lib/billing/guard.ts",
    "src/lib/campaigns/actions.ts",
    "src/lib/complaints/actions.ts",
    "src/lib/employees/actions.ts",
    "src/lib/organizations/actions.ts",
    "src/lib/reports/actions.ts",
  ];
  const faltando = [];
  for (const arquivo of alvos) {
    const src = ler(arquivo);
    if (!/\.order\("created_at",\s*\{\s*ascending:\s*true\s*\}\)/.test(src) ||
        !/\.order\("id",\s*\{\s*ascending:\s*true\s*\}\)/.test(src)) {
      faltando.push(arquivo);
    }
  }
  assert.deepEqual(
    faltando,
    [],
    `resolvem tenant sem a ordenação determinística:\n  ${faltando.join("\n  ")}`
  );
});

test("TG12-14: nenhuma resolução de tenant em src/ ficou sem ordenação", () => {
  // Procura o padrão "filtra deleted_at e limita a 1" sem ORDER antes.
  // É verificação de PROPRIEDADE: pega um ponto novo que apareça amanhã.
  const problemas = [];
  const varrer = (dir) => {
    for (const entrada of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entrada.name);
      if (entrada.isDirectory()) varrer(rel);
      else if (/\.(ts|tsx)$/.test(entrada.name)) {
        const texto = fs.readFileSync(path.join(raiz, rel), "utf8").replace(/\r\n?/g, "\n");
        const re = /from\("organization_members"\)[\s\S]{0,400}?\.limit\(1\)/g;
        for (const m of texto.match(re) ?? []) {
          if (!/\.order\("created_at"/.test(m)) problemas.push(`${rel}: seleção limitada a 1 sem ordenação`);
        }
      }
    }
  };
  varrer("src");
  assert.deepEqual(problemas, [], `pontos sem ordenação:\n  ${problemas.join("\n  ")}`);
});

test("TG12-15: nenhuma regex de SQL usa \\b esperando fronteira de palavra", () => {
  // Na ARE do POSIX — a do PostgreSQL — `\b` é o caractere BACKSPACE, não a
  // fronteira de palavra do Perl. A fronteira é `\y`. Um padrão com `\b` exige
  // um backspace literal no texto e NUNCA casa: a asserção reprova sempre,
  // inclusive quando o estado está correto. Foi exatamente assim que a primeira
  // execução da TG-12C falhou.
  //
  // A varredura cobre os arquivos SQL que a TG-12 pode alterar. As 36 históricas
  // e os artefatos de `supabase/history/` e `docs/security/archive/` ficam de
  // fora porque são congelados — nenhum deles usa `\b` hoje (usam `\d` e `\s`,
  // ambos válidos na ARE), e incluí-los daria à guarda o poder de exigir uma
  // alteração que o congelamento proíbe.
  const alvos = [];
  const juntar = (dir, filtro = () => true) => {
    const abs = path.join(raiz, dir);
    if (!fs.existsSync(abs)) return;
    for (const nome of fs.readdirSync(abs)) {
      if (nome.endsWith(".sql") && filtro(nome)) alvos.push(path.join(dir, nome));
    }
  };
  juntar("supabase/migrations", (n) => n.slice(0, 14) > "20260728191324");
  juntar("supabase/rollbacks");
  juntar("scripts/ci");
  alvos.push("supabase/baseline/verify.sql");

  // Comentários saem antes de avaliar — como em TG12-08 e MF-17. Os próprios
  // comentários que explicam esta regra CITAM `\b`; o que a guarda persegue é
  // SQL executável, não a prosa que o documenta.
  const problemas = [];
  for (const arquivo of alvos) {
    ler(arquivo)
      .replace(/\/\*[\s\S]*?\*\//g, (bloco) => bloco.replace(/[^\n]/g, " "))
      .split("\n")
      .map((linha) => linha.replace(/--.*$/, ""))
      .forEach((linha, i) => {
        if (/\\[bB]/.test(linha)) problemas.push(`${arquivo}:${i + 1}: ${linha.trim()}`);
      });
  }
  assert.deepEqual(
    problemas,
    [],
    `use \\y (fronteira de palavra) — \\b é backspace na regex do PostgreSQL:\n  ${problemas.join("\n  ")}`
  );
});

test("TG12-16: a ordenação total é asserida com fronteira de palavra válida", () => {
  for (const arquivo of [MIGRATION, "supabase/baseline/verify.sql"]) {
    const sql = ler(arquivo);
    assert.match(sql, /order\\s\+by\[\^;\]\*\\ycreated_at\\y/, `${arquivo}: falta a asserção de created_at`);
    assert.match(sql, /order\\s\+by\[\^;\]\*\\yid\\y/, `${arquivo}: falta a asserção de id`);
  }
});

console.log("");
console.log(`TG-12 guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
