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
import {
  NOMES_DE_RPC,
  RPCS_DE_BILLING,
} from "../scripts/ci/billing-rpc-allowlist.mjs";

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

  // Recusa indistinguível: `not_owner` para alheia E para inexistente. A
  // asserção é amarrada ao CORPO de `assertTenant` — medir o arquivo inteiro
  // reprovaria o `not_found` legítimo de `exigirAssinatura`, que significa
  // "esta organização não tem assinatura" e só é alcançável por quem já foi
  // autorizado nela.
  const iAssert = shared.indexOf("export function assertTenant");
  assert.ok(iAssert > 0, "assertTenant sumiu");
  const corpoAssert = shared.slice(iAssert, shared.indexOf("export ", iAssert + 10));
  assert.doesNotMatch(
    corpoAssert,
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
      // EXCEÇÃO NOMINAL, e única: `applyProviderEvent` não confere tenant
      // porque NÃO TEM tenant a conferir. O webhook não traz sessão, e a
      // organização é resolvida pelo banco a partir do identificador externo,
      // que é único globalmente. Um `assertTenant` aqui exigiria que alguém
      // informasse a organização — e é exatamente isso que o desenho recusa.
      //
      // A exceção é por NOME. Qualquer outro caso de uso sem guarda reprova.
      if (nome === "applyProviderEvent") {
        const corpoEvento = src.slice(src.indexOf(`export async function ${nome}`));
        assert.doesNotMatch(
          corpoEvento.slice(0, 900),
          /organizationId:\s*input\./,
          "applyProviderEvent passou a aceitar organização vinda de fora"
        );
        continue;
      }

      const i = src.indexOf(`export async function ${nome}`);
      const corpo = src.slice(i, i + 900);
      const passaPorGuarda =
        /assertTenant/.test(corpo) || /aceitarEvento|exigirAssinatura/.test(corpo);
      assert.ok(passaPorGuarda, `${arquivo}: ${nome} não confere o tenant`);
    }
  }
});

