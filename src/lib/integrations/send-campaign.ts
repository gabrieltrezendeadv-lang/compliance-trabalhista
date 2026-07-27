/**
 * Campaign Send Orchestrator
 *
 * Orchestrates the sending of a campaign through the appropriate provider(s).
 * Updates campaign_deliveries status in the database after each send attempt.
 *
 * Flow:
 * 1. Fetch campaign deliveries (status = 'pending' or 'queued')
 * 2. Resolve provider for the campaign's channel
 * 3. Send each delivery through the provider
 * 4. Update delivery status in the database
 * 5. Update campaign status when all deliveries are processed
 */

import { createClient } from "@/lib/supabase/server"
import {
  resolveProvider,
  getActiveProviderName,
  isRealProviderConfigured,
  ChannelNotConfiguredError,
} from "./registry"
import type {
  Channel,
  CampaignSendJob,
  CampaignSendResult,
  SendRequest,
} from "./types"

/**
 * Send all pending deliveries for a campaign.
 *
 * This is the main entry point called from the campaign send action.
 * In production, this should be called from a background job/queue.
 */
export async function sendCampaign(
  campaignId: string
): Promise<CampaignSendResult> {
  const supabase = await createClient()

  // 1. Fetch campaign details
  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, tenant_id, channel, subject, body_text, body_html, legal_basis, status")
    .eq("id", campaignId)
    .single()

  if (campaignError || !campaign) {
    return {
      campaignId,
      totalSent: 0,
      totalFailed: 0,
      results: [],
    }
  }

  // 2. Fetch pending deliveries with recipient info
  const { data: deliveries, error: deliveryError } = await supabase
    .from("campaign_deliveries")
    .select(
      `
      id,
      recipient_id,
      channel,
      idempotency_key,
      campaign_recipients!inner (
        full_name,
        email,
        phone
      )
    `
    )
    .eq("campaign_id", campaignId)
    .in("status", ["pending", "queued"])

  if (deliveryError || !deliveries?.length) {
    return {
      campaignId,
      totalSent: 0,
      totalFailed: 0,
      results: [],
    }
  }

  // 3. SECOND DEFENSE — fail-closed guard inside sendCampaign.
  //    The primary guard is in executeCampaignSend (actions.ts), which
  //    blocks before prepareCampaignSend. This is a safety net in case
  //    sendCampaign is called from another path.
  //    If a channel is missing, we restore the campaign to "draft" and
  //    leave deliveries as "pending" (no false "failed" state in DB).
  const channels = new Set(deliveries.map((d) => d.channel as Channel))

  for (const ch of channels) {
    if (!isRealProviderConfigured(ch)) {
      const label = ch === "email" ? "E-mail" : "WhatsApp"
      console.error(
        `[send-campaign] BLOCKED: canal "${ch}" não configurado — ` +
          `campanha ${campaignId} restaurada para draft`
      )

      // Restore campaign to draft — deliveries stay "pending"
      await supabase
        .from("campaigns")
        .update({ status: "draft" })
        .eq("id", campaignId)

      return {
        campaignId,
        totalSent: 0,
        totalFailed: 0,
        results: [],
      }
    }
  }

  // 4. Update campaign status to 'sending'
  await supabase
    .from("campaigns")
    .update({ status: "sending" })
    .eq("id", campaignId)

  // 5. Process each delivery
  const providerNames: string[] = []
  const results: CampaignSendResult["results"] = []
  let totalSent = 0
  let totalFailed = 0

  for (const delivery of deliveries) {
    const channel = delivery.channel as Channel

    // resolveProvider will throw ChannelNotConfiguredError if no real
    // provider is available — third safety net.
    // If triggered, restore campaign to draft and leave remaining
    // deliveries as pending.
    let provider
    try {
      provider = resolveProvider(channel)
    } catch (err) {
      if (err instanceof ChannelNotConfiguredError) {
        console.error(
          `[send-campaign] resolveProvider failed for "${channel}" — ` +
            `restoring campaign ${campaignId} to draft`
        )
        await supabase
          .from("campaigns")
          .update({ status: "draft" })
          .eq("id", campaignId)

        return {
          campaignId,
          totalSent,
          totalFailed,
          results,
        }
      }
      throw err
    }

    if (!providerNames.includes(provider.name)) {
      providerNames.push(provider.name)
    }

    const recipient = delivery.campaign_recipients as unknown as {
      full_name: string
      email: string | null
      phone: string | null
    }

    const request: SendRequest = {
      idempotencyKey: delivery.idempotency_key,
      recipientName: recipient.full_name,
      recipientEmail: recipient.email ?? undefined,
      recipientPhone: recipient.phone ?? undefined,
      subject: campaign.subject,
      bodyText: campaign.body_text,
      bodyHtml: campaign.body_html ?? undefined,
      legalBasis: campaign.legal_basis ?? undefined,
      metadata: {
        campaignId: campaign.id,
        deliveryId: delivery.id,
        tenantId: campaign.tenant_id,
      },
    }

    // Send
    const sendResult = await provider.send(request)

    // Update delivery in database
    const updateData: Record<string, unknown> = {
      status: sendResult.status,
      provider_id: sendResult.providerId ?? null,
      attempt_count: 1, // TODO: increment on retry
    }

    if (sendResult.success) {
      updateData.sent_at = sendResult.timestamp
      updateData.queued_at = sendResult.timestamp
      totalSent++
    } else {
      updateData.failed_at = sendResult.timestamp
      updateData.error_code = sendResult.error?.code ?? null
      updateData.error_message = sendResult.error?.message ?? null
      totalFailed++
    }

    await supabase
      .from("campaign_deliveries")
      .update(updateData)
      .eq("id", delivery.id)

    results.push({
      deliveryId: delivery.id,
      recipientId: delivery.recipient_id,
      status: sendResult.status,
      providerId: sendResult.providerId,
      error: sendResult.error?.message,
    })
  }

  // 6. Update campaign status — only to "sent" if deliveries actually succeeded
  const allProcessed = totalSent + totalFailed === deliveries.length
  if (allProcessed && totalSent > 0) {
    await supabase
      .from("campaigns")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", campaignId)
  } else if (allProcessed && totalSent === 0) {
    // All deliveries failed via real provider errors (not config issue) —
    // revert campaign to draft so it can be retried
    await supabase
      .from("campaigns")
      .update({ status: "draft" })
      .eq("id", campaignId)
  }

  console.log(
    `[send-campaign] campaign=${campaignId} sent=${totalSent} failed=${totalFailed} providers=${providerNames.join(",")}`
  )

  return {
    campaignId,
    totalSent,
    totalFailed,
    results,
  }
}

/**
 * Get integration status for display in the dashboard.
 *
 * Returns "not-configured" (instead of mock names) when a real
 * provider is not set up — so the UI can show "canal não configurado"
 * and disable the send button.
 */
export function getIntegrationStatus(): {
  email: { provider: string; configured: boolean }
  whatsapp: { provider: string; configured: boolean }
} {
  return {
    email: {
      provider: getActiveProviderName("email"),
      configured: isRealProviderConfigured("email"),
    },
    whatsapp: {
      provider: getActiveProviderName("whatsapp"),
      configured: isRealProviderConfigured("whatsapp"),
    },
  }
}
