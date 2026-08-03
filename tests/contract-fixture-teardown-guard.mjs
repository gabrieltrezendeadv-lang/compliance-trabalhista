/**
 * GUARDA DA LIMPEZA DE FIXTURES DO CONTRATO
 *
 * `scripts/ci/teardown-contract-fixtures.sql` é a única operação do repositório
 * que afrouxa uma proteção de billing: ela desliga os triggers de imutabilidade
 * para poder apagar. Cinco cercas a limitam, e este arquivo prova que cada uma
 * está no lugar E que retirá-la reprova.
 *
 *   1. destino loopback ..... decidido no wrapper, ANTES de qualquer conexão
 *   2. proprietário ......... quem não é dono do schema billing não passa
 *   3. LOCAL ................ o afrouxamento morre no COMMIT
 *   4. prefixo determinístico  todo DELETE filtra pelo UUID das fixtures
 *   5. conferência .......... removidas = existentes, e zero sobreviventes
 *
 * ── AS CERCAS 1 E 5 SÃO TESTADAS EXECUTANDO, NÃO LENDO ──────────────────────
 *
 * O wrapper é rodado de verdade, com um `psql` DUBLÊ no PATH que registra se
 * foi chamado. É assim que se prova que a recusa acontece ANTES da conexão:
 * não basta o wrapper sair com 1, o dublê tem de NÃO ter sido invocado. Uma
 * asserção sobre o texto do script não distinguiria "recusou antes" de
 * "conectou e depois recusou".
 *
 * Nenhum banco é contatado em teste algum deste arquivo.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SQL = path.join(raiz, "scripts/ci/teardown-contract-fixtures.sql");
const SH = path.join(raiz, "scripts/ci/teardown-contract-fixtures.sh");

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

const sql = () => fs.readFileSync(SQL, "utf8");
const sh = () => fs.readFileSync(SH, "utf8");

/** Linhas de SQL fora de comentário — comentário não executa nada. */
function sqlExecutavel(texto) {
  return texto
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
}

const PREFIXO = "0c07a000-0000-4000-8000-%";

// ── CERCA 3: SET LOCAL ──────────────────────────────────────────────────────

test("FT-01: o afrouxamento é SET LOCAL, e existe exatamente um", () => {
  const exec = sqlExecutavel(sql());
  const todos = exec.match(/^\s*SET\s+(LOCAL\s+)?session_replication_role/gim) ?? [];
  assert.equal(todos.length, 1, `há ${todos.length} SET de session_replication_role, esperado 1`);
  assert.match(
    todos[0],
    /SET\s+LOCAL\s+session_replication_role/i,
    "o SET perdeu o LOCAL — o afrouxamento sobreviveria ao COMMIT e vazaria para a sessão"
  );
});

test("FT-02: o afrouxamento está DENTRO de uma transação", () => {
  const exec = sqlExecutavel(sql());
  const iBegin = exec.search(/^\s*BEGIN;/m);
  const iSet = exec.search(/^\s*SET LOCAL session_replication_role/im);
  const iCommit = exec.search(/^\s*COMMIT;/m);
  assert.ok(iBegin >= 0, "não há BEGIN");
  assert.ok(iCommit > iBegin, "não há COMMIT depois do BEGIN");
  assert.ok(iSet > iBegin && iSet < iCommit, "o SET LOCAL caiu fora da transação");
});

test("FT-03: a restauração pós-COMMIT é conferida", () => {
  const exec = sqlExecutavel(sql());
  const iCommit = exec.search(/^\s*COMMIT;/m);
  const depois = exec.slice(iCommit);
  assert.match(depois, /session_replication_role/, "nada confere a restauração depois do COMMIT");
  assert.match(depois, /<>\s*'origin'/, "a conferência pós-COMMIT não exige o valor 'origin'");
  assert.match(depois, /RAISE EXCEPTION/, "a conferência pós-COMMIT não reprova");
});

// ── CERCA 4: FILTRO DETERMINÍSTICO, SEM LIMPEZA AMPLA ───────────────────────

test("FT-04: todo DELETE filtra pelas fixtures — nenhum sem WHERE", () => {
  const exec = sqlExecutavel(sql());
  const deletes = [...exec.matchAll(/DELETE\s+FROM\s+([a-z_]+\.[a-z_]+)([\s\S]*?)(?=RETURNING|;)/gi)];
  assert.ok(deletes.length >= 14, `apenas ${deletes.length} DELETE(s) encontrados, esperados 14`);
  for (const [, tabela, resto] of deletes) {
    assert.match(resto, /\bWHERE\b/i, `DELETE em ${tabela} sem WHERE — é limpeza ampla`);
    assert.match(
      resto,
      /PREFIXO/,
      `DELETE em ${tabela} não filtra pelo prefixo de fixture`
    );
  }
});

