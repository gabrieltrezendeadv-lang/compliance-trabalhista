/**
 * METADADOS CONTRATUAIS DE BILLING — Etapa 12C.1
 *
 * Guarda estática de `20260810120000_billing_contract_metadata.sql`, do seu
 * rollback, do verificador independente, da rota de aplicação e do caminho
 * TypeScript inteiro.
 *
 * ── O QUE ESTA GUARDA COBRE, E O QUE NÃO COBRE ──────────────────────────────
 *
 * COBRE o que se lê sem banco: a migration troca a assinatura em vez de
 * sobrecarregar, o rollback aborta antes de destruir prova contratual, a
 * allowlist e o verificador independente concordam em DEZOITO, o repositório
 * real continua alcançando o banco só por `.rpc()`, e a versão oficial dos
 * termos mora num lugar só.
 *
 * NÃO COBRE comportamento: isso é de `scripts/ci/assert-billing-orchestration.sql`
 * (PostgreSQL real, com fixtures), de `scripts/ci/verify-applied/20260810120000.sql`
 * (catálogo e recusas, somente leitura) e do contrato memória × PostgREST.
 *
 * `tests/billing-contract-metadata-mutation-guard.mjs` prova que cada asserção
 * daqui tem dente.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NOMES_DE_RPC, RPCS_DE_BILLING } from "../scripts/ci/billing-rpc-allowlist.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8").replace(/\r\n?/g, "\n");
const existe = (p) => fs.existsSync(path.join(raiz, p));

const VERSAO = "20260810120000";
const MIGRATION = `supabase/migrations/${VERSAO}_billing_contract_metadata.sql`;
const ROLLBACK = `supabase/rollbacks/${VERSAO}_billing_contract_metadata_rollback.sql`;
const VERIFICADOR = `scripts/ci/verify-applied/${VERSAO}.sql`;
const INTEGRACAO = "scripts/ci/assert-billing-orchestration.sql";
const ALLOWLIST = "scripts/ci/billing-rpc-allowlist.mjs";
const CATALOGO = "scripts/ci/assert-billing-rpcs.sql";
const REPO_REAL = "src/lib/billing/repositories/supabase.ts";
const REPO_MEM = "src/lib/billing/repositories/in-memory.ts";
const CONTRATO_TS = "src/lib/billing/core/repository.ts";
const CASOS_DE_USO = "src/lib/billing/usecases/subscription.ts";
const TERMOS = "src/lib/billing/terms.ts";
const CONTRATO_COMPARTILHADO = "tests/contract/shared-expectations.ts";
const ROTA = ".github/workflows/migration-apply.yml";
const CI = ".github/workflows/ci.yml";

/** As três colunas desta etapa. */
const COLUNAS = ["billing_email", "terms_version", "terms_accepted_at"];

/** As duas RPCs que a 12C.1 acrescenta. */
const RPCS_NOVAS = ["fn_billing_update_billing_email", "fn_billing_accept_terms"];

/** Assinatura EXATA que a 12C.1 aposenta. Sobreviver a ela é o pior desfecho. */
const ASSINATURA_ANTIGA =
  "uuid, uuid, text, text, text, integer, text, timestamptz, timestamptz, timestamptz, integer, text, text";

/**
 * Selo das 40 migrations anteriores.
 *
 * Forward-only significa que NENHUMA delas pode mudar — nem por um espaço. As
 * 36 históricas já são conferidas por hash contra o manifesto em
 * `tests/verify-recovered-migrations.mjs`; as quatro forward-only anteriores
 * não eram conferidas por ninguém, e passam a ser aqui.
 *
 * Um selo só, sobre nome + conteúdo normalizado, em ordem. Normalizado porque
 * a árvore de trabalho no Windows tem CRLF e no CI tem LF — o blob versionado
 * é LF pelo `.gitattributes`, e o selo precisa valer nos dois.
 */
const SELO_DAS_ANTERIORES =
  "1e48a82fd699d804d67668555d75543b765459a2c7acad18ed79d02935b0352f";

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

