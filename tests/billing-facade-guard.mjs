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
const INTENCAO = `${DIR}/intencao.ts`;
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
  for (const rel of [INDEX, ENTRADA, DEPS, INTENCAO, RESULTADO]) {
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
  const iAuth = corpo.indexOf("deps.autorizar(papelMinimo,");
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
  // O papel vem do principal RESOLVIDO. Fixá-lo em "owner" faria um membro
  // chegar ao caso de uso disfarçado de proprietário, e `assertTenantOwner`
  // deixaria de proteger o que quer que fosse.
  assert.match(montar, /role: principal\.role/, "o papel é fixado em vez de vir do principal");
  // O recorte é a PROPRIEDADE do objeto devolvido (`role: "owner",`), e não a
  // anotação de tipo do parâmetro — que legitimamente cita os dois papéis.
  assert.doesNotMatch(montar, /role: "owner",/, "o papel é um literal, e não o resolvido");
  assert.match(montar, /correlationId: deps\.ids\.next\("corr"\)/, "a correlação não é gerada no servidor");
  assert.match(montar, /clock: deps\.clock/, "o relógio não é o injetado");

  // Nada do ambiente vem da entrada do chamador.
  assert.doesNotMatch(montar, /entrada\.|parsed\.|bruto/, "montarEnv lê a entrada do chamador");
});

