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

// ── MF-04: `migration fetch` — exceção única e delimitada ────────────────────
//
// A Fase 2 (recuperação canônica das 36 migrations) precisa de exatamente uma
// invocação de `supabase migration fetch`. A exceção é estreita de propósito:
// vale só para o workflow da Fase 2, só com `--db-url`, só em disparo manual.
//
// `--linked` continua proibido em qualquer lugar: ele exige `supabase link` e
// um access token, ampliando o alcance da credencial muito além de uma leitura.

/** Caminho do único arquivo autorizado a invocar `migration fetch`. */
const FETCH_AUTORIZADO = ".github/workflows/recover-migrations-temp.yml";

/**
 * Avalia invocações de `migration fetch` e devolve as violações.
 *
 * Recebe entradas sintéticas — `[{ file, content }]` — para poder ser exercida
 * por testes negativos sem tocar no sistema de arquivos.
 */
export function violacoesDeFetch(entradas) {
  const violacoes = [];

  for (const { file, content } of entradas) {
    const linhas = content
      .split("\n")
      .map((text, i) => ({ n: i + 1, text }))
      .filter(({ text }) => {
        const t = text.trim();
        return t !== "" && !t.startsWith("#") && !t.startsWith("//");
      });

    // `--linked` é proibido em qualquer arquivo, com ou sem fetch.
    for (const { n, text } of linhas) {
      if (/--linked\b/.test(text)) {
        violacoes.push(`${file}:${n} usa --linked (proibido)`);
      }
    }

    const normalizado = file.split("\\").join("/");
    const fetches = linhas.filter(({ text }) =>
      /supabase\s+migration\s+fetch/.test(text)
    );
    if (fetches.length === 0) continue;

    if (normalizado !== FETCH_AUTORIZADO) {
      for (const { n } of fetches) {
        violacoes.push(
          `${file}:${n} invoca migration fetch fora de ${FETCH_AUTORIZADO}`
        );
      }
      continue;
    }

    // No arquivo autorizado: exigir --db-url e disparo manual.
    for (const { n, text } of fetches) {
      if (!/--db-url\b/.test(text)) {
        violacoes.push(`${file}:${n} invoca migration fetch sem --db-url`);
      }
    }
    if (!/workflow_dispatch/.test(content)) {
      violacoes.push(`${file} invoca migration fetch sem workflow_dispatch`);
    }
  }

  return violacoes;
}

test("MF-04: `migration fetch` só no workflow da Fase 2, com --db-url e manual", () => {
  const entradas = FILES.map((file) => ({
    file,
    content: fs.readFileSync(path.join(root, file), "utf8"),
  }));

  const violacoes = violacoesDeFetch(entradas);
  assert.deepEqual(
    violacoes,
    [],
    `uso indevido de migration fetch ou --linked:\n  ${violacoes.join("\n  ")}`
  );
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

// ── Testes negativos da própria guarda ───────────────────────────────────────
//
// Uma guarda que nunca reprova nada é indistinguível de guarda ausente. Os
// casos abaixo alimentam `violacoesDeFetch` com entradas sintéticas e exigem
// que ela ACUSE a violação. Nada é escrito no disco.

const WF_OK = `on:\n  workflow_dispatch:\njobs:\n  x:\n    steps:\n      - run: supabase migration fetch --db-url "$SUPABASE_DB_URL_FETCH"\n`;

test("MF-09: fetch com --linked é reprovado, mesmo no workflow autorizado", () => {
  const v = violacoesDeFetch([
    {
      file: FETCH_AUTORIZADO,
      content: `on:\n  workflow_dispatch:\njobs:\n  x:\n    steps:\n      - run: supabase migration fetch --linked\n`,
    },
  ]);
  assert.ok(v.length > 0, "deveria acusar --linked");
  assert.ok(
    v.some((m) => m.includes("--linked")),
    `mensagem deveria citar --linked: ${JSON.stringify(v)}`
  );
});

test("MF-10: fetch fora do workflow autorizado é reprovado", () => {
  const v = violacoesDeFetch([
    { file: ".github/workflows/ci.yml", content: WF_OK },
  ]);
  assert.ok(v.length > 0, "deveria acusar fetch em arquivo não autorizado");
  assert.ok(
    v.some((m) => m.includes("fora de")),
    `mensagem deveria dizer que está fora do arquivo autorizado: ${JSON.stringify(v)}`
  );
});

test("MF-11: fetch sem --db-url é reprovado", () => {
  const v = violacoesDeFetch([
    {
      file: FETCH_AUTORIZADO,
      content: `on:\n  workflow_dispatch:\njobs:\n  x:\n    steps:\n      - run: supabase migration fetch\n`,
    },
  ]);
  assert.ok(
    v.some((m) => m.includes("sem --db-url")),
    `deveria exigir --db-url: ${JSON.stringify(v)}`
  );
});

test("MF-12: fetch sem workflow_dispatch é reprovado", () => {
  const v = violacoesDeFetch([
    {
      file: FETCH_AUTORIZADO,
      content: `on:\n  push:\n    branches: [main]\njobs:\n  x:\n    steps:\n      - run: supabase migration fetch --db-url "$X"\n`,
    },
  ]);
  assert.ok(
    v.some((m) => m.includes("workflow_dispatch")),
    `deveria exigir workflow_dispatch: ${JSON.stringify(v)}`
  );
});

test("MF-13: o caso legítimo da Fase 2 é aprovado", () => {
  const v = violacoesDeFetch([{ file: FETCH_AUTORIZADO, content: WF_OK }]);
  assert.deepEqual(v, [], `não deveria acusar o caso válido: ${JSON.stringify(v)}`);
});

test("MF-14: --linked é reprovado em qualquer arquivo, mesmo sem fetch", () => {
  const v = violacoesDeFetch([
    {
      file: ".github/workflows/ci.yml",
      content: `jobs:\n  x:\n    steps:\n      - run: supabase db reset --linked\n`,
    },
  ]);
  assert.ok(
    v.some((m) => m.includes("--linked")),
    `deveria acusar --linked isolado: ${JSON.stringify(v)}`
  );
});

// ── Resumo ───────────────────────────────────────────────────────────────────

console.log("");
console.log(`Migration freeze guard: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
