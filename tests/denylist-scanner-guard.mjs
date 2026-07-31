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

// ── POLÍTICA ESTRITA: citar já reprova ─────────────────────────────────────
//
// A guarda roda ANTES de `npm ci`, de propósito. Sem dependências não há
// scanner léxico, e escrever um lexer à mão seria muito código e muita
// superfície de erro para PERMITIR que um comando proibido apareça literalmente
// num arquivo de automação. A escolha é a oposta: o comando não aparece.

test("DS-01: comando proibido em CÓDIGO EXECUTÁVEL é recusado", () => {
  const f = fixture("exec.mjs", 'execSync("supabase db push");\n');
  assert.equal(reprova(f), true);
});

test("DS-02: comando proibido em STRING é recusado", () => {
  const f = fixture("str.mjs", 'const c = "supabase db push";\n');
  assert.equal(reprova(f), true);
});

test("DS-03: comando proibido em TEMPLATE LITERAL é recusado", () => {
  const f = fixture("tpl.mjs", "const c = `supabase db push ${alvo}`;\n");
  assert.equal(reprova(f), true);
});

test("DS-04: comando proibido em COMENTÁRIO também é recusado", () => {
  // É a política nova, e é deliberada: citar é reprovar.
  const f = fixture("com.mjs", "// nunca rode supabase db push aqui\nexport const a = 1;\n");
  assert.equal(reprova(f), true, "comentário passou a ser exceção");
});

test("DS-05: comentário EXPLICATIVO sem o comando literal é permitido", () => {
  const f = fixture(
    "ok.mjs",
    "// o ensaio a seco do CLI de migrations precisa ver uma versao pendente\nexport const a = 1;\n"
  );
  assert.equal(reprova(f), false);
});

test("DS-06: as três redações NOVAS são permitidas", () => {
  for (const alvo of ["scripts/ci/reserve-forward-only.mjs", "scripts/ci/sanitize-log.mjs"]) {
    const caminho = path.join(raiz, alvo);
    assert.ok(fs.existsSync(caminho), `${alvo} sumiu`);
    assert.equal(reprova(caminho), false, `${alvo} ainda reprova`);
  }
});

test("DS-07: o sentido técnico foi preservado na reescrita", () => {
  // Reescrever não pode virar apagar: as três explicações continuam dizendo o
  // que diziam, sem transcrever o comando.
  const reserva = fs.readFileSync(path.join(raiz, "scripts/ci/reserve-forward-only.mjs"), "utf8");
  assert.match(reserva, /ensaio a seco do CLI de migrations/);
  assert.match(reserva, /reparar manualmente o ledger remoto/);
  assert.match(reserva, /puxar o schema do projeto remoto/);

  const log = fs.readFileSync(path.join(raiz, "scripts/ci/sanitize-log.mjs"), "utf8");
  assert.match(log, /logs crus da aplicação de migrations pelo CLI NÃO são publicados/);
});

test("DS-08: nenhum arquivo de automação contém comando proibido, em lugar nenhum", () => {
  const alvos = fs
    .readdirSync(path.join(raiz, "scripts/ci"))
    .filter((f) => /\.(sh|mjs|sql)$/.test(f))
    .map((f) => path.join(raiz, "scripts/ci", f));
  alvos.push(path.join(raiz, ".github/workflows/migration-rebuild-verify.yml"));

  const { violacoes } = varrer(DENYLIST, alvos);
  assert.deepEqual(
    violacoes.map((v) => `${path.basename(v.alvo)}:${v.linha} ${v.rotulo}`),
    [],
    "há comando proibido na automação"
  );
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

// ── Zero dependências ──────────────────────────────────────────────────────

test("DS-24: o scanner funciona SEM node_modules ao alcance", () => {
  // ── POR QUE ESTE TESTE EXISTE ─────────────────────────────────────────────
  //
  // A guarda roda ANTES de `npm ci`, e a primeira versão deste hotfix importava
  // `typescript`. Passou na minha máquina e morreu no runner com
  // ERR_MODULE_NOT_FOUND. Só uma prova de ausência pega isso.
  //
  // Nada é apagado: monta-se uma cópia MÍNIMA num diretório temporário, sem
  // `node_modules` em nenhum ancestral, e roda-se o scanner lá.
  const isolado = fs.mkdtempSync(path.join(os.tmpdir(), "sem-deps-"));
  try {
    fs.mkdirSync(path.join(isolado, "scripts", "ci"), { recursive: true });
    fs.copyFileSync(
      path.join(raiz, "scripts/ci/scan-denylist.mjs"),
      path.join(isolado, "scripts/ci/scan-denylist.mjs")
    );
    fs.copyFileSync(DENYLIST, path.join(isolado, "scripts/ci/remote-access-denylist.txt"));

    fs.writeFileSync(path.join(isolado, "limpo.mjs"), "export const a = 1;\n", "utf8");
    fs.writeFileSync(path.join(isolado, "sujo.mjs"), 'const c = "supabase db push";\n', "utf8");

    // Nenhum ancestral do temporário pode ter `node_modules` — se tivesse, a
    // prova de ausência não valeria nada.
    for (let d = isolado; d !== path.dirname(d); d = path.dirname(d)) {
      assert.ok(
        !fs.existsSync(path.join(d, "node_modules")),
        `há node_modules em ${d} — a prova de ausência não vale`
      );
    }

    function rodar(alvo) {
      try {
        execFileSync(
          "node",
          [
            path.join(isolado, "scripts/ci/scan-denylist.mjs"),
            path.join(isolado, "scripts/ci/remote-access-denylist.txt"),
            path.join(isolado, alvo),
          ],
          { cwd: isolado, encoding: "utf8", stdio: "pipe" }
        );
        return { code: 0, out: "" };
      } catch (e) {
        return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
      }
    }

    const limpo = rodar("limpo.mjs");
    assert.equal(limpo.code, 0, `o scanner não rodou sem node_modules:\n${limpo.out}`);

    const sujo = rodar("sujo.mjs");
    assert.equal(sujo.code, 1, "o alvo sujo passou");
    assert.match(sujo.out, /GUARDA REPROVADA/);
    assert.doesNotMatch(sujo.out, /ERR_MODULE_NOT_FOUND/, "o scanner voltou a depender de pacote");
  } finally {
    fs.rmSync(isolado, { recursive: true, force: true });
  }
});

test("DS-25: o scanner não importa nada além de `node:`", () => {
  const src = fs.readFileSync(path.join(raiz, "scripts/ci/scan-denylist.mjs"), "utf8");
  const imports = [...src.matchAll(/^import[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
  const externos = imports.filter((i) => !i.startsWith("node:"));
  assert.deepEqual(externos, [], `o scanner passou a depender de: ${externos.join(", ")}`);
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
