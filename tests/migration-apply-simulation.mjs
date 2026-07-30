/**
 * SIMULAÇÃO DA ROTA DE APLICAÇÃO — sem banco, sem credencial, sem rede
 *
 * A rota não pode ser ensaiada de ponta a ponta sem um banco de produção e uma
 * credencial, e nenhum dos dois está autorizado nesta fase. O que É possível —
 * e o que este arquivo faz — é exercitar cada recusa contra o CÓDIGO REAL:
 *
 *   * as pré-condições rodam pelo script de verdade, com ledgers sintéticos;
 *   * a guarda de branch roda pelo shell EXTRAÍDO do próprio workflow, de modo
 *     que alterá-lo altera o que este teste executa;
 *   * o parser de credencial roda de verdade, e a saída inteira é vasculhada
 *     atrás do segredo.
 *
 * O que NÃO é simulado, e por isso não é afirmado em lugar nenhum: a conexão
 * ao banco, o comportamento real do `supabase db push` e o efeito da migration.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "./lib/manifest.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(raiz, ".github/workflows/migration-apply.yml");

const HISTORICA = "20260728191324";
const FO1 = "20260730123613_revoke_public_webhook_execute.sql";
const FO2 = "20260731094500_make_tenant_resolution_deterministic.sql";

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apply-sim-"));

/**
 * Escreve um ledger sintético no formato que o psql da rota produz.
 *
 * Usa o MESMO parser do código de produção: `applied-migrations.tsv` tem um
 * cabeçalho de comentários longo, e um `.slice(1)` ingênuo o injetaria no
 * ledger falso — foi o que aconteceu na primeira versão deste arquivo, e as
 * recusas resultantes eram do teste, não da rota.
 */
function ledger(versoes) {
  const manifesto = parseManifest(
    fs.readFileSync(path.join(raiz, "supabase/baseline/applied-migrations.tsv"), "utf8")
  ).map((r) => [r.version, r.name]);

  const linhas = manifesto.map(([v, n]) => `${v}|${n}`);
  for (const v of versoes) linhas.push(`${v}|extra`);
  const arquivo = path.join(tmp, `ledger-${versoes.join("-") || "base"}.tsv`);
  fs.writeFileSync(arquivo, linhas.join("\n") + "\n", "utf8");
  return arquivo;
}

