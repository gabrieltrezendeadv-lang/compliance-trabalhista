/**
 * TESTES DE MUTAÇÃO DA FUNDAÇÃO DE BILLING
 *
 * Uma guarda que nunca reprova é indistinguível de guarda ausente. Este arquivo
 * responde à única pergunta que importa sobre as guardas da Etapa 12A: **elas
 * reprovam quando a propriedade que protegem é removida?**
 *
 * ── COMO FUNCIONA ───────────────────────────────────────────────────────────
 *
 * O repositório é copiado para um diretório temporário. Cada mutação é aplicada
 * ao ARQUIVO REAL dentro da cópia, a guarda REAL é executada lá dentro, e o
 * teste exige que ela saia com código diferente de zero e acuse o motivo certo.
 * Ao final, o arquivo é restaurado na cópia e a próxima mutação é aplicada.
 *
 * Nada é escrito no repositório de trabalho. A cópia é removida ao final.
 *
 * ── O CONTROLE VEM PRIMEIRO ─────────────────────────────────────────────────
 *
 * MUT-00 roda as guardas na cópia SEM mutação e exige que passem. Sem esse
 * controle, todo o resto seria inútil: uma cópia quebrada faria todas as
 * mutações "serem detectadas" por um motivo que não tem nada a ver com elas.
 *
 * ── LIMITE DECLARADO ────────────────────────────────────────────────────────
 *
 * As mutações exercitam as guardas ESTÁTICAS (`.mjs`), que rodam sem
 * dependências. A suíte Vitest não é executada aqui — instalar node_modules na
 * cópia custaria mais do que este arquivo vale. Por isso cada mutação da lista
 * obrigatória tem uma guarda estática correspondente: nenhuma delas depende
 * exclusivamente de um teste que este harness não consegue rodar.
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

// ─── Cópia de trabalho ──────────────────────────────────────────────────────

const COPIAR = [
  "tests",
  "src",
  "supabase",
  "scripts",
  ".github",
  "docs",
  "package.json",
  ".env.example",
];

const copia = fs.mkdtempSync(path.join(os.tmpdir(), "billing-mut-"));

for (const item of COPIAR) {
  const origem = path.join(raiz, item);
  if (!fs.existsSync(origem)) continue;
  fs.cpSync(origem, path.join(copia, item), { recursive: true });
}

/** Executa uma guarda dentro da cópia. Devolve {code, out}. */
function guarda(arquivo, args = []) {
  try {
    const out = execFileSync("node", [arquivo, ...args], {
      cwd: copia,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

// Fim de linha normalizado na leitura: num checkout Windows os arquivos podem
// estar em CRLF, e os literais das mutações abaixo são escritos com `\n`. Sem
// isto, toda mutação "casaria 0 vezes" — e o harness reprovaria por motivo
// errado, num sistema operacional e não no outro.
const ler = (rel) =>
  fs.readFileSync(path.join(copia, rel), "utf8").replace(/\r\n?/g, "\n");
const escrever = (rel, texto) => fs.writeFileSync(path.join(copia, rel), texto, "utf8");

/**
 * Aplica uma mutação, roda a guarda e restaura o arquivo.
 *
 * `de` precisa casar EXATAMENTE uma vez. Zero ocorrências significa que o
 * código mudou e a mutação deixou de descrever um defeito real — o teste
 * reprova em vez de passar em silêncio, que é o modo como um harness de
 * mutação apodrece sem ninguém notar.
 */
function mutar(rel, de, para, arquivoDaGuarda, args = []) {
  const original = ler(rel);
  const ocorrencias = original.split(de).length - 1;
  assert.equal(
    ocorrencias,
    1,
    `a mutação em ${rel} casou ${ocorrencias} vez(es), esperado exatamente 1 — ` +
      `o trecho mudou e a mutação precisa ser reescrita`
  );

  escrever(rel, original.replace(de, () => para));
  try {
    return guarda(arquivoDaGuarda, args);
  } finally {
    escrever(rel, original);
  }
}

const FOUNDATION = "tests/billing-foundation-guard.mjs";
const FREEZE = "tests/migration-freeze-guard.mjs";
const RECOVER = "tests/verify-recovered-migrations.mjs";

// ─── MUT-00: controle ───────────────────────────────────────────────────────

test("MUT-00: sem mutação, as guardas PASSAM na cópia", () => {
  const r = guarda(FOUNDATION);
  assert.equal(r.code, 0, `a guarda deveria passar sem mutação:\n${r.out}`);
  assert.match(r.out, /0 failed/);

  const f = guarda(FREEZE);
  assert.equal(f.code, 0, `a guarda de congelamento deveria passar:\n${f.out}`);

  // Com o argumento obrigatório: sem ele o script sai com 2, e toda mutação
  // "seria detectada" pelo motivo errado — foi essa a falha da estreia da rota
  // de aplicação (AP-22).
  const v = guarda(RECOVER, ["supabase/migrations"]);
  assert.equal(v.code, 0, `a verificação de hashes deveria passar:\n${v.out}`);
});

// ─── Fail-open ──────────────────────────────────────────────────────────────

test("MUT-01: reintroduzir o fail-open no guard é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/guard.ts",
    "  if (error) return { ok: false, reason: \"verification_failed\" };\n  if (!membership) return { ok: false, reason: \"no_organization\" };",
    "  if (error) { return { allowed: true, reason: \"ok\" }; }\n  if (!membership) return { ok: false, reason: \"no_organization\" };",
    FOUNDATION
  );
  assert.equal(r.code, 1, `o fail-open passou despercebido:\n${r.out}`);
  assert.match(r.out, /BF-16/);
  assert.match(r.out, /fail-open/i);
});

test("MUT-02: permitir por captura de exceção é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/guard.ts",
    "function negar(reason: EntitlementDenialReason): EntitlementDecision {\n  return { allowed: false, reason, message: MENSAGENS[reason] };\n}",
    "function negar(reason: EntitlementDenialReason): EntitlementDecision {\n  try {\n    return { allowed: false, reason, message: MENSAGENS[reason] };\n  } catch { return { allowed: true, reason: \"ok\" }; }\n}",
    FOUNDATION
  );
  assert.equal(r.code, 1, `o fail-open por catch passou:\n${r.out}`);
  assert.match(r.out, /BF-16/);
});

