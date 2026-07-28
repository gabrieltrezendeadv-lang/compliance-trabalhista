"use server"

import { createClient } from "@/lib/supabase/server"
import {
  BillingNotConfiguredError,
  resolveBillingProvider,
} from "./registry"
import type {
  BillingCycle,
  PaymentMethod,
  SubscriptionStatus,
  PlanLimits,
} from "./types"

// ============================================================================
// Tipos de retorno
// ============================================================================

export interface SubscriptionPlan {
  id: string
  name: string
  slug: string
  description: string | null
  priceMonthly: number
  priceYearly: number | null
  limits: PlanLimits
  isActive: boolean
  displayOrder: number
}

export interface TenantSubscription {
  id: string
  tenantId: string
  planId: string
  planName: string
  planSlug: string
  status: SubscriptionStatus
  billingCycle: BillingCycle
  paymentMethod: PaymentMethod | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  cancelledAt: string | null
  limits: PlanLimits
}

// ============================================================================
// Buscar planos disponíveis
// ============================================================================

export async function getSubscriptionPlans(): Promise<{
  data: SubscriptionPlan[]
  error?: string
}> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("is_active", true)
    .order("display_order")

  if (error) return { data: [], error: error.message }

  const plans: SubscriptionPlan[] = (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    priceMonthly: p.price_monthly,
    priceYearly: p.price_yearly,
    limits: parsePlanLimits(p.limits),
    isActive: p.is_active,
    displayOrder: p.display_order,
  }))

  return { data: plans }
}

// ============================================================================
// Buscar assinatura do tenant atual
// ============================================================================

export async function getCurrentSubscription(): Promise<{
  data: TenantSubscription | null
  error?: string
}> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("tenant_subscriptions")
    .select(
      "*, subscription_plans(name, slug, limits)"
    )
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle()

  if (error) return { data: null, error: error.message }
  if (!data) return { data: null }

  const plan = data.subscription_plans as unknown as {
    name: string
    slug: string
    limits: unknown
  }

  return {
    data: {
      id: data.id,
      tenantId: data.tenant_id,
      planId: data.plan_id,
      planName: plan.name,
      planSlug: plan.slug,
      status: data.status as SubscriptionStatus,
      billingCycle: data.billing_cycle as BillingCycle,
      paymentMethod: data.payment_method as PaymentMethod | null,
      currentPeriodStart: data.current_period_start,
      currentPeriodEnd: data.current_period_end,
      trialEndsAt: data.trial_ends_at,
      cancelledAt: data.cancelled_at,
      limits: parsePlanLimits(plan.limits),
    },
  }
}

// ============================================================================
// Buscar faturas
// ============================================================================

export async function getInvoices(): Promise<{
  data: Array<{
    id: string
    status: string
    amount: number
    dueDate: string
    paidAt: string | null
    externalPaymentLink: string | null
    description: string | null
  }>
  error?: string
}> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("invoices")
    .select("id, status, amount, due_date, paid_at, external_payment_link, description")
    .is("deleted_at", null)
    .order("due_date", { ascending: false })
    .limit(20)

  if (error) return { data: [], error: error.message }

  return {
    data: (data ?? []).map((inv) => ({
      id: inv.id,
      status: inv.status,
      amount: inv.amount,
      dueDate: inv.due_date,
      paidAt: inv.paid_at,
      externalPaymentLink: inv.external_payment_link,
      description: inv.description,
    })),
  }
}

// ============================================================================
// Verificar limite do plano (via RPC)
// ============================================================================

export async function checkPlanLimit(metric: string): Promise<{
  allowed: boolean
  limit: number | null
  current: number
  remaining: number
  reason?: string
}> {
  const supabase = await createClient()

  // Resolve tenant_id via membership
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { allowed: false, limit: 0, current: 0, remaining: 0, reason: "not_authenticated" }
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1)
    .single()

  if (!membership) {
    return { allowed: false, limit: 0, current: 0, remaining: 0, reason: "no_organization" }
  }

  const { data, error } = await supabase.rpc("check_plan_limit", {
    p_tenant_id: membership.tenant_id,
    p_metric: metric,
  })

  if (error) {
    // Se não tem assinatura, permitir (período de onboarding)
    return { allowed: true, limit: null, current: 0, remaining: 0 }
  }

  const result = data as {
    allowed: boolean
    limit: number | null
    current: number
    remaining?: number
    reason?: string
  }

  return {
    allowed: result.allowed,
    limit: result.limit,
    current: result.current,
    remaining: result.remaining ?? 0,
    reason: result.reason,
  }
}

// ============================================================================
// Criar assinatura (fluxo de checkout)
// ============================================================================

