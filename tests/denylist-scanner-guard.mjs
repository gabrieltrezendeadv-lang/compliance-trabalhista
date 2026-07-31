/**
 * GUARDA DO VARREDOR DA DENYLIST
 *
 * ── POR QUE ESTES TESTES NÃO USAM `assert-local-only.sh` PARA JULGAR ────────
 *
 * O defeito que este hotfix corrige incluía um FALSO NEGATIVO da própria
 * guarda: no Git Bash do Windows, com `LANG` vazio, ela aprovava arquivos que o
 * CI reprovava. Testar o varredor exclusivamente através dela seria medir com o
 * instrumento quebrado.
 *
 * Por isso os casos exercitam o MÓDULO Node diretamente, e o wrapper é testado
 * à parte — inclusive quanto à propagação do exit code e à invariância de
 * locale.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { conteudoExecutavel } from "../scripts/ci/lib/executavel.mjs";
import { lerDenylist, paraRegExp, varrer } from "../scripts/ci/scan-denylist.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DENYLIST = path.join(raiz, "scripts/ci/remote-access-denylist.txt");

let passed = 0;
let failed = 0;

function test(nome, fn) {
  try {
    fn();
    passed += 1;
    console.log(`[PASS] ${nome}`);
  } catch (erro) {
    failed += 1;
    console.error(`[FAIL] ${nome}: ${erro.message}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "denylist-scan-"));
function fixture(nome, conteudo) {
  const p = path.join(tmp, nome);
  fs.writeFileSync(p, conteudo, "utf8");
  return p;
}

/** Varre um único alvo e diz se houve violação. */
function reprova(arquivo) {
  return varrer(DENYLIST, [arquivo]).violacoes.length > 0;
}

// ── Comentários: citar não é executar ───────────────────────────────────────

test("DS-01: comando proibido em comentário de LINHA é permitido", () => {
  const f = fixture("linha.mjs", 'const x = 1;\n// roda supabase db push aqui? não.\n');
  assert.equal(reprova(f), false);
});

test("DS-02: comando proibido em comentário de BLOCO é permitido", () => {
  const f = fixture("bloco.mjs", "/**\n * A rota usa `supabase db push --dry-run` para nada.\n */\nexport const a = 1;\n");
  assert.equal(reprova(f), false);
});

test("DS-03: as três ocorrências REAIS da main deixam de reprovar", () => {
  for (const alvo of ["scripts/ci/reserve-forward-only.mjs", "scripts/ci/sanitize-log.mjs"]) {
    const caminho = path.join(raiz, alvo);
    assert.ok(fs.existsSync(caminho), `${alvo} sumiu`);
    // O texto BRUTO contém o comando — é isso que reprovava antes.
    const bruto = fs.readFileSync(caminho, "utf8");
    assert.match(bruto, /supabase\s+(db\s+push|migration\s+(repair|fetch))/);
    // E o executável, não.
    assert.equal(reprova(caminho), false, `${alvo} ainda reprova`);
  }
});

// ── Comandos de verdade: continuam reprovando ──────────────────────────────

test("DS-04: comando em CÓDIGO EXECUTÁVEL é recusado", () => {
  const f = fixture("exec.mjs", 'execSync("supabase db push");\n');
  assert.equal(reprova(f), true);
});

test("DS-05: comando em STRING é recusado", () => {
  const f = fixture("str.mjs", 'const c = "supabase db push";\n');
  assert.equal(reprova(f), true);
});

test("DS-06: comando em TEMPLATE LITERAL é recusado", () => {
  const f = fixture("tpl.mjs", "const c = `supabase db push ${alvo}`;\n");
  assert.equal(reprova(f), true);
});

// ── Armadilhas léxicas ─────────────────────────────────────────────────────

test("DS-07: `//` de URL dentro de string não vira comentário", () => {
  const origem = 'const u = "https://exemplo.test/a"; const v = 2;\n';
  const exec = conteudoExecutavel(origem, ".mjs");
  assert.match(exec, /https:\/\/exemplo\.test\/a/, "a URL foi apagada");
  assert.match(exec, /const v = 2/, "o código depois da URL sumiu");
});