test("MUT-03: chamar de novo a RPC revogada é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/guard.ts",
    "  if (error) return { ok: false, reason: \"verification_failed\" };\n  if (!membership) return { ok: false, reason: \"no_organization\" };",
    "  await supabase.rpc(\"check_plan_limit\", {});\n  if (error) return { ok: false, reason: \"verification_failed\" };\n  if (!membership) return { ok: false, reason: \"no_organization\" };",
    FOUNDATION
  );
  assert.equal(r.code, 1, `a ressurreição de check_plan_limit passou:\n${r.out}`);
  assert.match(r.out, /BF-16/);
});

// ─── Autorização ────────────────────────────────────────────────────────────

test("MUT-04: remover a verificação de owner é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/authorization.ts",
    '  if (membership.role !== "owner") return negar("not_owner");',
    "  // verificação removida",
    FOUNDATION
  );
  assert.equal(r.code, 1, `a remoção da verificação de owner passou:\n${r.out}`);
  assert.match(r.out, /BF-18/);
});

test("MUT-05: confiar só no filtro do banco é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/authorization.ts",
    '    .eq("role", "owner")\n',
    "",
    FOUNDATION
  );
  assert.equal(r.code, 1, `a remoção do filtro de papel passou:\n${r.out}`);
  assert.match(r.out, /BF-18/);
});

// ─── Gate somente no cliente ────────────────────────────────────────────────