test("FT-05: não há TRUNCATE, DROP nem DELETE sem qualificação", () => {
  const exec = sqlExecutavel(sql());
  assert.doesNotMatch(exec, /\bTRUNCATE\b/i, "TRUNCATE apaga a tabela inteira");
  assert.doesNotMatch(exec, /\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i, "DROP não é limpeza de fixture");
  assert.doesNotMatch(
    exec,
    /DELETE\s+FROM\s+[a-z_.]+\s*;/i,
    "há DELETE sem WHERE — limpeza ampla"
  );
});

test("FT-06: o prefixo é determinístico e escrito UMA vez", () => {
  const exec = sqlExecutavel(sql());
  const literais = [...exec.matchAll(/0c07a000-0000-4000-8000-%/g)];
  assert.equal(
    literais.length,
    1,
    `o prefixo aparece ${literais.length} vezes no SQL executável; deve ser definido uma só vez e lido de _contrato_prefixo`
  );
  assert.match(exec, /\\set PREFIXO '0c07a000-0000-4000-8000-%'/, "o \\set do prefixo sumiu");
});

test("FT-07: o prefixo do teardown é o mesmo que o seed produz", () => {
  const seed = fs.readFileSync(path.join(raiz, "scripts/ci/seed-contract-fixtures.sql"), "utf8");
  const base = PREFIXO.slice(0, -1);
  assert.ok(
    seed.includes(base),
    `o seed não usa o prefixo ${base} — teardown e seed divergiram e a limpeza não acharia nada`
  );
});

// ── CERCA 2: PROPRIETÁRIO ───────────────────────────────────────────────────

