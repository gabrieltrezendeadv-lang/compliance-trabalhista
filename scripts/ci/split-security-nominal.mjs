/**
 * SEPARAÇÃO NOMINAL NA EXTRAÇÃO DE SEGURANÇA
 *
 * Uso:
 *   node scripts/ci/split-security-nominal.mjs <extracao.txt> <sem-rpcs.txt> <rpcs.txt>
 *
 * ── O PROBLEMA ──────────────────────────────────────────────────────────────
 *
 * A âncora B compara a extração de segurança da BASELINE restaurada (as 36
 * históricas, sem a 12B) contra a da RECONSTRUÇÃO completa (com a 12B). Para as
 * RPCs nominais da allowlist, diferir não é defeito: é o efeito declarado da
 * migration. A contagem vem da allowlist — eram 16 na 12B, são 18 desde a
 * 12C.1 — e nunca de um número escrito aqui.
 * Sem tratamento, a comparação acusa 48 linhas em categorias bloqueantes — 16 de
 * propriedade de função e 32 de ACL — e o veredito fica permanentemente
 * vermelho por um motivo que não é regressão.
 *
 * `split-public-rpcs.mjs` já resolveu isso para o dump TEXTUAL. Este script faz
 * o mesmo para a extração de segurança, com uma diferença importante: aqui não
 * basta retirar. A extração de segurança é justamente onde `SECURITY DEFINER`,
 * `search_path`, proprietário e ACL aparecem — o dump é tirado com
 * `--no-owner --no-privileges` e nunca os viu.
 *
 * ── POR ISSO A RETIRADA É CONDICIONAL ───────────────────────────────────────
 *
 * Uma linha nominal só sai da comparação se o perfil dela for EXATAMENTE o
 * declarado. Qualquer desvio faz o script REPROVAR — não faz a linha voltar
 * silenciosamente para o diff, faz o passo falhar com o motivo escrito:
 *
 *   * conjunto de assinaturas diferente das 16 da allowlist;
 *   * sobrecarga: assinatura não declarada com nome de RPC declarada;
 *   * `lang` diferente de plpgsql;
 *   * `secdef` diferente de `t`;
 *   * `search_path` diferente de vazio;
 *   * proprietário diferente de `postgres`;
 *   * EXECUTE para qualquer coisa fora do par {postgres, service_role};
 *   * ACL nula, ausente ou com privilégio que não seja EXECUTE.
 *
 * Presença parcial também reprova. Zero assinaturas presentes é o único caso de
 * passagem sem retirada — é a `main`, que não tem a 12B.
 *
 * A troca continua explícita e continua sendo por algo mais forte:
 * `scripts/ci/assert-billing-rpcs.sql` verifica as mesmas 16 no CATÁLOGO do
 * MESMO banco, por identidade resolvida via `to_regprocedure`, com nomes de
 * parâmetro, modos, `SECURITY DEFINER`, `search_path`, proprietário e EXECUTE.
 * O que sai daqui entra lá.
 *
 * O RESTANTE da comparação permanece bloqueante e tem de dar zero.
 */

import fs from "node:fs";

import { RPCS_DE_BILLING, NOMES_DE_RPC } from "./billing-rpc-allowlist.mjs";

const [entrada, saidaSem, saidaRpcs] = process.argv.slice(2);
if (!entrada || !saidaSem || !saidaRpcs) {
  console.error(
    "uso: node scripts/ci/split-security-nominal.mjs <extracao.txt> <sem-rpcs.txt> <rpcs.txt>"
  );
  process.exit(2);
}

/** Perfil exigido de cada RPC nominal. Nada aqui é opcional. */
const PERFIL = Object.freeze({
  lang: "plpgsql",
  secdef: "t",
  config: 'search_path=""',
  dono: "postgres",
});

/** Os únicos papéis que podem ter EXECUTE nas RPCs nominais. */
const GRANTEES = Object.freeze(["postgres", "service_role"]);

/**
 * Assinaturas comparáveis: a extração emite `public.fn(a,b)` e a allowlist
 * declara `fn(a, b)`. O espaço depois da vírgula é cosmético; o espaço DENTRO
 * de `timestamp with time zone` não é, e por isso só o primeiro é removido.
 */
function normalizar(assinatura) {
  return assinatura.replace(/^public\./, "").replace(/,\s*/g, ",");
}

const ESPERADAS = new Map(RPCS_DE_BILLING.map((a) => [normalizar(a), a]));
const NOMES = new Set(NOMES_DE_RPC);

const falhas = [];
function reprovar(motivo) {
  falhas.push(motivo);
}

const bruto = fs.readFileSync(entrada, "utf8").replace(/\r\n?/g, "\n");
const linhas = bruto.split("\n");

const restante = [];
const nominais = [];
/** assinatura normalizada → { propriedades: [linha], acl: [{grantee, priv}] } */
const porAssinatura = new Map();

