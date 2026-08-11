/**
 * MUTAÇÕES DOS METADADOS CONTRATUAIS — Etapa 12C.1
 *
 * Mesma mecânica das demais suítes: o repositório é copiado, a mutação é
 * aplicada ao arquivo REAL dentro da cópia, `tests/billing-contract-metadata-guard.mjs`
 * roda lá dentro, e o teste exige REPROVAÇÃO. Nada é escrito na árvore de
 * trabalho.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * Uma guarda que nunca viu a propriedade quebrada não provou que a cobra: pode
 * estar procurando no lugar errado, ou casando uma regex que casaria de
 * qualquer jeito. Cada caso aqui QUEBRA uma propriedade de propósito e exige
 * que a guarda acuse — e acuse a asserção certa, não outra por acaso.
 *
 * `MUT-CM-00` é o controle: sem mutação, tudo passa.
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

const COPIAR = ["tests", "src", "supabase", "scripts", ".github", "docs", "package.json"];
const copia = fs.mkdtempSync(path.join(os.tmpdir(), "billing-12c1-mut-"));

for (const item of COPIAR) {
  const origem = path.join(raiz, item);
  if (!fs.existsSync(origem)) continue;
  fs.cpSync(origem, path.join(copia, item), { recursive: true });
}

const GUARDA = "tests/billing-contract-metadata-guard.mjs";

function guarda() {
  try {
    const out = execFileSync("node", [GUARDA], { cwd: copia, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

const lerCopia = (rel) => fs.readFileSync(path.join(copia, rel), "utf8");
const escreverCopia = (rel, texto) => fs.writeFileSync(path.join(copia, rel), texto, "utf8");

/**
 * Substitui texto num arquivo da cópia, roda a guarda e restaura.
 *
 * A âncora precisa casar EXATAMENTE uma vez. Âncora ambígua muta o lugar errado
 * e o teste passa por engano — foi o que aconteceu no `.env.example` da 12C.0,
 * onde `BILLING_PROVIDER=` casava também na prosa.
 *
 * As âncoras são tolerantes a fim de linha: a árvore de trabalho no Windows tem
 * CRLF e o CI tem LF.
 */
function mutar(rel, de, para, esperado) {
  const original = lerCopia(rel);
  const crlf = original.includes("\r\n");
  const plano = original.replace(/\r\n/g, "\n");
  const n = plano.split(de).length - 1;
  assert.equal(n, 1, `a mutação em ${rel} casou ${n} vez(es), esperado 1 — reescreva-a`);

  const mutado = plano.replace(de, () => para);
  escreverCopia(rel, crlf ? mutado.replace(/\n/g, "\r\n") : mutado);
  try {
    const r = guarda();
    assert.equal(r.code, 1, `a mutação em ${rel} passou:\n${r.out}`);
    assert.match(r.out, esperado, `a guarda reprovou, mas não pela asserção esperada:\n${r.out}`);
  } finally {
    escreverCopia(rel, original);
  }
}

/** Acrescenta um arquivo que não existia, roda a guarda e apaga. */
function criar(rel, conteudo, esperado) {
  const alvo = path.join(copia, rel);
  assert.ok(!fs.existsSync(alvo), `${rel} já existe — a mutação não descreve criação`);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo, "utf8");
  try {
    const r = guarda();
    assert.equal(r.code, 1, `criar ${rel} passou:\n${r.out}`);
    assert.match(r.out, esperado);
  } finally {
    fs.rmSync(alvo, { force: true });
  }
}

const MIGRATION = "supabase/migrations/20260810120000_billing_contract_metadata.sql";
const ROLLBACK = "supabase/rollbacks/20260810120000_billing_contract_metadata_rollback.sql";
const VERIFICADOR = "scripts/ci/verify-applied/20260810120000.sql";
const ALLOWLIST = "scripts/ci/billing-rpc-allowlist.mjs";
const REPO_REAL = "src/lib/billing/repositories/supabase.ts";
const REPO_MEM = "src/lib/billing/repositories/in-memory.ts";
const CASOS = "src/lib/billing/usecases/subscription.ts";
const ROTA = ".github/workflows/migration-apply.yml";

// ── Controle ────────────────────────────────────────────────────────────────

test("MUT-CM-00: sem mutação, a guarda PASSA na cópia", () => {
  const r = guarda();
  assert.equal(r.code, 0, `a guarda deveria passar sem mutação:\n${r.out}`);
  assert.match(r.out, /0 failed/);
});

