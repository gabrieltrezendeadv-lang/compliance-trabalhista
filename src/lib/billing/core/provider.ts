/**
 * CONTRATO DO PROVIDER DE COBRANÇA — Etapa 12B
 *
 * Contrato NOVO, deliberadamente separado de `src/lib/billing/types.ts`, que
 * descreve o provider antigo (Asaas) do modelo inerte. Aquele arquivo não é
 * tocado: mexer nele mudaria comportamento de código que a 12A deixou
 * declaradamente parado, e a 12B não autoriza isso.
 *
 * ── O QUE ESTE CONTRATO EXIGE E O ANTIGO NÃO EXIGIA ─────────────────────────
 *
 *   * valores em CENTAVOS inteiros (o antigo usava reais em `number`);
 *   * instante e identificador INJETADOS, nunca gerados dentro do provider;
 *   * resultado como `Result`, nunca exceção;
 *   * evento com identidade e instante próprios, para permitir idempotência e
 *     detecção de fora de ordem.
 *
 * Nenhuma implementação deste contrato pode abrir conexão de rede na 12B.
 */

import type { Result } from "./errors";
import type { ChargeMethod } from "./repository";

export interface ProviderCustomerInput {
  readonly organizationId: string;
  /** CNPJ, obrigatório pelo modelo aprovado. */
  readonly cnpj: string;
  readonly name: string;
  readonly email: string;
}

export interface ProviderCustomer {
  readonly externalCustomerId: string;
}

export interface ProviderChargeInput {
  readonly externalCustomerId: string;
  readonly amountCents: number;
  readonly method: ChargeMethod;
  readonly description: string;
  /** Vencimento, ISO 8601 UTC. */
  readonly dueAt: string;
  /** Chave de idempotência do comando, para o provider dedupe do lado dele. */
  readonly idempotencyKey: string;
}

export type ProviderChargeStatus = "pending" | "paid" | "failed" | "cancelled";

export interface ProviderCharge {
  readonly externalChargeId: string;
  readonly status: ProviderChargeStatus;
  readonly amountCents: number;
  /** Para PIX: o código copia-e-cola. NUNCA um dado de cartão. */
  readonly pixPayload: string | null;
}

export type ProviderEventType =
  | "charge_created"
  | "charge_paid"
  | "charge_failed"
  | "charge_cancelled"
  | "subscription_renewed";

/**
 * Evento normalizado do provider.
 *
 * `eventId` e `occurredAt` são o que torna possível provar idempotência e
 * ordem: sem identidade, duplicata é indetectável; sem instante, "fora de
 * ordem" não tem significado.
 */
export interface ProviderEvent {
  readonly eventId: string;
  readonly type: ProviderEventType;
  readonly externalChargeId: string;
  readonly occurredAt: string;
  readonly amountCents: number | null;
}

export interface BillingProviderPort {
  /** Nome curto e estável. Entra na chave de idempotência. */
  readonly name: string;

  createCustomer(input: ProviderCustomerInput): Promise<Result<ProviderCustomer>>;
  createCharge(input: ProviderChargeInput): Promise<Result<ProviderCharge>>;
  getCharge(externalChargeId: string): Promise<Result<ProviderCharge>>;
  cancelCharge(externalChargeId: string): Promise<Result<ProviderCharge>>;

  /**
   * Simulações — existem SOMENTE no mock.
   *
   * Estão no contrato, e não numa interface separada, para que o compilador
   * force qualquer implementação real futura a declarar explicitamente que não
   * as suporta (devolvendo `misconfigured`), em vez de herdá-las por engano.
   */
  simulatePayment(externalChargeId: string, occurredAt: string): Promise<Result<ProviderEvent>>;
  simulateFailure(externalChargeId: string, occurredAt: string): Promise<Result<ProviderEvent>>;
}