for (const linha of linhas) {
  if (linha === "") continue;

  const campos = linha.split("|");
  const categoria = campos[0];

  // Só as categorias de função podem conter assinatura nominal.
  if (categoria !== "5" && categoria !== "6") {
    restante.push(linha);
    continue;
  }

  const assinatura = campos[2] ?? "";
  const chave = normalizar(assinatura);
  const nome = chave.slice(0, chave.indexOf("("));

  if (!ESPERADAS.has(chave)) {
    // Sobrecarga não declarada: mesmo nome, assinatura diferente. Deixar passar
    // seria aprovar uma função que ninguém revisou — o PostgREST escolhe entre
    // sobrecargas pelos parâmetros que o chamador mandar.
    if (NOMES.has(nome)) {
      reprovar(
        `sobrecarga não declarada: ${assinatura} tem nome de RPC da allowlist, mas assinatura fora dela`
      );
    }
    restante.push(linha);
    continue;
  }

  if (!porAssinatura.has(chave)) porAssinatura.set(chave, { propriedades: [], acl: [] });
  const registro = porAssinatura.get(chave);

  if (categoria === "5") {
    registro.propriedades.push(linha);
    const atributos = Object.fromEntries(
      campos.slice(3).map((c) => {
        const i = c.indexOf("=");
        return [c.slice(0, i), c.slice(i + 1)];
      })
    );
    for (const [campo, esperado] of Object.entries(PERFIL)) {
      if (atributos[campo] !== esperado) {
        reprovar(
          `${assinatura}: ${campo}=${atributos[campo] ?? "<ausente>"}, esperado ${esperado}`
        );
      }
    }
  } else {
    const grantee = campos[3];
    const privilegio = campos[4];
    registro.acl.push({ grantee, privilegio });
    if (!GRANTEES.includes(grantee)) {
      reprovar(`${assinatura}: EXECUTE concedido a "${grantee}", fora de {${GRANTEES.join(", ")}}`);
    }
    if (privilegio !== "EXECUTE") {
      reprovar(`${assinatura}: privilégio "${privilegio}", esperado EXECUTE`);
    }
  }

  nominais.push(linha);
}

// ── Contagem e correspondência EXATAS ───────────────────────────────────────

const presentes = [...porAssinatura.keys()].sort();

if (presentes.length === 0) {
  // A `main` não tem a 12B. Nada a retirar, e nada a reprovar.
  console.log("  nenhuma assinatura nominal presente — extração inalterada");
} else if (presentes.length !== ESPERADAS.size) {
  const faltando = [...ESPERADAS.keys()].filter((a) => !porAssinatura.has(a));
  reprovar(
    `presença parcial: ${presentes.length} de ${ESPERADAS.size} assinaturas nominais. ` +
      `Ausente(s): ${faltando.join(", ")}`
  );
} else {
  for (const [chave, registro] of porAssinatura) {
    const assinatura = ESPERADAS.get(chave);
    if (registro.propriedades.length !== 1) {
      reprovar(
        `${assinatura}: ${registro.propriedades.length} linha(s) de propriedade, esperada 1`
      );
    }
    const concedidos = registro.acl.map((a) => a.grantee).sort();
    if (concedidos.length !== GRANTEES.length ||
        concedidos.join(",") !== [...GRANTEES].sort().join(",")) {
      reprovar(
        `${assinatura}: EXECUTE para [${concedidos.join(", ") || "<nenhum>"}], ` +
          `esperado exatamente [${[...GRANTEES].sort().join(", ")}]`
      );
    }
  }
}

// ── Veredito ────────────────────────────────────────────────────────────────

if (falhas.length > 0) {
  console.error("");
  for (const f of falhas) console.error(`  ✗ ${f}`);
  console.error("");
  console.error(
    `SEPARAÇÃO NOMINAL REPROVADA: ${falhas.length} desvio(s). ` +
      "Nenhuma linha foi retirada da comparação."
  );
  process.exit(1);
}

fs.writeFileSync(saidaSem, restante.join("\n") + (restante.length ? "\n" : ""), "utf8");
fs.writeFileSync(saidaRpcs, nominais.join("\n") + (nominais.length ? "\n" : ""), "utf8");

console.log(`  linhas na extração ......... ${linhas.filter((l) => l !== "").length}`);
console.log(`  nominais retiradas ......... ${nominais.length}`);
console.log(`  assinaturas ................ ${presentes.length}`);
console.log(`  restante (bloqueante) ...... ${restante.length}`);
if (presentes.length > 0) {
  console.log("  == assinaturas retiradas ==");
  for (const chave of presentes) console.log(`    ${ESPERADAS.get(chave)}`);
  console.log("  verificadas por scripts/ci/assert-billing-rpcs.sql, no MESMO banco");
}
