import { z } from "zod";

// ============================================================================
// Enum: complaint_status
// ============================================================================

export const COMPLAINT_STATUSES = [
  "pending",
  "under_review",
  "investigating",
  "resolved",
  "dismissed",
  "reopened",
] as const;

export const complaintStatusSchema = z.enum(COMPLAINT_STATUSES);
export type ComplaintStatus = z.infer<typeof complaintStatusSchema>;

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  pending: "Pendente",
  under_review: "Em triagem",
  investigating: "Em investigação",
  resolved: "Resolvida",
  dismissed: "Arquivada",
  reopened: "Reaberta",
};

export const COMPLAINT_STATUS_COLORS: Record<ComplaintStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  under_review: "bg-blue-100 text-blue-800",
  investigating: "bg-purple-100 text-purple-800",
  resolved: "bg-green-100 text-green-800",
  dismissed: "bg-gray-100 text-gray-800",
  reopened: "bg-orange-100 text-orange-800",
};

// ============================================================================
// Enum: complaint_severity
// ============================================================================

export const COMPLAINT_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const complaintSeveritySchema = z.enum(COMPLAINT_SEVERITIES);
export type ComplaintSeverity = z.infer<typeof complaintSeveritySchema>;

export const SEVERITY_LABELS: Record<ComplaintSeverity, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

export const SEVERITY_COLORS: Record<ComplaintSeverity, string> = {
  low: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

// ============================================================================
// Enum: complaint_category
// ============================================================================

export const COMPLAINT_CATEGORIES = [
  "harassment",
  "sexual_harassment",
  "discrimination",
  "retaliation",
  "safety_violation",
  "fraud",
  "corruption",
  "conflict_of_interest",
  "policy_violation",
  "other",
] as const;

export const complaintCategorySchema = z.enum(COMPLAINT_CATEGORIES);
export type ComplaintCategory = z.infer<typeof complaintCategorySchema>;

export const CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  harassment: "Assédio moral",
  sexual_harassment: "Assédio sexual",
  discrimination: "Discriminação",
  retaliation: "Retaliação",
  safety_violation: "Violação de segurança",
  fraud: "Fraude",
  corruption: "Corrupção",
  conflict_of_interest: "Conflito de interesses",
  policy_violation: "Violação de políticas",
  other: "Outros",
};

export const CATEGORY_ICONS: Record<ComplaintCategory, string> = {
  harassment: "UserX",
  sexual_harassment: "ShieldAlert",
  discrimination: "Ban",
  retaliation: "Undo2",
  safety_violation: "AlertTriangle",
  fraud: "DollarSign",
  corruption: "Scale",
  conflict_of_interest: "GitBranch",
  policy_violation: "FileWarning",
  other: "HelpCircle",
};

// ============================================================================
// Schema: complaint metadata (retorno de fn_get_complaint_list)
// ============================================================================

export const complaintListItemSchema = z.object({
  id: z.string().uuid(),
  protocol: z.string(),
  category: complaintCategorySchema,
  severity: complaintSeveritySchema,
  status: complaintStatusSchema,
  is_anonymous: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  resolved_at: z.string().nullable(),
  investigator_count: z.number().int(),
  message_count: z.number().int(),
});

export type ComplaintListItem = z.infer<typeof complaintListItemSchema>;

// ============================================================================
// Schema: complaint detail (retorno de fn_get_complaint_detail)
// ============================================================================

export const complaintContentSchema = z.object({
  subject: z.string(),
  description: z.string(),
  reporter_name: z.string().nullable(),
  reporter_email: z.string().nullable(),
  reporter_phone: z.string().nullable(),
  establishment_name: z.string().nullable(),
  department_name: z.string().nullable(),
});

export type ComplaintContent = z.infer<typeof complaintContentSchema>;

export const complaintMessageSchema = z.object({
  id: z.string().uuid(),
  sender_type: z.enum(["reporter", "investigator"]),
  body: z.string(),
  created_at: z.string(),
});

export type ComplaintMessage = z.infer<typeof complaintMessageSchema>;

export const complaintInvestigatorSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  assigned_at: z.string(),
  removed_at: z.string().nullable(),
  name: z.string().nullable(),
});

export type ComplaintInvestigator = z.infer<typeof complaintInvestigatorSchema>;

export const complaintDetailSchema = z.object({
  complaint: complaintListItemSchema.omit({
    investigator_count: true,
    message_count: true,
  }),
  is_investigator: z.boolean(),
  is_admin: z.boolean(),
  content: complaintContentSchema.optional(),
  messages: z.array(complaintMessageSchema).optional(),
  investigators: z.array(complaintInvestigatorSchema),
});

export type ComplaintDetail = z.infer<typeof complaintDetailSchema>;

// ============================================================================
// Schema: formulário público de denúncia
// ============================================================================

export const submitComplaintSchema = z
  .object({
    tenant_slug: z.string().min(1, "Organização é obrigatória"),
    subject: z.string().min(5, "Assunto deve ter pelo menos 5 caracteres"),
    description: z
      .string()
      .min(10, "Descrição deve ter pelo menos 10 caracteres"),
    category: complaintCategorySchema.default("other"),
    is_anonymous: z.boolean().default(true),
    reporter_name: z.string().optional(),
    reporter_email: z
      .string()
      .email("E-mail inválido")
      .optional()
      .or(z.literal("")),
    reporter_phone: z.string().optional(),
    establishment_name: z.string().optional(),
    department_name: z.string().optional(),
    pin: z
      .string()
      .min(6, "PIN deve ter pelo menos 6 dígitos")
      .max(32, "PIN deve ter no máximo 32 dígitos")
      .regex(/^\d+$/, "PIN deve conter apenas números"),
  })
  .strict();

export type SubmitComplaint = z.infer<typeof submitComplaintSchema>;

// ============================================================================
// Schema: acesso à caixa segura (protocolo + PIN)
// v1.2.1: max protocol length, .strict()
// ============================================================================

export const accessComplaintSchema = z
  .object({
    protocol: z
      .string()
      .min(1, "Protocolo é obrigatório")
      .max(20, "Protocolo inválido")
      .transform((v) => v.toUpperCase().replace(/\s/g, "")),
    pin: z
      .string()
      .min(4, "PIN é obrigatório")
      .max(32, "PIN deve ter no máximo 32 dígitos")
      .regex(/^\d+$/, "PIN deve conter apenas números"),
  })
  .strict();

export type AccessComplaint = z.infer<typeof accessComplaintSchema>;

// ============================================================================
// Schema: envio de mensagem pelo denunciante
// v1.2.1: max protocol length, numeric regex on PIN, max body length, .strict()
// ============================================================================

export const sendReporterMessageSchema = z
  .object({
    protocol: z
      .string()
      .min(1, "Protocolo é obrigatório")
      .max(20, "Protocolo inválido"),
    pin: z
      .string()
      .min(4, "PIN é obrigatório")
      .max(32, "PIN deve ter no máximo 32 dígitos")
      .regex(/^\d+$/, "PIN deve conter apenas números"),
    body: z
      .string()
      .min(1, "Mensagem não pode estar vazia")
      .max(10_000, "Mensagem excede o tamanho máximo"),
  })
  .strict();

export type SendReporterMessage = z.infer<typeof sendReporterMessageSchema>;

// ============================================================================
// Schema: atualização de status pelo admin
// ============================================================================

export const updateComplaintStatusSchema = z.object({
  complaint_id: z.string().uuid(),
  new_status: complaintStatusSchema,
  reason: z.string().optional(),
});

export type UpdateComplaintStatus = z.infer<typeof updateComplaintStatusSchema>;