// ── 1. As constraints ───────────────────────────────────────────────────────

test("MUT-CM-01: remover o CHECK que casa versão e instante é DETECTADO", () => {
  mutar(
    MIGRATION,
    `      CHECK ((terms_version IS NULL) = (terms_accepted_at IS NULL));`,
    `      CHECK (terms_version IS NULL OR terms_version <> '');`,
    /CHECK do par entre versão e instante/
  );
});

test("MUT-CM-02: aceitar versão vazia (CHECK sem formato) é DETECTADO", () => {
  mutar(
    MIGRATION,
    `        OR (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND length(terms_version) = 10)`,
    `        OR terms_version IS NOT NULL`,
    /versão não exige formato de data/
  );
});

test("MUT-CM-02b: e-mail sem limite de tamanho é DETECTADO", () => {
  mutar(
    MIGRATION,
    `          length(billing_email) <= 254`,
    `          length(billing_email) >= 0`,
    /e-mail não tem limite de tamanho/
  );
});

test("MUT-CM-02c: coluna contratual promovida a NOT NULL é DETECTADA", () => {
  mutar(
    MIGRATION,
    `ALTER TABLE billing.subscriptions
  ADD COLUMN IF NOT EXISTS billing_email     text NULL,`,
    `ALTER TABLE billing.subscriptions
  ALTER COLUMN cnpj SET NOT NULL,
  ADD COLUMN IF NOT EXISTS billing_email     text NULL,`,
    /promove alguma coluna a NOT NULL/
  );
});

// ── 2. A versão vem do servidor, não do cliente ────────────────────────────

test("MUT-CM-03: persistir a versão RECEBIDA do cliente é DETECTADO", () => {
  mutar(
    CASOS,
    `    termsVersion: versao.value,`,
    `    termsVersion: input.termsVersion,`,
    /versão do cliente é persistida sem comparação|startTrial persiste a versão recebida/
  );
});

test("MUT-CM-03b: remover a comparação com a versão vigente é DETECTADO", () => {
  mutar(
    CASOS,
    `    return ok(exigirVersaoVigente(recebida));`,
    `    return ok(recebida.trim());`,
    /caso de uso não compara a versão recebida/
  );
});

test("MUT-CM-03c: a recusa passar a revelar a versão vigente é DETECTADO", () => {
  mutar(
    "src/lib/billing/terms.ts",
    `    super("a versão dos termos aceita não é a vigente");`,
    `    super(\`a versão aceita não é \${TERMS_VERSION}\`);`,
    /mensagem de recusa entrega a versão vigente/
  );
});

// ── 3. A auditoria ──────────────────────────────────────────────────────────

test("MUT-CM-04: retirar a auditoria do novo aceite é DETECTADO", () => {
  mutar(
    MIGRATION,
    `  PERFORM billing.fn_audit(
    p_organization_id, v_id, 'terms_acceptance', p_actor_id, 'owner',
    p_accepted_at,`,
    `  PERFORM billing.fn_audit(
    p_organization_id, v_id, 'subscription_state', p_actor_id, 'owner',
    p_accepted_at,`,
    /novo aceite não é auditado/
  );
});

test("MUT-CM-05: auditar FORA da transação (engolindo a exceção) é DETECTADO", () => {
  // Um `EXCEPTION WHEN OTHERS` em volta da auditoria a tira efetivamente da
  // transação do efeito: a falha deixa de desfazer, e sobra trial sem prova.
  mutar(
    MIGRATION,
    `  PERFORM billing.fn_audit(
    p_organization_id, v_id, 'terms_acceptance', p_actor_id, 'owner',
    p_terms_accepted_at, NULL,`,
    `  BEGIN
    PERFORM billing.fn_audit(
      p_organization_id, v_id, 'terms_acceptance', p_actor_id, 'owner',
      p_terms_accepted_at, NULL,
      jsonb_build_object('termsVersion', v_versao),
      'aceite', NULL, p_correlation_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM billing.fn_audit(
    p_organization_id, v_id, 'subscription_state', p_actor_id, 'owner',
    p_terms_accepted_at, NULL,`,
    /engole exceção/
  );
});

