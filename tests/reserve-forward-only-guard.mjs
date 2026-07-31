/**
 * A RESERVA RESPEITA O LEDGER REMOTO
 *
 * A execução nº 5 da rota falhou porque a reserva removia toda forward-only
 * diferente da selecionada — inclusive `20260730123613`, que já estava
 * APLICADA no banco. O CLI recusou, com razão:
 *
 *   Remote migration versions not found in local migrations directory.
 *
 * Estes testes exercitam a regra corrigida contra diretórios sintéticos e
 * contra o ledger REAL lido do banco na execução nº 5 (37 registros).
 *
 * Nenhum teste depende de `20260730123613` ou `20260731094500` por nome: os
 * cenários são montados com versões arbitrárias, para que a regra continue
 * coberta em qualquer sequência futura.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "./lib/manifest.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "scripts/ci/reserve-forward-only.mjs";

const HISTORICAS = parseManifest(
  fs.readFileSync(path.join(raiz, "supabase/baseline/applied-migrations.tsv"), "utf8")
);
const LIMITE = HISTORICAS.at(-1).version;

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

const tmpRaiz = fs.mkdtempSync(path.join(os.tmpdir(), "reserva-"));

/**
 * Monta um diretório de migrations sintético: as 36 históricas (arquivos
 * vazios, o conteúdo não importa aqui) mais as forward-only pedidas.
 */
function montarDir(rotulo, forwardOnly) {
  const dir = path.join(tmpRaiz, rotulo, "migrations");
  fs.mkdirSync(dir, { recursive: true });
  for (const h of HISTORICAS) fs.writeFileSync(path.join(dir, `${h.version}_${h.name}.sql`), "");
  for (const f of forwardOnly) fs.writeFileSync(path.join(dir, f), "");
  return dir;
}

/** Escreve um ledger no formato que a rota entrega. */
function montarLedger(rotulo, versoesForwardOnlyAplicadas) {
  const linhas = HISTORICAS.map((h) => `${h.version}|${h.name}`);
  for (const v of versoesForwardOnlyAplicadas) linhas.push(`${v}|aplicada_${v}`);
  const arquivo = path.join(tmpRaiz, `${rotulo}-ledger.tsv`);
  fs.writeFileSync(arquivo, linhas.join("\n") + "\n", "utf8");
  return arquivo;
}

/** Roda o script real. `mover=false` usa o modo somente-relatar. */
function reservar(selecionada, ledger, dir, { mover = true } = {}) {
  const dirReserva = path.join(tmpRaiz, `reserva-${path.basename(path.dirname(dir))}`);
  try {
    const out = execFileSync("node", [SCRIPT, selecionada, ledger, dirReserva], {
      cwd: raiz,
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        RESERVA_DIR_MIGRATIONS: dir,
        ...(mover ? {} : { RESERVA_SOMENTE_RELATAR: "1" }),
      },
    });
    return { code: 0, out, dirReserva };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? ""), dirReserva };
  }
}

const arquivos = (dir) => fs.readdirSync(dir).sort();
const FO1 = `${Number(LIMITE) + 1000000}_primeira_fo.sql`;
const FO2 = `${Number(LIMITE) + 2000000}_segunda_fo.sql`;
const FO3 = `${Number(LIMITE) + 3000000}_terceira_fo.sql`;
const v = (f) => f.slice(0, 14);

// ══════════════════════════════════════════════════════════════════════════
test("RES-01: 36 históricas no ledger, PRIMEIRA forward-only selecionada → a segunda é reservada", () => {
  const dir = montarDir("c1", [FO1, FO2]);
  const ledger = montarLedger("c1", []);
  const r = reservar(FO1, ledger, dir);
  assert.equal(r.code, 0, r.out);

  assert.ok(fs.existsSync(path.join(dir, FO1)), "a selecionada tem de permanecer");
  assert.ok(!fs.existsSync(path.join(dir, FO2)), "a outra pendente tem de sair");
  assert.deepEqual(arquivos(r.dirReserva), [FO2]);
  assert.equal(arquivos(dir).length, 37, "36 históricas + a selecionada");
  assert.match(r.out, /exatamente uma pendente no diretório/);
});

