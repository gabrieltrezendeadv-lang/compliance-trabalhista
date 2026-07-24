/**
 * WhatsApp Cloud API Provider (stub — ready for Meta credentials)
 *
 * Sends messages via Meta's WhatsApp Cloud API.
 * Webhook verification uses HMAC-SHA256 with app secret.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import crypto from "crypto"
import type {
  MessageProvider,
  SendRequest,
  SendResult,
  WebhookEvent,
} from "../types"

export class WhatsAppCloudProvider implements MessageProvider {
  readonly name = "whatsapp-cloud"
  readonly channel = "whatsapp" as const

  private accessToken: string
  private phoneNumberId: string
  private apiVersion = "v20.0"
  private baseUrl = "https://graph.facebook.com"

  constructor(config: { accessToken: string; phoneNumberId: string }) {
    this.accessToken = config.accessToken
    this.phoneNumberId = config.phoneNumberId
  }

  async send(request: SendRequest): Promise<SendResult> {
    if (!request.recipientPhone) {
      return {
        success: false,
        status: "failed",
        error: {
          code: "MISSING_PHONE",
          message: "recipientPhone is required for WhatsApp",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      }
    }

    // Strip + prefix for WhatsApp API
    const phone = request.recipientPhone.replace(/^\+/, "")

    try {
      // If template is provided, send template message
      // Otherwise, send text message (only works in 24h session window)
      const messageBody = request.templateName
        ? {
            messaging_product: "whatsapp",
            to: phone,
            type: "template",
            template: {
              name: request.templateName,
              language: { code: "pt_BR" },
              components: request.templateParams
                ? [
                    {
                      type: "body",
                      parameters: Object.values(
                        request.templateParams
                      ).map((value) => ({ type: "text", text: value })),
                    },
                  ]
                : undefined,
            },
          }
        : {
            messaging_product: "whatsapp",
            to: phone,
            type: "text",
            text: { body: request.bodyText },
          }

      const response = await fetch(
        `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(messageBody),
        }
      )

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        const error = (errorBody as { error?: { message?: string; code?: number } })
          .error
        return {
          success: false,
          status: response.status === 429 ? "failed" : "rejected",
          error: {
            code: String(error?.code ?? response.status),
            message: error?.message ?? `HTTP ${response.status}`,
            retryable: response.status === 429 || response.status >= 500,
          },
          timestamp: new Date().toISOString(),
        }
      }

      const result = (await response.json()) as {
        messages?: Array<{ id: string }>
      }
      const messageId = result.messages?.[0]?.id

      return {
        success: true,
        providerId: messageId,
        status: "sent",
        timestamp: new Date().toISOString(),
      }
    } catch (err) {
      return {
        success: false,
        status: "failed",
        error: {
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Unknown error",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      }
    }
  }

  parseWebhook(
    payload: Record<string, unknown>,
    _headers: Record<string, string>
  ): WebhookEvent | null {
    // WhatsApp webhook structure:
    // { entry: [{ changes: [{ value: { statuses: [...] } }] }] }
    const entry = (payload.entry as Array<Record<string, unknown>>)?.[0]
    const changes = (entry?.changes as Array<Record<string, unknown>>)?.[0]
    const value = changes?.value as Record<string, unknown> | undefined
    const statuses = value?.statuses as
      | Array<Record<string, unknown>>
      | undefined
    const status = statuses?.[0]
    if (!status) return null

    const statusMap: Record<string, WebhookEvent["status"]> = {
      sent: "sent",
      delivered: "delivered",
      read: "read",
      failed: "failed",
    }

    const errors = (status.errors as Array<{ code: number; title: string }>) ?? []

    return {
      eventId: crypto.randomUUID(),
      providerId: (status.id as string) ?? "",
      status: statusMap[status.status as string] ?? "sent",
      timestamp:
        (status.timestamp as string) ?? new Date().toISOString(),
      rawEventType: `whatsapp.${status.status}`,
      error: errors.length
        ? {
            code: String(errors[0].code),
            message: errors[0].title,
          }
        : undefined,
      rawPayload: payload,
    }
  }

  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    // Meta uses HMAC-SHA256 with app secret
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex")

    return `sha256=${expectedSignature}` === signature
  }
}
