/**
 * AUTORIZAÇÃO DE BILLING — somente o proprietário, verificado no servidor
 *
 * Regra do modelo aprovado: **somente o proprietário contrata, altera ou
 * cancela**. Aqui é onde isso é decidido — nunca na interface.
 *
 * ── TRÊS CAMADAS, E ELAS NÃO SÃO REDUNDANTES ────────────────────────────────
 *
 *   1. ESTRUTURAL — as tabelas novas vivem no schema `billing`, que não é
 *      exposto ao PostgREST. `anon` e `authenticated` não conseguem endereçá-las
 *      de forma alguma.
 *   2. RLS e grants — mesmo se o schema for exposto um dia, a política é negar.
 *   3. ESTA função — o servidor confere o papel antes de qualquer operação.
 *
 * A interface não conta como camada. Esconder um botão é apresentação.
 *
 * ── POR QUE O PAPEL É CONFERIDO EM CÓDIGO, E NÃO SÓ NO FILTRO ───────────────
 *
 * `.eq("role", "owner")` é enviado ao banco E o papel é conferido no objeto
 * devolvido. Parece redundante e não é: um filtro que deixasse de ser aplicado
 * — por refatoração, por RLS ausente, por um cliente falso em teste — passaria
 * despercebido se a decisão dependesse só dele. A conferência explícita
 * transforma "o banco filtrou" em "eu verifiquei".
 */

import { createClient } from "@/lib/supabase/server";

export type BillingAuthDenial =
  | "not_authenticated"
  | "no_organization"
  | "not_owner"
  | "verification_failed";

export interface BillingPrincipal {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: "owner";
}

export type BillingAuthResult =
  | { readonly ok: true; readonly principal: BillingPrincipal }
  | { readonly ok: false; readonly reason: BillingAuthDenial; readonly message: string };

const MENSAGENS: Record<BillingAuthDenial, string> = {
  not_authenticated: "Sessão expirada. Faça login novamente.",
  no_organization: "Organização não encontrada.",
  not_owner:
    "Somente o proprietário da organização pode administrar a assinatura.",
  verification_failed:
    "Não foi possível verificar suas permissões. Tente novamente.",
};

function negar(reason: BillingAuthDenial): BillingAuthResult {
  return { ok: false, reason, message: MENSAGENS[reason] };
}

/**
 * Exige que o chamador seja proprietário da organização.
 *
 * FAIL-CLOSED sem exceção: ausência de sessão, ausência de membership, erro de
 * consulta e papel diferente de `owner` produzem, todos, negação. Não existe
 * ramo que devolva `ok: true` sem ter lido e conferido o papel.
 */
export async function requireBillingOwner(): Promise<BillingAuthResult> {
  const supabase = await createClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) return negar("verification_failed");

  const user = auth?.user;
  if (!user) return negar("not_authenticated");

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .eq("role", "owner")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Erro de consulta NUNCA vira permissão. É o mesmo defeito que este PR
  // corrige em enforcePlanLimit; não pode reaparecer aqui.
  if (error) return negar("verification_failed");
  if (!membership) return negar("no_organization");

  // O filtro foi enviado; ainda assim o papel é conferido.
  if (membership.role !== "owner") return negar("not_owner");

  return {
    ok: true,
    principal: {
      userId: user.id,
      organizationId: membership.tenant_id,
      role: "owner",
    },
  };
}
