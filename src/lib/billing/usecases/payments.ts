/**
 * CASOS DE USO DE PAGAMENTO — checkout simulado, confirmação, falha e
 * tolerância.
 *
 * Nenhuma chamada de rede: o provider é o mock determinístico. Nenhum dado de
 * cartão entra aqui, nem sai para a auditoria.
 *
 * ── AS DUAS REGRAS QUE GOVERNAM TODO O ARQUIVO ──────────────────────────────
 *
 * 1. IDEMPOTÊNCIA. Todo efeito passa por uma chave reservada no banco. Evento
 *    repetido devolve o resultado anterior sem repetir a cobrança, o snapshot
 *    ou a transição.
 *
 * 2. ORDEM. Todo evento carrega o instante do provider. Evento anterior ao
 *    período vigente é RECUSADO — um pagamento atrasado de um ciclo antigo não
 *    pode reativar o ciclo atual.
 */

import { fail, ok, type Result } from "../core/errors";
import type { ProviderEvent } from "../core/provider";
import type { Charge, ChargeMethod, StoredSubscription } from "../core/repository";
import { resolveState, toleranceEndsAt } from "../plans/lifecycle";
import { priceCents } from "../plans/pricing";
import { assertTenant, auditar, exigirAssinatura, reservar, type UseCaseEnv } from "./shared";
import type { ComandoBase } from "./subscription";

function ms(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`instante inválido: ${iso}`);
  return t;
}

// ─── 9. createMockCheckout ─────────────────────────────────────────────────

export interface CheckoutInput extends ComandoBase {
  readonly method: ChargeMethod;
  readonly idempotencyKey: string;
  readonly customerName: string;
  readonly customerEmail: string;
}

export interface CheckoutResult {
  readonly charge: Charge;
  readonly pixPayload: string | null;
}

/**
 * Cria a cobrança do período vigente no provider MOCK e a registra.
 *
 * A ordem importa e é deliberada: reservar a chave, garantir o cliente, criar
 * no provider, registrar no banco. Se o provider criar e falhar ao responder
 * (cenário `unavailable_after_persist`), a chave já está reservada — e a
 * repetição com a MESMA chave devolve o resultado anterior em vez de criar uma
 * segunda cobrança.
 */
export async function createMockCheckout(
  env: UseCaseEnv,
  input: CheckoutInput
): Promise<Result<CheckoutResult>> {
  const negado = assertTenant<CheckoutResult>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  if (input.idempotencyKey.trim() === "") {
    return fail("invalid_input", "chave de idempotência é obrigatória no checkout");
  }

  const assinatura = await exigirAssinatura(env);
  if (!assinatura.ok) return assinatura;
  const sub = assinatura.value;

  const valor = priceCents(sub.plan, sub.tier, sub.period);
  if (valor === null) {
    return fail("invalid_state", "faixa Enterprise não tem checkout automático");
  }

  const reserva = await reservar(env, {
    scope: "command",
    key: input.idempotencyKey,
    result: { intent: "checkout", amountCents: valor },
  });
  if (!reserva.ok) return reserva;

  if (!reserva.value.novo) {
    // Idempotência de verdade: a repetição devolve a MESMA cobrança, achada
    // pela chave do comando. Só quando não há cobrança gravada — o provider
    // criou e falhou ao responder, por exemplo — é que se recusa.
    const existente = await env.repo.findChargeByIdempotencyKey(
      env.auth.organizationId,
      input.idempotencyKey
    );
    if (!existente.ok) return existente;
    if (existente.value) {
      return ok({ charge: existente.value, pixPayload: null });
    }
    return fail("duplicate_event", "checkout já iniciado com esta chave, sem cobrança gravada");
  }

  // Cliente no provider — idempotente por (organização, provider).
  const jaCliente = await env.repo.findCustomer(env.auth.organizationId, env.provider.name);
  if (!jaCliente.ok) return jaCliente;

  let externalCustomerId = jaCliente.value?.externalCustomerId ?? null;
  if (externalCustomerId === null) {
    const criado = await env.provider.createCustomer({
      organizationId: env.auth.organizationId,
      cnpj: sub.cnpj,
      name: input.customerName,
      email: input.customerEmail,
    });
    if (!criado.ok) return criado;
    externalCustomerId = criado.value.externalCustomerId;

    const salvo = await env.repo.saveCustomer({
      organizationId: env.auth.organizationId,
      provider: env.provider.name,
      externalCustomerId,
      createdAt: env.clock.now(),
    });
    if (!salvo.ok) return salvo;
    externalCustomerId = salvo.value.externalCustomerId;
  }

  const cobranca = await env.provider.createCharge({
    externalCustomerId,
    amountCents: valor,
    method: input.method,
    description: `Neo SST — ${sub.plan} ${sub.period}`,
    dueAt: sub.currentPeriodEnd,
    idempotencyKey: input.idempotencyKey,
  });
  if (!cobranca.ok) return cobranca;

  const registrada = await env.repo.createCharge({
    organizationId: env.auth.organizationId,
    subscriptionId: sub.id,
    provider: env.provider.name,
    externalChargeId: cobranca.value.externalChargeId,
    method: input.method,
    amountCents: valor,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
    createdAt: env.clock.now(),
    idempotencyKey: input.idempotencyKey,
  });
  if (!registrada.ok) return registrada;

  const trilha = await auditar(env, {
    subject: "charge",
    subscriptionId: sub.id,
    previousValue: null,
    newValue: {
      externalChargeId: registrada.value.externalChargeId,
      amountCents: valor,
      method: input.method,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
    },
    idempotencyKey: input.idempotencyKey,
  });
  if (!trilha.ok) return trilha;

  return ok({ charge: registrada.value, pixPayload: cobranca.value.pixPayload });
}