export async function createSubscription(input: {
  planSlug: string
  billingCycle: BillingCycle
  paymentMethod: PaymentMethod
  customerName: string
  customerEmail: string
  customerCpfCnpj: string
}): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  // 1. Buscar plano
  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("id, price_monthly, price_yearly, name")
    .eq("slug", input.planSlug)
    .eq("is_active", true)
    .single()

  if (!plan) return { success: false, error: "Plano não encontrado" }

  // 2. Resolver tenant
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Não autenticado" }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1)
    .single()

  if (!membership) return { success: false, error: "Organização não encontrada" }

  // 3. Resolver provider real antes de enviar dados pessoais ou alterar o banco.
  let provider: ReturnType<typeof resolveBillingProvider>
  try {
    provider = resolveBillingProvider()
  } catch (error) {
    if (error instanceof BillingNotConfiguredError) {
      return { success: false, error: "Cobrança não configurada" }
    }
    throw error
  }

  // 4. Criar customer no provedor
  const customerResult = await provider.createCustomer({
    name: input.customerName,
    email: input.customerEmail,
    cpfCnpj: input.customerCpfCnpj,
  })

  if (!customerResult.success) {
    return { success: false, error: customerResult.error }
  }

  // 5. Calcular valor
  const value =
    input.billingCycle === "yearly" && plan.price_yearly
      ? plan.price_yearly / 100
      : plan.price_monthly / 100

  // 6. Criar assinatura no provedor
  const subResult = await provider.createSubscription({
    customerId: customerResult.customerId!,
    billingType: input.paymentMethod,
    value,
    cycle: input.billingCycle === "yearly" ? "YEARLY" : "MONTHLY",
    description: `Compliance Trabalhista — ${plan.name}`,
    externalReference: membership.tenant_id,
  })

  if (!subResult.success) {
    return { success: false, error: subResult.error }
  }

  // 7. Salvar/atualizar assinatura no banco
  const { error: upsertError } = await supabase
    .from("tenant_subscriptions")
    .upsert(
      {
        tenant_id: membership.tenant_id,
        plan_id: plan.id,
        status: "active",
        billing_cycle: input.billingCycle,
        payment_method: input.paymentMethod,
        external_customer_id: customerResult.customerId,
        external_subscription_id: subResult.subscriptionId,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(
          Date.now() +
            (input.billingCycle === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000
        ).toISOString(),
        trial_ends_at: null,
      },
      { onConflict: "tenant_id" }
    )

  if (upsertError) {
    return { success: false, error: upsertError.message }
  }

  return { success: true }
}

// ============================================================================
// Helpers
// ============================================================================

function parsePlanLimits(raw: unknown): PlanLimits {
  if (!raw) {
    return {
      maxEstablishments: null,
      maxDepartments: null,
      maxMembers: null,
      maxCampaignsPerMonth: null,
      maxAssessmentsPerMonth: null,
      evidenceStorageMb: null,
      hasApiAccess: false,
      hasCustomBranding: false,
      hasPrioritySupport: false,
    }
  }

  // Supabase returns composite types as tuples "(3,10,15,5,3,512,f,f,f)"
  // or as objects depending on the driver
  if (typeof raw === "string") {
    const match = raw.match(
      /\(([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^,]*),([^)]*)\)/
    )
    if (match) {
      return {
        maxEstablishments: match[1] ? parseInt(match[1]) : null,
        maxDepartments: match[2] ? parseInt(match[2]) : null,
        maxMembers: match[3] ? parseInt(match[3]) : null,
        maxCampaignsPerMonth: match[4] ? parseInt(match[4]) : null,
        maxAssessmentsPerMonth: match[5] ? parseInt(match[5]) : null,
        evidenceStorageMb: match[6] ? parseInt(match[6]) : null,
        hasApiAccess: match[7] === "t",
        hasCustomBranding: match[8] === "t",
        hasPrioritySupport: match[9] === "t",
      }
    }
  }

  // Object format (if returned as object)
  const obj = raw as Record<string, unknown>
  return {
    maxEstablishments: (obj.max_establishments as number) ?? null,
    maxDepartments: (obj.max_departments as number) ?? null,
    maxMembers: (obj.max_members as number) ?? null,
    maxCampaignsPerMonth: (obj.max_campaigns_per_month as number) ?? null,
    maxAssessmentsPerMonth: (obj.max_assessments_per_month as number) ?? null,
    evidenceStorageMb: (obj.evidence_storage_mb as number) ?? null,
    hasApiAccess: !!obj.has_api_access,
    hasCustomBranding: !!obj.has_custom_branding,
    hasPrioritySupport: !!obj.has_priority_support,
  }
}
