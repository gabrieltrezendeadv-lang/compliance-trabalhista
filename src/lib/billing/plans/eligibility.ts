/**
 * DIREITO ADQUIRIDO E CORTESIA — resolução pura de elegibilidade
 *
 * Ver docs/decisions/PLANOS-E-PRECIFICACAO.md §5.
 *
 * ── DUAS REGRAS QUE PARECEM DETALHE E NÃO SÃO ───────────────────────────────
 *
 * 1. O benefício pertence à ORGANIZAÇÃO, identificada por `organizationId`.
 *    Nunca ao usuário. Se estivesse vinculado ao usuário, qualquer pessoa
 *    beneficiada criaria organizações novas indefinidamente e o corte não
 *    valeria nada. Nenhuma função deste arquivo recebe `userId`, e é
 *    deliberado: não há como vincular ao usuário por engano.
 *
 * 2. Sem data de corte registrada, NINGUÉM é elegível. `cutoffAt: null` nega.
 *    O padrão é negar porque o erro na direção oposta — conceder gratuidade
 *    permanente a quem não tinha direito — é irreversível na prática.
 */

import { addDays } from "./pricing";
import { resolveState } from "./lifecycle";
import type {
  Courtesy,
  EntitlementSource,
  Grandfathering,
  PlanSlug,
  Subscription,
  SubscriptionState,
} from "./model";

function ms(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`instante inválido: ${iso}`);
  return t;
}

/** Plano concedido pelo direito adquirido. Sempre o Essencial, gratuito. */
export const GRANDFATHERED_PLAN: PlanSlug = "essencial";

// ─── Direito adquirido ─────────────────────────────────────────────────────

/**
 * A organização é elegível ao Essencial gratuito permanente?
 *
 * Elegível somente quando existe data de corte E a organização já existia nela.
 * Organização criada DEPOIS do corte — inclusive pelo mesmo usuário de uma
 * organização beneficiada — não é elegível.
 */
export function isEligibleForGrandfathering(
  organizationCreatedAt: string,
  cutoffAt: string | null
): boolean {
  if (cutoffAt === null) return false;
  return ms(organizationCreatedAt) <= ms(cutoffAt);
}

/**
 * Registra o direito adquirido, se elegível. Devolve `null` quando não.
 *
 * Idempotente por construção: chamar duas vezes com a mesma entrada produz o
 * mesmo registro.
 */
export function grantGrandfathering(
  organizationId: string,
  organizationCreatedAt: string,
  cutoffAt: string | null,
  grantedAt: string
): Grandfathering | null {
  if (!isEligibleForGrandfathering(organizationCreatedAt, cutoffAt)) return null;
  return {
    organizationId,
    // `cutoffAt` não é null aqui: `isEligibleForGrandfathering` já negou.
    cutoffAt: cutoffAt as string,
    grantedAt,
  };
}

/**
 * O direito adquirido vale para esta organização?
 *
 * A conferência de `organizationId` é o ponto: um registro de OUTRA organização
 * não beneficia esta, mesmo que o mesmo usuário seja proprietário das duas.
 */
export function holdsGrandfathering(
  organizationId: string,
  record: Grandfathering | null
): boolean {
  return record !== null && record.organizationId === organizationId;
}

// ─── Cortesia administrativa ───────────────────────────────────────────────

export interface CourtesyInput {
  readonly organizationId: string;
  readonly plan: PlanSlug;
  readonly startsAt: string;
  readonly days: number;
  readonly reason: string;
  readonly grantedBy: string;
}

/**
 * Concede cortesia. Prazo, motivo e autor são OBRIGATÓRIOS e validados aqui —
 * cortesia sem prazo é plano gratuito disfarçado, e cortesia sem autor é
 * concessão que ninguém assinou.
 */
export function grantCourtesy(input: CourtesyInput): Courtesy {
  if (!Number.isInteger(input.days) || input.days <= 0) {
    throw new Error(`cortesia exige prazo em dias inteiros positivos: ${input.days}`);
  }
  if (input.reason.trim() === "") {
    throw new Error("cortesia exige motivo");
  }
  if (input.grantedBy.trim() === "") {
    throw new Error("cortesia exige autor identificado");
  }

  return {
    organizationId: input.organizationId,
    plan: input.plan,
    startsAt: input.startsAt,
    endsAt: addDays(input.startsAt, input.days),
    reason: input.reason,
    grantedBy: input.grantedBy,
  };
}

/** A cortesia está vigente em `now`? Início inclusivo, fim exclusivo. */
export function isCourtesyActive(
  organizationId: string,
  courtesy: Courtesy | null,
  now: string
): boolean {
  if (courtesy === null) return false;
  if (courtesy.organizationId !== organizationId) return false;
  return ms(now) >= ms(courtesy.startsAt) && ms(now) < ms(courtesy.endsAt);
}

// ─── Resolução ─────────────────────────────────────────────────────────────

export interface EligibilityInput {
  readonly organizationId: string;
  readonly subscription: Subscription | null;
  readonly grandfathering: Grandfathering | null;
  readonly courtesy: Courtesy | null;
  readonly now: string;
}

export interface Eligibility {
  readonly source: EntitlementSource;
  readonly plan: PlanSlug | null;
  readonly state: SubscriptionState;
  /** `true` quando o acesso vigente não é cobrado. */
  readonly free: boolean;
}

/**
 * Direito de acesso vigente.
 *
 * Precedência, e a ordem é a regra de negócio:
 *
 *   1. CORTESIA vigente — concessão administrativa explícita, com prazo.
 *   2. ASSINATURA em estado que permita uso — trial ou paga.
 *   3. DIREITO ADQUIRIDO — o PISO. É por ele que a organização beneficiada que
 *      fez upgrade e depois cancelou retorna ao Essencial gratuito, em vez de
 *      cair em modo leitura. O direito não se extingue por ter sido superado.
 *   4. Nada — modo leitura.
 */
export function resolveEligibility(input: EligibilityInput): Eligibility {
  if (isCourtesyActive(input.organizationId, input.courtesy, input.now)) {
    return {
      source: "courtesy",
      // `courtesy` não é null: `isCourtesyActive` já teria negado.
      plan: (input.courtesy as Courtesy).plan,
      state: "active",
      free: true,
    };
  }

  if (input.subscription !== null) {
    const estado = resolveState(input.subscription, input.now);
    const utilizavel = estado !== "read_only" && estado !== "terminated";
    if (utilizavel) {
      return {
        source: estado === "trialing" ? "trial" : "subscription",
        plan: input.subscription.plan,
        state: estado,
        free: estado === "trialing",
      };
    }
  }

  if (holdsGrandfathering(input.organizationId, input.grandfathering)) {
    return {
      source: "grandfathered",
      plan: GRANDFATHERED_PLAN,
      state: "active",
      free: true,
    };
  }

  return { source: "none", plan: null, state: "read_only", free: false };
}