/** TypeScript sem comentários — só o que o motor executa. */
function tsExecutavel(rel) {
  return ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

/** SQL sem comentários de linha nem de bloco — só o que o PostgreSQL executa. */
function sqlExecutavel(rel) {
  return ler(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

// ── 1. A migration existe e é forward-only ─────────────────────────────────

test("CM-01: a migration existe, é posterior à 12B e não altera as anteriores", () => {
  assert.ok(existe(MIGRATION), `${MIGRATION} ausente`);
  assert.ok(VERSAO > "20260802093000", "a versão não é posterior à 12B");

  const dir = path.join(raiz, "supabase/migrations");
  const sql = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.equal(sql.length, 41, `esperadas 41 migrations, há ${sql.length}`);
  assert.equal(sql.at(-1), `${VERSAO}_billing_contract_metadata.sql`, "a 12C.1 não é a última");

  const anteriores = sql.filter((f) => f < VERSAO);
  assert.equal(anteriores.length, 40, `esperadas 40 anteriores, há ${anteriores.length}`);

  const h = crypto.createHash("sha256");
  for (const f of anteriores) {
    h.update(f);
    h.update("\0");
    h.update(fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n?/g, "\n"));
    h.update("\0");
  }
  assert.equal(
    h.digest("hex"),
    SELO_DAS_ANTERIORES,
    "alguma das 40 migrations anteriores mudou — forward-only proíbe isso"
  );
});

// ── 2. As três colunas ─────────────────────────────────────────────────────

test("CM-02: as três colunas nascem NULL e nenhuma vira NOT NULL", () => {
  const sql = sqlExecutavel(MIGRATION);

  const alter = /ALTER TABLE billing\.subscriptions\s+([\s\S]*?);/.exec(sql)?.[1] ?? "";
  for (const coluna of COLUNAS) {
    assert.match(
      alter,
      new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${coluna}\\s+\\S+(\\s+NULL)`),
      `${coluna} não é acrescentada como NULL`
    );
  }
  assert.match(alter, /terms_accepted_at\s+timestamptz/, "terms_accepted_at não é timestamptz");

  // `NOT NULL` obrigaria a inventar um aceite para as linhas anteriores — que é
  // falsificar prova contratual.
  assert.doesNotMatch(
    sql,
    /SET NOT NULL/i,
    "a migration promove alguma coluna a NOT NULL"
  );
  assert.doesNotMatch(sql, /DROP COLUMN/i, "a migration remove coluna");
  assert.doesNotMatch(sql, /DROP TABLE|DROP SCHEMA/i, "a migration remove objeto estrutural");
});

test("CM-03: os três CHECKs existem, e cada um cobra uma coisa diferente", () => {
  const sql = sqlExecutavel(MIGRATION);

  // PAR COMPLETO: versão sem instante é aceite sem data; instante sem versão é
  // data sem documento. Nenhum dos dois prova nada.
  assert.match(
    sql,
    /CONSTRAINT subscriptions_termos_par_completo[\s\S]{0,200}?CHECK \(\(terms_version IS NULL\) = \(terms_accepted_at IS NULL\)\)/,
    "o CHECK do par entre versão e instante não está declarado"
  );

  // VERSÃO: vazia, só espaços e fora do formato de data são recusadas.
  const versao =
    /CONSTRAINT subscriptions_termos_versao_valida([\s\S]*?);/.exec(sql)?.[1] ?? "";
  assert.match(versao, /terms_version IS NULL/, "a versão não admite nulo");
  assert.match(versao, /\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}/, "a versão não exige formato de data");

  // E-MAIL: limite de tamanho e forma mínima.
  const email =
    /CONSTRAINT subscriptions_billing_email_valido([\s\S]*?);/.exec(sql)?.[1] ?? "";
  assert.match(email, /length\(billing_email\) <= 254/, "o e-mail não tem limite de tamanho");
  assert.match(email, /btrim\(billing_email\)/, "o e-mail pode ser gravado com espaços nas pontas");
  assert.match(email, /@/, "o e-mail não exige forma mínima");
});

// ── 3. A troca de assinatura ───────────────────────────────────────────────

test("CM-04: a assinatura antiga de start_trial é removida NOMINALMENTE", () => {
  const sql = sqlExecutavel(MIGRATION);

  const drop = new RegExp(
    `DROP FUNCTION IF EXISTS public\\.fn_billing_start_trial\\(\\s*${ASSINATURA_ANTIGA.replace(
      /, /g,
      ",\\s*"
    )}\\s*\\)`,
    "i"
  );
  assert.match(
    sql.replace(/\s+/g, " "),
    new RegExp(
      "DROP FUNCTION IF EXISTS public\\.fn_billing_start_trial\\( " +
        ASSINATURA_ANTIGA.replace(/, /g, ", ") +
        " \\)",
      "i"
    ),
    "a assinatura antiga de start_trial não é removida pela assinatura exata"
  );
  assert.ok(drop instanceof RegExp);

  // Sem CASCADE: se algo depender dela, é para falhar e ser revisado.
  assert.doesNotMatch(sql, /DROP FUNCTION[^;]*CASCADE/i, "o DROP usa CASCADE");

  // E a pós-condição exige UMA versão instalada — sem isso, afrouxar o DROP
  // passaria despercebido porque o CREATE é OR REPLACE.
  assert.match(
    sql,
    /count\(\*\)[\s\S]{0,400}?proname = 'fn_billing_start_trial'[\s\S]{0,200}?v_int <> 1/,
    "a migration não exige exatamente uma versão de start_trial"
  );
  assert.match(
    sql,
    /assinatura ANTIGA de fn_billing_start_trial sobreviveu/,
    "a migration não confere que a assinatura antiga sumiu"
  );
});

test("CM-05: a nova start_trial recebe contato, versão e instante do aceite", () => {
  const sql = sqlExecutavel(MIGRATION);
  const corpo =
    /CREATE OR REPLACE FUNCTION public\.fn_billing_start_trial\(([\s\S]*?)\) RETURNS/.exec(sql)?.[1] ??
    "";
  for (const p of ["p_billing_email text", "p_terms_version text", "p_terms_accepted_at timestamptz"]) {
    assert.ok(corpo.includes(p), `start_trial não recebe ${p}`);
  }

  // O ACEITE VEM ANTES DA ESCRITA. Um trial gravado e só depois validado seria
  // um trial sem aceite quando a validação falhasse.
  const fn =
    /CREATE OR REPLACE FUNCTION public\.fn_billing_start_trial[\s\S]*?\n\$fn\$;/.exec(sql)?.[0] ?? "";
  const iAuth = fn.indexOf("fn_require_member");
  const iTermos = fn.indexOf("fn_require_terms_version");
  const iEscrita = fn.indexOf("billing.subscriptions (");
  assert.ok(iAuth > 0 && iTermos > 0 && iEscrita > 0, "start_trial perdeu autorização, aceite ou escrita");
  assert.ok(iAuth < iTermos, "a validação do aceite vem ANTES da autorização");
  assert.ok(iTermos < iEscrita, "o trial é gravado ANTES de o aceite ser exigido");

  // E o aceite é auditado como evento PRÓPRIO, DEPOIS da escrita e DENTRO da
  // mesma transação.
  assert.match(fn, /'terms_acceptance'/, "o aceite não é auditado no início do trial");
  assert.match(fn, /'termsVersion', v_versao/, "a trilha do aceite não guarda a versão");
  assert.ok(
    fn.indexOf("'terms_acceptance'") > iEscrita,
    "o aceite é auditado ANTES de a assinatura ser gravada — auditaria o que não aconteceu"
  );
  // Um `EXCEPTION WHEN OTHERS` em volta da auditoria a tiraria efetivamente da
  // transação: a falha deixaria de desfazer a operação, e sobraria trial sem
  // prova de aceite.
  assert.doesNotMatch(
    fn,
    /EXCEPTION\s+WHEN\s+OTHERS/i,
    "start_trial engole exceção — a falha da auditoria deixaria de desfazer o trial"
  );
});

test("CM-06: as duas RPCs novas são estreitas, SECURITY DEFINER e sem search_path", () => {
  const sql = sqlExecutavel(MIGRATION);

  for (const nome of RPCS_NOVAS) {
    const fn = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${nome}\\(([\\s\\S]*?)\\) RETURNS jsonb\\s*LANGUAGE plpgsql\\s*SECURITY DEFINER\\s*SET search_path = ''`
    ).exec(sql);
    assert.ok(fn, `${nome} ausente, ou sem SECURITY DEFINER/search_path vazio`);

    const params = fn[1].split(",").length;
    assert.equal(params, 5, `${nome} tem ${params} parâmetros — estreita significa cinco`);
  }

  // ESTREITAS: nenhuma delas aceita plano, faixa, estado ou contagem. Uma RPC
  // que pode mudar duas coisas é uma RPC que se pode enganar a mudar a segunda.
  const email =
    /CREATE OR REPLACE FUNCTION public\.fn_billing_update_billing_email[\s\S]*?\n\$fn\$;/.exec(sql)?.[0] ??
    "";
  for (const proibido of ["p_plan", "p_tier", "p_state", "p_worker_count", "p_period"]) {
    assert.ok(!email.includes(proibido), `update_billing_email aceita ${proibido}`);
  }

  const termos =
    /CREATE OR REPLACE FUNCTION public\.fn_billing_accept_terms[\s\S]*?\n\$fn\$;/.exec(sql)?.[0] ?? "";
  for (const proibido of ["p_plan", "p_tier", "p_state", "p_worker_count"]) {
    assert.ok(!termos.includes(proibido), `accept_terms aceita ${proibido}`);
  }
});

test("CM-07: as duas exigem OWNER e resolvem a organização no banco", () => {
  const sql = sqlExecutavel(MIGRATION);
  for (const nome of RPCS_NOVAS) {
    const fn = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${nome}[\\s\\S]*?\\n\\$fn\\$;`
    ).exec(sql)?.[0] ?? "";
    assert.match(
      fn,
      /fn_require_member\(p_actor_id, p_organization_id, true\)/,
      `${nome} não exige owner revalidado no banco`
    );
    // O filtro por organização não é opcional: sem ele, a RPC alcançaria
    // qualquer assinatura.
    assert.match(
      fn,
      /WHERE s\.organization_id = p_organization_id/,
      `${nome} não filtra a assinatura pela organização`
    );
    assert.match(fn, /FOR UPDATE/, `${nome} lê a assinatura sem travar a linha`);
  }
});

test("CM-08: o aceite é auditado, e o e-mail entra na trilha MASCARADO", () => {
  const sql = sqlExecutavel(MIGRATION);

  const email =
    /CREATE OR REPLACE FUNCTION public\.fn_billing_update_billing_email[\s\S]*?\n\$fn\$;/.exec(sql)?.[0] ??
    "";
  assert.match(email, /fn_audit\(/, "a troca de contato não é auditada");
  assert.match(email, /fn_mask_email\(v_antes\)/, "o valor anterior vai cru para a trilha");
  assert.match(email, /fn_mask_email\(v_novo\)/, "o valor novo vai cru para a trilha");

  // `audit_events` é append-only. O endereço inteiro ali viraria histórico
  // IMUTÁVEL de dado pessoal — a coluna corrente é corrigível, a trilha não.
  assert.doesNotMatch(
    email,
    /jsonb_build_object\([^)]*'email'/,
    "a trilha guarda o endereço sob a chave 'email'"
  );
  assert.doesNotMatch(
    email,
    /jsonb_build_object\((?:[^)]*, )?'[a-z]*', v_novo\b/,
    "o endereço cru é gravado na trilha"
  );

  // Auditoria dentro da transação do efeito: engolir a exceção seria auditar
  // "por fora", e a operação sobreviveria à falha da trilha.
  assert.doesNotMatch(
    email,
    /EXCEPTION\s+WHEN\s+OTHERS/i,
    "update_billing_email engole exceção — a falha da auditoria não desfaria a troca"
  );

  const termos =
    /CREATE OR REPLACE FUNCTION public\.fn_billing_accept_terms[\s\S]*?\n\$fn\$;/.exec(sql)?.[0] ?? "";
  assert.match(termos, /fn_audit\([\s\S]*?'terms_acceptance'/, "o novo aceite não é auditado");
  assert.doesNotMatch(
    termos,
    /EXCEPTION\s+WHEN\s+OTHERS/i,
    "accept_terms engole exceção — a falha da auditoria não desfaria o aceite"
  );
  assert.match(termos, /'termsVersion', v_versao/, "a trilha do aceite não guarda a versão");
  assert.match(termos, /v_versao < v_antes/, "regredir de versão de termos não é proibido");

  // NENHUMA TABELA NOVA: `audit_events` já comporta organização, assunto, ator,
  // origem, instante, valor e correlação. Uma segunda trilha abriria a pergunta
  // de qual das duas vale.
  assert.doesNotMatch(
    sql,
    /CREATE TABLE/i,
    "a migration cria tabela — audit_events já comporta a prova do aceite"
  );
});

test("CM-09: o conteúdo dos termos NÃO entra no banco", () => {
  const sql = sqlExecutavel(MIGRATION);
  for (const proibida of ["terms_text", "terms_content", "terms_body", "terms_html"]) {
    assert.ok(!sql.includes(proibida), `a migration guarda o conteúdo dos termos em ${proibida}`);
  }
  assert.match(
    ler(MIGRATION),
    /conteúdo dos termos NÃO entra no banco/i,
    "a decisão de guardar só a versão não está registrada na própria migration"
  );
});

// ── 4. Privilégios ─────────────────────────────────────────────────────────

test("CM-10: EXECUTE só para service_role, e o total instalado é DEZOITO", () => {
  const sql = sqlExecutavel(MIGRATION);

  for (const papel of ["PUBLIC", "anon", "authenticated"]) {
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON FUNCTION %s FROM ${papel}`),
      `a migration não revoga EXECUTE de ${papel}`
    );
  }
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION %s TO service_role/,
    "a migration não concede EXECUTE ao service_role"
  );
  assert.doesNotMatch(
    sql,
    /GRANT[^;\n]*TO (PUBLIC|anon|authenticated)/i,
    "a migration concede privilégio a papel do PostgREST"
  );

  assert.match(
    sql,
    /IF v_int <> 18 THEN[\s\S]{0,160}?esperadas 18 RPCs de billing em public/,
    "a migration não exige exatamente 18 RPCs após conceder"
  );
  assert.match(
    sql,
    /EXECUTE concedido a PUBLIC/,
    "a migration não confere o ACL explodido contra PUBLIC"
  );
});

