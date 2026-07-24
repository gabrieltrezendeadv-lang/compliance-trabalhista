/**
 * Mock WhatsApp Provider
 *
 * Simulates WhatsApp Cloud API sending for development.
 * Validates phone format, simulates template requirement for proactive messages.
 */

import type {
  MessageProvider,
  SendRequest,
  SendResult,
  WebhookEvent,
} from "../types"

const sentMessages = new Map<string, SendResult>()

export class MockWhatsAppProvider implements MessageProvider {
  readonly name = "mock-whatsapp"
  readonly channel = "whatsapp" as const

  async send(request: SendRequest): Promise<SendResult> {
    // Idempotency check
    const existing = sentMessages.get(request.idempotencyKey)
    if (existing) {
      console.log(
        `[mock-whatsapp] Idempotent hit for key=${request.idempotencyKey}`
      )
      return existing
    }

    // Simulate network delay
    await new Promise((resolve) =>
      setTimeout(resolve, 100 + Math.random() * 200)
    )

    // Validate phone
    if (!request.recipientPhone) {
      const result: SendResult = {
        success: false,
        status: "failed",
        error: {
          code: "MISSING_PHONE",
          message: "recipientPhone is required for WhatsApp channel",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      }
      sentMessages.set(request.idempotencyKey, result)
      return result
    }

    // Validate E.164 format
    if (!/^\+\d{10,15}$/.test(request.recipientPhone)) {
      const result: SendResult = {
        success: false,
        status: "rejected",
        error: {
          code: "INVALID_PHONE_FORMAT",
          message: `Phone must be E.164 format (e.g. +5511999998888), got: ${request.recipientPhone}`,
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      }
      sentMessages.set(request.idempotencyKey, result)
      return result
    }

    // Simulate: WhatsApp requires template for proactive messages
    if (!request.templateName) {
      console.log(
        `[mock-whatsapp] Warning: no templateName provided. In production, proactive messages require an approved template.`
      )
    }

    // Simulate failure for specific test numbers
    if (request.recipientPhone.endsWith("0000")) {
      const result: SendResult = {
        success: false,
        providerId: `mock_wa_${crypto.randomUUID().slice(0, 8)}`,
        status: "failed",
        error: {
          code: "RECIPIENT_NOT_ON_WHATSAPP",
          message: "Simulated: recipient number not registered on WhatsApp",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      }
      sentMessages.set(request.idempotencyKey, result)
      return result
    }

    // Success
    const result: SendResult = {
      success: true,
      providerId: `mock_wa_${crypto.randomUUID().slice(0, 12)}`,
      status: "sent",
      timestamp: new Date().toISOString(),
    }

    sentMessages.set(request.idempotencyKey, result)

    console.log(
      `[mock-whatsapp] Sent to=${request.recipientPhone} template=${request.templateName ?? "(none)"} providerId=${result.providerId}`
    )

    return result
  }

  parseWebhook(
    _payload: Record<string, unknown>,
    _headers: Record<string, string>
  ): WebhookEvent | null {
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

export function getMockWhatsAppSentMessages(): Map<string, SendResult> {
  return new Map(sentMessages)
}

export function clearMockWhatsAppMessages(): void {
  sentMessages.clear()
}
