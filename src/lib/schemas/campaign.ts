import { z } from "zod";

// ============================================================================
// Enum: campaign_status
// ============================================================================

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "cancelled",
] as const;

export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  sending: "Enviando",
  sent: "Enviada",
  cancelled: "Cancelada",
};

export const CAMPAIGN_STATUS_COLORS: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-800",
  scheduled: "bg-blue-100 text-blue-800",
  sending: "bg-yellow-100 text-yellow-800",
  sent: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

// ============================================================================
// Enum: delivery_channel
// ============================================================================

export const DELIVERY_CHANNELS = ["email", "whatsapp", "both"] as const;

export const deliveryChannelSchema = z.enum(DELIVERY_CHANNELS);
export type DeliveryChannel = z.infer<typeof deliveryChannelSchema>;

export const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  both: "E-mail + WhatsApp",
};

// ============================================================================
// Enum: delivery_status
// ============================================================================

export const DELIVERY_STATUSES = [
  "pending",
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "bounced",
  "rejected",
] as const;

export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: "Pendente",
  queued: "Na fila",
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  failed: "Falhou",
  bounced: "Devolvido",
  rejected: "Rejeitado",
};

export const DELIVERY_STATUS_COLORS: Record<DeliveryStatus, string> = {
  pending: "bg-gray-100 text-gray-800",
  queued: "bg-blue-100 text-blue-800",
  sent: "bg-blue-100 text-blue-800",
  delivered: "bg-green-100 text-green-800",
  read: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  bounced: "bg-red-100 text-red-800",
  rejected: "bg-red-100 text-red-800",
};

// ============================================================================
// Enum: campaign_type
// ============================================================================

export const CAMPAIGN_TYPES = [
  "informational",
  "risk_assessment",
  "policy_update",
  "training",
  "legal_notice",
  "custom",
] as const;

export const campaignTypeSchema = z.enum(CAMPAIGN_TYPES);
export type CampaignType = z.infer<typeof campaignTypeSchema>;

export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  informational: "Informativo",
  risk_assessment: "Resultados de avaliação",
  policy_update: "Atualização de política",
  training: "Treinamento",
  legal_notice: "Comunicação legal",
  custom: "Personalizada",
};

// ============================================================================
// Schema: campaign (lista)
// ============================================================================

export const campaignListItemSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  template_id: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  type: campaignTypeSchema,
  channel: deliveryChannelSchema,
  status: campaignStatusSchema,
  legal_basis: z.string().nullable(),
  requires_acknowledgment: z.boolean(),
  scheduled_at: z.string().nullable(),
  sent_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  total_recipients: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CampaignListItem = z.infer<typeof campaignListItemSchema>;

// ============================================================================
// Schema: campaign stats (retorno de fn_get_campaign_stats)
// ============================================================================

export const campaignStatsSchema = z.object({
  total_recipients: z.number().int(),
  total_acknowledged: z.number().int(),
  by_status: z.record(z.string(), z.number()),
  by_channel: z.record(z.string(), z.number()),
});

export type CampaignStats = z.infer<typeof campaignStatsSchema>;

// ============================================================================
// Schema: criar campanha
// ============================================================================

export const createCampaignSchema = z.object({
  template_id: z.string().uuid().optional(),
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().optional(),
  type: campaignTypeSchema.default("informational"),
  channel: deliveryChannelSchema.default("email"),
  subject: z.string().min(1, "Assunto é obrigatório"),
  body_html: z.string().optional(),
  body_text: z.string().min(1, "Conteúdo é obrigatório"),
  legal_basis: z.string().optional(),
  requires_acknowledgment: z.boolean().default(false),
  scheduled_at: z.string().optional(),
  target_scope: z
    .object({
      establishment_ids: z.array(z.string().uuid()).optional(),
      department_ids: z.array(z.string().uuid()).optional(),
    })
    .optional(),
});

export type CreateCampaign = z.infer<typeof createCampaignSchema>;

// ============================================================================
// Schema: delivery item (para lista de entregas)
// ============================================================================

export const deliveryItemSchema = z.object({
  id: z.string().uuid(),
  recipient_name: z.string(),
  recipient_email: z.string().nullable(),
  channel: deliveryChannelSchema,
  status: deliveryStatusSchema,
  sent_at: z.string().nullable(),
  delivered_at: z.string().nullable(),
  read_at: z.string().nullable(),
  failed_at: z.string().nullable(),
  error_message: z.string().nullable(),
  acknowledged: z.boolean(),
});

export type DeliveryItem = z.infer<typeof deliveryItemSchema>;

// ============================================================================
// Helpers
// ============================================================================

export function isTerminalStatus(status: DeliveryStatus): boolean {
  return ["delivered", "read", "failed", "bounced", "rejected"].includes(
    status
  );
}

export function isSuccessStatus(status: DeliveryStatus): boolean {
  return ["delivered", "read"].includes(status);
}

export function isErrorStatus(status: DeliveryStatus): boolean {
  return ["failed", "bounced", "rejected"].includes(status);
}
