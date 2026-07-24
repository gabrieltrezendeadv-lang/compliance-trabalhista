import { z } from "zod";

// ============================================================================
// Enum: app_role (espelha o enum do banco)
// ============================================================================

export const APP_ROLES = [
  "owner",
  "admin",
  "manager",
  "collaborator",
  "investigator",
  "auditor",
] as const;

export const appRoleSchema = z.enum(APP_ROLES);
export type AppRole = z.infer<typeof appRoleSchema>;

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  manager: "Gestor",
  collaborator: "Colaborador",
  investigator: "Investigador",
  auditor: "Auditor",
};

// ============================================================================
// Schema: address (JSONB compartilhado)
// ============================================================================

export const addressSchema = z.object({
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().length(2).optional(),
});

export type Address = z.infer<typeof addressSchema>;

// ============================================================================
// Schema: organization
// ============================================================================

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Nome é obrigatório"),
  slug: z
    .string()
    .min(2, "Slug deve ter pelo menos 2 caracteres")
    .regex(/^[a-z0-9-]+$/, "Slug deve conter apenas letras minúsculas, números e hífens"),
  legal_name: z.string().nullable().optional(),
  trade_name: z.string().nullable().optional(),
  document_type: z.enum(["CNPJ", "CPF"]).default("CNPJ"),
  document_number: z.string().nullable().optional(),
  email: z.string().email("E-mail inválido").nullable().optional(),
  phone: z.string().nullable().optional(),
  address: addressSchema.optional().default({}),
  settings: z.record(z.string(), z.unknown()).optional().default({}),
  plan: z.string().default("trial"),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
});

export type Organization = z.infer<typeof organizationSchema>;

export const createOrganizationSchema = organizationSchema.pick({
  name: true,
  slug: true,
  legal_name: true,
  trade_name: true,
  document_type: true,
  document_number: true,
  email: true,
  phone: true,
});

export type CreateOrganization = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = createOrganizationSchema.partial();
export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>;

// ============================================================================
// Schema: establishment
// ============================================================================

export const establishmentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string().min(1, "Nome é obrigatório"),
  code: z.string().nullable().optional(),
  document_number: z.string().nullable().optional(),
  is_headquarters: z.boolean().default(false),
  phone: z.string().nullable().optional(),
  email: z.string().email("E-mail inválido").nullable().optional(),
  address: addressSchema.optional().default({}),
  employee_count: z.number().int().min(0).default(0),
  cnae_code: z.string().nullable().optional(),
  risk_grade: z.number().int().min(1).max(4).nullable().optional(),
  active: z.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
});

export type Establishment = z.infer<typeof establishmentSchema>;

export const createEstablishmentSchema = establishmentSchema.pick({
  name: true,
  code: true,
  document_number: true,
  is_headquarters: true,
  phone: true,
  email: true,
  address: true,
  employee_count: true,
  cnae_code: true,
  risk_grade: true,
});

export type CreateEstablishment = z.infer<typeof createEstablishmentSchema>;

export const updateEstablishmentSchema = createEstablishmentSchema.partial();
export type UpdateEstablishment = z.infer<typeof updateEstablishmentSchema>;

// ============================================================================
// Schema: department
// ============================================================================

export const departmentSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  establishment_id: z.string().uuid(),
  name: z.string().min(1, "Nome é obrigatório"),
  code: z.string().nullable().optional(),
  parent_department_id: z.string().uuid().nullable().optional(),
  manager_user_id: z.string().uuid().nullable().optional(),
  employee_count: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
});

export type Department = z.infer<typeof departmentSchema>;

export const createDepartmentSchema = departmentSchema.pick({
  establishment_id: true,
  name: true,
  code: true,
  parent_department_id: true,
  manager_user_id: true,
  employee_count: true,
});

export type CreateDepartment = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial();
export type UpdateDepartment = z.infer<typeof updateDepartmentSchema>;

// ============================================================================
// Schema: organization member
// ============================================================================

export const organizationMemberSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: appRoleSchema,
  invited_by: z.string().uuid().nullable().optional(),
  invited_at: z.string().datetime().nullable().optional(),
  accepted_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
});

export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email("E-mail inválido"),
  role: appRoleSchema.default("collaborator"),
});

export type InviteMember = z.infer<typeof inviteMemberSchema>;

export const updateMemberRoleSchema = z.object({
  role: appRoleSchema,
});

export type UpdateMemberRole = z.infer<typeof updateMemberRoleSchema>;
