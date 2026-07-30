/**
 * CONFERÊNCIA DO LEDGER LOCAL DE MIGRATIONS
 *
 * Uso:
 *   node scripts/ci/check-ledger.mjs <ledger.tsv>
 *
 * `<ledger.tsv>` é a saída de uma consulta somente leitura a
 * supabase_migrations.schema_migrations do Postgres LOCAL e descartável, com
 * três campos por linha: version, name, quantidade de statements.
 *
 * Exige correspondência EXATA com supabase/baseline/applied-migrations.tsv:
 * mesmas 36 versões, mesmos nomes, sem ausência, sem duplicidade, sem versão
 * adicional, na mesma ordem crescente.
 *
 * Não toca em banco. Recebe um arquivo e compara texto.
 *
 * ── LIMITE DECLARADO ────────────────────────────────────────────────────────
 *
 * A conferência é de (version, name). NÃO compara o md5_norm do manifesto com
 * o conteúdo de `statements` do ledger local, e a razão é concreta: no
 * histórico remoto cada versão tem o arquivo inteiro em `statements[1]` — é a
 * isso que o md5_norm do manifesto se refere —, enquanto o CLI, ao aplicar
 * localmente, PARTE o arquivo em vários statements. Os dois formatos não são
 * comparáveis por hash sem uma remontagem que introduziria suposição.
 *
 * A fidelidade do CONTEÚDO dos 36 arquivos é provada em outro lugar e por
 * outro meio: tests/verify-recovered-migrations.mjs confere os 36 md5_norm
 * contra o manifesto, e roda no mesmo job antes da aplicação. Este script
 * prova o que aquele não prova — que o conjunto aplicado é exatamente aquele
 * conjunto, sem falta nem sobra.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "../../tests/lib/manifest.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFESTO = path.join(raiz, "supabase/baseline/applied-migrations.tsv");

const arquivo = process.argv[2];
if (!arquivo) {
  console.error("uso: node scripts/ci/check-ledger.mjs <ledger.tsv>");
  process.exit(2);
}

const esperadas = parseManifest(fs.readFileSync(MANIFESTO, "utf8"));

// O ledger vem do psql em modo -A -t: campos separados por '|' na consulta que
// o gera, mas aqui aceitamos TAB ou '|' e fazemos trim por campo — a mesma
// lição de CRLF que motivou tests/lib/manifest.mjs.
const linhas = fs
  .readFileSync(arquivo, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l !== "");

const obtidas = linhas.map((linha) => {
  const campos = linha.split(/\t|\|/).map((c) => c.trim());
  return { version: campos[0], name: campos[1] ?? "", statements: campos[2] ?? "?" };
});

const problemas = [];

// ── Duplicidade ─────────────────────────────────────────────────────────────
const contagem = new Map();
for (const { version } of obtidas) {
  contagem.set(version, (contagem.get(version) ?? 0) + 1);
}
for (const [version, n] of contagem) {
  if (n > 1) problemas.push(`versão duplicada no ledger: ${version} (${n}×)`);
}

// ── Ausência, e classificação do excedente ──────────────────────────────────
//
// Antes da primeira migration forward-only, qualquer versão fora do manifesto
// era violação. Agora o ledger legitimamente contém as 36 históricas MAIS as
// forward-only aplicadas na reconstrução. A distinção é por faixa: versão
// posterior à última histórica é forward-only; versão fora do manifesto e
// dentro ou antes da faixa congelada é intercalação, e continua reprovada.
const esperadasPorVersao = new Map(esperadas.map((e) => [e.version, e]));
const obtidasPorVersao = new Map(obtidas.map((o) => [o.version, o]));
const limiteCongelado = esperadas.map((e) => e.version).sort().at(-1);
const forwardOnly = [];

for (const e of esperadas) {
  if (!obtidasPorVersao.has(e.version)) {
    problemas.push(`versão histórica AUSENTE do ledger: ${e.version} ${e.name}`);
  }
}
for (const o of obtidas) {
  if (esperadasPorVersao.has(o.version)) continue;
  if (o.version > limiteCongelado) {
    forwardOnly.push(o);
  } else {
    problemas.push(
      `versão ${o.version} (${o.name}) não consta do manifesto e não é posterior ` +
        `à última histórica ${limiteCongelado} — intercalada na faixa congelada`
    );
  }
}

// ── Nome ────────────────────────────────────────────────────────────────────
for (const e of esperadas) {
  const o = obtidasPorVersao.get(e.version);
  if (o && o.name !== e.name) {
    problemas.push(`nome divergente em ${e.version}: ledger="${o.name}" manifesto="${e.name}"`);
  }
}

// ── Contagem e ordem ────────────────────────────────────────────────────────
if (obtidas.length !== esperadas.length + forwardOnly.length) {
  problemas.push(
    `ledger tem ${obtidas.length} versão(ões); esperadas ` +
      `${esperadas.length} históricas + ${forwardOnly.length} forward-only`
  );
}

const ordenadas = [...obtidas].sort((a, b) => a.version.localeCompare(b.version));
if (obtidas.map((o) => o.version).join(",") !== ordenadas.map((o) => o.version).join(",")) {
  problemas.push("o ledger não está em ordem crescente de versão");
}

// ── Relatório ───────────────────────────────────────────────────────────────
console.log("LEDGER LOCAL — supabase_migrations.schema_migrations");
console.log("");
console.log("  #   version          statements  name");
const foSet = new Set(forwardOnly.map((o) => o.version));
obtidas.forEach((o, i) => {
  const marca = esperadasPorVersao.has(o.version) ? " " : foSet.has(o.version) ? "+" : "!";
  console.log(
    `${marca} ${String(i + 1).padStart(2)}  ${o.version}  ${String(o.statements).padStart(10)}  ${o.name}`
  );
});
console.log("");
console.log("  legenda: (espaço) histórica congelada · + forward-only · ! não classificada");
console.log(`  históricas verificadas ... ${esperadas.length - problemas.filter((p) => p.includes("AUSENTE")).length}/${esperadas.length}`);
console.log(`  forward-only ............. ${forwardOnly.length}`);
console.log(`  total no ledger .......... ${obtidas.length}`);

if (problemas.length > 0) {
  console.error("");
  console.error("LEDGER REPROVADO:");
  for (const p of problemas) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log("");
console.log(
  `✓ ledger confere: as ${esperadas.length} versões históricas, sem ausência, sem ` +
    `duplicidade e sem intercalação, mais ${forwardOnly.length} forward-only, em ` +
    `ordem crescente.`
);
for (const f of forwardOnly) console.log(`    forward-only: ${f.version} ${f.name}`);