test("FT-08: só o proprietário do schema billing executa", () => {
  const exec = sqlExecutavel(sql());
  assert.match(exec, /pg_has_role\s*\(\s*current_user/i, "não há verificação de proprietário");
  assert.match(exec, /nspowner/, "o dono não é lido de pg_namespace");
  assert.match(exec, /insufficient_privilege/, "a recusa de não-proprietário não tem ERRCODE");
  const iDono = exec.search(/pg_has_role/i);
  const iDelete = exec.search(/DELETE\s+FROM/i);
  assert.ok(iDono >= 0 && iDono < iDelete, "a verificação de proprietário vem DEPOIS do primeiro DELETE");
});

// ── CERCA 5: CONFERÊNCIA ────────────────────────────────────────────────────

test("FT-09: as linhas removidas são contadas e comparadas com as existentes", () => {
  const exec = sqlExecutavel(sql());
  assert.match(exec, /_contrato_antes/, "não há contagem prévia");
  assert.match(exec, /_contrato_removidas/, "não há contagem de removidas");
  const inserts = (exec.match(/INSERT INTO _contrato_removidas/g) ?? []).length;
  assert.equal(inserts, 14, `${inserts} DELETE(s) contabilizado(s), esperados 14`);
  assert.match(exec, /IS DISTINCT FROM/, "antes e removidas não são comparadas");
  assert.match(exec, /nao removeu tudo o que existia/, "a divergência não reprova");
});

test("FT-09b: toda tabela temporária referenciada é criada neste arquivo", () => {
  // Esta asserção existe porque a reescrita das contagens deixou para trás uma
  // referência a `_contrato_tally`, uma tabela que havia deixado de ser criada.
  // Nenhuma asserção de presença pegaria isso: só uma de ausência pega.
  const exec = sqlExecutavel(sql());
  const criadas = new Set(
    [...exec.matchAll(/CREATE TEMP TABLE (_[a-z_]+)/g)].map((m) => m[1])
  );
  const referenciadas = new Set([...exec.matchAll(/(_contrato_[a-z_]+)/g)].map((m) => m[1]));
  const orfas = [...referenciadas].filter((t) => !criadas.has(t));
  assert.deepEqual(orfas, [], `tabela(s) temporária(s) referenciada(s) sem CREATE: ${orfas.join(", ")}`);
});

test("FT-10: a conferência final exige zero fixtures sobreviventes", () => {
  const exec = sqlExecutavel(sql());
  assert.match(exec, /fixture\(s\) sobreviveram/, "não há conferência de sobreviventes");
  const iCommit = exec.search(/^\s*COMMIT;/m);
  assert.ok(
    exec.indexOf("fixture(s) sobreviveram") > iCommit,
    "a conferência de sobreviventes roda ANTES do COMMIT — não provaria nada"
  );
});

// ── CERCA 1: LOOPBACK, PROVADO EXECUTANDO ───────────────────────────────────

/** Monta um PATH com `psql` dublê e roda o wrapper. */
function rodarWrapper({ dbUrl, contagemBilling = "1", scriptSh = SH }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "teardown-dub-"));
  const marcador = path.join(dir, "psql-foi-chamado.txt");
  const stub = path.join(dir, "psql");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env bash\n` +
      `echo "$@" >> ${JSON.stringify(marcador)}\n` +
      `for a in "$@"; do [ "$a" = "-f" ] && exit 0; done\n` +
      `echo ${JSON.stringify(contagemBilling)}\n`,
    { mode: 0o755 }
  );
  const env = { ...process.env, PGBIN: dir };
  if (dbUrl === undefined) delete env.DB_URL;
  else env.DB_URL = dbUrl;

  let code = 0;
  let out = "";
  try {
    out = execFileSync("bash", [scriptSh], { cwd: raiz, encoding: "utf8", stdio: "pipe", env });
  } catch (e) {
    code = e.status ?? 1;
    out = (e.stdout ?? "") + (e.stderr ?? "");
  }
  const chamado = fs.existsSync(marcador);
  const argumentos = chamado ? fs.readFileSync(marcador, "utf8") : "";
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, out, chamado, argumentos };
}

test("FT-11: destino não-loopback REPROVA sem sequer conectar", () => {
  const r = rodarWrapper({ dbUrl: "postgresql://u:p@db.exemplo.invalido:5432/postgres" });
  assert.equal(r.code, 1, `o wrapper aceitou destino remoto:\n${r.out}`);
  assert.match(r.out, /NÃO é loopback/);
  assert.equal(r.chamado, false, "o psql FOI invocado — a recusa aconteceu depois de conectar");
});

test("FT-12: a URI não é impressa na recusa (ela carrega senha)", () => {
  const r = rodarWrapper({ dbUrl: "postgresql://usuario:senha-secreta@db.exemplo.invalido:5432/postgres" });
  assert.doesNotMatch(r.out, /senha-secreta/, "a senha vazou na mensagem de recusa");
  assert.doesNotMatch(r.out, /postgresql:\/\//, "a URI inteira foi impressa");
});

test("FT-13: loopback é aceito e chega ao psql", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    const r = rodarWrapper({ dbUrl: `postgresql://u:p@${host}:54322/postgres` });
    assert.equal(r.code, 0, `${host} foi recusado:\n${r.out}`);
    assert.equal(r.chamado, true, `${host} não chegou ao psql`);
    assert.match(r.argumentos, /-f .*teardown-contract-fixtures\.sql/, `${host} não executou o .sql`);
  }
});

test("FT-14: sem DB_URL, sai 0 e não conecta", () => {
  const r = rodarWrapper({ dbUrl: undefined });
  assert.equal(r.code, 0);
  assert.equal(r.chamado, false, "conectou sem DB_URL");
  assert.match(r.out, /nada a limpar/);
});

test("FT-15: sem o schema billing, sai 0 e NÃO roda o .sql", () => {
  const r = rodarWrapper({ dbUrl: "postgresql://u:p@127.0.0.1:54322/postgres", contagemBilling: "0" });
  assert.equal(r.code, 0);
  assert.equal(r.chamado, true, "nem sondou o schema");
  assert.doesNotMatch(r.argumentos, /-f/, "rodou o .sql mesmo sem o schema billing");
});

test("FT-16: a sonda do schema vem DEPOIS da decisão de loopback", () => {
  const texto = sh();
  const iCase = texto.search(/case "\$host" in/);
  const iSonda = texto.search(/nspname='billing'/);
  assert.ok(iCase >= 0, "a decisão de loopback sumiu do wrapper");
  assert.ok(iSonda > iCase, "o wrapper sonda o banco ANTES de decidir o destino");
});

// ── MUTAÇÕES ────────────────────────────────────────────────────────────────
//
// Cada mutação é aplicada ao ARQUIVO REAL, o teste correspondente é reexecutado
// e tem de reprovar. O original é restaurado em `finally`, sempre.

