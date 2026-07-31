/**
 * CICLO DE VIDA DA ASSINATURA — máquina de estados pura
 *
 * Nenhuma função lê relógio: o instante chega sempre por argumento. Nenhuma
 * função escreve no banco. O que sai daqui é um `Subscription` novo, imutável;
 * persistir é responsabilidade de outra camada, em etapa posterior.
 *
 * ── ESTADO DERIVADO, NÃO ARMAZENADO ─────────────────────────────────────────
 *
 * `resolveState` calcula o estado efetivo a partir de FATOS com data —
 * `trialEndsAt`, `paymentFailedAt`, `currentPeriodEnd` — em vez de confiar num
 * campo `status` gravado.
 *
 * O motivo é operacional: um estado gravado só muda quando alguma rotina roda.
 * Se o job de transição falhar, atrasar ou nunca ter sido escrito, uma
 * assinatura vencida continua marcada como ativa e o acesso segue liberado.
 * Estado derivado vence sozinho, na hora certa, sem depender de nada rodar.
 *
 * O campo `state` continua existindo e é respeitado para as decisões que NÃO
 * são derivadas de data — cancelamento pedido e encerramento definitivo.
 */

import { PAYMENT_TOLERANCE_DAYS, POST_TERMINATION_READ_ONLY_MONTHS, TRIAL_DAYS } from "./catalog";
import {
  addDays,
  addMonths,
  capturePriceSnapshot,
  nextRenewalAt,
  prorationCents,
  priceCents,
} from "./pricing";
import type {
  BillingPeriod,
  PlanSlug,
  Subscription,
  SubscriptionState,
  TierSlug,
} from "./model";

function ms(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`instante inválido: ${iso}`);
  return t;
}

const antesDe = (a: string, b: string) => ms(a) < ms(b);
const aPartirDe = (a: string, b: string) => ms(a) >= ms(b);

// ─── Trial ─────────────────────────────────────────────────────────────────

/** Fim do trial: exatamente 7 dias após o início. */
export function trialEndsAt(startedAt: string): string {
  return addDays(startedAt, TRIAL_DAYS);
}

/** Fim da tolerância: exatamente 7 dias após a falha de pagamento. */
export function toleranceEndsAt(paymentFailedAt: string): string {
  return addDays(paymentFailedAt, PAYMENT_TOLERANCE_DAYS);
}

/** Fim do modo leitura pós-encerramento: 12 meses após o encerramento. */
export function readOnlyEndsAt(terminatedAt: string): string {
  return addMonths(terminatedAt, POST_TERMINATION_READ_ONLY_MONTHS);
}

// ─── Estado efetivo ────────────────────────────────────────────────────────

/**
 * Estado efetivo da assinatura no instante `now`.
 *
 * Ordem de avaliação, e ela importa:
 *   1. encerrada — decisão terminal, nada a derivar;
 *   2. trial vencido sem contratação → modo leitura;
 *   3. tolerância vencida após falha de pagamento → modo leitura;
 *   4. cancelamento pedido: acesso normal até o fim do período pago, depois
 *      modo leitura;
 *   5. falha de pagamento dentro dos 7 dias → acesso normal;
 *   6. período vigente vencido sem renovação → modo leitura;
 *   7. caso contrário, o estado armazenado.
 */
export function resolveState(
  subscription: Subscription,
  now: string
): SubscriptionState {
  const s = subscription;

  if (s.state === "terminated") return "terminated";

  if (s.state === "trialing") {
    if (s.trialEndsAt !== null && aPartirDe(now, s.trialEndsAt)) return "read_only";
    return "trialing";
  }

  if (s.paymentFailedAt !== null) {
    return antesDe(now, toleranceEndsAt(s.paymentFailedAt))
      ? "past_due_tolerance"
      : "read_only";
  }

  if (s.state === "cancel_scheduled") {
    return aPartirDe(now, s.currentPeriodEnd) ? "read_only" : "cancel_scheduled";
  }

  if (aPartirDe(now, s.currentPeriodEnd)) return "read_only";

  return s.state;
}

// ─── Transições ────────────────────────────────────────────────────────────

export interface UpgradeResult {
  readonly subscription: Subscription;
  /** Diferença proporcional a cobrar imediatamente, em centavos. */
  readonly chargeCents: number;
}

/**
 * UPGRADE — imediato, cobrando a diferença proporcional ao que resta do
 * período. O período vigente NÃO é reiniciado: a data de renovação continua a
 * mesma, e é isso que torna a cobrança proporcional correta.
 *
 * O snapshot de preço é SUBSTITUÍDO por um novo, congelado agora. O anterior
 * não é apagado — ele pertence às faturas já emitidas, e a persistência guarda
 * a série. Reescrever o snapshot antigo é exatamente o que a imutabilidade
 * proíbe.
 */
export function applyUpgrade(
  subscription: Subscription,
  target: { plan: PlanSlug; tier: TierSlug },
  now: string
): UpgradeResult {
  const alvo = priceCents(target.plan, target.tier, subscription.period);
  if (alvo === null) {
    throw new Error(
      `${target.plan}/${target.tier} é Enterprise — sob proposta, sem checkout automático`
    );
  }
  if (alvo <= subscription.priceSnapshot.amountCents) {
    throw new Error(
      "alvo não é upgrade: preço menor ou igual ao contratado. " +
        "Redução de plano ou de faixa é downgrade e vale na renovação."
    );
  }

  const chargeCents = prorationCents({
    currentAmountCents: subscription.priceSnapshot.amountCents,
    targetAmountCents: alvo,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
    changeAt: now,
  });

  return {
    chargeCents,
    subscription: {
      ...subscription,
      plan: target.plan,
      tier: target.tier,
      state: "active",
      priceSnapshot: capturePriceSnapshot(
        target.plan,
        target.tier,
        subscription.period,
        now
      ),
      // Período e renovação intactos, de propósito.
      scheduledDowngrade: null,
    },
  };
}