test("MUT-CM-05b: auditar o aceite ANTES de gravar a assinatura é DETECTADO", () => {
  mutar(
    MIGRATION,
    `  INSERT INTO billing.subscriptions (
    organization_id, plan, tier, period, state, worker_count, cnpj,`,
    `  PERFORM billing.fn_audit(
    p_organization_id, NULL, 'terms_acceptance', p_actor_id, 'owner',
    p_terms_accepted_at, NULL,
    jsonb_build_object('termsVersion', v_versao),
    'aceite antecipado', NULL, p_correlation_id);

  INSERT INTO billing.subscriptions (
    organization_id, plan, tier, period, state, worker_count, cnpj,`,
    /aceite é auditado ANTES de a assinatura ser gravada/
  );
});

// ── 4. Autorização e isolamento ─────────────────────────────────────────────

test("MUT-CM-06: aceitar membro não-owner na troca de contato é DETECTADO", () => {
  mutar(
    MIGRATION,
    `  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, true);

  IF p_now IS NULL THEN`,
    `  PERFORM billing.fn_require_member(p_actor_id, p_organization_id, false);

  IF p_now IS NULL THEN`,
    /update_billing_email não exige owner/
  );
});

test("MUT-CM-07: remover o filtro por organização é DETECTADO", () => {
  mutar(
    MIGRATION,
    `  SELECT s.id, s.billing_email INTO v_id, v_antes
    FROM billing.subscriptions s
   WHERE s.organization_id = p_organization_id
   FOR UPDATE;`,
    `  SELECT s.id, s.billing_email INTO v_id, v_antes
    FROM billing.subscriptions s
   FOR UPDATE;`,
    /update_billing_email não filtra a assinatura pela organização/
  );
});

// ── 5. Vazamento do endereço ────────────────────────────────────────────────

test("MUT-CM-08: gravar o endereço CRU na trilha é DETECTADO", () => {
  mutar(
    MIGRATION,
    `    jsonb_build_object('mask', billing.fn_mask_email(v_novo)),`,
    `    jsonb_build_object('email', v_novo),`,
    /o valor novo vai cru para a trilha|trilha guarda o endereço sob a chave 'email'/
  );
});

test("MUT-CM-08b: interpolar o endereço na mensagem do repositório é DETECTADO", () => {
  mutar(
    REPO_REAL,
    `      "contato financeiro"`,
    "      `contato financeiro ${billingEmail}`",
    /endereço é interpolado numa mensagem/
  );
});

// ── 6. A troca de assinatura ────────────────────────────────────────────────

test("MUT-CM-09: manter a assinatura antiga como sobrecarga é DETECTADO", () => {
  mutar(
    MIGRATION,
    `DROP FUNCTION IF EXISTS public.fn_billing_start_trial(
  uuid, uuid, text, text, text, integer, text,
  timestamptz, timestamptz, timestamptz, integer, text, text
);`,
    `-- (sobrecarga deliberada, para a mutação)`,
    /assinatura antiga de start_trial não é removida pela assinatura exata/
  );
});

test("MUT-CM-09b: remover a pós-condição de UMA versão instalada é DETECTADO", () => {
  mutar(
    MIGRATION,
    `  IF v_int <> 1 THEN
    RAISE EXCEPTION
      '12C.1: fn_billing_start_trial tem % versoes em public, deveria ter 1', v_int;`,
    `  IF v_int < 1 THEN
    RAISE EXCEPTION
      '12C.1: fn_billing_start_trial tem % versoes em public, deveria ter 1', v_int;`,
    /não exige exatamente uma versão de start_trial/
  );
});

// ── 7. Privilégios ──────────────────────────────────────────────────────────

test("MUT-CM-10: conceder EXECUTE a authenticated é DETECTADO", () => {
  mutar(
    MIGRATION,
    `    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);`,
    `    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);`,
    /não revoga EXECUTE de authenticated|concede privilégio a papel do PostgREST/
  );
});

test("MUT-CM-11: conceder EXECUTE a PUBLIC é DETECTADO", () => {
  mutar(
    MIGRATION,
    `    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);
    v_int := v_int + 1;`,
    `    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.assinatura);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.assinatura);
    v_int := v_int + 1;`,
    /não revoga EXECUTE de PUBLIC|concede privilégio a papel do PostgREST/
  );
});

test("MUT-CM-11b: afrouxar a contagem de 18 para 16 é DETECTADO", () => {
  mutar(
    MIGRATION,
    `  IF v_int <> 18 THEN
    RAISE EXCEPTION 'esperadas 18 RPCs de billing em public, encontradas %', v_int;`,
    `  IF v_int <> 16 THEN
    RAISE EXCEPTION 'esperadas 16 RPCs de billing em public, encontradas %', v_int;`,
    /não exige exatamente 18 RPCs após conceder/
  );
});

