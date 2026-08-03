/**
 * RESERVA ORIENTADA PELO LEDGER — deixa exatamente UMA migration pendente
 *
 * Uso:
 *   node scripts/ci/reserve-forward-only.mjs <selecionada.sql> <ledger.tsv> <dir-reserva>
 *
 * A rota precisa que o ensaio a seco do CLI de migrations enxergue uma única
 * migration pendente: é assim que "exatamente uma por execução" deixa de ser
 * promessa e vira propriedade verificável. Para isso, as demais forward-only
 * PENDENTES saem temporariamente do diretório.
 *
 * ── O DEFEITO QUE ISTO CORRIGE ──────────────────────────────────────────────
 *
 * A primeira versão reservava toda forward-only diferente da selecionada:
 *
 *   for F in $(list-forward-only); do
 *     [ "$F" != "$MIGRATION" ] && mv "supabase/migrations/$F" /tmp/reservadas/
 *   done
 *
 * Funcionou enquanto nenhuma forward-only estava aplicada. Na execução nº 5,
 * com `20260730123613` JÁ no ledger remoto, a regra a removeu do diretório — e
 * o CLI recusou:
 *
 *   Remote migration versions not found in local migrations directory.
 *
 * O CLI está certo em recusar. Ele compara o histórico remoto com o diretório
 * local, e uma versão registrada no banco sem arquivo correspondente é, para
 * ele, um repositório fora de sincronia — indistinguível de alguém ter apagado
 * uma migration já aplicada.
 *
 * ── POR QUE A SUGESTÃO DO PRÓPRIO CLI SERIA UM ESTRAGO ──────────────────────
 *
 * O erro vem acompanhado de duas sugestões:
 *
 *   — reparar manualmente o ledger remoto, marcando a versão como revertida;
 *   — puxar o schema do projeto remoto por cima do local.
 *
 * As duas são recusadas por este repositório, e os comandos não são
 * transcritos aqui de propósito: `scripts/ci/remote-access-denylist.txt`
 * reprova a automação que os contenha, e a guarda é textual e estrita.
 *
 * A primeira marcaria como REVERTIDA uma migration que está aplicada de fato —
 * o ledger passaria a mentir sobre o banco, que é exatamente o estado que as
 * Fases 3 a 6 gastaram semanas desfazendo. A segunda reescreveria o diretório
 * local a partir do remoto, atropelando o congelamento das 36. Nenhuma das
 * duas é usada aqui, e ambas estão proibidas nas guardas.
 *
 * ── A REGRA CORRETA ─────────────────────────────────────────────────────────
 *
 * PERMANECEM no diretório:
 *   * todas as migrations históricas;
 *   * toda versão presente no ledger remoto — aplicada é aplicada;
 *   * a migration selecionada.
 *
 * SÃO RESERVADAS apenas as forward-only que, cumulativamente:
 *   * ainda NÃO constam do ledger remoto; e
 *   * não são a selecionada.
 *
 * Nada é decidido por nome fixo: a fonte é o ledger lido do banco naquela
 * execução, mais a classificação do diretório. Serve para qualquer sequência
 * futura de forward-only.
 *
 * ── FAIL-CLOSED ────────────────────────────────────────────────────────────
 *
 * Antes de mover qualquer arquivo, toda versão do ledger tem de possuir arquivo
 * local correspondente. Se faltar, o script reprova com diagnóstico e NÃO
 * chama o CLI — a mesma condição que produziu o erro passa a ser detectada
 * antes, com mensagem que explica o que fazer.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "../../tests/lib/manifest.mjs";
import { classificarMigrations } from "../../tests/lib/migrations.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const [selecionadaBruta, ledgerArquivo, dirReserva] = process.argv.slice(2);

if (!selecionadaBruta || !ledgerArquivo || !dirReserva) {
  console.error(
    "uso: node scripts/ci/reserve-forward-only.mjs <selecionada.sql> <ledger.tsv> <dir-reserva>"
  );
  process.exit(2);
}

// `--dry-run` do próprio script: decide e relata sem mover nada. Usado pelos
// testes para exercitar a REGRA sem mexer no diretório de trabalho.
const apenasRelatar = process.env.RESERVA_SOMENTE_RELATAR === "1";

const dirMigrations = process.env.RESERVA_DIR_MIGRATIONS
  ? path.resolve(process.env.RESERVA_DIR_MIGRATIONS)
  : path.join(raiz, "supabase/migrations");

const selecionada = selecionadaBruta.trim();

function falhar(titulo, linhas) {
  console.error(titulo);
  console.error("");
  for (const l of linhas) console.error(`  ✗ ${l}`);
  process.exit(1);
}

// ── Entradas ────────────────────────────────────────────────────────────────
const versoesHistoricas = parseManifest(
  fs.readFileSync(path.join(raiz, "supabase/baseline/applied-migrations.tsv"), "utf8")
).map((r) => r.version);

const c = classificarMigrations(dirMigrations, versoesHistoricas);
if (c.problemas.length > 0) {
  falhar("RESERVA RECUSADA — diretório de migrations inconsistente", c.problemas);
}

if (!fs.existsSync(ledgerArquivo)) {
  falhar("RESERVA RECUSADA", [`ledger inexistente: ${ledgerArquivo}`]);
}

// O ledger já passou por assert-ledger-format.mjs. Reconferir o formato aqui é
// barato e impede que uma mudança de ordem dos passos, um dia, entregue um
// arquivo não validado a esta decisão.
const registros = [];
fs.readFileSync(ledgerArquivo, "utf8")
  .split(/\r?\n/)
  .filter((l) => l.trim() !== "")
  .forEach((linha, i) => {
    const m = linha.match(/^(\d{14})\|([^|]+)$/);
    if (!m) {
      falhar("RESERVA RECUSADA — ledger malformado", [
        `linha ${i + 1} fora do formato <14 dígitos>|<nome>: ${JSON.stringify(linha)}`,
      ]);
    }
    registros.push({ version: m[1], name: m[2] });
  });

const noLedger = new Set(registros.map((r) => r.version));

// ── Fail-closed: toda versão do ledger precisa de arquivo local ─────────────
const porVersao = new Map(
  [...c.historicas, ...c.forwardOnly].map((e) => [e.version, e.arquivo])
);

const semArquivo = registros.filter((r) => !porVersao.has(r.version));
if (semArquivo.length > 0) {
  falhar(
    "RESERVA RECUSADA — versão aplicada remotamente sem arquivo local",
    [
      ...semArquivo.map(
        (r) => `${r.version}|${r.name} consta do ledger remoto e não existe em ${path.relative(raiz, dirMigrations)}/`
      ),
      "",
      "O Supabase CLI recusaria a operação com 'Remote migration versions not",
      "found in local migrations directory' — e estaria certo: o repositório",
      "estaria fora de sincronia com o banco.",
      "",
      // O texto abaixo evita de propósito escrever os comandos que o CLI
      // sugere. Eles são proibidos pelas guardas de congelamento (MF-02 e
      // MF-04), e a varredura daquelas guardas não distingue string literal de
      // comando — com razão: um comando proibido não deve existir no arquivo
      // nem como exemplo. A orientação vale igual sem citá-los.
      "NÃO 'conserte' o histórico marcando a versão como revertida — ela está aplicada de fato,",
      "e o ledger passaria a mentir sobre o banco.",
      "NÃO puxe o esquema do remoto para reescrever o diretório local — isso atropelaria",
      "o congelamento das migrations históricas.",
      "",
      "Restaure o arquivo da migration a partir do histórico do repositório.",
    ]
  );
}

// ── A migration selecionada tem de existir e estar pendente ─────────────────
const selecionadaEntrada = [...c.forwardOnly].find((f) => f.arquivo === selecionada);
if (!selecionadaEntrada) {
  falhar("RESERVA RECUSADA", [
    `${selecionada} não está entre as forward-only classificadas ` +
      `(${c.forwardOnly.map((f) => f.arquivo).join(", ") || "nenhuma"})`,
  ]);
}
if (noLedger.has(selecionadaEntrada.version)) {
  falhar("RESERVA RECUSADA", [
    `${selecionadaEntrada.version} já consta do ledger remoto — nada a aplicar`,
  ]);
}

// ── A decisão ───────────────────────────────────────────────────────────────
//
// Reserva = forward-only pendente que não é a selecionada.
// Uma versão no ledger NUNCA é reservada, por construção.
const aReservar = c.forwardOnly.filter(
  (f) => !noLedger.has(f.version) && f.arquivo !== selecionada
);

const permanecem = [...c.historicas, ...c.forwardOnly].filter(
  (e) => !aReservar.some((r) => r.version === e.version)
);

// ── Relatório antes de agir ─────────────────────────────────────────────────
console.log("RESERVA ORIENTADA PELO LEDGER");
console.log("");
console.log(`  selecionada .............. ${selecionada}`);
console.log(`  ledger remoto ............ ${registros.length} versão(ões)`);
console.log(`  históricas ............... ${c.historicas.length} (nenhuma reservada, nunca)`);
console.log(`  forward-only no repo ..... ${c.forwardOnly.length}`);
for (const f of c.forwardOnly) {
  const estado = noLedger.has(f.version)
    ? "aplicada  → PERMANECE"
    : f.arquivo === selecionada
      ? "pendente  → PERMANECE (selecionada)"
      : "pendente  → reservada";
  console.log(`    ${f.version}  ${estado}`);
}
console.log("");
console.log(`  permanecem no diretório .. ${permanecem.length}`);
console.log(`  reservadas ............... ${aReservar.length}`);

if (apenasRelatar) {
  console.log("");
  console.log("(RESERVA_SOMENTE_RELATAR=1 — nenhum arquivo foi movido)");
  console.log(`RESERVADAS=${aReservar.map((r) => r.arquivo).join(",")}`);
  process.exit(0);
}

// ── Ação ────────────────────────────────────────────────────────────────────
fs.mkdirSync(dirReserva, { recursive: true });
for (const r of aReservar) {
  fs.renameSync(path.join(dirMigrations, r.arquivo), path.join(dirReserva, r.arquivo));
  console.log(`  movida: ${r.arquivo}`);
}

// ── Pós-condição: sobrou exatamente uma pendente ────────────────────────────
const depois = classificarMigrations(dirMigrations, versoesHistoricas);
if (depois.problemas.length > 0) {
  falhar("RESERVA RECUSADA — diretório inconsistente APÓS a reserva", depois.problemas);
}
const pendentesDepois = depois.forwardOnly.filter((f) => !noLedger.has(f.version));
if (pendentesDepois.length !== 1 || pendentesDepois[0].arquivo !== selecionada) {
  falhar("RESERVA RECUSADA — o estado resultante não tem exatamente uma pendente", [
    `pendentes após a reserva: ${pendentesDepois.map((p) => p.arquivo).join(", ") || "nenhuma"}`,
    `esperada exatamente: ${selecionada}`,
  ]);
}
const faltando = registros.filter(
  (r) => ![...depois.historicas, ...depois.forwardOnly].some((e) => e.version === r.version)
);
if (faltando.length > 0) {
  falhar("RESERVA RECUSADA — a reserva removeu versão aplicada remotamente", [
    faltando.map((f) => f.version).join(", "),
  ]);
}

console.log("");
console.log(
  `✓ exatamente uma pendente no diretório: ${selecionada}; ` +
    `as ${registros.length} versões do ledger continuam presentes`
);
