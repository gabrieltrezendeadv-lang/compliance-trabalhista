/**
 * Billing Guard — Plan limit verification middleware
 *
 * ADR-005: Limites verificados em tempo real ANTES de operações.
 * Called by server actions before any resource creation to enforce
 * plan limits and subscription status.
 *
 * Usage in server actions:
 *   const guard = await enforcePlanLimit("establishments")
 *   if (!guard.allowed) return { error: guard.message }
 */

import { createClient } from "@/lib/supabase/server"
import type { SubscriptionStatus } from "./types"

export interface GuardResult {
  allowed: boolean
  message?: string
  /** Reason code for programmatic handling */
  reason?:
    | "ok"
    | "no_subscription"
    | "subscription_blocked"
    | "read_only_mode"
    | "limit_reached"
    | "not_authenticated"
    | "no_organization"
  /** Current usage count */
  current?: number
  /** Plan limit (null = unlimited) */
  limit?: number | null
}

// Status messages in Portuguese for user-facing errors
const STATUS_MESSAGES: Record<string, string> = {
  no_subscription:
    "Nenhuma assinatura ativa encontrada. Assine um plano para continuar.",
  subscription_blocked:
    "Sua assinatura está bloqueada por inadimplência. Regularize o pagamento para continuar.",
  read_only_mode:
    "Sua conta está em modo somente leitura por inadimplência. Regularize o pagamento para criar novos recursos.",
  limit_reached:
    "Limite do plano atingido. Faça upgrade para um plano superior.",
  not_authenticated: "Sessão expirada. Faça login novamente.",
  no_organization: "Organização não encontrada.",
}

/**
 * Enforce plan limit before a create operation.
 * Call this at the top of any server action that creates resources.
 */
export async function enforcePlanLimit(
  metric: string
): Promise<GuardResult> {
  const supabase = await createClient()

  // 1. Get user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      allowed: false,
      reason: "not_authenticated",
      message: STATUS_MESSAGES.not_authenticated,
    }
  }

  // 2. Get tenant
  const { data: membership } = await supabase
    .from("organization_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(1)
    .single()

  if (!membership) {
    return {
      allowed: false,
      reason: "no_organization",
      message: STATUS_MESSAGES.no_organization,
    }
  }

  // 3. Check via RPC
  const { data, error } = await supabase.rpc("check_plan_limit", {
    p_tenant_id: membership.tenant_id,
    p_metric: metric,
  })

  if (error) {
    // If RPC fails (e.g., no subscription table), allow operation
    // This supports onboarding before a subscription exists
    console.warn(`[billing-guard] RPC error for metric=${metric}:`, error.message)
    return { allowed: true, reason: "ok" }
  }

  const result = data as {
    allowed: boolean
    limit: number | null
    current: number
    remaining?: number
    reason?: string
  }

  if (!result.allowed) {
    const reason = (result.reason ?? "limit_reached") as GuardResult["reason"]
    return {
      allowed: false,
      reason,
      message:
        STATUS_MESSAGES[reason ?? "limit_reached"] ??
        STATUS_MESSAGES.limit_reached,
      current: result.current,
      limit: result.limit,
    }
  }

  return {
    allowed: true,
    reason: "ok",
    current: result.current,
    limit: result.limit,
  }
}

/**
 * Check if the tenant's subscription allows write operations.
 * Use this for operations that aren't metric-based
 * (e.g., editing records in partially_blocked state).
 */
export async function enforceWriteAccess(): Promise<GuardResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      allowed: false,
      reason: "not_authenticated",
      message: STATUS_MESSAGES.not_authenticated,
    }
  }

  const { data: subscription } = await supabase
    .from("tenant_subscriptions")
    .select("status")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle()

  // No subscription = allow (onboarding/trial)
  if (!subscription) {
    return { allowed: true, reason: "ok" }
  }

  const status = subscription.status as SubscriptionStatus

  const blockedStatuses: SubscriptionStatus[] = [
    "fully_blocked",
    "cancelled",
  ]

  const readOnlyStatuses: SubscriptionStatus[] = ["partially_blocked"]

  if (blockedStatuses.includes(status)) {
    return {
      allowed: false,
      reason: "subscription_blocked",
      message: STATUS_MESSAGES.subscription_blocked,
    }
  }

  if (readOnlyStatuses.includes(status)) {
    return {
      allowed: false,
      reason: "read_only_mode",
      message: STATUS_MESSAGES.read_only_mode,
    }
  }

  return { allowed: true, reason: "ok" }
}

/**
 * Get subscription status warning banner info.
 * Returns null if no warning is needed.
 */
export async function getSubscriptionWarning(): Promise<{
  level: "info" | "warning" | "critical"
  title: string
  message: string
  status: SubscriptionStatus
} | null> {
  const supabase = await createClient()

  const { data: subscription } = await supabase
    .from("tenant_subscriptions")
    .select("status, trial_ends_at, grace_period_ends_at, block_escalation_at")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle()

  if (!subscription) return null

  const status = subscription.status as SubscriptionStatus

  switch (status) {
    case "trialing": {
      const trialEnd = subscription.trial_ends_at
        ? new Date(subscription.trial_ends_at)
        : null
      const daysLeft = trialEnd
        ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86400000))
        : null
      if (daysLeft !== null && daysLeft <= 3) {
        return {
          level: "warning",
          title: "Período de teste expirando",
          message: `Seu período de teste expira em ${daysLeft} dia(s). Assine um plano para manter o acesso.`,
          status,
        }
      }
      return null
    }

    case "past_due":
      return {
        level: "warning",
        title: "Pagamento pendente",
        message:
          "Existe uma fatura vencida. Regularize o pagamento para evitar restrições.",
        status,
      }

    case "grace_period": {
      const graceEnd = subscription.grace_period_ends_at
        ? new Date(subscription.grace_period_ends_at)
        : null
      const daysLeft = graceEnd
        ? Math.max(0, Math.ceil((graceEnd.getTime() - Date.now()) / 86400000))
        : null
      return {
        level: "warning",
        title: "Período de carência",
        message: `Sua conta entrará em modo restrito em ${daysLeft ?? "poucos"} dia(s) se o pagamento não for regularizado.`,
        status,
      }
    }

    case "partially_blocked":
      return {
        level: "critical",
        title: "Funcionalidades restritas",
        message:
          "Novas campanhas, avaliações e cadastros estão bloqueados. Regularize o pagamento para restaurar o acesso completo.",
        status,
      }

    case "fully_blocked":
      return {
        level: "critical",
        title: "Conta em modo somente leitura",
        message:
          "Todas as funcionalidades de escrita estão bloqueadas (exceto canal de denúncias). Regularize o pagamento.",
        status,
      }

    default:
      return null
  }
}