test("FC-06: o organizationId do cliente é COMPARADO, nunca obedecido", () => {
  const src = executavel(INDEX);
  assert.match(
    src,
    /const autorizacao = await deps\.autorizar\(papelMinimo, tenantAfirmado\(bruto\)\);/,
    "o tenant afirmado não é entregue à autorização"
  );
  // O ambiente usa `principal.organizationId`, e não o afirmado.
  assert.doesNotMatch(
    src,
    /organizationId: tenantAfirmado|auth: \{[\s\S]{0,120}organizationId: (e|entrada)\./,
    "o identificador do cliente vira o tenant do contexto"
  );

  const deps = executavel(DEPS);
  // As DUAS famílias comparam o tenant afirmado. Ampliar a leitura para membro
  // não pode ter afrouxado o anti-IDOR num dos dois caminhos.
  assert.match(
    deps,
    /requireBillingOwnerFor\(organizationIdPedido\)/,
    "a comparação de tenant não usa requireBillingOwnerFor"
  );
  assert.match(
    deps,
    /requireBillingMemberFor\(organizationIdPedido\)/,
    "o caminho de membro não compara o tenant afirmado"
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
  for (const rel of [INDEX, ENTRADA, DEPS, INTENCAO, RESULTADO]) {
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

  for (const rel of [INDEX, ENTRADA, DEPS, INTENCAO, RESULTADO]) {
    const src = executavel(rel);
    assert.doesNotMatch(src, /\.schema\(\s*["']billing["']\s*\)/, `${rel}: endereça o schema billing`);
    assert.doesNotMatch(
      src,
      /\.from\(\s*["'`]/,
      `${rel}: endereça tabela diretamente`
    );
    assert.doesNotMatch(src, /check_plan_limit/, `${rel}: chama check_plan_limit`);
    for (const legada of ["subscription_plans", "tenant_subscriptions", "invoices", "billing_events"]) {
      assert.ok(!src.includes(legada), `${rel}: toca a tabela legada ${legada}`);
    }
  }
});

// ── 6. Idempotência ─────────────────────────────────────────────────────────

test("FC-14: a chave deriva da INTENÇÃO, e o chamador não escolhe nada", () => {
  const intencao = executavel(INTENCAO);
  assert.match(intencao, /export function cunharIntencao\(/, "não há cunhagem de intenção");
  assert.match(
    intencao,
    /crypto\.getRandomValues\(bytes\)/,
    "a intenção não vem do CSPRNG da plataforma"
  );
  assert.match(intencao, /const BYTES = 16;/, "a intenção não tem 128 bits");
  assert.match(
    intencao,
    /export const FORMATO_DE_INTENCAO = \/\^ci_\[0-9a-f\]\{32\}\$\//,
    "o formato da intenção deixou de ser fechado"
  );
  assert.doesNotMatch(intencao, /Math\.random/, "a intenção usa sorteio previsível");

  // A DERIVAÇÃO mora no domínio, e cobre operação, organização e intenção.
  const shared = executavel("src/lib/billing/usecases/shared.ts");
  assert.match(shared, /export function chaveDeIdempotencia\(/, "não há derivação de chave");
  assert.match(
    shared,
    /digest\("idem", \{ op: operacao, org: organizationId, intent: checkoutIntentId \}\)/,
    "a chave não cobre operação, organização e intenção"
  );

  // E NÃO cobre período. Era essa dependência que prendia a organização a uma
  // única cobrança por ciclo: recusado no PIX, não havia como tentar cartão.
  const corpoDaChave = /export function chaveDeIdempotencia\([\s\S]*?\n}/.exec(shared)?.[0] ?? "";
  assert.ok(corpoDaChave.length > 0, "chaveDeIdempotencia sumiu");
  assert.doesNotMatch(
    corpoDaChave,
    /period|Period|inicio|fim/,
    "a chave voltou a depender do período — a organização fica presa a uma tentativa por ciclo"
  );
  assert.doesNotMatch(
    corpoDaChave,
    /Date\.now|new Date|Math\.random|randomUUID/,
    "a chave depende de tempo ou sorteio"
  );

  // O recorte para NO schema, e não no fim do arquivo: `CAMPOS_PROIBIDOS` cita
  // `idempotencyKey` de propósito, e varrer até o fim confundiria a proibição
  // com a aceitação.
  const entrada = executavel(ENTRADA);
  const schemaDoCheckout =
    /export const CriarCheckoutSchema = z[\s\S]*?\.strict\(\);/.exec(entrada)?.[0] ?? "";
  assert.ok(schemaDoCheckout.length > 0, "CriarCheckoutSchema sumiu");
  for (const proibido of ["idempotencyKey", "fingerprint"]) {
    assert.ok(
      !new RegExp(proibido).test(schemaDoCheckout),
      `o schema do checkout aceita ${proibido} do cliente`
    );
  }

  // A intenção é OBRIGATÓRIA. Opcional convidaria o ramo "se não veio, invente"
  // — e inventar em silêncio faria cada retry técnico virar cobrança nova, que
  // é o defeito oposto ao antigo e igualmente grave.
  assert.match(
    schemaDoCheckout,
    /checkoutIntentId: z\.string\(\)\.trim\(\)\.regex\(FORMATO_DE_INTENCAO/,
    "a intenção não é exigida com formato fechado no checkout"
  );
  assert.ok(
    !/checkoutIntentId[\s\S]{0,90}?\.optional\(\)/.test(schemaDoCheckout),
    "a intenção virou opcional — ausência passaria a gerar tentativa nova em silêncio"
  );

  // O caso de uso deriva da organização RESOLVIDA e da intenção RECEBIDA —
  // nenhuma das duas vindas do corpo do pedido.
  const payments = executavel("src/lib/billing/usecases/payments.ts");
  assert.match(
    payments,
    /const idempotencyKey = chaveDeIdempotencia\(\s*"checkout",\s*env\.auth\.organizationId,\s*input\.checkoutIntentId\s*\);/,
    "a chave do checkout não é derivada da organização resolvida e da intenção"
  );

  // E a fachada NÃO inventa nem substitui intenção no checkout.
  const index = executavel(INDEX);
  const checkout = /export function criarCheckout\([\s\S]*?\n}/.exec(index)?.[0] ?? "";
  assert.ok(checkout.length > 0, "criarCheckout sumiu");
  assert.match(
    checkout,
    /checkoutIntentId: e\.checkoutIntentId/,
    "o checkout não repassa a intenção recebida"
  );
  assert.doesNotMatch(
    checkout,
    /novaIntencao|cunharIntencao/,
    "o checkout cunha intenção — retry técnico viraria cobrança nova"
  );

  // Cunhar é ato deliberado de UM comando, e ele exige proprietário.
  const preparar =
    /export async function prepararIntencaoDeCheckout\([\s\S]*?\n}/.exec(index)?.[0] ?? "";
  assert.ok(preparar.length > 0, "prepararIntencaoDeCheckout sumiu");
  // Ele NÃO passa por `executarComando`, então a ordem de segurança precisa ser
  // cobrada aqui: sem isto, remover a flag deste comando escaparia de `FC-02`.
  const iFlagPrep = preparar.indexOf("deps.flagLigada()");
  const iAuthPrep = preparar.indexOf("deps.autorizar(");
  const iParsePrep = preparar.indexOf("PrepararIntencaoSchema.safeParse(");
  const iCunhaPrep = preparar.indexOf("deps.novaIntencao()");
  assert.ok(iFlagPrep > 0, "preparar intenção não consulta a flag");
  assert.ok(iFlagPrep < iAuthPrep, "preparar intenção resolve a sessão antes da flag");
  assert.ok(iAuthPrep < iParsePrep, "preparar intenção valida antes de autorizar");
  assert.ok(iParsePrep < iCunhaPrep, "preparar intenção cunha antes de validar");
  assert.match(preparar, /deps\.autorizar\("owner"/, "preparar intenção não exige proprietário");
  assert.match(preparar, /deps\.novaIntencao\(\)/, "preparar intenção não usa a fábrica injetada");
  const cunhagens = [...index.matchAll(/deps\.novaIntencao\(\)/g)].length;
  assert.equal(cunhagens, 1, `${cunhagens} pontos cunham intenção; só o preparo deveria`);
});

test("FC-14b: o digest de identidade financeira é resistente a colisão", () => {
  const dig = executavel("src/lib/billing/core/digest.ts");
  assert.match(dig, /createHash\("sha256"\)/, "o digest não é SHA-256");
  assert.match(dig, /export const GERACAO_DE_DIGEST/, "o digest não tem geração no prefixo");

  // FNV-1a de 32 bits decidia identidade de COBRANÇA. Trinta e dois bits
  // colidem, e a consequência aqui não é cache errado: é checkout recusado.
  const dominio = executavel("src/lib/billing/usecases/shared.ts") + dig + executavel(INTENCAO);
  for (const marca of ["0x811c9dc5", "0x01000193", "Math.imul"]) {
    assert.ok(!dominio.includes(marca), `FNV-1a de 32 bits voltou (${marca})`);
  }
  assert.ok(
    !/padStart\(8, "0"\)/.test(dominio),
    "digest de 8 hex — 32 bits — reapareceu"
  );

  // A canonicalização é INJETIVA: comprimento à frente de nome e valor. A
  // antiga unia `k=v` por `&`, e `{a:"x&b=y"}` colidia com `{a:"x",b:"y"}`.
  assert.match(
    dig,
    /\$\{k\.length\}:\$\{k\}=\$\{v\.length\}:\$\{v\}/,
    "a canonicalização deixou de ser injetiva"
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
  for (const arquivo of [
    "harness.ts",
    "ordem-de-seguranca.spec.ts",
    "intencao.spec.ts",
    "autorizacao.spec.ts",
  ]) {
    assert.ok(existe(`${UNIT}/${arquivo}`), `sem ${arquivo}`);
  }
  assert.ok(existe(CONTRATO), "sem contrato da fachada contra PostgREST");

  const bancada = ler(`${UNIT}/harness.ts`);
  for (const contador of [
    "vezesRepositorio",
    "vezesProvider",
    "vezesAutorizacao",
    "chavesUsadas",
    "papeisExigidos",
    "intencoesCunhadas",
  ]) {
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

  const intencao = ler(`${UNIT}/intencao.spec.ts`);
  for (const [re, queixa] of [
    [/retry com a MESMA intenção devolve replay e não cunha nada/, "não prova o retry idempotente"],
    [/MESMA intenção com payload DIFERENTE é conflito/, "não prova o conflito de fingerprint"],
    [/NOVA intenção permite trocar PIX por cartão/, "não prova a nova tentativa comercial"],
    [/intenção AUSENTE é erro/, "não prova que ausência não gera intenção em silêncio"],
    [/intencoesCunhadas\(\)\)\.toBe\(cunhadasAntes\)/, "não MEDE que o retry não cunha"],
  ]) {
    assert.match(intencao, re, `intencao.spec.ts: ${queixa}`);
  }

  // O teste que tratava o travamento PIX → cartão como CORRETO foi removido.
  // Reintroduzi-lo seria reintroduzir o defeito com prova a favor.
  for (const arquivo of ["intencao.spec.ts", "autorizacao.spec.ts", "ordem-de-seguranca.spec.ts"]) {
    assert.ok(
      !ler(`${UNIT}/${arquivo}`).includes("pedido DIFERENTE sob a mesma chave"),
      `${arquivo}: o teste que endossava o travamento por período voltou`
    );
  }
  assert.ok(
    !existe(`${UNIT}/idempotencia.spec.ts`),
    "idempotencia.spec.ts voltou — a política agora é a da intenção"
  );

  const autorizacao = ler(`${UNIT}/autorizacao.spec.ts`);
  for (const [re, queixa] of [
    [/o que MEMBRO pode fazer, membro faz/, "não prova a ampliação"],
    [/o que MEMBRO não pode fazer, membro não faz/, "não prova o limite da ampliação"],
    [/o membro nunca recebe dado restrito ao proprietário/, "não prova o recorte de dados"],
    [/tenant alheio e tenant inexistente continuam indistinguíveis/, "não prova a indistinguibilidade"],
  ]) {
    assert.match(autorizacao, re, `autorizacao.spec.ts: ${queixa}`);
  }

  // E o CI roda a fachada contra o PostgREST, sem permitir que seja pulada, e
  // derruba as fixtures depois.
  const ci = ler(CI);
  assert.ok(ci.includes("tests/contract/facade-postgrest.spec.ts"), "o CI não roda o contrato da fachada");
  assert.match(ci, /contrato-fachada\.log/, "o CI não guarda o relatório da fachada");
  assert.match(ci, /a fachada foi pulada/, "o CI aceita a fachada pulada");
  assert.match(ci, /teardown-contract-fixtures\.sh/, "o CI deixou de derrubar as fixtures");
});

test("FC-17b: o contrato contra o PostgREST exercita o CHECKOUT, e não pula", () => {
  const contrato = ler(CONTRATO);

  // O repositório é o REAL e o provider é o mock local — nunca o inverso.
  assert.match(contrato, /new SupabaseBillingRepository\(cliente\)/, "o contrato não usa o repositório real");
  assert.match(contrato, /new BillingProviderMock\(/, "o contrato não usa o provider mock");
  assert.ok(
    !contrato.includes("InMemoryBillingRepository"),
    "o contrato caiu para o repositório em memória — é justamente o que ele existe para não fazer"
  );

  // Os cenários obrigatórios, nominalmente. Remover qualquer um reprova aqui.
  for (const [re, queixa] of [
    [/aprovado: exatamente UMA cobrança, UM snapshot e auditoria/, "checkout aprovado"],
    [/replay: mesma intenção e mesmo payload devolvem o MESMO resultado/, "replay"],
    [/concluída: o provider NÃO é chamado de novo no replay/, "provider retocado no replay"],
    [/MESMA intenção com payload DIFERENTE é conflito/, "conflito de fingerprint"],
    [/NOVA intenção permite tentativa legítima/, "nova tentativa comercial"],
    [/PIX recusado não impede nova intenção com CARTÃO/, "troca de meio após recusa"],
    [/recusa DETERMINÍSTICA marca `failed` e libera a repetição imediata/, "recusa determinística"],
    [/indisponibilidade AMBÍGUA preserva `in_progress` e não duplica/, "falha ambígua"],
    [/retomada após a lease: MESMA intenção, MESMO recurso externo/, "retomada após lease"],
    [/falha no `finalizeCheckout` não duplica cobrança/, "falha de finalize"],
    [/mudança de plano no meio não mistura conteúdo/, "conteúdo trocado no meio"],
    [/isolamento: a mesma intenção em outra organização/, "isolamento entre organizações"],
    [/MEMBRO comum obtém a decisão de acesso do tenant/, "leitura por membro"],
    [/MEMBRO comum NÃO lê o dossiê nem escreve nada/, "limite da leitura por membro"],
  ]) {
    assert.match(contrato, re, `o contrato da fachada não cobre: ${queixa}`);
  }

  // As RPCs de idempotência precisam ser atravessadas de verdade.
  for (const rpc of ["claimIdempotency", "finalizeCheckout", "readLedger"]) {
    assert.ok(contrato.includes(rpc), `o contrato não atravessa ${rpc}`);
  }

  // Nenhum caso do checkout pode estar pulado ou isolado. O único skip
  // tolerado é o auto-pulo por ausência de stack, e o CI reprova se ele
  // aparecer no relatório de lá.
  const pulos = [...contrato.matchAll(/\b(it|describe)\.(skip|only|todo)\(/g)].map((m) => m[0]);
  assert.deepEqual(
    pulos,
    ["it.skip("],
    `há caso pulado ou isolado no contrato da fachada: ${pulos.join(", ")}`
  );
  assert.match(
    contrato,
    /it\.skip\("PULADO: defina BILLING_CONTRACT_URL/,
    "o único skip permitido é o auto-pulo por ausência de stack"
  );

  // A faixa de fixtures continua disjunta da do contrato do repositório.
  assert.match(contrato, /const PRIMEIRO_PAR = 60;/, "a faixa da fachada saiu de 60");
  const seed = ler("scripts/ci/seed-contract-fixtures.sql");
  assert.match(seed, /FOR i IN 0\.\.99 LOOP/, "o seed não cobre a faixa ampliada da fachada");
});

test("FC-18: a superfície declarada bate com os comandos exportados", () => {
  const src = executavel(INDEX);
  const exportados = [...src.matchAll(/export (?:async )?function (\w+)\(/g)].map((m) => m[1]).sort();
  const bloco =
    /COMANDOS_DA_FACHADA = Object\.freeze\(\{([\s\S]*?)\} as const satisfies/.exec(src)?.[1];
  assert.ok(bloco !== undefined, "a superfície declarada sumiu");

  const declarados = [...bloco.matchAll(/^\s*(\w+): "(member|owner)",$/gm)].map((m) => m[1]);
  assert.deepEqual(
    exportados,
    [...declarados].sort(),
    "os comandos exportados divergiram da superfície declarada — a matriz de autorização precisa ser revista"
  );

  // Cortesia e grandfathering NÃO são oferecidos ao cliente nesta etapa.
  for (const administrativo of ["grantCourtesy", "revokeCourtesy", "saveGrandfathering", "applyProviderEvent"]) {
    assert.ok(!src.includes(administrativo), `a fachada expõe a operação administrativa ${administrativo}`);
  }
});

// ── 9. A matriz de papéis ───────────────────────────────────────────────────

/** A matriz APROVADA, escrita por extenso. Papel não se decide em silêncio. */
const MATRIZ_APROVADA = {
  lerCatalogo: "member",
  lerAcesso: "member",
  lerAssinatura: "owner",
  iniciarTrial: "owner",
  atualizarEmailFinanceiro: "owner",
  aceitarTermos: "owner",
  registrarTrabalhadores: "owner",
  escolherPlano: "owner",
  fazerUpgrade: "owner",
  agendarDowngrade: "owner",
  cancelarNoFimDoPeriodo: "owner",
  prepararIntencaoDeCheckout: "owner",
  criarCheckout: "owner",
};

/** Comandos que ALTERAM contrato ou cobram. Nenhum pode aceitar membro. */
const ESCRITAS = [
  "iniciarTrial",
  "atualizarEmailFinanceiro",
  "aceitarTermos",
  "registrarTrabalhadores",
  "escolherPlano",
  "fazerUpgrade",
  "agendarDowngrade",
  "cancelarNoFimDoPeriodo",
  "criarCheckout",
];

function corpoDoComando(src, nome) {
  return new RegExp(`export (?:async )?function ${nome}\\([\\s\\S]*?\\n}`).exec(src)?.[0] ?? "";
}

test("FC-19: a matriz de papéis é a acordada, e nenhuma escrita aceita membro", () => {
  const src = executavel(INDEX);
  const bloco =
    /COMANDOS_DA_FACHADA = Object\.freeze\(\{([\s\S]*?)\} as const satisfies/.exec(src)?.[1] ?? "";
  const matriz = Object.fromEntries(
    [...bloco.matchAll(/^\s*(\w+): "(member|owner)",$/gm)].map((m) => [m[1], m[2]])
  );
  assert.deepEqual(matriz, MATRIZ_APROVADA, "a matriz de papéis divergiu da acordada");

  // O papel declarado é o que cada comando REALMENTE passa adiante.
  for (const [comando, papel] of Object.entries(MATRIZ_APROVADA)) {
    const corpo = corpoDoComando(src, comando);
    assert.ok(corpo.length > 0, `${comando} sumiu`);
    assert.ok(
      new RegExp(`"${papel}"`).test(corpo),
      `${comando} declara "${papel}" na matriz mas não o exige na autorização`
    );
  }

  // Dito de forma INDEPENDENTE da matriz: se alguém rebaixar um comando de
  // escrita nos dois lugares de uma vez, isto ainda reprova.
  for (const comando of ESCRITAS) {
    assert.ok(
      !/"member"/.test(corpoDoComando(src, comando)),
      `${comando} é escrita e aceita membro — a ampliação vazou para o que altera contrato`
    );
  }

  // O dossiê comercial continua fechado ao membro.
  assert.ok(
    !/"member"/.test(corpoDoComando(src, "lerAssinatura")),
    "lerAssinatura aceita membro — CNPJ, contato financeiro e preço praticado vazariam"
  );

  // E a decisão de acesso NÃO exige proprietário: era o defeito que fechava a
  // porta para o enforcement de entitlements de quem não paga.
  assert.ok(
    !/"owner"/.test(corpoDoComando(src, "lerAcesso")),
    "lerAcesso voltou a exigir proprietário — o colaborador fica sem entitlements"
  );
});

test("FC-19b: os casos de uso declaram o papel, e só duas consultas são de membro", () => {
  const shared = executavel("src/lib/billing/usecases/shared.ts");
  assert.match(shared, /export function assertTenantOwner</, "assertTenantOwner não existe");
  assert.match(shared, /export function assertTenantMember</, "assertTenantMember não existe");
  assert.ok(
    !/export function assertTenant</.test(shared),
    "o `assertTenant` ambíguo continua exportado — dois nomes para a mesma decisão"
  );

  const owner = /export function assertTenantOwner<[\s\S]*?\n}/.exec(shared)?.[0] ?? "";
  assert.match(owner, /auth\.role !== "owner"/, "assertTenantOwner não confere o papel");

  // As chamadas de membro são EXATAMENTE as esperadas, por arquivo.
  const usoDeMembro = [];
  for (const arquivo of ["access.ts", "payments.ts", "queries.ts", "subscription.ts"]) {
    const src = executavel(`src/lib/billing/usecases/${arquivo}`);
    for (const _ of src.matchAll(/assertTenantMember</g)) usoDeMembro.push(arquivo);
  }
  assert.deepEqual(
    usoDeMembro.sort(),
    ["access.ts", "queries.ts"],
    `assertTenantMember aparece em ${usoDeMembro.join(", ")}; só a decisão de acesso e o catálogo`
  );

  // O catálogo é de membro; o dossiê é de proprietário.
  const queries = executavel("src/lib/billing/usecases/queries.ts");
  const catalogo = /export async function readCatalogUseCase\([\s\S]*?\n}/.exec(queries)?.[0] ?? "";
  const estado = /export async function readSubscriptionState\([\s\S]*?\n}/.exec(queries)?.[0] ?? "";
  assert.match(catalogo, /assertTenantMember</, "o catálogo exige proprietário");
  assert.match(estado, /assertTenantOwner</, "o dossiê comercial aceita membro");

  // E o resolvedor de sessão devolve o papel REAL, com padrão de menor
  // privilégio: papel ausente ou inesperado não pode virar `owner`.
  const autorizacao = executavel("src/lib/billing/authorization.ts");
  assert.match(autorizacao, /export async function requireBillingMember\(/, "não há resolvedor de membro");
  assert.match(
    autorizacao,
    /membership\.role === "owner" \? \("owner" as const\) : \("member" as const\)/,
    "o papel resolvido não tem padrão de menor privilégio"
  );
});

// ── 10. Uma leitura, um caso de uso ─────────────────────────────────────────

test("FC-20: a fachada não lê o banco nem decide domínio", () => {
  const src = executavel(INDEX);

  // Nenhum comando chama o repositório diretamente. A versão anterior fazia
  // isso em três: `lerCatalogo`, `lerAssinatura` e — pior — `criarCheckout`,
  // que lia o estado para derivar a chave e depois chamava um caso de uso que
  // lia de novo.
  const leituras = [...src.matchAll(/env\.repo\.\w+\(/g)].map((m) => m[0]);
  assert.deepEqual(leituras, [], `a fachada acessa o repositório diretamente: ${leituras.join(", ")}`);

  // E não toma decisão de domínio: `not_found` para assinatura inexistente é
  // de `exigirAssinatura`, e escrevê-lo aqui duplicaria a regra em duas camadas.
  assert.ok(!/\bfail\(/.test(src), "a fachada produz recusa de domínio por conta própria");
  assert.ok(!src.includes('"not_found"'), "a fachada decide `not_found` — regra de domínio duplicada");

  const checkout = corpoDoComando(src, "criarCheckout");
  assert.ok(checkout.length > 0, "criarCheckout sumiu");
  assert.ok(
    !/readState|subscription|assinatura/.test(checkout),
    "o checkout voltou a ler o estado na fachada — duas leituras e TOCTOU"
  );

  // Exatamente UM caso de uso por comando.
  const CASOS_DE_USO =
    /\b(readCatalogUseCase|readSubscriptionState|resolveBillingAccess|createCheckout|startTrial|acceptTerms|updateBillingEmail|recordWorkerCount|choosePlan|upgradeSubscription|scheduleDowngradeUseCase|cancelAtPeriodEnd)\(/g;
  const ESPERADOS = {
    lerCatalogo: "readCatalogUseCase",
    lerAssinatura: "readSubscriptionState",
    lerAcesso: "resolveBillingAccess",
    criarCheckout: "createCheckout",
    iniciarTrial: "startTrial",
    atualizarEmailFinanceiro: "updateBillingEmail",
    aceitarTermos: "acceptTerms",
    registrarTrabalhadores: "recordWorkerCount",
    escolherPlano: "choosePlan",
    fazerUpgrade: "upgradeSubscription",
    agendarDowngrade: "scheduleDowngradeUseCase",
    cancelarNoFimDoPeriodo: "cancelAtPeriodEnd",
  };
  for (const [comando, caso] of Object.entries(ESPERADOS)) {
    const corpo = corpoDoComando(src, comando);
    const chamadas = [...corpo.matchAll(CASOS_DE_USO)];
    assert.equal(
      chamadas.length,
      1,
      `${comando} chama ${chamadas.length} casos de uso; a etapa 10 exige exatamente um`
    );
    assert.equal(chamadas[0][1], caso, `${comando} chama ${chamadas[0][1]} em vez de ${caso}`);
  }

  // E o caso de uso do checkout lê o estado UMA vez.
  const payments = executavel("src/lib/billing/usecases/payments.ts");
  const criar = /export async function createCheckout\([\s\S]*?\n}/.exec(payments)?.[0] ?? "";
  const lidas = [...criar.matchAll(/exigirAssinatura\(env\)|env\.repo\.readState\(/g)];
  assert.equal(lidas.length, 1, `createCheckout lê o estado ${lidas.length} vezes; uma basta`);
});

console.log(`\nBilling facade guard: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
