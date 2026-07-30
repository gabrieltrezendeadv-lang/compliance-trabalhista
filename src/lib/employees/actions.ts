"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createEmployeeSchema } from "@/lib/schemas/employee";

export async function getEmployees() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_profiles")
    .select(
      "id, full_name, email, phone, job_title, hire_date, status, establishment_id, department_id, establishments(name), departments(name)"
    )
    .is("deleted_at", null)
    .order("full_name");

  if (error) return { data: [], error: error.message };
  return { data: data ?? [] };
}

export async function createEmployee(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  const parsed = createEmployeeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Revise os dados informados para o colaborador",
    };
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
    .in("role", ["owner", "admin"])
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return { error: "Somente owner ou admin pode cadastrar colaboradores" };
  }

  const { data: establishment } = parsed.data.establishment_id
    ? await supabase
        .from("establishments")
        .select("id")
        .eq("id", parsed.data.establishment_id)
        .eq("tenant_id", membership.tenant_id)
        .is("deleted_at", null)
        .maybeSingle()
    : { data: null };

  if (parsed.data.establishment_id && !establishment) {
    return { error: "Estabelecimento inválido para esta organização" };
  }

  const { data: department } = parsed.data.department_id
    ? await supabase
        .from("departments")
        .select("id, establishment_id")
        .eq("id", parsed.data.department_id)
        .eq("tenant_id", membership.tenant_id)
        .is("deleted_at", null)
        .maybeSingle()
    : { data: null };

  if (parsed.data.department_id && !department) {
    return { error: "Departamento inválido para esta organização" };
  }
  if (
    department &&
    parsed.data.establishment_id &&
    department.establishment_id !== parsed.data.establishment_id
  ) {
    return { error: "O departamento não pertence ao estabelecimento selecionado" };
  }

  const { error } = await supabase.from("employee_profiles").insert({
    ...parsed.data,
    tenant_id: membership.tenant_id,
    status: "active",
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/employees");
  return { success: true };
}

