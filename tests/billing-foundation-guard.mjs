/**
 * GUARDA ESTÁTICA DA FUNDAÇÃO DE BILLING — Etapa 12A
 *
 * Cobre os itens 25, 26 e 27 dos testes obrigatórios (migration forward-only,
 * permissões/RLS, ausência de chamada real ao Asaas) e amarra as propriedades
 * que tornam esta etapa segura, para que nenhuma delas seja removida numa
 * edição distraída.
 *
 * ── O QUE ESTA GUARDA É, E O QUE NÃO É ──────────────────────────────────────
 *
 * É análise de TEXTO. Não substitui os testes de comportamento: a imutabilidade
 * do price snapshot, o efeito da RLS e a recusa das constraints são provados
 * por `scripts/ci/assert-billing-security.sql`, que roda contra PostgreSQL de
 * verdade no job `Verify`. O que se verifica aqui é o que dá para verificar sem
 * banco — e, principalmente, que aquele arquivo continue sendo executado.
 *
 * ── A ASSERÇÃO MAIS ÚTIL DO ARQUIVO ─────────────────────────────────────────
 *
 * BF-12 confronta os preços do catálogo TypeScript com os preços semeados pela
 * migration. São duas cópias independentes da tabela aprovada, escritas em
 * linguagens diferentes; se alguém corrigir uma e esquecer a outra, o
 * aplicativo cobraria um valor e o banco registraria outro. Nenhuma das duas
 * cópias sozinha detecta isso.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "./lib/manifest.mjs";
import { classificarMigrations } from "./lib/migrations.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8").replace(/\r\n?/g, "\n");
const existe = (p) => fs.existsSync(path.join(raiz, p));

const VERSAO = "20260801120000";
const MIGRATION = `supabase/migrations/${VERSAO}_billing_foundation.sql`;
const ROLLBACK = `supabase/rollbacks/${VERSAO}_billing_foundation_rollback.sql`;
const VERIFICADOR = `scripts/ci/verify-applied/${VERSAO}.sql`;
const ASSERCAO = "scripts/ci/assert-billing-security.sql";
const DECISAO = "docs/decisions/PLANOS-E-PRECIFICACAO.md";

/** As nove tabelas da fundação. */
const TABELAS = [
  "tiers",
  "price_catalog",
  "subscriptions",
  "price_snapshots",
  "grandfathering_cutoff",
  "grandfathered_organizations",
  "courtesies",
  "audit_events",
  "legacy_plan_state",
];

/** Módulos que precisam ser puros: sem I/O, sem ambiente e sem relógio. */
const MODULOS_PUROS = [
  "src/lib/billing/plans/catalog.ts",
  "src/lib/billing/plans/pricing.ts",
  "src/lib/billing/plans/entitlements.ts",
  "src/lib/billing/plans/lifecycle.ts",
  "src/lib/billing/plans/eligibility.ts",
];

/**
 * Tabela aprovada, em centavos. É a MESMA lista que aparece em
 * docs/decisions/PLANOS-E-PRECIFICACAO.md §1, e é contra ela que as duas
 * implementações são conferidas.
 */
const APROVADO = [
  ["essencial", "t1_20", 9990, 107892],
  ["essencial", "t21_50", 16990, 183492],
  ["essencial", "t51_100", 34990, 377892],
  ["completo", "t1_20", 24990, 269892],
  ["completo", "t21_50", 39990, 431892],
  ["completo", "t51_100", 79990, 863892],
];

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

