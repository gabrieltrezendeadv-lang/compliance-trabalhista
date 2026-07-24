/**
 * Mock Billing Provider
 *
 * Used when ASAAS_API_KEY is not configured.
 * Simulates customer creation, subscriptions, and webhook parsing.
 */

import type {
  BillingProvider,
  BillingWebhookEvent,
  CreateCustomerRequest,
  CreateCustomerResult,
  CreateSubscriptionRequest,
  CreateSubscriptionResult,
} from "../types"

export class MockBillingProvider implements BillingProvider {
  readonly name = "mock-billing"

  async createCustomer(
    request: CreateCustomerRequest
  ): Promise<CreateCustomerResult> {
    console.log(`[mock-billing] createCustomer: ${request.name} (${request.cpfCnpj})`)
    return {
      success: true,
      customerId: `mock_cus_${crypto.randomUUID().slice(0, 8)}`,
    }
  }

  async createSubscription(
    request: CreateSubscriptionRequest
  ): Promise<CreateSubscriptionResult> {
    console.log(
      `[mock-billing] createSubscription: ${request.customerId} — R$${request.value} ${request.cycle}`
    )
    return {
      success: true,
      subscriptionId: `mock_sub_${crypto.randomUUID().slice(0, 8)}`,
    }
  }

  async cancelSubscription(
    subscriptionId: string
  ): Promise<{ success: boolean; error?: string }> {
    console.log(`[mock-billing] cancelSubscription: ${subscriptionId}`)
    return { success: true }
  }

  parseWebhook(
    payload: Record<string, unknown>,
    _headers: Record<string, string>
  ): BillingWebhookEvent | null {
    const event = payload.event as string | undefined
    if (!event) return null

    return {
      eventId: crypto.randomUUID(),
      eventType: "UNKNOWN",
      rawPayload: payload,
    }
  }

  verifyWebhookSignature(
    _payload: string,
    _token: string,
    _secret: string
  ): boolean {
    // Mock always accepts
    return true
  }
}