// ── 5. A allowlist e o verificador independente ────────────────────────────

test("CM-11: a allowlist tem 18, com as duas novas e a assinatura trocada", () => {
  assert.equal(
    RPCS_DE_BILLING.length,
    18,
    `a allowlist tem ${RPCS_DE_BILLING.length} assinaturas, esperadas 18`
  );
  for (const nome of RPCS_NOVAS) {
    assert.ok(NOMES_DE_RPC.includes(nome), `${nome} fora da allowlist`);
  }

  const trial = RPCS_DE_BILLING.find((a) => a.startsWith("fn_billing_start_trial("));
  assert.ok(trial, "start_trial sumiu da allowlist");
  const tipos = trial.slice(trial.indexOf("(") + 1, -1).split(", ");
  assert.equal(tipos.length, 16, `start_trial declara ${tipos.length} tipos, esperados 16`);
  assert.deepEqual(
    tipos.slice(-3),
    ["text", "text", "timestamp with time zone"],
    "os três parâmetros contratuais não estão na assinatura declarada"
  );

  // A assinatura ANTIGA não pode estar na allowlist: ela foi removida
  // nominalmente, e declará-la aqui autorizaria a sobrecarga que a migration
  // existe para impedir.
  assert.ok(
    !RPCS_DE_BILLING.some((a) => a.split(", ").length === 13),
    "a assinatura antiga de start_trial ainda consta da allowlist"
  );
});