/** Remove comentários de linha e de bloco antes de avaliar SQL executável. */
function sqlExecutavel(rel) {
  return ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * O mesmo para TypeScript.
 *
 * Existe porque uma guarda que mede o comentário aprova o código errado: os
 * cabeçalhos deste repositório CITAM o trecho que protegem, para explicar por
 * que ele existe. Sem esta limpeza, remover a linha real e deixar a prosa
 * passaria — foi assim que TG12-08, MF-17 e AP-16 quebraram antes.
 */
function tsExecutavel(rel) {
  return ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

// ── Migration ───────────────────────────────────────────────────────────────

test("BF-01: a migration existe e é forward-only", () => {
  assert.ok(existe(MIGRATION), `${MIGRATION} ausente`);

  const versoes = parseManifest(ler("supabase/baseline/applied-migrations.tsv")).map(
    (r) => r.version
  );
  const limite = [...versoes].sort().at(-1);

  assert.ok(VERSAO > limite, `${VERSAO} não é posterior à última histórica ${limite}`);
  assert.ok(!versoes.includes(VERSAO), "a migration não pode constar do manifesto histórico");

  const c = classificarMigrations(path.join(raiz, "supabase/migrations"), versoes);
  assert.deepEqual(c.problemas, [], `classificação com problemas:\n  ${c.problemas.join("\n  ")}`);
  assert.ok(
    c.forwardOnly.some((f) => f.version === VERSAO),
    "a migration não foi classificada como forward-only"
  );

  // Estritamente posterior a TODA forward-only anterior.
  for (const f of c.forwardOnly) {
    if (f.version !== VERSAO) {
      assert.ok(VERSAO > f.version, `${VERSAO} não é posterior a ${f.version}`);
    }
  }
});

test("BF-02: a migration não cria, altera nem remove objeto em public", () => {
  // É a premissa que sustenta `efeitoEstrutural: false` em
  // build-expected-schema.mjs, e com ela as duas âncoras do rebuild-verify.
  // Se cair, as âncoras deixam de valer sem que nada mais acuse.
  const sql = sqlExecutavel(MIGRATION);

  const ddlEmPublic = /\b(CREATE|ALTER|DROP)\s+(TABLE|TYPE|FUNCTION|VIEW|INDEX|TRIGGER|POLICY|SEQUENCE)\s+(IF\s+(NOT\s+)?EXISTS\s+)?(public\.|"public"\.)/i;
  assert.doesNotMatch(sql, ddlEmPublic, "a migration faz DDL em public");

  assert.doesNotMatch(sql, /CREATE\s+SCHEMA\s+(IF\s+NOT\s+EXISTS\s+)?public\b/i);
  assert.doesNotMatch(sql, /DROP\s+SCHEMA/i, "migration não derruba schema");

  // O ÚNICO comando permitido sobre public é o UPDATE de is_active — DML.
  const referenciasAPublic = [...sql.matchAll(/\bpublic\.(\w+)/g)].map((m) => m[0]);
  const permitidas = new Set(["public.organizations", "public.subscription_plans"]);
  const inesperadas = [...new Set(referenciasAPublic)].filter((r) => !permitidas.has(r));
  assert.deepEqual(
    inesperadas,
    [],
    `a migration referencia objetos de public além dos previstos: ${inesperadas.join(", ")}`
  );

  assert.match(
    sql,
    /UPDATE\s+public\.subscription_plans\s+SET\s+is_active\s*=\s*false/i,
    "a migration deveria desativar os planos antigos"
  );
  assert.doesNotMatch(
    sql,
    /DELETE\s+FROM\s+public\.subscription_plans/i,
    "os planos antigos são desativados, nunca removidos"
  );
});

test("BF-03: as oito tabelas nascem em billing, com RLS e sem policy", () => {
  const sql = sqlExecutavel(MIGRATION);

  for (const tabela of TABELAS) {
    assert.match(
      sql,
      new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+billing\\.${tabela}\\b`, "i"),
      `billing.${tabela} não é criada`
    );
  }

  assert.match(
    sql,
    /ENABLE ROW LEVEL SECURITY/i,
    "nenhuma tabela habilita RLS"
  );
  assert.doesNotMatch(
    sql,
    /CREATE\s+POLICY/i,
    "a fundação exige RLS ligada e NENHUMA policy — RLS sem policy é negação total"
  );

  // As pós-condições conferem isso no próprio banco, e não só no texto.
  assert.match(sql, /relrowsecurity/, "faltam as pós-condições de RLS");
  assert.match(sql, /pg_policy/, "falta a pós-condição de ausência de policy");
});

test("BF-04: nenhum privilégio para PUBLIC, anon ou authenticated", () => {
  const sql = sqlExecutavel(MIGRATION);

  for (const papel of ["PUBLIC", "anon", "authenticated"]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`\\bGRANT\\s+[^;]*\\sTO\\s+[^;]*\\b${papel}\\b`, "i"),
      `a migration concede privilégio a ${papel}`
    );
  }

  assert.match(sql, /REVOKE ALL ON SCHEMA billing FROM PUBLIC/i);
  assert.match(sql, /GRANT USAGE ON SCHEMA billing TO service_role/i);
  assert.match(sql, /REVOKE ALL ON TABLE billing\.%I FROM PUBLIC/i);
  assert.match(sql, /REVOKE ALL ON TABLE billing\.%I FROM anon/i);
  assert.match(sql, /REVOKE ALL ON TABLE billing\.%I FROM authenticated/i);

  // Nenhum DELETE é concedido a ninguém: nenhum dado é apagado por downgrade
  // ou inadimplência, e o direito adquirido não se extingue.
  //
  // O `\b` antes de GRANT não é enfeite: sem ele o padrão casa dentro de
  // `pg_get_userbyid(a.grantee)`, e a asserção reprova a própria pós-condição
  // que confere a ausência de DELETE. Foi o que aconteceu na primeira execução
  // desta guarda.
  assert.doesNotMatch(
    sql,
    /\bGRANT\b[^;]*\bDELETE\b/i,
    "a migration concede DELETE — nenhum dado de billing é apagável"
  );
  assert.doesNotMatch(sql, /\bGRANT\b[^;]*\bTRUNCATE\b/i);

  // A rotina criada tem de revogar EXECUTE de PUBLIC na própria migration:
  // é a causa raiz registrada em SEC-001 — toda função nasce executável por
  // PUBLIC, e só não fica exposta se quem a cria revogar.
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION billing\.fn_reject_mutation\(\) FROM PUBLIC/i,
    "a função nova não revoga EXECUTE de PUBLIC"
  );
});

test("BF-05: a migration não usa ALTER DEFAULT PRIVILEGES", () => {
  // Exige superusuário — SEC-001 já registrou. Uma migration que dependesse
  // disso falharia em produção depois de passar em todo teste local.
  assert.doesNotMatch(sqlExecutavel(MIGRATION), /ALTER\s+DEFAULT\s+PRIVILEGES/i);
});

test("BF-06: as pós-condições abortam se o estado final não conferir", () => {
  const sql = sqlExecutavel(MIGRATION);
  const excecoes = (sql.match(/RAISE\s+EXCEPTION/gi) ?? []).length;
  assert.ok(
    excecoes >= 10,
    `esperadas pelo menos 10 pós-condições que abortam, encontradas ${excecoes}`
  );
  // A que garante que nada foi criado no lugar errado.
  assert.match(sql, /criados em public|criado em public/i);
});

test("BF-07: o rollback existe, remove o schema e reativa os planos antigos", () => {
  assert.ok(existe(ROLLBACK), `${ROLLBACK} ausente`);
  const sql = sqlExecutavel(ROLLBACK);
  assert.match(sql, /DROP SCHEMA IF EXISTS billing CASCADE/i);
  // A restauração dos planos é verificada em profundidade por BF-29: aqui só
  // se exige que ela EXISTA e que aborte se a captura tiver sumido.
  assert.match(sql, /billing\.fn_restore_legacy_plans\(\)/i);
  assert.match(sql, /RAISE EXCEPTION/i, "o rollback precisa abortar se não puder restaurar");

  // O limite tem de estar escrito no arquivo, e não só no commit: quem for
  // executá-lo lê o arquivo.
  assert.match(
    ler(ROLLBACK),
    /APAGA DADO|deixa de ser seguro|DEIXA DE SER SEGURO/i,
    "o rollback precisa declarar que DROP SCHEMA CASCADE apaga dado"
  );
});

test("BF-08: o verificador independente existe e é somente leitura", () => {
  assert.ok(existe(VERIFICADOR), `${VERIFICADOR} ausente`);
  const bruto = ler(VERIFICADOR);
  const sql = sqlExecutavel(VERIFICADOR);

  assert.match(bruto, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(bruto, /^ROLLBACK;$/m);
  assert.doesNotMatch(bruto, /^\s*COMMIT;/m);

  // Literais de texto saem antes de procurar comando de escrita: o verificador
  // pergunta `has_schema_privilege(..., 'CREATE')`, e a palavra CREATE dentro
  // de uma string não é DDL. Sem esta limpeza a asserção acusa a si mesma.
  const semTexto = sql.replace(/'(?:[^'\\]|\\.)*'/g, "''");

  for (const proibido of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+\w+\s+SET\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bCREATE\b/i,
    /\bALTER\b/i,
    /\bTRUNCATE\b/i,
    /\bCOMMIT\b/i,
  ]) {
    assert.doesNotMatch(semTexto, proibido, `${VERIFICADOR} escreve no banco`);
  }

  // Método DIFERENTE do da migration: onde ela explode ACL, ele pergunta ao
  // PostgreSQL. Dois caminhos para o mesmo fato.
  assert.match(sql, /has_schema_privilege/, "o verificador não usa método independente");
  assert.match(sql, /has_table_privilege/);
  assert.match(sql, /has_function_privilege/);
});

test("BF-09: nenhum SQL novo usa \\b como fronteira de palavra", () => {
  // Na ARE do PostgreSQL `\b` é BACKSPACE, não fronteira. Um padrão com `\b`
  // nunca casa — a asserção reprova sempre, inclusive com o estado correto.
  // TG12-15 já varre supabase/migrations e scripts/ci, mas não desce em
  // scripts/ci/verify-applied/.
  const problemas = [];
  for (const arquivo of [MIGRATION, ROLLBACK, VERIFICADOR, ASSERCAO]) {
    sqlExecutavel(arquivo)
      .split("\n")
      .forEach((linha, i) => {
        if (/\\[bB]/.test(linha)) problemas.push(`${arquivo}:${i + 1}: ${linha.trim()}`);
      });
  }
  assert.deepEqual(problemas, [], `use \\y:\n  ${problemas.join("\n  ")}`);
});

// ── Rota de aplicação e CI ─────────────────────────────────────────────────

test("BF-10: a rota de aplicação reconhece a migration — e não a aplica", () => {
  const wf = ler(".github/workflows/migration-apply.yml");
  assert.ok(
    wf.includes(`- ${VERSAO}_billing_foundation.sql`),
    "a lista fechada do workflow não inclui a nova forward-only"
  );
  // Continua sendo disparo exclusivamente manual, com environment protegido.
  assert.match(wf, /environment:\s*db-production/);
  assert.doesNotMatch(wf, /^\s{2}push:/m);
  assert.doesNotMatch(wf, /^\s{2}schedule:/m);
});

test("BF-11: o estado esperado declara a migration como sem efeito estrutural", () => {
  const bes = ler("scripts/ci/build-expected-schema.mjs");
  const i = bes.indexOf(`${VERSAO}_billing_foundation.sql`);
  assert.ok(i > 0, "build-expected-schema.mjs não declara a migration");

  const bloco = bes.slice(i, i + 1200);
  assert.match(bloco, /efeitoEstrutural:\s*false/, "o delta declarado precisa ser explícito");
  assert.match(bloco, /billing/, "a nota precisa explicar por que o efeito é nulo");
  assert.match(bloco, /assert-billing-security\.sql/, "a nota precisa citar a cobertura compensatória");
});

test("BF-12: catálogo TypeScript e seed da migration concordam com a tabela aprovada", () => {
  // Duas cópias independentes da mesma tabela, em linguagens diferentes. Se
  // alguém corrigir uma e esquecer a outra, o aplicativo cobra um valor e o
  // banco registra outro — e nenhuma das duas, sozinha, detecta isso.
  const catalogo = ler("src/lib/billing/plans/catalog.ts");
  const migration = ler(MIGRATION);

  for (const [plano, faixa, mensal, anual] of APROVADO) {
    const mensalTs = mensal.toLocaleString("en-US").replace(/,/g, "_");
    const anualTs = anual.toLocaleString("en-US").replace(/,/g, "_");

    const linhaTs = new RegExp(
      `plan:\\s*"${plano}",\\s*tier:\\s*"${faixa}",\\s*monthlyCents:\\s*${mensalTs},\\s*yearlyCents:\\s*${anualTs}`
    );
    assert.match(catalogo, linhaTs, `catalog.ts diverge do aprovado em ${plano}/${faixa}`);

    const linhaSql = new RegExp(
      `'${plano}',\\s*'${faixa}',\\s*${mensal},\\s*${anual}`
    );
    assert.match(migration, linhaSql, `o seed da migration diverge do aprovado em ${plano}/${faixa}`);
  }

  // Enterprise não pode ganhar preço de tabela: um valor ali passaria por
  // checkout automático, que o modelo aprovado proíbe.
  //
  // A conferência é POR PLANO, e não "existe ao menos uma linha nula". São
  // dois planos, e a primeira versão desta asserção aprovava um catálogo em
  // que só o Essencial tinha Enterprise sem preço — encontrado por MUT-30.
  for (const plano of ["essencial", "completo"]) {
    assert.match(
      catalogo,
      new RegExp(
        `plan:\\s*"${plano}",\\s*tier:\\s*"enterprise",\\s*monthlyCents:\\s*null,\\s*yearlyCents:\\s*null`
      ),
      `catalog.ts dá preço de tabela ao Enterprise do ${plano}`
    );
    assert.match(
      migration,
      new RegExp(`'${plano}',\\s*'enterprise',\\s*NULL,\\s*NULL`),
      `o seed dá preço de tabela ao Enterprise do ${plano}`
    );
  }

  // E, por propriedade: nenhuma linha de Enterprise pode ter número.
  const enterpriseComNumero = [
    ...catalogo.matchAll(/tier:\s*"enterprise",\s*monthlyCents:\s*([^,]+),\s*yearlyCents:\s*([^\s}]+)/g),
  ].filter(([, m, y]) => m.trim() !== "null" || y.trim() !== "null");
  assert.deepEqual(
    enterpriseComNumero.map((m) => m[0]),
    [],
    "Enterprise é sob proposta e não pode ter preço automático"
  );
});

test("BF-13: o Verify executa a asserção de segurança do schema billing", () => {
  assert.ok(existe(ASSERCAO), `${ASSERCAO} ausente`);

  const ci = ler(".github/workflows/ci.yml");
  const verify = ci.slice(ci.indexOf("  verify:"), ci.indexOf("  e2e:"));
  assert.match(
    verify,
    /assert-billing-security\.sql/,
    "a asserção precisa rodar no job Verify, que é o contexto obrigatório da branch protection"
  );

  // E ela tem de continuar sendo teste de COMPORTAMENTO, não só de catálogo.
  const sql = ler(ASSERCAO);
  assert.match(sql, /BEGIN;/, "o bloco comportamental precisa de transação própria");
  assert.match(sql, /^ROLLBACK;$/m, "o bloco comportamental precisa terminar em ROLLBACK");
  assert.match(sql, /UPDATE billing\.price_snapshots/, "falta o teste de imutabilidade do snapshot");
  assert.match(sql, /DELETE FROM billing\.price_snapshots/);
  assert.match(sql, /restrict_violation/, "falta capturar a recusa esperada");
});

test("BF-14: a guarda está registrada no verify", () => {
  const pkg = JSON.parse(ler("package.json"));
  const script = pkg.scripts["test:reconciliation"];
  assert.ok(
    script.includes("tests/billing-foundation-guard.mjs"),
    "esta guarda não roda no test:reconciliation — ficaria sem vigilância"
  );
  assert.ok(
    script.includes("tests/billing-mutation-guard.mjs"),
    "a guarda de mutação não roda no test:reconciliation"
  );
  assert.ok(pkg.scripts.verify.includes("npm run test"));
});

// ── Código ─────────────────────────────────────────────────────────────────

test("BF-15: a feature flag nasce desligada e não liga por ausência", () => {
  const flag = ler("src/lib/billing/flag.ts");
  assert.match(flag, /=== BILLING_FLAG_ON/, "a comparação precisa ser por igualdade estrita");
  assert.match(flag, /BILLING_FLAG_ON = "true"/);
  assert.match(flag, /BILLING_FLAG_ENV = "BILLING_ENABLED"/);

  // A forma perigosa: uma variável de DESLIGAR faria o esquecimento LIGAR.
  const executavel = flag
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
  assert.doesNotMatch(executavel, /BILLING_DISABLED/, "a flag não pode ser de desligar");
  assert.doesNotMatch(executavel, /!==\s*["']false["']/, "negar 'false' liga por ausência");

  // Nenhuma normalização antes de comparar. `"TRUE"`, `" true"` e `"True"`
  // NÃO podem ligar: o único valor documentado é `"true"`, literal. Tolerar
  // variações amplia o conjunto de estados que ligam a cobrança, e cada
  // ampliação é uma chance a mais de ligar sem querer.
  for (const normalizacao of [/toLowerCase/, /toUpperCase/, /\.trim\(\)/, /localeCompare/]) {
    assert.doesNotMatch(
      executavel,
      normalizacao,
      `a flag normaliza o valor antes de comparar (${normalizacao}) — só o literal exato pode ligar`
    );
  }
  assert.doesNotMatch(executavel, /\/i[\s;)]/, "comparação insensível a caixa na flag");
});

test("BF-35: desconhecido nunca libera — plano, recurso ou estado", () => {
  const catalogo = tsExecutavel("src/lib/billing/plans/catalog.ts");
  const entitlements = tsExecutavel("src/lib/billing/plans/entitlements.ts");

  // Plano fora do catálogo é dado corrompido: `getPlan` LANÇA, e o guard
  // converte em negação. Devolver um plano padrão seria escolher, em silêncio,
  // quais recursos liberar para uma linha que ninguém entende.
  assert.match(
    catalogo,
    /if \(!plan\) throw new Error\(`plano desconhecido no catálogo/,
    "getPlan deixou de recusar plano desconhecido"
  );
  assert.match(catalogo, /if \(!tier\) throw new Error\(`faixa desconhecida/);
  assert.match(catalogo, /if \(!entry\) throw new Error\(`preço ausente/);

  // Recurso fora do plano é bloqueio: a decisão vem de pertencimento, nunca de
  // um ramo default.
  assert.match(
    entitlements,
    /return getPlan\(plan\)\.features\.includes\(feature\);/,
    "planIncludes deixou de decidir por pertencimento"
  );
  assert.doesNotMatch(entitlements, /return true;\s*$/m, "há um caminho que libera por padrão");

  // Estado é LISTA DE PERMISSÃO: um estado novo que alguém esqueça de
  // classificar nasce somente leitura, que é o lado seguro do erro.
  assert.match(
    entitlements,
    /const ESTADOS_COM_ESCRITA: readonly SubscriptionState\[\]/,
    "a lista de permissão de estados sumiu"
  );
  assert.match(
    entitlements,
    /return ESTADOS_COM_ESCRITA\.includes\(state\);/,
    "canWrite deixou de decidir por lista de permissão"
  );
  assert.doesNotMatch(
    entitlements,
    /ESTADOS_SEM_ESCRITA|ESTADOS_BLOQUEADOS|!.*BLOQUEAD.*\.includes/,
    "a lista virou de NEGAÇÃO: estado novo passaria a nascer liberado"
  );
});

test("BF-16: o guard não tem fail-open", () => {
  const guard = ler("src/lib/billing/guard.ts");
  const executavel = guard
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

  // TODA permissão sai de um dos dois lugares: o desvio explícito da flag, ou
  // um retorno com `reason: "ok"` alcançado APÓS verificação. Nenhum
  // `allowed: true` pode aparecer dentro de um tratamento de erro.
  const permissoes = [...executavel.matchAll(/allowed:\s*true/g)].length;
  assert.ok(permissoes >= 1, "o guard não permite nada — provavelmente quebrou");

  assert.match(
    executavel,
    /function desvioDaFeatureFlag\(\)[\s\S]{0,200}bypass:\s*true/,
    "o desvio da flag precisa ser uma função própria e marcada"
  );

  // O padrão exato do defeito antigo.
  assert.doesNotMatch(
    executavel,
    /if\s*\(\s*error\s*\)\s*\{[^}]*allowed:\s*true/,
    "voltou o fail-open: erro produzindo permissão"
  );
  assert.doesNotMatch(
    executavel,
    /catch[^{]*\{[^}]*allowed:\s*true/,
    "voltou o fail-open por captura de exceção"
  );

  // E o guard não pode ressuscitar a RPC revogada.
  assert.doesNotMatch(executavel, /check_plan_limit/, "o guard não pode chamar check_plan_limit");
});

test("BF-17: SEC-002 permanece intacta e sem GRANT", () => {
  const sec002 = ler(
    "supabase/migrations/20260728191311_20260728154500_sec_002_retire_plan_limit.sql"
  );
  assert.match(sec002, /REVOKE EXECUTE/);
  assert.doesNotMatch(sec002, /GRANT EXECUTE/);

  // E nenhuma migration nova pode reconceder por outro caminho.
  assert.doesNotMatch(sqlExecutavel(MIGRATION), /check_plan_limit/);
});

test("BF-18: a autorização confere o papel em código, não só no filtro", () => {
  // Comentários fora ANTES de medir. O cabeçalho de authorization.ts cita
  // `.eq("role", "owner")` justamente para explicar por que ele existe — e a
  // primeira versão desta asserção casava com a prosa, aprovando um arquivo do
  // qual o filtro tinha sido removido. É o mesmo defeito de TG12-08 e AP-16.
  const auth = tsExecutavel("src/lib/billing/authorization.ts");
  assert.match(auth, /\.eq\("role", "owner"\)/, "o filtro de papel não é enviado");
  assert.match(
    auth,
    /membership\.role !== "owner"/,
    "o papel precisa ser conferido no objeto devolvido, e não só filtrado"
  );
  // Ordenação determinística: sem ela, um usuário com mais de uma organização
  // recairia num tenant arbitrário — e billing é onde isso custa dinheiro.
  assert.match(auth, /\.order\("created_at", \{ ascending: true \}\)/);
  assert.match(auth, /\.order\("id", \{ ascending: true \}\)/);
});

test("BF-19: nenhuma chamada real ao Asaas nasce nesta etapa", () => {
  const novos = [
    "src/lib/billing/flag.ts",
    "src/lib/billing/authorization.ts",
    "src/lib/billing/guard.ts",
    "src/lib/billing/plans/model.ts",
    "src/lib/billing/plans/catalog.ts",
    "src/lib/billing/plans/pricing.ts",
    "src/lib/billing/plans/entitlements.ts",
    "src/lib/billing/plans/lifecycle.ts",
    "src/lib/billing/plans/eligibility.ts",
  ];

  for (const arquivo of novos) {
    assert.ok(existe(arquivo), `${arquivo} ausente`);
    const src = ler(arquivo);
    const executavel = src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");

    assert.doesNotMatch(executavel, /\bfetch\s*\(/, `${arquivo} faz requisição HTTP`);
    assert.doesNotMatch(executavel, /asaas/i, `${arquivo} referencia o Asaas`);
    assert.doesNotMatch(executavel, /providers\//, `${arquivo} importa um provider`);
    assert.doesNotMatch(executavel, /ASAAS_/, `${arquivo} lê variável do Asaas`);
  }

  // Nenhum segredo novo nesta etapa. A flag NÃO é segredo, e é a única
  // variável que a fundação acrescenta.
  const envExample = ler(".env.example");
  const antes = (envExample.match(/^ASAAS_/gm) ?? []).length;
  assert.equal(antes, 3, "as variáveis do Asaas mudaram — nenhum segredo novo nesta etapa");
});

test("BF-20: a jornada comercial continua desligada", () => {
  // As mesmas invariantes que tests/reconciliation-guards.mjs protege, aqui
  // reafirmadas do lado de billing: esta etapa é fundação, e fundação não
  // acende interface.
  const billing = ler("src/app/(dashboard)/dashboard/billing/page.tsx");
  assert.ok(billing.includes('redirect("/dashboard")'));

  const sidebar = ler("src/components/dashboard/sidebar-nav.tsx");
  assert.ok(!sidebar.includes("/dashboard/billing"));

  const layout = ler("src/app/(dashboard)/layout.tsx");
  assert.doesNotMatch(layout, /getSubscriptionWarning/);
  assert.doesNotMatch(layout, /billing/i);

  const landing = ler("src/app/page.tsx");
  for (const termo of [/R\$/, /\bpre[çc]o/i, /\bplano/i, /essencial/i, /completo/i]) {
    assert.doesNotMatch(landing, termo, "a landing não pode exibir preço nesta etapa");
  }

  // Nenhuma página ou action importa a fundação: ela existe e não é chamada.
  const alcance = [];
  const varrer = (dir) => {
    for (const entrada of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entrada.name);
      if (entrada.isDirectory()) varrer(rel);
      else if (/\.(ts|tsx)$/.test(entrada.name) && !rel.includes(`lib${path.sep}billing`)) {
        if (/from\s+["']@\/lib\/billing\/(flag|guard|authorization|plans)/.test(ler(rel))) {
          alcance.push(rel);
        }
      }
    }
  };
  varrer("src");
  assert.deepEqual(
    alcance,
    [],
    `a fundação já é importada pela aplicação, e a Etapa 12A não autoriza isso:\n  ${alcance.join("\n  ")}`
  );
});

test("BF-21: a decisão comercial está documentada e é a fonte única", () => {
  assert.ok(existe(DECISAO), `${DECISAO} ausente`);
  const doc = ler(DECISAO);

  for (const [, , mensal] of APROVADO) {
    const reais = (mensal / 100).toFixed(2).replace(".", ",");
    assert.ok(doc.includes(reais), `o documento não registra o preço R$ ${reais}`);
  }

  for (const trecho of [
    /trial de \*\*7 dias\*\*|Trial de \*\*7 dias\*\*/,
    /7 dias com acesso normal|\*\*7 dias com acesso normal\*\*/,
    /somente o proprietário|Somente o proprietário/i,
    /data de corte/i,
    /mock/i,
  ]) {
    assert.match(doc, trecho, `a decisão não registra: ${trecho}`);
  }

  // A ordem obrigatória de lançamento tem de estar escrita.
  assert.match(doc, /sandbox/i);
  assert.match(doc, /piloto/i);
});

test("BF-22: o direito adquirido é vinculado à ORGANIZAÇÃO, nunca ao usuário", () => {
  // Se o benefício seguisse o usuário, qualquer beneficiado criaria
  // organizações novas indefinidamente e a data de corte não valeria nada.
  const src = ler("src/lib/billing/plans/eligibility.ts");
  const executavel = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

  assert.doesNotMatch(
    executavel,
    /\buserId\b|\buser_id\b/,
    "eligibility.ts passou a conhecer usuário — o benefício é da organização"
  );
  assert.match(executavel, /organizationId/, "o vínculo por organização sumiu");
  assert.match(
    executavel,
    /record\.organizationId === organizationId/,
    "a conferência de organização sumiu de holdsGrandfathering"
  );

  // E no banco a chave primária é a organização.
  assert.match(
    sqlExecutavel(MIGRATION),
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+billing\.grandfathered_organizations\s*\(\s*organization_id\s+uuid\s+PRIMARY KEY/i,
    "a tabela de direito adquirido não é chaveada por organização"
  );
});

test("BF-23: o preço contratado não pode ser reescrito retroativamente", () => {
  const sql = sqlExecutavel(MIGRATION);

  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION billing\.fn_reject_mutation\(\)/i,
    "a função de recusa sumiu"
  );
  assert.match(
    sql,
    /CREATE TRIGGER tg_price_snapshot_immutable\s+BEFORE UPDATE OR DELETE ON billing\.price_snapshots/i,
    "a trigger de imutabilidade do snapshot sumiu ou deixou de cobrir UPDATE e DELETE"
  );
  assert.match(
    sql,
    /CREATE TRIGGER tg_audit_events_append_only\s+BEFORE UPDATE OR DELETE ON billing\.audit_events/i,
    "a trigger append-only da auditoria sumiu"
  );
  assert.match(sql, /RAISE EXCEPTION[\s\S]{0,200}imutável/i, "a recusa deixou de ser exceção");

  // O snapshot também é congelado em memória, do lado da aplicação.
  assert.match(
    tsExecutavel("src/lib/billing/plans/pricing.ts"),
    /Object\.freeze\(/,
    "capturePriceSnapshot deixou de congelar o objeto"
  );
});

test("BF-24: as bordas das faixas são as aprovadas, nos dois lugares", () => {
  // 20/21 e 50/51 são onde um erro de faixa custa dezenas de reais por mês.
  const bordas = [
    ["t1_20", 1, 20],
    ["t21_50", 21, 50],
    ["t51_100", 51, 100],
  ];

  const catalogo = ler("src/lib/billing/plans/catalog.ts");
  const migration = ler(MIGRATION);

  for (const [faixa, minimo, maximo] of bordas) {
    assert.match(
      catalogo,
      new RegExp(
        `slug:\\s*"${faixa}",\\s*minWorkers:\\s*${minimo},\\s*maxWorkers:\\s*${maximo}\\b`
      ),
      `catalog.ts diverge das bordas aprovadas em ${faixa}`
    );
    assert.match(
      migration,
      new RegExp(`'${faixa}',\\s*${minimo},\\s*${maximo},`),
      `o seed da migration diverge das bordas aprovadas em ${faixa}`
    );
  }

  assert.match(
    catalogo,
    /slug:\s*"enterprise",\s*minWorkers:\s*101,\s*maxWorkers:\s*null/,
    "Enterprise deixou de começar em 101 ou ganhou teto"
  );
  assert.match(migration, /'enterprise',\s*101,\s*NULL,\s*true/);
});

test("BF-25: nenhum valor monetário é ponto flutuante", () => {
  const arquivos = [
    "src/lib/billing/plans/catalog.ts",
    "src/lib/billing/plans/pricing.ts",
  ];

  for (const arquivo of arquivos) {
    const executavel = ler(arquivo)
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n")
      // Literais de texto saem antes: `CATALOG_VERSION = "2026-07-30.1"` é
      // rótulo de versão, não valor monetário, e não pode ser confundido com
      // um preço fracionário.
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''");

    // Literal decimal em código de preço é sempre erro: dinheiro é centavo
    // inteiro. `0.1 + 0.2` não dá `0.3` em IEEE-754, e o desvio aparece só em
    // algumas faixas — que é o pior tipo de defeito para encontrar por leitura.
    const decimais = executavel.match(/\b\d+\.\d+\b/g) ?? [];
    assert.deepEqual(
      decimais,
      [],
      `${arquivo} tem literal decimal: ${decimais.join(", ")}`
    );

    for (const proibido of [/\bparseFloat\b/, /\btoFixed\b/, /\bMath\.round\b/]) {
      assert.doesNotMatch(
        executavel,
        proibido,
        `${arquivo} usa aritmética de ponto flutuante em preço`
      );
    }
  }

  // A rede de segurança precisa continuar existindo e ser aplicada.
  const pricing = ler("src/lib/billing/plans/pricing.ts");
  assert.match(pricing, /export function assertIntegerCents/);
  assert.ok(
    (pricing.match(/assertIntegerCents\(/g) ?? []).length >= 5,
    "assertIntegerCents deixou de guardar as saídas monetárias"
  );
});

// ── Endurecimento da revisão final ─────────────────────────────────────────

test("BF-26: exceção e timeout NEGAM, em vez de escapar do guard", () => {
  // Sem `try`, uma rejeição de promessa passa por cima da decisão: o chamador
  // típico (`if (!r.allowed) return { error }`) nunca roda. A operação aborta,
  // o que não autoriza — mas autoriza-ou-não deixa de ser uma decisão do guard
  // e vira consequência de como cada chamador reage.
  for (const arquivo of ["src/lib/billing/guard.ts", "src/lib/billing/authorization.ts"]) {
    const src = tsExecutavel(arquivo);
    assert.match(src, /\btry\s*\{/, `${arquivo} não protege contra exceção`);
    assert.match(src, /\bcatch\b/, `${arquivo} não tem tratamento de exceção`);

    // E todo `catch` tem de NEGAR. É o ponto inteiro deste PR.
    const blocos = [...src.matchAll(/catch[^{]*\{([\s\S]{0,200}?)\}/g)].map((m) => m[1]);
    assert.ok(blocos.length > 0, `${arquivo}: nenhum bloco catch encontrado`);
    for (const bloco of blocos) {
      assert.doesNotMatch(
        bloco,
        /allowed:\s*true|ok:\s*true/,
        `${arquivo}: um catch produz autorização — é o fail-open de volta`
      );
      assert.match(
        bloco,
        /verification_failed/,
        `${arquivo}: catch precisa negar com motivo nomeado`
      );
    }
  }

  // Resposta malformada também nega: veio linha, mas sem tenant utilizável.
  for (const arquivo of ["src/lib/billing/guard.ts", "src/lib/billing/authorization.ts"]) {
    assert.match(
      tsExecutavel(arquivo),
      /typeof membership\.tenant_id !== "string"/,
      `${arquivo} aceita resposta malformada`
    );
  }
});

test("BF-27: identificador vindo do cliente não autoriza (IDOR)", () => {
  const auth = tsExecutavel("src/lib/billing/authorization.ts");

  assert.match(
    auth,
    /export async function requireBillingOwnerFor/,
    "falta a autorização por organização solicitada"
  );
  // A comparação é o controle. Sem ela, o owner do tenant A administraria a
  // assinatura do tenant B sem sair da própria sessão.
  assert.match(
    auth,
    /requestedOrganizationId !== resultado\.principal\.organizationId/,
    "o identificador do cliente não é comparado com o resolvido no servidor"
  );
  // E o servidor tem de resolver por conta própria ANTES de comparar.
  const i = auth.indexOf("requireBillingOwnerFor");
  const corpo = auth.slice(i, i + 1200);
  assert.match(
    corpo,
    /await requireBillingOwner\(\)/,
    "a variante por organização precisa reusar a resolução server-side"
  );
  // Entrada vazia não pode cair no caminho do servidor.
  assert.match(corpo, /trim\(\) === ""/, "entrada vazia precisa ser recusada");
});

test("BF-28: a feature flag é inalcançável pelo browser", () => {
  // Comentários fora: o cabeçalho de flag.ts EXPLICA por que não há
  // `NEXT_PUBLIC_`, e a asserção casaria com a própria explicação.
  const flag = tsExecutavel("src/lib/billing/flag.ts");

  // `server-only` transforma import em componente cliente em erro de BUILD.
  assert.match(flag, /import "server-only";/, "flag.ts não é marcada como server-only");
  // Sem NEXT_PUBLIC_, o Next não injeta a variável no bundle.
  assert.doesNotMatch(flag, /NEXT_PUBLIC_/, "a flag não pode ser pública");

  // E nenhum componente cliente pode importar a fundação.
  const clientes = [];
  const varrer = (dir) => {
    for (const entrada of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entrada.name);
      if (entrada.isDirectory()) varrer(rel);
      else if (/\.(ts|tsx)$/.test(entrada.name)) {
        const src = ler(rel);
        if (!/^\s*["']use client["']/m.test(src)) continue;
        if (/from\s+["']@\/lib\/billing\/(flag|guard|authorization)/.test(src)) {
          clientes.push(rel);
        }
      }
    }
  };
  varrer("src");
  assert.deepEqual(clientes, [], `componente cliente importa a fundação:\n  ${clientes.join("\n  ")}`);
});

test("BF-29: o rollback restaura o valor REAL, não um valor presumido", () => {
  const rollback = sqlExecutavel(ROLLBACK);

  // `is_active` é boolean DEFAULT true e NÃO NOT NULL: true, false e NULL são
  // todos possíveis. Reativar por lista de slugs erraria em dois casos reais.
  assert.doesNotMatch(
    rollback,
    /SET\s+is_active\s*=\s*true/i,
    "o rollback presume `true` — erraria para plano já inativo e para NULO"
  );
  assert.doesNotMatch(
    rollback,
    /slug IN \(/i,
    "o rollback restaura por lista de slugs em vez de por estado capturado"
  );
  assert.match(
    rollback,
    /billing\.fn_restore_legacy_plans\(\)/,
    "o rollback não usa a restauração baseada na captura"
  );
  // E restaura ANTES de destruir o schema que guarda a captura.
  const iRestaura = rollback.indexOf("fn_restore_legacy_plans");
  const iDrop = rollback.indexOf("DROP SCHEMA");
  assert.ok(iRestaura > 0 && iDrop > 0, "faltam restauração ou remoção");
  assert.ok(
    iRestaura < iDrop,
    "o rollback derruba o schema ANTES de restaurar — apagaria a própria captura"
  );

  // A migration precisa capturar antes de desativar.
  const migration = sqlExecutavel(MIGRATION);
  const iCaptura = migration.indexOf("INSERT INTO billing.legacy_plan_state");
  const iUpdate = migration.indexOf("UPDATE public.subscription_plans");
  assert.ok(iCaptura > 0, "a migration não captura o estado anterior");
  assert.ok(
    iCaptura < iUpdate,
    "a captura acontece DEPOIS da desativação — gravaria o estado já alterado"
  );
  assert.match(
    migration,
    /ON CONFLICT \(plan_id\) DO NOTHING/,
    "reaplicar sobrescreveria a captura original"
  );

  // E o comportamento é exercido contra PostgreSQL de verdade.
  const assercao = ler(ASSERCAO);
  assert.match(assercao, /fn_restore_legacy_plans/, "falta o teste comportamental do rollback");
  assert.match(assercao, /REATIVOU um plano que já estava inativo/, "falta o cenário do plano já inativo");
  assert.match(assercao, /is_active NULO/, "falta o cenário do valor nulo");
});

test("BF-30: toda rotina da fundação fixa search_path", () => {
  const sql = sqlExecutavel(MIGRATION);
  const funcoes = [...sql.matchAll(/CREATE OR REPLACE FUNCTION billing\.(\w+)/g)].map((m) => m[1]);
  assert.ok(funcoes.length >= 2, `esperadas ao menos 2 funções, achadas ${funcoes.length}`);

  for (const nome of funcoes) {
    const i = sql.indexOf(`CREATE OR REPLACE FUNCTION billing.${nome}`);
    const corpo = sql.slice(i, i + 400);
    assert.match(
      corpo,
      /SET search_path TO 'pg_catalog', 'pg_temp'/,
      `billing.${nome} não fixa search_path — nome não qualificado poderia ser sequestrado`
    );
  }

  // E o banco confere isso por catálogo, nas três camadas.
  assert.match(sql, /search\\_path=/, "faltam as pós-condições de search_path");
  assert.match(ler(ASSERCAO), /search\\_path=/, "a asserção do CI não confere search_path");
  assert.match(ler(VERIFICADOR), /search\\_path=/, "o verificador não confere search_path");
});

test("BF-31: CNPJ é obrigatório para iniciar o trial", () => {
  const lifecycle = tsExecutavel("src/lib/billing/plans/lifecycle.ts");
  assert.match(
    lifecycle,
    /if \(input\.cnpj\.trim\(\) === ""\)/,
    "startTrial deixou de exigir CNPJ"
  );
  assert.match(lifecycle, /CNPJ é obrigatório/, "a recusa perdeu a mensagem");
  // E a coluna do banco recusa vazio.
  assert.match(
    sqlExecutavel(MIGRATION),
    /cnpj\s+text NOT NULL CHECK \(btrim\(cnpj\) <> ''\)/,
    "a tabela aceita CNPJ vazio"
  );
});

test("BF-32: os módulos puros não leem relógio nem ambiente", () => {
  // Um `Date.now()` escondido num cálculo torna o resultado dependente do
  // instante da execução — e um teste que passa hoje falha em outro fuso, ou
  // na virada do mês. Todo instante entra por argumento.
  for (const arquivo of MODULOS_PUROS) {
    const src = tsExecutavel(arquivo);
    assert.doesNotMatch(src, /Date\.now\(\)/, `${arquivo} lê o relógio`);
    assert.doesNotMatch(src, /new Date\(\s*\)/, `${arquivo} lê o relógio`);
    assert.doesNotMatch(src, /process\.env/, `${arquivo} lê o ambiente`);
    assert.doesNotMatch(src, /Math\.random/, `${arquivo} não é determinístico`);
    assert.doesNotMatch(src, /createClient|supabase/i, `${arquivo} faz I/O`);
  }
});

test("BF-33: service role não alcança código de cliente", () => {
  const vazamentos = [];
  const varrer = (dir) => {
    for (const entrada of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entrada.name);
      if (entrada.isDirectory()) varrer(rel);
      else if (/\.(ts|tsx)$/.test(entrada.name)) {
        const src = ler(rel);
        if (!/^\s*["']use client["']/m.test(src)) continue;
        if (/SUPABASE_SERVICE_ROLE_KEY|lib\/supabase\/service|createServiceClient/.test(src)) {
          vazamentos.push(rel);
        }
      }
    }
  };
  varrer("src");
  assert.deepEqual(
    vazamentos,
    [],
    `service role em componente cliente:\n  ${vazamentos.join("\n  ")}`
  );

  // E a chave nunca pode virar variável pública.
  assert.doesNotMatch(
    ler(".env.example"),
    /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/,
    "a chave de service role foi exposta como variável pública"
  );
});

test("BF-34: o CI ensaia a reconstrução descartável por inteiro", () => {
  const ci = ler(".github/workflows/ci.yml");
  const verify = ci.slice(ci.indexOf("  verify:"), ci.indexOf("  e2e:"));

  // Os PASSOS têm de existir por nome. Conferir só os caminhos de arquivo
  // deixa passar a desativação: basta renomear o passo e o comando fica órfão
  // dentro de outro bloco, ainda visível no texto e nunca executado.
  // Encontrado por MUT-39.
  for (const passo of [
    "- name: 36/36 hashes das históricas contra o manifesto",
    "- name: Verificador independente da nova forward-only",
    "- name: Rollback e reaplicação da nova forward-only",
    "- name: Segurança e imutabilidade do schema billing",
  ]) {
    assert.ok(verify.includes(passo), `o Verify perdeu o passo: ${passo}`);
  }

  for (const [trecho, motivo] of [
    ["verify-recovered-migrations.mjs supabase/migrations", "hashes das 36 históricas"],
    ["verify-applied/20260801120000.sql", "verificador independente da nova migration"],
    ["20260801120000_billing_foundation_rollback.sql", "rollback"],
    ["supabase/migrations/20260801120000_billing_foundation.sql", "reaplicação"],
  ]) {
    assert.ok(verify.includes(trecho), `o Verify não executa: ${motivo}`);
  }

  // O rollback tem de ser conferido, não apenas executado.
  assert.match(verify, /schema billing sobreviveu ao rollback/, "o rollback não é conferido");
  assert.match(verify, /planos-antes\.txt/, "falta o diff antes/depois dos planos");
  assert.match(verify, /reaplicar não reproduziu o mesmo estado/, "a idempotência não é conferida");
});

console.log("");
console.log(`Billing foundation guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
