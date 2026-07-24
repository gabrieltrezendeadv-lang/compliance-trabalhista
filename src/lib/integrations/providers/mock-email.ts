/**
 * Mock Email Provider
 *
 * Simulates email sending for development and testing.
 * All sends succeed after a small delay. Idempotent by idempotencyKey.
 * Webhook parsing returns null (no real webhooks in mock mode).
 */

import type {
  MessageProvider,
  SendRequest,
  SendResult,
  WebhookEvent,
} from "../types"

const sentMessages = new Map<string, SendResult>()

export class MockEmailProvider implements MessageProvider {
  readonly name = "mock-email"
  readonly channel = "email" as const

  async send(request: SendRequest): Promise<SendResult> {
    // Idempotency check
    const existing = sentMessages.get(request.idempotencyKey)
    if (existing) {
      console.log(
        `[mock-email] Idempotent hit for key=${request.idempotencyKey}`
      )
      return existing
    }

    // Simulate network delay (50-200ms)
    await new Promise((resolve) =>
      setTimeout(resolve, 50 + Math.random() * 150)
    )

    // Validate required fields
    if (!request.recipientEmail) {
      const result: SendResult = {
        success: false,
        status: "failed",
        error: {
          code: "MISSING_EMAIL",
          message: "recipientEmail is required for email channel",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      }
      sentMessages.set(request.idempotencyKey, result)
      return result
    }

    // Simulate failure for specific test addresses
    if (request.recipientEmail.includes("bounce@")) {
      const result: SendResult = {
        success: false,
        providerId: `mock_${crypto.randomUUID().slice(0, 8)}`,
        status: "bounced",
        error: {
          code: "HARD_BOUNCE",
          message: "Simulated bounce for test address",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      }
      sentMessages.set(request.idempotencyKey, result)
      return result
    }

    if (request.recipientEmail.includes("fail@")) {
      const result: SendResult = {
        success: false,
        providerId: `mock_${crypto.randomUUID().slice(0, 8)}`,
        status: "failed",
        error: {
          code: "DELIVERY_FAILED",
          message: "Simulated delivery failure for test address",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      }
      sentMessages.set(request.idempotencyKey, result)
      return result
    }

    // Success case
    const result: SendResult = {
      success: true,
      providerId: `mock_email_${crypto.randomUUID().slice(0, 12)}`,
      status: "sent",
      timestamp: new Date().toISOString(),
    }

    sentMessages.set(request.idempotencyKey, result)

    console.log(
      `[mock-email] Sent to=${request.recipientEmail} subject="${request.subject}" providerId=${result.providerId}`
    )

    return result
  }

  parseWebhook(
    _payload: Record<string, unknown>,
    _headers: Record<string, string>
  ): WebhookEvent | null {
    // Mock provider doesn't receive real webhooks
    return null
  }

  verifyWebhookSignature(
    _payload: string,
    _signature: string,
    _secret: string
  ): boolean {
    return true
  }
}

/**
 * Get all messages sent by the mock provider (for testing/debugging)
 */
export function getMockEmailSentMessages(): Map<string, SendResult> {
  return new Map(sentMessages)
}

/**
 * Clear the mock sent messages store
 */
export function clearMockEmailMessages(): void {
  sentMessages.clear()
}
