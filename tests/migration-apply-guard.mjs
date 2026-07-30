/**
 * GUARDA ESTÁTICA DA ROTA DE APLICAÇÃO
 *
 * A rota de produção é o ponto mais perigoso do repositório: é o único lugar
 * que escreve no banco real. Estas asserções não substituem a revisão humana —
 * elas garantem que as propriedades que a tornam segura não sejam removidas
 * depois, numa edição distraída, sem que alguém perceba.
 *
 * Tudo aqui é texto. Nenhuma conexão, nenhum banco, nenhum secret.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "./lib/manifest.mjs";
import { classificarMigrations } from "./lib/migrations.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8").replace(/\r\n?/g, "\n");

const WORKFLOW = ".github/workflows/migration-apply.yml";
const wf = ler(WORKFLOW);

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

/** Extrai as opções do input `choice`, na ordem em que aparecem. */
function opcoesDoChoice() {
  const bloco = wf.slice(wf.indexOf("options:"));
  const opcoes = [];
  for (const linha of bloco.split("\n").slice(1)) {
    const m = linha.match(/^\s{8,}- (\S+\.sql)\s*$/);
    if (m) {
      opcoes.push(m[1]);
      continue;
    }
    if (linha.trim() !== "" && !linha.startsWith(" ".repeat(10))) break;
  }
  return opcoes;
}

test("AP-01: o workflow existe e é exclusivamente workflow_dispatch", () => {
  assert.ok(fs.existsSync(path.join(raiz, WORKFLOW)), `${WORKFLOW} ausente`);
  const bloco = wf.slice(wf.indexOf("\non:"), wf.indexOf("\nconcurrency:"));
  assert.match(bloco, /workflow_dispatch:/);
  assert.doesNotMatch(bloco, /^\s{2}push:/m, "gatilho push não é permitido nesta rota");
  assert.doesNotMatch(bloco, /^\s{2}pull_request:/m, "gatilho pull_request não é permitido");
  assert.doesNotMatch(bloco, /^\s{2}schedule:/m, "gatilho schedule não é permitido");
});

test("AP-02: a entrada é choice fechado — não aceita SQL nem texto livre de migration", () => {
  const bloco = wf.slice(wf.indexOf("migration:"), wf.indexOf("confirmacao:"));
  assert.match(bloco, /type:\s*choice/, "a entrada da migration tem de ser `choice`");
  assert.match(bloco, /options:/);
  // Nenhuma entrada pode se chamar sql/query/statement/comando.
  const entradas = [...wf.matchAll(/^\s{6}([a-z_]+):\s*$/gm)].map((m) => m[1]);
  const proibidas = entradas.filter((e) => /sql|query|statement|comando|script/i.test(e));
  assert.deepEqual(proibidas, [], `entrada de SQL arbitrário: ${proibidas.join(", ")}`);
});

test("AP-03: as opções são EXATAMENTE as forward-only do repositório", () => {
  const versoes = parseManifest(ler("supabase/baseline/applied-migrations.tsv")).map((r) => r.version);
  const c = classificarMigrations(path.join(raiz, "supabase/migrations"), versoes);
  assert.deepEqual(c.problemas, [], "classificação do diretório com problemas");

  const esperadas = c.forwardOnly.map((f) => f.arquivo).sort();
  const declaradas = [...opcoesDoChoice()].sort();
  assert.deepEqual(
    declaradas,
    esperadas,
    "a lista fechada do workflow divergiu de supabase/migrations/ — " +
      "acrescentar uma forward-only exige acrescentar a opção, e isso passa por PR"
  );
});

test("AP-04: nenhuma opção pertence à faixa histórica congelada", () => {
  const versoes = parseManifest(ler("supabase/baseline/applied-migrations.tsv")).map((r) => r.version);
  const limite = [...versoes].sort().at(-1);
  for (const opcao of opcoesDoChoice()) {
    const v = opcao.slice(0, 14);
    assert.ok(!versoes.includes(v), `${opcao} é uma das 36 históricas`);
    assert.ok(v > limite, `${opcao} não é posterior à faixa congelada (${limite})`);
  }
});

