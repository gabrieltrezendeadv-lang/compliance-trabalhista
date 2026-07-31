/**
 * CÁLCULOS DE PREÇO — puros, determinísticos e em aritmética inteira
 *
 * Nenhuma função aqui lê ambiente, banco ou relógio. Toda dependência do
 * "agora" chega por argumento. Duas execuções com a mesma entrada produzem
 * exatamente a mesma saída, hoje e daqui a um ano.
 *
 * ── PROIBIÇÃO DE PONTO FLUTUANTE ────────────────────────────────────────────
 *
 * Dinheiro nunca é `float`. `0.1 + 0.2 !== 0.3` em IEEE-754, e um erro de
 * meio centavo que aparece só em algumas faixas é o tipo de defeito que
 * ninguém encontra por leitura. Todo valor é CENTAVO INTEIRO, e toda divisão é
 * conferida: se não for exata onde deveria ser, a função lança em vez de
 * arredondar em silêncio.
 *
 * `assertIntegerCents` é a rede: qualquer saída não inteira vira erro alto.
 */

import {
  CATALOG_VERSION,
  MONTHS_PER_YEAR,
  TIERS,
  YEARLY_DISCOUNT_DENOMINATOR,
  YEARLY_DISCOUNT_NUMERATOR,
  getPriceEntry,
  getTier,
} from "./catalog";
import type {
  BillingPeriod,
  PlanSlug,
  PriceSnapshot,
  TierSlug,
} from "./model";

const MS_PER_DAY = 86_400_000;

/** Rede de segurança: toda saída monetária passa por aqui. */
export function assertIntegerCents(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(
      `${label} não é centavo inteiro: ${value} — dinheiro nunca é ponto flutuante`
    );
  }
  if (value < 0) throw new Error(`${label} é negativo: ${value}`);
  return value;
}

// ─── Seleção de faixa ──────────────────────────────────────────────────────

/**
 * Faixa correspondente à quantidade de trabalhadores.
 *
 * Limites INCLUSIVOS nas duas pontas: 20 é `t1_20`, 21 é `t21_50`, 50 é
 * `t21_50`, 51 é `t51_100`, 100 é `t51_100`, 101 é `enterprise`. As bordas são
 * onde o erro de faixa custa dinheiro, e são exatamente o que os testes fixam.
 */
export function selectTier(workerCount: number): TierSlug {
  if (!Number.isInteger(workerCount)) {
    throw new Error(`worker_count precisa ser inteiro: ${workerCount}`);
  }
  if (workerCount < 1) {
    throw new Error(`worker_count precisa ser ao menos 1: ${workerCount}`);
  }

  const tier = TIERS.find(
    (t) =>
      workerCount >= t.minWorkers &&
      (t.maxWorkers === null || workerCount <= t.maxWorkers)
  );

  // Inalcançável: a última faixa tem `maxWorkers: null`. Se alguém remover essa
  // faixa do catálogo, isto falha alto em vez de devolver `undefined`.
  if (!tier) throw new Error(`nenhuma faixa cobre ${workerCount} trabalhadores`);
  return tier.slug;
}

/** `true` quando a faixa exige proposta comercial (sem checkout automático). */
export function requiresQuote(tier: TierSlug): boolean {
  return getTier(tier).requiresQuote;
}

// ─── Preços ────────────────────────────────────────────────────────────────

/** Preço mensal de tabela, em centavos. `null` para Enterprise. */
export function monthlyPriceCents(
  plan: PlanSlug,
  tier: TierSlug
): number | null {
  const { monthlyCents } = getPriceEntry(plan, tier);
  if (monthlyCents === null) return null;
  return assertIntegerCents(monthlyCents, `preço mensal ${plan}/${tier}`);
}

/**
 * Preço anual, CALCULADO: 12 mensalidades com 10% de desconto.
 *
 * A divisão por 10 tem de ser exata. Não é preferência estética: um resto
 * significaria sub-centavo, e a única saída honesta seria escolher uma regra de
 * arredondamento — que ninguém aprovou. Melhor falhar e obrigar a decisão.
 */
export function yearlyPriceCents(plan: PlanSlug, tier: TierSlug): number | null {
  const monthly = monthlyPriceCents(plan, tier);
  if (monthly === null) return null;

  const bruto = monthly * MONTHS_PER_YEAR * YEARLY_DISCOUNT_NUMERATOR;
  if (bruto % YEARLY_DISCOUNT_DENOMINATOR !== 0) {
    throw new Error(
      `preço anual de ${plan}/${tier} não fecha em centavos inteiros: ` +
        `${monthly} × ${MONTHS_PER_YEAR} × ${YEARLY_DISCOUNT_NUMERATOR} / ` +
        `${YEARLY_DISCOUNT_DENOMINATOR} deixa resto`
    );
  }

  return assertIntegerCents(
    bruto / YEARLY_DISCOUNT_DENOMINATOR,
    `preço anual ${plan}/${tier}`
  );
}

/** Preço do período escolhido, em centavos. `null` para Enterprise. */
export function priceCents(
  plan: PlanSlug,
  tier: TierSlug,
  period: BillingPeriod
): number | null {
  return period === "monthly"
    ? monthlyPriceCents(plan, tier)
    : yearlyPriceCents(plan, tier);
}

