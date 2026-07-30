/**
 * Normalização canônica de SQL, usada para comparar migrations por conteúdo.
 *
 * Precisa ser equivalente à expressão aplicada no PostgreSQL ao gerar
 * `supabase/baseline/applied-migrations.tsv`:
 *
 *   btrim(lower(regexp_replace(
 *     regexp_replace(
 *       regexp_replace(statements[1], '/\*.*?\*​/', ' ', 'g'),
 *       '--[^\n]*', ' ', 'g'),
 *     '\s+', ' ', 'g')))
 *
 * A ordem importa: blocos primeiro, depois comentários de linha, depois
 * colapso de espaços. Inverter produziria hashes diferentes.
 *
 * Limitação conhecida e aceita: a normalização não entende literais de string.
 * Um `--` dentro de uma string SQL seria tratado como comentário. Nenhuma das
 * 36 migrations tem esse caso — verificado pela conferência de md5, que
 * fecharia diferente se houvesse.
 */

import crypto from "node:crypto";

/** Normaliza SQL para comparação por conteúdo. */
export function normalizeSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** Assinatura de conteúdo: comprimento e md5 do SQL normalizado. */
export function sqlFingerprint(sql) {
  const norm = normalizeSql(sql);
  return {
    len: norm.length,
    md5: crypto.createHash("md5").update(norm, "utf8").digest("hex"),
  };
}