test("RES-02: 37 no ledger com a primeira APLICADA, SEGUNDA selecionada → a aplicada permanece", () => {
  // É o cenário exato da execução nº 5.
  const dir = montarDir("c2", [FO1, FO2]);
  const ledger = montarLedger("c2", [v(FO1)]);
  const r = reservar(FO2, ledger, dir);
  assert.equal(r.code, 0, r.out);

  assert.ok(fs.existsSync(path.join(dir, FO1)), "a APLICADA não pode ser reservada");
  assert.ok(fs.existsSync(path.join(dir, FO2)), "a selecionada tem de permanecer");
  assert.deepEqual(arquivos(r.dirReserva), [], "nada deveria ter sido reservado");
  assert.equal(arquivos(dir).length, 38, "36 históricas + a aplicada + a selecionada");
  assert.match(r.out, new RegExp(`${v(FO1)}\\s+aplicada\\s+→ PERMANECE`));
});

test("RES-03: migration aplicada remotamente NUNCA é reservada", () => {
  // Três forward-only, duas aplicadas, a terceira selecionada.
  const dir = montarDir("c3", [FO1, FO2, FO3]);
  const ledger = montarLedger("c3", [v(FO1), v(FO2)]);
  const r = reservar(FO3, ledger, dir);
  assert.equal(r.code, 0, r.out);

  for (const aplicada of [FO1, FO2]) {
    assert.ok(fs.existsSync(path.join(dir, aplicada)), `${aplicada} foi reservada indevidamente`);
  }
  assert.deepEqual(arquivos(r.dirReserva), []);
});

test("RES-04: terceira forward-only PENDENTE e não selecionada é reservada", () => {
  const dir = montarDir("c4", [FO1, FO2, FO3]);
  const ledger = montarLedger("c4", [v(FO1)]);
  const r = reservar(FO2, ledger, dir);
  assert.equal(r.code, 0, r.out);

  assert.ok(fs.existsSync(path.join(dir, FO1)), "aplicada permanece");
  assert.ok(fs.existsSync(path.join(dir, FO2)), "selecionada permanece");
  assert.ok(!fs.existsSync(path.join(dir, FO3)), "a terceira, pendente, tem de ser reservada");
  assert.deepEqual(arquivos(r.dirReserva), [FO3]);
});

test("RES-05: versão do ledger SEM arquivo local reprova antes de chamar o CLI", () => {
  const dir = montarDir("c5", [FO2]); // FO1 aplicada, mas ausente do diretório
  const ledger = montarLedger("c5", [v(FO1)]);
  const r = reservar(FO2, ledger, dir);

  assert.equal(r.code, 1, "deveria reprovar");
  assert.match(r.out, /versão aplicada remotamente sem arquivo local/);
  assert.match(r.out, new RegExp(v(FO1)));
  // E tem de dizer o que NÃO fazer — sem citar os comandos proibidos, que as
  // guardas de congelamento não toleram nem como exemplo.
  assert.match(r.out, /NÃO 'conserte' o histórico marcando a versão como revertida/);
  assert.match(r.out, /NÃO puxe o esquema do remoto/);
  assert.ok(!fs.existsSync(r.dirReserva), "nada pode ter sido movido");
});

test("RES-06: histórica nunca é reservada, mesmo com muitas pendentes", () => {
  const dir = montarDir("c6", [FO1, FO2, FO3]);
  const ledger = montarLedger("c6", []);
  const r = reservar(FO1, ledger, dir);
  assert.equal(r.code, 0, r.out);

  for (const h of HISTORICAS) {
    assert.ok(
      fs.existsSync(path.join(dir, `${h.version}_${h.name}.sql`)),
      `histórica ${h.version} foi reservada`
    );
  }
  assert.deepEqual(arquivos(r.dirReserva), [FO2, FO3].sort());
});

test("RES-07: selecionada já aplicada reprova", () => {
  const dir = montarDir("c7", [FO1, FO2]);
  const ledger = montarLedger("c7", [v(FO1)]);
  const r = reservar(FO1, ledger, dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /já consta do ledger remoto — nada a aplicar/);
});

