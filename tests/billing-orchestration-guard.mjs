/**
 * GUARDA ESTÁTICA DA ORQUESTRAÇÃO — Etapa 12B
 *
 * O que dá para verificar sem banco: determinismo do domínio, ausência de
 * rede, fronteira do `service_role`, alcance da 12B a partir do runtime
 * público, e a integridade da nova migration.
 *
 * O comportamento — idempotência sob concorrência, transação, RLS e
 * imutabilidade — é provado por `scripts/ci/assert-billing-orchestration.sql`
 * contra PostgreSQL de verdade. Esta guarda garante, entre outras coisas, que
 * aquele arquivo continue sendo executado.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseManifest } from "./lib/manifest.mjs";
import { classificarMigrations } from "./lib/migrations.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8").replace(/\r\n?/g, "\n");
const existe = (p) => fs.existsSync(path.join(raiz, p));

const VERSAO = "20260802093000";
const MIGRATION = `supabase/migrations/${VERSAO}_billing_orchestration.sql`;
const ROLLBACK = `supabase/rollbacks/${VERSAO}_billing_orchestration_rollback.sql`;
const VERIFICADOR = `scripts/ci/verify-applied/${VERSAO}.sql`;
const INTEGRACAO = "scripts/ci/assert-billing-orchestration.sql";

/** Domínio puro da 12A + orquestração da 12B: nada aqui pode ser não determinístico. */
const DOMINIO = [
  "src/lib/billing/core/errors.ts",
  "src/lib/billing/core/ports.ts",
  "src/lib/billing/core/repository.ts",
  "src/lib/billing/core/provider.ts",
  "src/lib/billing/usecases/shared.ts",
  "src/lib/billing/usecases/subscription.ts",
  "src/lib/billing/usecases/payments.ts",
  "src/lib/billing/usecases/access.ts",
  "src/lib/billing/providers/mock/deterministic.ts",
  "src/lib/billing/repositories/in-memory.ts",
];

/** Todos os arquivos da 12B, incluindo o repositório de servidor. */
const TODOS_12B = [...DOMINIO, "src/lib/billing/repositories/supabase.ts"];

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

