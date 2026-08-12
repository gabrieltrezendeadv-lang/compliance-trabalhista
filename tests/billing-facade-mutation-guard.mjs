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
const ENTRADA = "src/lib/billing/facade/entrada.ts";
const DEPS = "src/lib/billing/facade/dependencias.ts";
const IDEM = "src/lib/billing/facade/idempotencia.ts";
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
    `  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");`,
    `  // flag removida`,
    /a flag não é consultada|a flag desligada não para com resultado tipado/
  );
});

test("MUT-FC-02: mover a flag para DEPOIS da sessão é DETECTADO", () => {
  mutar(
    FACADE,
    `  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");

  // 3–6. Sessão, organização, papel e comparação de tenant, no servidor.
  const autorizacao = await deps.autorizar(tenantAfirmado(bruto));`,
    `  // 3–6. Sessão, organização, papel e comparação de tenant, no servidor.
  const autorizacao = await deps.autorizar(tenantAfirmado(bruto));
  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");`,
    /a sessão é resolvida ANTES da flag/
  );
});

test("MUT-FC-03: mover a flag para depois do BANCO é DETECTADO na unidade", () => {
  // Estaticamente a ordem contra `montarEnv` continuaria plausível; o que pega
  // é a MEDIÇÃO: `vezesRepositorio()` deixa de ser zero com a flag desligada.
  mutar(
    FACADE,
    `  if (!deps.flagLigada()) return recusaPadrao("billing_disabled");

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
    `  const autorizacao = await deps.autorizar(tenantAfirmado(bruto));`,
    `  const autorizacao = await deps.autorizar();`,
    /o tenant afirmado não é entregue à autorização/
  );
});

test("MUT-FC-07: trocar a comparação de tenant por confiança cega é DETECTADO", () => {
  mutar(
    DEPS,
    `        ? requireBillingOwner()
        : requireBillingOwnerFor(organizationIdPedido),`,
    `        ? requireBillingOwner()
        : requireBillingOwner(),`,
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
    IDEM,
    `  const fp = fingerprintDe({
    op: operacao,
    org: organizationId,
    inicio: periodStart,
    fim: periodEnd,
  });`,
    `  const fp = fingerprintDe({
    op: operacao,
    org: organizationId,
    inicio: periodStart,
    fim: periodEnd,
    agora: Date.now(),
  });`,
    /a chave depende de tempo ou sorteio/
  );
});

test("MUT-FC-25: aceitar a chave do cliente é DETECTADO", () => {
  mutar(
    ENTRADA,
    `export const CriarCheckoutSchema = z
  .object({
    organizationId: organizacaoPedida,
    method: meio,`,
    `export const CriarCheckoutSchema = z
  .object({
    organizationId: organizacaoPedida,
    idempotencyKey: z.string(),
    method: meio,`,
    /declara `idempotencyKey`|o schema do checkout aceita chave do cliente/
  );
});

test("MUT-FC-26: derivar a chave do tenant AFIRMADO é DETECTADO", () => {
  mutar(
    FACADE,
    `        idempotencyKey: derivarChave(
          "checkout",
          env.auth.organizationId,`,
    `        idempotencyKey: derivarChave(
          "checkout",
          e.organizationId ?? env.auth.organizationId,`,
    /não usa a chave derivada da organização resolvida/
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
    /acessa tabela diretamente/
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
    `export const COMANDOS_DA_FACHADA = Object.freeze([`,
    `export function grantCourtesy() {
  return null;
}

export const COMANDOS_DA_FACHADA = Object.freeze([`,
    /expõe a operação administrativa grantCourtesy|divergiram da superfície declarada/
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
