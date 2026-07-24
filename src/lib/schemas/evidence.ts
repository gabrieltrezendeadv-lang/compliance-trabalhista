import { z } from "zod"

// ── Enums ──────────────────────────────────────────────────────────────────

export const evidenceTypeEnum = z.enum([
  "campaign_delivery",
  "assessment_result",
  "risk_inventory",
  "action_plan",
  "complaint_resolution",
  "compliance_report",
  "training_record",
])
export type EvidenceType = z.infer<typeof evidenceTypeEnum>

export const evidenceReportStatusEnum = z.enum([
  "draft",
  "generated",
  "sealed",
  "superseded",
])
export type EvidenceReportStatus = z.infer<typeof evidenceReportStatusEnum>

export const evidencePackageStatusEnum = z.enum([
  "open",
  "sealed",
])
export type EvidencePackageStatus = z.infer<typeof evidencePackageStatusEnum>

// ── Evidence report schemas ────────────────────────────────────────────────

export const generateEvidenceReportSchema = z.object({
  type: evidenceTypeEnum,
  title: z
    .string()
    .min(5, "Título deve ter pelo menos 5 caracteres")
    .max(300),
  description: z.string().max(2000).optional(),
  reference_id: z.string().uuid("ID de referência inválido").optional(),
  reference_type: z.string().max(100).optional(),
  period_start: z.string().datetime().optional(),
  period_end: z.string().datetime().optional(),
  parameters: z
    .record(z.string(), z.unknown())
    .optional(),
})
export type GenerateEvidenceReport = z.infer<typeof generateEvidenceReportSchema>

// ── Evidence package schemas ───────────────────────────────────────────────

export const createEvidencePackageSchema = z.object({
  name: z
    .string()
    .min(3, "Nome deve ter pelo menos 3 caracteres")
    .max(300),
  description: z.string().max(2000).optional(),
  report_ids: z
    .array(z.string().uuid("ID do relatório inválido"))
    .min(1, "Selecione pelo menos um relatório"),
})
export type CreateEvidencePackage = z.infer<typeof createEvidencePackageSchema>

export const sealEvidencePackageSchema = z.object({
  package_id: z.string().uuid("ID do pacote inválido"),
})
export type SealEvidencePackage = z.infer<typeof sealEvidencePackageSchema>

export const addPackageItemSchema = z.object({
  package_id: z.string().uuid("ID do pacote inválido"),
  report_id: z.string().uuid("ID do relatório inválido"),
  sort_order: z.number().int().min(0).optional(),
})
export type AddPackageItem = z.infer<typeof addPackageItemSchema>

export const removePackageItemSchema = z.object({
  package_id: z.string().uuid("ID do pacote inválido"),
  item_id: z.string().uuid("ID do item inválido"),
})
export type RemovePackageItem = z.infer<typeof removePackageItemSchema>

// ── Row types ──────────────────────────────────────────────────────────────

export type EvidenceReportRow = {
  id: string
  tenant_id: string
  type: EvidenceType
  title: string
  description: string | null
  status: EvidenceReportStatus
  version: number
  reference_id: string | null
  reference_type: string | null
  period_start: string | null
  period_end: string | null
  parameters: Record<string, unknown> | null
  content_hash: string | null
  content_snapshot: Record<string, unknown> | null
  generated_at: string | null
  generated_by: string
  disclaimer: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type EvidencePackageRow = {
  id: string
  tenant_id: string
  name: string
  description: string | null
  status: EvidencePackageStatus
  sealed_at: string | null
  sealed_by: string | null
  package_hash: string | null
  created_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type EvidencePackageItemRow = {
  id: string
  package_id: string
  report_id: string
  sort_order: number
  report_hash: string | null
  created_at: string
}

export type EvidenceAuditLogRow = {
  id: string
  tenant_id: string
  entity_type: string
  entity_id: string
  actor_id: string | null
  action: string
  details: Record<string, unknown> | null
  created_at: string
}

export type EvidenceReportDetail = EvidenceReportRow & {
  packages: EvidencePackageRow[]
}

export type EvidencePackageDetail = EvidencePackageRow & {
  items: (EvidencePackageItemRow & {
    report: EvidenceReportRow
  })[]
  audit_log: EvidenceAuditLogRow[]
}