test("BO-07: a auditoria é escrita na mesma transação do efeito", () => {
  // ── O QUE MUDOU, E POR QUÊ ────────────────────────────────────────────────
  //
  // Antes existia `auditar()` em shared.ts: os casos de uso gravavam a trilha
  // numa chamada SEPARADA, depois do efeito. Eram duas requisições HTTP, logo
  // duas transações — "cobrança criada, auditoria falhou" era alcançável.
  //
  // Agora a trilha é escrita DENTRO da RPC do efeito. Esta guarda deixou de
  // procurar a função e passou a exigir que ela NÃO exista: um `appendAuditEvent`
  // no contrato seria a peça com a qual se remonta a escrita em duas etapas.
  const contrato = tsExecutavel("src/lib/billing/core/repository.ts");
  assert.doesNotMatch(
    contrato,
    /appendAuditEvent|listAuditEvents\s*\(/,
    "o contrato reintroduziu escrita de auditoria separada do efeito"
  );

  const shared = tsExecutavel("src/lib/billing/usecases/shared.ts");
  assert.doesNotMatch(
    shared,
    /export async function auditar/,
    "auditar voltou — a trilha precisa ir junto com o efeito, na mesma transação"
  );

  // O ator vem do CONTEXTO, nunca do argumento — no dublê e na RPC.
  const memoria = tsExecutavel("src/lib/billing/repositories/in-memory.ts");
  assert.match(
    memoria,
    /actorId:\s*origin === "owner" \|\| origin === "admin" \? actorId : null/,
    "o dublê deixou de derivar o ator da origem"
  );
  assert.doesNotMatch(
    memoria,
    /actorId:\s*input\.actorId\s*,?\s*\/\/\s*do argumento/,
    "o ator passou a vir do argumento"
  );

  const migration = sqlExecutavel(MIGRATION);
  assert.match(
    migration,
    /CASE WHEN p_origin IN \('owner', 'admin'\) THEN p_actor_id ELSE NULL END/,
    "a RPC de auditoria deixou de anular o ator em origem não humana"
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
  // A mensagem do driver não é propagada — só o código. Mensagens de
  // PostgREST e do driver carregam host, usuário e às vezes a URL de conexão
  // inteira; o `code` não identifica ninguém.
  assert.match(
    executavel,
    /const code = erro\.code \?\? null;/,
    "o erro do PostgREST deixou de ser reduzido ao código"
  );
  assert.doesNotMatch(
    executavel,
    /erro\.message/,
    "a mensagem do driver é propagada — pode carregar host e usuário"
  );

  // PGRST106 (schema não exposto) e PGRST202 (função inexistente) precisam
  // cair no ramo de indisponibilidade. Foram exatamente esses dois códigos que
  // a versão anterior teria recebido em toda chamada, sem que nada acusasse.
  assert.match(
    executavel,
    /return fail\("repository_unavailable"/,
    "erro desconhecido do PostgREST não nega"
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

test("BO-24: a state machine do checkout propaga falha e não chama o provider à toa", () => {
  const src = tsExecutavel("src/lib/billing/usecases/payments.ts");

  // ── AMBIGUIDADE DO PROVIDER ───────────────────────────────────────────────
  //
  // "Indisponível" e "não respondeu" NÃO dizem se o recurso externo foi criado.
  // Marcar `failed` neles afirmaria "nada aconteceu", e a retomada imediata
  // criaria a SEGUNDA cobrança. Estes dois códigos precisam continuar fora do
  // caminho que marca falha.
  assert.match(
    src,
    /const AMBIGUOS[^=]*=\s*new Set\(\["provider_unavailable", "provider_timeout"\]\)/,
    "a lista de erros ambíguos do provider mudou sem revisão"
  );
  assert.match(
    src,
    /if \(AMBIGUOS\.has\(code\)\) return;/,
    "erro ambíguo do provider voltou a marcar a reserva como falha"
  );

  // Falha do `finalize` PROPAGA — e deliberadamente NÃO marca `failed`.
  const iFinal = src.indexOf("const finalizado = await env.repo.finalizeCheckout");
  assert.ok(iFinal > 0, "o finalize sumiu do checkout");
  const depoisDoFinal = src.slice(iFinal, iFinal + 700);
  assert.match(
    depoisDoFinal,
    /if \(!finalizado\.ok\) \{[\s\S]*?return finalizado;/,
    "a falha do finalize deixou de ser propagada"
  );
  assert.doesNotMatch(
    depoisDoFinal,
    /failIdempotency/,
    "o finalize que falhou passou a marcar `failed` — o recurso externo existe"
  );

  // Os quatro desfechos que RETORNAM antes do provider.
  const iClaim = src.indexOf("switch (claim.value.kind)");
  assert.ok(iClaim > 0, "o switch de desfechos do claim sumiu");
  const iProvider = src.indexOf("env.provider.createCustomer");
  assert.ok(iProvider > iClaim, "o provider é chamado antes de avaliar o claim");

  const entreClaimEProvider = src.slice(iClaim, iProvider);
  for (const desfecho of ["fingerprint_conflict", "in_progress", "completed"]) {
    assert.match(
      entreClaimEProvider,
      new RegExp(`case "${desfecho}"`),
      `o desfecho ${desfecho} deixou de ser tratado antes do provider`
    );
  }
  // E a autorização vem antes de tudo.
  assert.ok(
    src.indexOf("assertTenant") < iProvider,
    "o provider é chamado antes da checagem de autorização"
  );
});

test("BO-23: o repositório real alcança billing SÓ por RPC", () => {
  // ── O DEFEITO QUE ESTA GUARDA EXISTE PARA IMPEDIR ─────────────────────────
  //
  // `.schema("billing").from(...)` NÃO abre conexão SQL: o supabase-js traduz
  // isso no cabeçalho HTTP `Accept-Profile: billing` para o PostgREST, que
  // recusa qualquer schema fora de `db-schemas` com PGRST106. Como `billing`
  // nunca esteve exposto — e continua não estando, por decisão — toda chamada
  // por esse caminho falha, sempre.
  //
  // A camada inteira foi entregue assim e passou por todas as suítes, porque
  // nenhum teste instanciava a classe. É por isso que esta guarda é textual E
  // existe a suíte de contrato: uma pega a reintrodução, a outra pega a
  // regressão de comportamento.
  const repo = "src/lib/billing/repositories/supabase.ts";
  assert.ok(existe(repo), `${repo} ausente`);
  const src = tsExecutavel(repo);

  assert.doesNotMatch(
    src,
    /\.schema\(\s*["'`]billing["'`]\s*\)/,
    "o repositório voltou a endereçar o schema billing pelo PostgREST — " +
      "esse caminho não funciona e nunca funcionou"
  );
  assert.doesNotMatch(
    src,
    /\.from\(\s*["'`](?:subscriptions|charges|idempotency_records|customers|audit_events|price_snapshots|courtesies|provider_events)["'`]/,
    "o repositório acessa tabela de billing diretamente"
  );

  // ── A ALLOWLIST É UM TIPO ─────────────────────────────────────────────────
  //
  // `NomeDeRpc` é a união fechada dos dezesseis nomes, e `#chamar` só aceita
  // esse tipo. Nome fora da lista, ou montado dinamicamente, NÃO COMPILA — é
  // garantia mais forte do que qualquer varredura textual. Esta guarda confere
  // que a união e a allowlist versionada continuam iguais.
  const uniao = /type\s+NomeDeRpc\s*=([\s\S]*?);/.exec(src)?.[1] ?? "";
  const declarados = [...uniao.matchAll(/"(fn_billing_\w+)"/g)].map((m) => m[1]);

  assert.ok(declarados.length > 0, "o repositório não declara a união NomeDeRpc");
  assert.deepEqual(
    [...declarados].sort(),
    [...NOMES_DE_RPC].sort(),
    "a união NomeDeRpc divergiu da allowlist versionada"
  );

  // Um único ponto de contato com o PostgREST, e ele recebe o nome TIPADO.
  const pontos = [...src.matchAll(/\.rpc\(/g)].length;
  assert.equal(pontos, 1, `há ${pontos} chamadas .rpc(); deve haver exatamente uma`);
  assert.match(
    src,
    /this\.#db\.rpc\(\s*nome\s*,/,
    "a chamada .rpc não recebe o nome tipado de #chamar"
  );

  // Nada de nome montado em tempo de execução.
  assert.doesNotMatch(src, /\.rpc\(\s*`/, "RPC chamada com template literal");
  assert.doesNotMatch(src, /\.rpc\(\s*[a-z]\w*\s*\+/i, "RPC chamada com nome concatenado");

  // E todas as dezesseis são efetivamente usadas — uma declarada e nunca
  // chamada seria allowlist inflada.
  const usadas = [...src.matchAll(/#chamar\(\s*\n?\s*"(fn_billing_\w+)"/g)].map((m) => m[1]);
  const naoUsadas = NOMES_DE_RPC.filter((n) => !usadas.includes(n));
  assert.deepEqual(naoUsadas, [], `RPC declarada e nunca chamada: ${naoUsadas.join(", ")}`);

  // Sem `any`: resposta do PostgREST é `unknown` até ser validada.
  assert.doesNotMatch(src, /:\s*any\b|\bas\s+any\b/, "o repositório usa any");

  // Fail-closed explícito: resposta vazia e formato inesperado NEGAM.
  assert.match(src, /resposta vazia/, "resposta ausente não é tratada como falha");
  assert.match(src, /formato inesperado/, "resposta malformada não é tratada como falha");

  // Nenhum fallback para o dublê.
  assert.doesNotMatch(
    src,
    /InMemoryBillingRepository/,
    "o repositório real referencia o dublê — fallback silencioso"
  );
});

test("BO-14: em public a migration só cria as RPCs nominalmente autorizadas", () => {
  const sql = sqlExecutavel(MIGRATION);

  assert.doesNotMatch(sql, /DROP TABLE|DROP TYPE|DROP SCHEMA/i, "a migration remove objeto");
  assert.doesNotMatch(sql, /DROP COLUMN/i, "a migration remove coluna");
  assert.doesNotMatch(sql, /UPDATE\s+public\./i, "a migration faz DML em public");
  assert.doesNotMatch(sql, /CREATE\s+POLICY/i, "a fundação exige zero policies");
  assert.doesNotMatch(sql, /ALTER\s+DEFAULT\s+PRIVILEGES/i, "exige superusuário");

  // ── O FURO QUE ESTA GUARDA TINHA ──────────────────────────────────────────
  //
  // A versão anterior proibia DDL em `public` com
  //   /(CREATE|ALTER|DROP)\s+(TABLE|TYPE|FUNCTION|…)\s+…public\./
  // e passava quando a migration escrevia `CREATE OR REPLACE FUNCTION
  // public.x`, porque "OR REPLACE" fica ENTRE `CREATE` e `FUNCTION` e o `\s+`
  // não casa. A guarda que deveria vigiar a fronteira nunca a vigiou.
  //
  // Agora a fronteira é uma allowlist: DDL de função em `public` é permitida
  // SOMENTE para os nomes declarados, e qualquer outro DDL continua proibido.

  // 1. Nenhum DDL de objeto NÃO-função em public.
  assert.doesNotMatch(
    sql,
    /\b(CREATE|ALTER|DROP)\s+(OR\s+REPLACE\s+)?(TABLE|TYPE|VIEW|INDEX|TRIGGER|POLICY|SEQUENCE|SCHEMA)\s+(IF\s+(NOT\s+)?EXISTS\s+)?(public\.|"public"\.)/i,
    "a migration cria objeto não-função em public"
  );

  // 2. Toda função criada em public está na allowlist — inclusive as escritas
  //    com OR REPLACE, que é a forma que escapava.
  const criadasEmPublic = [
    ...sql.matchAll(
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.|"public"\.)(\w+)/gi
    ),
  ].map((m) => m[1]);

  assert.ok(criadasEmPublic.length > 0, "a migration não cria RPC alguma em public");

  const foraDaAllowlist = criadasEmPublic.filter((n) => !NOMES_DE_RPC.includes(n));
  assert.deepEqual(
    foraDaAllowlist,
    [],
    `função em public fora da allowlist: ${foraDaAllowlist.join(", ")}`
  );

  // 3. E todas as declaradas são realmente criadas — remover uma reprova.
  const naoCriadas = NOMES_DE_RPC.filter((n) => !criadasEmPublic.includes(n));
  assert.deepEqual(naoCriadas, [], `RPC declarada e não criada: ${naoCriadas.join(", ")}`);

  assert.equal(
    new Set(criadasEmPublic).size,
    criadasEmPublic.length,
    "há definição duplicada de RPC — sobrecarga acidental"
  );

  // 4. Cada RPC é SECURITY DEFINER com search_path VAZIO.
  const blocos = sql.split(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+/i).slice(1);
  for (const bloco of blocos) {
    const nome = /^(?:public\.|"public"\.)?(\w+)/.exec(bloco)?.[1];
    if (!nome || !NOMES_DE_RPC.includes(nome)) continue;
    const cabeca = bloco.slice(0, bloco.search(/\bAS\s+\$/i));
    assert.match(cabeca, /SECURITY\s+DEFINER/i, `${nome} não é SECURITY DEFINER`);
    assert.match(
      cabeca,
      /SET\s+search_path\s*=\s*''/i,
      `${nome} não fixa search_path vazio`
    );
  }

  // 5. Nenhuma RPC aceita fragmento de SQL ou nome de objeto como parâmetro,
  //    e nenhuma monta comando com entrada.
  assert.doesNotMatch(
    sql,
    /EXECUTE\s+format\([^)]*\bp_[a-z_]+/i,
    "há SQL dinâmico montado com parâmetro de entrada"
  );

  // As cinco tabelas novas, com RLS.
  for (const t of [
    "customers",
    "charges",
    "idempotency_records",
    "courtesy_revocations",
    "provider_events",
  ]) {
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
  // ── UNICIDADE DO EVENTO EXTERNO É GLOBAL, NÃO POR TENANT ──────────────────
  //
  // Era `(organization_id, provider, external_charge_id)`. Com `organization_id`
  // na chave, o MESMO identificador do MESMO provider podia existir em duas
  // organizações — e um evento seria aplicável ao tenant errado. A resolução do
  // tenant a partir do identificador externo depende desta unicidade ser global.
  assert.match(
    sql,
    /CONSTRAINT charges_externo_unico\s*\n?\s*UNIQUE \(provider, provider_account_id, external_charge_id\)/,
    "a unicidade do identificador externo voltou a ser por tenant"
  );
  assert.match(
    sql,
    /CONSTRAINT provider_events_unico\s*\n?\s*UNIQUE \(provider, provider_account_id, external_event_id\)/,
    "o evento externo precisa ser único globalmente"
  );
  assert.match(
    sql,
    /CONSTRAINT customers_externo_unico\s*\n?\s*UNIQUE \(provider, provider_account_id, external_customer_id\)/,
    "sem esta unicidade não há como resolver o tenant pelo cliente externo"
  );
  assert.match(
    sql,
    /CONSTRAINT charges_comando_unico UNIQUE \(organization_id, idempotency_key\)/,
    "sem esta unicidade o checkout repetido criaria segunda cobrança"
  );

  // Idempotência com ESTADO e FINGERPRINT — sem os dois, a reserva grava
  // resultado antes do efeito e a chave fica presa quando o efeito falha.
  assert.match(sql, /status\s+billing\.idempotency_state\s+NOT NULL/i);
  assert.match(sql, /request_fingerprint\s+text\s+NOT NULL/i);
  assert.match(
    sql,
    /CONSTRAINT idempotency_resultado_so_completo/,
    "falta a constraint que impede resultado em registro não concluído"
  );

  // E o verificador independente confere as colunas exatas.
  const ver = ler(VERIFICADOR);
  assert.match(ver, /charges_externo_unico voltou a ser por tenant/);
  assert.match(ver, /request_fingerprint/);
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

  // A integração precisa continuar sendo COMPORTAMENTO, não só catálogo — e
  // agora exercita as RPCs, que são o caminho real da aplicação.
  const sql = ler(INTEGRACAO);
  assert.match(sql, /restrict_violation/, "falta a prova de imutabilidade");
  assert.match(sql, /fingerprint_conflict/, "falta a prova de conflito de fingerprint");
  assert.match(sql, /recusas distinguíveis/, "falta a prova de recusa indistinguível");
  assert.match(sql, /tenant resolvido/, "falta a prova de resolução de tenant pelo externo");
  assert.match(sql, /paid → failed foi aceito/, "falta a prova de transição inválida");
  assert.match(
    sql,
    /public\.fn_billing_claim_idempotency/,
    "a integração precisa chamar as RPCs, não escrever direto nas tabelas"
  );
  assert.match(sql, /^ROLLBACK;$/m, "o bloco comportamental precisa terminar em ROLLBACK");

  // A CORRIDA não cabe numa sessão psql. O arquivo anterior afirmava provar
  // concorrência com INSERT duplicado sequencial — não provava.
  const corrida = "scripts/ci/assert-billing-concurrency.sh";
  assert.ok(existe(corrida), `${corrida} ausente`);
  const sh = ler(corrida);
  // Uma barreira POR corrida. Contar importa: uma disputa sem portão de
  // largada não é disputa — a primeira conexão termina antes de a segunda
  // abrir, e o teste vira prova de constraint, que é o que a revisão reprovou.
  const barreiras = (sh.match(/pg_advisory_xact_lock_shared/g) ?? []).length;
  assert.ok(
    barreiras >= 3,
    `a corrida tem ${barreiras} barreira(s); são três disputas e cada uma precisa da sua`
  );
  assert.match(sh, /esperado exatamente 1 vencedor/, "a corrida não confere o vencedor único");
  assert.ok(verify.includes(corrida), "o CI não executa a corrida real");
});

test("BO-18: o service_role não tem escrita direta em billing — a porta é a RPC", () => {
  // Não existe mais allowlist de UPDATE, porque não existe mais UPDATE
  // concedido. A 12B revoga TUDO do service_role, inclusive SELECT e o USAGE
  // no schema: ele passa a executar as dezesseis funções e nada mais.
  //
  // Enquanto havia escrita direta e o service_role tem BYPASSRLS, o filtro por
  // organização escrito no cliente era a única barreira entre dois tenants.
  // Agora a barreira é a revalidação no banco, dentro da mesma transação do
  // efeito.
  const sql = sqlExecutavel(MIGRATION);

  assert.match(
    sql,
    /REVOKE ALL ON TABLE billing\.%I FROM service_role/,
    "a migration não revoga o acesso direto do service_role"
  );
  assert.match(
    sql,
    /REVOKE USAGE ON SCHEMA billing FROM service_role/,
    "o service_role continua com USAGE no schema billing"
  );
  assert.doesNotMatch(
    sql,
    /GRANT\s+[^;']*\b(INSERT|UPDATE|DELETE)\b[^;']*ON TABLE billing/i,
    "a migration devolveu escrita direta ao service_role"
  );

  // E o verificador independente pergunta ao PostgreSQL, não ao texto.
  const ver = ler(VERIFICADOR);
  assert.match(ver, /has_schema_privilege\('service_role', 'billing', 'USAGE'\)/);
  assert.match(ver, /privilegio direto sobrevivente/);
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
    /if \(!Number\.isInteger\(input\.days\) \|\| input\.days < 1\)/,
    "grantCourtesy deixou de exigir prazo positivo inteiro"
  );
  assert.match(src, /input\.reason\.trim\(\) === ""/, "grantCourtesy deixou de exigir motivo");
  // O autor vem do CONTEXTO. Ele não é mais montado aqui: `contexto(env)`
  // carrega `actorId`, e é o dublê/RPC que o grava como `grantedBy` — o que
  // torna impossível o caso de uso atribuir a concessão a outra pessoa.
  assert.match(
    src,
    /env\.repo\.grantCourtesy\(contexto\(env\)/,
    "a cortesia deixou de ser concedida com o contexto do servidor"
  );
  const memoria = tsExecutavel("src/lib/billing/repositories/in-memory.ts");
  assert.match(
    memoria,
    /grantedBy: ctx\.actorId/,
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

  // A leitura é uma só — `readState` — e ela recebe ator E organização, nessa
  // ordem. Trocar a ordem faria a organização ser procurada pelo identificador
  // do usuário.
  assert.match(
    src,
    /readState\(env\.auth\.userId, env\.auth\.organizationId\)/,
    "leitura do direito adquirido deixou de usar a organização do contexto"
  );
  assert.doesNotMatch(
    src,
    /readState\(env\.auth\.organizationId/,
    "ator e organização foram trocados de posição na leitura"
  );

  // Cortesia e direito adquirido são gravados pelo `ComandoContexto`, que
  // carrega a organização resolvida no servidor.
  for (const nome of ["grantCourtesy", "revokeCourtesy", "saveGrandfathering"]) {
    const i = src.indexOf(`env.repo.${nome}(`);
    assert.ok(i > 0, `${nome} não é chamado no caso de uso`);
    assert.match(
      src.slice(i, i + 120),
      /contexto\(env\)/,
      `${nome} deixou de receber o contexto do servidor`
    );
  }

  // O usuário NUNCA ocupa a posição da organização.
  //
  // A asserção é específica de propósito: `grantedBy`/`revokedBy` derivados de
  // `ctx.actorId` são CORRETOS — registram o autor. O que não pode acontecer é
  // o usuário ser gravado COMO organização.
  assert.doesNotMatch(
    src,
    /organizationId:\s*env\.auth\.userId/,
    "o usuário está sendo gravado como organização"
  );

  // E o dublê grava o direito adquirido pela organização do contexto.
  const memoria = tsExecutavel("src/lib/billing/repositories/in-memory.ts");
  assert.match(
    memoria,
    /organizationId: ctx\.organizationId,\s*cutoffAt,/,
    "o direito adquirido deixou de ser gravado por organização"
  );
});

console.log("");
console.log(`Billing orchestration guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
