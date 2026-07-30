/**
 * CLASSIFICAÇÃO DAS MIGRATIONS: HISTÓRICAS CONGELADAS × FORWARD-ONLY
 *
 * Antes da primeira migration forward-only, o ferramental podia exigir que
 * `supabase/migrations/` contivesse exatamente as 36 versões do manifesto.
 * Simples e rígido — e insustentável, porque nenhuma migration nova poderia
 * mais ser criada.
 *
 * Este módulo é a adaptação mínima. Divide o diretório em duas populações com
 * regras próprias:
 *
 *   HISTÓRICAS   as 36 versões de supabase/baseline/applied-migrations.tsv.
 *                Congeladas: têm de estar todas presentes, uma única por
 *                versão, e o conteúdo é conferido por md5_norm contra o
 *                manifesto (em tests/verify-recovered-migrations.mjs).
 *
 *   FORWARD-ONLY versões ESTRITAMENTE MAIORES que a maior histórica. Não
 *                constam do manifesto e não devem constar — o manifesto
 *                registra o que o banco remoto aplicou, não o que o
 *                repositório propõe.
 *
 * ── O QUE MUDOU EM RIGOR, DITO SEM MAQUIAGEM ────────────────────────────────
 *
 * A regra antiga era "nenhuma versão fora do manifesto". A nova é "nenhuma
 * versão fora do manifesto DENTRO OU ANTES da faixa congelada". É, nesse único
 * eixo, mais permissiva — e tem de ser, senão o histórico nunca mais evolui.
 *
 * O que NÃO foi relaxado, e é onde estava o risco real:
 *   * as 36 continuam conferidas por hash, uma a uma;
 *   * arquivo novo com versão INTERCALADA na faixa histórica é reprovado —
 *     era exatamente essa condição que tornava `db push` perigoso;
 *   * versão duplicada é reprovada, inclusive entre forward-only;
 *   * nome de arquivo fora do padrão é reprovado;
 *   * ausência de qualquer uma das 36 é reprovada.
 */

import fs from "node:fs";
import path from "node:path";

const PADRAO = /^(\d{14})_(.+)\.sql$/;

/**
 * @param {string} dir diretório com os .sql
 * @param {string[]} versoesHistoricas versões do manifesto
 */
export function classificarMigrations(dir, versoesHistoricas) {
  const arquivos = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const historicasSet = new Set(versoesHistoricas);
  const limiteCongelado = [...versoesHistoricas].sort().at(-1) ?? "";

  const historicas = [];
  const forwardOnly = [];
  const problemas = [];
  const vistas = new Map();

  for (const arquivo of arquivos) {
    const m = arquivo.match(PADRAO);
    if (!m) {
      problemas.push(`nome fora do padrão <14 dígitos>_<nome>.sql: ${arquivo}`);
      continue;
    }
    const [, version, nome] = m;

    if (vistas.has(version)) {
      problemas.push(
        `versão duplicada ${version}: ${vistas.get(version)} e ${arquivo}`
      );
      continue;
    }
    vistas.set(version, arquivo);

    const entrada = { version, nome, arquivo };

    if (historicasSet.has(version)) {
      historicas.push(entrada);
    } else if (version > limiteCongelado) {
      forwardOnly.push(entrada);
    } else {
      // Versão nova intercalada na faixa congelada. É a condição que tornava
      // `db push` perigoso: para o CLI o arquivo parece pendente, e ele o
      // aplicaria contra um banco onde o DDL equivalente já existe.
      problemas.push(
        `versão ${version} (${arquivo}) não consta do manifesto e é ANTERIOR ou ` +
          `igual à última histórica ${limiteCongelado} — migration intercalada na ` +
          `faixa congelada`
      );
    }
  }

  for (const version of versoesHistoricas) {
    if (!vistas.has(version)) {
      problemas.push(`versão histórica AUSENTE do diretório: ${version}`);
    }
  }

  // Forward-only em ordem crescente e sem regressão entre si.
  const ordenadas = [...forwardOnly].sort((a, b) => a.version.localeCompare(b.version));
  for (let i = 0; i < forwardOnly.length; i += 1) {
    if (forwardOnly[i].version !== ordenadas[i].version) {
      problemas.push("as migrations forward-only não estão em ordem crescente");
      break;
    }
  }

  return {
    historicas,
    forwardOnly,
    total: historicas.length + forwardOnly.length,
    limiteCongelado,
    problemas,
  };
}

/** Lê as versões históricas do manifesto versionado. */
export function versoesHistoricas(raiz, parseManifest) {
  const tsv = path.join(raiz, "supabase/baseline/applied-migrations.tsv");
  return parseManifest(fs.readFileSync(tsv, "utf8")).map((r) => r.version);
}

/** Linha de resumo, no formato exigido pelo relatório da Fase 5. */
export function resumo(c) {
  const fo = c.forwardOnly.length;
  return (
    `${c.historicas.length} histórica(s) verificada(s) · ` +
    `${fo} forward-only ${fo === 1 ? "pendente" : "pendentes"} · ` +
    `total ${c.total}`
  );
}
