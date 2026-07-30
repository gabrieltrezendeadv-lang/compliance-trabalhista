/**
 * PRÉ-CONDIÇÕES DA ROTA DE APLICAÇÃO DE MIGRATIONS
 *
 * Uso:
 *   node scripts/ci/assert-apply-preconditions.mjs <migration.sql> [ledger-remoto.tsv]
 *
 * Decide se UMA migration escolhida pode ser aplicada. Sai com 0 apenas quando
 * todas as condições valem. Qualquer dúvida é reprovação: a rota é o único
 * caminho autorizado até o banco de produção, e o custo de recusar uma
 * aplicação legítima é uma nova execução — o custo de aceitar uma indevida é
 * um banco divergente do repositório, que foi exatamente o estado que as Fases
 * 3 a 6 gastaram semanas desfazendo.
 *
 * ── O QUE É VERIFICADO ──────────────────────────────────────────────────────
 *
 *   P1  o arquivo existe em supabase/migrations/ e o nome segue o padrão
 *   P2  a classificação do diretório está íntegra (reusa tests/lib/migrations)
 *   P3  a versão NÃO pertence à faixa histórica congelada
 *   P4  a versão é forward-only conhecida — não um arquivo avulso
 *   P5  exatamente UMA migration foi selecionada
 *   P6  (com ledger) a versão ainda NÃO está aplicada
 *   P7  (com ledger) o ledger remoto não tem lacuna nem versão inesperada
 *   P8  (com ledger) a selecionada é a MAIS ANTIGA pendente — sem pular ordem
 *
 * ── POR QUE P8 EXISTE ───────────────────────────────────────────────────────
 *
 * Aplicar forward-only fora de ordem produz um banco que nenhuma reconstrução
 * reproduz: a âncora B do migration-rebuild-verify aplica as forward-only em
 * ordem crescente. Permitir salto aqui quebraria a equivalência que aquele
 * workflow prova, e a quebra só apareceria muito depois.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "../../tests/lib/manifest.mjs";
import { classificarMigrations } from "../../tests/lib/migrations.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(raiz, "supabase/migrations");

const selecionadaBruta = process.argv[2];
const ledgerArquivo = process.argv[3];

if (!selecionadaBruta) {
  console.error("uso: node scripts/ci/assert-apply-preconditions.mjs <migration.sql> [ledger.tsv]");
  process.exit(2);
}

const problemas = [];
const ok = [];

// ── P5: exatamente uma ──────────────────────────────────────────────────────
//
// A entrada é `choice` no workflow, então o GitHub já entrega um valor único.
// Isto defende contra a outra porta: alguém trocar `choice` por `string` e
// passar "a.sql b.sql" ou "a.sql,b.sql".
const selecionada = selecionadaBruta.trim();
if (selecionada === "") {
  problemas.push("P5: nenhuma migration selecionada");
} else if (/[\s,;]/.test(selecionada)) {
  problemas.push(
    `P5: mais de uma migration selecionada, ou separador inesperado: ${JSON.stringify(selecionada)}`
  );
} else if (selecionada !== path.basename(selecionada)) {
  problemas.push(`P5: a seleção deve ser um nome de arquivo, não um caminho: ${selecionada}`);
} else {
  ok.push("P5: exatamente uma migration selecionada");
}

const versoes = parseManifest(
  fs.readFileSync(path.join(raiz, "supabase/baseline/applied-migrations.tsv"), "utf8")
).map((r) => r.version);

const c = classificarMigrations(DIR, versoes);

// ── P2: classificação íntegra ───────────────────────────────────────────────
if (c.problemas.length > 0) {
  for (const p of c.problemas) problemas.push(`P2: ${p}`);
} else {
  ok.push(`P2: diretório íntegro — ${c.historicas.length} históricas, ${c.forwardOnly.length} forward-only`);
}

// ── P1: existe e segue o padrão ─────────────────────────────────────────────
const m = selecionada.match(/^(\d{14})_(.+)\.sql$/);
if (!m) {
  problemas.push(`P1: nome fora do padrão <14 dígitos>_<nome>.sql: ${selecionada}`);
} else if (!fs.existsSync(path.join(DIR, selecionada))) {
  problemas.push(`P1: arquivo inexistente em supabase/migrations/: ${selecionada}`);
} else {
  ok.push(`P1: ${selecionada} existe e segue o padrão`);
}

const versao = m?.[1];

// ── P3: fora da faixa congelada ─────────────────────────────────────────────
if (versao) {
  if (versoes.includes(versao)) {
    problemas.push(
      `P3: ${versao} é uma das ${versoes.length} migrations HISTÓRICAS congeladas — ` +
        `já aplicada no banco remoto antes da reconciliação. Reaplicá-la é proibido.`
    );
  } else if (versao <= c.limiteCongelado) {
    problemas.push(
      `P3: ${versao} é anterior ou igual à última histórica ${c.limiteCongelado} — ` +
        `migration intercalada na faixa congelada`
    );
  } else {
    ok.push(`P3: ${versao} é posterior à faixa congelada (limite ${c.limiteCongelado})`);
  }
}

// ── P4: é forward-only conhecida ────────────────────────────────────────────
const forwardOnly = c.forwardOnly.map((f) => f.arquivo);
if (versao && !forwardOnly.includes(selecionada)) {
  problemas.push(
    `P4: ${selecionada} não está entre as forward-only classificadas ` +
      `(${forwardOnly.join(", ") || "nenhuma"})`
  );
} else if (versao) {
  ok.push("P4: pertence ao conjunto forward-only classificado");
}

// ── P6, P7, P8: exigem o ledger remoto ──────────────────────────────────────
let pendentes = null;

if (ledgerArquivo) {
  const aplicadas = fs
    .readFileSync(ledgerArquivo, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => l.split(/\t|\|/)[0].trim());

  const aplicadasSet = new Set(aplicadas);

  // P7: o ledger remoto tem de conter TODAS as históricas e nada de inesperado.
  const faltando = versoes.filter((v) => !aplicadasSet.has(v));
  const inesperadas = aplicadas.filter(
    (v) => !versoes.includes(v) && !c.forwardOnly.some((f) => f.version === v)
  );
  const duplicadas = aplicadas.filter((v, i) => aplicadas.indexOf(v) !== i);

  if (faltando.length > 0) {
    problemas.push(`P7: ledger remoto sem ${faltando.length} histórica(s): ${faltando.join(", ")}`);
  }
  if (inesperadas.length > 0) {
    problemas.push(
      `P7: ledger remoto com versão(ões) que o repositório não conhece: ${inesperadas.join(", ")}`
    );
  }
  if (duplicadas.length > 0) {
    problemas.push(`P7: versão duplicada no ledger remoto: ${[...new Set(duplicadas)].join(", ")}`);
  }
  if (faltando.length === 0 && inesperadas.length === 0 && duplicadas.length === 0) {
    ok.push(`P7: ledger remoto íntegro — ${aplicadas.length} versão(ões), sem lacuna nem surpresa`);
  }

  // P6: ainda não aplicada.
  if (versao && aplicadasSet.has(versao)) {
    problemas.push(`P6: ${versao} JÁ CONSTA do ledger remoto — nada a aplicar`);
  } else if (versao) {
    ok.push(`P6: ${versao} ainda não consta do ledger remoto`);
  }

  // P8: é a mais antiga pendente.
  pendentes = c.forwardOnly
    .filter((f) => !aplicadasSet.has(f.version))
    .sort((a, b) => a.version.localeCompare(b.version));

  if (versao && pendentes.length > 0 && pendentes[0].version !== versao) {
    problemas.push(
      `P8: ${versao} não é a mais antiga pendente. Aplicar fora de ordem produz um ` +
        `banco que a reconstrução não reproduz. Pendente mais antiga: ` +
        `${pendentes[0].arquivo}`
    );
  } else if (versao && pendentes.length > 0) {
    ok.push(`P8: é a mais antiga das ${pendentes.length} pendente(s)`);
  }
}

// ── Relatório ───────────────────────────────────────────────────────────────
console.log("PRÉ-CONDIÇÕES DA APLICAÇÃO");
console.log("");
console.log(`  selecionada ......... ${selecionada}`);
console.log(`  faixa congelada ..... até ${c.limiteCongelado} (${c.historicas.length} históricas)`);
console.log(`  forward-only no repo  ${forwardOnly.join(", ") || "nenhuma"}`);
if (pendentes) {
  console.log(`  pendentes no remoto . ${pendentes.map((p) => p.version).join(", ") || "nenhuma"}`);
} else {
  console.log("  pendentes no remoto . (ledger não informado — P6/P7/P8 não avaliadas)");
}
console.log("");
for (const o of ok) console.log(`  ✓ ${o}`);

if (problemas.length > 0) {
  console.error("");
  console.error("APLICAÇÃO RECUSADA:");
  for (const p of problemas) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log("");
console.log(`✓ pré-condições aprovadas para ${selecionada}`);