test("AP-05: a execução é restrita à main, e antes do environment", () => {
  const preflight = wf.slice(wf.indexOf("  preflight:"), wf.indexOf("  apply:"));
  assert.match(
    preflight,
    /GITHUB_REF" != "refs\/heads\/main"/,
    "o preflight tem de recusar execução fora da main"
  );
  const apply = wf.slice(wf.indexOf("  apply:"));
  assert.match(apply, /GITHUB_REF" != "refs\/heads\/main"/, "o job de aplicação também confere a ref");
});

test("AP-06: o job de aplicação exige o environment protegido, e o preflight não", () => {
  const preflight = wf.slice(wf.indexOf("  preflight:"), wf.indexOf("  apply:"));
  const apply = wf.slice(wf.indexOf("  apply:"));
  assert.doesNotMatch(preflight, /^\s{4}environment:/m, "o preflight não deve consumir aprovação");
  assert.match(apply, /^\s{4}environment:\s*db-production\s*$/m);
  assert.match(apply, /needs:\s*preflight/, "a aplicação depende do preflight");
});

test("AP-07: o dry-run é obrigatório e precede a aplicação", () => {
  const iDry = wf.indexOf("--dry-run");
  const iPush = wf.indexOf("supabase db push --yes");
  assert.ok(iDry > 0, "não há --dry-run");
  assert.ok(iPush > 0, "não há aplicação");
  assert.ok(iDry < iPush, "o dry-run tem de vir ANTES da aplicação");
});

test("AP-08: o ledger é conferido antes E depois", () => {
  const antes = wf.indexOf("ledger-antes.tsv");
  const depois = wf.indexOf("ledger-depois.tsv");
  assert.ok(antes > 0 && depois > 0, "faltam as conferências de ledger");
  assert.ok(antes < depois);
  assert.match(wf, /check-ledger\.mjs artifacts\/ledger-antes\.tsv/);
  assert.match(wf, /check-ledger\.mjs artifacts\/ledger-depois\.tsv/);
});

test("AP-09: concurrency não cancela execução em andamento", () => {
  const bloco = wf.slice(wf.indexOf("concurrency:"), wf.indexOf("permissions:"));
  assert.match(bloco, /cancel-in-progress:\s*false/, "cancelar uma aplicação em curso é inaceitável");
});

test("AP-10: nenhum passo ecoa a credencial nem liga rastreamento do shell", () => {
  const executavel = wf
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  assert.doesNotMatch(executavel, /set\s+-x/, "`set -x` expõe a credencial expandida");
  assert.doesNotMatch(executavel, /--debug\b/, "modo debug do CLI pode revelar a conexão");
  assert.doesNotMatch(executavel, /echo\s+"?\$\{?DB_URL/, "eco direto da URL");
  assert.doesNotMatch(executavel, /echo\s+"?\$\{?PGPASSWORD/, "eco direto da senha");
  assert.doesNotMatch(executavel, /echo\s+"?\$\{?PGHOST/, "eco direto do host");
  // O secret só pode ser referenciado em blocos `env:`, nunca inline num run.
  for (const linha of executavel.split("\n")) {
    if (linha.includes("secrets.SUPABASE_DB_URL")) {
      assert.match(
        linha,
        /^\s+DB_URL:\s*\$\{\{\s*secrets\.SUPABASE_DB_URL\s*\}\}\s*$/,
        `secret referenciado fora de um bloco env:: ${linha.trim()}`
      );
    }
  }
});

test("AP-11: as evidências publicadas não incluem a credencial", () => {
  // Só `artifacts/` é publicado, e nada escreve credencial ali. O que garante
  // isso é não existir redirecionamento de variável sensível para o diretório.
  const executavel = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(executavel, />\s*artifacts\/[^\n]*\$\{?(DB_URL|PGPASSWORD)/);
  assert.match(wf, /path:\s*artifacts\//);
});

test("AP-12: a rota reusa as guardas existentes em vez de reimplementá-las", () => {
  for (const guarda of [
    "tests/verify-recovered-migrations.mjs",
    "tests/migration-freeze-guard.mjs",
    "tests/migration-classification-guard.mjs",
    "scripts/ci/check-ledger.mjs",
    "scripts/ci/list-forward-only.mjs",
  ]) {
    assert.ok(wf.includes(guarda), `a rota não invoca ${guarda}`);
    assert.ok(fs.existsSync(path.join(raiz, guarda)), `${guarda} não existe`);
  }
});

test("AP-13: a asserção de EXECUTE para PUBLIC é obrigatória no Verify", () => {
  const ci = ler(".github/workflows/ci.yml");
  const verify = ci.slice(ci.indexOf("  verify:"), ci.indexOf("  e2e:"));
  assert.match(
    verify,
    /assert-no-public-execute\.sql/,
    "a asserção tem de rodar dentro do job Verify, que é o contexto obrigatório da branch protection"
  );
  assert.ok(
    fs.existsSync(path.join(raiz, "scripts/ci/assert-no-public-execute.sql")),
    "scripts/ci/assert-no-public-execute.sql não existe"
  );
});

test("AP-14: a decisão sobre ACL de tabela/default/schema está registrada", () => {
  const doc = "docs/decisions/ACL-TABELA-DEFAULT-SCHEMA.md";
  assert.ok(fs.existsSync(path.join(raiz, doc)), `${doc} ausente`);
  const texto = ler(doc);
  for (const termo of ["tabela-acl", "default-acl", "schema-acl"]) {
    assert.ok(texto.includes(termo), `a decisão não trata de ${termo}`);
  }
  // A decisão desta fase é NÃO corrigir. Se alguém transformar o documento num
  // plano de correção, que seja uma mudança consciente e revisada.
  assert.match(texto, /não corrig|nenhuma corre/i, "a decisão desta fase é adiar a correção");
});

test("AP-15: nenhum grep da rota usa \\b para delimitar versão de migration", () => {
  // A versão aparece na saída do CLI dentro do NOME DO ARQUIVO —
  // `20260730123613_revoke_...`. O caractere seguinte é `_`, que é caractere de
  // palavra: um padrão terminado em `\b` não casa, e a checagem de "há outra
  // versão além da selecionada" passaria vazia justamente quando houvesse
  // outra. Foi encontrado pela simulação, não pela leitura.
  const executavel = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const suspeitas = executavel
    .split("\n")
    .filter((l) => /grep/.test(l) && /\\b/.test(l));
  assert.deepEqual(
    suspeitas,
    [],
    `use o padrão sem \\b — a versão é seguida de "_":\n  ${suspeitas.join("\n  ")}`
  );
});

/** Devolve o bloco `run:` de um passo, pelo nome. */
function runDoPasso(nome) {
  const i = wf.indexOf(`- name: ${nome}\n`);
  assert.ok(i >= 0, `passo "${nome}" não existe`);
  const linhas = wf.slice(i).split("\n");
  const iRun = linhas.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  assert.ok(iRun > 0 && iRun < 12, `passo "${nome}" não tem bloco "run: |"`);
  const recuo = linhas[iRun].match(/^(\s+)/)[1].length;
  const corpo = [];
  for (const linha of linhas.slice(iRun + 1)) {
    if (linha.trim() === "") { corpo.push(""); continue; }
    if (linha.match(/^(\s*)/)[1].length <= recuo) break;
    corpo.push(linha.slice(recuo + 2));
  }
  return corpo.join("\n").trimEnd();
}

test("AP-16: dry-run e aplicação usam `set -o pipefail`", () => {
  // Sem pipefail, `cmd | tee` devolve o status do TEE — quase sempre 0. Uma
  // falha do CLI passaria despercebida e a rota seguiria em frente achando que
  // tudo correu bem. É o tipo de defeito que só aparece no dia ruim.
  for (const passo of [
    "Dry-run obrigatório",
    "Aplicar — exatamente uma migration",
    "Verificação independente da migration aplicada",
  ]) {
    // Comentários fora antes de medir posição: o próprio comentário que
    // explica o pipefail cita `| tee`, e mediria contra si mesmo.
    const script = runDoPasso(passo)
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    assert.match(script, /set -o pipefail/, `"${passo}" perdeu o set -o pipefail`);
    const iPipefail = script.indexOf("set -o pipefail");
    const iPipe = script.indexOf("| tee");
    assert.ok(iPipe < 0 || iPipefail < iPipe, `"${passo}": pipefail depois do pipe não protege nada`);
  }
});

test("AP-17: `db push` de aplicação usa --yes (sem confirmação interativa)", () => {
  const script = runDoPasso("Aplicar — exatamente uma migration");
  assert.match(
    script,
    /supabase db push --yes /,
    "sem --yes o passo fica pendurado até o timeout se o CLI perguntar"
  );
});

test("AP-18: o destino é amarrado ao projeto de produção declarado", () => {
  const alvoPath = "scripts/ci/production-target.json";
  assert.ok(fs.existsSync(path.join(raiz, alvoPath)), `${alvoPath} ausente`);
  const alvo = JSON.parse(ler(alvoPath));

  assert.match(alvo.project_ref, /^[a-z]{20}$/, "project_ref com formato inesperado");
  assert.ok(alvo.conexoes_aceitas.length > 0, "nenhuma conexão declarada");

  // Toda conexão declarada tem de amarrar o ref no host OU no usuário. É o que
  // impede alguém de acrescentar um destino solto ao arquivo.
  for (const c of alvo.conexoes_aceitas) {
    const noHost = (c.host ?? c.host_padrao ?? "").includes(alvo.project_ref);
    const noUsuario = (c.usuario ?? "").includes(alvo.project_ref);
    assert.ok(
      noHost || noUsuario,
      `conexão "${c.modo}" não amarra o project ref nem no host nem no usuário`
    );
  }

  // sslmode: os três fracos têm de estar recusados e fora dos aceitos.
  for (const fraco of ["disable", "allow", "prefer"]) {
    assert.ok(alvo.sslmode_recusados.includes(fraco), `sslmode "${fraco}" não está recusado`);
    assert.ok(!alvo.sslmode_aceitos.includes(fraco), `sslmode "${fraco}" está entre os aceitos`);
  }

  const parser = ler("scripts/ci/parse-db-url.mjs");
  assert.match(parser, /production-target\.json/, "o parser não consulta o alvo declarado");
  assert.match(parser, /sslmode_recusados/, "o parser não aplica a lista de sslmode recusados");
});

test("AP-19: toda opção do choice tem verificação independente pós-aplicação", () => {
  for (const opcao of opcoesDoChoice()) {
    const versao = opcao.slice(0, 14);
    const arquivo = `scripts/ci/verify-applied/${versao}.sql`;
    assert.ok(fs.existsSync(path.join(raiz, arquivo)), `${arquivo} ausente para ${opcao}`);

    const sql = ler(arquivo);
    // Somente leitura, de verdade.
    assert.match(sql, /BEGIN TRANSACTION READ ONLY;/, `${arquivo}: transação não é READ ONLY`);
    assert.match(sql, /^ROLLBACK;$/m, `${arquivo}: não termina em ROLLBACK`);
    assert.doesNotMatch(sql, /^\s*COMMIT;/m, `${arquivo}: contém COMMIT`);

    // Sem fixtures: nada de escrever em produção para testar comportamento.
    const executavel = sql.replace(/--[^\n]*/g, " ");
    for (const proibido of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i, /\bCREATE\s+(TEMP|TEMPORARY)\b/i, /set_config\s*\(/i]) {
      assert.doesNotMatch(executavel, proibido, `${arquivo}: cria ou altera dado em produção`);
    }
    // O `\b` do PostgreSQL é backspace — mesma armadilha da TG-12C.
    assert.doesNotMatch(executavel, /\\b/, `${arquivo}: usa \\b em regex do PostgreSQL; use \\y`);
  }

  assert.match(wf, /verify-applied\/\$\{VERSAO\}\.sql/, "a rota não executa a verificação independente");
});

test("AP-20: logs crus não são publicados; só os sanitizados", () => {
  const executavel = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  // O `tee` dos passos que veem a credencial tem de ir para fora de artifacts/.
  for (const m of executavel.matchAll(/\| tee (\S+)/g)) {
    assert.ok(
      !m[1].startsWith("artifacts/"),
      `log cru publicado diretamente: ${m[1]} — sanitize antes`
    );
  }
  // E cada log cru precisa de um passo de sanitização correspondente.
  for (const cru of [
    "/tmp/dry-run.raw.log",
    "/tmp/push.raw.log",
    "/tmp/verify-applied.raw.log",
    "/tmp/preconditions.raw.log",
  ]) {
    assert.ok(
      executavel.includes(`sanitize-log.mjs ${cru} artifacts/`),
      `${cru} não é sanitizado antes de virar artefato`
    );
  }
  assert.ok(fs.existsSync(path.join(raiz, "scripts/ci/sanitize-log.mjs")), "sanitize-log.mjs ausente");
  // E a varredura final tem de existir.
  assert.match(executavel, /Guarda — nenhum artefato contém credencial/);
});

test("AP-21: todas as Actions da rota estão fixadas em SHA imutável", () => {
  const usos = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(usos.length >= 4, "esperava pelo menos quatro Actions na rota");
  for (const uso of usos) {
    const [, ref] = uso.split("@");
    assert.ok(ref, `uses sem ref: ${uso}`);
    assert.match(
      ref,
      /^[0-9a-f]{40}$/,
      `${uso} não está fixado em SHA de 40 dígitos — tag e branch são alvos móveis`
    );
  }
});

console.log("");
console.log(`Migration apply guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
