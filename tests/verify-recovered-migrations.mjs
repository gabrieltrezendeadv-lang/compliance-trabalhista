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

import { sqlFingerprint } from "./lib/normalize-sql.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(root, "supabase/baseline/applied-migrations.tsv");

const dir = process.argv[2];
if (!dir) {
  console.error("uso: node tests/verify-recovered-migrations.mjs <diretorio>");
  process.exit(2);
}

// ── Matriz esperada ──────────────────────────────────────────────────────────

const esperadas = fs
  .readFileSync(MANIFEST, "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("version\t"))
  .map((l) => {
    const [version, name, len, md5] = l.split("\t");
    return { version, name, len: Number(len), md5 };
  });

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

// ── VR-01: quantidade exata ──────────────────────────────────────────────────

console.log(`esperadas: ${esperadas.length} · recuperadas: ${arquivos.length}`);

if (esperadas.length !== 36) {
  falha(`o manifesto deveria listar 36 versões, lista ${esperadas.length}`);
}
if (arquivos.length !== 36) {
  falha(`esperados 36 arquivos .sql, encontrados ${arquivos.length}`);
}

// ── VR-02: nome de arquivo válido e timestamp único ──────────────────────────

const PADRAO = /^(\d{14})_(.+)\.sql$/;
const vistos = new Set();

for (const arquivo of arquivos) {
  const m = arquivo.match(PADRAO);
  if (!m) {
    falha(`nome inválido, esperado <14 dígitos>_<nome>.sql: ${arquivo}`);
    continue;
  }
  const [, version] = m;
  if (vistos.has(version)) {
    falha(`timestamp duplicado: ${version}`);
  }
  vistos.add(version);
}

// ── VR-03: conjunto de versões idêntico ao manifesto ─────────────────────────

const esperadasSet = new Set(esperadas.map((e) => e.version));

const faltando = [...esperadasSet].filter((v) => !vistos.has(v)).sort();
const sobrando = [...vistos].filter((v) => !esperadasSet.has(v)).sort();

if (faltando.length) falha(`versões ausentes: ${faltando.join(", ")}`);
if (sobrando.length) falha(`versões inesperadas: ${sobrando.join(", ")}`);

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
console.log("Validação da recuperação: OK — 36 versões, assinaturas conferidas");