/** Aplica `mutar` ao arquivo, roda `verificar`, e exige que ela lance. */
function mutacao(nome, arquivo, mutar, verificar) {
  test(nome, () => {
    const original = fs.readFileSync(arquivo, "utf8");
    const mutado = mutar(original);
    assert.notEqual(mutado, original, "a mutação não casou o texto — reescreva-a");
    fs.writeFileSync(arquivo, mutado, "utf8");
    try {
      assert.throws(
        () => verificar(),
        (e) => e instanceof assert.AssertionError || e instanceof Error,
        "a mutação PASSOU — a cerca não está sendo verificada"
      );
    } finally {
      fs.writeFileSync(arquivo, original, "utf8");
    }
  });
}

mutacao(
  "FT-M1: retirar o LOCAL do SET é DETECTADO",
  SQL,
  (s) => s.replace(/^SET LOCAL session_replication_role/m, "SET session_replication_role"),
  () => {
    const exec = sqlExecutavel(sql());
    const todos = exec.match(/^\s*SET\s+(LOCAL\s+)?session_replication_role/gim) ?? [];
    assert.match(todos[0], /SET\s+LOCAL\s+session_replication_role/i);
  }
);

mutacao(
  "FT-M2: retirar a proteção loopback do wrapper é DETECTADO",
  SH,
  (s) => s.replace(/  127\.0\.0\.1\|localhost\|::1\|'\[::1\]'\)/, "  *)"),
  () => {
    const r = rodarWrapper({ dbUrl: "postgresql://u:p@db.exemplo.invalido:5432/postgres" });
    assert.equal(r.code, 1, "destino remoto foi aceito");
    assert.equal(r.chamado, false, "o psql foi invocado para destino remoto");
  }
);

mutacao(
  "FT-M3: retirar o filtro de fixtures de um DELETE é DETECTADO",
  SQL,
  // Âncora por regex, não por string: o checkout Windows traz CRLF e um `\n`
  // literal não casaria.
  (s) =>
    s.replace(
      /  DELETE FROM billing\.charges\r?\n   WHERE organization_id::text LIKE :'PREFIXO' RETURNING 1\)/,
      "  DELETE FROM billing.charges RETURNING 1)"
    ),
  () => {
    const exec = sqlExecutavel(sql());
    const deletes = [...exec.matchAll(/DELETE\s+FROM\s+([a-z_]+\.[a-z_]+)([\s\S]*?)(?=RETURNING|;)/gi)];
    for (const [, tabela, resto] of deletes) {
      assert.match(resto, /\bWHERE\b/i, `DELETE em ${tabela} sem WHERE`);
      assert.match(resto, /PREFIXO/, `DELETE em ${tabela} sem prefixo`);
    }
  }
);

mutacao(
  "FT-M4: limpeza genérica (TRUNCATE) é DETECTADA",
  SQL,
  (s) => s.replace("BEGIN;", "BEGIN;\n\nTRUNCATE billing.charges;"),
  () => {
    const exec = sqlExecutavel(sql());
    assert.doesNotMatch(exec, /\bTRUNCATE\b/i);
  }
);

mutacao(
  "FT-M5: uso fora da stack descartável (host arbitrário aceito) é DETECTADO",
  SH,
  (s) => s.replace(/^host="\$\(printf.*$/m, 'host="127.0.0.1"'),
  () => {
    const r = rodarWrapper({ dbUrl: "postgresql://u:p@producao.exemplo.invalido:5432/postgres" });
    assert.equal(r.code, 1, "um destino de produção seria aceito pelo wrapper");
  }
);

mutacao(
  "FT-M6: retirar a verificação de proprietário é DETECTADO",
  SQL,
  (s) => s.replace(/IF NOT pg_catalog\.pg_has_role/, "IF false AND pg_catalog.pg_has_role"),
  () => {
    const exec = sqlExecutavel(sql());
    assert.match(exec, /IF NOT pg_catalog\.pg_has_role\s*\(\s*current_user/i);
  }
);

mutacao(
  "FT-M7: retirar a conferência de removidas é DETECTADO",
  SQL,
  (s) => s.replace(/WHERE a\.n IS DISTINCT FROM r\.n;/, "WHERE false; -- mutado"),
  () => {
    const exec = sqlExecutavel(sql());
    assert.match(exec, /IS DISTINCT FROM/);
  }
);

mutacao(
  "FT-M8: retirar a conferência de restauração pós-COMMIT é DETECTADO",
  SQL,
  (s) => s.replace(/IF v_atual <> 'origin' THEN/, "IF false THEN"),
  () => {
    const exec = sqlExecutavel(sql());
    const depois = exec.slice(exec.search(/^\s*COMMIT;/m));
    assert.match(depois, /<>\s*'origin'/);
  }
);

// ─── Fim ────────────────────────────────────────────────────────────────────

console.log("");
console.log(`Contract fixture teardown guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
