"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type TenantResult =
  | { ok: true; tenantId: string }
  | { ok: false; reason: "not_authenticated" | "no_tenant" | "db_error"; message: string };

/**
 * Resolves the current user's tenant.
 *
 * Returns a discriminated union so callers can decide how to handle
 * each failure mode instead of masking everything as "no tenant".
 */
export async function resolveTenantOrFail(): Promise<TenantResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false, reason: "not_authenticated", message: "Sessão expirada" };
  }

  const { data: tenantId, error: rpcError } = await supabase.rpc(
    "fn_resolve_tenant_id",
  );

  if (rpcError) {
    console.error("[tenant-guard] fn_resolve_tenant_id failed:", rpcError.message);
    return { ok: false, reason: "db_error", message: "Erro interno ao resolver organização" };
  }

  if (!tenantId) {
    return { ok: false, reason: "no_tenant", message: "Nenhuma organização vinculada" };
  }

  return { ok: true, tenantId: tenantId as string };
}

/**
 * Guard for server actions. Redirects on auth/tenant failures.
 *
 * - not authenticated → /login
 * - no tenant         → /onboarding
 * - db error          → throws (Next.js error boundary catches it)
 */
export async function requireTenant(): Promise<{ tenantId: string }> {
  const result = await resolveTenantOrFail();

  if (!result.ok) {
    switch (result.reason) {
      case "not_authenticated":
        redirect("/login");
      case "no_tenant":
        redirect("/onboarding");
      case "db_error":
        throw new Error(result.message);
    }
  }

  return { tenantId: result.tenantId };
}
