/**
 * ESTADO ESTRUTURAL ESPERADO APÓS AS MIGRATIONS FORWARD-ONLY
 *
 * Uso:
 *   node scripts/ci/build-expected-schema.mjs            # gera o arquivo
 *   node scripts/ci/build-expected-schema.mjs --check     # confere sem escrever
 *
 * Gera `supabase/baseline/schema-after-forward-only.sql` a partir de
 * `supabase/baseline/schema.sql` aplicando, uma a uma, as ALTERAÇÕES
 * ESTRUTURAIS DECLARADAS de cada migration forward-only.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * `migration-rebuild-verify.yml` comparava o dump do banco reconstruído
 * diretamente contra `schema.sql`. Isso funcionou enquanto as forward-only não
 * tocavam estrutura — `20260730123613` só mexe em ACL, e ACL não aparece num
 * dump feito com `--no-privileges`.
 *
 * O TG-12 altera o CORPO de `fn_resolve_tenant_id`, que está no dump. A partir
 * dele, "reconstruído == snapshot" deixa de ser verdade — e deixa de ser a
 * pergunta certa.
 *
 * A reconstrução passa a ser verificada em DUAS âncoras:
 *
 *   ÂNCORA A — as 36 históricas, sozinhas, reproduzem `schema.sql`.
 *              Imutável. É a prova original da Fase 4C e continua valendo
 *              integralmente, por igualdade de SHA-256.
 *
 *   ÂNCORA B — as 36 históricas MAIS as forward-only, em ordem, reproduzem
 *              `schema-after-forward-only.sql`, gerado por este script.
 *
 * ── O QUE ESTE ARQUIVO É, E O QUE NÃO É ─────────────────────────────────────
 *
 * NÃO é um novo baseline. `schema.sql` continua sendo o snapshot histórico do
 * banco em 29/07/2026, imutável, e não é tocado por este script — o TG-12 não
 * é retroativamente inserido nele, e o manifesto das 36 continua intacto.
 *
 * NÃO é exclusão da função do diff. O arquivo gerado é comparado INTEIRO
 * contra o dump reconstruído. Qualquer diferença além das declaradas aqui
 * reprova — inclusive uma diferença na própria função, se o corpo aplicado não
 * for exatamente o esperado.
 *
 * É uma PREVISÃO declarada e auditável: "estas migrations forward-only devem
 * produzir exatamente esta mudança estrutural, e nada mais".
 *
 * ── COMO A INTEGRIDADE É VERIFICADA ─────────────────────────────────────────
 *
 * Três camadas, e nenhuma delas depende de confiar no arquivo gerado:
 *
 *   1. `--check` no CI: regenera e exige que o arquivo versionado seja
 *      idêntico. Edição manual do arquivo é reprovada.
 *   2. O workflow compara o DUMP REAL do banco reconstruído contra ele. Se a
 *      migration fizer algo diferente do declarado, reprova.
 *   3. A transformação é NARROW: cada delta abaixo é um literal. Uma migration
 *      futura que altere outra coisa não passa a ser tolerada em silêncio —
 *      ela reprova até que alguém acrescente o delta conscientemente, e esse
 *      acréscimo aparece no diff do PR.
 *
 * ── LIMITE DECLARADO ────────────────────────────────────────────────────────
 *
 * Se o autor de uma migration errar E declarar o mesmo erro aqui, as duas
 * pontas concordam e o erro passa. É o limite inerente de "estado esperado
 * declarado pelo autor". O que este desenho garante é que a mudança estrutural
 * seja EXPLÍCITA e revisável no diff do PR — não que ela esteja correta. A
 * correção é responsabilidade da revisão e dos testes de comportamento.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RPCS_DE_BILLING } from "./billing-rpc-allowlist.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ORIGEM = path.join(raiz, "supabase/baseline/schema.sql");
const DESTINO = path.join(raiz, "supabase/baseline/schema-after-forward-only.sql");

/**
 * Deltas estruturais declarados, na ordem das migrations forward-only.
 *
 * `de` e `para` são literais exatos. Cada entrada precisa casar EXATAMENTE uma
 * vez — zero ocorrências ou mais de uma reprovam, porque as duas situações
 * significam que a premissa do delta deixou de valer.
 */
