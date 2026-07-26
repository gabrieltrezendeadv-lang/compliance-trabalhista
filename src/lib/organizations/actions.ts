"use server";

import { createClient } from "@/lib/supabase/server";
import {
  createEstablishmentSchema,
  updateEstablishmentSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  updateOrganizationSchema,
  updateMemberRoleSchema,
} from "@/lib/schemas/organization";

// ============================================================================
// Organization
// ============================================================================

export async function updateOrganization(orgId: string, raw: unknown) {
  const parsed = updateOrganizationSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update(parsed.data)
    .eq("id", orgId);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

// ============================================================================
// Establishments
// ============================================================================

export async function getEstablishments() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("establishments")
    .select("*")
    .is("deleted_at", null)
    .order("is_headquarters", { ascending: false })
    .order("name");

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: data ?? [] };
}

export async function createEstablishment(raw: unknown) {
  const parsed = createEstablishmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  // Get user's tenant_id
  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id")
    .is("deleted_at", null)
    .limit(1)
    .single();

  if (!membership) {
    return { error: "Organização não encontrada" };
  }

  const { data, error } = await supabase
    .from("establishments")
    .insert({ ...parsed.data, tenant_id: membership.tenant_id })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  return { data };
}

export async function updateEstablishment(id: string, raw: unknown) {
  const parsed = updateEstablishmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("establishments")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function deleteEstablishment(id: string) {
  const supabase = await createClient();
  // Soft delete
  const { error } = await supabase
    .from("establishments")
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

// ============================================================================
// Departments
// ============================================================================

export async function getDepartments(establishmentId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("departments")
    .select("*, establishments(name)")
    .is("deleted_at", null)
    .order("name");

  if (establishmentId) {
    query = query.eq("establishment_id", establishmentId);
  }

  const { data, error } = await query;

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: data ?? [] };
}

export async function createDepartment(raw: unknown) {
  const parsed = createDepartmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id")
    .is("deleted_at", null)
    .limit(1)
    .single();

  if (!membership) {
    return { error: "Organização não encontrada" };
  }

  const { data, error } = await supabase
    .from("departments")
    .insert({ ...parsed.data, tenant_id: membership.tenant_id })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  return { data };
}

export async function updateDepartment(id: string, raw: unknown) {
  const parsed = updateDepartmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("departments")
    .update(parsed.data)
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function deleteDepartment(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("departments")
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

// ============================================================================
// Members
// ============================================================================

export async function getMembers() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("*, profiles(full_name, email, avatar_url)")
    .is("deleted_at", null)
    .order("role");

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: data ?? [] };
}

export async function updateMemberRole(memberId: string, raw: unknown) {
  const parsed = updateMemberRoleSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_members")
    .update({ role: parsed.data.role })
    .eq("id", memberId);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

// SEC-004: Replaced hard DELETE with transactional RPC that does soft-delete,
// last-owner protection, hierarchy check, and audit logging.
export async function removeMember(memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_remove_member", {
    p_member_id: memberId,
  });

  if (error) {
    return { error: error.message };
  }

  const result = data as { success: boolean; error?: string };

  if (!result.success) {
    const errorMessages: Record<string, string> = {
      unauthenticated: "Usuário não autenticado",
      no_tenant: "Organização não encontrada",
      member_not_found: "Membro não encontrado",
      already_removed: "Membro já foi removido",
      cannot_remove_self: "Não é possível remover a si mesmo. Use a opção de sair da organização.",
      insufficient_privileges: "Você não tem permissão para remover este membro",
      forbidden: "Sem permissão para remover membros",
      last_owner_cannot_be_removed: "O último proprietário não pode ser removido. Transfira a propriedade primeiro.",
    };
    return { error: errorMessages[result.error ?? ""] ?? "Erro ao remover membro" };
  }

  return { success: true };
}