/** Remove comentários antes de medir — guarda que mede prosa aprova o errado. */
function tsExecutavel(rel) {
  return ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

function sqlExecutavel(rel) {
  return ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

// ── Determinismo ───────────────────────────────────────────────────────────

test("BO-01: o domínio não lê relógio, aleatório nem ambiente", () => {
  // Um `Date.now()` escondido numa transição torna impossível fixar a borda
  // exata do vencimento; um `Math.random()` torna a idempotência
  // indemonstrável. Tudo entra por injeção.
  for (const arquivo of DOMINIO) {
    const src = tsExecutavel(arquivo);
    assert.doesNotMatch(src, /Date\.now\s*\(/, `${arquivo} lê o relógio`);
    assert.doesNotMatch(src, /new Date\(\s*\)/, `${arquivo} lê o relógio`);
    assert.doesNotMatch(src, /Math\.random/, `${arquivo} não é determinístico`);
    assert.doesNotMatch(src, /randomUUID|crypto\./, `${arquivo} gera identificador próprio`);
  }
});

test("BO-02: os casos de uso não leem process.env", () => {
  // Configuração é decisão de quem monta o ambiente, não do caso de uso. Ler
  // `process.env` no domínio faria o comportamento depender de onde ele roda.
  for (const arquivo of [
    "src/lib/billing/usecases/shared.ts",
    "src/lib/billing/usecases/subscription.ts",
    "src/lib/billing/usecases/payments.ts",
    "src/lib/billing/usecases/access.ts",
  ]) {
    assert.doesNotMatch(tsExecutavel(arquivo), /process\.env/, `${arquivo} lê o ambiente`);
  }
});

test("BO-03: nenhum arquivo da 12B abre rede", () => {
  for (const arquivo of TODOS_12B) {
    const src = tsExecutavel(arquivo);
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${arquivo} usa fetch`);
    assert.doesNotMatch(src, /\baxios\b/, `${arquivo} usa axios`);
    assert.doesNotMatch(src, /from\s+["']node:(http|https|net|dns|tls)["']/, `${arquivo} importa rede`);
    assert.doesNotMatch(src, /XMLHttpRequest|WebSocket/, `${arquivo} usa transporte de rede`);
    assert.doesNotMatch(src, /asaas/i, `${arquivo} referencia o Asaas`);
  }

  // E a armadilha tem de estar instalada na suíte.
  assert.ok(existe("tests/setup/no-network.ts"), "a armadilha de rede não existe");
  const vitest = ler("vitest.config.mts");
  assert.match(
    vitest,
    /setupFiles: \["\.\/tests\/setup\/no-network\.ts"\]/,
    "a armadilha de rede não é carregada pelo projeto unit"
  );
});

test("BO-04: dinheiro continua em centavo inteiro", () => {
  for (const arquivo of TODOS_12B) {
    const semTexto = tsExecutavel(arquivo)
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    const decimais = semTexto.match(/\b\d+\.\d+\b/g) ?? [];
    assert.deepEqual(decimais, [], `${arquivo} tem literal decimal: ${decimais.join(", ")}`);
    assert.doesNotMatch(semTexto, /toFixed|parseFloat/, `${arquivo} usa ponto flutuante`);
  }
});

// ── Fail-closed e autorização ──────────────────────────────────────────────

test("BO-05: nenhum erro vira autorização", () => {
  // O conjunto de códigos é fechado, e nenhum deles significa "deu errado,
  // mas pode seguir".
  const errors = tsExecutavel("src/lib/billing/core/errors.ts");
  for (const code of [
    "repository_unavailable",
    "provider_unavailable",
    "provider_timeout",
    "duplicate_event",
    "out_of_order_event",
    "misconfigured",
    "tenant_mismatch",
  ]) {
    assert.ok(errors.includes(`"${code}"`), `falta o código ${code}`);
  }

  // `fromThrown` só aceita códigos de INDISPONIBILIDADE — o tipo impede que
  // uma exceção desconhecida vire sucesso.
  assert.match(
    errors,
    /code: Extract<\s*BillingErrorCode,\s*"repository_unavailable" \| "provider_unavailable" \| "provider_timeout"\s*>/,
    "fromThrown deixou de ser restrito a falhas"
  );

  // E nenhum `catch` do módulo devolve algo positivo.
  for (const arquivo of TODOS_12B) {
    const blocos = [...tsExecutavel(arquivo).matchAll(/catch[^{]*\{([\s\S]{0,300}?)\n  \}/g)];
    for (const [, corpo] of blocos) {
      assert.doesNotMatch(
        corpo,
        /return ok\(|allowed:\s*true/,
        `${arquivo}: um catch produz resultado positivo`
      );
    }
  }
});

test("BO-06: todo comando confere o tenant informado pelo cliente", () => {
  const shared = tsExecutavel("src/lib/billing/usecases/shared.ts");
  assert.match(
    shared,
    /requestedOrganizationId !== auth\.organizationId/,
    "assertTenant deixou de comparar a organização"
  );
  assert.match(shared, /auth\.role !== "owner"/, "assertTenant deixou de exigir owner");
  // Recusa indistinguível: `not_owner` para alheia E para inexistente.
  assert.doesNotMatch(
    shared,
    /return fail\("not_found"/,
    "a recusa por tenant virou 'not_found' — vira oráculo de enumeração"
  );

  // Cada caso de uso exportado precisa passar por assertTenant. `assertTenant`
  // esquecido num deles é o buraco por onde o IDOR entra.
  for (const arquivo of [
    "src/lib/billing/usecases/subscription.ts",
    "src/lib/billing/usecases/payments.ts",
    "src/lib/billing/usecases/access.ts",
  ]) {
    const src = tsExecutavel(arquivo);
    const exportados = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    assert.ok(exportados.length > 0, `${arquivo} não exporta caso de uso`);
    for (const nome of exportados) {
      const i = src.indexOf(`export async function ${nome}`);
      const corpo = src.slice(i, i + 900);
      const passaPorGuarda =
        /assertTenant/.test(corpo) || /aceitarEvento|exigirAssinatura/.test(corpo);
      assert.ok(passaPorGuarda, `${arquivo}: ${nome} não confere o tenant`);
    }
  }
});

test("BO-07: o ator da auditoria vem do contexto, nunca do argumento", () => {
  const shared = tsExecutavel("src/lib/billing/usecases/shared.ts");
  assert.match(shared, /actorId:\s*env\.origin === "owner"/, "o ator deixou de vir do contexto");
  assert.doesNotMatch(
    shared,
    /actorId:\s*input\./,
    "o ator passou a vir do argumento — daria para atribuir a ação a outra pessoa"
  );
  // Falha de auditoria FALHA a operação — e a asserção precisa estar amarrada
  // à função `auditar`, não a qualquer `if (!r.ok)` do arquivo. A primeira
  // versão media o `reservar`, que tem o mesmo trecho, e aprovava um `auditar`
  // sem propagação (encontrado por MUT-B24).
  const iAuditar = shared.indexOf("export async function auditar");
  assert.ok(iAuditar > 0, "a função auditar sumiu");
  const corpoAuditar = shared.slice(iAuditar, shared.indexOf("export ", iAuditar + 10));
  assert.match(
    corpoAuditar,
    /const r = await env\.repo\.appendAuditEvent\([\s\S]*?if \(!r\.ok\) return r;/,
    "auditar deixou de propagar a falha — a escrita seguiria sem trilha"
  );
});

// ── Mock e repositório: proibidos em produção ──────────────────────────────

test("BO-08: mock e repositório em memória abortam em produção, na CONSTRUÇÃO", () => {
  for (const [arquivo, erro] of [
    ["src/lib/billing/providers/mock/deterministic.ts", "MockProviderForbiddenInProductionError"],
    ["src/lib/billing/repositories/in-memory.ts", "InMemoryRepositoryForbiddenInProductionError"],
  ]) {
    const src = tsExecutavel(arquivo);
    assert.match(src, /constructor\(/, `${arquivo} sem construtor`);
    assert.match(
      src,
      /env\.NODE_ENV === "production"[\s\S]{0,120}throw new/,
      `${arquivo} não aborta com NODE_ENV=production`
    );
    assert.match(
      src,
      /env\.VERCEL_ENV === "production"[\s\S]{0,120}throw new/,
      `${arquivo} não aborta com VERCEL_ENV=production`
    );
    assert.ok(src.includes(erro), `${arquivo} sem erro nomeado`);
    // Nada de degradar: a recusa é exceção, não retorno.
    assert.doesNotMatch(
      src,
      /console\.warn[\s\S]{0,80}production/,
      `${arquivo} avisa em vez de abortar`
    );
  }
});

test("BO-09: ausência de configuração NÃO cai no mock", () => {
  // O registry antigo já é fail-closed; a 12B não pode ter aberto uma segunda
  // porta. Nenhum arquivo da 12B instancia o mock por decisão própria.
  for (const arquivo of TODOS_12B) {
    const src = tsExecutavel(arquivo);
    assert.doesNotMatch(
      src,
      /new BillingProviderMock/,
      `${arquivo} instancia o mock — a escolha do provider é de quem monta o ambiente`
    );
  }
  // A asserção é sobre `resolveBillingProvider`, e não sobre o arquivo: havia
  // um segundo `throw` em `getMockBillingProvider` que fazia a versão anterior
  // aprovar um registry com fallback (encontrado por MUT-B03).
  const registry = tsExecutavel("src/lib/billing/registry.ts");
  const iResolve = registry.indexOf("export function resolveBillingProvider");
  assert.ok(iResolve > 0, "resolveBillingProvider sumiu");
  const corpoResolve = registry.slice(iResolve, registry.indexOf("\n}", iResolve));
  assert.match(
    corpoResolve,
    /throw new BillingNotConfiguredError\(\)/,
    "resolveBillingProvider deixou de abortar sem configuração"
  );
  assert.doesNotMatch(
    corpoResolve,
    /return getMockBillingProvider\(\);\s*$/,
    "resolveBillingProvider passou a cair no mock como último recurso"
  );
});

// ── Fronteira do servidor ──────────────────────────────────────────────────

test("BO-10: o repositório real é server-only e não guarda credencial", () => {
  const src = ler("src/lib/billing/repositories/supabase.ts");
  assert.match(src, /^import "server-only";$/m, "o repositório não é server-only");
  assert.match(src, /createServiceClient/, "o repositório não usa o cliente administrativo");

  const executavel = tsExecutavel("src/lib/billing/repositories/supabase.ts");
  // Nenhuma chave, URL ou token literal.
  assert.doesNotMatch(executavel, /SUPABASE_SERVICE_ROLE_KEY/, "chave lida diretamente");
  assert.doesNotMatch(executavel, /eyJ[A-Za-z0-9_-]{10,}/, "token embutido");
  assert.doesNotMatch(executavel, /postgres(ql)?:\/\//, "connection string embutida");
  // E nenhum log.
  assert.doesNotMatch(executavel, /console\.(log|warn|error|info)/, "o repositório registra log");
  // A mensagem do driver não é propagada — só o código.
  assert.match(
    executavel,
    /code: erro\.code \?\? null/,
    "o erro do driver deixou de ser reduzido ao código"
  );
  assert.doesNotMatch(
    executavel,
    /erro\.message/,
    "a mensagem do driver é propagada — pode carregar host e usuário"
  );
});

test("BO-11: toda consulta do repositório real filtra a organização", () => {
  const src = tsExecutavel("src/lib/billing/repositories/supabase.ts");
  // Toda leitura/escrita de tabela com escopo de tenant tem de trazer o filtro.
  const metodos = [...src.matchAll(/async (\w+)\([\s\S]{0,1800}?\n  \}/g)];
  const semFiltro = [];
  for (const [corpo, nome] of metodos) {
    if (["listCatalogPrices", "findGrandfatheringCutoff", "constructor"].includes(nome)) continue;
    if (!/#from\(/.test(corpo)) continue;
    if (!/organization_id|#idDaAssinatura|#ultimoSnapshot|#marcarCobranca/.test(corpo)) {
      semFiltro.push(nome);
    }
  }
  assert.deepEqual(semFiltro, [], `métodos sem filtro de organização: ${semFiltro.join(", ")}`);
});

test("BO-12: a 12B não é alcançável pelo runtime público", () => {
  const alcance = [];
  const varrer = (dir) => {
    for (const entrada of fs.readdirSync(path.join(raiz, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entrada.name);
      if (entrada.isDirectory()) varrer(rel);
      else if (/\.(ts|tsx)$/.test(entrada.name) && !rel.includes(`lib${path.sep}billing`)) {
        const src = ler(rel);
        if (
          /from\s+["']@\/lib\/billing\/(core|usecases|repositories|providers\/mock)/.test(src)
        ) {
          alcance.push(rel);
        }
      }
    }
  };
  varrer("src");
  assert.deepEqual(
    alcance,
    [],
    `a 12B é importada pelo runtime público, e a etapa não autoriza isso:\n  ${alcance.join("\n  ")}`
  );

  // E a jornada continua desligada.
  assert.ok(
    ler("src/app/(dashboard)/dashboard/billing/page.tsx").includes('redirect("/dashboard")')
  );
  assert.ok(!ler("src/components/dashboard/sidebar-nav.tsx").includes("/dashboard/billing"));
  assert.doesNotMatch(ler("src/app/page.tsx"), /R\$|\bpre[çc]o/i);
  assert.match(tsExecutavel("src/lib/billing/flag.ts"), /=== BILLING_FLAG_ON/);
  assert.doesNotMatch(ler(".env.example"), /BILLING_ENABLED/, "a flag virou variável de ambiente");
});

// ── Migration ──────────────────────────────────────────────────────────────

test("BO-13: a migration da 12B é forward-only e posterior à 12A", () => {
  assert.ok(existe(MIGRATION), `${MIGRATION} ausente`);
  const versoes = parseManifest(ler("supabase/baseline/applied-migrations.tsv")).map((r) => r.version);
  const c = classificarMigrations(path.join(raiz, "supabase/migrations"), versoes);

  assert.deepEqual(c.problemas, [], `classificação com problemas: ${c.problemas.join("; ")}`);
  assert.ok(!versoes.includes(VERSAO), "a 12B não pode constar do manifesto histórico");
  assert.ok(VERSAO > "20260801120000", "a 12B precisa ser posterior à 12A");
  assert.ok(
    c.forwardOnly.some((f) => f.version === VERSAO),
    "a 12B não foi classificada como forward-only"
  );
});

test("BO-14: a migration é aditiva e não toca a 12A nem public", () => {
  const sql = sqlExecutavel(MIGRATION);

  assert.doesNotMatch(sql, /DROP TABLE|DROP TYPE|DROP SCHEMA/i, "a migration remove objeto");
  assert.doesNotMatch(sql, /DROP COLUMN/i, "a migration remove coluna");
  assert.doesNotMatch(
    sql,
    /\b(CREATE|ALTER|DROP)\s+(TABLE|TYPE|FUNCTION|VIEW|INDEX|TRIGGER|POLICY)\s+(IF\s+(NOT\s+)?EXISTS\s+)?public\./i,
    "a migration faz DDL em public"
  );
  assert.doesNotMatch(sql, /UPDATE\s+public\./i, "a migration faz DML em public");
  assert.doesNotMatch(sql, /CREATE\s+POLICY/i, "a fundação exige zero policies");
  assert.doesNotMatch(sql, /ALTER\s+DEFAULT\s+PRIVILEGES/i, "exige superusuário");

  // As quatro tabelas novas, com RLS.
  for (const t of ["customers", "charges", "idempotency_records", "courtesy_revocations"]) {
    assert.match(
      sql,
      new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+billing\\.${t}\\b`, "i"),
      `billing.${t} não é criada`
    );
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);

  // Nada para o cliente; DELETE para ninguém.
  for (const papel of ["PUBLIC", "anon", "authenticated"]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`\\bGRANT\\s+[^;]*\\sTO\\s+[^;]*\\b${papel}\\b`, "i"),
      `concede privilégio a ${papel}`
    );
  }
  assert.doesNotMatch(sql, /\bGRANT\b[^;]*\bDELETE\b/i, "concede DELETE");

  // `\b` do PostgreSQL é backspace.
  for (const arquivo of [MIGRATION, ROLLBACK, VERIFICADOR, INTEGRACAO]) {
    const problemas = sqlExecutavel(arquivo)
      .split("\n")
      .map((l, i) => (/\\[bB]/.test(l) ? `${arquivo}:${i + 1}` : null))
      .filter(Boolean);
    assert.deepEqual(problemas, [], `use \\y: ${problemas.join(", ")}`);
  }
});

