/**
 * DECOMPÕE A URL DE CONEXÃO EM VARIÁVEIS PG*, E CONFERE O DESTINO
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
 * NADA sensível é impresso. Nem a URL, nem a senha, nem o host, nem o usuário.
 *
 * ── O QUE MUDOU NA REVISÃO DA FASE 6B.1 ─────────────────────────────────────
 *
 * A primeira versão só recusava loopback. Isso é fraco: uma credencial trocada
 * por engano — outro projeto, um clone, o ambiente de outra pessoa — passaria
 * por todas as guardas, porque nenhuma olhava PARA ONDE a conexão ia. Agora o
 * destino é conferido contra `scripts/ci/production-target.json`, versionado.
 *
 * E `sslmode` passou a ter lista de aceitos em vez de só um default: `prefer` e
 * `allow` aceitam texto claro em silêncio quando o servidor não oferece TLS, e
 * `disable` garante texto claro. Nenhum serve para credencial de produção.
 *
 * ── POR QUE NÃO GRAVAR UM .pgpass ───────────────────────────────────────────
 *
 * Seria mais simples e é pior: um arquivo com a senha sobrevive ao passo, entra
 * em qualquer `upload-artifact` descuidado e é exatamente o que as regras desta
 * fase proíbem. Variável de ambiente do job morre com o job.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ALVO = JSON.parse(
  fs.readFileSync(path.join(raiz, "scripts/ci/production-target.json"), "utf8")
);

function falhar(mensagem) {
  console.error(`FALHA: ${mensagem}`);
  process.exit(1);
}

const bruta = process.env.DB_URL;

if (!bruta || bruta.trim() === "") falhar("DB_URL vazia ou ausente.");

let u;
try {
  u = new URL(bruta.trim());
} catch {
  falhar("DB_URL não é uma URL válida. (valor omitido)");
}

if (!/^postgres(ql)?:$/.test(u.protocol)) {
  falhar(`esquema inesperado "${u.protocol}" — esperado postgres: ou postgresql:`);
}

const host = u.hostname;
const port = u.port || "5432";
const user = decodeURIComponent(u.username || "");
const senha = decodeURIComponent(u.password || "");
const base = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
const sslmodeBruto = u.searchParams.get("sslmode");
const sslmode = sslmodeBruto || "require";

// Máscaras ANTES de qualquer outra saída — inclusive antes de mensagens de erro
// que possam vir a seguir.
for (const valor of [senha, user, host, bruta.trim()]) {
  if (valor && valor.length >= 3) console.log(`::add-mask::${valor}`);
}

if (host === "") falhar("DB_URL sem host.");
if (user === "") falhar("DB_URL sem usuário.");
if (senha === "") falhar("DB_URL sem senha.");

// ── sslmode: lista de aceitos, não default silencioso ───────────────────────
if (ALVO.sslmode_recusados.includes(sslmode)) {
  falhar(
    `sslmode="${sslmode}" é recusado. ` +
      `"disable" garante texto claro; "allow" e "prefer" aceitam texto claro em ` +
      `silêncio se o servidor não oferecer TLS. Aceitos: ` +
      `${ALVO.sslmode_aceitos.join(", ")}.`
  );
}
if (!ALVO.sslmode_aceitos.includes(sslmode)) {
  falhar(
    `sslmode="${sslmode}" não está na lista de aceitos ` +
      `(${ALVO.sslmode_aceitos.join(", ")}). Na dúvida, a rota recusa.`
  );
}

// ── Destino: tem de ser o projeto de produção declarado ─────────────────────
//
// Recusar loopback continua valendo no workflow, mas é a guarda mais fraca.
// Esta é a que importa: o par (host, usuário) precisa bater com uma das
// conexões declaradas, e o project ref precisa aparecer em pelo menos um dos
// dois. No modo pooler o host é compartilhado entre projetos — lá o vínculo
// vem exclusivamente do usuário.
const ref = ALVO.project_ref;
let modoAceito = null;

for (const conexao of ALVO.conexoes_aceitas) {
  const hostBate = conexao.host
    ? host === conexao.host
    : new RegExp(conexao.host_padrao).test(host);
  const usuarioBate = user === conexao.usuario;
  if (hostBate && usuarioBate) {
    modoAceito = conexao.modo;
    break;
  }
}

if (!modoAceito) {
  falhar(
    `o destino não corresponde a nenhuma conexão declarada em ` +
      `scripts/ci/production-target.json para o projeto ${ref}. ` +
      `Host e usuário foram omitidos do log; confira o secret do environment. ` +
      `Modos aceitos: ${ALVO.conexoes_aceitas.map((c) => c.modo).join(", ")}.`
  );
}

// Cinto e suspensório: mesmo tendo batido, o ref tem de estar presente em host
// ou usuário. Protege contra alguém acrescentar uma conexão ao JSON esquecendo
// de amarrá-la ao projeto.
if (!host.includes(ref) && !user.includes(ref)) {
  falhar(
    `o project ref ${ref} não aparece nem no host nem no usuário — ` +
      `a conexão declarada como "${modoAceito}" não está amarrada ao projeto.`
  );
}

const envFile = process.env.GITHUB_ENV;
if (!envFile) falhar("GITHUB_ENV não definido — este script só roda dentro do Actions.");

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

// Só metadados não sensíveis. O project ref não é segredo e é justamente o que
// confirma, para quem lê o log, que a execução foi contra o projeto certo.
console.log("conexão configurada por variáveis PG*");
console.log(`  projeto ..... ${ref}`);
console.log(`  modo ........ ${modoAceito}`);
console.log(`  porta ....... ${port}`);
console.log(`  base ........ ${base}`);
console.log(`  sslmode ..... ${sslmode}${sslmodeBruto ? "" : " (ausente na URL; exigido pela rota)"}`);
console.log("  host, usuário e senha omitidos do log");
