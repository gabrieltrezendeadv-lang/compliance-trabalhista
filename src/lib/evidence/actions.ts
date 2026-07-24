"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { EVIDENCE_PAGE_SIZE } from "@/lib/constants"

/**
 * AVISO LEGAL: Este relatório depende de validação por profissional habilitado.
 * Os dados gerados possuem caráter informativo e não substituem parecer técnico.
 */

// ── Helpers ─────────────────────────────────────────────────────────────────

async function resolveTenantId() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new Error("Usuário não autenticado")
  }

  const { data: tenantId, error: rpcError } = await supabase.rpc(
    "fn_resolve_tenant_id",
  )

  if (rpcError || !tenantId) {
    throw new Error("Não foi possível resolver o tenant")
  }

  return { supabase, user, tenantId: tenantId as string }
}

// ── Evidence Reports ────────────────────────────────────────────────────────

export async function getEvidenceReports(
  page: number,
  filters?: { type?: string; status?: string },
) {
  const { supabase, tenantId } = await resolveTenantId()

  const from = (page - 1) * EVIDENCE_PAGE_SIZE
  const to = from + EVIDENCE_PAGE_SIZE - 1

  let query = supabase
    .from("evidence_reports")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (filters?.type) {
    query = query.eq("source_type", filters.type)
  }

  if (filters?.status) {
    query = query.eq("status", filters.status)
  }

  const { data, count, error } = await query

  if (error) {
    return { error: error.message }
  }

  return {
    data,
    total: count ?? 0,
    page,
    pageSize: EVIDENCE_PAGE_SIZE,
    disclaimer:
      "Este relatório depende de validação por profissional habilitado.",
  }
}

export async function getEvidenceReportDetail(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("fn_get_evidence_report_detail", {
    p_report_id: id,
  })

  if (error) {
    return { error: error.message }
  }

  return {
    data,
    disclaimer:
      "Este relatório depende de validação por profissional habilitado.",
  }
}

export async function generateEvidenceReport(formData: FormData) {
  const { supabase } = await resolveTenantId()

  const sourceType = formData.get("source_type") as string
  const sourceId = formData.get("source_id") as string
  const title = formData.get("title") as string

  const { data, error } = await supabase.rpc("fn_generate_evidence_report", {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_title: title,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/dashboard/evidence")
  return {
    data,
    disclaimer:
      "Este relatório depende de validação por profissional habilitado.",
  }
}

// ── Evidence Packages ───────────────────────────────────────────────────────

export async function getEvidencePackages(page: number) {
  const { supabase, tenantId } = await resolveTenantId()

  const from = (page - 1) * EVIDENCE_PAGE_SIZE
  const to = from + EVIDENCE_PAGE_SIZE - 1

  const { data, count, error } = await supabase
    .from("evidence_packages")
    .select("*, evidence_package_items(count)", { count: "exact" })
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) {
    return { error: error.message }
  }

  return {
    data,
    total: count ?? 0,
    page,
    pageSize: EVIDENCE_PAGE_SIZE,
  }
}

export async function getEvidencePackageDetail(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc(
    "fn_get_evidence_package_detail",
    { p_package_id: id },
  )

  if (error) {
    return { error: error.message }
  }

  return { data }
}

export async function createEvidencePackage(formData: FormData) {
  const { supabase, tenantId, user } = await resolveTenantId()

  const name = formData.get("name") as string
  const description = (formData.get("description") as string) || null

  const { data, error } = await supabase
    .from("evidence_packages")
    .insert({
      tenant_id: tenantId,
      name,
      description,
      status: "draft",
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/dashboard/evidence/packages")
  return { data }
}

export async function addReportToPackage(
  packageId: string,
  reportId: string,
) {
  const { supabase, tenantId } = await resolveTenantId()

  const { data, error } = await supabase
    .from("evidence_package_items")
    .insert({
      tenant_id: tenantId,
      package_id: packageId,
      report_id: reportId,
    })
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath(`/dashboard/evidence/packages/${packageId}`)
  return { data }
}

export async function removeReportFromPackage(itemId: string) {
  const { supabase, tenantId } = await resolveTenantId()

  const { error } = await supabase
    .from("evidence_package_items")
    .delete()
    .eq("id", itemId)
    .eq("tenant_id", tenantId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/dashboard/evidence/packages")
  return { success: true }
}

export async function sealEvidencePackage(packageId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("fn_seal_evidence_package", {
    p_package_id: packageId,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath(`/dashboard/evidence/packages/${packageId}`)
  revalidatePath("/dashboard/evidence/packages")
  return { data }
}
