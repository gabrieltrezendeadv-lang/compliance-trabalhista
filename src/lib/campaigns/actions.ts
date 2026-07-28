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
  const input =
    raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw;
  const source =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const establishmentId =
    typeof source.target_establishment_id === "string"
      ? source.target_establishment_id
      : "";
  const departmentId =
    typeof source.target_department_id === "string"
      ? source.target_department_id
      : "";
  const computedTargetScope =
    establishmentId || departmentId
      ? {
          ...(establishmentId
            ? { establishment_ids: [establishmentId] }
            : {}),
          ...(departmentId ? { department_ids: [departmentId] } : {}),
        }
      : undefined;
  const parsed = createCampaignSchema.safeParse({
    ...source,
    template_id: source.template_id || undefined,
    description: source.description || undefined,
    body_html: source.body_html || undefined,
    legal_basis: source.legal_basis || undefined,
    scheduled_at: source.scheduled_at || undefined,
    requires_acknowledgment:
      source.requires_acknowledgment === true ||
      source.requires_acknowledgment === "on",
    target_scope: computedTargetScope,
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Usuário não autenticado" };

  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin", "manager"])
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return { error: "Organização não encontrada" };
  }

  const { data: establishment } = establishmentId
    ? await supabase
        .from("establishments")
        .select("id")
        .eq("id", establishmentId)
        .eq("tenant_id", membership.tenant_id)
        .is("deleted_at", null)
        .maybeSingle()
    : { data: null };
  if (establishmentId && !establishment) {
    return { error: "Estabelecimento inválido para esta organização" };
  }

  const { data: department } = departmentId
    ? await supabase
        .from("departments")
        .select("id, establishment_id")
        .eq("id", departmentId)
        .eq("tenant_id", membership.tenant_id)
        .is("deleted_at", null)
        .maybeSingle()
    : { data: null };
  if (departmentId && !department) {
    return { error: "Departamento inválido para esta organização" };
  }
  if (
    department &&
    establishmentId &&
    department.establishment_id !== establishmentId
  ) {
    return { error: "O departamento não pertence ao estabelecimento selecionado" };
  }

  const { target_scope, ...rest } = parsed.data;

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      ...rest,
      tenant_id: membership.tenant_id,
      target_scope: target_scope ?? null,
      status: parsed.data.scheduled_at ? "scheduled" : "draft",
      created_by: user.id,
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

// SEC-005 + SEC-BLOCK1: Auth check + fail-closed provider check
export async function executeCampaignSend(campaignId: string) {
  const supabase = await createClient();

  // Verify user is authenticated before executing
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Usuário não autenticado" };
  }

  // 1. FAIL-CLOSED GUARD — check providers BEFORE prepareCampaignSend.
  //    prepareCampaignSend creates campaign_deliveries rows via RPC.
  //    We must not create deliveries if the channel is not configured,
  //    because those deliveries would sit as "pending" with no way to
  //    actually send them.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("channel")
    .eq("id", campaignId)
    .single();

  if (!campaign) {
    return { error: "Campanha não encontrada" };
  }

  const { areChannelsReady } = await import("@/lib/integrations/registry");
  const { ready, missing } = areChannelsReady(campaign.channel);

  if (!ready) {
    const labels = missing.map((ch) =>
      ch === "email" ? "E-mail" : "WhatsApp"
    );
    return {
      error:
        `Canal ${labels.join(" e ")} não configurado. ` +
        `Configure as variáveis de ambiente do provedor antes de enviar.`,
    };
  }

  // 2. Preparar entregas via RPC (resolve destinatários, cria campaign_deliveries)
  const prepResult = await prepareCampaignSend(campaignId);
  if (prepResult.error) {
    return { error: prepResult.error };
  }

  // 3. Enviar via integração (real provider garantido pelo guard acima)
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
