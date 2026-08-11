/**
 * GUARDA DA SEPARAÇÃO NOMINAL NA EXTRAÇÃO DE SEGURANÇA
 *
 * `scripts/ci/split-security-nominal.mjs` retira da comparação bloqueante as 48
 * linhas das 16 RPCs da allowlist. É a única retirada que este repositório faz
 * numa categoria de segurança, e por isso ela é CONDICIONAL: só sai o que tiver
 * exatamente o perfil declarado.
 *
 * ── O QUE ESTE ARQUIVO PROVA ────────────────────────────────────────────────
 *
 * Cada mutação abaixo constrói uma extração de segurança SINTÉTICA — não um
 * banco — e exige que o script reprove. Nenhum banco é contatado.
 *
 * A extração sintética é derivada da própria allowlist, de modo que ela não pode
 * divergir do que o script espera por acidente de escrita: se a allowlist mudar,
 * a fixture muda junto.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RPCS_DE_BILLING } from "../scripts/ci/billing-rpc-allowlist.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(raiz, "scripts/ci/split-security-nominal.mjs");

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sec-nominal-"));

/** Assinatura como a extração de segurança a emite: `public.fn(a,b)`. */
function comoExtracao(assinatura) {
  return `public.${assinatura.replace(/,\s*/g, ",")}`;
}

/** Linha de categoria 5 — propriedades da função. */
function propriedade(assinatura, sobrepor = {}) {
  const c = {
    lang: "plpgsql",
    secdef: "t",
    volatile: "v",
    config: 'search_path=""',
    dono: "postgres",
    ...sobrepor,
  };
  return `5|funcao|${comoExtracao(assinatura)}|lang=${c.lang}|secdef=${c.secdef}` +
    `|volatile=${c.volatile}|config=${c.config}|dono=${c.dono}`;
}

/** Linha de categoria 6 — ACL da função. */
function acl(assinatura, grantee, privilegio = "EXECUTE") {
  return `6|funcao-acl|${comoExtracao(assinatura)}|${grantee}|${privilegio}`;
}

/** Umas poucas linhas não-nominais, para provar que passam incólumes. */
const RUIDO = Object.freeze([
  "3|tabela|organizations|rls=t|force=f|dono=postgres",
  "5|funcao|public.fn_resolve_tenant_id()|lang=plpgsql|secdef=t|volatile=s|config=search_path=public, pg_temp|dono=postgres",
  "6|funcao-acl|public.fn_resolve_tenant_id()|authenticated|EXECUTE",
  "7|policy|organizations|org_select|cmd=r|permissive=t|roles=authenticated|using=true|check=<NULO>",
]);

/**
 * Assinatura da allowlist pelo NOME.
 *
 * Era por ÍNDICE. A 12C.1 acrescentou `fn_billing_accept_terms`, que ordena antes
 * de tudo, e cada índice passou a apontar para outra função — as mutações
 * continuavam passando, mirando alvos diferentes dos que os nomes dos testes
 * anunciavam. Índice em lista ordenada não é identidade.
 */
function porNome(nome) {
  const a = RPCS_DE_BILLING.find((x) => x.startsWith(nome + "("));
  if (a === undefined) throw new Error("assinatura ausente na allowlist: " + nome);
  return a;
}

/** Quantas linhas a extração íntegra produz: propriedade + dois ACL por RPC. */
const LINHAS_NOMINAIS = RPCS_DE_BILLING.length * 3;

/** Extração completa e ÍNTEGRA de todas as da allowlist, mais ruído. */
function extracaoIntegra() {
  const linhas = [...RUIDO];
  for (const a of RPCS_DE_BILLING) {
    linhas.push(propriedade(a));
    linhas.push(acl(a, "postgres"));
    linhas.push(acl(a, "service_role"));
  }
  return linhas;
}

