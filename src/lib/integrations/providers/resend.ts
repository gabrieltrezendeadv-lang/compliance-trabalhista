/**
 * Resend Email Provider
 *
 * When RESEND_API_KEY is configured, this sends real emails via Resend.
 * Webhook verification uses Svix HMAC-SHA256 (ADR-004 approved).
 *
 * Docs: https://resend.com/docs/api-reference
 */

import type {
  MessageProvider,
  SendRequest,
  SendResult,
  WebhookEvent,
} from "../types"

export class ResendProvider implements MessageProvider {
  readonly name = "resend"
  readonly channel = "email" as const

  private apiKey: string
  private fromAddress: string
  private baseUrl = "https://api.resend.com"

  constructor(config: { apiKey: string; fromAddress: string }) {
    this.apiKey = config.apiKey
    this.fromAddress = config.fromAddress
  }

  async send(request: SendRequest): Promise<SendResult> {
    if (!request.recipientEmail) {
      return {
        success: false,
        status: "failed",
        error: {
          code: "MISSING_EMAIL",
          message: "recipientEmail is required",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      }
    }

    try {
      const response = await fetch(`${this.baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": request.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: [request.recipientEmail],
          subject: request.subject,
          html: request.bodyHtml ?? undefined,
          text: request.bodyText,
          tags: request.metadata
            ? Object.entries(request.metadata)
                .slice(0, 5)
                .map(([name, value]) => ({
                  name,
                  value: String(value),
                }))
            : undefined,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        const errorMessage =
          (errorBody as Record<string, string>).message ??
          `HTTP ${response.status}`
        return {
          success: false,
          status: response.status === 429 ? "failed" : "rejected",
          error: {
            code: `HTTP_${response.status}`,
            message: errorMessage,
            retryable: response.status === 429 || response.status >= 500,
          },
          timestamp: new Date().toISOString(),
        }
      }

      const result = (await response.json()) as { id: string }

      return {
        success: true,
        providerId: result.id,
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
    // Resend webhook events: email.sent, email.delivered, email.bounced,
    // email.complained, email.delivery_delayed, email.opened, email.clicked
    const eventType = payload.type as string | undefined
    if (!eventType?.startsWith("email.")) return null

    const data = payload.data as Record<string, unknown> | undefined
    if (!data) return null

    // SEC-006: Only map known status events. Unknown events return null.
    const statusMap: Record<string, WebhookEvent["status"]> = {
      "email.sent": "sent",
      "email.delivered": "delivered",
      "email.bounced": "bounced",
      "email.complained": "rejected",
      "email.delivery_delayed": "queued",
      "email.opened": "read",
    }

    const mappedStatus = statusMap[eventType]
    if (!mappedStatus) {
      // Unknown event type (e.g. email.clicked) — skip, don't default to "sent"
      return null
    }

    return {
      eventId: (payload.id as string) ?? crypto.randomUUID(),
      providerId: (data.email_id as string) ?? "",
      status: mappedStatus,
      timestamp:
        (payload.created_at as string) ?? new Date().toISOString(),
      rawEventType: eventType,
      error:
        eventType === "email.bounced"
          ? {
              code: "BOUNCE",
              message: (data.bounce_type as string) ?? "Unknown bounce",
            }
          : undefined,
      // SEC-006: No rawPayload — only sanitized metadata (no PII)
      metadata: {
        resend_event_type: eventType,
        resend_event_id: payload.id,
      },
    }
  }

  verifyWebhookSignature(
    payload: string,
    _signature: string,
    secret: string
  ): boolean {
    // SEC-006: Svix verification for Resend webhooks (ADR-004)
    try {
      // svix is imported dynamically to avoid bundling issues
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Webhook } = require("svix") as typeof import("svix")
      const wh = new Webhook(secret)
      // Svix needs the headers as an object; the caller passes them via
      // the signature parameter as a JSON string containing svix-id, svix-timestamp, svix-signature
      const headers = JSON.parse(_signature) as Record<string, string>
      wh.verify(payload, headers)
      return true
    } catch {
      return false
    }
  }
}
