/**
 * Webhook Handler — receives delivery status updates from providers
 *
 * POST /api/webhooks/resend     — Resend email webhooks (via Svix)
 * POST /api/webhooks/whatsapp   — WhatsApp Cloud API webhooks
 * GET  /api/webhooks/whatsapp   — WhatsApp webhook verification (hub.challenge)
 *
 * Flow:
 * 1. Verify webhook signature (provider-specific)
 * 2. Parse payload into normalized WebhookEvent
 * 3. Call fn_process_webhook_event RPC (transactional: find→update→log)
 *
 * Security (SEC-006):
 * - Signature verification required (except in dev/mock mode)
 * - Resend: Svix HMAC-SHA256 (headers passed as JSON to verifyWebhookSignature)
 * - WhatsApp: HMAC-SHA256 with crypto.timingSafeEqual
 * - No raw payload stored — only sanitized metadata (no PII)
 * - Transactional RPC ensures find→update→insert is atomic
 * - Idempotent: duplicate event_id is silently ignored
 */

import { createClient } from "@supabase/supabase-js"
import { resolveProvider } from "@/lib/integrations/registry"
import type { Channel } from "@/lib/integrations/types"

// Use service-role client for webhook processing (no user session)
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase service role configuration")
  }

  return createClient(url, serviceKey)
}

const PROVIDER_CHANNEL_MAP: Record<string, Channel> = {
  resend: "email",
  whatsapp: "whatsapp",
}

const WEBHOOK_SECRET_MAP: Record<string, string | undefined> = {
  resend: process.env.RESEND_WEBHOOK_SECRET,
  whatsapp: process.env.WHATSAPP_APP_SECRET,
}

/**
 * GET /api/webhooks/whatsapp — Meta webhook verification
 * Meta sends a GET request with hub.mode, hub.verify_token, hub.challenge
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params

  if (provider !== "whatsapp") {
    return Response.json({ error: "Not found" }, { status: 404 })
  }

  const url = new URL(request.url)
  const mode = url.searchParams.get("hub.mode")
  const token = url.searchParams.get("hub.verify_token")
  const challenge = url.searchParams.get("hub.challenge")

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[webhook/whatsapp] Verification successful")
    return new Response(challenge, { status: 200 })
  }

  console.warn("[webhook/whatsapp] Verification failed")
  return Response.json({ error: "Forbidden" }, { status: 403 })
}

/**
 * POST /api/webhooks/[provider] — receive delivery status webhooks
 *
 * SEC-006: Uses fn_process_webhook_event RPC for transactional,
 * idempotent processing. No raw payload is stored.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerName } = await params

  // 1. Validate provider
  const channel = PROVIDER_CHANNEL_MAP[providerName]
  if (!channel) {
    return Response.json(
      { error: `Unknown provider: ${providerName}` },
      { status: 404 }
    )
  }

  // 2. Read raw body for signature verification
  const rawBody = await request.text()
  let payload: Record<string, unknown>

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // 3. Verify signature (skip in dev when no secret is configured)
  const provider = resolveProvider(channel)
  const secret = WEBHOOK_SECRET_MAP[providerName]

  if (secret) {
    // SEC-006: Resend uses Svix — pass all svix-* headers as JSON string
    // WhatsApp uses x-hub-signature-256
    let signatureInput: string

    if (providerName === "resend") {
      // Svix verification needs svix-id, svix-timestamp, svix-signature as object
      const svixHeaders: Record<string, string> = {}
      for (const key of ["svix-id", "svix-timestamp", "svix-signature"]) {
        const val = request.headers.get(key)
        if (val) svixHeaders[key] = val
      }
      signatureInput = JSON.stringify(svixHeaders)
    } else {
      signatureInput = request.headers.get("x-hub-signature-256") ?? ""
    }

    const isValid = provider.verifyWebhookSignature(
      rawBody,
      signatureInput,
      secret
    )
    if (!isValid) {
      console.warn(
        `[webhook/${providerName}] Invalid signature — rejecting`
      )
      return Response.json({ error: "Invalid signature" }, { status: 401 })
    }
  } else {
    console.log(
      `[webhook/${providerName}] No webhook secret configured — skipping signature check (dev mode)`
    )
  }

  // 4. Parse webhook into normalized event
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const event = provider.parseWebhook(payload, headers)

  if (!event) {
    // Not a status event we care about (e.g. email.clicked, unknown WhatsApp status)
    return Response.json({ received: true })
  }

  // 5. Call fn_process_webhook_event RPC (transactional + idempotent)
  // SEC-006: The RPC handles find→update→log atomically, checks for
  // duplicate event_id, locks the delivery row with FOR UPDATE, and
  // stores only sanitized metadata (no PII).
  try {
    const supabase = getServiceClient()

    const { data, error } = await supabase.rpc("fn_process_webhook_event", {
      p_provider: providerName,
      p_event_id: event.eventId,
      p_provider_message_id: event.providerId,
      p_event_type: event.rawEventType,
      p_status: event.status,
      p_timestamp: event.timestamp,
      p_error_code: event.error?.code ?? null,
      p_error_message: event.error?.message ?? null,
      p_metadata: event.metadata ?? {},
    })

    if (error) {
      console.error(
        `[webhook/${providerName}] RPC fn_process_webhook_event error:`,
        error.message
      )
      return Response.json({ error: "Internal error" }, { status: 500 })
    }

    const result = data as {
      success: boolean
      action?: string
      error?: string
    }

    if (!result.success) {
      // Non-fatal — the RPC returns success=false for "no matching delivery"
      // or "duplicate event" — both are normal conditions
      console.log(
        `[webhook/${providerName}] RPC returned: ${result.action ?? result.error}`
      )
    } else {
      console.log(
        `[webhook/${providerName}] Processed event=${event.eventId} action=${result.action}`
      )
    }
  } catch (err) {
    console.error(`[webhook/${providerName}] Unexpected error:`, err)
    return Response.json({ error: "Internal error" }, { status: 500 })
  }

  return Response.json({ received: true })
}