test("MUT-CM-12: retirar o search_path de uma RPC nova é DETECTADO", () => {
  mutar(
    MIGRATION,
    `CREATE OR REPLACE FUNCTION public.fn_billing_accept_terms(
  p_actor_id uuid,
  p_organization_id uuid,
  p_terms_version text,
  p_accepted_at timestamptz,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''`,
    `CREATE OR REPLACE FUNCTION public.fn_billing_accept_terms(
  p_actor_id uuid,
  p_organization_id uuid,
  p_terms_version text,
  p_accepted_at timestamptz,
  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER`,
    /fn_billing_accept_terms ausente, ou sem SECURITY DEFINER\/search_path vazio/
  );
});

// ── 8. O repositório ────────────────────────────────────────────────────────

test("MUT-CM-13: acessar tabela diretamente no repositório é DETECTADO", () => {
  mutar(
    REPO_REAL,
    `  async acceptTerms(`,
    `  async lerAssinaturaDireto(org: string) {
    return this.#db.from("subscriptions").select("*").eq("organization_id", org);
  }

  async acceptTerms(`,
    /passou a acessar tabela diretamente/
  );
});

test("MUT-CM-13b: endereçar o schema billing pelo supabase-js é DETECTADO", () => {
  mutar(
    REPO_REAL,
    `  async acceptTerms(`,
    `  async lerPeloSchema(org: string) {
    return this.#db.schema("billing").rpc("fn_billing_read_state", { org });
  }

  async acceptTerms(`,
    /voltou a endereçar o schema billing/
  );
});

test("MUT-CM-13c: declarar RPC na união e nunca chamá-la é DETECTADO", () => {
  mutar(
    REPO_REAL,
    `  | "fn_billing_accept_terms";`,
    `  | "fn_billing_accept_terms"
  | "fn_billing_reset_everything";`,
    /união NomeDeRpc divergiu da allowlist/
  );
});

test("MUT-CM-13d: o dublê deixar de proibir regressão de versão é DETECTADO", () => {
  mutar(
    REPO_MEM,
    `    if (antes.termsVersion !== null && versao < antes.termsVersion) {`,
    `    if (false && antes.termsVersion !== null) {`,
    /dublê não proíbe regredir de versão/
  );
});

// ── 9. A allowlist e o catálogo independente ───────────────────────────────

test("MUT-CM-14: tirar uma RPC nova da allowlist é DETECTADO", () => {
  mutar(
    ALLOWLIST,
    `  "fn_billing_update_billing_email(uuid, uuid, text, timestamp with time zone, text)",\n`,
    "",
    /a allowlist tem 17 assinaturas|fn_billing_update_billing_email fora da allowlist/
  );
});

test("MUT-CM-14b: declarar a assinatura ANTIGA de start_trial na allowlist é DETECTADO", () => {
  mutar(
    ALLOWLIST,
    `  "fn_billing_transition_state(uuid, uuid, text, text, text, text, timestamp with time zone)",`,
    `  "fn_billing_start_trial(uuid, uuid, text, text, text, integer, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, integer, text, text)",
  "fn_billing_transition_state(uuid, uuid, text, text, text, text, timestamp with time zone)",`,
    /a allowlist tem 19 assinaturas|assinatura antiga de start_trial ainda consta/
  );
});

test("MUT-CM-14c: o catálogo independente divergir da allowlist é DETECTADO", () => {
  mutar(
    "scripts/ci/assert-billing-rpcs.sql",
    `      'public.fn_billing_accept_terms(uuid, uuid, text, timestamp with time zone, text)|jsonb|v'`,
    `      'public.fn_billing_accept_terms(uuid, uuid, text, timestamp with time zone)|jsonb|v'`,
    /listas independentes divergiram/
  );
});

// ── 10. O rollback ──────────────────────────────────────────────────────────

test("MUT-CM-15: permitir rollback destrutivo com dado contratual é DETECTADO", () => {
  mutar(
    ROLLBACK,
    `  IF v_subs > 0 OR v_trilha > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK 20260810120000 ABORTADO: existe dado contratual que seria destruido'`,
    `  IF false THEN
    RAISE EXCEPTION
      'ROLLBACK 20260810120000 avisado: existe dado contratual que seria destruido'`,
    /barreira contra destruição de dado contratual|barreira não aborta/
  );
});