test("MUT-06: tirar a asserção de segurança do CI é DETECTADO", () => {
  // "Gate somente no cliente" é o que sobra quando a verificação server-side
  // deixa de ser executada: a interface continua bonita e nada mais protege.
  const r = mutar(
    ".github/workflows/ci.yml",
    "      - name: Segurança e imutabilidade do schema billing\n        run: '\"$PGBIN/psql\" \"$DB_URL\" -v ON_ERROR_STOP=1 -f scripts/ci/assert-billing-security.sql'",
    "      # passo removido",
    FOUNDATION
  );
  assert.equal(r.code, 1, `a remoção do gate server-side passou:\n${r.out}`);
  assert.match(r.out, /BF-13/);
});

test("MUT-07: esvaziar o teste comportamental de imutabilidade é DETECTADO", () => {
  const r = mutar(
    "scripts/ci/assert-billing-security.sql",
    "    UPDATE billing.price_snapshots SET amount_cents = 1 WHERE id = v_snap;",
    "    PERFORM 1;",
    FOUNDATION
  );
  assert.equal(r.code, 1, `o esvaziamento do teste comportamental passou:\n${r.out}`);
  assert.match(r.out, /BF-13/);
});

// ─── Faixas ─────────────────────────────────────────────────────────────────

test("MUT-08: errar a borda 20/21 é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/plans/catalog.ts",
    '{ slug: "t1_20", minWorkers: 1, maxWorkers: 20, requiresQuote: false }',
    '{ slug: "t1_20", minWorkers: 1, maxWorkers: 21, requiresQuote: false }',
    FOUNDATION
  );
  assert.equal(r.code, 1, `a borda errada passou:\n${r.out}`);
  assert.match(r.out, /BF-24/);
});

test("MUT-09: errar a borda 50/51 é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/plans/catalog.ts",
    '{ slug: "t21_50", minWorkers: 21, maxWorkers: 50, requiresQuote: false }',
    '{ slug: "t21_50", minWorkers: 21, maxWorkers: 51, requiresQuote: false }',
    FOUNDATION
  );
  assert.equal(r.code, 1, `a borda errada passou:\n${r.out}`);
  assert.match(r.out, /BF-24/);
});

// ─── Preço ──────────────────────────────────────────────────────────────────

test("MUT-10: preço anual calculado incorretamente é DETECTADO", () => {
  // 9990 × 12 sem desconto = 119880. O erro clássico: esquecer o desconto.
  const r = mutar(
    "src/lib/billing/plans/catalog.ts",
    'tier: "t1_20", monthlyCents: 9_990, yearlyCents: 107_892',
    'tier: "t1_20", monthlyCents: 9_990, yearlyCents: 119_880',
    FOUNDATION
  );
  assert.equal(r.code, 1, `o anual errado passou:\n${r.out}`);
  assert.match(r.out, /BF-12/);
});

test("MUT-11: divergência entre catálogo e seed da migration é DETECTADA", () => {
  // A migration cobra um valor e o aplicativo mostra outro. Nenhuma das duas
  // cópias, sozinha, enxerga isso.
  const r = mutar(
    "supabase/migrations/20260801120000_billing_foundation.sql",
    "('2026-07-30.1', 'completo',  't21_50',     39990, 431892, '2026-07-30T00:00:00Z')",
    "('2026-07-30.1', 'completo',  't21_50',     38990, 431892, '2026-07-30T00:00:00Z')",
    FOUNDATION
  );
  assert.equal(r.code, 1, `a divergência entre catálogo e seed passou:\n${r.out}`);
  assert.match(r.out, /BF-12/);
});

test("MUT-12: usar ponto flutuante em preço é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/plans/catalog.ts",
    'tier: "t51_100", monthlyCents: 34_990, yearlyCents: 377_892',
    'tier: "t51_100", monthlyCents: 349.90, yearlyCents: 3778.92',
    FOUNDATION
  );
  assert.equal(r.code, 1, `o ponto flutuante passou:\n${r.out}`);
  assert.match(r.out, /BF-12|BF-25/);
});

