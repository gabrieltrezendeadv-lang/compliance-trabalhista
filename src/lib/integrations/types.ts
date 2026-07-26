/**
 * Integrations Module — Abstract interfaces for message providers
 *
 * Follows ADR-004: provedores de integração.
 * All providers implement MessageProvider so the business logic
 * is decoupled from the specific service (Resend, WhatsApp Cloud API, etc.)
 */

// ─── Delivery Status (normalized across providers) ─────────────────────────
export type DeliveryStatus =
  | "pending"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "bounced"
  | "rejected"

// ─── Channel ───────────────────────────────────────────────────────────────
export type Channel = "email" | "whatsapp"

// ─── Send Request ──────────────────────────────────────────────────────────
export interface SendRequest {
  /** Unique key to prevent duplicate sends (idempotency) */
  idempotencyKey: string
  /** Recipient display name */
  recipientName: string
  /** Recipient email (for email channel) */
  recipientEmail?: string
  /** Recipient phone in E.164 format (for WhatsApp channel) */
  recipientPhone?: string
  /** Message subject (email only) */
  subject: string
  /** Plain text body */
  bodyText: string
  /** HTML body (email only) */
  bodyHtml?: string
  /** WhatsApp template name (WhatsApp only — for messages outside 24h window) */
  templateName?: string
  /** WhatsApp template parameters */
  templateParams?: Record<string, string>
  /** Legal basis text to include in footer */
  legalBasis?: string
  /** Metadata passed through to webhooks */
  metadata?: Record<string, unknown>
}

// ─── Send Result ───────────────────────────────────────────────────────────
export interface SendResult {
  success: boolean
  /** Provider-assigned message ID */
  providerId?: string
  /** Normalized status after send attempt */
  status: DeliveryStatus
  /** Error details if failed */
  error?: {
    code: string
    message: string
    retryable: boolean
  }
  /** Timestamp of the send attempt */
  timestamp: string
}

// ─── Webhook Event (normalized from provider) ──────────────────────────────
export interface WebhookEvent {
  /** Provider-assigned event ID (for deduplication) */
  eventId: string
  /** Provider-assigned message ID */
  providerId: string
  /** Normalized status */
  status: DeliveryStatus
  /** ISO timestamp from provider */
  timestamp: string
  /** Raw provider event type (e.g. "email.delivered", "messages.status") */
  rawEventType: string
  /** Error info if status is failed/bounced/rejected */
  error?: {
    code: string
    message: string
  }
  // SEC-006: rawPayload removed — PII risk per NEO SST.
  // Only sanitized metadata is stored in webhook_events.payload.
  // Provider-specific metadata (no PII) for audit trail:
  metadata?: Record<string, unknown>
}

// ─── Message Provider Interface ────────────────────────────────────────────
export interface MessageProvider {
  /** Provider name for logging and config lookup */
  readonly name: string
  /** Channel this provider handles */
  readonly channel: Channel

  /**
   * Send a single message.
   * Must be idempotent: sending with the same idempotencyKey
   * should return the same result without re-sending.
   */
  send(request: SendRequest): Promise<SendResult>

  /**
   * Parse and normalize an incoming webhook payload.
   * Returns null if the payload doesn't match this provider.
   */
  parseWebhook(
    payload: Record<string, unknown>,
    headers: Record<string, string>
  ): WebhookEvent | null

  /**
   * Verify webhook signature.
   * Returns true if the signature is valid.
   */
  verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean
}

// ─── Provider Configuration ────────────────────────────────────────────────
export interface ProviderConfig {
  /** Provider implementation name (e.g. "resend", "whatsapp-cloud", "mock") */
  provider: string
  /** API key or access token (encrypted at rest) */
  apiKey?: string
  /** Webhook secret for signature verification */
  webhookSecret?: string
  /** Provider-specific settings */
  settings?: Record<string, unknown>
}

// ─── Campaign Send Job ────────────────────────────────────────────────────
export interface CampaignSendJob {
  campaignId: string
  tenantId: string
  channel: Channel
  deliveries: Array<{
    deliveryId: string
    recipientId: string
    recipientName: string
    recipientEmail?: string
    recipientPhone?: string
    idempotencyKey: string
  }>
  subject: string
  bodyText: string
  bodyHtml?: string
  legalBasis?: string
}

// ─── Send Campaign Result ──────────────────────────────────────────────────
export interface CampaignSendResult {
  campaignId: string
  totalSent: number
  totalFailed: number
  results: Array<{
    deliveryId: string
    recipientId: string
    status: DeliveryStatus
    providerId?: string
    error?: string
  }>
}