/**
 * DOWNGRADE — agendado para a renovação. Nada muda agora: nem plano, nem
 * preço, nem acesso. Sem crédito retroativo, e sem devolução proporcional.
 */
export function scheduleDowngrade(
  subscription: Subscription,
  target: { plan: PlanSlug; tier: TierSlug }
): Subscription {
  const alvo = priceCents(target.plan, target.tier, subscription.period);
  if (alvo === null) {
    throw new Error(`${target.plan}/${target.tier} é Enterprise — sob proposta`);
  }
  if (alvo >= subscription.priceSnapshot.amountCents) {
    throw new Error(
      "alvo não é downgrade: preço maior ou igual ao contratado. " +
        "Aumento de plano ou de faixa é upgrade e vale imediatamente."
    );
  }
  return { ...subscription, scheduledDowngrade: target };
}

/**
 * RENOVAÇÃO — aplica o downgrade agendado, se houver, e abre novo período com
 * preço congelado na data da renovação.
 */
export function applyRenewal(
  subscription: Subscription,
  now: string
): Subscription {
  const destino = subscription.scheduledDowngrade ?? {
    plan: subscription.plan,
    tier: subscription.tier,
  };

  const inicio = subscription.currentPeriodEnd;

  return {
    ...subscription,
    plan: destino.plan,
    tier: destino.tier,
    state: "active",
    priceSnapshot: capturePriceSnapshot(
      destino.plan,
      destino.tier,
      subscription.period,
      now
    ),
    currentPeriodStart: inicio,
    currentPeriodEnd: nextRenewalAt(inicio, subscription.period),
    paymentFailedAt: null,
    scheduledDowngrade: null,
  };
}

/**
 * CANCELAMENTO — vale ao fim do período pago. Até lá o acesso é normal, e
 * `resolveState` continua devolvendo `cancel_scheduled`.
 */
export function requestCancellation(subscription: Subscription): Subscription {
  return { ...subscription, state: "cancel_scheduled", scheduledDowngrade: null };
}

/** FALHA DE PAGAMENTO — abre a janela de 7 dias com acesso normal. */
export function registerPaymentFailure(
  subscription: Subscription,
  failedAt: string
): Subscription {
  return { ...subscription, paymentFailedAt: failedAt };
}

/** PAGAMENTO REGULARIZADO — fecha a janela de tolerância. */
export function registerPaymentRecovered(
  subscription: Subscription
): Subscription {
  return { ...subscription, state: "active", paymentFailedAt: null };
}

/** ENCERRAMENTO DEFINITIVO — seguem-se 12 meses de modo leitura. */
export function terminate(subscription: Subscription): Subscription {
  return { ...subscription, state: "terminated" };
}

// ─── Cronogramas de comunicação ────────────────────────────────────────────

/**
 * Avisos do trial: D−3, D−1 e o encerramento.
 *
 * Só o cronograma. Enviar é da Etapa 12D — aqui não há e-mail, fila nem
 * provider.
 */
export function trialNoticeSchedule(trialEnd: string): readonly string[] {
  return [addDays(trialEnd, -3), addDays(trialEnd, -1), trialEnd];
}

/** Avisos de cobrança: D−3, vencimento, D+1, D+4 e D+7. */
export function dunningNoticeSchedule(dueAt: string): readonly string[] {
  return [
    addDays(dueAt, -3),
    dueAt,
    addDays(dueAt, 1),
    addDays(dueAt, 4),
    addDays(dueAt, 7),
  ];
}

// ─── Construção ────────────────────────────────────────────────────────────

export interface StartTrialInput {
  readonly organizationId: string;
  readonly plan: PlanSlug;
  readonly tier: TierSlug;
  readonly period: BillingPeriod;
  readonly workerCount: number;
  /** CNPJ é obrigatório para iniciar o trial. */
  readonly cnpj: string;
  readonly startedAt: string;
}

/**
 * Inicia o trial de 7 dias, sem meio de pagamento, no plano ESCOLHIDO.
 *
 * O preço já é congelado aqui: o cliente testa o plano que contratou, e o valor
 * que verá ao fim do trial é o que estava na tabela quando começou.
 */
export function startTrial(input: StartTrialInput): Subscription {
  if (input.cnpj.trim() === "") {
    throw new Error("CNPJ é obrigatório para iniciar o trial");
  }

  const fim = trialEndsAt(input.startedAt);

  return {
    organizationId: input.organizationId,
    plan: input.plan,
    tier: input.tier,
    period: input.period,
    state: "trialing",
    priceSnapshot: capturePriceSnapshot(
      input.plan,
      input.tier,
      input.period,
      input.startedAt
    ),
    currentPeriodStart: input.startedAt,
    currentPeriodEnd: fim,
    trialEndsAt: fim,
    paymentFailedAt: null,
    scheduledDowngrade: null,
    workerCount: input.workerCount,
  };
}
