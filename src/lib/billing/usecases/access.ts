/**
 * CASOS DE USO DE ACESSO — o que a organização pode fazer agora, e por quê.
 *
 * Também as concessões administrativas: cortesia e direito adquirido.
 */

import { fail, ok, type Result } from "../core/errors";
import type { FeatureKey, PlanSlug } from "../plans/model";
import { canWrite, planIncludes, storageQuotaMib } from "../plans/entitlements";
import {
  GRANDFATHERED_PLAN,
  isEligibleForGrandfathering,
  resolveEligibility,
} from "../plans/eligibility";
import { addDays } from "../plans/pricing";
import type { StoredCourtesy } from "../core/repository";
import { assertTenant, auditar, type UseCaseEnv } from "./shared";
import type { ComandoBase } from "./subscription";

// ─── 13. resolveBillingAccess ──────────────────────────────────────────────

export interface BillingAccess {
  readonly source: "courtesy" | "grandfathered" | "subscription" | "trial" | "none";
  readonly plan: PlanSlug | null;
  readonly readOnly: boolean;
  readonly free: boolean;
  readonly features: readonly FeatureKey[];
  readonly storageMib: number;
}

/**
 * Direito de acesso vigente, com precedência cortesia → assinatura → direito
 * adquirido → nada.
 *
 * O direito adquirido é o PISO: é por ele que a organização beneficiada que
 * fez upgrade e cancelou volta ao Essencial gratuito, em vez de cair em modo
 * leitura.
 *
 * Falha de leitura NÃO vira acesso. Devolve erro, e o chamador nega.
 */
export async function resolveBillingAccess(
  env: UseCaseEnv,
  input: ComandoBase = {}
): Promise<Result<BillingAccess>> {
  const negado = assertTenant<BillingAccess>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const assinatura = await env.repo.findSubscription(env.auth.organizationId);
  if (!assinatura.ok) return assinatura;

  const beneficio = await env.repo.findGrandfathering(env.auth.organizationId);
  if (!beneficio.ok) return beneficio;

  const cortesias = await env.repo.listCourtesies(env.auth.organizationId);
  if (!cortesias.ok) return cortesias;

  const agora = env.clock.now();
  // Cortesia revogada não conta. Entre as vigentes, a que termina mais tarde.
  const vigentes = cortesias.value
    .filter((c) => c.revokedAt === null)
    .slice()
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt));
  const cortesia = vigentes.at(-1) ?? null;

  const elegibilidade = resolveEligibility({
    organizationId: env.auth.organizationId,
    subscription: assinatura.value,
    grandfathering: beneficio.value,
    courtesy: cortesia,
    now: agora,
  });

  const plano = elegibilidade.plan;
  return ok({
    source: elegibilidade.source,
    plan: plano,
    readOnly: !canWrite(elegibilidade.state),
    free: elegibilidade.free,
    features: plano ? listarRecursos(plano) : [],
    storageMib: plano ? storageQuotaMib(plano) : 0,
  });
}

/** Recursos do plano, na ordem do catálogo. */
function listarRecursos(plan: PlanSlug): readonly FeatureKey[] {
  const todos: FeatureKey[] = [
    "establishments",
    "departments",
    "users",
    "documents",
    "evidence",
    "action_plans",
    "campaigns_manual",
    "reports_basic",
    "risks",
    "complaints",
    "campaigns_automatic",
    "alerts",
    "reports_advanced",
    "history",
    "seal_hash",
    "priority_support",
  ];
  return todos.filter((f) => planIncludes(plan, f));
}

// ─── 14. resolveGrandfatheredAccess ────────────────────────────────────────

export interface GrandfatheredDecision {
  readonly eligible: boolean;
  readonly plan: PlanSlug | null;
  readonly reason: "sem_corte" | "posterior_ao_corte" | "elegivel" | "ja_registrado";
}

/**
 * Decide se a organização tem direito ao Essencial gratuito permanente.
 *
 * Sem data de corte registrada, NINGUÉM é elegível — o padrão nega, porque
 * conceder gratuidade permanente indevida é irreversível na prática.
 *
 * O benefício é da ORGANIZAÇÃO. Esta função não recebe `userId`, e é
 * deliberado: não há como vinculá-lo ao usuário por engano.
 */
