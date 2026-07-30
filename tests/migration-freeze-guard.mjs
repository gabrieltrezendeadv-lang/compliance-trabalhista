/**
 * GUARDA DO HISTÓRICO DE MIGRATIONS
 *
 * Impede que uma execução automática de `supabase db push` — ou de qualquer
 * outro comando que escreva no histórico de migrations, ou que abra conexão
 * direta ao banco remoto — seja introduzida em workflow, script ou
 * package.json.
 *
 * CONTEXTO (atualizado na Fase 3): supabase/migrations/ agora contém as 36
 * versões efetivamente aplicadas, com prefixos idênticos aos do histórico
 * remoto. A divergência que existia — 13 arquivos com versões ausentes do
 * banco — foi reconciliada. Ver supabase/migrations/README.md e
 * supabase/history/pre-reconciliation/README.md.
 *
 * A reconciliação NÃO relaxa as proibições. Ela remove a divergência que
 * existia; não estabelece que aplicar migration automaticamente passou a ser
 * seguro. `db push`, `migration repair`, `migration up` e `migration fetch`
 * seguem proibidos, e agora sem nenhuma exceção nominal — a da Fase 2 foi
 * removida junto com o workflow temporário que a justificava.
 *
 * Executado por `npm run test:reconciliation`, portanto por `npm run verify`,
 * portanto pelo check obrigatório `Verify` da branch main.
 *
 * ── LIMITE DESTA GUARDA ─────────────────────────────────────────────────────
 *
 * Ela inspeciona texto de configuração de automação e nomes de arquivo. Não é
 * substituto de teste de comportamento, e não torna a reintrodução do risco
 * impossível: alguém pode alterar manifesto e arquivos na mesma mudança, ou
 * aplicar migration por fora do repositório — foi assim, aliás, que as 36
 * originais entraram no banco. O que ela garante é que a reintrodução seja
 * detectável e ruidosa.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "./lib/manifest.mjs";
import { classificarMigrations, resumo } from "./lib/migrations.mjs";

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

// ── MF-01: `db push` — proibido em toda automação, MENOS na rota autorizada ──
//
// Durante o congelamento (Fases 2 a 6A) a proibição era absoluta, porque não
// existia rota de aplicação: qualquer `db push` no repositório só poderia ser
// um caminho não revisado até o banco de produção.
//
// A Fase 6B.1 criou a rota — e ela precisa, por definição, do comando proibido.
// A exceção é NOMINAL e ÚNICA: um arquivo, listado abaixo. Fora dele a regra
// segue absoluta.
//
// A troca não é "proibição por permissão". É "proibição em todo lugar" por
// "proibição em todo lugar, menos num arquivo que tem quinze asserções próprias
// (tests/migration-apply-guard.mjs), exige aprovação humana por environment
// protegido, só roda a partir da main e recusa qualquer versão da faixa
// congelada". MF-25 garante que a exceção não se espalhe e que o arquivo
// isentado continue sendo aquilo.
const ROTA_AUTORIZADA = ".github/workflows/migration-apply.yml";

/** Como findInAutomation, ignorando um arquivo com exceção nominal. */
function findInAutomationExceto(pattern, isento) {
  return findInAutomation(pattern).filter(
    (hit) => !hit.startsWith(isento.replace(/\//g, path.sep)) && !hit.startsWith(isento)
  );
}

test("MF-01: nenhuma automação executa `supabase db push`, exceto a rota autorizada", () => {
  const hits = findInAutomationExceto(/supabase\s+db\s+push/, ROTA_AUTORIZADA);
  assert.deepEqual(
    hits,
    [],
    `db push fora da rota autorizada (${ROTA_AUTORIZADA}):\n  ${hits.join("\n  ")}`
  );
});

test("MF-25: a exceção de `db push` é única, e o arquivo isentado continua protegido", () => {
  // 1. Nenhum OUTRO arquivo de automação usa db push.
  const fora = findInAutomationExceto(/supabase\s+db\s+push/, ROTA_AUTORIZADA);
  assert.deepEqual(fora, [], "a exceção nominal se espalhou para outros arquivos");

  // 2. O arquivo isentado tem de existir. Se for removido, a exceção perde
  //    sentido e a regra volta a ser absoluta — isto reprova antes.
  const rota = path.join(root, ROTA_AUTORIZADA);
  assert.ok(fs.existsSync(rota), `${ROTA_AUTORIZADA} não existe — remova também a exceção`);

  // 3. E tem de continuar sendo o que justificou a exceção.
  const wf = fs.readFileSync(rota, "utf8").replace(/\r\n?/g, "\n");
  const executavel = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  assert.match(executavel, /environment:\s*db-production/, "a rota perdeu o environment protegido");
  assert.match(executavel, /--dry-run/, "a rota perdeu o dry-run obrigatório");
  assert.match(executavel, /needs:\s*preflight/, "a rota perdeu a dependência do preflight");
  assert.match(
    executavel,
    /GITHUB_REF" != "refs\/heads\/main"/,
    "a rota perdeu a restrição à main"
  );
  assert.match(
    executavel,
    /assert-apply-preconditions\.mjs/,
    "a rota perdeu a verificação de pré-condições"
  );
  assert.doesNotMatch(executavel, /^\s{2}push:/m, "a rota ganhou gatilho automático");
  assert.doesNotMatch(executavel, /^\s{2}pull_request:/m, "a rota ganhou gatilho automático");

  // 4. A guarda específica da rota tem de existir e ser executada pelo verify.
  const guarda = "tests/migration-apply-guard.mjs";
  assert.ok(fs.existsSync(path.join(root, guarda)), `${guarda} não existe`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(
    pkg.scripts["test:reconciliation"].includes(guarda),
    `${guarda} não está no test:reconciliation — a exceção ficaria sem vigilância`
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

// ── MF-04: `migration fetch`, `--linked` e senha em URI — sem exceção ────────
//
// A Fase 2 abrira uma exceção nominal para um workflow temporário, que precisava
// de exatamente uma invocação de `supabase migration fetch`. Aquele workflow
// falhou nas três tentativas; a recuperação das 36 migrations saiu por leitura
// de `supabase_migrations.schema_migrations` via conector, sem CLI e sem secret.
//
// Cumprida a função — ou, no caso, dispensada —, o workflow foi removido na
// Fase 3 e a exceção com ele. Deixá-lo seria manter no repositório um caminho de
// conexão direta ao banco de produção sem finalidade.
//
// Três regras, todas válidas em qualquer arquivo de automação:
//   1. `supabase migration fetch` — proibido;
//   2. `--linked` — proibido (exige `supabase link` e access token, ampliando o
//      alcance da credencial muito além de uma leitura);
//   3. senha embutida em URI postgres — proibida. Esta regra ficava dentro do
//      ramo autorizado de fetch; agora vale por si, para qualquer linha.

/**
 * Avalia conexão direta ao banco em automação e devolve as violações.
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

    for (const { n, text } of linhas) {
      if (/supabase\s+migration\s+fetch/.test(text)) {
        violacoes.push(
          `${file}:${n} invoca migration fetch (proibido — a exceção da Fase 2 foi removida)`
        );
      }
      if (/--linked\b/.test(text)) {
        violacoes.push(`${file}:${n} usa --linked (proibido)`);
      }
      // `postgresql://usuario:senha@host` → proibido.
      // `postgresql://usuario@host`       → permitido.
      if (/postgres(ql)?:\/\/[^:/@\s"']+:[^@\s"']+@/.test(text)) {
        violacoes.push(
          `${file}:${n} embute senha na URI — use SUPABASE_DB_PASSWORD`
        );
      }
    }
  }

  return violacoes;
}

test("MF-04: nenhuma automação invoca migration fetch, --linked ou URI com senha", () => {
  const entradas = FILES.map((file) => ({
    file,
    content: fs.readFileSync(path.join(root, file), "utf8"),
  }));

  const violacoes = violacoesDeFetch(entradas);
  assert.deepEqual(
    violacoes,
    [],
    `conexão direta ao banco em automação:\n  ${violacoes.join("\n  ")}`
  );
});

test("MF-04b: o workflow temporário da Fase 2 não existe mais", () => {
  const temporario = path.join(
    root,
    ".github/workflows/recover-migrations-temp.yml"
  );
  assert.equal(
    fs.existsSync(temporario),
    false,
    "recover-migrations-temp.yml deveria ter sido removido na Fase 3"
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

test("MF-07: o README documenta a reconciliação e mantém db push proibido", () => {
  const readme = path.join(root, "supabase/migrations/README.md");
  assert.ok(fs.existsSync(readme), "supabase/migrations/README.md ausente");

  const content = fs.readFileSync(readme, "utf8");
  // O congelamento da Fase 1 deu lugar ao histórico reconciliado.
  assert.match(content, /reconciliad/i, "o README deve descrever a reconciliação");
  assert.match(content, /36/, "o README deve declarar as 36 versões");
  // As proibições permanecem, e o README precisa dizê-lo.
  assert.match(content, /supabase db push/);
  assert.match(
    content,
    /Continuam proibidos/,
    "o README deve deixar explícito que a reconciliação não relaxa as proibições"
  );

  // O README anterior apontava para os 13 arquivos; agora precisa apontar para
  // onde eles foram preservados.
  const historico = path.join(
    root,
    "supabase/history/pre-reconciliation/README.md"
  );
  assert.ok(fs.existsSync(historico), "README da pasta histórica ausente");
});

// ── Conjunto canônico de arquivos ────────────────────────────────────────────
//
// Três asserções com propósitos distintos e deliberadamente redundantes:
//   MF-08 — lista literal: pega remoção e renomeação;
//   MF-18 — propriedade de prefixo: pega arquivo novo com versão inventada;
//   MF-19 — bijeção com o manifesto: pega ausência e duplicidade.
//
// MF-18 e MF-19 verificam propriedade em vez de lista, então sobrevivem a
// mudanças legítimas do conjunto. MF-08 não sobrevive — e é essa rigidez que a
// torna útil: alterar o conjunto exige alterar a lista de forma explícita.

/** Os 36 arquivos canônicos: `<version>_<name>.sql` conforme gravado no banco. */
const CANONICOS = [
  "20260724013538_foundation.sql",
  "20260724014530_onboarding_function.sql",
  "20260724120859_create_evidence_tables.sql",
  "20260724121010_evidence_security_definer_functions.sql",
  "20260724121902_create_complaint_tables.sql",
  "20260724122001_complaint_security_definer_functions.sql",
  "20260724122058_create_campaign_tables.sql",
  "20260724122324_campaign_security_definer_functions.sql",
  "20260724123308_create_profiles_table.sql",
  "20260724123926_assessment_tables.sql",
  "20260724124015_assessment_functions.sql",
  "20260724130400_migrate_pin_to_bcrypt.sql",
  "20260724133019_fix_rls_recursion_complaint_investigators.sql",
  "20260724134828_create_risk_inventory_tables.sql",
  "20260724134918_risk_inventory_functions.sql",
  "20260724160830_create_webhook_events_table.sql",
  "20260724161323_add_trialing_to_subscription_status.sql",
  "20260724161707_create_billing_tables_only.sql",
  "20260724161734_create_billing_functions.sql",
  "20260726004007_sec001_revoke_public_execute_regrant.sql",
  "20260726004028_sec002_check_plan_limit_derive_tenant.sql",
  "20260726004116_sec003_complaint_pin_bcrypt_ratelimit.sql",
  "20260726004137_sec004_remove_member_rpc.sql",
  "20260726004204_sec005_campaign_employee_profiles.sql",
  "20260726004230_sec006_webhook_transactional_idempotent.sql",
  "20260728005535_sec_block1_expand.sql",
  "20260728010455_sec_block1_contract.sql",
  "20260728190937_20260728150000_fix_001_evidence_reports.sql",
  "20260728191019_20260728151000_fix_003_reverse_scoring.sql",
  "20260728191046_20260728152000_fix_004_assessment_submission.sql",
  "20260728191110_20260728152500_priv_001_anonymous_assessments_ddl.sql",
  "20260728191144_20260728152500_priv_001_anonymous_assessments_fns1.sql",
  "20260728191241_20260728152500_priv_001_anonymous_assessments_fns2_grants.sql",
  "20260728191255_20260728153000_sec_006_table_privileges.sql",
  "20260728191311_20260728154500_sec_002_retire_plan_limit.sql",
  "20260728191324_20260728155000_fix_005_close_expired_cycles.sql",
];

/** Arquivos `.sql` de supabase/migrations, ordenados. */
function migrationsNoDisco() {
  return fs
    .readdirSync(path.join(root, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Versões registradas no manifesto versionado. */
function versoesDoManifesto() {
  const tsv = path.join(root, "supabase/baseline/applied-migrations.tsv");
  return parseManifest(fs.readFileSync(tsv, "utf8")).map((r) => r.version);
}

/** Classificação em históricas congeladas × forward-only. */
function classificacao() {
  return classificarMigrations(
    path.join(root, "supabase/migrations"),
    versoesDoManifesto()
  );
}

test("MF-08: as 36 históricas são exatamente o conjunto canônico", () => {
  // A lista literal permanece, e continua sendo a asserção rígida: alterar o
  // conjunto histórico exige alterar esta lista de forma explícita. O que mudou
  // é que ela é comparada contra as HISTÓRICAS, e não contra o diretório todo —
  // do contrário nenhuma migration forward-only poderia mais ser criada.
  const c = classificacao();
  assert.deepEqual(
    c.historicas.map((h) => h.arquivo),
    CANONICOS,
    "o conjunto histórico mudou — ver supabase/migrations/README.md"
  );
  console.log(`       (${resumo(c)})`);
});

test("MF-08b: nenhuma migration forward-only invade a faixa congelada", () => {
  const c = classificacao();
  assert.deepEqual(
    c.problemas,
    [],
    `classificação das migrations reprovada:\n  ${c.problemas.join("\n  ")}`
  );
  for (const f of c.forwardOnly) {
    assert.ok(
      f.version > c.limiteCongelado,
      `${f.arquivo}: versão ${f.version} não é posterior à última histórica ${c.limiteCongelado}`
    );
  }
  console.log(
    `       (${c.forwardOnly.length} forward-only, todas depois de ${c.limiteCongelado})`
  );
});

test("MF-18: todo prefixo em supabase/migrations é histórico OU posterior à faixa congelada", () => {
  // Regra anterior: "nenhuma versão fora do manifesto". Insustentável a partir
  // da primeira migration forward-only. Regra atual: nenhuma versão fora do
  // manifesto DENTRO OU ANTES da faixa congelada — que é a condição que tornava
  // `db push` perigoso, e continua reprovada.
  const doManifesto = new Set(versoesDoManifesto());
  const limite = [...doManifesto].sort().at(-1);
  const forasteiros = [];

  for (const arquivo of migrationsNoDisco()) {
    const m = arquivo.match(/^(\d{14})_/);
    if (!m) {
      forasteiros.push(`${arquivo}: nome não começa com 14 dígitos`);
      continue;
    }
    if (!doManifesto.has(m[1]) && m[1] <= limite) {
      forasteiros.push(
        `${arquivo}: versão ${m[1]} não consta de applied-migrations.tsv e não é ` +
          `posterior à última histórica ${limite} — intercalada na faixa congelada`
      );
    }
  }

  assert.deepEqual(
    forasteiros,
    [],
    `migration intercalada no histórico aplicado — era exatamente esta ` +
      `condição que tornava db push perigoso:\n  ${forasteiros.join("\n  ")}`
  );
});

test("MF-19: cada versão do manifesto tem exatamente um arquivo", () => {
  const arquivos = migrationsNoDisco();
  const problemas = [];

  for (const version of versoesDoManifesto()) {
    const correspondentes = arquivos.filter((f) => f.startsWith(`${version}_`));
    if (correspondentes.length !== 1) {
      problemas.push(
        `${version}: ${correspondentes.length} arquivo(s)` +
          (correspondentes.length ? ` → ${correspondentes.join(", ")}` : "")
      );
    }
  }

  assert.deepEqual(
    problemas,
    [],
    `correspondência manifesto ↔ arquivo quebrada:\n  ${problemas.join("\n  ")}`
  );

  const c = classificacao();
  assert.equal(
    c.historicas.length,
    versoesDoManifesto().length,
    "o número de migrations históricas divergiu do manifesto"
  );
  assert.equal(
    arquivos.length,
    c.historicas.length + c.forwardOnly.length,
    "há arquivo em supabase/migrations que não é histórico nem forward-only"
  );
});

test("MF-22: o manifesto NÃO registra as migrations forward-only", () => {
  // applied-migrations.tsv é o que o banco remoto aplicou. Acrescentar ali uma
  // migration só porque ela existe no repositório seria afirmar uma aplicação
  // que não ocorreu — e o md5_norm dessa linha viraria ficção.
  const c = classificacao();
  const doManifesto = new Set(versoesDoManifesto());
  for (const f of c.forwardOnly) {
    assert.equal(
      doManifesto.has(f.version),
      false,
      `${f.arquivo} é forward-only mas consta de applied-migrations.tsv — o ` +
        `manifesto passou a afirmar uma aplicação remota que não ocorreu`
    );
  }
  assert.equal(doManifesto.size, 36, "o manifesto deixou de ter 36 versões");
});

test("MF-17: supabase/checks contém apenas leitura", () => {
  const dir = path.join(root, "supabase/checks");
  assert.ok(fs.existsSync(dir), "supabase/checks ausente");

  const escrita =
    /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|DROP\s+|CREATE\s+|ALTER\s+|GRANT\s+|REVOKE\s+|TRUNCATE\s+)/i;
  const violacoes = [];

  const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  assert.ok(sql.length > 0, "supabase/checks não tem nenhum .sql");

  for (const arquivo of sql) {
    const conteudo = fs.readFileSync(path.join(dir, arquivo), "utf8");
    // Remove comentários antes de avaliar: o cabeçalho de cada arquivo cita a
    // migration de origem e pode conter palavras de DDL em prosa.
    const semComentario = conteudo
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ");

    if (escrita.test(semComentario)) {
      violacoes.push(`${arquivo}: contém comando de escrita`);
    }
    if (!/\bSELECT\b/i.test(semComentario)) {
      violacoes.push(`${arquivo}: nenhum SELECT — arquivo sem propósito aqui`);
    }
  }

  assert.deepEqual(
    violacoes,
    [],
    `supabase/checks deve ser somente leitura:\n  ${violacoes.join("\n  ")}`
  );
  console.log(`       (${sql.length} arquivo(s) de verificação, todos leitura)`);
});

test("MF-20: os 13 arquivos anteriores estão preservados fora de migrations", () => {
  const dir = path.join(root, "supabase/history/pre-reconciliation");
  const sql = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  assert.equal(sql.length, 13, `esperados 13 arquivos preservados, ${sql.length}`);

  // Nenhum deles deve ter voltado para supabase/migrations.
  const emMigrations = new Set(migrationsNoDisco());
  for (const arquivo of sql) {
    assert.equal(
      emMigrations.has(arquivo),
      false,
      `${arquivo} reapareceu em supabase/migrations`
    );
  }
});

// ── Testes negativos da própria guarda ───────────────────────────────────────
//
// Uma guarda que nunca reprova nada é indistinguível de guarda ausente. Os
// casos abaixo alimentam `violacoesDeFetch` com entradas sintéticas e exigem
// que ela ACUSE a violação. Nada é escrito no disco.

/** Envelope de workflow: só para deixar as fixtures legíveis. */
const wf = (run, gatilho = "on:\n  workflow_dispatch:\n") =>
  `${gatilho}jobs:\n  x:\n    steps:\n      - run: ${run}\n`;

test("MF-09: fetch com --linked é reprovado, e por dois motivos", () => {
  const v = violacoesDeFetch([
    { file: ".github/workflows/qualquer.yml", content: wf("supabase migration fetch --linked") },
  ]);
  assert.ok(
    v.some((m) => m.includes("--linked")),
    `deveria citar --linked: ${JSON.stringify(v)}`
  );
  assert.ok(
    v.some((m) => m.includes("migration fetch")),
    `deveria citar migration fetch: ${JSON.stringify(v)}`
  );
});

test("MF-10: fetch é reprovado em qualquer arquivo, sem exceção nominal", () => {
  // Antes da Fase 3 havia um arquivo autorizado. Não há mais: o caminho que
  // era exceção agora deve ser reprovado como qualquer outro.
  const v = violacoesDeFetch([
    {
      file: ".github/workflows/recover-migrations-temp.yml",
      content: wf(`supabase migration fetch --db-url "postgresql://user@host:5432/postgres"`),
    },
  ]);
  assert.ok(
    v.some((m) => m.includes("migration fetch")),
    `o antigo arquivo autorizado deveria ser reprovado agora: ${JSON.stringify(v)}`
  );
});

test("MF-11: fetch com --db-url não escapa da proibição", () => {
  const v = violacoesDeFetch([
    {
      file: ".github/workflows/ci.yml",
      content: wf(`supabase migration fetch --db-url "$DB"`),
    },
  ]);
  assert.ok(
    v.some((m) => m.includes("migration fetch")),
    `--db-url não deveria absolver o fetch: ${JSON.stringify(v)}`
  );
});

test("MF-12: fetch com workflow_dispatch não escapa da proibição", () => {
  const manual = violacoesDeFetch([
    { file: ".github/workflows/a.yml", content: wf("supabase migration fetch") },
  ]);
  const automatico = violacoesDeFetch([
    {
      file: ".github/workflows/b.yml",
      content: wf("supabase migration fetch", "on:\n  push:\n    branches: [main]\n"),
    },
  ]);
  assert.ok(manual.length > 0, "disparo manual não deveria absolver o fetch");
  assert.ok(automatico.length > 0, "disparo automático deveria ser reprovado");
});

test("MF-13: automação sem fetch, sem --linked e sem senha é aprovada", () => {
  const v = violacoesDeFetch([
    {
      file: ".github/workflows/baseline-verify.yml",
      content: wf('psql "$DB_URL" -f supabase/baseline/schema.sql'),
    },
  ]);
  assert.deepEqual(v, [], `caso legítimo não deveria ser acusado: ${JSON.stringify(v)}`);
});

test("MF-14: --linked é reprovado mesmo sem fetch na linha", () => {
  const v = violacoesDeFetch([
    { file: ".github/workflows/ci.yml", content: wf("supabase db reset --linked") },
  ]);
  assert.ok(
    v.some((m) => m.includes("--linked")),
    `deveria acusar --linked isolado: ${JSON.stringify(v)}`
  );
});

test("MF-15: senha em URI é reprovada mesmo sem fetch na linha", () => {
  // Esta regra ficava dentro do ramo autorizado de fetch. Agora vale por si:
  // qualquer linha de automação que embuta senha numa URI postgres é violação.
  const v = violacoesDeFetch([
    {
      file: ".github/workflows/ci.yml",
      content: wf('psql "postgresql://postgres.abc:senha123@host:5432/postgres" -c "select 1"'),
    },
  ]);
  assert.ok(
    v.some((m) => m.includes("embute senha na URI")),
    `deveria acusar senha na URI fora de fetch: ${JSON.stringify(v)}`
  );
});

test("MF-16: URI sem senha é aprovada", () => {
  const v = violacoesDeFetch([
    {
      file: ".github/workflows/ci.yml",
      content: wf('psql "postgresql://postgres.abc@host:5432/postgres" -c "select 1"'),
    },
  ]);
  assert.deepEqual(v, [], `URI sem senha não deveria ser acusada: ${JSON.stringify(v)}`);
});

test("MF-21: MF-18 acusa intercalação e absolve forward-only — sem tocar no disco", () => {
  // Prova que a propriedade de prefixo tem dente, e que tem o dente CERTO.
  //
  // A regra mudou na Fase 5: antes era "nenhuma versão fora do manifesto", o
  // que impediria qualquer migration nova. Agora é "nenhuma versão fora do
  // manifesto dentro ou antes da faixa congelada". Este teste replica a lógica
  // exata de MF-18 sobre entradas sintéticas — MF-18 lê o diretório real — e
  // exige que ela reprove a intercalação E aprove a forward-only legítima.
  //
  // Aprovar a forward-only é metade do teste: uma regra que reprovasse tudo
  // passaria numa verificação que só procura reprovações.
  const doManifesto = new Set(["20260724013538", "20260728191324"]);
  const limite = [...doManifesto].sort().at(-1);
  const candidatos = [
    "20260724013538_foundation.sql", // histórica
    "20260728191324_fix_005.sql", // histórica, a última da faixa
    "20260730123613_forward_only.sql", // posterior à faixa → legítima
    "20260727000000_intercalada.sql", // dentro da faixa, fora do manifesto → violação
    "20260101000000_anterior.sql", // antes da faixa, fora do manifesto → violação
    "sem_prefixo.sql", // nome inválido → violação
  ];

  const forasteiros = candidatos.filter((arquivo) => {
    const m = arquivo.match(/^(\d{14})_/);
    if (!m) return true;
    return !doManifesto.has(m[1]) && m[1] <= limite;
  });

  assert.deepEqual(forasteiros, [
    "20260727000000_intercalada.sql",
    "20260101000000_anterior.sql",
    "sem_prefixo.sql",
  ]);
});

// ── Resumo ───────────────────────────────────────────────────────────────────

console.log("");
console.log(`Migration freeze guard: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
