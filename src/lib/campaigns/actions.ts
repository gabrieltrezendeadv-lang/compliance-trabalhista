"use server";

import { createClient } from "@/lib/supabase/server";
import { createCampaignSchema } from "@/lib/schemas/campaign";
import type { CampaignStats, DeliveryItem } from "@/lib/schemas/campaign";

// ============================================================================
// Campaigns CRUD
// ============================================================================

export async function getCampaigns() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: data ?? [] };
}

export async function getCampaign(campaignId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, campaign_templates(name)")
    .eq("id", campaignId)
    .is("deleted_at", null)
    .single();

  if (error) {
    return { error: error.message, data: null };
  }

  return { data };
}

export async function createCampaign(raw: unknown) {
  const parsed = createCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  // Resolver tenant_id
  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id")
    .is("deleted_at", null)
    .limit(1)
    .single();

  if (!membership) {
    return { error: "Organização não encontrada" };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { target_scope, ...rest } = parsed.data;

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      ...rest,
      tenant_id: membership.tenant_id,
      target_scope: target_scope ?? null,
      status: parsed.data.scheduled_at ? "scheduled" : "draft",
      created_by: user?.id,
    })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  return { data };
}

// SEC-005: Added Zod validation and auth check for campaign updates
export async function updateCampaign(
  campaignId: string,
  raw: unknown
) {
  // Import the update schema for validation
  const { updateCampaignSchema } = await import("@/lib/schemas/campaign");
  const parsed = updateCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  // Verify user is authenticated
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Usuário não autenticado" };
  }

  // CONSOLIDAÇÃO: Impedir edição de campanhas que não estão em draft
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("status")
    .eq("id", campaignId)
    .single();

  if (campaign && campaign.status !== "draft") {
    return { error: "Apenas campanhas em rascunho podem ser editadas" };
  }

  const { error } = await supabase
    .from("campaigns")
    .update(parsed.data)
    .eq("id", campaignId);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

// ============================================================================
// Campaign Stats (via SECURITY DEFINER)
// ============================================================================

export async function getCampaignStats(
  campaignId: string
): Promise<{ data: CampaignStats | null; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_get_campaign_stats", {
    p_campaign_id: campaignId,
  });

  if (error) {
    return { error: error.message, data: null };
  }

  const result = data as { success: boolean; error?: string } & CampaignStats;

  if (!result.success) {
    return { error: result.error ?? "Erro ao obter estatísticas", data: null };
  }

  return {
    data: {
      total_recipients: result.total_recipients,
      total_acknowledged: result.total_acknowledged,
      by_status: result.by_status,
      by_channel: result.by_channel,
    },
  };
}

// ============================================================================
// Deliveries (lista de entregas de uma campanha)
// ============================================================================

export async function getCampaignDeliveries(
  campaignId: string
): Promise<{ data: DeliveryItem[]; error?: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("campaign_deliveries")
    .select(
      `
      id,
      recipient_id,
      channel,
      status,
      sent_at,
      delivered_at,
      read_at,
      failed_at,
      error_message,
      campaign_recipients!inner (
        full_name,
        email
      )
    `
    )
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (error) {
    return { error: error.message, data: [] };
  }

  // Buscar acknowledgments separadamente
  const { data: acks } = await supabase
    .from("campaign_acknowledgments")
    .select("recipient_id")
    .eq("campaign_id", campaignId);

  const ackSet = new Set((acks ?? []).map((a) => a.recipient_id));

  const items: DeliveryItem[] = (data ?? []).map((d) => {
    const recipient = d.campaign_recipients as unknown as {
      full_name: string;
      email: string | null;
    };
    return {
      id: d.id,
      recipient_name: recipient.full_name,
      recipient_email: recipient.email,
      channel: d.channel,
      status: d.status,
      sent_at: d.sent_at,
      delivered_at: d.delivered_at,
      read_at: d.read_at,
      failed_at: d.failed_at,
      error_message: d.error_message,
      // CONSOLIDAÇÃO: Usar recipient_id (não delivery id) para verificar acknowledgment
      acknowledged: ackSet.has(d.recipient_id),
    };
  });

  return { data: items };
}

// ============================================================================
// Preparar e enviar campanha (via SECURITY DEFINER)
// ============================================================================

export async function prepareCampaignSend(campaignId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_prepare_campaign_send", {
    p_campaign_id: campaignId,
  });

  if (error) {
    return { error: error.message };
  }

  const result = data as {
    success: boolean;
    error?: string;
    total_recipients?: number;
  };

  if (!result.success) {
    return { error: result.error ?? "Erro ao preparar envio" };
  }

  return { success: true, total_recipients: result.total_recipients };
}

// ============================================================================
// Enviar campanha (chama o orchestrator de integração)
// ============================================================================

// SEC-005: Added auth check for campaign execution
export async function executeCampaignSend(campaignId: string) {
  const supabase = await createClient();

  // Verify user is authenticated before executing
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Usuário não autenticado" };
  }

  // 1. Preparar entregas via RPC (resolve destinatários, cria campaign_deliveries)
  const prepResult = await prepareCampaignSend(campaignId);
  if (prepResult.error) {
    return { error: prepResult.error };
  }

  // 2. Enviar via integração (mock ou real, conforme registry)
  const { sendCampaign } = await import("@/lib/integrations/send-campaign");
  const result = await sendCampaign(campaignId);

  return {
    success: true,
    totalSent: result.totalSent,
    totalFailed: result.totalFailed,
    totalRecipients: prepResult.total_recipients,
  };
}

// ============================================================================
// Campaign Templates
// ============================================================================

export async function getCampaignTemplates() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaign_templates")
    .select("id, name, description, type, channel, subject, legal_basis, requires_acknowledgment, status")
    .is("deleted_at", null)
    .in("status", ["published", "draft"])
    .order("name");

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: data ?? [] };
}