test("CM-12: o catálogo independente concorda em 18 — sem importar a allowlist", () => {
  const sql = ler(CATALOGO);

  // O verificador mantém a lista à mão DE PROPÓSITO: um verificador que deriva
  // a declaração do verificado não verifica nada. Ele CITA a allowlist no
  // comentário — isso é documentação, e não dependência —, mas não pode ser
  // gerado a partir dela.
  assert.doesNotMatch(
    sql,
    /GERADO AUTOMATICAMENTE|gerado por scripts|do not edit/i,
    "o catálogo virou arquivo gerado — deixou de ser verificação independente"
  );

  const declaradas = [...sql.matchAll(/'public\.(fn_billing_\w+)\(([^)]*)\)\|/g)];
  assert.equal(declaradas.length, 18, `o catálogo declara ${declaradas.length}, esperadas 18`);

  const doCatalogo = declaradas.map((m) => `${m[1]}(${m[2]})`).sort();
  assert.deepEqual(
    doCatalogo,
    [...RPCS_DE_BILLING].sort(),
    "as duas listas independentes divergiram — uma delas está errada"
  );

  assert.match(sql, /IF v_int <> 18 THEN/, "o catálogo não exige exatamente 18 no banco");
});

test("CM-13: o verificador independente é somente leitura e prova o que promete", () => {
  assert.ok(existe(VERIFICADOR), `${VERIFICADOR} ausente`);
  const sql = ler(VERIFICADOR);

  assert.match(sql, /BEGIN TRANSACTION READ ONLY;/, "a transação não é READ ONLY");
  assert.match(sql, /^ROLLBACK;$/m, "não termina em ROLLBACK");
  assert.doesNotMatch(sql, /^\s*COMMIT;/m, "contém COMMIT");

  const exigido = [
    [/convalidated/, "não prova que os CHECKs foram validados contra as linhas existentes"],
    [/is_nullable = 'YES'/, "não prova a nulidade permitida para linhas anteriores"],
    [/fn_require_terms_version/, "não executa a regra de versão"],
    [/fn_normalize_email/, "não executa a normalização do e-mail"],
    [/fn_mask_email/, "não prova que a máscara não devolve o endereço"],
    [/42501/, "não prova a recusa de autorização"],
    [/DISTINCT FROM v_msg_b/, "não compara as mensagens de recusa entre si"],
    [/assinatura ANTIGA de start_trial ainda existe/, "não procura a sobrecarga"],
    [/array_length\(v_esperadas, 1\) <> 18/, "não exige que a própria lista tenha 18 entradas"],
    [/v_int <> 18/, "não exige que o banco tenha exatamente 18 RPCs"],
    [/EXECUTE para PUBLIC/, "não confere EXECUTE para PUBLIC"],
    [/USAGE em billing/, "não confere que o schema continua fechado"],
    [/relacao de billing em public/, "não confere ausência de objeto indevido em public"],
    [/append-only/, "não confere que a trilha é append-only"],
  ];
  for (const [re, queixa] of exigido) {
    assert.match(sql, re, `${VERIFICADOR}: ${queixa}`);
  }
});

// ── 6. O rollback ──────────────────────────────────────────────────────────

test("CM-14: o rollback ABORTA se houver dado contratual a destruir", () => {
  assert.ok(existe(ROLLBACK), `${ROLLBACK} ausente`);
  const sql = sqlExecutavel(ROLLBACK);

  // A barreira vem ANTES de qualquer DROP: um rollback que apaga primeiro e
  // pergunta depois já destruiu a prova.
  const iBarreira = sql.indexOf("ROLLBACK 20260810120000 ABORTADO");
  const iDrop = sql.search(/DROP (FUNCTION|COLUMN|CONSTRAINT)/i);
  assert.ok(iBarreira > 0, "o rollback não tem barreira contra destruição de dado contratual");
  assert.ok(iDrop > 0, "o rollback não remove nada");
  assert.ok(iBarreira < iDrop, "a barreira do rollback vem DEPOIS do primeiro DROP");

  assert.match(
    sql,
    /billing_email IS NOT NULL[\s\S]{0,120}?terms_version IS NOT NULL[\s\S]{0,120}?terms_accepted_at IS NOT NULL/,
    "a barreira não olha as três colunas"
  );
  assert.match(
    sql,
    /subject::text IN \('terms_acceptance', 'billing_email'\)/,
    "a barreira não olha a trilha de aceite"
  );
  assert.match(sql, /RAISE EXCEPTION[\s\S]{0,200}?ABORTADO/, "a barreira não aborta");
  assert.match(sql, /USING DETAIL/, "a barreira aborta sem diagnóstico");
});

test("CM-15: o rollback devolve exatamente a assinatura anterior, e só remove o desta etapa", () => {
  const sql = sqlExecutavel(ROLLBACK);

  for (const nome of RPCS_NOVAS) {
    assert.match(
      sql,
      new RegExp(`DROP FUNCTION IF EXISTS public\\.${nome}\\(`),
      `o rollback não remove ${nome}`
    );
  }

  // A assinatura anterior volta COM O MESMO CORPO. "Equivalente" produziria uma
  // terceira coisa parecida, e o estado após reverter não seria o anterior.
  const restaurada =
    /CREATE OR REPLACE FUNCTION public\.fn_billing_start_trial\(([\s\S]*?)\) RETURNS/.exec(sql)?.[1] ?? "";
  assert.ok(restaurada.length > 0, "o rollback não recria start_trial");
  for (const proibido of ["p_billing_email", "p_terms_version", "p_terms_accepted_at"]) {
    assert.ok(!restaurada.includes(proibido), `a assinatura restaurada ainda tem ${proibido}`);
  }
  assert.match(
    sql,
    /DROP FUNCTION IF EXISTS public\.fn_billing_start_trial\([\s\S]{0,200}?p_billing_email|DROP FUNCTION IF EXISTS public\.fn_billing_start_trial\([\s\S]{0,240}?timestamptz\s*\);/,
    "o rollback não remove a assinatura NOVA antes de recriar a anterior"
  );

  // Só o desta etapa. Nada da 12A nem da 12B pode ser tocado.
  for (const alheia of [
    "fn_billing_read_state",
    "fn_billing_change_plan",
    "fn_billing_claim_idempotency",
    "billing.subscriptions CASCADE",
  ]) {
    assert.ok(
      !new RegExp(`DROP[^;\\n]*${alheia.replace(/[.()]/g, "\\$&")}`).test(sql),
      `o rollback remove ${alheia}, que não é desta etapa`
    );
  }
  assert.doesNotMatch(sql, /DROP TABLE|DROP SCHEMA|DROP TYPE/i, "o rollback remove objeto alheio");

  // ACL e contagem de volta ao regime da 12B.
  assert.match(sql, /esperadas 16 RPCs apos reverter/, "o rollback não confere o total de 16");

  // A assimetria do enum é DECLARADA, não escondida.
  assert.match(
    ler(ROLLBACK),
    /PostgreSQL não tem `ALTER TYPE \.\.\. DROP VALUE`/,
    "o rollback não declara que os rótulos do enum permanecem"
  );
});

// ── 7. A rota de aplicação ─────────────────────────────────────────────────

test("CM-16: a migration está na rota, com verificação independente", () => {
  const rota = ler(ROTA);
  assert.ok(
    rota.includes(`- ${VERSAO}_billing_contract_metadata.sql`),
    "a migration não é opção do workflow_dispatch"
  );

  const ci = ler(CI);
  // DUAS vezes: depois da aplicação e depois da reaplicação que segue o
  // rollback. Exigir "pelo menos uma" deixava remover a primeira sem que nada
  // acusasse, e a aplicação deixava de ser verificada.
  const rodadas = ci.split(`scripts/ci/verify-applied/${VERSAO}.sql`).length - 1;
  assert.ok(
    rodadas >= 2,
    `o CI roda o verificador da 12C.1 ${rodadas} vez(es): esperadas 2 — após aplicar e após reaplicar`
  );
  assert.ok(
    ci.includes(`supabase/rollbacks/${VERSAO}_billing_contract_metadata_rollback.sql`),
    "o CI não exercita o rollback da 12C.1"
  );
  assert.ok(
    ci.includes(`supabase/migrations/${VERSAO}_billing_contract_metadata.sql`),
    "o CI não reaplica a 12C.1 depois do rollback"
  );

  // ORDEM INVERSA: a 12C.1 sai primeiro. Reverter a 12B com a assinatura nova
  // instalada deixaria em `public` uma função que a 12B não conhece.
  const iC1 = ci.indexOf(`rollbacks/${VERSAO}_billing_contract_metadata_rollback.sql`);
  const iB = ci.indexOf("rollbacks/20260802093000_billing_orchestration_rollback.sql");
  assert.ok(iC1 > 0 && iB > 0 && iC1 < iB, "o rollback da 12C.1 não roda antes do da 12B");
});

// ── 8. O caminho TypeScript ────────────────────────────────────────────────

test("CM-17: o contrato TypeScript ganhou as três propriedades e as duas operações", () => {
  const src = ler(CONTRATO_TS);

  for (const prop of ["billingEmail", "termsVersion", "termsAcceptedAt"]) {
    assert.ok(src.includes(prop), `o contrato não declara ${prop}`);
  }
  assert.match(
    src,
    /billingEmail: string \| null;[\s\S]{0,400}?termsVersion: string \| null;[\s\S]{0,300}?termsAcceptedAt: string \| null;/,
    "as três propriedades da assinatura persistida não são anuláveis"
  );
  // Na ENTRADA do trial a versão é obrigatória — nulo ali seria trial sem aceite.
  assert.match(
    src,
    /readonly termsVersion: string;\n\s+\/\*\*[\s\S]{0,200}?readonly termsAcceptedAt: string;/,
    "StartTrialInput aceita aceite ausente"
  );

  for (const metodo of ["updateBillingEmail(", "acceptTerms("]) {
    assert.ok(src.includes(metodo), `o contrato não declara ${metodo}`);
  }
  // Nada de patch genérico: um método que muda qualquer coisa é um método que
  // se pode enganar a mudar a coisa errada.
  assert.doesNotMatch(
    src,
    /updateSubscription\(|patchSubscription\(/,
    "o contrato voltou a expor escrita genérica de assinatura"
  );

  for (const assunto of ['"terms_acceptance"', '"billing_email"']) {
    assert.ok(src.includes(assunto), `AuditSubject não inclui ${assunto}`);
  }
});

test("CM-18: o repositório real continua fechado — só .rpc(), e as 18 tipadas", () => {
  const src = ler(REPO_REAL);
  // O cabeçalho deste arquivo NARRA o defeito que a 12B corrigiu, e a narração
  // contém `.schema("billing").from(...)` como texto. Medir o comentário
  // reprovaria a documentação em vez do código.
  const executavel = tsExecutavel(REPO_REAL);

  assert.match(src, /^import "server-only";/m, "o repositório perdeu server-only");
  assert.doesNotMatch(
    executavel,
    /\.schema\(\s*["']billing["']\s*\)/,
    "voltou a endereçar o schema billing"
  );
  assert.doesNotMatch(
    executavel,
    /\.from\(/,
    "o repositório passou a acessar tabela diretamente"
  );

  const uniao = /type\s+NomeDeRpc\s*=([\s\S]*?);/.exec(src)?.[1] ?? "";
  const declarados = [...uniao.matchAll(/"(fn_billing_\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...declarados].sort(),
    [...NOMES_DE_RPC].sort(),
    "a união NomeDeRpc divergiu da allowlist"
  );

  for (const nome of RPCS_NOVAS) {
    assert.match(
      src,
      new RegExp(`#chamar\\(\\s*\\n?\\s*"${nome}"`),
      `${nome} é declarada e nunca chamada`
    );
  }

  // O trial passa os três parâmetros novos, com os nomes que o PostgREST espera.
  for (const p of ["p_billing_email:", "p_terms_version:", "p_terms_accepted_at:"]) {
    assert.ok(src.includes(p), `startTrial não envia ${p}`);
  }
  for (const c of ["billing_email", "terms_version", "terms_accepted_at"]) {
    assert.ok(src.includes(`bruto.${c}`), `a leitura da assinatura ignora ${c}`);
  }

  // A mensagem de erro do contato NÃO carrega o endereço: ela vai para log,
  // tela e relatório.
  const metodo = /async updateBillingEmail\([\s\S]*?\n  }/.exec(src)?.[0] ?? "";
  assert.ok(metodo.length > 0, "updateBillingEmail sumiu do repositório real");
  assert.doesNotMatch(
    metodo,
    /\$\{\s*billingEmail\s*\}/,
    "o endereço é interpolado numa mensagem"
  );
});

test("CM-19: o dublê refaz as MESMAS regras, e o contrato compara os dois", () => {
  const src = ler(REPO_MEM);

  for (const metodo of ["async updateBillingEmail(", "async acceptTerms("]) {
    assert.ok(src.includes(metodo), `o dublê não implementa ${metodo}`);
  }
  assert.match(src, /const FORMATO_DE_VERSAO = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//, "o dublê não exige formato de versão");
  assert.match(src, /const LIMITE_DE_EMAIL = 254/, "o dublê não aplica o limite de tamanho");
  assert.match(src, /mascararEmail\(/, "o dublê grava o endereço cru na trilha");
  assert.match(
    src,
    /if \(antes\.termsVersion === versao\) return ok\(antes\)/,
    "o dublê não é idempotente no reenvio do mesmo aceite"
  );
  assert.match(src, /versao < antes\.termsVersion/, "o dublê não proíbe regredir de versão");

  // E as duas implementações são comparadas caso a caso.
  const contrato = ler(CONTRATO_COMPARTILHADO);
  const casos = [
    /trial COM contato financeiro/,
    /trial SEM contato financeiro/,
    /versão de termos \$\{rotulo\} é RECUSADO/,
    /aceite de versão POSTERIOR/,
    /repetir o MESMO aceite é idempotente/,
    /aceitar versão ANTERIOR à já aceita é recusado/,
    /membro comum NÃO troca contato nem aceita termos/,
    /organização ALHEIA e INEXISTENTE recebem a MESMA recusa/,
    /contato malformado é recusado SEM reproduzir o endereço/,
  ];
  for (const re of casos) {
    assert.match(contrato, re, `o contrato compartilhado não cobre ${re}`);
  }
});

test("CM-20: a versão oficial mora num lugar só, e o cliente não a escolhe", () => {
  const src = ler(TERMOS);

  const constantes = [...src.matchAll(/export const TERMS_VERSION\s*=/g)];
  assert.equal(constantes.length, 1, "a versão oficial está declarada mais de uma vez");
  assert.match(src, /export const TERMS_VERSION = "\d{4}-\d{2}-\d{2}"/, "a versão oficial não tem formato de data");

  // A recusa não revela a vigente: quem está com a tela velha recarrega, quem
  // está sondando não ganha nada.
  const erro = /export class TermsVersionMismatchError[\s\S]*?\n}/.exec(src)?.[0] ?? "";
  assert.ok(!erro.includes("TERMS_VERSION"), "a mensagem de recusa entrega a versão vigente");

  const casos = ler(CASOS_DE_USO);
  // A CHAMADA, não o import. Trocar `ok(exigirVersaoVigente(recebida))` por
  // `ok(recebida.trim())` deixa o identificador no topo do arquivo e some com a
  // comparação — foi exatamente o que `MUT-CM-03b` fez passar.
  assert.match(
    casos,
    /return ok\(exigirVersaoVigente\(recebida\)\);/,
    "o caso de uso não compara a versão recebida com a vigente"
  );
  // O que se persiste é a OFICIAL, nunca a string que chegou do cliente.
  assert.match(
    casos,
    /termsVersion: versao\.value/,
    "startTrial persiste a versão recebida do cliente"
  );
  assert.doesNotMatch(
    casos,
    /termsVersion: input\.termsVersion/,
    "a versão do cliente é persistida sem comparação"
  );
  assert.match(
    casos,
    /export async function updateBillingEmail\(/,
    "o caso de uso de contato financeiro não existe"
  );
  assert.match(
    casos,
    /export async function acceptTerms\(/,
    "o caso de uso de novo aceite não existe"
  );
  // Relógio injetado: `new Date()` aqui tornaria a borda do aceite intestável.
  assert.doesNotMatch(casos, /new Date\(\)|Date\.now\(\)/, "o caso de uso lê o relógio do processo");
});

// ── 9. A prova comportamental existe onde só ela cabe ──────────────────────

test("CM-21: a integração com PostgreSQL real prova o que a leitura não alcança", () => {
  const sql = ler(INTEGRACAO);

  const exigido = [
    [/trial com versao \[%\] foi aceito/, "não tenta iniciar trial com versão inválida"],
    [/trial recusado deixou % assinatura\(s\) para tras/, "não confere que a recusa não deixou rastro"],
    [/ADD CONSTRAINT tmp_falha_auditoria/, "não força a auditoria a falhar"],
    [/DROP CONSTRAINT tmp_falha_auditoria/, "não remove a constraint que forçou a falha"],
    [/auditoria falhou e a assinatura ficou gravada/, "não exige que a falha da auditoria desfaça tudo"],
    [/versao sem instante foi aceita/, "não exercita o CHECK do par"],
    [/e-mail acima de 254 caracteres foi aceito/, "não exercita o limite de tamanho"],
    [/colaborador trocou o contato financeiro/, "não prova a recusa a membro comum"],
    [/o endereco inteiro foi para a trilha append-only/, "não prova que a trilha só guarda máscara"],
    [/reenvio sobrescreveu o instante do aceite/, "não prova a idempotência do reenvio"],
    [/versao anterior de termos foi aceita/, "não prova a proibição de regressão"],
  ];
  for (const [re, queixa] of exigido) {
    assert.match(sql, re, `${INTEGRACAO}: ${queixa}`);
  }

  // E continua encerrando em ROLLBACK, sem deixar fixture.
  assert.match(sql, /^ROLLBACK;$/m, "a integração não encerra em ROLLBACK");
  assert.match(sql, /fixture-12b-c/, "a organização sem assinatura não é limpa ao final");
});

// ── 10. Documentação ───────────────────────────────────────────────────────

test("CM-22: a documentação registra o estado real e o que esta etapa NÃO faz", () => {
  const doc = "docs/decisions/METADADOS-CONTRATUAIS-BILLING-12C1.md";
  assert.ok(existe(doc), `${doc} ausente`);
  const texto = ler(doc);

  const exigido = [
    [/40\/40/, "não registra que produção está em 40/40"],
    [/pendente/i, "não registra que a nova migration fica pendente"],
    [/não habilita billing/i, "não diz que a etapa não habilita billing"],
    [/Asaas/, "não diz que o Asaas continua não implementado"],
    [/12C\.3/, "não diz que a interface só vem na 12C.3"],
    [/opcional/i, "não diz que o e-mail financeiro é opcional"],
    [/18/, "não registra que o conjunto passou a 18 RPCs"],
  ];
  for (const [re, queixa] of exigido) {
    assert.match(texto, re, `${doc}: ${queixa}`);
  }

  // E a documentação da 12B não pode continuar dizendo "16 RPCs" como se fosse
  // o estado vigente.
  const doze = ler("docs/decisions/ARQUITETURA-BILLING-12B.md");
  assert.match(
    doze,
    /12C\.1/,
    "ARQUITETURA-BILLING-12B.md não registra que a 12C.1 elevou o conjunto"
  );
});

console.log(`\nBilling contract metadata guard: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
