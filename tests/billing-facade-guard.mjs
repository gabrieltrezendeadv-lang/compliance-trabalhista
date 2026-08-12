/**
 * FACHADA DE APLICAÇÃO DE BILLING — Etapa 12C.2
 *
 * Guarda estática do que só se lê: a ordem das onze etapas, a ausência de
 * fronteira pública, os campos que nenhum schema aceita e a política de
 * idempotência.
 *
 * ── O QUE ESTA GUARDA COBRE, E O QUE NÃO COBRE ──────────────────────────────
 *
 * COBRE a FORMA: a flag antes de tudo, o provider só para quem precisa, os
 * schemas fechados, nenhuma página ou action alcançando a fachada, a chave
 * derivada e não recebida.
 *
 * NÃO COBRE comportamento — isso é de `tests/unit/billing/facade/`, que MEDE as
 * contagens de fábrica, e de `tests/contract/facade-postgrest.spec.ts`, que roda
 * a fachada contra o PostgREST da stack descartável.
 *
 * `tests/billing-facade-mutation-guard.mjs` prova que cada asserção morde.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8").replace(/\r\n?/g, "\n");
const existe = (p) => fs.existsSync(path.join(raiz, p));

const DIR = "src/lib/billing/facade";
const INDEX = `${DIR}/index.ts`;
const ENTRADA = `${DIR}/entrada.ts`;
const DEPS = `${DIR}/dependencias.ts`;
const IDEM = `${DIR}/idempotencia.ts`;
const RESULTADO = `${DIR}/resultado.ts`;
const UNIT = "tests/unit/billing/facade";
const CONTRATO = "tests/contract/facade-postgrest.spec.ts";
const CI = ".github/workflows/ci.yml";

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

/**
 * A lista de campos proibidos, LIDA do arquivo e não importada.
 *
 * `entrada.ts` começa com `import "server-only"`, que ABORTA sob Node puro —
 * é a proteção funcionando. A lista continua tendo uma fonte só: esta função a
 * extrai de lá, e se ela sumir a guarda reprova em vez de comparar contra uma
 * cópia velha.
 */
function camposProibidos() {
  const bloco = /export const CAMPOS_PROIBIDOS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(
    ler(ENTRADA)
  );
  if (bloco === null) throw new Error("CAMPOS_PROIBIDOS sumiu de entrada.ts");
  return [...bloco[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

/** TypeScript sem comentários — só o que o motor executa. */
function executavel(rel) {
  return ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

/** Todos os `.ts`/`.tsx` de `src/`, para as varreduras de fronteira. */
function fontesDeSrc() {
  const saida = [];
  const andar = (dir) => {
    for (const e of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) andar(rel);
      else if (/\.tsx?$/.test(e.name)) saida.push(rel);
    }
  };
  andar("src");
  return saida;
}

// ── 1. Os arquivos existem e são server-only ────────────────────────────────

test("FC-01: a fachada existe e é inteiramente server-only", () => {
  for (const rel of [INDEX, ENTRADA, DEPS, IDEM, RESULTADO]) {
    assert.ok(existe(rel), `${rel} ausente`);
    assert.match(
      ler(rel),
      /^import "server-only";$/m,
      `${rel}: sem \`import "server-only"\` — poderia ir para o bundle do browser`
    );
  }
});

// ── 2. A ordem das onze etapas ──────────────────────────────────────────────

test("FC-02: a flag é a PRIMEIRA coisa, antes de sessão, banco e provider", () => {
  const src = executavel(INDEX);
  const corpo = /async function executarComando[\s\S]*?\n}/.exec(src)?.[0] ?? "";
  assert.ok(corpo.length > 0, "executarComando sumiu");

  const iFlag = corpo.indexOf("deps.flagLigada()");
  const iAuth = corpo.indexOf("deps.autorizar(");
  const iParse = corpo.indexOf("schema.safeParse(");
  const iRepo = corpo.indexOf("montarEnv(");
  const iProvider = corpo.indexOf("deps.provider()");

  assert.ok(iFlag > 0, "a flag não é consultada");
  assert.ok(iAuth > 0, "a sessão não é resolvida");
  assert.ok(iParse > 0, "a entrada não é validada");
  assert.ok(iProvider > 0, "o provider nunca é resolvido");

  // 1–2 antes de 3–6; 3–6 antes de 7; 7 antes de 8–9.
  assert.ok(iFlag < iAuth, "a sessão é resolvida ANTES da flag — billing desligado faria I/O");
  assert.ok(iAuth < iParse, "a validação vem ANTES da autorização");
  assert.ok(iParse < iProvider, "o provider é resolvido ANTES da validação");
  assert.ok(iParse < iRepo, "o ambiente é montado ANTES da validação");

  // E a recusa da flag é a primeira instrução com efeito.
  assert.match(
    corpo,
    /if \(!deps\.flagLigada\(\)\) return recusaPadrao\("billing_disabled"\);/,
    "a flag desligada não para com resultado tipado"
  );
});

test("FC-03: o repositório e o provider são FÁBRICAS, e por isso observáveis", () => {
  const src = executavel(DEPS);
  assert.match(src, /repositorio: \(\) => BillingRepository/, "repositorio não é fábrica");
  assert.match(src, /provider: \(\) => BillingProviderPort/, "provider não é fábrica");

  // Instância pronta na composição construiria o repositório — e exigiria a
  // chave `service_role` — mesmo com billing desligado.
  const producao = /export function dependenciasDeProducao[\s\S]*?\n}/.exec(src)?.[0] ?? "";
  assert.match(producao, /repositorio: \(\) => new SupabaseBillingRepository\(\)/, "fiação errada");
  assert.match(producao, /provider: \(\) => resolveBillingProvider\(\)/, "fiação errada");
});

test("FC-04: o provider só é resolvido sob pedido explícito", () => {
  const src = executavel(INDEX);
  // `precisaDeProvider` é parâmetro, não inferência: inferir levaria a
  // "resolve sempre, por garantia", que é o oposto da etapa 9.
  assert.match(src, /precisaDeProvider = false/, "o provider não é opcional por padrão");
  assert.match(src, /if \(precisaDeProvider\) \{/, "o provider é resolvido incondicionalmente");

  // Exatamente um comando pede provider, e é o checkout.
  const pedidos = [...src.matchAll(/\n {4}true\n {2}\);/g)].length;
  assert.equal(pedidos, 1, `${pedidos} comandos pedem provider; só o checkout deveria`);
  assert.match(
    src,
    /export function criarCheckout[\s\S]*?\n {4}true\n {2}\);/,
    "quem pede o provider não é o checkout"
  );
});