test("MUT-13: arredondar preço com toFixed é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/plans/pricing.ts",
    "  return assertIntegerCents(\n    bruto / YEARLY_DISCOUNT_DENOMINATOR,\n    `preço anual ${plan}/${tier}`\n  );",
    "  return Number((bruto / YEARLY_DISCOUNT_DENOMINATOR).toFixed(0));",
    FOUNDATION
  );
  assert.equal(r.code, 1, `o arredondamento por toFixed passou:\n${r.out}`);
  assert.match(r.out, /BF-25/);
});

// ─── Grandfathering ─────────────────────────────────────────────────────────

test("MUT-14: vincular o direito adquirido ao usuário é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/plans/eligibility.ts",
    "  return record !== null && record.organizationId === organizationId;",
    "  return record !== null && userId !== undefined;",
    FOUNDATION
  );
  assert.equal(r.code, 1, `o vínculo por usuário passou:\n${r.out}`);
  assert.match(r.out, /BF-22/);
});

// ─── Imutabilidade do preço contratado ──────────────────────────────────────

test("MUT-15: remover a trigger de imutabilidade do snapshot é DETECTADO", () => {
  const r = mutar(
    "supabase/migrations/20260801120000_billing_foundation.sql",
    "CREATE TRIGGER tg_price_snapshot_immutable\n  BEFORE UPDATE OR DELETE ON billing.price_snapshots\n  FOR EACH ROW EXECUTE FUNCTION billing.fn_reject_mutation();",
    "-- trigger removida",
    FOUNDATION
  );
  assert.equal(r.code, 1, `a remoção da imutabilidade passou:\n${r.out}`);
  assert.match(r.out, /BF-23/);
});

test("MUT-16: deixar de congelar o snapshot em memória é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/plans/pricing.ts",
    "  return Object.freeze({",
    "  return ({",
    FOUNDATION
  );
  assert.equal(r.code, 1, `o snapshot mutável passou:\n${r.out}`);
  assert.match(r.out, /BF-23/);
});

// ─── Feature flag ───────────────────────────────────────────────────────────

test("MUT-17: ligar billing por AUSÊNCIA de variável é DETECTADO", () => {
  // A forma perigosa: quem esquecer de configurar LIGA a cobrança.
  const r = mutar(
    "src/lib/billing/flag.ts",
    "  return process.env[BILLING_FLAG_ENV] === BILLING_FLAG_ON;",
    '  return process.env.BILLING_DISABLED !== "true";',
    FOUNDATION
  );
  assert.equal(r.code, 1, `a ativação por ausência passou:\n${r.out}`);
  assert.match(r.out, /BF-15/);
});

test("MUT-18: negar 'false' em vez de exigir 'true' é DETECTADO", () => {
  const r = mutar(
    "src/lib/billing/flag.ts",
    "  return process.env[BILLING_FLAG_ENV] === BILLING_FLAG_ON;",
    '  return process.env[BILLING_FLAG_ENV] !== "false";',
    FOUNDATION
  );
  assert.equal(r.code, 1, `a comparação invertida passou:\n${r.out}`);
  assert.match(r.out, /BF-15/);
});

// ─── Privilégios e RLS ──────────────────────────────────────────────────────

test("MUT-19: conceder privilégio a authenticated é DETECTADO", () => {
  const r = mutar(
    "supabase/migrations/20260801120000_billing_foundation.sql",
    "      EXECUTE format('GRANT SELECT ON TABLE billing.%I TO service_role', t);",
    "      EXECUTE format('GRANT SELECT ON TABLE billing.%I TO authenticated', t);",
    FOUNDATION
  );
  assert.equal(r.code, 1, `a concessão a authenticated passou:\n${r.out}`);
  assert.match(r.out, /BF-04/);
});

