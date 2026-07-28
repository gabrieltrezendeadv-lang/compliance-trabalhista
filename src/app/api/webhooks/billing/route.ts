/**
 * Billing Webhook Handler — receives payment events from Asaas
 *
 * POST /api/webhooks/billing
 *
 * Flow:
 * 1. Verify webhook token (asaas-access-token header)
 * 2. Parse payload into normalized BillingWebhookEvent
 * 3. Map payment event to subscription state transition (ADR-005)
 * 4. Call transition_subscription_status RPC
 * 5. Store billing event for audit trail
 *
 * Security:
 * - Token verification required
 * - No tenant_id from frontend — resolved via external_subscription_id
 * - Service-role client (no user session)
 */

import { createClient } from "@supabase/supabase-js"
import {
  BillingNotConfiguredError,
  resolveBillingProvider,
} from "@/lib/billing/registry"
import type { BillingEventType } from "@/lib/billing/types"

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase service role configuration")
  }

  return createClient(url, serviceKey)
}

/**
 * Maps Asaas payment events to subscription status transitions.
 * Returns the new status to transition to, or null for no transition.
 */
function mapEventToTransition(
  eventType: BillingEventType
): string | null {
  switch (eventType) {
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED":
      return "active"
    case "PAYMENT_OVERDUE":
      return "past_due"
    case "PAYMENT_DELETED":
    case "PAYMENT_REFUNDED":
      // Refund/delete alone don't change subscription status
      return null
    default:
      return null
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  let payload: Record<string, unknown>

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // 1. Fail closed when no real provider is configured.
  let provider: ReturnType<typeof resolveBillingProvider>
  try {
    provider = resolveBillingProvider()
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) {
      return Response.json(
        { error: "Billing webhook unavailable" },
        { status: 503 }
      )
    }
    throw error
  }

  // 2. Verify webhook token.
  const secret = process.env.ASAAS_WEBHOOK_TOKEN
  const insecureDevWebhookAllowed =
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_INSECURE_BILLING_WEBHOOKS === "true"

  if (!secret && !insecureDevWebhookAllowed) {
    console.error("[webhook/billing] Webhook token is not configured")
    return Response.json(
      { error: "Billing webhook unavailable" },
      { status: 503 }
    )
  }

  if (secret) {
    const token = request.headers.get("asaas-access-token") ?? ""
    const isValid = provider.verifyWebhookSignature(rawBody, token, secret)
    if (!isValid) {
      console.warn("[webhook/billing] Invalid token — rejecting")
      return Response.json({ error: "Invalid token" }, { status: 401 })
    }
  }

  // 3. Parse webhook
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const event = provider.parseWebhook(payload, headers)
  if (!event) {
    return Response.json({ received: true })
  }

  try {
    const supabase = getServiceClient()

    // 3. Find subscription by external_subscription_id
    if (event.externalSubscriptionId) {
      const { data: subscription } = await supabase
        .from("tenant_subscriptions")
        .select("id, tenant_id, status")
        .eq("external_subscription_id", event.externalSubscriptionId)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle()

      if (subscription) {
        // 4. Determine if we need a state transition
        const newStatus = mapEventToTransition(event.eventType)

        if (newStatus && newStatus !== subscription.status) {
          const { data: transitioned } = await supabase.rpc(
            "transition_subscription_status",
            {
              p_subscription_id: subscription.id,
              p_new_status: newStatus,
              p_reason: `Webhook: ${event.eventType}`,
            }
          )

          if (transitioned) {
            console.log(
              `[webhook/billing] Subscription ${subscription.id}: ${subscription.status} → ${newStatus}`
            )
          } else {
            console.warn(
              `[webhook/billing] Invalid transition: ${subscription.status} → ${newStatus} (subscription ${subscription.id})`
            )
          }
        }

        // 5. Handle invoice updates
        if (event.externalPaymentId) {
          if (
            event.eventType === "PAYMENT_CONFIRMED" ||
            event.eventType === "PAYMENT_RECEIVED"
          ) {
            await supabase
              .from("invoices")
              .update({
                status: "paid",
                paid_at: event.paymentDate ?? new Date().toISOString(),
              })
              .eq("external_invoice_id", event.externalPaymentId)
              .eq("tenant_id", subscription.tenant_id)
          } else if (event.eventType === "PAYMENT_OVERDUE") {
            await supabase
              .from("invoices")
              .update({ status: "overdue" })
              .eq("external_invoice_id", event.externalPaymentId)
              .eq("tenant_id", subscription.tenant_id)
          } else if (event.eventType === "PAYMENT_REFUNDED") {
            await supabase
              .from("invoices")
              .update({ status: "refunded" })
              .eq("external_invoice_id", event.externalPaymentId)
              .eq("tenant_id", subscription.tenant_id)
          }
        }

        // 6. Store billing event
        await supabase.from("billing_events").insert({
          tenant_id: subscription.tenant_id,
          subscription_id: subscription.id,
          event_type: event.eventType,
          description: `Asaas webhook: ${event.eventType}`,
          metadata: {
            external_payment_id: event.externalPaymentId,
            value: event.value,
            billing_type: event.billingType,
            due_date: event.dueDate,
            payment_date: event.paymentDate,
          },
        })
      } else {
        console.log(
          `[webhook/billing] No subscription found for external_subscription_id=${event.externalSubscriptionId}`
        )
      }
    }
  } catch (err) {
    console.error("[webhook/billing] Unexpected error:", err)
    return Response.json({ error: "Internal error" }, { status: 500 })
  }

  return Response.json({ received: true })
}