test("MUT-CM-15b: barreira que ignora a trilha de aceite é DETECTADA", () => {
  mutar(
    ROLLBACK,
    `   WHERE ae.subject::text IN ('terms_acceptance', 'billing_email');`,
    `   WHERE ae.subject::text IN ('worker_count');`,
    /barreira não olha a trilha de aceite/
  );
});

test("MUT-CM-15c: rollback que remove RPC alheia é DETECTADO", () => {
  mutar(
    ROLLBACK,
    `DROP FUNCTION IF EXISTS public.fn_billing_accept_terms(
  uuid, uuid, text, timestamptz, text
);`,
    `DROP FUNCTION IF EXISTS public.fn_billing_accept_terms(
  uuid, uuid, text, timestamptz, text
);
DROP FUNCTION IF EXISTS public.fn_billing_read_state(uuid, uuid);`,
    /rollback remove fn_billing_read_state/
  );
});

test("MUT-CM-15d: rollback que não restaura a assinatura anterior é DETECTADO", () => {
  mutar(
    ROLLBACK,
    `  p_correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id uuid;`,
    `  p_correlation_id text,
  p_billing_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_id uuid;`,
    /assinatura restaurada ainda tem p_billing_email/
  );
});

// ── 11. A rota de aplicação ─────────────────────────────────────────────────

test("MUT-CM-16: esquecer a migration na rota é DETECTADO", () => {
  mutar(
    ROTA,
    `          - 20260810120000_billing_contract_metadata.sql\n`,
    "",
    /não é opção do workflow_dispatch/
  );
});

test("MUT-CM-16b: o CI rodar o verificador só UMA vez é DETECTADO", () => {
  mutar(
    ".github/workflows/ci.yml",
    `          "$PGBIN/psql" "$DB_URL" -v ON_ERROR_STOP=1 \\
            -f scripts/ci/verify-applied/20260810120000.sql\n`,
    "",
    /roda o verificador da 12C\.1 1 vez\(es\)/
  );
});

test("MUT-CM-16c: reverter a 12B antes da 12C.1 é DETECTADO", () => {
  mutar(
    ".github/workflows/ci.yml",
    `          P -f supabase/rollbacks/20260810120000_billing_contract_metadata_rollback.sql
          P -f supabase/rollbacks/20260802093000_billing_orchestration_rollback.sql`,
    `          P -f supabase/rollbacks/20260802093000_billing_orchestration_rollback.sql
          P -f supabase/rollbacks/20260810120000_billing_contract_metadata_rollback.sql`,
    /rollback da 12C\.1 não roda antes do da 12B/
  );
});

// ── 12. As 40 anteriores ────────────────────────────────────────────────────

test("MUT-CM-17: alterar uma das 40 migrations anteriores é DETECTADO", () => {
  // Um comentário a mais. Inofensivo em aparência, e é justamente o ponto:
  // forward-only significa que nem isso pode mudar, porque o arquivo já foi
  // aplicado em produção e o hash do manifesto deixaria de bater.
  mutar(
    "supabase/migrations/20260802093000_billing_orchestration.sql",
    `-- ETAPA 12B — ORQUESTRAÇÃO TRANSACIONAL DE BILLING`,
    `-- ETAPA 12B — ORQUESTRAÇÃO TRANSACIONAL DE BILLING (revisado)`,
    /alguma das 40 migrations anteriores mudou/
  );
});

test("MUT-CM-17b: alterar uma das 36 históricas é DETECTADO", () => {
  const dir = path.join(copia, "supabase/migrations");
  const historica = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f < "20260730000000")
    .sort()[0];
  assert.ok(historica, "nenhuma migration histórica na cópia");
  const rel = `supabase/migrations/${historica}`;
  const original = lerCopia(rel);
  escreverCopia(rel, `${original}\n-- alteração indevida\n`);
  try {
    const r = guarda();
    assert.equal(r.code, 1, `alterar ${historica} passou:\n${r.out}`);
    assert.match(r.out, /alguma das 40 migrations anteriores mudou/);
  } finally {
    escreverCopia(rel, original);
  }
});

test("MUT-CM-17c: acrescentar uma migration a mais é DETECTADO", () => {
  criar(
    "supabase/migrations/20260811120000_extra.sql",
    "-- migration não declarada\nSELECT 1;\n",
    /esperadas 41 migrations|a 12C\.1 não é a última/
  );
});

