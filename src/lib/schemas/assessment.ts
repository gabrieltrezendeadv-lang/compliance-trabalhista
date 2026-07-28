import { z } from "zod";

// ============================================================================
// Enum: assessment_status
// ============================================================================

export const ASSESSMENT_STATUSES = [
  "planning",
  "active",
  "closed",
  "archived",
] as const;

export const assessmentStatusSchema = z.enum(ASSESSMENT_STATUSES);
export type AssessmentStatus = z.infer<typeof assessmentStatusSchema>;

export const STATUS_LABELS: Record<AssessmentStatus, string> = {
  planning: "Em preparação",
  active: "Ativo",
  closed: "Encerrado",
  archived: "Arquivado",
};

export const STATUS_COLORS: Record<AssessmentStatus, string> = {
  planning: "bg-yellow-100 text-yellow-800",
  active: "bg-green-100 text-green-800",
  closed: "bg-blue-100 text-blue-800",
  archived: "bg-gray-100 text-gray-800",
};

// ============================================================================
// Schema: response_scale (JSONB)
// ============================================================================

export const responseScaleSchema = z.object({
  type: z.literal("likert"),
  points: z.number().int().min(3).max(10),
  min_value: z.number().int(),
  max_value: z.number().int(),
  labels: z.record(z.string(), z.string()),
});

export type ResponseScale = z.infer<typeof responseScaleSchema>;

// ============================================================================
// Schema: questionnaire_template
// ============================================================================

export const questionnaireTemplateSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().nullable().optional(),
  version: z.number().int().min(1),
  instrument_code: z.string().nullable().optional(),
  response_scale: responseScaleSchema,
  status: z.enum(["draft", "published", "archived"]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
});

export type QuestionnaireTemplate = z.infer<typeof questionnaireTemplateSchema>;

// ============================================================================
// Schema: questionnaire_section
// ============================================================================

export const questionnaireSectionSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  template_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  dimension_code: z.string().nullable().optional(),
  display_order: z.number().int(),
});

export type QuestionnaireSection = z.infer<typeof questionnaireSectionSchema>;

// ============================================================================
// Schema: questionnaire_item
// ============================================================================

export const questionnaireItemSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable(),
  section_id: z.string().uuid(),
  text: z.string().min(1),
  help_text: z.string().nullable().optional(),
  display_order: z.number().int(),
  reverse_scored: z.boolean(),
  required: z.boolean(),
});

export type QuestionnaireItem = z.infer<typeof questionnaireItemSchema>;

// ============================================================================
// Schema: assessment_cycle
// ============================================================================

export const assessmentCycleSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  questionnaire_template_id: z.string().uuid(),
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().nullable().optional(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  status: assessmentStatusSchema,
  min_respondents_threshold: z.number().int().min(3),
  created_by: z.string().uuid().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
});

export type AssessmentCycle = z.infer<typeof assessmentCycleSchema>;

export const createCycleSchema = z.object({
  questionnaire_template_id: z.string().uuid("Selecione um questionário"),
  name: z.string().min(1, "Nome é obrigatório"),
  description: z.string().optional(),
  starts_at: z.string().min(1, "Data de início é obrigatória"),
  ends_at: z.string().min(1, "Data de término é obrigatória"),
  min_respondents_threshold: z.number().int().min(3, "Mínimo de 3 respondentes").default(5),
});

export type CreateCycle = z.infer<typeof createCycleSchema>;

export const updateCycleSchema = createCycleSchema.partial().extend({
  status: assessmentStatusSchema.optional(),
});

export type UpdateCycle = z.infer<typeof updateCycleSchema>;

// ============================================================================
// Schema: dimension_result (retorno das funções de agregação)
// ============================================================================

export const dimensionResultSchema = z.object({
  section_id: z.string().uuid(),
  section_name: z.string(),
  dimension_code: z.string().nullable(),
  respondent_count: z.number().int(),
  avg_score: z.number().nullable(),
  min_score: z.number().nullable(),
  max_score: z.number().nullable(),
  stddev_score: z.number().nullable(),
  below_threshold: z.boolean(),
});

export type DimensionResult = z.infer<typeof dimensionResultSchema>;

// ============================================================================
// Schema: participation_stats (retorno da função de participação)
// ============================================================================

export const participationStatSchema = z.object({
  scope: z.enum(["overall", "group"]).default("group"),
  establishment_id: z.string().uuid().nullable(),
  establishment_name: z.string().nullable(),
  department_id: z.string().uuid().nullable(),
  department_name: z.string().nullable(),
  invited_count: z.number().int().nullable(),
  responded_count: z.number().int().nullable(),
  participation_rate: z.number().nullable(),
  below_threshold: z.boolean().default(false),
});

export type ParticipationStat = z.infer<typeof participationStatSchema>;

// ============================================================================
// Schema: submissão pública (formulário anônimo)
// ============================================================================

export const assessmentResponseItemSchema = z.object({
  item_id: z.string().uuid(),
  value: z.number().int().min(1).max(10),
});

export const submitAssessmentSchema = z.object({
  token: z.string().min(1, "Token é obrigatório"),
  responses: z.array(assessmentResponseItemSchema).min(1, "Pelo menos uma resposta é obrigatória"),
});

export type SubmitAssessment = z.infer<typeof submitAssessmentSchema>;

// ============================================================================
// Helpers: classificação de risco por pontuação
// ============================================================================

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Baixo",
  moderate: "Moderado",
  high: "Alto",
  critical: "Crítico",
};

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "bg-green-100 text-green-800",
  moderate: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};

/**
 * Classifica o nível de risco com base na pontuação média.
 * Para dimensões negativas (exigências, estresse): maior = pior.
 * Para dimensões positivas (influência, apoio): menor = pior (reverse_scored cuida disso na agregação).
 * Escala 1-5: <=2 baixo, <=3 moderado, <=4 alto, >4 crítico.
 */
export function classifyRisk(avgScore: number): RiskLevel {
  if (avgScore <= 2) return "low";
  if (avgScore <= 3) return "moderate";
  if (avgScore <= 4) return "high";
  return "critical";
}
