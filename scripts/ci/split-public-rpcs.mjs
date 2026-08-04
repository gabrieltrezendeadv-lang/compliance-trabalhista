/**
 * SEPARAÇÃO DOS BLOCOS DAS RPCs DE BILLING NUM DUMP DE `public`
 *
 * Uso:
 *   node scripts/ci/split-public-rpcs.mjs <dump.sql> <sem-rpcs.sql> <rpcs.sql>
 *
 * ── O PROBLEMA QUE ESTE SCRIPT RESOLVE ──────────────────────────────────────
 *
 * `supabase/baseline/schema.sql` é gerado com `pg_dump --schema=public`, e
 * funções de `public` estão nesse dump. A Etapa 12B precisa de RPCs em
 * `public` — é o único schema exposto ao PostgREST, e sem elas o repositório
 * não alcança o banco. Logo, a âncora B (reconstruído × esperado) passaria a
 * divergir.
 *
 * Havia duas saídas ruins e uma boa.
 *
 * RUIM 1: redigir à mão, no delta declarado, o texto que o `pg_dump` vai
 * emitir. Isso é adivinhar formatação — e uma expectativa escrita pelo autor do
 * código que ela deveria vigiar não é verificação, é eco.
 *
 * RUIM 2: gerar o arquivo esperado a partir do dump real. Isso transforma a
 * previsão em gravação: passaria a aprovar o que quer que a migration fizesse.
 *
 * BOA: RETIRAR os blocos das assinaturas declaradas, comparar o resto contra o
 * arquivo esperado — que continua byte-idêntico ao de antes da 12B — e
 * verificar os blocos retirados pelo CATÁLOGO, em
 * `scripts/ci/assert-billing-rpcs.sql`.
 *
 * A troca é explícita: estes blocos saem da comparação TEXTUAL e entram numa
 * comparação de catálogo que é mais forte para o que importa. O dump é tirado
 * com `--no-owner --no-privileges`; ele nunca teve como enxergar proprietário,
 * SECURITY DEFINER efetivo nem ACL. O catálogo enxerga os três.
 *
 * ── REDE DE SEGURANÇA ───────────────────────────────────────────────────────
 *
 * O script falha, e não silencia, quando:
 *   * remove um bloco cuja assinatura não está na allowlist;
 *   * uma assinatura da allowlist não aparece no dump;
 *   * um bloco removido contém DDL que não seja a própria `CREATE FUNCTION`;
 *   * a mesma assinatura aparece duas vezes (sobrecarga não declarada).
 *
 * Sem essas quatro, "separar" viraria "esconder".
 */

import fs from "node:fs";

import { RPCS_DE_BILLING, cabecalhoDeBloco } from "./billing-rpc-allowlist.mjs";

const [entrada, saidaSem, saidaRpcs] = process.argv.slice(2);
if (!entrada || !saidaSem || !saidaRpcs) {
  console.error(
    "uso: node scripts/ci/split-public-rpcs.mjs <dump.sql> <sem-rpcs.sql> <rpcs.sql>"
  );
  process.exit(2);
}

const bruto = fs.readFileSync(entrada, "utf8").replace(/\r\n?/g, "\n");
const linhas = bruto.split("\n");

/**
 * Um bloco de objeto do `pg_dump` começa em `--` / `-- Name: …` / `--` e vai
 * até o próximo cabeçalho de bloco. Aqui só interessam os de FUNCTION em
 * `public`, e apenas os nominalmente declarados.
 */
const CABECALHO = /^-- Name: (.+); Type: ([A-Z ]+); Schema: ([^;]+); Owner: (.*)$/;

const alvo = new Set(RPCS_DE_BILLING.map((a) => cabecalhoDeBloco(a)));
const encontradas = new Map();

const mantidas = [];
const removidas = [];