const DELTAS = [
  {
    migration: "20260730123613_revoke_public_webhook_execute.sql",
    efeitoEstrutural: false,
    nota:
      "Só altera ACL (REVOKE EXECUTE ... FROM PUBLIC). `schema.sql` é gerado " +
      "com --no-privileges e contém 0 GRANT e 0 REVOKE, então esta migration " +
      "não tem efeito nenhum sobre o dump estrutural.",
  },
  {
    migration: "20260731094500_make_tenant_resolution_deterministic.sql",
    efeitoEstrutural: true,
    nota:
      "Substitui o corpo de fn_resolve_tenant_id para ordenar por " +
      "created_at ASC, id ASC. Assinatura, linguagem, volatilidade, " +
      "SECURITY DEFINER e search_path permanecem idênticos.",
    de: `    AS $$
  SELECT tenant_id
  FROM organization_members
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;
$$;`,
    para: `    AS $$
  SELECT om.tenant_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.deleted_at IS NULL
  ORDER BY om.created_at ASC, om.id ASC
  LIMIT 1;
$$;`,
  },
  {
    migration: "20260801120000_billing_foundation.sql",
    efeitoEstrutural: false,
    nota:
      "Cria TODOS os seus objetos no schema `billing`. `schema.sql` é gerado " +
      "com `pg_dump --schema=public`, que não enxerga outro schema — e o " +
      "extrator de segurança filtra `nspname = 'public'`, também não. O único " +
      "comando que toca `public` é `UPDATE public.subscription_plans SET " +
      "is_active = false`, que é DML e não aparece em dump estrutural. " +
      "Portanto: efeito estrutural nulo sobre o snapshot. " +
      "A contrapartida — a fundação ficar fora do alcance de " +
      "`assert-no-public-execute.sql` — é coberta por " +
      "`scripts/ci/assert-billing-security.sql`, que roda no job Verify " +
      "contra PostgreSQL real. Ver docs/decisions/PLANOS-E-PRECIFICACAO.md §8.1.",
  },
  {
    migration: "20260802093000_billing_orchestration.sql",
    efeitoEstrutural: "nominal",
    rpcs: RPCS_DE_BILLING,
    nota:
      "Etapa 12B. As TABELAS, TIPOS e TRIGGERS continuam inteiramente em " +
      "`billing` e não aparecem em `pg_dump --schema=public`. As dezesseis " +
      "RPCs, porém, VIVEM EM `public` — é o único schema exposto ao PostgREST, " +
      "e sem elas o repositório não alcança o banco. Funções de `public` ESTÃO " +
      "no dump, logo o efeito estrutural NÃO é nulo, e declará-lo nulo seria " +
      "falso. A âncora B compara o dump SEM os blocos destas assinaturas " +
      "(`scripts/ci/split-public-rpcs.mjs`), e os blocos retirados são " +
      "verificados por catálogo em `scripts/ci/assert-billing-rpcs.sql` — que " +
      "confere owner, SECURITY DEFINER, search_path e ACL, coisas que o dump " +
      "é tirado com `--no-owner --no-privileges` e nunca teve como enxergar.",
  },
];

const modoCheck = process.argv.includes("--check");

const original = fs.readFileSync(ORIGEM, "utf8").replace(/\r\n?/g, "\n");
let resultado = original;
const aplicados = [];

for (const delta of DELTAS) {
  if (delta.efeitoEstrutural === false) {
    aplicados.push(`  ─ ${delta.migration}: sem efeito estrutural`);
    continue;
  }

  // ── EFEITO ESTRUTURAL NOMINAL ─────────────────────────────────────────────
  //
  // A migration ACRESCENTA funções a `public`. O arquivo esperado NÃO é
  // aumentado — nenhuma linha de saída de `pg_dump` é redigida à mão aqui, e
  // isso é deliberado: texto de dump escrito por quem declara o delta não
  // prova nada, só repete a expectativa do autor.
  //
  // Em vez disso, os blocos destas assinaturas são RETIRADOS do dump
  // reconstruído antes da comparação, por `split-public-rpcs.mjs`, e passam a
  // ser verificados no catálogo. O que sobra tem de bater com este arquivo,
  // exatamente como antes.
  if (delta.efeitoEstrutural === "nominal") {
    if (!Array.isArray(delta.rpcs) || delta.rpcs.length === 0) {
      console.error(
        `FALHA: ${delta.migration} é "nominal" mas não declara assinatura alguma.`
      );
      process.exit(1);
    }
    aplicados.push(
      `  ± ${delta.migration}: ${delta.rpcs.length} função(ões) nominais em public ` +
        `(fora da âncora textual, verificadas por catálogo)`
    );
    continue;
  }
  const ocorrencias = resultado.split(delta.de).length - 1;
  if (ocorrencias !== 1) {
    console.error(
      `FALHA: o delta de ${delta.migration} casou ${ocorrencias} vez(es), esperado exatamente 1.\n` +
        `O trecho de origem deixou de existir ou passou a ser ambíguo em schema.sql.\n` +
        `Isto NÃO deve ser contornado ampliando o casamento — significa que a\n` +
        `premissa do delta mudou e precisa ser reavaliada.`
    );
    process.exit(1);
  }
  // Replacer como FUNÇÃO, não string. Com replacement em string, o JS trata
  // `$$` como escape de um `$` literal — e o corpo de toda função PL/pgSQL ou
  // SQL é delimitado por `$$`. Usar a forma de string aqui corrompe o arquivo
  // gerado de modo silencioso: `AS $$` vira `AS $`, e o SQL deixa de ser
  // válido sem que nenhuma etapa acuse.
  resultado = resultado.replace(delta.de, () => delta.para);
  aplicados.push(`  ✓ ${delta.migration}: delta estrutural aplicado`);
}

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

console.log("build-expected-schema");
console.log(`  origem  : supabase/baseline/schema.sql        (${sha(original).slice(0, 16)}…)`);
for (const linha of aplicados) console.log(linha);
console.log(`  destino : supabase/baseline/schema-after-forward-only.sql (${sha(resultado).slice(0, 16)}…)`);

if (modoCheck) {
  if (!fs.existsSync(DESTINO)) {
    console.error("FALHA: schema-after-forward-only.sql não existe. Rode sem --check para gerar.");
    process.exit(1);
  }
  const versionado = fs.readFileSync(DESTINO, "utf8").replace(/\r\n?/g, "\n");
  if (versionado !== resultado) {
    console.error(
      "FALHA: o arquivo versionado difere do que este script gera.\n" +
        `  versionado: ${sha(versionado)}\n` +
        `  gerado    : ${sha(resultado)}\n` +
        "Edição manual do estado esperado não é aceita — ajuste os DELTAS."
    );
    process.exit(1);
  }
  console.log("  ✓ arquivo versionado confere com o gerado");
} else {
  fs.writeFileSync(DESTINO, resultado, "utf8");
  console.log("  ✓ escrito");
}