// ─── Guarda de evento: idempotência + ordem ────────────────────────────────

interface EventoAceito {
  readonly charge: Charge;
  readonly sub: StoredSubscription;
}

/**
 * Aceita um evento do provider, ou explica por que não.
 *
 * Três recusas, nesta ordem:
 *   * chave já processada → `duplicate_event`;
 *   * cobrança desconhecida para esta organização → `not_found`;
 *   * evento anterior ao início do período vigente → `out_of_order_event`.
 *
 * A terceira é a que impede um pagamento atrasado de reativar um período
 * posterior: o evento pertence ao ciclo em que a cobrança foi emitida, e não ao
 * ciclo em que ele chegou.
 */
async function aceitarEvento(
  env: UseCaseEnv,
  evento: ProviderEvent,
  resultado: Record<string, unknown>
): Promise<Result<EventoAceito | null>> {
  const assinatura = await exigirAssinatura(env);
  if (!assinatura.ok) return assinatura;

  const reserva = await reservar(env, {
    scope: "provider_event",
    key: evento.eventId,
    result: resultado,
  });
  if (!reserva.ok) return reserva;
  if (!reserva.value.novo) return ok(null);

  const cobranca = await env.repo.findChargeByExternalId(
    env.auth.organizationId,
    env.provider.name,
    evento.externalChargeId
  );
  if (!cobranca.ok) return cobranca;
  if (!cobranca.value) {
    return fail("not_found", "cobrança desconhecida para esta organização");
  }

  if (ms(evento.occurredAt) < ms(cobranca.value.periodStart)) {
    return fail("out_of_order_event", "evento anterior ao período da cobrança", {
      eventoEm: evento.occurredAt,
      periodoInicio: cobranca.value.periodStart,
    });
  }

  if (ms(cobranca.value.periodEnd) <= ms(assinatura.value.currentPeriodStart)) {
    return fail("out_of_order_event", "cobrança de período já encerrado", {
      cobrancaFim: cobranca.value.periodEnd,
      periodoAtualInicio: assinatura.value.currentPeriodStart,
    });
  }

  return ok({ charge: cobranca.value, sub: assinatura.value });
}

// ─── 10. recordPaymentSucceeded ────────────────────────────────────────────