/** Economia do plano anual em relação a 12 mensalidades, em centavos. */
export function yearlySavingsCents(
  plan: PlanSlug,
  tier: TierSlug
): number | null {
  const monthly = monthlyPriceCents(plan, tier);
  const yearly = yearlyPriceCents(plan, tier);
  if (monthly === null || yearly === null) return null;
  return assertIntegerCents(
    monthly * MONTHS_PER_YEAR - yearly,
    `economia anual ${plan}/${tier}`
  );
}

// ─── Snapshot de preço ─────────────────────────────────────────────────────

/**
 * Congela o preço no momento da contratação.
 *
 * O objeto devolvido é congelado com `Object.freeze`. Não substitui o trigger
 * de imutabilidade no banco — protege contra mutação acidental em memória, e o
 * banco protege contra reescrita histórica. As duas camadas atacam problemas
 * diferentes.
 */
export function capturePriceSnapshot(
  plan: PlanSlug,
  tier: TierSlug,
  period: BillingPeriod,
  capturedAt: string
): PriceSnapshot {
  const amount = priceCents(plan, tier, period);
  if (amount === null) {
    throw new Error(
      `${plan}/${tier} não tem preço de tabela — Enterprise é sob proposta e ` +
        `não passa por checkout automático`
    );
  }

  return Object.freeze({
    plan,
    tier,
    period,
    amountCents: assertIntegerCents(amount, "snapshot"),
    capturedAt,
    catalogVersion: CATALOG_VERSION,
  });
}

// ─── Datas ─────────────────────────────────────────────────────────────────

function toUtcMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`instante inválido: ${iso}`);
  return ms;
}

/** Dias inteiros decorridos de `fromIso` a `toIso`. Pode ser negativo. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((toUtcMs(toIso) - toUtcMs(fromIso)) / MS_PER_DAY);
}

export function addDays(iso: string, days: number): string {
  return new Date(toUtcMs(iso) + days * MS_PER_DAY).toISOString();
}

/**
 * Soma meses em UTC, com CLAMP no último dia do mês de destino.
 *
 * 31/01 + 1 mês = 28/02 (ou 29/02 em ano bissexto), e não 03/03. Sem o clamp,
 * o `Date` do JavaScript transborda para o mês seguinte — e uma assinatura
 * contratada em 31 de janeiro renovaria em março.
 */
export function addMonths(iso: string, months: number): string {
  const d = new Date(toUtcMs(iso));
  const diaOriginal = d.getUTCDate();

  const alvo = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + months,
      1,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds()
    )
  );

  const ultimoDiaDoMes = new Date(
    Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)
  ).getUTCDate();

  alvo.setUTCDate(Math.min(diaOriginal, ultimoDiaDoMes));
  return alvo.toISOString();
}

/** Próxima renovação a partir do início do período vigente. */
export function nextRenewalAt(
  currentPeriodStart: string,
  period: BillingPeriod
): string {
  return addMonths(currentPeriodStart, period === "monthly" ? 1 : MONTHS_PER_YEAR);
}

/** Instante em que o aviso de renovação/mudança de preço deve ser enviado. */
export function renewalNoticeAt(renewalAt: string, noticeDays: number): string {
  return addDays(renewalAt, -noticeDays);
}

// ─── Pró-rata ──────────────────────────────────────────────────────────────

export interface ProrationInput {
  readonly currentAmountCents: number;
  readonly targetAmountCents: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly changeAt: string;
}

/**
 * Diferença proporcional cobrada num UPGRADE imediato.
 *
 * Regra declarada:
 *   diferença = alvo − atual (se ≤ 0, não há cobrança: downgrade não gera
 *               crédito retroativo, e a mudança vale só na renovação)
 *   pró-rata  = piso( diferença × diasRestantes / diasDoPeríodo )
 *
 * O PISO é deliberado e favorece o cliente: qualquer resto de divisão é
 * descartado, nunca arredondado para cima. Um `Math.round` sobre float
 * reintroduziria o problema que a aritmética inteira existe para evitar.
 *
 * `diasRestantes` conta dias inteiros de `changeAt` até `periodEnd`, limitado a
 * zero — mudança depois do fim do período não gera cobrança proporcional.
 */
export function prorationCents(input: ProrationInput): number {
  const atual = assertIntegerCents(input.currentAmountCents, "preço atual");
  const alvo = assertIntegerCents(input.targetAmountCents, "preço alvo");

  const diferenca = alvo - atual;
  if (diferenca <= 0) return 0;

  const diasDoPeriodo = daysBetween(input.periodStart, input.periodEnd);
  if (diasDoPeriodo <= 0) {
    throw new Error(
      `período inválido para pró-rata: ${input.periodStart} → ${input.periodEnd}`
    );
  }

  const diasRestantes = Math.max(
    0,
    Math.min(daysBetween(input.changeAt, input.periodEnd), diasDoPeriodo)
  );

  return assertIntegerCents(
    Math.floor((diferenca * diasRestantes) / diasDoPeriodo),
    "pró-rata"
  );
}
