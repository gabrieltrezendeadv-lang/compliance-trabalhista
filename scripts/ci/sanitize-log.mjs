/**
 * SANITIZA UM LOG ANTES DE PUBLICÁ-LO COMO ARTEFATO
 *
 * Uso:
 *   node scripts/ci/sanitize-log.mjs <entrada> <saida>
 *
 * Os logs crus da aplicação de migrations pelo CLI NÃO são publicados. O CLI recebe a URL de
 * conexão em `--db-url`, e nada garante que ele não a repita numa mensagem de
 * erro — aliás, é exatamente em erro que ferramentas costumam ecoar a conexão
 * que tentaram usar. Um artefato fica noventa dias disponível para qualquer
 * pessoa com acesso ao repositório: é o pior lugar possível para uma senha.
 *
 * A sanitização é em duas camadas, e as duas importam:
 *
 *   CONHECIDA   os valores que a rota sabe serem sensíveis (URL, senha,
 *               usuário, host) são substituídos por rótulos. Cobre o que
 *               conhecemos.
 *
 *   GENÉRICA    qualquer coisa com forma de URI postgres com credencial, ou de
 *               `--db-url <algo>`, é redigida mesmo que não bata com os valores
 *               conhecidos. Cobre o que não conhecemos — outra credencial que
 *               apareça por engano, um host de outro projeto, uma URL montada
 *               pelo CLI com codificação diferente.
 *
 * Falha (exit 1) se, depois de sanitizar, ainda restar qualquer valor sensível
 * conhecido. Melhor perder o artefato do que publicar a senha.
 */

import fs from "node:fs";

const [entrada, saida] = process.argv.slice(2);

if (!entrada || !saida) {
  console.error("uso: node scripts/ci/sanitize-log.mjs <entrada> <saida>");
  process.exit(2);
}

if (!fs.existsSync(entrada)) {
  // Passo anterior pode ter falhado antes de gerar o log. Ausência não é erro
  // de sanitização; publicar um arquivo dizendo isso é mais honesto que sumir.
  fs.writeFileSync(saida, `(log ausente: ${entrada} não foi gerado)\n`, "utf8");
  console.log(`entrada ausente — ${saida} registra a ausência`);
  process.exit(0);
}

let texto = fs.readFileSync(entrada, "utf8");

/** Valores conhecidos, do mais longo para o mais curto. */
const conhecidos = [
  ["DB_URL", process.env.DB_URL],
  ["PGPASSWORD", process.env.PGPASSWORD],
  ["PGUSER", process.env.PGUSER],
  ["PGHOST", process.env.PGHOST],
]
  .filter(([, v]) => typeof v === "string" && v.length >= 3)
  .sort((a, b) => b[1].length - a[1].length);

// ── Camada 1: valores conhecidos ────────────────────────────────────────────
for (const [rotulo, valor] of conhecidos) {
  // Substituição literal, sem regex: a senha pode conter qualquer caractere.
  texto = texto.split(valor).join(`«${rotulo} redigido»`);
  // E também a forma percent-encoded, que é como a URL a transporta.
  const codificado = encodeURIComponent(valor);
  if (codificado !== valor && codificado.length >= 3) {
    texto = texto.split(codificado).join(`«${rotulo} redigido»`);
  }
}

// ── Camada 2: formas genéricas de credencial ────────────────────────────────
const genericas = [
  // postgres://usuario:senha@host...  → mantém só o esquema
  [/postgres(ql)?:\/\/[^\s"'`]+/gi, "postgresql://«conexão redigida»"],
  // --db-url <algo>  e  --db-url=<algo>
  [/(--db-url[= ])\S+/gi, "$1«conexão redigida»"],
  // qualquer coisa que pareça um host do Supabase
  [/\b[a-z0-9-]+\.(supabase\.(co|com|in|net)|pooler\.supabase\.com)\b/gi, "«host redigido»"],
];
for (const [padrao, troca] of genericas) texto = texto.replace(padrao, troca);

fs.writeFileSync(saida, texto, "utf8");

// ── Conferência: nada conhecido pode ter sobrado ────────────────────────────
const vazamentos = [];
for (const [rotulo, valor] of conhecidos) {
  if (texto.includes(valor)) vazamentos.push(rotulo);
  const codificado = encodeURIComponent(valor);
  if (codificado !== valor && texto.includes(codificado)) vazamentos.push(`${rotulo} (codificado)`);
}

if (vazamentos.length > 0) {
  // Não imprime o valor, só qual componente resistiu.
  console.error(`FALHA: sanitização incompleta — resistiram: ${vazamentos.join(", ")}`);
  fs.rmSync(saida, { force: true });
  process.exit(1);
}

const linhas = texto.split("\n").length;
console.log(`sanitizado: ${saida} (${linhas} linha(s), ${conhecidos.length} valor(es) conhecido(s) considerado(s))`);
