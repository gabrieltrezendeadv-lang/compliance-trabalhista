/**
 * Asaas Billing Provider
 *
 * Integrates with the Asaas API for Brazilian payment methods
 * (boleto, PIX, credit card) and recurring subscriptions.
 *
 * ADR-004: Interface abstrata BillingProvider
 * ADR-005: Eventos de pagamento para máquina de estados
 *
 * Docs: https://docs.asaas.com/reference
 */

import type {
  BillingProvider,
  BillingWebhookEvent,
  BillingEventType,
  CreateCustomerRequest,
  CreateCustomerResult,
  CreateSubscriptionRequest,
  CreateSubscriptionResult,
} from "../types"

const BILLING_TYPE_MAP: Record<string, string> = {
  boleto: "BOLETO",
  pix: "PIX",
  credit_card: "CREDIT_CARD",
}

export class AsaasProvider implements BillingProvider {
  readonly name = "asaas"

  private apiKey: string
  private baseUrl: string

  constructor(config: { apiKey: string; sandbox?: boolean }) {
    this.apiKey = config.apiKey
    this.baseUrl = config.sandbox
      ? "https://sandbox.asaas.com/api/v3"
      : "https://api.asaas.com/api/v3"
  }

  // ─── Create Customer ──────────────────────────────────────────────────

  async createCustomer(
    request: CreateCustomerRequest
  ): Promise<CreateCustomerResult> {
    try {
      const response = await fetch(`${this.baseUrl}/customers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          access_token: this.apiKey,
        },
        body: JSON.stringify({
          name: request.name,
          email: request.email,
          cpfCnpj: request.cpfCnpj,
          phone: request.phone,
          mobilePhone: request.mobilePhone,
          postalCode: request.postalCode,
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        const errors = (err as { errors?: Array<{ description: string }> })
          .errors
        return {
          success: false,
          error: errors?.[0]?.description ?? `HTTP ${response.status}`,
        }
      }

      const data = (await response.json()) as { id: string }
      return { success: true, customerId: data.id }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erro de rede",
      }
    }
  }

  // ─── Create Subscription ──────────────────────────────────────────────

  async createSubscription(
    request: CreateSubscriptionRequest
  ): Promise<CreateSubscriptionResult> {
    try {
      const billingType =
        BILLING_TYPE_MAP[request.billingType] ?? request.billingType

      const response = await fetch(`${this.baseUrl}/subscriptions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          access_token: this.apiKey,
        },
        body: JSON.stringify({
          customer: request.customerId,
          billingType,
          value: request.value,
          cycle: request.cycle,
          description: request.description,
          externalReference: request.externalReference,
          nextDueDate: request.nextDueDate,
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        const errors = (err as { errors?: Array<{ description: string }> })
          .errors
        return {
          success: false,
          error: errors?.[0]?.description ?? `HTTP ${response.status}`,
        }
      }

      const data = (await response.json()) as { id: string }
      return { success: true, subscriptionId: data.id }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erro de rede",
      }
    }
  }

  // ─── Cancel Subscription ──────────────────────────────────────────────

  async cancelSubscription(
    subscriptionId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(
        `${this.baseUrl}/subscriptions/${subscriptionId}`,
        {
          method: "DELETE",
          headers: { access_token: this.apiKey },
        }
      )

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return {
          success: false,
          error:
            (err as { errors?: Array<{ description: string }> }).errors?.[0]
              ?.description ?? `HTTP ${response.status}`,
        }
      }

      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erro de rede",
      }
    }
  }

  // ─── Parse Webhook ────────────────────────────────────────────────────

  parseWebhook(
    payload: Record<string, unknown>,
    _headers: Record<string, string>
  ): BillingWebhookEvent | null {
    const event = payload.event as string | undefined
    if (!event) return null

    const payment = payload.payment as Record<string, unknown> | undefined

    const eventTypeMap: Record<string, BillingEventType> = {
      PAYMENT_CONFIRMED: "PAYMENT_CONFIRMED",
      PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
      PAYMENT_OVERDUE: "PAYMENT_OVERDUE",
      PAYMENT_DELETED: "PAYMENT_DELETED",
      PAYMENT_REFUNDED: "PAYMENT_REFUNDED",
      PAYMENT_CREATED: "PAYMENT_CREATED",
      PAYMENT_UPDATED: "PAYMENT_UPDATED",
    }

    return {
      eventId: (payment?.id as string) ?? crypto.randomUUID(),
      eventType: eventTypeMap[event] ?? "UNKNOWN",
      externalPaymentId: payment?.id as string | undefined,
      externalSubscriptionId: payment?.subscription as string | undefined,
      externalCustomerId: payment?.customer as string | undefined,
      value: payment?.value as number | undefined,
      dueDate: payment?.dueDate as string | undefined,
      paymentDate: payment?.paymentDate as string | undefined,
      billingType: payment?.billingType as string | undefined,
      status: payment?.status as string | undefined,
      rawPayload: payload,
    }
  }

  // ─── Verify Webhook Signature ─────────────────────────────────────────

  verifyWebhookSignature(
    _payload: string,
    token: string,
    secret: string
  ): boolean {
    // Asaas uses a webhook access token sent in the
    // "asaas-access-token" header. Compare with the configured secret.
    return token === secret
  }
}