test("BO-15: as unicidades que sustentam a idempotência existem", () => {
  const sql = sqlExecutavel(MIGRATION);
  assert.match(
    sql,
    /CONSTRAINT idempotency_chave_unica UNIQUE \(organization_id, scope, provider, key\)/,
    "a chave de idempotência precisa incluir tenant E provider"
  );
  assert.match(
    sql,
    /CONSTRAINT charges_externo_unico UNIQUE \(organization_id, provider, external_charge_id\)/
  );
  assert.match(
    sql,
    /CONSTRAINT charges_comando_unico UNIQUE \(organization_id, idempotency_key\)/,
    "sem esta unicidade o checkout repetido criaria segunda cobrança"
  );
  // E o verificador independente confere as colunas exatas.
  assert.match(ler(VERIFICADOR), /organization_id,scope,provider,key/);
});

test("BO-16: rollback, verificador e rota acompanham a migration", () => {
  assert.ok(existe(ROLLBACK), `${ROLLBACK} ausente`);
  assert.ok(existe(VERIFICADOR), `${VERIFICADOR} ausente`);

  const rb = sqlExecutavel(ROLLBACK);
  assert.match(rb, /DROP TABLE IF EXISTS billing\.charges CASCADE/i);
  assert.match(rb, /DROP COLUMN IF EXISTS correlation_id/i);
  // O limite do enum tem de estar escrito no arquivo.
  assert.match(
    ler(ROLLBACK),
    /não tem `ALTER TYPE \.\.\. DROP VALUE`|DROP VALUE/,
    "o rollback precisa declarar que os rótulos de enum permanecem"
  );

  const bruto = ler(VERIFICADOR);
  assert.match(bruto, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(bruto, /^ROLLBACK;$/m);

  const wf = ler(".github/workflows/migration-apply.yml");
  assert.ok(
    wf.includes(`- ${VERSAO}_billing_orchestration.sql`),
    "a rota não reconhece a nova forward-only"
  );

  // Ordem: a 12A continua sendo a mais antiga pendente.
  const iA = wf.indexOf("20260801120000_billing_foundation.sql");
  const iB = wf.indexOf(`${VERSAO}_billing_orchestration.sql`);
  assert.ok(iA > 0 && iB > iA, "a 12B tem de aparecer depois da 12A na lista");
});

test("BO-17: o CI executa a integração e o ensaio das DUAS migrations", () => {
  assert.ok(existe(INTEGRACAO), `${INTEGRACAO} ausente`);

  const ci = ler(".github/workflows/ci.yml");
  const verify = ci.slice(ci.indexOf("  verify:"), ci.indexOf("  e2e:"));

  assert.ok(
    verify.includes("- name: Integração da orquestração de billing (12B)"),
    "o Verify perdeu o passo de integração da 12B"
  );
  assert.ok(verify.includes("assert-billing-orchestration.sql"));
  assert.ok(verify.includes(`verify-applied/${VERSAO}.sql`), "o verificador da 12B não roda");
  assert.ok(
    verify.includes(`supabase/rollbacks/${VERSAO}_billing_orchestration_rollback.sql`),
    "o ensaio de rollback não cobre a 12B"
  );
  assert.ok(
    verify.includes(`supabase/migrations/${VERSAO}_billing_orchestration.sql`),
    "a reaplicação não cobre a 12B"
  );

  // A integração precisa continuar sendo COMPORTAMENTO, não só catálogo.
  const sql = ler(INTEGRACAO);
  assert.match(sql, /unique_violation/, "falta a prova de unicidade");
  assert.match(sql, /restrict_violation/, "falta a prova de imutabilidade");
  assert.match(sql, /cobrança órfã sobreviveu/, "falta a prova de transação");
  assert.match(sql, /isolamento A×B|apareceu para B/, "falta a prova de isolamento entre tenants");
  assert.match(sql, /^ROLLBACK;$/m, "o bloco comportamental precisa terminar em ROLLBACK");
});

test("BO-18: a allowlist de UPDATE é exatamente {subscriptions, charges}", () => {
  // `charges` entrou na 12B. Uma terceira tabela exige alterar este teste, e
  // isso aparece no diff do PR.
  const seg = ler("scripts/ci/assert-billing-security.sql");
  assert.match(
    seg,
    /c\.relname NOT IN \('subscriptions', 'charges'\)/,
    "a allowlist de UPDATE mudou sem revisão"
  );
  const ver = ler(VERIFICADOR);
  assert.match(ver, /c\.relname NOT IN \('subscriptions', 'charges'\)/);
});

test("BO-19: a guarda e as mutações rodam no verify", () => {
  const pkg = JSON.parse(ler("package.json"));
  const script = pkg.scripts["test:reconciliation"];
  assert.ok(script.includes("tests/billing-orchestration-guard.mjs"), "esta guarda não roda");
  assert.ok(
    script.includes("tests/billing-orchestration-mutation-guard.mjs"),
    "a guarda de mutação da 12B não roda"
  );
});

test("BO-20: nada de dado sensível é gravado", () => {
  for (const arquivo of TODOS_12B) {
    const src = tsExecutavel(arquivo);
    for (const proibido of [/\bcvv\b/i, /card_?number/i, /\bpan\b/, /secret_?key/i]) {
      assert.doesNotMatch(src, proibido, `${arquivo} manipula dado sensível de cartão`);
    }
  }
  // O provider mock só devolve PIX copia-e-cola, nunca dado de cartão.
  const provider = tsExecutavel("src/lib/billing/core/provider.ts");
  assert.match(provider, /pixPayload/, "o contrato perdeu o payload de PIX");
  assert.doesNotMatch(provider, /cardNumber|cvv/i, "o contrato aceita dado de cartão");
});

test("BO-22: cortesia exige prazo, motivo e autor do contexto", () => {
  // Cortesia sem prazo é plano gratuito disfarçado; sem autor, é concessão que
  // ninguém assinou. As três validações ficam no caso de uso E no banco.
  const src = tsExecutavel("src/lib/billing/usecases/access.ts");
  assert.match(
    src,
    /if \(!Number\.isInteger\(input\.days\) \|\| input\.days <= 0\)/,
    "grantCourtesy deixou de exigir prazo positivo inteiro"
  );
  assert.match(src, /input\.reason\.trim\(\) === ""/, "grantCourtesy deixou de exigir motivo");
  assert.match(
    src,
    /grantedBy: env\.auth\.userId/,
    "o autor da cortesia deixou de vir do contexto"
  );
  // Revogar também exige motivo.
  const iRevoke = src.indexOf("export async function revokeCourtesy");
  assert.ok(iRevoke > 0, "revokeCourtesy sumiu");
  assert.match(
    src.slice(iRevoke),
    /input\.reason\.trim\(\) === ""/,
    "revokeCourtesy deixou de exigir motivo"
  );
});

test("BO-21: grandfathering e cortesia são sempre resolvidos por ORGANIZAÇÃO", () => {
  // Se o benefício seguisse o usuário, qualquer beneficiado criaria
  // organizações novas indefinidamente e a data de corte não valeria nada.
  // A guarda mede a CHAMADA, não a intenção (encontrado por MUT-B21).
  const src = tsExecutavel("src/lib/billing/usecases/access.ts");

  for (const [re, motivo] of [
    [/findGrandfathering\(env\.auth\.organizationId\)/, "leitura do direito adquirido"],
    [/saveGrandfathering\(\{\s*organizationId: env\.auth\.organizationId/, "gravação do direito adquirido"],
    [/listCourtesies\(env\.auth\.organizationId\)/, "leitura de cortesias"],
  ]) {
    assert.match(src, re, `${motivo} deixou de usar a organização do contexto`);
  }

  // E nenhuma delas pode receber o usuário NO LUGAR da organização.
  //
  // A asserção é específica de propósito: `revokedBy: env.auth.userId` e
  // `grantedBy: env.auth.userId` são CORRETOS — registram o autor. O que não
  // pode acontecer é o usuário ocupar a posição da organização.
  assert.doesNotMatch(
    src,
    /(findGrandfathering|saveGrandfathering|listCourtesies)\(\s*env\.auth\.userId/,
    "o benefício passou a ser buscado por usuário — o corte deixaria de valer"
  );
  assert.doesNotMatch(
    src,
    /organizationId:\s*env\.auth\.userId/,
    "o usuário está sendo gravado como organização"
  );
});

console.log("");
console.log(`Billing orchestration guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