test("DS-08: `/*` dentro de string não abre bloco", () => {
  const origem = 'const s = "abre /* e nao fecha"; const depois = 1;\n';
  const exec = conteudoExecutavel(origem, ".mjs");
  assert.match(exec, /abre \/\* e nao fecha/, "o conteúdo da string foi comido");
  assert.match(exec, /const depois = 1/, "o código seguinte sumiu");
});

test("DS-09: regex literal não é confundida com comentário", () => {
  const origem = "const r = /a\\/\\/b/; const depois = 1;\n";
  const exec = conteudoExecutavel(origem, ".mjs");
  assert.match(exec, /const depois = 1/, "o código depois da regex sumiu");
});

test("DS-10: comentário ENTRE tokens não cria correspondência inexistente", () => {
  // `supabase/*x*/db push` NÃO é `supabase db push`: há um comentário no meio.
  // Se o varredor colasse os tokens, inventaria uma violação.
  const f = fixture("entre.mjs", "const a = supabase/*x*/db;\n");
  const exec = conteudoExecutavel(fs.readFileSync(f, "utf8"), ".mjs");
  // O comentário vira ESPAÇOS — posição preservada. O que não pode acontecer é
  // os tokens se encostarem: `supabasedb` seria um identificador que não existe
  // no arquivo, e inventá-lo é como um varredor passa a alucinar.
  assert.doesNotMatch(exec, /supabasedb/, "os tokens foram colados pelo varredor");
  assert.equal(exec.length, fs.readFileSync(f, "utf8").length, "o comprimento mudou");
});

test("DS-11: números de linha do arquivo ORIGINAL são preservados", () => {
  const origem = "// linha 1\n/* 2\n 3 */\nexecSync('supabase db push');\n";
  const exec = conteudoExecutavel(origem, ".mjs");
  const linhas = exec.split("\n");
  assert.equal(linhas.length, origem.split("\n").length, "a contagem de linhas mudou");
  assert.match(linhas[3], /supabase db push/, "a linha 4 deixou de ser a linha 4");
});

// ── Fail-closed ────────────────────────────────────────────────────────────

test("DS-12: extensão desconhecida REPROVA", () => {
  const f = fixture("estranho.py", "print('supabase db push')\n");
  assert.equal(reprova(f), true, "extensão desconhecida passou");
});

test("DS-13: arquivo inexistente REPROVA", () => {
  assert.equal(reprova(path.join(tmp, "nao-existe.mjs")), true);
});

test("DS-14: denylist malformada REPROVA", () => {
  const d = fixture("ruim.txt", "so-um-campo-sem-tab\n");
  assert.throws(() => lerDenylist(d), /denylist inválida/);
});

test("DS-15: denylist vazia REPROVA", () => {
  const d = fixture("vazia.txt", "# só comentário\n\n");
  assert.throws(() => lerDenylist(d), /nenhuma entrada/);
});

test("DS-16: rótulo duplicado REPROVA", () => {
  const d = fixture("dup.txt", "a\tx\na\ty\n");
  assert.throws(() => lerDenylist(d), /duplicado/);
});

test("DS-17: classe POSIX não suportada REPROVA em vez de virar literal", () => {
  assert.throws(() => paraRegExp("[[:blank:]]+x"), /não suportada/);
});

test("DS-18: padrão que não compila REPROVA", () => {
  assert.throws(() => paraRegExp("a("), /não compila/);
});

// ── A denylist real continua íntegra ───────────────────────────────────────

test("DS-19: as nove entradas da denylist estão intactas e compilam", () => {
  const entradas = lerDenylist(DENYLIST);
  assert.equal(entradas.length, 9, `a denylist tem ${entradas.length} entradas, esperadas 9`);
  // `[[:space:]]` precisa ter virado classe JS equivalente, não literal.
  const push = entradas.find((e) => e.rotulo === "comando-que-escreve-no-historico-remoto");
  assert.ok(push, "a entrada do db push sumiu");
  assert.ok(push.regex.test("supabase   db\tpush"), "o padrão deixou de casar espaço/tab");
  assert.ok(!push.regex.test("supabasedbpush"), "o padrão passou a casar sem separador");
});

