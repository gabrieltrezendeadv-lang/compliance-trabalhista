import { z } from "zod"

// ── Enums ──────────────────────────────────────────────────────────────────

export const riskSourceEnum = z.enum([
  "assessment",
  "complaint",
  "inspection",
  "audit",
  "manual",
])
export type RiskSource = z.infer<typeof riskSourceEnum>

export const riskCategoryEnum = z.enum([
  "psychosocial",
  "ergonomic",
  "physical",
  "chemical",
  "biological",
  "accident",
  "organizational",
])
export type RiskCategory = z.infer<typeof riskCategoryEnum>

export const riskLevelEnum = z.enum([
  "very_low",
  "low",
  "medium",
  "high",
  "very_high",
])
export type RiskLevel = z.infer<typeof riskLevelEnum>

export const riskItemStatusEnum = z.enum([
  "identified",
  "analyzing",
  "treating",
  "monitoring",
  "resolved",
  "accepted",
])
export type RiskItemStatus = z.infer<typeof riskItemStatusEnum>

export const controlHierarchyEnum = z.enum([
  "elimination",
  "substitution",
  "engineering",
  "administrative",
  "ppe",
])
export type ControlHierarchy = z.infer<typeof controlHierarchyEnum>

export const actionStatusEnum = z.enum([
  "planned",
  "in_progress",
  "completed",
  "overdue",
  "cancelled",
])
export type ActionStatus = z.infer<typeof actionStatusEnum>

export const reviewRecommendationEnum = z.enum([
  "maintain",
  "escalate",
  "downgrade",
  "close",
  "reassess",
])
export type ReviewRecommendation = z.infer<typeof reviewRecommendationEnum>

// ── Risk item schemas ──────────────────────────────────────────────────────

export const createRiskItemSchema = z.object({
  source: riskSourceEnum,
  category: riskCategoryEnum,
  title: z
    .string()
    .min(5, "Título deve ter pelo menos 5 caracteres")
    .max(300),
  description: z
    .string()
    .min(10, "Descrição deve ter pelo menos 10 caracteres")
    .max(5000),
  initial_risk_level: riskLevelEnum,
  initial_score: z.number().min(0).max(100).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  cycle_id: z.string().uuid("ID do ciclo inválido").optional(),
  section_id: z.string().uuid("ID da seção inválido").optional(),
  establishment_id: z.string().uuid("ID do estabelecimento inválido").optional(),
  department_id: z.string().uuid("ID do departamento inválido").optional(),
  affected_group: z.string().max(200).optional(),
  identified_at: z.string().datetime().optional(),
  identified_by: z.string().uuid("ID do identificador inválido").optional(),
})
export type CreateRiskItem = z.infer<typeof createRiskItemSchema>

export const updateRiskItemSchema = z.object({
  category: riskCategoryEnum.optional(),
  title: z.string().min(5).max(300).optional(),
  description: z.string().min(10).max(5000).optional(),
  initial_risk_level: riskLevelEnum.optional(),
  residual_risk_level: riskLevelEnum.optional().nullable(),
  initial_score: z.number().min(0).max(100).optional().nullable(),
  status: riskItemStatusEnum.optional(),
  priority: z.number().int().min(1).max(5).optional().nullable(),
  establishment_id: z.string().uuid().optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  affected_group: z.string().max(200).optional().nullable(),
})
export type UpdateRiskItem = z.infer<typeof updateRiskItemSchema>

// ── Action plan schemas ────────────────────────────────────────────────────

export const createActionPlanSchema = z.object({
  risk_item_id: z.string().uuid("ID do risco inválido"),
  title: z
    .string()
    .min(5, "Título deve ter pelo menos 5 caracteres")
    .max(300),
  description: z
    .string()
    .min(10, "Descrição deve ter pelo menos 10 caracteres")
    .max(5000),
  control_level: controlHierarchyEnum.optional(),
  responsible_user_id: z.string().uuid("ID do responsável inválido").optional(),
  due_date: z.string().datetime("Data de vencimento inválida").optional(),
  status: actionStatusEnum.default("planned"),
  notes: z.string().max(2000).optional(),
})
export type CreateActionPlan = z.infer<typeof createActionPlanSchema>

export const updateActionPlanSchema = z.object({
  title: z.string().min(5).max(300).optional(),
  description: z.string().min(10).max(5000).optional(),
  control_level: controlHierarchyEnum.optional().nullable(),
  responsible_user_id: z.string().uuid().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
  status: actionStatusEnum.optional(),
  completed_at: z.string().datetime().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
})
export type UpdateActionPlan = z.infer<typeof updateActionPlanSchema>

// ── Review schemas ─────────────────────────────────────────────────────────

export const createReviewSchema = z.object({
  risk_item_id: z.string().uuid("ID do risco inválido"),
  review_date: z.string().datetime("Data da revisão inválida"),
  new_risk_level: riskLevelEnum,
  new_score: z.number().min(0).max(100).optional(),
  assessment_method: z
    .string()
    .min(3, "Método de avaliação deve ter pelo menos 3 caracteres")
    .max(200),
  findings: z
    .string()
    .min(10, "Constatações devem ter pelo menos 10 caracteres")
    .max(5000),
  recommendation: reviewRecommendationEnum,
})
export type CreateReview = z.infer<typeof createReviewSchema>

// ── Row types ──────────────────────────────────────────────────────────────

export type RiskItemRow = {
  id: string
  tenant_id: string
  cycle_id: string | null
  section_id: string | null
  source: RiskSource
  category: RiskCategory
  title: string
  description: string
  initial_risk_level: RiskLevel
  residual_risk_level: RiskLevel | null
  initial_score: number | null
  status: RiskItemStatus
  priority: number | null
  establishment_id: string | null
  department_id: string | null
  affected_group: string | null
  identified_at: string | null
  identified_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type RiskActionPlanRow = {
  id: string
  tenant_id: string
  risk_item_id: string
  title: string
  description: string
  control_level: ControlHierarchy | null
  responsible_user_id: string | null
  due_date: string | null
  status: ActionStatus
  completed_at: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type RiskReviewRow = {
  id: string
  tenant_id: string
  risk_item_id: string
  reviewer_id: string
  review_date: string
  new_risk_level: RiskLevel
  new_score: number | null
  assessment_method: string
  findings: string
  recommendation: ReviewRecommendation
  created_at: string
}

export type RiskAuditLogRow = {
  id: string
  risk_item_id: string
  actor_id: string | null
  action: string
  details: Record<string, unknown> | null
  created_at: string
}

// ── Composite types ────────────────────────────────────────────────────────

export type RiskSummary = {
  total: number
  by_level: Record<RiskLevel, number>
  by_category: Record<RiskCategory, number>
  by_status: Record<RiskItemStatus, number>
  overdue_actions: number
  pending_reviews: number
}

export type RiskDetail = RiskItemRow & {
  action_plans: RiskActionPlanRow[]
  reviews: RiskReviewRow[]
  audit_log: RiskAuditLogRow[]
}
