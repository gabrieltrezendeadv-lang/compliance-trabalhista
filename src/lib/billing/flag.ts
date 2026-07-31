/**
 * FEATURE FLAG DE BILLING — desligada por padrão, e desligada por ausência
 *
 * A jornada comercial não existe ainda. Enquanto ela não existir, todo código
 * de billing tem de ser inerte — e "inerte" precisa ser uma propriedade
 * verificável, não uma esperança de que ninguém chame as funções.
 *
 * ── A REGRA, E POR QUE ELA É ESCRITA ASSIM ──────────────────────────────────
 *
 * Ligada SOMENTE quando `BILLING_ENABLED` vale exatamente a string `"true"`.
 *
 * Ausência, string vazia, `"1"`, `"yes"`, `"TRUE"` e qualquer outro valor
 * DESLIGAM. A forma perigosa seria a inversa:
 *
 *     const desligado = process.env.BILLING_DISABLED === "true"   // NÃO
 *
 * Nessa forma, esquecer de definir a variável — num runner de CI, num preview,
 * numa máquina nova — LIGA o billing. O padrão de um sistema de cobrança tem de
 * ser "não cobra", e o esquecimento tem de errar para o lado seguro.
 *
 * `tests/unit/billing/flag.spec.ts` fixa cada um desses casos, e
 * `tests/billing-mutation-guard.mjs` prova que inverter a comparação é
 * detectado.
 */

/** Nome da variável. Exportado para que os testes não repitam o literal. */
export const BILLING_FLAG_ENV = "BILLING_ENABLED";

/** Único valor que liga o billing. */
export const BILLING_FLAG_ON = "true";

/**
 * O billing está ativo?
 *
 * Lê o ambiente a cada chamada, sem cache. O custo é irrelevante e o cache
 * traria um modo de falha real: um módulo carregado antes da configuração
 * congelaria o valor errado pelo resto do processo.
 */
export function isBillingEnabled(): boolean {
  return process.env[BILLING_FLAG_ENV] === BILLING_FLAG_ON;
}