export async function resolveGrandfatheredAccess(
  env: UseCaseEnv,
  input: ComandoBase & { readonly organizationCreatedAt: string }
): Promise<Result<GrandfatheredDecision>> {
  const negado = assertTenant<GrandfatheredDecision>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const jaTem = await env.repo.findGrandfathering(env.auth.organizationId);
  if (!jaTem.ok) return jaTem;
  if (jaTem.value !== null) {
    return ok({ eligible: true, plan: GRANDFATHERED_PLAN, reason: "ja_registrado" });
  }

  const corte = await env.repo.findGrandfatheringCutoff();
  if (!corte.ok) return corte;
  if (corte.value === null) {
    return ok({ eligible: false, plan: null, reason: "sem_corte" });
  }

  if (!isEligibleForGrandfathering(input.organizationCreatedAt, corte.value)) {
    return ok({ eligible: false, plan: null, reason: "posterior_ao_corte" });
  }

  const salvo = await env.repo.saveGrandfathering({
    organizationId: env.auth.organizationId,
    cutoffAt: corte.value,
    grantedAt: env.clock.now(),
  });
  if (!salvo.ok) return salvo;

  const trilha = await auditar(env, {
    subject: "grandfathering",
    subscriptionId: null,
    previousValue: null,
    newValue: {
      plan: GRANDFATHERED_PLAN,
      cutoffAt: corte.value,
      organizationCreatedAt: input.organizationCreatedAt,
    },
    reason: "organização existente na data de corte",
  });
  if (!trilha.ok) return trilha;

  return ok({ eligible: true, plan: GRANDFATHERED_PLAN, reason: "elegivel" });
}

// ─── 15. grantCourtesy ─────────────────────────────────────────────────────

export interface GrantCourtesyInput extends ComandoBase {
  readonly plan: PlanSlug;
  readonly days: number;
  readonly reason: string;
}

/**
 * Concede cortesia administrativa.
 *
 * Prazo, motivo e autor são obrigatórios — cortesia sem prazo é plano gratuito
 * disfarçado, e cortesia sem autor é concessão que ninguém assinou. O autor vem
 * do contexto, nunca do argumento.
 */
export async function grantCourtesy(
  env: UseCaseEnv,
  input: GrantCourtesyInput
): Promise<Result<StoredCourtesy>> {
  const negado = assertTenant<StoredCourtesy>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  if (!Number.isInteger(input.days) || input.days <= 0) {
    return fail("invalid_input", "cortesia exige prazo em dias inteiros positivos");
  }
  if (input.reason.trim() === "") {
    return fail("invalid_input", "cortesia exige motivo");
  }

  // `addDays` da 12A, e não aritmética solta aqui: a soma de dias já é uma
  // função testada, e duplicá-la abriria espaço para as duas divergirem.
  const inicio = env.clock.now();
  const fim = addDays(inicio, input.days);

  const salva = await env.repo.saveCourtesy({
    organizationId: env.auth.organizationId,
    plan: input.plan,
    startsAt: inicio,
    endsAt: fim,
    reason: input.reason,
    // O autor vem do CONTEXTO. Aceitá-lo por argumento permitiria atribuir a
    // concessão a outra pessoa.
    grantedBy: env.auth.userId,
  });
  if (!salva.ok) return salva;

  const trilha = await auditar(env, {
    subject: "courtesy",
    subscriptionId: null,
    previousValue: null,
    newValue: {
      courtesyId: salva.value.id,
      plan: salva.value.plan,
      startsAt: salva.value.startsAt,
      endsAt: salva.value.endsAt,
      grantedBy: salva.value.grantedBy,
    },
    reason: salva.value.reason,
  });
  if (!trilha.ok) return trilha;

  return ok(salva.value);
}

// ─── 16. revokeCourtesy ────────────────────────────────────────────────────

export interface RevokeCourtesyInput extends ComandoBase {
  readonly courtesyId: string;
  readonly reason: string;
}

/**
 * Revoga uma cortesia.
 *
 * A revogação é um registro NOVO, append-only: a cortesia original permanece,
 * com quem a concedeu e por quê. Apagar a concessão apagaria a prova de que
 * ela existiu — e a auditoria de cortesias é justamente o ponto.
 */
export async function revokeCourtesy(
  env: UseCaseEnv,
  input: RevokeCourtesyInput
): Promise<Result<{ courtesyId: string; revokedAt: string }>> {
  const negado = assertTenant<{ courtesyId: string; revokedAt: string }>(
    env.auth,
    input.requestedOrganizationId
  );
  if (negado) return negado;

  if (input.reason.trim() === "") {
    return fail("invalid_input", "revogação exige motivo");
  }

  const agora = env.clock.now();
  const r = await env.repo.revokeCourtesy({
    courtesyId: input.courtesyId,
    organizationId: env.auth.organizationId,
    revokedAt: agora,
    revokedBy: env.auth.userId,
    reason: input.reason,
  });
  if (!r.ok) return r;

  const trilha = await auditar(env, {
    subject: "courtesy",
    subscriptionId: null,
    previousValue: { courtesyId: input.courtesyId, revokedAt: null },
    newValue: { courtesyId: input.courtesyId, revokedAt: agora, revokedBy: env.auth.userId },
    reason: input.reason,
  });
  if (!trilha.ok) return trilha;

  return ok({ courtesyId: input.courtesyId, revokedAt: agora });
}
