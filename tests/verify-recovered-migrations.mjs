/**
 * VALIDAÇÃO DAS MIGRATIONS RECUPERADAS (Fase 2)
 *
 * Confere que o resultado de `supabase migration fetch` corresponde exatamente
 * à matriz remota registrada em supabase/baseline/applied-migrations.tsv.
 *
 * Uso:
 *   node tests/verify-recovered-migrations.mjs <diretorio-com-os-sql>
 *
 * Não toca no banco, não usa credencial, não lê variável de ambiente sensível.
 * Recebe apenas um caminho de diretório e compara arquivos.
 *
 * Falha com exit 1 em qualquer divergência.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "./lib/manifest.mjs";
import { classificarMigrations, resumo } from "./lib/migrations.mjs";
import { sqlFingerprint } from "./lib/normalize-sql.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(root, "supabase/baseline/applied-migrations.tsv");

const dir = process.argv[2];
if (!dir) {
  console.error("uso: node tests/verify-recovered-migrations.mjs <diretorio>");
  process.exit(2);
}

// ── Matriz esperada ──────────────────────────────────────────────────────────

// O parser vive em ./lib/manifest.mjs e faz trim por campo: sem isso, o CRLF
// do checkout Windows contamina o md5_norm e TODAS as 36 linhas divergem, com
// "esperado" e "obtido" idênticos na mensagem. Ver o cabeçalho daquele módulo.
const esperadas = parseManifest(fs.readFileSync(MANIFEST, "utf8"));

// ── Arquivos recuperados ─────────────────────────────────────────────────────

if (!fs.existsSync(dir)) {
  console.error(`FALHA: diretório não existe: ${dir}`);
  process.exit(1);
}

const arquivos = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let erros = 0;
const falha = (msg) => {
  console.error(`FALHA: ${msg}`);
  erros += 1;
};

// ── VR-01: as 36 históricas, mais as forward-only posteriores ────────────────
//
// Antes da primeira migration forward-only isto exigia exatamente 36 arquivos.
// A classificação vive agora em ./lib/migrations.mjs, que separa as 36
// congeladas das posteriores e reprova versão intercalada na faixa histórica.
// As 36 continuam obrigatórias e conferidas por hash, uma a uma.

if (esperadas.length !== 36) {
  falha(`o manifesto deveria listar 36 versões, lista ${esperadas.length}`);
}

const classificacao = classificarMigrations(dir, esperadas.map((e) => e.version));

console.log(`manifesto: ${esperadas.length} versão(ões) históricas`);
console.log(`diretório: ${resumo(classificacao)}`);
if (classificacao.forwardOnly.length > 0) {
  for (const f of classificacao.forwardOnly) {
    console.log(`  forward-only: ${f.arquivo}`);
  }
}

for (const problema of classificacao.problemas) falha(problema);

if (classificacao.historicas.length !== 36) {
  falha(
    `esperadas 36 migrations históricas no diretório, encontradas ` +
      `${classificacao.historicas.length}`
  );
}

// ── VR-02 / VR-03: nome, duplicidade e correspondência com o manifesto ───────
//
// Cobertos pela classificação acima: padrão de nome, versão duplicada, versão
// histórica ausente e versão intercalada já entram em `problemas`.

const PADRAO = /^(\d{14})_(.+)\.sql$/;

// ── VR-04: conteúdo não vazio e assinatura correspondente ────────────────────

const porVersao = new Map();
for (const arquivo of arquivos) {
  const m = arquivo.match(PADRAO);
  if (m) porVersao.set(m[1], arquivo);
}

let conferidas = 0;

for (const esperada of esperadas) {
  const arquivo = porVersao.get(esperada.version);
  if (!arquivo) continue; // já reportado em VR-03

  const conteudo = fs.readFileSync(path.join(dir, arquivo), "utf8");

  if (conteudo.trim().length === 0) {
    falha(`${arquivo}: SQL vazio`);
    continue;
  }

  const fp = sqlFingerprint(conteudo);

  if (fp.md5 !== esperada.md5) {
    falha(
      `${arquivo}: assinatura divergente\n` +
        `        esperado: ${esperada.md5} (${esperada.len} chars)\n` +
        `        obtido:   ${fp.md5} (${fp.len} chars)`
    );
    continue;
  }

  conferidas += 1;
}

console.log(`assinaturas conferidas: ${conferidas}/${esperadas.length}`);

// ── VR-05: nenhum vestígio de credencial nos arquivos recuperados ────────────

const PROIBIDOS = [
  [/eyJ[A-Za-z0-9_-]{20,}/, "possível JWT"],
  [/postgres(ql)?:\/\/[^\s]*:[^\s]*@/i, "connection string"],
  [/\baact_/, "chave Asaas"],
  [/\bwhsec_/, "segredo de webhook"],
  [/SUPABASE_DB_URL/, "nome de variável de conexão"],
  [/SUPABASE_DB_PASSWORD/, "nome de variável de senha"],
];

for (const arquivo of arquivos) {
  const conteudo = fs.readFileSync(path.join(dir, arquivo), "utf8");
  for (const [padrao, descricao] of PROIBIDOS) {
    if (padrao.test(conteudo)) falha(`${arquivo}: ${descricao}`);
  }
}

// ── Resultado ────────────────────────────────────────────────────────────────

console.log("");
if (erros > 0) {
  console.error(`Validação da recuperação: ${erros} falha(s)`);
  process.exit(1);
}
console.log(
  `Validação da recuperação: OK — ${conferidas} histórica(s) conferida(s) por ` +
    `md5_norm, ${classificacao.forwardOnly.length} forward-only`
);