test("FC-05: o contexto confiável é montado do que o SERVIDOR resolveu", () => {
  const src = executavel(INDEX);
  const montar = /function montarEnv\([\s\S]*?\n}/.exec(src)?.[0] ?? "";

  assert.match(montar, /userId: principal\.userId/, "o ator não vem do principal resolvido");
  assert.match(montar, /organizationId: principal\.organizationId/, "a organização não vem do principal");
  assert.match(montar, /role: "owner"/, "o papel não é fixado");
  assert.match(montar, /correlationId: deps\.ids\.next\("corr"\)/, "a correlação não é gerada no servidor");
  assert.match(montar, /clock: deps\.clock/, "o relógio não é o injetado");

  // Nada do ambiente vem da entrada do chamador.
  assert.doesNotMatch(montar, /entrada\.|parsed\.|bruto/, "montarEnv lê a entrada do chamador");
});

test("FC-06: o organizationId do cliente é COMPARADO, nunca obedecido", () => {
  const src = executavel(INDEX);
  assert.match(
    src,
    /const autorizacao = await deps\.autorizar\(tenantAfirmado\(bruto\)\);/,
    "o tenant afirmado não é entregue à autorização"
  );
  // O ambiente usa `principal.organizationId`, e não o afirmado.
  assert.doesNotMatch(
    src,
    /organizationId: tenantAfirmado|auth: \{[\s\S]{0,120}organizationId: (e|entrada)\./,
    "o identificador do cliente vira o tenant do contexto"
  );

  const deps = executavel(DEPS);
  assert.match(
    deps,
    /requireBillingOwnerFor\(organizationIdPedido\)/,
    "a comparação de tenant não usa requireBillingOwnerFor"
  );
});

// ── 3. Entradas fechadas ────────────────────────────────────────────────────

test("FC-07: todo schema é `.strict()` — campo a mais é erro, não silêncio", () => {
  const src = executavel(ENTRADA);
  const schemas = [...src.matchAll(/export const (\w+Schema) = z\n?\s*\.object\(/g)].map((m) => m[1]);
  assert.ok(schemas.length >= 10, `apenas ${schemas.length} schemas — a varredura não os alcança`);

  const estritos = [...src.matchAll(/\.strict\(\)/g)].length;
  assert.equal(
    estritos,
    schemas.length,
    `${schemas.length} schemas e ${estritos} \`.strict()\` — algum aceita campo desconhecido`
  );
});

test("FC-08: nenhum schema declara campo que o servidor resolve", () => {
  const src = executavel(ENTRADA);
  const corpoDosSchemas = src.slice(src.indexOf("export const IniciarTrialSchema"));

  const proibidos = camposProibidos();
  assert.ok(proibidos.length >= 20, `a lista de campos proibidos tem ${proibidos.length} entradas`);
  for (const campo of proibidos) {
    assert.ok(
      !new RegExp(`^\\s+${campo}:`, "m").test(corpoDosSchemas),
      `algum schema declara \`${campo}\`, que é resolvido no servidor`
    );
  }

  // `organizationId` e `termsVersion` são a exceção declarada: aceitos, e
  // nenhum dos dois autoriza ou decide.
  assert.match(corpoDosSchemas, /organizationId: organizacaoPedida/, "o tenant afirmado sumiu");
  assert.match(corpoDosSchemas, /termsVersion: versaoDeTermos/, "a versão afirmada sumiu");
});

test("FC-09: CNPJ, contagem, plano e periodicidade têm schema fechado", () => {
  const src = executavel(ENTRADA);
  assert.match(src, /const cnpj = z[\s\S]{0,120}?\/\^\\d\{14\}\$\//, "CNPJ sem forma fechada");
  assert.match(src, /const workerCount = z\.number\(\)\.int\(\)\.min\(1\)/, "contagem sem piso inteiro");
  assert.match(src, /const plano = z\.enum\(\["essencial", "completo"\]\)/, "plano não é enum fechado");
  assert.match(src, /const periodicidade = z\.enum\(\["monthly", "yearly"\]\)/, "periodicidade não é enum fechado");
  assert.match(src, /const versaoDeTermos = z[\s\S]{0,140}?\\d\{4\}-\\d\{2\}-\\d\{2\}/, "versão sem formato");
  assert.match(src, /\.max\(254\)/, "e-mail sem o limite da RFC 5321");

  // Nenhum patch genérico.
  assert.doesNotMatch(src, /z\.record\(|z\.any\(|passthrough\(/, "há schema genérico ou permissivo");
});

// ── 4. Nenhuma fronteira pública ────────────────────────────────────────────

test("FC-10: a fachada não tem consumidor em src/app, action, rota ou middleware", () => {
  const culpados = [];
  for (const arquivo of fontesDeSrc()) {
    if (arquivo.startsWith(DIR)) continue;
    const src = executavel(arquivo);
    if (/from "@\/lib\/billing\/facade|from "\.\.?\/facade/.test(src)) {
      culpados.push(arquivo);
    }
  }
  assert.deepEqual(
    culpados,
    [],
    `a fachada ganhou consumidor antes da 12C.3:\n  ${culpados.join("\n  ")}`
  );

  // E ela própria não se publica.
  for (const rel of [INDEX, ENTRADA, DEPS, IDEM, RESULTADO]) {
    assert.doesNotMatch(ler(rel), /"use server"/, `${rel} virou server action`);
  }
});

test("FC-11: nada de página, rota, webhook ou item de menu nesta etapa", () => {
  // A ÚNICA página de billing que pode existir é o redirect que a 12C.0
  // preservou. Qualquer outra rota ou página é fronteira nova, e a 12C.2 não
  // cria fronteira.
  const pagina = "src/app/(dashboard)/dashboard/billing/page.tsx";
  const novos = fontesDeSrc().filter(
    (a) => a !== pagina && /^src\/app\/.*\/(route|page)\.tsx?$/.test(a) && /billing/i.test(a)
  );
  assert.deepEqual(novos, [], `rota ou página de billing criada: ${novos.join(", ")}`);

  assert.ok(existe(pagina), "a página de billing sumiu");
  const conteudo = executavel(pagina);
  assert.match(conteudo, /redirect\("\/dashboard"\)/, "a página deixou de ser um redirect");
  assert.doesNotMatch(conteudo, /facade|checkout|preco|price/i, "a página ganhou conteúdo de billing");

  // Nenhum middleware novo, e nenhuma menção a billing no existente.
  if (existe("src/middleware.ts")) {
    assert.doesNotMatch(executavel("src/middleware.ts"), /billing/i, "o middleware passou a falar de billing");
  }
});

test("FC-12: a feature flag continua desligada e sem configuração versionada", () => {
  const env = ler(".env.example");
  assert.doesNotMatch(env, /^BILLING_ENABLED=/m, ".env.example passou a definir BILLING_ENABLED");
  assert.match(env, /^BILLING_PROVIDER=$/m, "BILLING_PROVIDER deixou de ser fail-closed");

  // A fachada consulta a flag; ela não a define nem a contorna.
  const src = executavel(INDEX) + executavel(DEPS);
  assert.doesNotMatch(src, /BILLING_ENABLED\s*=/, "a fachada atribui a flag");
  assert.match(executavel(DEPS), /flagLigada: isBillingEnabled/, "a fiação não usa isBillingEnabled");
});

// ── 5. Persistência: nada novo, e nada direto ───────────────────────────────

test("FC-13: zero migration nova e zero acesso direto a billing", () => {
  const dir = path.join(raiz, "supabase/migrations");
  const sql = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  assert.equal(sql.length, 41, `esperadas 41 migrations, há ${sql.length} — a 12C.2 não cria SQL`);

  for (const rel of [INDEX, ENTRADA, DEPS, IDEM, RESULTADO]) {
    const src = executavel(rel);
    assert.doesNotMatch(src, /\.schema\(\s*["']billing["']\s*\)/, `${rel}: endereça o schema billing`);
    assert.doesNotMatch(src, /\.from\(/, `${rel}: acessa tabela diretamente`);
    assert.doesNotMatch(src, /check_plan_limit/, `${rel}: chama check_plan_limit`);
    for (const legada of ["subscription_plans", "tenant_subscriptions", "invoices", "billing_events"]) {
      assert.ok(!src.includes(legada), `${rel}: toca a tabela legada ${legada}`);
    }
  }
});

// ── 6. Idempotência ─────────────────────────────────────────────────────────

test("FC-14: a chave é DERIVADA no servidor, e o chamador não a envia", () => {
  const idem = executavel(IDEM);
  assert.match(idem, /export function derivarChave\(/, "não há derivação de chave");
  assert.match(idem, /fingerprintDe\(\{/, "a chave não reusa a canonicalização do domínio");
  assert.match(idem, /op: operacao[\s\S]{0,120}?org: organizationId/, "a chave não cobre operação e organização");

  // Nem relógio, nem sorteio, nem estado em memória.
  assert.doesNotMatch(idem, /Date\.now|new Date|Math\.random|randomUUID/, "a chave depende de tempo ou sorteio");
  assert.doesNotMatch(idem, /let |Map\(|Set\(/, "a chave depende de estado em memória");

  // O recorte para NO schema, e não no fim do arquivo: `CAMPOS_PROIBIDOS` cita
  // `idempotencyKey` de propósito, e varrer até o fim confundiria a proibição
  // com a aceitação.
  const entrada = executavel(ENTRADA);
  const schemaDoCheckout =
    /export const CriarCheckoutSchema = z[\s\S]*?\.strict\(\);/.exec(entrada)?.[0] ?? "";
  assert.ok(schemaDoCheckout.length > 0, "CriarCheckoutSchema sumiu");
  assert.ok(
    !/idempotencyKey/.test(schemaDoCheckout),
    "o schema do checkout aceita chave do cliente"
  );

  const index = executavel(INDEX);
  assert.match(
    index,
    /idempotencyKey: derivarChave\(\s*"checkout",\s*env\.auth\.organizationId/,
    "o checkout não usa a chave derivada da organização resolvida"
  );
});

// ── 7. Erros e privacidade ──────────────────────────────────────────────────

test("FC-15: união fechada de resultados, sem mensagem de infraestrutura", () => {
  const src = executavel(RESULTADO);
  assert.match(src, /export type FacadeErrorCode = BillingErrorCode \| "billing_disabled" \| "unauthenticated"/,
    "a união de códigos deixou de ser fechada");
  assert.match(src, /const MENSAGENS: Record<FacadeErrorCode, string>/, "as mensagens não são exaustivas");

  // A mensagem do domínio é descartada: ela traz o contexto da chamada.
  const traduzir = /export function traduzir[\s\S]*?\n}/.exec(src)?.[0] ?? "";
  assert.match(traduzir, /MENSAGENS\[erro\.code\]/, "a tradução propaga a mensagem do domínio");
  assert.doesNotMatch(traduzir, /erro\.message/, "a mensagem do domínio atravessa a fachada");

  // Alheio, inexistente e sem-permissão dizem a MESMA coisa.
  const m = /const MENSAGENS[\s\S]*?\n};/.exec(src)?.[0] ?? "";
  const notOwner = /not_owner: "([^"]+)"/.exec(m)?.[1];
  const mismatch = /tenant_mismatch: "([^"]+)"/.exec(m)?.[1];
  const notFound = /not_found: "([^"]+)"/.exec(m)?.[1];
  assert.equal(mismatch, notOwner, "tenant alheio é distinguível de não-proprietário");
  assert.equal(notFound, notOwner, "organização inexistente é distinguível de alheia");
});

test("FC-16: nenhuma exceção desconhecida vira autorização", () => {
  const src = executavel(INDEX);
  // O único `catch` da fachada é o do provider, e ele NEGA.
  const catches = [...src.matchAll(/catch\s*(\([^)]*\))?\s*\{([\s\S]{0,200}?)\}/g)];
  for (const [, , corpo] of catches) {
    assert.match(corpo, /return recusaPadrao\(/, `um catch não devolve recusa: ${corpo.trim().slice(0, 80)}`);
  }
  assert.equal(catches.length, 1, `${catches.length} blocos catch; só o do provider é esperado`);
});

// ── 8. Os testes existem e medem o que dizem medir ──────────────────────────

test("FC-17: a bateria da fachada existe e mede as fábricas", () => {
  assert.ok(existe(`${UNIT}/harness.ts`), "sem bancada");
  assert.ok(existe(`${UNIT}/ordem-de-seguranca.spec.ts`), "sem teste de ordem");
  assert.ok(existe(`${UNIT}/idempotencia.spec.ts`), "sem teste de idempotência");
  assert.ok(existe(CONTRATO), "sem contrato da fachada contra PostgREST");

  const bancada = ler(`${UNIT}/harness.ts`);
  for (const contador of ["vezesRepositorio", "vezesProvider", "vezesAutorizacao", "chavesUsadas"]) {
    assert.ok(bancada.includes(contador), `a bancada não expõe ${contador}`);
  }

  const ordem = ler(`${UNIT}/ordem-de-seguranca.spec.ts`);
  for (const [re, queixa] of [
    [/vezesRepositorio\(\)\)\.toBe\(0\)/, "não prova que billing desligado não toca banco"],
    [/vezesProvider\(\)\)\.toBe\(0\)/, "não prova que a leitura não resolve provider"],
    [/vezesAutorizacao\(\)\)\.toBe\(0\)/, "não prova que billing desligado não resolve sessão"],
    [/INDISTINGUÍVEIS/, "não prova a indistinguibilidade entre alheio e inexistente"],
    [/IDOR/, "não cobre IDOR"],
  ]) {
    assert.match(ordem, re, `ordem-de-seguranca.spec.ts: ${queixa}`);
  }

  const idem = ler(`${UNIT}/idempotencia.spec.ts`);
  assert.match(idem, /retry legítimo reutiliza a MESMA chave/, "não prova o retry idempotente");
  assert.match(idem, /é CONFLITO/, "não prova o conflito de fingerprint");

  // E o CI roda a fachada contra o PostgREST, sem permitir que seja pulada.
  const ci = ler(CI);
  assert.ok(ci.includes("tests/contract/facade-postgrest.spec.ts"), "o CI não roda o contrato da fachada");
  assert.match(ci, /contrato-fachada\.log/, "o CI não guarda o relatório da fachada");
  assert.match(ci, /a fachada foi pulada/, "o CI aceita a fachada pulada");
});

test("FC-18: a superfície declarada bate com os comandos exportados", () => {
  const src = executavel(INDEX);
  const exportados = [...src.matchAll(/export function (\w+)\(/g)].map((m) => m[1]).sort();
  const declarados = (/COMANDOS_DA_FACHADA = Object\.freeze\(\[([\s\S]*?)\] as const\)/.exec(src)?.[1] ?? "")
    .match(/"(\w+)"/g)
    ?.map((s) => s.replace(/"/g, ""))
    .sort();

  assert.ok(declarados !== undefined, "a superfície declarada sumiu");
  assert.deepEqual(
    exportados,
    declarados,
    "os comandos exportados divergiram da superfície declarada — a matriz de autorização precisa ser revista"
  );

  // Cortesia e grandfathering NÃO são oferecidos ao cliente nesta etapa.
  for (const administrativo of ["grantCourtesy", "revokeCourtesy", "saveGrandfathering", "applyProviderEvent"]) {
    assert.ok(!src.includes(administrativo), `a fachada expõe a operação administrativa ${administrativo}`);
  }
});

console.log(`\nBilling facade guard: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
