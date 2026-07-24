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
 * 3. Find matching campaign_delivery by provider_id
 * 4. Update delivery status in database
 *
 * Security:
 * - Signature verification required (except in dev/mock mode)
 * - No tenant_id from frontend — resolved via provider_id lookup
 * - Raw payloads stored for audit trail
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
    const signature =
      request.headers.get("x-hub-signature-256") ?? // WhatsApp
      request.headers.get("svix-signature") ?? // Resend
      ""

    const isValid = provider.verifyWebhookSignature(rawBody, signature, secret)
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
    // Not a status event we care about (e.g. email.clicked)
    return Response.json({ received: true })
  }

  // 5. Find matching delivery by provider_id
  try {
    const supabase = getServiceClient()

    const { data: delivery, error: findError } = await supabase
      .from("campaign_deliveries")
      .select("id, campaign_id, status")
      .eq("provider_id", event.providerId)
      .limit(1)
      .maybeSingle()

    if (findError) {
      console.error(
        `[webhook/${providerName}] DB error finding delivery:`,
        findError.message
      )
      return Response.json({ error: "Internal error" }, { status: 500 })
    }

    if (!delivery) {
      // Could be a message not sent through our system
      console.log(
        `[webhook/${providerName}] No delivery found for providerId=${event.providerId}`
      )
      return Response.json({ received: true })
    }

    // 6. Update delivery status (only advance forward, never regress)
    const statusOrder = [
      "pending",
      "queued",
      "sent",
      "delivered",
      "read",
    ]
    const terminalStatuses = ["failed", "bounced", "rejected"]

    const currentIdx = statusOrder.indexOf(delivery.status)
    const newIdx = statusOrder.indexOf(event.status)
    const isTerminal = terminalStatuses.includes(event.status)

    // Only update if new status is "higher" or terminal
    if (isTerminal || newIdx > currentIdx) {
      const updateData: Record<string, unknown> = {
        status: event.status,
      }

      if (event.status === "delivered") {
        updateData.delivered_at = event.timestamp
      } else if (event.status === "read") {
        updateData.read_at = event.timestamp
      } else if (terminalStatuses.includes(event.status)) {
        updateData.failed_at = event.timestamp
        if (event.error) {
          updateData.error_code = event.error.code
          updateData.error_message = event.error.message
        }
      }

      const { error: updateError } = await supabase
        .from("campaign_deliveries")
        .update(updateData)
        .eq("id", delivery.id)

      if (updateError) {
        console.error(
          `[webhook/${providerName}] DB error updating delivery:`,
          updateError.message
        )
        return Response.json({ error: "Internal error" }, { status: 500 })
      }

      console.log(
        `[webhook/${providerName}] Updated delivery=${delivery.id} status=${delivery.status}→${event.status}`
      )
    }

    // 7. Store raw webhook event for audit trail
    await supabase.from("webhook_events").insert({
      provider: providerName,
      event_id: event.eventId,
      provider_message_id: event.providerId,
      event_type: event.rawEventType,
      delivery_id: delivery.id,
      campaign_id: delivery.campaign_id,
      payload: event.rawPayload,
      received_at: new Date().toISOString(),
    }).then(({ error }) => {
      // Non-critical — log but don't fail the webhook
      if (error) {
        console.warn(
          `[webhook/${providerName}] Failed to store webhook event:`,
          error.message
        )
      }
    })
  } catch (err) {
    console.error(`[webhook/${providerName}] Unexpected error:`, err)
    return Response.json({ error: "Internal error" }, { status: 500 })
  }

  return Response.json({ received: true })
}