test("RES-08: ledger malformado reprova sem mover nada", () => {
  const dir = montarDir("c8", [FO1, FO2]);
  const ledger = path.join(tmpRaiz, "c8-sujo.tsv");
  fs.writeFileSync(ledger, "BEGIN\n" + fs.readFileSync(montarLedger("c8", []), "utf8"), "utf8");
  const r = reservar(FO2, ledger, dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /ledger malformado/);
  assert.ok(fs.existsSync(path.join(dir, FO1)), "nada pode ter sido movido");
});

// ══════════════════════════════════════════════════════════════════════════
// CENÁRIO REAL — ledger de 37 registros lido do banco na execução nº 5
// ══════════════════════════════════════════════════════════════════════════
test("RES-09: com o ledger REAL da execução nº 5, a aplicada permanece e nada é reservado", () => {
  const ledgerReal = path.join(raiz, "tests/fixtures/ledger-run5-37.tsv");
  assert.ok(fs.existsSync(ledgerReal), "fixture do ledger real ausente");

  const registros = fs
    .readFileSync(ledgerReal, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  assert.equal(registros.length, 37, "o ledger real da nº 5 tem 37 registros");

  // Diretório real do repositório, em cópia — as duas forward-only de verdade.
  const dir = path.join(tmpRaiz, "real", "migrations");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(raiz, "supabase/migrations"))) {
    if (f.endsWith(".sql")) {
      fs.copyFileSync(path.join(raiz, "supabase/migrations", f), path.join(dir, f));
    }
  }

  // As pendentes são DERIVADAS do diretório real e do ledger real, e não
  // fixadas em número. A versão anterior exigia exatamente uma e passou a
  // reprovar quando a terceira forward-only entrou no repositório — falha do
  // teste, não da regra. O que este cenário existe para provar continua
  // intacto: nenhuma versão do ledger sai do diretório.
  const pendentes = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 14) > LIMITE)
    .filter((f) => !registros.some((r) => r.startsWith(f.slice(0, 14))))
    .sort();
  assert.ok(pendentes.length >= 1, "o repositório deveria ter pendente neste ledger");

  // A rota só aceita a MAIS ANTIGA pendente (P8). Reservadas: as demais.
  const selecionada = pendentes[0];
  const esperadoReservado = pendentes.slice(1);

  const r = reservar(selecionada, ledgerReal, dir);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(
    arquivos(r.dirReserva ?? ""),
    esperadoReservado,
    "só as pendentes não selecionadas podem ser reservadas"
  );
  assert.ok(fs.existsSync(path.join(dir, selecionada)), "a selecionada tem de permanecer");

  // Toda versão do ledger continua com arquivo presente.
  for (const linha of registros) {
    const versao = linha.slice(0, 14);
    assert.ok(
      fs.readdirSync(dir).some((f) => f.startsWith(versao)),
      `a versão ${versao} do ledger sumiu do diretório`
    );
  }
});

test("RES-10: o workflow usa o script, e não a regra antiga", () => {
  const wf = fs
    .readFileSync(path.join(raiz, ".github/workflows/migration-apply.yml"), "utf8")
    .replace(/\r\n?/g, "\n");
  const executavel = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  assert.match(executavel, /reserve-forward-only\.mjs/, "o workflow não usa o script");
  assert.match(
    executavel,
    /reserve-forward-only\.mjs[^\n]*\\\n\s*"\$MIGRATION" artifacts\/ledger-antes\.tsv/,
    "o script tem de receber a selecionada E o ledger lido do banco"
  );
  // A regra antiga, que ignorava o ledger, não pode voltar.
  assert.doesNotMatch(
    executavel,
    /if \[ "\$F" != "\$MIGRATION" \]/,
    "voltou a reserva por 'toda forward-only diferente da selecionada'"
  );
  assert.doesNotMatch(executavel, /migration repair/, "migration repair é proibido");
  assert.doesNotMatch(executavel, /db pull/, "db pull é proibido");
  assert.doesNotMatch(executavel, /--include-all/, "--include-all é proibido");
});

fs.rmSync(tmpRaiz, { recursive: true, force: true });

console.log("");
console.log(`Reserva orientada pelo ledger: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