// ── 13. O verificador e a integração ───────────────────────────────────────

test("MUT-CM-18: o verificador deixar de ser somente leitura é DETECTADO", () => {
  mutar(
    VERIFICADOR,
    `BEGIN TRANSACTION READ ONLY;`,
    `BEGIN;`,
    /transação não é READ ONLY/
  );
});

test("MUT-CM-18b: o verificador parar de exigir o conjunto de 18 é DETECTADO", () => {
  mutar(
    VERIFICADOR,
    `  IF array_length(v_esperadas, 1) <> 18 THEN`,
    `  IF array_length(v_esperadas, 1) < 1 THEN`,
    /não exige que a própria lista tenha 18 entradas/
  );
});

test("MUT-CM-19: a integração parar de forçar a falha da auditoria é DETECTADA", () => {
  mutar(
    "scripts/ci/assert-billing-orchestration.sql",
    `    ADD CONSTRAINT tmp_falha_auditoria
    CHECK (subject <> 'terms_acceptance'::billing.audit_subject) NOT VALID;`,
    `    ADD CONSTRAINT tmp_inofensiva
    CHECK (true) NOT VALID;`,
    /não força a auditoria a falhar/
  );
});

test("MUT-CM-19b: a integração parar de exigir que a falha desfaça tudo é DETECTADA", () => {
  mutar(
    "scripts/ci/assert-billing-orchestration.sql",
    `      'ASSERÇÃO REPROVADA: auditoria falhou e a assinatura ficou gravada (%)', v_int;`,
    `      'ASSERÇÃO informativa: auditoria falhou (%)', v_int;`,
    /não exige que a falha da auditoria desfaça tudo/
  );
});

// ── 14. Tabela nova e conteúdo dos termos ──────────────────────────────────

test("MUT-CM-20: criar tabela para o aceite é DETECTADO", () => {
  mutar(
    MIGRATION,
    `COMMENT ON COLUMN billing.subscriptions.billing_email IS`,
    `CREATE TABLE IF NOT EXISTS billing.terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
);

COMMENT ON COLUMN billing.subscriptions.billing_email IS`,
    /a migration cria tabela — audit_events já comporta a prova do aceite/
  );
});

test("MUT-CM-21: guardar o CONTEÚDO dos termos no banco é DETECTADO", () => {
  mutar(
    MIGRATION,
    `  ADD COLUMN IF NOT EXISTS terms_version     text NULL,`,
    `  ADD COLUMN IF NOT EXISTS terms_version     text NULL,
  ADD COLUMN IF NOT EXISTS terms_text        text NULL,`,
    /guarda o conteúdo dos termos em terms_text/
  );
});

// ── 15. A documentação ──────────────────────────────────────────────────────

test("MUT-CM-22: documentação que afirma outro estado de produção é DETECTADA", () => {
  const rel = "docs/decisions/METADADOS-CONTRATUAIS-BILLING-12C1.md";
  const original = lerCopia(rel);
  // TODAS as ocorrências: o estado aparece no cabeçalho e na tabela do §7, e
  // trocar uma só deixava a outra provando a propriedade sozinha.
  escreverCopia(rel, original.split("40/40").join("41/41"));
  try {
    const r = guarda();
    assert.equal(r.code, 1, `documentação com estado errado passou:\n${r.out}`);
    assert.match(r.out, /não registra que produção está em 40\/40/);
  } finally {
    escreverCopia(rel, original);
  }
});

test("MUT-CM-22b: documentação que omite a pendência da migration é DETECTADA", () => {
  const rel = "docs/decisions/METADADOS-CONTRATUAIS-BILLING-12C1.md";
  const original = lerCopia(rel);
  escreverCopia(
    rel,
    original.replace(/pendente/gi, "aplicada").replace(/Pendente/g, "Aplicada")
  );
  try {
    const r = guarda();
    assert.equal(r.code, 1, `documentação sem pendência passou:\n${r.out}`);
    assert.match(r.out, /não registra que a nova migration fica pendente/);
  } finally {
    escreverCopia(rel, original);
  }
});

// ── Limpeza ─────────────────────────────────────────────────────────────────

fs.rmSync(copia, { recursive: true, force: true });

console.log(
  `\nBilling contract metadata mutation guard: ${passed} passed, ${failed} failed`
);
process.exit(failed === 0 ? 0 : 1);
