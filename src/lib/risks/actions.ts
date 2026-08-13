"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { requireTenant } from "@/lib/tenant-guard"
import { RISKS_PAGE_SIZE } from "@/lib/constants"
import {
  createRiskItemSchema,
  updateRiskItemSchema,
  createActionPlanSchema,
  updateActionPlanSchema,
  createReviewSchema,
} from "@/lib/schemas/risk"

// ── Helpers ─────────────────────────────────────────────────────────────────

async function resolveTenantId() {
  const supabase = await createClient()
  const { tenantId } = await requireTenant()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { supabase, user: user!, tenantId }
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function getRiskItems(
  page: number,
  filters?: {
    status?: string
    category?: string
    level?: string
    source?: string
  },
) {
  const { supabase, tenantId } = await resolveTenantId()

  const from = (page - 1) * RISKS_PAGE_SIZE
  const to = from + RISKS_PAGE_SIZE - 1

  let query = supabase
    .from("risk_items")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (filters?.status) {
    query = query.eq("status", filters.status)
  }

  if (filters?.category) {
    query = query.eq("category", filters.category)
  }

  if (filters?.level) {
    query = query.eq("initial_risk_level", filters.level)
  }

  if (filters?.source) {
    query = query.eq("source", filters.source)
  }

  const { data, count, error } = await query

  if (error) {
    return { error: error.message }
  }

  return {
    data,
    total: count ?? 0,
    page,
    pageSize: RISKS_PAGE_SIZE,
  }
}

export async function getRiskSummary() {
  const { supabase } = await resolveTenantId()

  const { data, error } = await supabase.rpc("fn_get_risk_inventory_summary")

  if (error) {
    return { error: error.message }
  }

  return { data }
}

export async function getRiskDetail(riskId: string) {
  const { supabase } = await resolveTenantId()

  const { data, error } = await supabase.rpc("fn_get_risk_detail", {
    p_risk_id: riskId,
  })

  if (error) {
    return { error: error.message }
  }

  return { data }
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function createRiskItem(formData: FormData) {
  const { supabase, user, tenantId } = await resolveTenantId()

  const raw = {
    source: formData.get("source") as string,
    category: formData.get("category") as string,
    title: formData.get("title") as string,
    description: formData.get("description") as string,
    initial_risk_level: formData.get("initial_risk_level") as string,
    initial_score: formData.get("initial_score")
      ? Number(formData.get("initial_score"))
      : undefined,
    priority: (formData.get("priority") as string) || undefined,
    cycle_id: (formData.get("cycle_id") as string) || undefined,
    section_id: (formData.get("section_id") as string) || undefined,
    establishment_id:
      (formData.get("establishment_id") as string) || undefined,
    department_id: (formData.get("department_id") as string) || undefined,
    affected_group: (formData.get("affected_group") as string) || undefined,
    identified_at: (formData.get("identified_at") as string) || undefined,
    identified_by: (formData.get("identified_by") as string) || undefined,
  }

  const parsed = createRiskItemSchema.safeParse(raw)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data, error } = await supabase
    .from("risk_items")
    .insert({
      ...parsed.data,
      tenant_id: tenantId,
      identified_by: parsed.data.identified_by ?? user.id,
      identified_at: parsed.data.identified_at ?? new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/dashboard/risks")
  return { data }
}

export async function updateRiskItem(riskId: string, formData: FormData) {
  const { supabase, tenantId } = await resolveTenantId()

  const raw: Record<string, unknown> = {}

  const stringFields = [
    "category",
    "title",
    "description",
    "initial_risk_level",
    "residual_risk_level",
    "status",
    "priority",
    "establishment_id",
    "department_id",
    "affected_group",
  ] as const

  for (const field of stringFields) {
    const value = formData.get(field)
    if (value !== null) {
      raw[field] = (value as string) || null
    }
  }

  const numericFields = ["initial_score"] as const

  for (const field of numericFields) {
    const value = formData.get(field)
    if (value !== null) {
      raw[field] = value ? Number(value) : null
    }
  }

  const parsed = updateRiskItemSchema.safeParse(raw)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data, error } = await supabase
    .from("risk_items")
    .update(parsed.data)
    .eq("id", riskId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/dashboard/risks")
  revalidatePath(`/dashboard/risks/${riskId}`)
  return { data }
}

export async function createActionPlan(formData: FormData) {
  const { supabase, user, tenantId } = await resolveTenantId()

  const raw = {
    risk_item_id: formData.get("risk_item_id") as string,
    title: formData.get("title") as string,
    description: formData.get("description") as string,
    control_level: (formData.get("control_level") as string) || undefined,
    responsible_user_id:
      (formData.get("responsible_user_id") as string) || undefined,
    due_date: (formData.get("due_date") as string) || undefined,
    status: (formData.get("status") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  }

  const parsed = createActionPlanSchema.safeParse(raw)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data, error } = await supabase
    .from("risk_action_plans")
    .insert({
      ...parsed.data,
      tenant_id: tenantId,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/dashboard/risks")
  revalidatePath(`/dashboard/risks/${parsed.data.risk_item_id}`)
  return { data }
}

export async function updateActionPlan(planId: string, formData: FormData) {
  const { supabase, tenantId } = await resolveTenantId()

  const raw: Record<string, unknown> = {}

  const stringFields = [
    "title",
    "description",
    "control_level",
    "responsible_user_id",
    "due_date",
    "status",
    "completed_at",
    "notes",
  ] as const

  for (const field of stringFields) {
    const value = formData.get(field)
    if (value !== null) {
      raw[field] = (value as string) || null
    }
  }

  const parsed = updateActionPlanSchema.safeParse(raw)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data, error } = await supabase
    .from("risk_action_plans")
    .update(parsed.data)
    .eq("id", planId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/dashboard/risks")
  return { data }
}

export async function createReview(formData: FormData) {
  const { supabase, user, tenantId } = await resolveTenantId()

  const raw = {
    risk_item_id: formData.get("risk_item_id") as string,
    review_date: formData.get("review_date") as string,
    new_risk_level: formData.get("new_risk_level") as string,
    new_score: formData.get("new_score")
      ? Number(formData.get("new_score"))
      : undefined,
    assessment_method: formData.get("assessment_method") as string,
    findings: formData.get("findings") as string,
    recommendation: formData.get("recommendation") as string,
  }

  const parsed = createReviewSchema.safeParse(raw)

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message }
  }

  const { data, error } = await supabase
    .from("risk_reviews")
    .insert({
      ...parsed.data,
      tenant_id: tenantId,
      reviewer_id: user.id,
    })
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/dashboard/risks")
  revalidatePath(`/dashboard/risks/${parsed.data.risk_item_id}`)
  return { data }
}

// ── Import / Cycles ─────────────────────────────────────────────────────────

export async function importRisksFromCycle(cycleId: string) {
  const { supabase } = await resolveTenantId()

  const { data, error } = await supabase.rpc("fn_import_risks_from_cycle", {
    p_cycle_id: cycleId,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/dashboard/risks")
  return { data }
}

export async function getAvailableCyclesForImport() {
  const { supabase, tenantId } = await resolveTenantId()

  const { data, error } = await supabase
    .from("assessment_cycles")
    .select("id, name, created_at, closed_at")
    .eq("tenant_id", tenantId)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })

  if (error) {
    return { error: error.message }
  }

  return { data }
}