// ── Wrapper: exit code e invariância de locale ─────────────────────────────

function rodarWrapper(env) {
  try {
    const out = execFileSync("bash", [path.join(raiz, "scripts/ci/assert-local-only.sh"), "pre"], {
      cwd: raiz,
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

test("DS-20: o wrapper aprova a main e propaga exit 0", () => {
  const r = rodarWrapper({});
  assert.equal(r.code, 0, `o wrapper reprovou a main:\n${r.out}`);
  assert.match(r.out, /padrão\(ões\) da denylist conferido/);
});

test("DS-21: resultado IDÊNTICO com LANG vazio e com LC_ALL=C", () => {
  // É a invariância que faltava: a versão em Bash aprovava no Windows com
  // `LANG` vazio e reprovava no Linux, com os mesmos arquivos.
  const vazio = rodarWrapper({ LANG: "", LC_ALL: "" });
  const c = rodarWrapper({ LANG: "C", LC_ALL: "C" });
  assert.equal(vazio.code, c.code, "o exit code depende do locale");
});

test("DS-22: violação REAL faz o wrapper reprovar com exit 1", () => {
  // Mutação: transforma uma das três citações em comando EXECUTÁVEL.
  const alvo = path.join(raiz, "scripts/ci/sanitize-log.mjs");
  const original = fs.readFileSync(alvo, "utf8");
  // Acrescentar FORA do comentário: substituir texto dentro do bloco apenas
  // moveria a citação de lugar, e ela continuaria — corretamente — ignorada.
  const mutado = `${original}
export const CMD = "supabase db push";
`;
  assert.notEqual(mutado, original, "a mutação não casou — reescreva-a");

  fs.writeFileSync(alvo, mutado, "utf8");
  try {
    const r = rodarWrapper({});
    assert.equal(r.code, 1, `o comando executável passou:\n${r.out}`);
    assert.match(r.out, /GUARDA REPROVADA/);
  } finally {
    fs.writeFileSync(alvo, original, "utf8");
  }
});

test("DS-23: o wrapper NÃO interpreta a denylist — quem decide é o Node", () => {
  // Se o Bash voltar a fazer `IFS=$'\t' read` sobre a denylist, o falso
  // negativo de locale volta junto. A guarda mede o texto do wrapper.
  const sh = fs.readFileSync(path.join(raiz, "scripts/ci/assert-local-only.sh"), "utf8");
  const executavelSh = sh
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  // A asserção é sobre a seção `pre`, não sobre todo uso de `read` no arquivo:
  // `secao_config` lê o config.toml com `IFS=$'\t' read`, e isso não está em
  // questão — o defeito era a DENYLIST ser interpretada em Bash.
  const iPre = executavelSh.indexOf("secao_pre()");
  const iConfig = executavelSh.indexOf("secao_config()");
  assert.ok(iPre >= 0 && iConfig > iPre, "as seções mudaram de forma");
  const corpoPre = executavelSh.slice(iPre, iConfig);

  assert.doesNotMatch(
    corpoPre,
    /read -r/,
    "a seção `pre` voltou a interpretar a denylist em Bash"
  );
  assert.doesNotMatch(
    corpoPre,
    /grep[^\n]*DENYLIST/,
    "a seção `pre` voltou a aplicar os padrões com grep"
  );
  assert.match(
    executavelSh,
    /node[^\n]*scan-denylist\.mjs/,
    "o wrapper deixou de delegar a varredura ao Node"
  );
});

// ─── Fim ───────────────────────────────────────────────────────────────────

fs.rmSync(tmp, { recursive: true, force: true });

console.log("");
console.log(`Denylist scanner guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