test("MUT-20: conceder DELETE é DETECTADO", () => {
  const r = mutar(
    "supabase/migrations/20260801120000_billing_foundation.sql",
    "      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE billing.%I TO service_role', t);",
    "      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE billing.%I TO service_role', t);",
    FOUNDATION
  );
  assert.equal(r.code, 1, `a concessão de DELETE passou:\n${r.out}`);
  assert.match(r.out, /BF-04/);
});

test("MUT-21: abrir uma policy na fundação é DETECTADO", () => {
  const r = mutar(
    "supabase/migrations/20260801120000_billing_foundation.sql",
    "CREATE INDEX IF NOT EXISTS audit_events_organization_idx",
    "CREATE POLICY p_leitura ON billing.audit_events FOR SELECT USING (true);\n\nCREATE INDEX IF NOT EXISTS audit_events_organization_idx",
    FOUNDATION
  );
  assert.equal(r.code, 1, `a policy aberta passou:\n${r.out}`);
  assert.match(r.out, /BF-03/);
});

test("MUT-22: criar objeto da fundação em public é DETECTADO", () => {
  const r = mutar(
    "supabase/migrations/20260801120000_billing_foundation.sql",
    "CREATE TABLE IF NOT EXISTS billing.courtesies (",
    "CREATE TABLE IF NOT EXISTS public.courtesies (\n  id uuid PRIMARY KEY\n);\n\nCREATE TABLE IF NOT EXISTS billing.courtesies (",
    FOUNDATION
  );
  assert.equal(r.code, 1, `o objeto em public passou:\n${r.out}`);
  assert.match(r.out, /BF-02/);
});

// ─── Rota de aplicação ──────────────────────────────────────────────────────

test("MUT-23: tirar a migration da lista fechada da rota é DETECTADO", () => {
  const r = mutar(
    ".github/workflows/migration-apply.yml",
    "          - 20260801120000_billing_foundation.sql\n",
    "",
    FOUNDATION
  );
  assert.equal(r.code, 1, `a lista divergente passou:\n${r.out}`);
  assert.match(r.out, /BF-10/);
});

// ─── Congelamento histórico ─────────────────────────────────────────────────

test("MUT-24: alterar uma migration HISTÓRICA é DETECTADO", () => {
  // As 36 são congeladas e conferidas por md5_norm contra o manifesto. Esta é
  // a propriedade mais cara de recuperar se for perdida — as Fases 3 a 6
  // existiram para reconstruí-la.
  //
  // A mutação é um ACRÉSCIMO no fim do arquivo, e não uma substituição: o
  // objetivo é provar que qualquer alteração é vista, mesmo a mais inócua
  // possível. Se a normalização de md5_norm engolisse isto, o congelamento
  // não estaria protegendo nada.
  const alvo = "supabase/migrations/20260724013538_foundation.sql";
  const original = ler(alvo);
  escrever(alvo, `${original}\nSELECT 1;\n`);

  let r;
  try {
    r = guarda(RECOVER, ["supabase/migrations"]);
  } finally {
    escrever(alvo, original);
  }

  assert.notEqual(r.code, 0, `a alteração da histórica passou:\n${r.out}`);
  assert.match(r.out, /md5|divergente|REPROVAD/i);
});

test("MUT-25: remover uma migration HISTÓRICA é DETECTADO", () => {
  const alvo = "supabase/migrations/20260724014530_onboarding_function.sql";
  const original = ler(alvo);
  fs.rmSync(path.join(copia, alvo));
  let r;
  try {
    r = guarda(FREEZE);
  } finally {
    escrever(alvo, original);
  }
  assert.equal(r.code, 1, `a remoção da histórica passou:\n${r.out}`);
  assert.match(r.out, /MF-0[89]|AUSENTE|conjunto histórico/i);
});

// ─── Limpeza ────────────────────────────────────────────────────────────────

fs.rmSync(copia, { recursive: true, force: true });

console.log("");
console.log(`Billing mutation guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
