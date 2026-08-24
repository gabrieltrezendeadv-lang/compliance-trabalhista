/**
 * MUTAÇÕES DA FACHADA — Etapa 12C.2
 *
 * O repositório é copiado, a mutação é aplicada ao arquivo REAL dentro da
 * cópia, a guarda REAL roda lá dentro, e o teste exige REPROVAÇÃO pela asserção
 * nominal. Nada é escrito na árvore de trabalho.
 *
 * ── AS DUAS FAMÍLIAS DE MUTAÇÃO ─────────────────────────────────────────────
 *
 * ESTÁTICAS quebram a forma e são pegas por `billing-facade-guard.mjs`:
 * remover a flag, mover a flag para depois do banco, confiar no
 * `organizationId`, resolver o provider cedo demais, publicar a fachada.
 *
 * COMPORTAMENTAIS quebram o efeito e são pegas pela suíte de unidade — a que
 * MEDE as fábricas. Elas rodam o Vitest dentro da cópia, porque nenhuma leitura
 * de texto pegaria "a flag foi consultada mas o banco também".
 *
 * `MUT-FC-00` é o controle: sem mutação, tudo passa.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const COPIAR = [
  "tests",
  "src",
  "supabase",
  "scripts",
  ".github",
  "package.json",
  ".env.example",
  "tsconfig.json",
  "vitest.config.mts",
  "tsconfig.test.json",
  "node_modules",
];
const copia = fs.mkdtempSync(path.join(os.tmpdir(), "billing-facade-mut-"));

for (const item of COPIAR) {
  const origem = path.join(raiz, item);
  if (!fs.existsSync(origem)) continue;
  // `node_modules` entra por link: copiá-lo levaria minutos e gigabytes, e o
  // que se muta nunca está lá.
  if (item === "node_modules") {
    try {
      fs.symlinkSync(origem, path.join(copia, item), "junction");
    } catch {
      fs.cpSync(origem, path.join(copia, item), { recursive: true });
    }
    continue;
  }
  fs.cpSync(origem, path.join(copia, item), { recursive: true });
}

const GUARDA = "tests/billing-facade-guard.mjs";

function guarda() {
  try {
    const out = execFileSync("node", [GUARDA], { cwd: copia, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/** Toda a bateria de unidade de billing, dentro da cópia. */