let n = 0;
/** Roda o script sobre as linhas dadas. Devolve exit code e saída. */
function rodar(linhas) {
  const dir = path.join(tmp, `caso-${n++}`);
  fs.mkdirSync(dir);
  const entrada = path.join(dir, "extracao.txt");
  const sem = path.join(dir, "sem.txt");
  const rpcs = path.join(dir, "rpcs.txt");
  fs.writeFileSync(entrada, linhas.join("\n") + "\n", "utf8");
  try {
    const out = execFileSync("node", [SCRIPT, entrada, sem, rpcs], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return {
      code: 0,
      out,
      sem: fs.readFileSync(sem, "utf8"),
      rpcs: fs.readFileSync(rpcs, "utf8"),
    };
  } catch (e) {
    return {
      code: e.status ?? 1,
      out: (e.stdout ?? "") + (e.stderr ?? ""),
      sem: fs.existsSync(sem) ? fs.readFileSync(sem, "utf8") : null,
      rpcs: null,
    };
  }
}

// ── Controle ────────────────────────────────────────────────────────────────

test(`SN-00: extração íntegra — ${LINHAS_NOMINAIS} linhas retiradas, ruído intacto`, () => {
  const r = rodar(extracaoIntegra());
  assert.equal(r.code, 0, r.out);
  assert.equal(
    r.rpcs.trim().split("\n").length,
    LINHAS_NOMINAIS,
    `não foram ${LINHAS_NOMINAIS} linhas nominais`
  );
  const restante = r.sem.trim().split("\n");
  assert.deepEqual(restante, [...RUIDO], "o ruído não passou incólume");
  assert.match(r.out, new RegExp(`assinaturas \\.+ ${RPCS_DE_BILLING.length}`));
});

test("SN-01: sem nenhuma nominal (a `main`), a extração sai inalterada", () => {
  const r = rodar([...RUIDO]);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.sem.trim(), RUIDO.join("\n"));
  assert.match(r.out, /nenhuma assinatura nominal presente/);
});

test("SN-02: nada é retirado quando o script reprova", () => {
  const linhas = extracaoIntegra();
  linhas.push(acl(porNome("fn_billing_apply_provider_event"), "anon"));
  const r = rodar(linhas);
  assert.equal(r.code, 1);
  assert.equal(r.sem, null, "escreveu a saída mesmo tendo reprovado");
  assert.match(r.out, /Nenhuma linha foi retirada/);
});

// ── MUTAÇÕES ────────────────────────────────────────────────────────────────

test("SN-M1: RPC EXTRA em public (nome fora da allowlist) NÃO é retirada", () => {
  const linhas = extracaoIntegra();
  const intrusa = "fn_billing_secret_backdoor(uuid)";
  linhas.push(propriedade(intrusa), acl(intrusa, "service_role"));
  const r = rodar(linhas);
  // Não reprova — não é sobrecarga — mas TEM de sobrar para a comparação, onde
  // aparece como divergência bloqueante.
  assert.equal(r.code, 0, r.out);
  assert.match(r.sem, /fn_billing_secret_backdoor/, "a RPC intrusa foi retirada da comparação");
  assert.doesNotMatch(r.rpcs, /fn_billing_secret_backdoor/);
});

test("SN-M2: RPC AUSENTE (presença parcial) é DETECTADA", () => {
  const linhas = extracaoIntegra().filter(
    (l) => !l.includes(comoExtracao(porNome("fn_billing_read_state")))
  );
  const r = rodar(linhas);
  assert.equal(r.code, 1, "presença parcial passou");
  assert.match(
    r.out,
    new RegExp(
      `presença parcial: ${RPCS_DE_BILLING.length - 1} de ${RPCS_DE_BILLING.length}`
    )
  );
  assert.match(r.out, /fn_billing_read_state/);
});

test("SN-M3: SOBRECARGA não declarada é DETECTADA", () => {
  const linhas = extracaoIntegra();
  // Mesmo nome de uma RPC da allowlist, assinatura diferente.
  const sobrecarga = "fn_billing_read_state(uuid, uuid, text)";
  linhas.push(propriedade(sobrecarga), acl(sobrecarga, "service_role"));
  const r = rodar(linhas);
  assert.equal(r.code, 1, "sobrecarga passou");
  assert.match(r.out, /sobrecarga não declarada/);
  assert.match(r.out, /fn_billing_read_state\(uuid,uuid,text\)/);
});

for (const papel of ["PUBLIC", "anon", "authenticated"]) {
  test(`SN-M4/${papel}: EXECUTE para ${papel} é DETECTADO`, () => {
    const linhas = extracaoIntegra();
    linhas.push(acl(porNome("fn_billing_accept_terms"), papel));
    const r = rodar(linhas);
    assert.equal(r.code, 1, `EXECUTE para ${papel} passou`);
    assert.match(r.out, new RegExp(`EXECUTE concedido a "${papel}"`));
  });
}

test("SN-M5: proprietário diferente de postgres é DETECTADO", () => {
  const linhas = extracaoIntegra().map((l) =>
    l.startsWith(`5|funcao|${comoExtracao(porNome("fn_billing_finalize_checkout"))}|`)
      ? propriedade(porNome("fn_billing_finalize_checkout"), { dono: "service_role" })
      : l
  );
  const r = rodar(linhas);
  assert.equal(r.code, 1, "dono divergente passou");
  assert.match(r.out, /dono=service_role, esperado postgres/);
});

