/**
 * GUARDA DO CONGELAMENTO DE MIGRATIONS
 *
 * Impede que uma execução automática de `supabase db push` — ou de qualquer
 * outro comando que escreva no histórico de migrations — seja introduzida em
 * workflow, script ou package.json enquanto o congelamento estiver em vigor.
 *
 * CONTEXTO: os 13 arquivos de supabase/migrations/ têm prefixos de versão que
 * não existem no histórico do banco. O Supabase CLI compara por timestamp,
 * então para ele todos os 13 estão pendentes. Um `db push` tentaria aplicá-los
 * contra um banco onde o DDL equivalente já existe.
 * Ver supabase/migrations/README.md.
 *
 * Executado por `npm run test:reconciliation`, portanto por `npm run verify`,
 * portanto pelo check obrigatório `Verify` da branch main.
 *
 * Esta guarda inspeciona texto de configuração de automação — não é
 * substituto de teste de comportamento. É o único meio disponível: o que se
 * quer proibir é a *existência* de um comando em arquivo de automação, não um
 * efeito observável em runtime.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`[FAIL] ${name}: ${error.message}`);
  }
}

/** Coleta arquivos de automação: workflows, scripts de shell e Node. */
function automationFiles() {
  const out = [];
  const roots = [".github", "scripts", "supabase"];
  const exts = new Set([".yml", ".yaml", ".sh", ".ps1", ".mjs", ".cjs", ".js", ".ts"]);

  function walk(dir) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) return;
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(rel);
      } else if (exts.has(path.extname(entry.name))) {
        out.push(rel);
      }
    }
  }

  for (const r of roots) walk(r);
  out.push("package.json");
  if (fs.existsSync(path.join(root, "vercel.json"))) out.push("vercel.json");
  return out;
}

const FILES = automationFiles();

/** Linhas de comando, ignorando comentários de YAML e de shell. */
function commandLines(relPath) {
  const content = fs.readFileSync(path.join(root, relPath), "utf8");
  return content
    .split("\n")
    .map((line, i) => ({ n: i + 1, text: line }))
    .filter(({ text }) => {
      const t = text.trim();
      if (t === "") return false;
      if (t.startsWith("#")) return false; // comentário YAML/shell
      if (t.startsWith("//")) return false; // comentário JS
      if (t.startsWith("*") || t.startsWith("/*")) return false; // bloco JSDoc
      return true;
    });
}

/** Procura um padrão em todos os arquivos de automação. */
function findInAutomation(pattern) {
  const hits = [];
  for (const file of FILES) {
    for (const { n, text } of commandLines(file)) {
      if (pattern.test(text)) hits.push(`${file}:${n} → ${text.trim()}`);
    }
  }
  return hits;
}

// ── Comandos proibidos durante o congelamento ────────────────────────────────

test("MF-01: nenhuma automação executa `supabase db push`", () => {
  const hits = findInAutomation(/supabase\s+db\s+push/);
  assert.deepEqual(
    hits,
    [],
    `db push encontrado (congelamento em vigor):\n  ${hits.join("\n  ")}`
  );
});

test("MF-02: nenhuma automação executa `supabase migration repair`", () => {
  const hits = findInAutomation(/supabase\s+migration\s+repair/);
  assert.deepEqual(hits, [], `migration repair encontrado:\n  ${hits.join("\n  ")}`);
});

test("MF-03: nenhuma automação executa `supabase migration up`", () => {
  const hits = findInAutomation(/supabase\s+migration\s+up\b/);
  assert.deepEqual(hits, [], `migration up encontrado:\n  ${hits.join("\n  ")}`);
});

test("MF-04: nenhuma automação executa `supabase migration fetch`", () => {
  // Proibido até a Fase 2 ser autorizada. Quando for, esta asserção deve ser
  // afrouxada de forma explícita e revisada, nunca removida em silêncio.
  const hits = findInAutomation(/supabase\s+migration\s+fetch/);
  assert.deepEqual(hits, [], `migration fetch encontrado:\n  ${hits.join("\n  ")}`);
});

test("MF-05: nenhuma automação executa `supabase link`", () => {
  // `link` é o que habilita as operações --linked contra o projeto remoto.
  const hits = findInAutomation(/supabase\s+link/);
  assert.deepEqual(hits, [], `supabase link encontrado:\n  ${hits.join("\n  ")}`);
});

// ── `db reset` é permitido, mas só contra a stack local ──────────────────────

test("MF-06: todo `supabase db reset` opera em stack local, nunca no remoto", () => {
  const resets = findInAutomation(/supabase\s+db\s+reset/);

  for (const hit of resets) {
    const [location] = hit.split(" → ");
    const [file] = location.split(":");
    const content = fs.readFileSync(path.join(root, file), "utf8");

    // A stack local é a que obtém DB_URL de `supabase status`.
    assert.ok(
      content.includes("supabase status"),
      `${file} usa db reset sem obter DB_URL de 'supabase status' — pode apontar para o remoto`
    );
    // E não deve referenciar o projeto remoto.
    assert.doesNotMatch(
      content,
      /--linked|--project-ref|tvwgzpgyfdfrbdaeoqzl|pooler\.supabase\.com/,
      `${file} usa db reset e referencia o projeto remoto`
    );
  }

  console.log(`       (${resets.length} uso(s) de db reset, todos em stack local)`);
});

// ── Integridade do congelamento ──────────────────────────────────────────────

test("MF-07: o aviso de congelamento existe e proíbe db push", () => {
  const readme = path.join(root, "supabase/migrations/README.md");
  assert.ok(fs.existsSync(readme), "supabase/migrations/README.md ausente");

  const content = fs.readFileSync(readme, "utf8");
  assert.match(content, /MIGRATIONS CONGELADAS/);
  assert.match(content, /supabase db push/);
});

test("MF-08: o conjunto de migrations não mudou durante o congelamento", () => {
  const dir = path.join(root, "supabase/migrations");
  const sql = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Congelado em 13 arquivos. Adicionar ou remover exige levantar o
  // congelamento de forma explícita, atualizando esta lista.
  const esperados = [
    "20260724130000_create_complaint_tables.sql",
    "20260724140000_complaint_security_definer_functions.sql",
    "20260724150000_create_campaign_tables.sql",
    "20260724160000_campaign_functions.sql",
    "20260727100000_sec_block1_expand.sql",
    "20260727200000_sec_block1_contract.sql",
    "20260728150000_fix_001_evidence_reports.sql",
    "20260728151000_fix_003_reverse_scoring.sql",
    "20260728152000_fix_004_assessment_submission.sql",
    "20260728152500_priv_001_anonymous_assessments.sql",
    "20260728153000_sec_006_table_privileges.sql",
    "20260728154500_sec_002_retire_plan_limit.sql",
    "20260728155000_fix_005_close_expired_cycles.sql",
  ];

  assert.deepEqual(
    sql,
    esperados,
    "o conjunto de migrations mudou — ver supabase/migrations/README.md"
  );
});

// ── Resumo ───────────────────────────────────────────────────────────────────

console.log("");
console.log(`Migration freeze guard: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
