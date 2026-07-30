/**
 * GUARDA DA CLASSIFICAÇÃO HISTÓRICAS × FORWARD-ONLY
 *
 * `tests/lib/migrations.mjs` passou a permitir migrations com versão posterior à
 * faixa congelada. Essa permissão é necessária — sem ela o histórico nunca mais
 * evolui — e é, nesse único eixo, um relaxamento da regra anterior ("nenhuma
 * versão fora do manifesto").
 *
 * Um relaxamento não verificado é um buraco. Estes testes exercem a
 * classificação sobre diretórios sintéticos e exigem que ela ACUSE cada forma de
 * violação que a regra antiga pegava, mais as novas. Nada é lido do repositório.
 *
 * A guarda de congelamento (MF-08, MF-08b, MF-18, MF-19, MF-22) usa o mesmo
 * módulo contra o diretório real; aqui a lógica é exercida em separado, porque
 * asserção que nunca reprova nada é indistinguível de asserção ausente.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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

/** Cria um diretório temporário com os nomes de arquivo dados. */
function comArquivos(nomes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-class-"));
  for (const n of nomes) fs.writeFileSync(path.join(dir, n), "-- vazio\n");
  return dir;
}

const HISTORICAS = ["20260724013538", "20260726004230", "20260728191324"];
const BASE = [
  "20260724013538_foundation.sql",
  "20260726004230_sec006.sql",
  "20260728191324_fix_005.sql",
];

test("MC-01: as três históricas, sem forward-only, são aceitas", () => {
  const c = classificarMigrations(comArquivos(BASE), HISTORICAS);
  assert.deepEqual(c.problemas, []);
  assert.equal(c.historicas.length, 3);
  assert.equal(c.forwardOnly.length, 0);
  assert.equal(c.total, 3);
});

test("MC-02: forward-only posterior à faixa é aceita e classificada", () => {
  const c = classificarMigrations(
    comArquivos([...BASE, "20260730123613_revoke_public_webhook_execute.sql"]),
    HISTORICAS
  );
  assert.deepEqual(c.problemas, []);
  assert.equal(c.historicas.length, 3);
  assert.equal(c.forwardOnly.length, 1);
  assert.equal(c.forwardOnly[0].version, "20260730123613");
  assert.equal(c.total, 4);
});

test("MC-03: versão INTERCALADA na faixa congelada é reprovada", () => {
  // O caso perigoso: para o CLI o arquivo parece pendente, e ele o aplicaria
  // contra um banco onde o DDL equivalente já existe.
  const c = classificarMigrations(
    comArquivos([...BASE, "20260727000000_intercalada.sql"]),
    HISTORICAS
  );
  assert.ok(
    c.problemas.some((p) => p.includes("intercalada")),
    `deveria acusar intercalação: ${JSON.stringify(c.problemas)}`
  );
});

test("MC-04: versão anterior a toda a faixa é reprovada", () => {
  const c = classificarMigrations(
    comArquivos([...BASE, "20260101000000_antiga.sql"]),
    HISTORICAS
  );
  assert.ok(
    c.problemas.some((p) => p.includes("20260101000000")),
    `deveria acusar versão anterior à faixa: ${JSON.stringify(c.problemas)}`
  );
});

test("MC-05: versão exatamente igual à última histórica não vira forward-only", () => {
  // Fronteira: o limite é ESTRITAMENTE maior. Versão igual à última histórica
  // sem constar do manifesto é duplicidade de faixa, não evolução.
  const c = classificarMigrations(
    comArquivos([...BASE, "20260728191324_outro_nome.sql"]),
    HISTORICAS
  );
  assert.ok(
    c.problemas.length > 0,
    `deveria reprovar versão igual à última histórica: ${JSON.stringify(c.problemas)}`
  );
});

test("MC-06: histórica ausente é reprovada", () => {
  const c = classificarMigrations(comArquivos(BASE.slice(1)), HISTORICAS);
  assert.ok(
    c.problemas.some((p) => p.includes("AUSENTE") && p.includes("20260724013538")),
    `deveria acusar ausência: ${JSON.stringify(c.problemas)}`
  );
});

test("MC-07: versão duplicada é reprovada", () => {
  const c = classificarMigrations(
    comArquivos([...BASE, "20260724013538_duplicada.sql"]),
    HISTORICAS
  );
  assert.ok(
    c.problemas.some((p) => p.includes("duplicada")),
    `deveria acusar duplicidade: ${JSON.stringify(c.problemas)}`
  );
});

test("MC-08: nome fora do padrão é reprovado", () => {
  const c = classificarMigrations(comArquivos([...BASE, "sem_prefixo.sql"]), HISTORICAS);
  assert.ok(
    c.problemas.some((p) => p.includes("fora do padrão")),
    `deveria acusar nome inválido: ${JSON.stringify(c.problemas)}`
  );
});

test("MC-09: o resumo informa históricas e forward-only separadamente", () => {
  const c = classificarMigrations(
    comArquivos([...BASE, "20260730123613_nova.sql"]),
    HISTORICAS
  );
  const r = resumo(c);
  assert.match(r, /3 histórica\(s\) verificada\(s\)/);
  assert.match(r, /1 forward-only pendente/);
  assert.match(r, /total 4/);
});

test("MC-10: o diretório real tem as 36 históricas e as forward-only declaradas", () => {
  const tsv = fs.readFileSync(
    path.join(root, "supabase/baseline/applied-migrations.tsv"),
    "utf8"
  );
  const versoes = parseManifest(tsv).map((r) => r.version);
  const c = classificarMigrations(path.join(root, "supabase/migrations"), versoes);
  assert.deepEqual(c.problemas, []);
  assert.equal(c.historicas.length, 36);
  console.log(`       (real: ${resumo(c)})`);
});

console.log("");
console.log(`Migration classification guard: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