test("SN-M6: ausência de SECURITY DEFINER é DETECTADA", () => {
  const linhas = extracaoIntegra().map((l) =>
    l.startsWith(`5|funcao|${comoExtracao(porNome("fn_billing_update_billing_email"))}|`)
      ? propriedade(porNome("fn_billing_update_billing_email"), { secdef: "f" })
      : l
  );
  const r = rodar(linhas);
  assert.equal(r.code, 1, "SECURITY INVOKER passou");
  assert.match(r.out, /secdef=f, esperado t/);
});

test("SN-M7: search_path divergente é DETECTADO", () => {
  const linhas = extracaoIntegra().map((l) =>
    l.startsWith(`5|funcao|${comoExtracao(porNome("fn_billing_accept_terms"))}|`)
      ? propriedade(porNome("fn_billing_accept_terms"), { config: "search_path=public, pg_temp" })
      : l
  );
  const r = rodar(linhas);
  assert.equal(r.code, 1, "search_path divergente passou");
  assert.match(r.out, /config=search_path=public, pg_temp, esperado search_path=""/);
});

test("SN-M8: EXECUTE faltando para service_role é DETECTADO", () => {
  const alvo = comoExtracao(porNome("fn_billing_change_plan"));
  const linhas = extracaoIntegra().filter(
    (l) => l !== `6|funcao-acl|${alvo}|service_role|EXECUTE`
  );
  const r = rodar(linhas);
  assert.equal(r.code, 1, "RPC sem EXECUTE para service_role passou");
  assert.match(r.out, /esperado exatamente \[postgres, service_role\]/);
});

test("SN-M9: privilégio que não seja EXECUTE é DETECTADO", () => {
  const linhas = extracaoIntegra();
  linhas.push(acl(porNome("fn_billing_update_billing_email"), "service_role", "UPDATE"));
  const r = rodar(linhas);
  assert.equal(r.code, 1, "privilégio estranho passou");
  assert.match(r.out, /privilégio "UPDATE", esperado EXECUTE/);
});

test("SN-M10: linguagem diferente de plpgsql é DETECTADA", () => {
  const linhas = extracaoIntegra().map((l) =>
    l.startsWith(`5|funcao|${comoExtracao(porNome("fn_billing_accept_terms"))}|`)
      ? propriedade(porNome("fn_billing_accept_terms"), { lang: "sql" })
      : l
  );
  const r = rodar(linhas);
  assert.equal(r.code, 1, "linguagem divergente passou");
  assert.match(r.out, /lang=sql, esperado plpgsql/);
});

// ── O WORKFLOW USA A EXTRAÇÃO SEPARADA, E SÓ ELA ────────────────────────────

test("SN-20: a âncora B compara a extração SEM as nominais", () => {
  const wf = fs.readFileSync(
    path.join(raiz, ".github/workflows/migration-rebuild-verify.yml"),
    "utf8"
  );
  assert.match(
    wf,
    /node scripts\/ci\/split-security-nominal\.mjs/,
    "o workflow não executa a separação nominal"
  );
  assert.match(
    wf,
    /diff -u artifacts\/baseline-security\.txt artifacts\/rebuilt-security-sem-rpcs\.txt/,
    "a comparação de segurança voltou a usar a extração íntegra"
  );
  assert.doesNotMatch(
    wf,
    /diff -u artifacts\/baseline-security\.txt artifacts\/rebuilt-security\.txt/,
    "restou uma comparação contra a extração íntegra"
  );
});

test("SN-21: as categorias 3 e 7 continuam bloqueando sem exceção", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  // Só as categorias de função podem ter linha retirada.
  assert.match(
    src,
    /categoria !== "5" && categoria !== "6"/,
    "a separação deixou de se restringir às categorias de função"
  );
  const r = rodar([
    "3|tabela|charges|rls=f|force=f|dono=postgres",
    "7|policy|charges|p|cmd=r|permissive=t|roles=anon|using=true|check=<NULO>",
  ]);
  assert.equal(r.code, 0);
  assert.equal(r.sem.trim().split("\n").length, 2, "linha de tabela ou policy foi retirada");
});

test("SN-22: a prova compensatória roda no MESMO banco", () => {
  const wf = fs.readFileSync(
    path.join(raiz, ".github/workflows/migration-rebuild-verify.yml"),
    "utf8"
  );
  assert.match(
    wf,
    /assert-billing-rpcs\.sql/,
    "a verificação de catálogo das 16 sumiu do workflow"
  );
  const iSplit = wf.indexOf("split-security-nominal.mjs");
  const iAssert = wf.indexOf("assert-billing-rpcs.sql");
  assert.ok(iSplit >= 0 && iAssert >= 0, "um dos dois passos não está no workflow");
});

// ─── Fim ────────────────────────────────────────────────────────────────────

fs.rmSync(tmp, { recursive: true, force: true });

console.log("");
console.log(`Security nominal split guard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