let i = 0;
while (i < linhas.length) {
  const linha = linhas[i];

  if (alvo.has(linha)) {
    const assinatura = CABECALHO.exec(linha)?.[1] ?? "(ilegível)";
    if (encontradas.has(assinatura)) {
      console.error(
        `FALHA: a assinatura ${assinatura} aparece mais de uma vez no dump.\n` +
          "Isso é sobrecarga não declarada, e é exatamente o que a allowlist\n" +
          "por assinatura existe para impedir."
      );
      process.exit(1);
    }

    // O bloco inclui o `--` que precede o cabeçalho.
    let inicio = i;
    if (inicio > 0 && linhas[inicio - 1] === "--") inicio -= 1;
    // Já empurramos o `--` para `mantidas`; retira-se de lá.
    if (inicio < i && mantidas[mantidas.length - 1] === "--") mantidas.pop();

    let fim = i + 1;
    while (fim < linhas.length) {
      // Fim do bloco: o próximo cabeçalho de objeto, que vem sempre precedido
      // de uma linha `--`.
      if (linhas[fim] === "--" && CABECALHO.test(linhas[fim + 1] ?? "")) break;
      fim += 1;
    }

    const bloco = linhas.slice(inicio, fim);
    encontradas.set(assinatura, bloco);
    removidas.push({ assinatura, bloco });
    i = fim;
    continue;
  }

  mantidas.push(linha);
  i += 1;
}

// ── Rede de segurança ───────────────────────────────────────────────────────

const faltando = RPCS_DE_BILLING.filter((a) => !encontradas.has(a));
if (faltando.length > 0) {
  console.error(
    "FALHA: assinatura(s) declarada(s) na allowlist não estão no dump:\n" +
      faltando.map((a) => `  ${a}`).join("\n") +
      "\nOu a migration deixou de criá-las, ou a assinatura mudou. Nos dois\n" +
      "casos a declaração e o banco discordam, e isso não pode passar."
  );
  process.exit(1);
}

// Nenhum bloco removido pode conter DDL além da própria função.
const DDL_ESTRANHA =
  /^\s*(CREATE|ALTER|DROP)\s+(TABLE|TYPE|VIEW|INDEX|TRIGGER|POLICY|SEQUENCE|SCHEMA)\b/i;
const suspeitas = [];
for (const { assinatura, bloco } of removidas) {
  for (const l of bloco) if (DDL_ESTRANHA.test(l)) suspeitas.push(`${assinatura}: ${l}`);
}
if (suspeitas.length > 0) {
  console.error(
    "FALHA: bloco de RPC removido contém DDL que não é a própria função:\n" +
      suspeitas.map((s) => `  ${s}`).join("\n")
  );
  process.exit(1);
}

// Também não pode sobrar NENHUMA função `fn_billing_` no que ficou: uma RPC
// extra, fora da allowlist, tem de aparecer na âncora B e reprovar lá.
const restante = mantidas.join("\n");
const extras = [...restante.matchAll(/^-- Name: (fn_billing_[^;]+); Type: FUNCTION;/gm)];
if (extras.length > 0) {
  console.error(
    "FALHA: função fn_billing_ fora da allowlist permaneceu no dump:\n" +
      extras.map((m) => `  ${m[1]}`).join("\n") +
      "\nAcrescentar RPC exige acrescentá-la à allowlist, e isso aparece no diff do PR."
  );
  process.exit(1);
}

while (mantidas.length > 0 && mantidas[mantidas.length - 1] === "") mantidas.pop();
fs.writeFileSync(saidaSem, `${mantidas.join("\n")}\n`, "utf8");

const corpoRpcs = removidas
  .slice()
  .sort((a, b) => a.assinatura.localeCompare(b.assinatura))
  .map(({ bloco }) => bloco.join("\n"))
  .join("\n");
fs.writeFileSync(saidaRpcs, `${corpoRpcs}\n`, "utf8");

// ── Relatório auditável ─────────────────────────────────────────────────────

console.log(`split-public-rpcs: ${entrada}`);
console.log(`  linhas de entrada ...... ${linhas.length}`);
console.log(`  linhas sem as RPCs ..... ${mantidas.length}  → ${saidaSem}`);
console.log(`  blocos separados ....... ${removidas.length}  → ${saidaRpcs}`);
for (const { assinatura, bloco } of removidas) {
  console.log(`    ${String(bloco.length).padStart(4)} linhas  ${assinatura}`);
}
console.log(
  "  as assinaturas acima saem da âncora textual e são verificadas por\n" +
    "  scripts/ci/assert-billing-rpcs.sql, contra o catálogo."
);