function unidadeDeBilling() {
  try {
    const out = execFileSync(
      "npx",
      ["--no-install", "vitest", "run", "--project", "unit", "tests/unit/billing"],
      { cwd: copia, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" }
    );
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

/** A suíte de unidade da fachada, dentro da cópia. É ela que MEDE o efeito. */
function unidade() {
  try {
    const out = execFileSync(
      "npx",
      ["--no-install", "vitest", "run", "--project", "unit", "tests/unit/billing/facade"],
      { cwd: copia, encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" }
    );
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

const lerCopia = (rel) => fs.readFileSync(path.join(copia, rel), "utf8");
const escreverCopia = (rel, texto) => {
  fs.mkdirSync(path.dirname(path.join(copia, rel)), { recursive: true });
  fs.writeFileSync(path.join(copia, rel), texto, "utf8");
};

/**
 * Substitui texto na cópia, roda o verificador e restaura.
 *
 * A âncora precisa casar EXATAMENTE uma vez: âncora ambígua muta o lugar errado
 * e o teste passa por engano.
 */
function mutar(rel, de, para, esperado, verificador = guarda) {
  const original = lerCopia(rel);
  const crlf = original.includes("\r\n");
  const plano = original.replace(/\r\n/g, "\n");
  const n = plano.split(de).length - 1;
  assert.equal(n, 1, `a mutação em ${rel} casou ${n} vez(es), esperado 1 — reescreva-a`);

  const mutado = plano.replace(de, () => para);
  escreverCopia(rel, crlf ? mutado.replace(/\n/g, "\r\n") : mutado);
  try {
    const r = verificador();
    assert.equal(r.code, 1, `a mutação em ${rel} passou:\n${r.out.slice(-2000)}`);
    assert.match(r.out, esperado, `reprovou, mas não pela asserção esperada:\n${r.out.slice(-2000)}`);
  } finally {
    escreverCopia(rel, original);
  }
}

/** Cria arquivo que não existia, roda o verificador e apaga. */
function criar(rel, conteudo, esperado, verificador = guarda) {
  const alvo = path.join(copia, rel);
  assert.ok(!fs.existsSync(alvo), `${rel} já existe`);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, "utf8");
  try {
    const r = verificador();
    assert.equal(r.code, 1, `criar ${rel} passou:\n${r.out.slice(-2000)}`);
    assert.match(r.out, esperado);
  } finally {
    fs.rmSync(alvo, { force: true });
  }
}

const FACADE = "src/lib/billing/facade/index.ts";
const CONTRATO = "tests/contract/facade-postgrest.spec.ts";
const PAYMENTS = "src/lib/billing/usecases/payments.ts";
const ENTRADA = "src/lib/billing/facade/entrada.ts";
const DEPS = "src/lib/billing/facade/dependencias.ts";
const INTENCAO = "src/lib/billing/facade/intencao.ts";
const SHARED = "src/lib/billing/usecases/shared.ts";
const QUERIES = "src/lib/billing/usecases/queries.ts";
const AUTZ = "src/lib/billing/authorization.ts";
const RESULTADO = "src/lib/billing/facade/resultado.ts";

// ── Controle ────────────────────────────────────────────────────────────────

test("MUT-FC-00: sem mutação, a guarda PASSA na cópia", () => {
  const r = guarda();
  assert.equal(r.code, 0, `a guarda deveria passar sem mutação:\n${r.out.slice(-2000)}`);
  assert.match(r.out, /0 failed/);
});

test("MUT-FC-00b: sem mutação, a suíte de unidade PASSA na cópia", () => {
  const r = unidade();
  assert.equal(r.code, 0, `a unidade deveria passar sem mutação:\n${r.out.slice(-3000)}`);
});

// ── 1. A flag ───────────────────────────────────────────────────────────────

test("MUT-FC-01: remover a verificação da flag é DETECTADO", () => {
  mutar(
    FACADE,
    `  // 1–2. A FLAG, ANTES DE TUDO. Nenhum I/O acontece com billing desligado.
  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");`,
    `  // flag removida`,
    /a flag não é consultada|a flag desligada não para com resultado tipado/
  );
});

test("MUT-FC-02: mover a flag para DEPOIS da sessão é DETECTADO", () => {
  mutar(
    FACADE,
    `  // 1–2. A FLAG, ANTES DE TUDO. Nenhum I/O acontece com billing desligado.
  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");

  // 3–6. Sessão, organização, papel e comparação de tenant, no servidor.
  const autorizacao = await deps.autorizar(papelMinimo, tenantAfirmado(bruto));`,
    `  // 3–6. Sessão, organização, papel e comparação de tenant, no servidor.
  const autorizacao = await deps.autorizar(papelMinimo, tenantAfirmado(bruto));
  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");`,
    /a sessão é resolvida ANTES da flag/
  );
});

test("MUT-FC-03: mover a flag para depois do BANCO é DETECTADO na unidade", () => {
  // Estaticamente a ordem contra `montarEnv` continuaria plausível; o que pega
  // é a MEDIÇÃO: `vezesRepositorio()` deixa de ser zero com a flag desligada.
  mutar(
    FACADE,
    `  // 1–2. A FLAG, ANTES DE TUDO. Nenhum I/O acontece com billing desligado.
  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");

  // 3–6.`,
    `  // 3–6.`,
    /vezesRepositorio|billing_disabled/,
    unidade
  );
});

// ── 2. Autorização e tenant ─────────────────────────────────────────────────

test("MUT-FC-04: autorizar membro comum é DETECTADO", () => {
  mutar(
    FACADE,
    `    default:
      return recusaPadrao("not_owner");`,
    `    default:
      return sucessoIndevido();`,
    /reprovou|not_owner|sucessoIndevido/,
    unidade
  );
});

test("MUT-FC-05: confiar no organizationId recebido é DETECTADO", () => {
  mutar(
    FACADE,
    `      organizationId: principal.organizationId,`,
    `      organizationId: (bruto as { organizationId?: string }).organizationId ?? principal.organizationId,`,
    /montarEnv lê a entrada do chamador|a organização não vem do principal/
  );
});

test("MUT-FC-06: não entregar o tenant afirmado à autorização é DETECTADO", () => {
  mutar(
    FACADE,
    `  const autorizacao = await deps.autorizar(papelMinimo, tenantAfirmado(bruto));`,
    `  const autorizacao = await deps.autorizar(papelMinimo);`,
    /o tenant afirmado não é entregue à autorização/
  );
});

test("MUT-FC-07: trocar a comparação de tenant por confiança cega é DETECTADO", () => {
  mutar(
    DEPS,
    `        return organizationIdPedido === undefined
          ? requireBillingOwner()
          : requireBillingOwnerFor(organizationIdPedido);`,
    `        return requireBillingOwner();`,
    /a comparação de tenant não usa requireBillingOwnerFor/
  );
});

// ── 3. Campos que o servidor resolve ────────────────────────────────────────

test("MUT-FC-08: aceitar instante do chamador é DETECTADO", () => {
  mutar(
    ENTRADA,
    `    termsVersion: versaoDeTermos,
    billingEmail: emailFinanceiro.optional(),`,
    `    termsVersion: versaoDeTermos,
    termsAcceptedAt: z.string(),
    billingEmail: emailFinanceiro.optional(),`,
    /declara `termsAcceptedAt`/
  );
});

test("MUT-FC-09: aceitar ator do chamador é DETECTADO", () => {
  mutar(
    ENTRADA,
    `export const AceitarTermosSchema = z
  .object({
    organizationId: organizacaoPedida,`,
    `export const AceitarTermosSchema = z
  .object({
    actorId: z.string(),
    organizationId: organizacaoPedida,`,
    /declara `actorId`/
  );
});

test("MUT-FC-10: aceitar a origem do chamador é DETECTADO", () => {
  mutar(
    ENTRADA,
    `export const CancelarSchema = z
  .object({
    organizationId: organizacaoPedida,`,
    `export const CancelarSchema = z
  .object({
    origin: z.string(),
    organizationId: organizacaoPedida,`,
    /declara `origin`/
  );
});

test("MUT-FC-11: afrouxar um schema para aceitar campo desconhecido é DETECTADO", () => {
  mutar(
    ENTRADA,
    `export const CancelarSchema = z
  .object({
    organizationId: organizacaoPedida,
  })
  .strict();`,
    `export const CancelarSchema = z
  .object({
    organizationId: organizacaoPedida,
  });`,
    /algum aceita campo desconhecido/
  );
});

test("MUT-FC-12: trocar um enum fechado por texto livre é DETECTADO", () => {
  mutar(
    ENTRADA,
    `const plano = z.enum(["essencial", "completo"]);`,
    `const plano = z.string();`,
    /plano não é enum fechado/
  );
});

test("MUT-FC-13: a fachada SUBSTITUIR a versão afirmada é DETECTADO na unidade", () => {
  // ── O DEFEITO QUE ESTA MUTAÇÃO DESCREVE ───────────────────────────────────
  //
  // Persistir a versão RECEBIDA é defeito do caso de uso, e `MUT-CM-03` da
  // 12C.1 já o cobre. O defeito equivalente NESTA camada é o inverso, e é mais
  // sutil: a fachada trocar a afirmação do cliente pela constante ANTES de
  // entregá-la à comparação.
  //
  // O efeito seria silencioso e ruim — uma tela aberta antes da publicação de
  // termos novos passaria a "aceitar" a versão vigente sem que ninguém a
  // tivesse lido, e a comparação viraria decoração. A suíte mede isso: a versão
  // divergente deixaria de ser recusada.
  mutar(
    FACADE,
    `      termsVersion: e.termsVersion,
      billingEmail: e.billingEmail ?? null,`,
    `      termsVersion: TERMS_VERSION,
      billingEmail: e.billingEmail ?? null,`,
    /versão de termos divergente|invalid_input|FAIL/,
    unidade
  );
});

// ── 4. Provider ─────────────────────────────────────────────────────────────

test("MUT-FC-14: resolver o provider ANTES da validação é DETECTADO", () => {
  mutar(
    FACADE,
    `  // 7. Validação, só depois de autorizado.
  const parsed = schema.safeParse(bruto);
  if (!parsed.success) return recusaPadrao("invalid_input");`,
    `  // 7. Validação movida para depois do provider.`,
    /a entrada não é validada|o provider é resolvido ANTES da validação/
  );
});

test("MUT-FC-15: resolver o provider em TODO comando é DETECTADO", () => {
  mutar(
    FACADE,
    `  precisaDeProvider = false`,
    `  precisaDeProvider = true`,
    /o provider não é opcional por padrão/
  );
});

test("MUT-FC-16: cair para o mock quando o provider falha é DETECTADO", () => {
  mutar(
    FACADE,
    `    } catch {
      // Provider não configurado, não implementado ou proibido no ambiente.
      // Nenhum detalhe atravessa: o motivo fica no log do servidor.
      return recusaPadrao("misconfigured");
    }`,
    `    } catch {
      provider = PROVIDER_NAO_USADO;
    }`,
    /um catch não devolve recusa/
  );
});

test("MUT-FC-17: selecionar provider pela presença da chave é DETECTADO", () => {
  mutar(
    DEPS,
    `    provider: () => resolveBillingProvider(),`,
    `    provider: () =>
      process.env.ASAAS_API_KEY ? resolveBillingProvider() : resolveBillingProvider(),`,
    /fiação errada/
  );
});

test("MUT-FC-18: cenário do mock escolhido pela entrada é DETECTADO", () => {
  mutar(
    ENTRADA,
    `export const CriarCheckoutSchema = z
  .object({
    organizationId: organizacaoPedida,`,
    `export const CriarCheckoutSchema = z
  .object({
    scenario: z.string(),
    organizationId: organizacaoPedida,`,
    /declara `scenario`/
  );
});

// ── 5. Fronteira pública ────────────────────────────────────────────────────

test("MUT-FC-19: expor a fachada por `\"use server\"` é DETECTADO", () => {
  criar(
    "src/lib/billing/actions.ts",
    `"use server";

import { iniciarTrial } from "./facade";

export async function comecarTrial(entrada: unknown) {
  return iniciarTrial(entrada);
}
`,
    /a fachada ganhou consumidor antes da 12C\.3/
  );
});

test("MUT-FC-20: expor a fachada por route handler é DETECTADO", () => {
  criar(
    "src/app/api/billing/checkout/route.ts",
    `import { criarCheckout } from "@/lib/billing/facade";

export async function POST(request: Request) {
  return Response.json(await criarCheckout(await request.json()));
}
`,
    /a fachada ganhou consumidor antes da 12C\.3|rota ou página de billing criada/
  );
});

test("MUT-FC-21: importar a fachada numa página é DETECTADO", () => {
  mutar(
    "src/app/(dashboard)/dashboard/billing/page.tsx",
    `import { redirect } from "next/navigation";

export default function BillingPage() {
  redirect("/dashboard");
}`,
    `import { lerAssinatura } from "@/lib/billing/facade";

export default async function BillingPage() {
  const estado = await lerAssinatura({});
  return <pre>{JSON.stringify(estado)}</pre>;
}`,
    /a fachada ganhou consumidor antes da 12C\.3|a página deixou de ser um redirect/
  );
});

test("MUT-FC-22: marcar a própria fachada como server action é DETECTADO", () => {
  mutar(
    FACADE,
    `import "server-only";`,
    `"use server";`,
    /sem `import "server-only"`|virou server action/
  );
});

test("MUT-FC-23: habilitar a flag no arquivo versionado é DETECTADO", () => {
  mutar(
    ".env.example",
    `\nBILLING_PROVIDER=\n`,
    `\nBILLING_PROVIDER=\nBILLING_ENABLED=true\n`,
    /passou a definir BILLING_ENABLED/
  );
});

// ── 6. Idempotência ─────────────────────────────────────────────────────────

test("MUT-FC-24: gerar chave NOVA a cada tentativa é DETECTADO", () => {
  mutar(
    SHARED,
    `  return digest("idem", { op: operacao, org: organizationId, intent: checkoutIntentId });`,
    `  return digest("idem", { op: operacao, org: organizationId, intent: checkoutIntentId, agora: Date.now() });`,
    /a chave depende de tempo ou sorteio|a chave não cobre operação, organização e intenção/
  );
});

test("MUT-FC-24b: voltar a derivar a chave do PERÍODO é DETECTADO", () => {
  // O defeito exato da versão anterior: a chave codifica o ciclo em vez da
  // tentativa, e a organização fica presa a uma cobrança por período.
  mutar(
    SHARED,
    `export function chaveDeIdempotencia(
  operacao: string,
  organizationId: string,
  checkoutIntentId: string
): string {
  return digest("idem", { op: operacao, org: organizationId, intent: checkoutIntentId });
}`,
    `export function chaveDeIdempotencia(
  operacao: string,
  organizationId: string,
  periodStart: string
): string {
  return digest("idem", { op: operacao, org: organizationId, inicio: periodStart });
}`,
    /a chave voltou a depender do período|a chave não cobre operação, organização e intenção/
  );
});

test("MUT-FC-24c: trocar SHA-256 por hash de 32 bits é DETECTADO", () => {
  mutar(
    "src/lib/billing/core/digest.ts",
    `  const hex = createHash("sha256")
    .update(\`\${tipo}|\${GERACAO_DE_DIGEST}|\${canonicalizar(campos)}\`, "utf8")
    .digest("hex");`,
    `  const texto = \`\${tipo}|\${GERACAO_DE_DIGEST}|\${canonicalizar(campos)}\`;
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hex = h.toString(16).padStart(8, "0");`,
    /o digest não é SHA-256|FNV-1a de 32 bits voltou/
  );
});

test("MUT-FC-24d: canonicalização ambígua é DETECTADA", () => {
  // A forma antiga: `k=v` unido por `&`. `{a:"x&b=y"}` colidia com
  // `{a:"x", b:"y"}`, e um nome de pagador com `&` bastava.
  mutar(
    "src/lib/billing/core/digest.ts",
    `      const v = String(campos[k]);
      return \`\${k.length}:\${k}=\${v.length}:\${v}\`;
    })
    .join(";");`,
    `      return \`\${k}=\${String(campos[k])}\`;
    })
    .join("&");`,
    /a canonicalização deixou de ser injetiva/
  );
});

test("MUT-FC-25: aceitar a chave do cliente é DETECTADO", () => {
  mutar(
    ENTRADA,
    `    checkoutIntentId: z.string().trim().regex(FORMATO_DE_INTENCAO, "intenção inválida"),`,
    `    checkoutIntentId: z.string().trim().regex(FORMATO_DE_INTENCAO, "intenção inválida"),
    idempotencyKey: z.string(),`,
    /declara `idempotencyKey`|o schema do checkout aceita idempotencyKey do cliente/
  );
});

test("MUT-FC-25b: tornar a intenção OPCIONAL é DETECTADO", () => {
  // Opcional convida o ramo "se não veio, invente" — e inventar em silêncio
  // faria cada retry técnico virar cobrança nova.
  mutar(
    ENTRADA,
    `    checkoutIntentId: z.string().trim().regex(FORMATO_DE_INTENCAO, "intenção inválida"),`,
    `    checkoutIntentId: z.string().trim().regex(FORMATO_DE_INTENCAO, "intenção inválida").optional(),`,
    /a intenção virou opcional/
  );
});

test("MUT-FC-25c: cunhar intenção DENTRO do checkout é DETECTADO", () => {
  mutar(
    FACADE,
    `        checkoutIntentId: e.checkoutIntentId,`,
    `        checkoutIntentId: deps.novaIntencao(),`,
    /o checkout cunha intenção|o checkout não repassa a intenção recebida|só o preparo deveria/
  );
});

test("MUT-FC-25d: intenção sem entropia suficiente é DETECTADA", () => {
  mutar(
    INTENCAO,
    `const BYTES = 16;`,
    `const BYTES = 4;`,
    /a intenção não tem 128 bits/
  );
});

test("MUT-FC-25e: intenção sorteada por Math.random é DETECTADA", () => {
  mutar(
    INTENCAO,
    `  const bytes = new Uint8Array(BYTES);
  crypto.getRandomValues(bytes);`,
    `  const bytes = new Uint8Array(BYTES);
  for (let i = 0; i < BYTES; i += 1) bytes[i] = Math.floor(Math.random() * 256);`,
    /a intenção não vem do CSPRNG da plataforma|a intenção usa sorteio previsível/
  );
});

test("MUT-FC-26: derivar a chave de campo escolhido pelo CLIENTE é DETECTADO", () => {
  mutar(
    PAYMENTS,
    `  const idempotencyKey = chaveDeIdempotencia(
    "checkout",
    env.auth.organizationId,
    input.checkoutIntentId
  );`,
    `  const idempotencyKey = chaveDeIdempotencia(
    "checkout",
    env.auth.organizationId,
    input.checkoutIntentId + input.customerEmail
  );`,
    /a chave do checkout não é derivada da organização resolvida e da intenção/
  );
});

// ── 7. Erros e privacidade ──────────────────────────────────────────────────

test("MUT-FC-27: propagar a mensagem do domínio é DETECTADO", () => {
  mutar(
    RESULTADO,
    `  return recusa(erro.code, MENSAGENS[erro.code]);`,
    `  return recusa(erro.code, erro.message);`,
    /a mensagem do domínio atravessa a fachada|a tradução propaga a mensagem do domínio/
  );
});

test("MUT-FC-28: distinguir tenant alheio de inexistente é DETECTADO", () => {
  mutar(
    RESULTADO,
    `  not_found: "Somente o proprietário da organização administra a assinatura.",`,
    `  not_found: "Organização não encontrada.",`,
    /organização inexistente é distinguível de alheia/
  );
});

test("MUT-FC-29: transformar erro de repositório em sucesso é DETECTADO", () => {
  mutar(
    RESULTADO,
    `export function traduzir<T>(r: Result<T>): FacadeResult<T> {
  if (r.ok) return sucesso(r.value);`,
    `export function traduzir<T>(r: Result<T>): FacadeResult<T> {
  if (r.ok || r.error.code === "repository_unavailable") {
    return sucesso((r as { value: T }).value);
  }`,
    /repository_unavailable|reprovou/,
    unidade
  );
});

// ── 8. Persistência ─────────────────────────────────────────────────────────

test("MUT-FC-30: acessar tabela de billing direto da fachada é DETECTADO", () => {
  mutar(
    FACADE,
    `/** Origem de tudo o que a fachada faz: pedido do proprietário. */`,
    `export async function atalho(cliente: { from: (t: string) => unknown }) {
  return cliente.from("subscriptions");
}

/** Origem de tudo o que a fachada faz: pedido do proprietário. */`,
    /endereça tabela diretamente/
  );
});

test("MUT-FC-31: acrescentar migration nesta etapa é DETECTADO", () => {
  criar(
    "supabase/migrations/20260901120000_facade_extra.sql",
    "-- migration indevida na 12C.2\nSELECT 1;\n",
    /esperadas 41 migrations/
  );
});

test("MUT-FC-32: expor operação administrativa na fachada é DETECTADO", () => {
  mutar(
    FACADE,
    `export const COMANDOS_DA_FACHADA = Object.freeze({`,
    `export function grantCourtesy() {
  return null;
}

export const COMANDOS_DA_FACHADA = Object.freeze({`,
    /expõe a operação administrativa grantCourtesy|divergiram da superfície declarada/
  );
});

// ── 9. A matriz de papéis ───────────────────────────────────────────────────

test("MUT-FC-33: exigir OWNER na decisão de acesso é DETECTADO", () => {
  // O defeito original: `lerAcesso` de proprietário fecha a porta para o
  // enforcement de entitlements de quem não paga.
  mutar(
    FACADE,
    `  return executarComando<{ organizationId?: string }, AccessDecision>(
    deps,
    "member",`,
    `  return executarComando<{ organizationId?: string }, AccessDecision>(
    deps,
    "owner",`,
    /a matriz de papéis divergiu da acordada|lerAcesso voltou a exigir proprietário|lerAcesso declara "member" na matriz/
  );
});

test("MUT-FC-33b: exigir OWNER no catálogo é DETECTADO", () => {
  mutar(
    FACADE,
    `  return executarComando<{ organizationId?: string }, readonly CatalogPrice[]>(
    deps,
    "member",`,
    `  return executarComando<{ organizationId?: string }, readonly CatalogPrice[]>(
    deps,
    "owner",`,
    /a matriz de papéis divergiu da acordada|lerCatalogo declara "member" na matriz/
  );
});

test("MUT-FC-34: rebaixar uma ESCRITA para membro é DETECTADO", () => {
  mutar(
    FACADE,
    `  >(deps, "owner", EscolherPlanoSchema, bruto, (env, e) =>`,
    `  >(deps, "member", EscolherPlanoSchema, bruto, (env, e) =>`,
    /a matriz de papéis divergiu da acordada|é escrita e aceita membro|escolherPlano declara "owner" na matriz/
  );
});

test("MUT-FC-34b: liberar o DOSSIÊ comercial ao membro é DETECTADO", () => {
  mutar(
    FACADE,
    `  return executarComando<{ organizationId?: string }, BillingState>(
    deps,
    "owner",`,
    `  return executarComando<{ organizationId?: string }, BillingState>(
    deps,
    "member",`,
    /a matriz de papéis divergiu da acordada|lerAssinatura aceita membro|lerAssinatura declara "owner" na matriz/
  );
});

test("MUT-FC-34c: trocar assertTenantOwner por Member no dossiê é DETECTADO", () => {
  mutar(
    QUERIES,
    `  const negado = assertTenantOwner<BillingState>(env.auth, input.requestedOrganizationId);`,
    `  const negado = assertTenantMember<BillingState>(env.auth, input.requestedOrganizationId);`,
    /só a decisão de acesso e o catálogo|o dossiê comercial aceita membro/
  );
});

test("MUT-FC-34d: trocar assertTenantOwner por Member numa ESCRITA é DETECTADO", () => {
  mutar(
    "src/lib/billing/usecases/payments.ts",
    `  const negado = assertTenantOwner<CheckoutResult>(env.auth, input.requestedOrganizationId);`,
    `  const negado = assertTenantMember<CheckoutResult>(env.auth, input.requestedOrganizationId);`,
    /assertTenantMember aparece em/
  );
});

test("MUT-FC-34e: fixar o papel do contexto em `owner` é DETECTADO", () => {
  // Com o papel literal, um membro resolvido pelo servidor chega ao caso de uso
  // disfarçado de proprietário — e `assertTenantOwner` para de proteger.
  mutar(
    FACADE,
    `      role: principal.role,`,
    `      role: "owner",`,
    /o papel é fixado em vez de vir do principal|o papel é um literal/
  );
});

test("MUT-FC-34f: papel desconhecido virar `owner` é DETECTADO", () => {
  mutar(
    AUTZ,
    `    const role = membership.role === "owner" ? ("owner" as const) : ("member" as const);`,
    `    const role = membership.role === "member" ? ("member" as const) : ("owner" as const);`,
    /o papel resolvido não tem padrão de menor privilégio/
  );
});

test("MUT-FC-34g: membro autorizado em escrita é DETECTADO na unidade", () => {
  // Comportamental: a forma continua plausível — o que quebra é a MEDIÇÃO de
  // que o membro é recusado antes do repositório.
  mutar(
    SHARED,
    `export function assertTenantOwner<T>(
  auth: BillingAuthContext,
  requestedOrganizationId: string | undefined
): Result<T> | null {
  if (auth.role !== "owner") return recusarTenant<T>();`,
    `export function assertTenantOwner<T>(
  auth: BillingAuthContext,
  requestedOrganizationId: string | undefined
): Result<T> | null {`,
    /membro é recusado SEM que o repositório seja tocado/,
    unidadeDeBilling
  );
});

// ── 10. Uma leitura, um caso de uso ─────────────────────────────────────────

test("MUT-FC-35: ler o estado NA FACHADA é DETECTADO", () => {
  // A regressão exata: duas leituras independentes e TOCTOU entre derivar a
  // chave e reservá-la.
  mutar(
    FACADE,
    `    (env, e) =>
      createCheckout(env, {`,
    `    async (env, e) => {
      const estado = await env.repo.readState(env.auth.userId, env.auth.organizationId);
      if (!estado.ok) return estado;
      return createCheckout(env, {`,
    /a fachada acessa o repositório diretamente|o checkout voltou a ler o estado na fachada/
  );
});

test("MUT-FC-35b: decidir domínio na fachada é DETECTADO", () => {
  mutar(
    FACADE,
    `import { recusaPadrao, sucesso, traduzir, type FacadeResult } from "./resultado";`,
    `import { fail } from "../core/errors";
import { recusaPadrao, sucesso, traduzir, type FacadeResult } from "./resultado";
const naoEncontrado = () => fail("not_found", "assinatura inexistente");`,
    /a fachada produz recusa de domínio por conta própria|a fachada decide `not_found`/
  );
});

test("MUT-FC-35c: duas leituras de estado no caso de uso é DETECTADO", () => {
  mutar(
    "src/lib/billing/usecases/payments.ts",
    `  const assinatura = await exigirAssinatura(env);
  if (!assinatura.ok) return assinatura;`,
    `  const preliminar = await exigirAssinatura(env);
  if (!preliminar.ok) return preliminar;
  const assinatura = await exigirAssinatura(env);
  if (!assinatura.ok) return assinatura;`,
    /createCheckout lê o estado 2 vezes/
  );
});

test("MUT-FC-35d: a fachada chamar o repositório numa consulta é DETECTADO", () => {
  mutar(
    FACADE,
    `    (env, e) => readCatalogUseCase(env, { requestedOrganizationId: e.organizationId })`,
    `    (env) => env.repo.readCatalog(env.auth.userId, env.auth.organizationId, "2026-07-30.1")`,
    /a fachada acessa o repositório diretamente|chama 0 casos de uso/
  );
});

// ── 11. O contrato contra o PostgREST ───────────────────────────────────────

test("MUT-FC-36: remover o checkout do contrato PostgREST é DETECTADO", () => {
  mutar(
    CONTRATO,
    `    it("aprovado: exatamente UMA cobrança, UM snapshot e auditoria", async () => {`,
    `    it("aprovado: removido nesta mutação", async () => {`,
    /o contrato da fachada não cobre: checkout aprovado/
  );
});

test("MUT-FC-36b: pular um caso do contrato PostgREST é DETECTADO", () => {
  mutar(
    CONTRATO,
    `    it("replay: mesma intenção e mesmo payload devolvem o MESMO resultado", async () => {`,
    `    it.skip("replay: mesma intenção e mesmo payload devolvem o MESMO resultado", async () => {`,
    /há caso pulado ou isolado no contrato da fachada/
  );
});

test("MUT-FC-36c: trocar o repositório real pelo dublê no contrato é DETECTADO", () => {
  mutar(
    CONTRATO,
    `    const repoReal = new SupabaseBillingRepository(cliente);`,
    `    const repoReal = new InMemoryBillingRepository({ clock: { now: () => T0 } } as never);`,
    /o contrato não usa o repositório real|caiu para o repositório em memória/
  );
});

test("MUT-FC-36d: remover a prova de troca de meio após recusa é DETECTADO", () => {
  mutar(
    CONTRATO,
    `    it("PIX recusado não impede nova intenção com CARTÃO", async () => {`,
    `    it("PIX recusado — caso removido", async () => {`,
    /o contrato da fachada não cobre: troca de meio após recusa/
  );
});

test("MUT-FC-36e: remover a prova de que o provider não é retocado é DETECTADO", () => {
  mutar(
    CONTRATO,
    `    it("concluída: o provider NÃO é chamado de novo no replay", async () => {`,
    `    it("concluída: caso removido", async () => {`,
    /o contrato da fachada não cobre: provider retocado no replay/
  );
});

test("MUT-FC-36f: remover a prova de leitura por membro é DETECTADO", () => {
  mutar(
    CONTRATO,
    `    it("MEMBRO comum obtém a decisão de acesso do tenant", async () => {`,
    `    it("MEMBRO — caso removido", async () => {`,
    /o contrato da fachada não cobre: leitura por membro/
  );
});

test("MUT-FC-37: remover o teardown das fixtures do CI é DETECTADO", () => {
  mutar(
    ".github/workflows/ci.yml",
    `        run: bash scripts/ci/teardown-contract-fixtures.sh`,
    `        run: echo "teardown removido nesta mutação"`,
    /o CI deixou de derrubar as fixtures/
  );
});

test("MUT-FC-37b: aceitar a fachada PULADA no CI é DETECTADO", () => {
  mutar(
    ".github/workflows/ci.yml",
    `          if grep -q "PULADO" /tmp/contrato-fachada.log; then
            echo "FALHA: a fachada foi pulada — o caminho real dela não foi exercitado"
            exit 1
          fi`,
    `          echo "fachada: sem conferência de skip"`,
    /o CI aceita a fachada pulada/
  );
});

// ── 12. As três que faltavam: intenção nova, payload e replay ───────────────

test("MUT-FC-38: intenção CONSTANTE — nova tentativa impossível — é DETECTADA", () => {
  // O defeito da versão anterior, reintroduzido por outro caminho: se toda
  // preparação devolver o mesmo identificador, a chave volta a ser única por
  // organização e o proprietário fica sem como recomeçar depois de uma recusa.
  mutar(
    INTENCAO,
    `  const bytes = new Uint8Array(BYTES);
  crypto.getRandomValues(bytes);
  return (
    PREFIXO +
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  );`,
    `  return PREFIXO + "0".repeat(32);`,
    /mil cunhagens, mil valores distintos|o nibble .* não varia/,
    unidade
  );
});

test("MUT-FC-39: fingerprint que ignora o meio de pagamento é DETECTADO", () => {
  // Sem `method` no fingerprint, trocar PIX por cartão SOB A MESMA INTENÇÃO
  // deixaria de conflitar: o segundo pedido sumiria e o cliente receberia a
  // cobrança do primeiro, no meio que ele acabou de recusar.
  mutar(
    PAYMENTS,
    `    amountCents: valor,
    method: input.method,
    periodStart: sub.currentPeriodStart,`,
    `    amountCents: valor,
    periodStart: sub.currentPeriodStart,`,
    /fingerprint conflitante|é conflito|reprovou/,
    unidadeDeBilling
  );
});

test("MUT-FC-40: chamar o provider de novo num replay concluído é DETECTADO", () => {
  // `completed` significa que a cobrança JÁ existe. Seguir adiante criaria a
  // segunda no provider — e o banco, ao finalizar, veria fingerprint igual e
  // não acusaria nada. O defeito só aparece contando as chamadas.
  mutar(
    PAYMENTS,
    `    case "completed": {
      // Replay: devolve a cobrança já criada, sem tocar no provider.
      const idAnterior = claim.value.result.chargeId;`,
    `    case "completed": {
      break;
    }

    case "nunca_acontece": {
      const idAnterior = claim.value.result.chargeId;`,
    /replay|provider|reprovou/,
    unidadeDeBilling
  );
});

test("MUT-FC-41: remover a flag do comando de INTENÇÃO é DETECTADO", () => {
  // `prepararIntencaoDeCheckout` não passa por `executarComando`, então a
  // ordem de segurança dele precisa de guarda própria — sem ela, este comando
  // seria o único ponto da fachada onde a flag poderia sumir em silêncio.
  mutar(
    FACADE,
    `  // 1\u20132. A flag, antes de tudo \u2014 mesma primeira etapa dos demais comandos.
  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");

`,
    "",
    /preparar intenção não consulta a flag/
  );
});

test("MUT-FC-41b: cunhar intenção ANTES de validar é DETECTADO", () => {
  mutar(
    FACADE,
    `  // 7. Valida\u00e7\u00e3o, depois da autoriza\u00e7\u00e3o.
  const parsed = PrepararIntencaoSchema.safeParse(bruto);
  if (!parsed.success) return recusaPadrao("invalid_input");

  return sucesso({ checkoutIntentId: deps.novaIntencao() });`,
    `  const cunhada = deps.novaIntencao();
  const parsed = PrepararIntencaoSchema.safeParse(bruto);
  if (!parsed.success) return recusaPadrao("invalid_input");

  return sucesso({ checkoutIntentId: cunhada });`,
    /preparar intenção cunha antes de validar/
  );
});

// ── Limpeza ─────────────────────────────────────────────────────────────────

try {
  fs.rmSync(path.join(copia, "node_modules"), { force: true });
} catch {
  /* junction já removida ou inexistente */
}
fs.rmSync(copia, { recursive: true, force: true });

console.log(`\nBilling facade mutation guard: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