export async function recordPaymentSucceeded(
  env: UseCaseEnv,
  evento: ProviderEvent
): Promise<Result<StoredSubscription>> {
  const aceito = await aceitarEvento(env, evento, { tipo: "charge_paid" });
  if (!aceito.ok) return aceito;

  // Duplicata: nada é repetido, e o estado atual é devolvido.
  if (aceito.value === null) {
    const atual = await exigirAssinatura(env);
    return atual;
  }

  const { charge, sub } = aceito.value;

  const paga = await env.repo.markChargePaid(
    env.auth.organizationId,
    charge.id,
    evento.occurredAt
  );
  if (!paga.ok) return paga;

  const atualizada = await env.repo.updateSubscription(env.auth.organizationId, {
    state: "active",
    paymentFailedAt: null,
  });
  if (!atualizada.ok) return atualizada;

  const trilha = await auditar(env, {
    subject: "payment",
    subscriptionId: sub.id,
    previousValue: { state: sub.state, chargeStatus: charge.status },
    newValue: {
      state: "active",
      chargeStatus: "paid",
      externalChargeId: charge.externalChargeId,
      amountCents: charge.amountCents,
    },
    idempotencyKey: evento.eventId,
  });
  if (!trilha.ok) return trilha;

  return ok(atualizada.value);
}

// ─── 11. recordPaymentFailed ───────────────────────────────────────────────

/**
 * Falha de pagamento abre a janela de tolerância: 7 dias com ACESSO NORMAL.
 * Não é acesso degradado — é o que o modelo aprovado determina.
 */
export async function recordPaymentFailed(
  env: UseCaseEnv,
  evento: ProviderEvent
): Promise<Result<StoredSubscription>> {
  const aceito = await aceitarEvento(env, evento, { tipo: "charge_failed" });
  if (!aceito.ok) return aceito;

  if (aceito.value === null) {
    const atual = await exigirAssinatura(env);
    return atual;
  }

  const { charge, sub } = aceito.value;

  const falhou = await env.repo.markChargeFailed(
    env.auth.organizationId,
    charge.id,
    evento.occurredAt
  );
  if (!falhou.ok) return falhou;

  const atualizada = await env.repo.updateSubscription(env.auth.organizationId, {
    state: "past_due_tolerance",
    paymentFailedAt: evento.occurredAt,
  });
  if (!atualizada.ok) return atualizada;

  const trilha = await auditar(env, {
    subject: "payment",
    subscriptionId: sub.id,
    previousValue: { state: sub.state },
    newValue: {
      state: "past_due_tolerance",
      toleranciaAte: toleranceEndsAt(evento.occurredAt),
      externalChargeId: charge.externalChargeId,
    },
    idempotencyKey: evento.eventId,
  });
  if (!trilha.ok) return trilha;

  return ok(atualizada.value);
}

// ─── 12. advanceGracePeriod ────────────────────────────────────────────────

/**
 * Encerra a tolerância vencida: a conta vai para MODO LEITURA.
 *
 * Recusa se a tolerância ainda corre — a transição é derivada da data, não da
 * vontade de quem chama.
 */
export async function advanceGracePeriod(
  env: UseCaseEnv,
  input: ComandoBase = {}
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;

  if (atual.value.paymentFailedAt === null) {
    return fail("invalid_state", "não há falha de pagamento em curso");
  }
  if (resolveState(atual.value, env.clock.now()) !== "read_only") {
    return fail("invalid_state", "a tolerância de 7 dias ainda não venceu");
  }

  const atualizada = await env.repo.updateSubscription(env.auth.organizationId, {
    state: "read_only",
  });
  if (!atualizada.ok) return atualizada;

  const trilha = await auditar(env, {
    subject: "subscription_state",
    subscriptionId: atual.value.id,
    previousValue: { state: atual.value.state, paymentFailedAt: atual.value.paymentFailedAt },
    newValue: { state: "read_only" },
    reason: "tolerância de 7 dias encerrada sem regularização",
  });
  if (!trilha.ok) return trilha;

  return ok(atualizada.value);
}
