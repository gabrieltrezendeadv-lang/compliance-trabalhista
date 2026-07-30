/**
 * DECOMPÕE A URL DE CONEXÃO EM VARIÁVEIS PG*, SEM EXPOR A CREDENCIAL
 *
 * Lê `DB_URL` do ambiente e escreve PGHOST, PGPORT, PGUSER, PGDATABASE,
 * PGPASSWORD e PGSSLMODE em `$GITHUB_ENV`. Depois disso `psql` conecta sem
 * receber nada em argv — a senha não aparece na linha de comando de processo
 * nenhum.
 *
 * Antes de escrever, registra cada componente sensível como máscara
 * (`::add-mask::`). O GitHub já mascara o secret inteiro; mascarar as partes
 * cobre o caso em que apenas a senha, isolada, apareça em alguma saída — que é
 * justamente o que a decomposição cria.
 *
 * NADA é impresso além de rótulos. A URL, a senha e o host não vão para o log.
 *
 * ── POR QUE NÃO GRAVAR UM .pgpass ───────────────────────────────────────────
 *
 * Seria mais simples e é pior: um arquivo com a senha sobrevive ao passo, entra
 * em qualquer `upload-artifact` descuidado e é exatamente o que as regras desta
 * fase proíbem. Variável de ambiente do job morre com o job.
 */

import fs from "node:fs";

const bruta = process.env.DB_URL;

if (!bruta || bruta.trim() === "") {
  console.error("FALHA: DB_URL vazia ou ausente.");
  process.exit(1);
}

let u;
try {
  u = new URL(bruta.trim());
} catch {
  console.error("FALHA: DB_URL não é uma URL válida. (valor omitido)");
  process.exit(1);
}

if (!/^postgres(ql)?:$/.test(u.protocol)) {
  console.error(`FALHA: esquema inesperado "${u.protocol}" — esperado postgres: ou postgresql:`);
  process.exit(1);
}

const host = u.hostname;
const port = u.port || "5432";
const user = decodeURIComponent(u.username || "");
const senha = decodeURIComponent(u.password || "");
const base = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
// sslmode explícito: conexão a banco gerenciado sem TLS não é aceitável, e o
// default do libpq ("prefer") aceitaria texto claro em silêncio.
const sslmode = u.searchParams.get("sslmode") || "require";

if (host === "") {
  console.error("FALHA: DB_URL sem host.");
  process.exit(1);
}
if (user === "" || senha === "") {
  console.error("FALHA: DB_URL sem usuário ou sem senha.");
  process.exit(1);
}

// Máscaras ANTES de qualquer escrita.
for (const valor of [senha, user, host, bruta.trim()]) {
  if (valor && valor.length >= 3) console.log(`::add-mask::${valor}`);
}

const envFile = process.env.GITHUB_ENV;
if (!envFile) {
  console.error("FALHA: GITHUB_ENV não definido — este script só roda dentro do Actions.");
  process.exit(1);
}

fs.appendFileSync(
  envFile,
  [
    `PGHOST=${host}`,
    `PGPORT=${port}`,
    `PGUSER=${user}`,
    `PGDATABASE=${base}`,
    `PGPASSWORD=${senha}`,
    `PGSSLMODE=${sslmode}`,
    "",
  ].join("\n"),
  "utf8"
);

// Só metadados não sensíveis.
console.log("conexão configurada por variáveis PG*");
console.log(`  porta ....... ${port}`);
console.log(`  base ........ ${base}`);
console.log(`  sslmode ..... ${sslmode}`);
console.log("  host, usuário e senha omitidos do log");