/** Roda o script real de pré-condições. Devolve {code, out}. */
function precondicoes(migration, ledgerArquivo) {
  const args = ["scripts/ci/assert-apply-preconditions.mjs", migration];
  if (ledgerArquivo) args.push(ledgerArquivo);
  try {
    const out = execFileSync("node", args, { cwd: raiz, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/**
 * Extrai o bloco `run:` de um passo pelo nome, direto do workflow real.
 *
 * Sem js-yaml de propósito: o pacote está no node_modules apenas como
 * dependência transitiva, e um teste de guarda não deve depender de algo que
 * ninguém declarou. O formato do arquivo é regular o bastante para um extrator
 * de vinte linhas, e ele falha alto se a forma mudar.
 */
function runDoPasso(nomeDoPasso, job) {
  const texto = fs.readFileSync(WORKFLOW, "utf8").replace(/\r\n?/g, "\n");

  const iJob = texto.indexOf(`\n  ${job}:\n`);
  assert.ok(iJob >= 0, `job "${job}" não existe em ${path.basename(WORKFLOW)}`);
  const proximoJob = texto.slice(iJob + 1).search(/\n {2}[a-z][a-z-]*:\n/);
  const regiao = proximoJob >= 0 ? texto.slice(iJob, iJob + 1 + proximoJob) : texto.slice(iJob);

  const iPasso = regiao.indexOf(`- name: ${nomeDoPasso}\n`);
  assert.ok(iPasso >= 0, `passo "${nomeDoPasso}" não existe no job ${job}`);

  const linhas = regiao.slice(iPasso).split("\n");
  const iRun = linhas.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  assert.ok(iRun > 0 && iRun < 12, `passo "${nomeDoPasso}" não tem bloco "run: |"`);

  const recuoRun = linhas[iRun].match(/^(\s+)/)[1].length;
  const corpo = [];
  for (const linha of linhas.slice(iRun + 1)) {
    if (linha.trim() === "") {
      corpo.push("");
      continue;
    }
    const recuo = linha.match(/^(\s*)/)[1].length;
    if (recuo <= recuoRun) break;
    corpo.push(linha.slice(recuoRun + 2));
  }
  const script = corpo.join("\n").trimEnd();
  assert.ok(script !== "", `bloco run vazio em "${nomeDoPasso}"`);
  return script;
}

/** Executa um bloco de shell do workflow com o ambiente dado. */
function shell(script, env) {
  const arquivo = path.join(tmp, "trecho.sh");
  fs.writeFileSync(arquivo, script, "utf8");
  try {
    const out = execFileSync("bash", [arquivo], {
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

// ══════════════════════════════════════════════════════════════════════════
// 1. RECUSA DE MIGRATION HISTÓRICA
// ══════════════════════════════════════════════════════════════════════════
test("SIM-01: recusa uma das 36 históricas congeladas", () => {
  const historica = fs
    .readdirSync(path.join(raiz, "supabase/migrations"))
    .find((f) => f.startsWith(HISTORICA));
  assert.ok(historica, "migration histórica de referência não encontrada");

  const r = precondicoes(historica, ledger([]));
  assert.equal(r.code, 1, "a rota DEVERIA ter recusado uma histórica");
  assert.match(r.out, /P3:.*HISTÓRICAS congeladas/);
  assert.match(r.out, /APLICAÇÃO RECUSADA/);
});

test("SIM-02: recusa versão intercalada na faixa congelada", () => {
  // Arquivo inexistente, com versão anterior ao limite: a recusa tem de vir
  // pela faixa, não apenas pela ausência do arquivo.
  const r = precondicoes("20260101000000_inventada.sql", ledger([]));
  assert.equal(r.code, 1);
  assert.match(r.out, /P3:.*anterior ou igual à última histórica/);
});

// ══════════════════════════════════════════════════════════════════════════
// 2. RECUSA DE VERSÃO JÁ APLICADA
// ══════════════════════════════════════════════════════════════════════════
test("SIM-03: recusa migration que já consta do ledger remoto", () => {
  const r = precondicoes(FO1, ledger(["20260730123613"]));
  assert.equal(r.code, 1, "a rota DEVERIA ter recusado uma versão já aplicada");
  assert.match(r.out, /P6: 20260730123613 JÁ CONSTA do ledger remoto/);
});

test("SIM-04: recusa aplicação fora de ordem", () => {
  // Nenhuma aplicada ainda: escolher a segunda pularia a primeira.
  const r = precondicoes(FO2, ledger([]));
  assert.equal(r.code, 1, "a rota DEVERIA ter recusado o salto de ordem");
  assert.match(r.out, /P8: 20260731094500 não é a mais antiga pendente/);
  assert.match(r.out, /Pendente mais antiga: 20260730123613/);
});

test("SIM-05: recusa ledger com versão que o repositório não conhece", () => {
  const r = precondicoes(FO1, ledger(["20260801000000"]));
  assert.equal(r.code, 1);
  assert.match(r.out, /P7: ledger remoto com versão\(ões\) que o repositório não conhece/);
});

test("SIM-06: ACEITA a mais antiga pendente, com o ledger íntegro", () => {
  const r = precondicoes(FO1, ledger([]));
  assert.equal(r.code, 0, `a rota deveria ter aceitado:\n${r.out}`);
  assert.match(r.out, /pré-condições aprovadas para 20260730123613/);
  assert.match(r.out, /P8: é a mais antiga das 2 pendente\(s\)/);
});

test("SIM-07: ACEITA a segunda depois que a primeira consta do ledger", () => {
  const r = precondicoes(FO2, ledger(["20260730123613"]));
  assert.equal(r.code, 0, `a rota deveria ter aceitado:\n${r.out}`);
  assert.match(r.out, /pré-condições aprovadas para 20260731094500/);
});

test("SIM-08: recusa mais de uma migration numa só execução", () => {
  for (const entrada of [`${FO1} ${FO2}`, `${FO1},${FO2}`, `${FO1};${FO2}`]) {
    const r = precondicoes(entrada, ledger([]));
    assert.equal(r.code, 1, `deveria recusar: ${entrada}`);
    assert.match(r.out, /P5: mais de uma migration selecionada/);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 3. RECUSA DE EXECUÇÃO FORA DA MAIN — shell extraído do workflow real
// ══════════════════════════════════════════════════════════════════════════
test("SIM-09: recusa execução fora da main (preflight)", () => {
  const script = runDoPasso("Somente a partir da main", "preflight");
  for (const ref of [
    "refs/heads/chore/migration-apply-route",
    "refs/heads/feature/qualquer",
    "refs/tags/v1.0.0",
    "refs/pull/13/merge",
    "refs/heads/main-2",
  ]) {
    const r = shell(script, { GITHUB_REF: ref, GITHUB_SHA: "0".repeat(40) });
    assert.equal(r.code, 1, `deveria recusar ${ref}`);
    assert.match(r.out, /RECUSADO: esta rota só executa a partir de refs\/heads\/main/);
  }
});

test("SIM-10: aceita execução a partir da main", () => {
  const script = runDoPasso("Somente a partir da main", "preflight");
  const r = shell(script, { GITHUB_REF: "refs/heads/main", GITHUB_SHA: "0".repeat(40) });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /origem confere: main/);
});

test("SIM-11: a confirmação textual é obrigatória e literal", () => {
  const script = runDoPasso("Confirmação explícita", "preflight");
  for (const valor of ["", "aplicar", "APLICAR ", "sim", "APLICA"]) {
    const r = shell(script, { CONFIRMACAO: valor });
    assert.equal(r.code, 1, `deveria abortar com ${JSON.stringify(valor)}`);
    assert.match(r.out, /ABORTADO/);
  }
  const ok = shell(script, { CONFIRMACAO: "APLICAR" });
  assert.equal(ok.code, 0, ok.out);
});

// ══════════════════════════════════════════════════════════════════════════
// 4. DRY-RUN IDENTIFICANDO EXATAMENTE UMA VERSÃO
// ══════════════════════════════════════════════════════════════════════════
test("SIM-12: a lógica do dry-run distingue uma versão de várias", () => {
  // O passo real chama `supabase db push --dry-run`, que exige banco. O que se
  // pode exercitar sem banco é a ANÁLISE da saída — que é onde mora a decisão.
  // O trecho é copiado do passo e mantido em sincronia por SIM-14.
  const analise = `
    set -e
    VERSAO="\${MIGRATION%%_*}"
    N=$(grep -c "\${VERSAO}" "$LOG" || true)
    if [ "$N" -lt 1 ]; then echo "RECUSADO: o dry-run não identificou a migration selecionada."; exit 1; fi
    OUTRAS=$(grep -oE '202[0-9]{11}' "$LOG" | sort -u | grep -v "^\${VERSAO}$" || true)
    if [ -n "$OUTRAS" ]; then echo "RECUSADO: o dry-run identificou versões além da selecionada:"; echo "$OUTRAS"; exit 1; fi
    echo "dry-run identificou exatamente uma versão: $VERSAO"
  `;

  const uma = path.join(tmp, "dry-uma.log");
  fs.writeFileSync(uma, `Would push these migrations:\n  ${FO1}\n`, "utf8");
  const r1 = shell(analise, { MIGRATION: FO1, LOG: uma });
  assert.equal(r1.code, 0, r1.out);
  assert.match(r1.out, /exatamente uma versão: 20260730123613/);

  const duas = path.join(tmp, "dry-duas.log");
  fs.writeFileSync(duas, `Would push these migrations:\n  ${FO1}\n  ${FO2}\n`, "utf8");
  const r2 = shell(analise, { MIGRATION: FO1, LOG: duas });
  assert.equal(r2.code, 1, "deveria recusar duas versões no dry-run");
  assert.match(r2.out, /identificou versões além da selecionada/);

  const nenhuma = path.join(tmp, "dry-vazio.log");
  fs.writeFileSync(nenhuma, "Remote database is up to date.\n", "utf8");
  const r3 = shell(analise, { MIGRATION: FO1, LOG: nenhuma });
  assert.equal(r3.code, 1, "deveria recusar dry-run sem a versão selecionada");
  assert.match(r3.out, /não identificou a migration selecionada/);
});

test("SIM-13: a análise simulada continua igual à do workflow", () => {
  // Impede que SIM-12 vire ficção: se o passo real mudar, este teste reprova e
  // obriga a atualizar a simulação junto.
  const real = runDoPasso("Dry-run obrigatório", "apply");
  for (const marca of [
    'VERSAO="${MIGRATION%%_*}"',
    "RECUSADO: o dry-run não identificou a migration selecionada.",
    "RECUSADO: o dry-run identificou versões além da selecionada:",
    "grep -oE '202[0-9]{11}'",
  ]) {
    assert.ok(real.includes(marca), `o passo real não contém mais: ${marca}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 5. AUSÊNCIA DE VAZAMENTO DO SECRET
// ══════════════════════════════════════════════════════════════════════════
test("SIM-14: o parser de credencial não imprime senha, host nem URL", () => {
  // Conexão DIRETA declarada: host `db.<ref>...` com usuário `postgres`.
  // Misturar usuário de pooler com host direto é recusado pelo vínculo de
  // destino — é o quarto caso de SIM-18, e não serve de fixture aqui.
  const SENHA = "s3nh4-Ultra-Secreta-XYZ";
  const HOST = "db.tvwgzpgyfdfrbdaeoqzl.supabase.co";
  const URL = `postgresql://postgres:${SENHA}@${HOST}:5432/postgres`;

  const envFile = path.join(tmp, "github-env.txt");
  fs.writeFileSync(envFile, "", "utf8");

  const r = shell('node scripts/ci/parse-db-url.mjs', {
    DB_URL: URL,
    GITHUB_ENV: envFile,
  });
  assert.equal(r.code, 0, r.out);

  // A saída não pode conter nenhum dos segredos em claro...
  for (const segredo of [SENHA, URL, HOST, "postgres.tvwgzpgyfdfrbdaeoqzl"]) {
    const linhasComSegredo = r.out
      .split("\n")
      .filter((l) => l.includes(segredo) && !l.startsWith("::add-mask::"));
    assert.deepEqual(
      linhasComSegredo,
      [],
      `segredo vazou na saída do parser:\n${linhasComSegredo.join("\n")}`
    );
  }

  // ...e tem de ter registrado as máscaras.
  assert.match(r.out, /::add-mask::/, "o parser não registrou máscara alguma");
  const mascarados = r.out
    .split("\n")
    .filter((l) => l.startsWith("::add-mask::"))
    .map((l) => l.slice("::add-mask::".length));
  for (const esperado of [SENHA, HOST, URL]) {
    assert.ok(mascarados.includes(esperado), `não mascarou: ${esperado.slice(0, 12)}…`);
  }

  // O arquivo de ambiente recebe os componentes — é ele que o psql consome, e
  // o GitHub não o imprime.
  const env = fs.readFileSync(envFile, "utf8");
  assert.match(env, /^PGHOST=/m);
  assert.match(env, /^PGPASSWORD=/m);
  assert.match(env, /^PGSSLMODE=require$/m);
});

test("SIM-15: o parser recusa URL sem senha, sem host ou de esquema errado", () => {
  const envFile = path.join(tmp, "github-env2.txt");
  for (const url of [
    "postgresql://postgres@db.exemplo.co:5432/postgres",
    "postgresql://postgres:senha@:5432/postgres",
    "mysql://a:b@host:3306/db",
    "isto-nao-e-url",
    "",
  ]) {
    fs.writeFileSync(envFile, "", "utf8");
    const r = shell("node scripts/ci/parse-db-url.mjs", { DB_URL: url, GITHUB_ENV: envFile });
    assert.equal(r.code, 1, `deveria recusar: ${JSON.stringify(url)}`);
    assert.match(r.out, /FALHA:/);
    // A mensagem pode usar a PALAVRA "senha"; o que ela não pode é ecoar o
    // VALOR recebido. As linhas `::add-mask::` são a proteção, não o vazamento:
    // o GitHub as consome e nunca as renderiza — mesma exclusão de SIM-14.
    const semMascaras = r.out
      .split("\n")
      .filter((l) => !l.startsWith("::add-mask::"))
      .join("\n");
    if (url !== "") {
      assert.ok(
        !semMascaras.includes(url),
        `a mensagem de erro ecoou a URL recebida:\n${semMascaras}`
      );
    }
    assert.ok(!r.out.includes("senha@"), "a mensagem ecoou credencial embutida");
  }
});

test("SIM-16: a guarda de loopback recusa banco local na rota de produção", () => {
  const script = runDoPasso("Conferir que a conexão NÃO é loopback", "apply");
  for (const host of ["localhost", "127.0.0.1", "::1", "0.0.0.0", ""]) {
    const r = shell(script, { PGHOST: host });
    assert.equal(r.code, 1, `deveria recusar PGHOST=${JSON.stringify(host)}`);
  }
  const ok = shell(script, { PGHOST: "db.exemplo.supabase.co" });
  assert.equal(ok.code, 0, ok.out);
  assert.doesNotMatch(ok.out, /db\.exemplo\.supabase\.co/, "o host não pode ir para o log");
});

// ══════════════════════════════════════════════════════════════════════════
// 6. DESTINO AMARRADO AO PROJETO DE PRODUÇÃO
// ══════════════════════════════════════════════════════════════════════════
const ALVO = JSON.parse(fs.readFileSync(path.join(raiz, "scripts/ci/production-target.json"), "utf8"));
const REF = ALVO.project_ref;
const SENHA = "s3nh4-Ultra-Secreta-XYZ";

/** Roda o parser real e devolve {code, out, env}. */
function parse(url) {
  const envFile = path.join(tmp, `env-${Math.abs(hash(url))}.txt`);
  fs.writeFileSync(envFile, "", "utf8");
  const r = shell("node scripts/ci/parse-db-url.mjs", { DB_URL: url, GITHUB_ENV: envFile });
  return { ...r, env: fs.readFileSync(envFile, "utf8") };
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const URL_DIRETA = `postgresql://postgres:${SENHA}@db.${REF}.supabase.co:5432/postgres`;
const URL_POOLER = `postgresql://postgres.${REF}:${SENHA}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;

test("SIM-17: aceita as duas conexões declaradas do projeto de produção", () => {
  for (const [modo, url] of [["direta", URL_DIRETA], ["pooler", URL_POOLER]]) {
    const r = parse(url);
    assert.equal(r.code, 0, `deveria aceitar a conexão ${modo}:\n${r.out}`);
    assert.match(r.out, new RegExp(`projeto \\.+ ${REF}`));
    assert.match(r.out, new RegExp(`modo \\.+ ${modo}`));
  }
});

test("SIM-18: recusa destino de OUTRO projeto, ainda que seja Supabase válido", () => {
  const outro = "abcdefghijklmnopqrst";
  for (const url of [
    `postgresql://postgres:${SENHA}@db.${outro}.supabase.co:5432/postgres`,
    `postgresql://postgres.${outro}:${SENHA}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`,
    `postgresql://postgres:${SENHA}@db.exemplo.com:5432/postgres`,
    // Host correto, usuário de pooler: combinação não declarada.
    `postgresql://postgres.${REF}:${SENHA}@db.${REF}.supabase.co:5432/postgres`,
  ]) {
    const r = parse(url);
    assert.equal(r.code, 1, `deveria recusar: ${url.replace(SENHA, "***")}`);
    assert.match(r.out, /não corresponde a nenhuma conexão declarada|não aparece nem no host nem no usuário/);
    assert.equal(r.env.trim(), "", "não pode ter escrito PG* para destino recusado");
  }
});

test("SIM-19: recusa sslmode disable, allow e prefer", () => {
  for (const modo of ["disable", "allow", "prefer"]) {
    const r = parse(`${URL_DIRETA}?sslmode=${modo}`);
    assert.equal(r.code, 1, `deveria recusar sslmode=${modo}`);
    assert.match(r.out, new RegExp(`sslmode="${modo}" é recusado`));
    assert.equal(r.env.trim(), "", "não pode ter escrito PG* com sslmode fraco");
  }
});

test("SIM-20: aceita require, verify-ca e verify-full; exige require quando ausente", () => {
  for (const modo of ["require", "verify-ca", "verify-full"]) {
    const r = parse(`${URL_DIRETA}?sslmode=${modo}`);
    assert.equal(r.code, 0, `deveria aceitar sslmode=${modo}:\n${r.out}`);
    assert.match(r.env, new RegExp(`^PGSSLMODE=${modo}$`, "m"));
  }
  const semSsl = parse(URL_DIRETA);
  assert.equal(semSsl.code, 0);
  assert.match(semSsl.env, /^PGSSLMODE=require$/m, "ausente deve virar require, não o default do libpq");
  assert.match(semSsl.out, /exigido pela rota/);
});

test("SIM-21: recusa sslmode desconhecido — na dúvida, recusa", () => {
  const r = parse(`${URL_DIRETA}?sslmode=talvez`);
  assert.equal(r.code, 1);
  assert.match(r.out, /não está na lista de aceitos/);
});

// ══════════════════════════════════════════════════════════════════════════
// 7. SANITIZAÇÃO DOS ARTEFATOS
// ══════════════════════════════════════════════════════════════════════════
test("SIM-22: o sanitizador remove URL, senha, usuário e host do log", () => {
  const HOST = `db.${REF}.supabase.co`;
  const USER = "postgres";
  const cru = path.join(tmp, "cru.log");
  const limpo = path.join(tmp, "limpo.log");

  fs.writeFileSync(
    cru,
    [
      "Connecting to remote database...",
      `failed to connect to \`host=${HOST} user=${USER} database=postgres\`:`,
      `dial error: ${URL_DIRETA}`,
      `retrying with --db-url ${URL_DIRETA}`,
      `password authentication failed for user "${USER}" (senha ${SENHA})`,
      "Applying migration 20260730123613_revoke_public_webhook_execute.sql...",
    ].join("\n"),
    "utf8"
  );

  const r = shell(`node scripts/ci/sanitize-log.mjs "${cru}" "${limpo}"`, {
    DB_URL: URL_DIRETA,
    PGPASSWORD: SENHA,
    PGUSER: USER,
    PGHOST: HOST,
  });
  assert.equal(r.code, 0, r.out);

  const texto = fs.readFileSync(limpo, "utf8");
  for (const segredo of [URL_DIRETA, SENHA, HOST]) {
    assert.ok(!texto.includes(segredo), `o sanitizado ainda contém ${segredo.slice(0, 14)}…`);
  }
  assert.ok(!/postgres(ql)?:\/\/[^«\s]*:[^«\s]*@/.test(texto), "sobrou URI com credencial");
  // O que NÃO é sensível tem de sobreviver — senão o artefato não serve.
  assert.match(texto, /Applying migration 20260730123613/, "a sanitização apagou informação útil");
});

test("SIM-23: o sanitizador redige credencial DESCONHECIDA, não só a esperada", () => {
  const cru = path.join(tmp, "cru2.log");
  const limpo = path.join(tmp, "limpo2.log");
  const outra = "postgresql://outro_user:OutraSenha123@db.qualquercoisa.supabase.co:5432/postgres";
  fs.writeFileSync(cru, `erro ao usar ${outra}\n`, "utf8");

  // Sem nenhuma variável conhecida no ambiente: só a camada genérica age.
  const r = shell(`node scripts/ci/sanitize-log.mjs "${cru}" "${limpo}"`, {
    DB_URL: "",
    PGPASSWORD: "",
    PGUSER: "",
    PGHOST: "",
  });
  assert.equal(r.code, 0, r.out);
  const texto = fs.readFileSync(limpo, "utf8");
  assert.ok(!texto.includes("OutraSenha123"), "credencial desconhecida não foi redigida");
  assert.ok(!texto.includes(outra), "URI desconhecida não foi redigida");
});

test("SIM-24: log ausente vira artefato que declara a ausência, sem falhar", () => {
  const limpo = path.join(tmp, "ausente.log");
  const r = shell(`node scripts/ci/sanitize-log.mjs "${path.join(tmp, "nao-existe.log")}" "${limpo}"`, {});
  assert.equal(r.code, 0, r.out);
  assert.match(fs.readFileSync(limpo, "utf8"), /log ausente/);
});

// ══════════════════════════════════════════════════════════════════════════
// 8. VERIFICAÇÃO INDEPENDENTE PÓS-APLICAÇÃO
// ══════════════════════════════════════════════════════════════════════════
test("SIM-25: a rota recusa aplicar migration sem verificação independente", () => {
  const script = runDoPasso("Verificação independente da migration aplicada", "apply");
  // Versão inventada, sem arquivo correspondente.
  const r = shell(script, { MIGRATION: "20260901000000_sem_verificacao.sql", PGBIN: "/usr/bin" });
  assert.equal(r.code, 1, "deveria recusar migration sem verificação independente");
  assert.match(r.out, /não existe verificação independente para 20260901000000/);
});

// ══════════════════════════════════════════════════════════════════════════
// 9. AS GUARDAS DO PREFLIGHT REALMENTE RODAM
// ══════════════════════════════════════════════════════════════════════════
test("SIM-26: o passo de guardas do preflight executa e passa", () => {
  // Asserção de EXECUÇÃO, não de texto. A estreia da rota falhou porque
  // `verify-recovered-migrations.mjs` era invocada sem o diretório e saía com
  // 2 — o preflight morria no primeiro passo, sempre. AP-12 conferia que a
  // rota MENCIONA as guardas; nenhuma conferia que ela consegue RODÁ-LAS.
  //
  // Este teste roda o bloco de shell extraído do próprio workflow. Qualquer
  // guarda invocada de forma que não funcione — argumento faltando, caminho
  // errado, arquivo removido — reprova aqui, e não só na estreia em produção.
  const script = runDoPasso("Guardas de congelamento e classificação", "preflight");
  const r = shell(script, {});
  assert.equal(
    r.code,
    0,
    `o passo de guardas do preflight falhou (exit ${r.code}):\n${r.out}`
  );
  assert.match(r.out, /36/, "a verificação das 36 históricas não produziu saída reconhecível");
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log("");
console.log(`Migration apply simulation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
