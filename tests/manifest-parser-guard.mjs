/**
 * GUARDA DO PARSER DO MANIFESTO
 *
 * `tests/lib/manifest.mjs` precisa produzir o mesmo resultado para o manifesto
 * entregue com LF e com CRLF. O defeito que motivou esta guarda reprovava as 36
 * migrations recuperadas exibindo "esperado" e "obtido" idênticos — o `\r` do
 * checkout Windows ia colado no `md5_norm`.
 *
 * `.gitattributes` declara `*.tsv text eol=lf`, mas a regra de EOL e a robustez
 * do parser cobrem falhas diferentes: a regra normaliza o que o Git entrega, o
 * parser protege contra arquivo gerado fora do Git, checkout antigo ou
 * `.gitattributes` removido. Estes testes exigem as duas.
 *
 * Executado por `npm run test:reconciliation`, portanto por `npm run verify`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "./lib/manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(root, "supabase/baseline/applied-migrations.tsv");

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

// Fixture sintética: duas linhas de dados, comentário, cabeçalho e linha vazia.
const CORPO_LF = [
  "# comentário do manifesto",
  "#",
  "version\tname\tlen_norm\tmd5_norm",
  "20260724013538\tfoundation\t7445\t8eb5442f54b25c5c37361472c5421b76",
  "20260724014530\tonboarding_function\t940\t74bd89e78a8e85f539646afe73e5bdb4",
  "",
].join("\n");

const CORPO_CRLF = CORPO_LF.split("\n").join("\r\n");

const ESPERADO = [
  {
    version: "20260724013538",
    name: "foundation",
    len: 7445,
    md5: "8eb5442f54b25c5c37361472c5421b76",
  },
  {
    version: "20260724014530",
    name: "onboarding_function",
    len: 940,
    md5: "74bd89e78a8e85f539646afe73e5bdb4",
  },
];

test("MP-01: manifesto com LF é lido corretamente", () => {
  assert.deepEqual(parseManifest(CORPO_LF), ESPERADO);
});

test("MP-02: manifesto com CRLF produz resultado idêntico ao de LF", () => {
  const comCrlf = parseManifest(CORPO_CRLF);
  assert.deepEqual(comCrlf, ESPERADO);
  // A igualdade entre as duas formas é o coração da guarda.
  assert.deepEqual(comCrlf, parseManifest(CORPO_LF));
});

test("MP-03: nenhum campo retorna com \\r, espaço ou tab residual", () => {
  for (const corpo of [CORPO_LF, CORPO_CRLF]) {
    for (const r of parseManifest(corpo)) {
      for (const [campo, valor] of Object.entries(r)) {
        if (typeof valor !== "string") continue;
        assert.doesNotMatch(
          valor,
          /[\r\n\t ]/,
          `campo ${campo} contém espaço em branco: ${JSON.stringify(valor)}`
        );
      }
    }
  }
});

test("MP-04: md5 com \\r colado é rejeitado, não aceito silenciosamente", () => {
  // Prova que a validação existe: se o trim fosse removido E a validação
  // também, um md5 contaminado passaria adiante e a divergência apareceria
  // como "esperado == obtido". Aqui o \r está DENTRO do campo, não no fim da
  // linha, então split(/\r?\n/) não o remove — só a validação pega.
  const contaminado =
    "20260724013538\tfoundation\t7445\t8eb5442f54b25c5c37361472c5421b\r76";
  assert.throws(() => parseManifest(contaminado), /md5_norm inválido/);
});

test("MP-05: espaço acidental em volta dos campos é tolerado", () => {
  const frouxo =
    "  20260724013538 \t foundation \t 7445 \t 8eb5442f54b25c5c37361472c5421b76  ";
  assert.deepEqual(parseManifest(frouxo), [ESPERADO[0]]);
});

test("MP-06: linha com menos de 4 campos é rejeitada", () => {
  assert.throws(
    () => parseManifest("20260724013538\tfoundation\t7445"),
    /esperado 4/
  );
});

test("MP-07: len_norm não numérico é rejeitado", () => {
  assert.throws(
    () =>
      parseManifest(
        "20260724013538\tfoundation\tabc\t8eb5442f54b25c5c37361472c5421b76"
      ),
    /len_norm não numérico/
  );
});

test("MP-08: versão fora do formato de 14 dígitos é rejeitada", () => {
  assert.throws(
    () =>
      parseManifest(
        "2026072401\tfoundation\t7445\t8eb5442f54b25c5c37361472c5421b76"
      ),
    /versão inválida/
  );
});

// ── O manifesto real ────────────────────────────────────────────────────────

test("MP-09: o manifesto versionado é lido e traz 36 versões", () => {
  const bruto = fs.readFileSync(MANIFEST, "utf8");
  const registros = parseManifest(bruto);
  assert.equal(registros.length, 36, `esperado 36, obtido ${registros.length}`);
  assert.equal(new Set(registros.map((r) => r.version)).size, 36);
});

test("MP-10: o manifesto real é lido igual, tenha ele LF ou CRLF", () => {
  const bruto = fs.readFileSync(MANIFEST, "utf8");
  const comoLf = bruto.split(/\r?\n/).join("\n");
  const comoCrlf = comoLf.split("\n").join("\r\n");
  assert.deepEqual(parseManifest(comoLf), parseManifest(comoCrlf));
  assert.deepEqual(parseManifest(bruto), parseManifest(comoLf));
});

test("MP-11: .gitattributes normaliza TSV para LF", () => {
  const ga = path.join(root, ".gitattributes");
  assert.ok(fs.existsSync(ga), ".gitattributes ausente");
  assert.match(
    fs.readFileSync(ga, "utf8"),
    /^\*\.tsv\s+text\s+eol=lf$/m,
    ".gitattributes deve conter '*.tsv text eol=lf'"
  );
});

console.log("");
console.log(`Manifest parser guard: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
