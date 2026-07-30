/**
 * NORMALIZAÇÃO DE DUMP ESTRUTURAL — para comparação por diferença
 *
 * Uso:
 *   node scripts/ci/normalize-schema-dump.mjs <entrada.sql> <saida.sql>
 *
 * Remove APENAS ruído comprovadamente dependente do ambiente ou da execução do
 * `pg_dump`. Nenhuma regra toca em DDL: tabela, coluna, tipo, constraint,
 * índice, função, trigger, policy e RLS atravessam a normalização intactos.
 *
 * ── REGRAS ──────────────────────────────────────────────────────────────────
 *
 * N1  CRLF/CR → LF.
 *     Justificativa: fim de linha é propriedade da plataforma de checkout, não
 *     do schema. `.gitattributes` já força LF para *.sql; a regra existe para
 *     que a comparação não dependa dessa configuração.
 *
 * N2  Remove as diretivas `\restrict <token>` e `\unrestrict <token>`.
 *     Justificativa: o token é gerado aleatoriamente em CADA execução do
 *     pg_dump (proteção contra injeção na restauração). Dois dumps do MESMO
 *     banco diferem nessas duas linhas. Não descrevem objeto algum.
 *
 * N3  Remove `-- Dumped from database version <x>` e
 *     `-- Dumped by pg_dump version <x>`.
 *     Justificativa: registram a versão do servidor e do cliente. São
 *     comentários; não descrevem objeto algum. As versões são registradas
 *     separadamente no log do workflow, e não perdidas.
 *
 * N4  Remove espaço em branco no fim de cada linha.
 *     Justificativa: invisível e sem efeito semântico em SQL.
 *
 * N5  Garante exatamente um `\n` no fim do arquivo.
 *     Justificativa: consequência mecânica de N2 (a última linha do dump é a
 *     diretiva \unrestrict).
 *
 * ── O QUE A NORMALIZAÇÃO NÃO FAZ ────────────────────────────────────────────
 *
 * Não reordena linhas, não colapsa linhas em branco internas, não remove
 * comentários de objeto (`-- Name: x; Type: TABLE; ...`), não uniformiza
 * identificadores nem literais, não remove `SET` de cabeçalho. Qualquer
 * diferença remanescente é diferença de conteúdo, e deve ser classificada —
 * não silenciada.
 *
 * ── REDE DE SEGURANÇA ───────────────────────────────────────────────────────
 *
 * Toda linha removida é impressa no log e conferida contra o padrão que a
 * autorizou. Se uma regra remover linha que não case exatamente com seu
 * padrão declarado, o script falha com exit 1. Uma normalização que engolisse
 * DDL em silêncio invalidaria o teste inteiro.
 */

import fs from "node:fs";

const REGRAS = [
  {
    id: "N2",
    descricao: "diretiva \\restrict / \\unrestrict (token aleatório por execução)",
    padrao: /^\\(un)?restrict [A-Za-z0-9+/=]+$/,
  },
  {
    id: "N3",
    descricao: "comentário de versão de servidor / cliente",
    padrao: /^-- Dumped (from database version|by pg_dump version) .+$/,
  },
];

const [entrada, saida] = process.argv.slice(2);
if (!entrada || !saida) {
  console.error("uso: node scripts/ci/normalize-schema-dump.mjs <entrada.sql> <saida.sql>");
  process.exit(2);
}

const bruto = fs.readFileSync(entrada, "utf8");

// N1
const linhas = bruto.replace(/\r\n?/g, "\n").split("\n");

const mantidas = [];
const removidas = [];

for (const linha of linhas) {
  // N4 antes de avaliar as regras: um `\r` residual ou espaço final não deve
  // impedir o reconhecimento de uma linha de ruído.
  const limpa = linha.replace(/[ \t]+$/, "");

  const regra = REGRAS.find((r) => r.padrao.test(limpa));
  if (regra) {
    removidas.push({ regra, texto: limpa });
    continue;
  }
  mantidas.push(limpa);
}

// N5
while (mantidas.length > 0 && mantidas[mantidas.length - 1] === "") mantidas.pop();
const normalizado = `${mantidas.join("\n")}\n`;

fs.writeFileSync(saida, normalizado, "utf8");

// ── Relatório auditável ─────────────────────────────────────────────────────

console.log(`normalize-schema-dump: ${entrada} → ${saida}`);
console.log(`  N1 fim de linha ....... CRLF/CR → LF`);
console.log(`  N4 espaço final ....... aplicado a ${linhas.length} linha(s)`);
console.log(`  N5 fim de arquivo ..... um \\n final`);
console.log(`  linhas de entrada ..... ${linhas.length}`);
console.log(`  linhas de saída ....... ${mantidas.length}`);
console.log(`  linhas removidas ...... ${removidas.length}`);

for (const { regra, texto } of removidas) {
  // O token do \restrict é aleatório mas não é segredo; ainda assim, imprimir
  // só o prefixo mantém o log enxuto.
  const visivel = texto.length > 60 ? `${texto.slice(0, 60)}…` : texto;
  console.log(`    ${regra.id}  ${visivel}`);
}

// Rede de segurança: nenhuma linha removida pode conter DDL.
const DDL = /\b(CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT ON|COPY|INSERT)\b/i;
const suspeitas = removidas.filter(({ texto }) => DDL.test(texto));
if (suspeitas.length > 0) {
  console.error("\nFALHA: a normalização removeu linha com aparência de DDL:");
  for (const { regra, texto } of suspeitas) console.error(`  ${regra.id}  ${texto}`);
  process.exit(1);
}

// Inventário de objetos: publicado para que a comparação possa ser conferida
// por contagem, além de por diferença.
const CONTAGENS = [
  ["tabelas", /^CREATE TABLE /gm],
  ["tipos", /^CREATE TYPE /gm],
  ["funções", /^CREATE FUNCTION |^CREATE OR REPLACE FUNCTION /gm],
  ["índices", /^CREATE (UNIQUE )?INDEX /gm],
  ["policies", /^CREATE POLICY /gm],
  ["triggers", /^CREATE TRIGGER /gm],
  ["RLS habilitada", /ENABLE ROW LEVEL SECURITY;$/gm],
  ["constraints (ALTER TABLE ADD CONSTRAINT)", /ADD CONSTRAINT /gm],
  ["GRANT", /^GRANT /gm],
  ["REVOKE", /^REVOKE /gm],
];

console.log("  inventário do arquivo normalizado:");
for (const [rotulo, re] of CONTAGENS) {
  const n = (normalizado.match(re) ?? []).length;
  console.log(`    ${String(n).padStart(4)}  ${rotulo}`);
}
