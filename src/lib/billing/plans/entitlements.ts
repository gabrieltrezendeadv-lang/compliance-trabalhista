/**
 * ENTITLEMENTS — que recursos cada plano libera, e em que modo
 *
 * Funções puras. O cadeado da interface é apresentação; o que decide é isto,
 * chamado do servidor. Ver docs/decisions/PLANOS-E-PRECIFICACAO.md §2.
 *
 * ── DUAS PERGUNTAS DIFERENTES ───────────────────────────────────────────────
 *
 *   planIncludes()    — o recurso pertence ao plano?
 *   canWrite()        — o estado da assinatura permite ESCREVER agora?
 *
 * Confundi-las é o erro clássico: uma organização em modo leitura continua
 * tendo "Riscos" no plano, e continua podendo VER os riscos já cadastrados —
 * o modelo aprovado é explícito em que nenhum dado desaparece por
 * inadimplência ou downgrade. O que ela não pode é criar e alterar.
 */

import { PLANS, getPlan } from "./catalog";
import type {
  FeatureKey,
  PlanSlug,
  SubscriptionState,
} from "./model";

/** Recursos liberados pelo plano, em ordem estável. */
export function planFeatures(plan: PlanSlug): readonly FeatureKey[] {
  return getPlan(plan).features;
}

/** O recurso pertence ao plano? Ausência da chave é bloqueio. */
export function planIncludes(plan: PlanSlug, feature: FeatureKey): boolean {
  return getPlan(plan).features.includes(feature);
}

/**
 * Recursos que EXISTEM no produto mas não pertencem a este plano — os que a
 * interface mostra com cadeado.
 */
export function lockedFeatures(plan: PlanSlug): readonly FeatureKey[] {
  const doPlano = new Set(getPlan(plan).features);
  const todos = new Set<FeatureKey>();
  for (const p of PLANS) for (const f of p.features) todos.add(f);
  return [...todos].filter((f) => !doPlano.has(f));
}

/** Armazenamento incluído, em MiB inteiros. */
export function storageQuotaMib(plan: PlanSlug): number {
  return getPlan(plan).storageMib;
}

/** SLA de suporte, em dias úteis. */
export function supportSlaBusinessDays(plan: PlanSlug): number {
  return getPlan(plan).supportBusinessDays;
}

// ─── Modo de acesso ────────────────────────────────────────────────────────

/**
 * Estados em que a escrita está liberada.
 *
 * `past_due_tolerance` está aqui de propósito: os 7 dias de tolerância dão
 * ACESSO NORMAL, não acesso degradado. `cancel_scheduled` também: o
 * cancelamento vale ao fim do período pago, e até lá nada muda.
 *
 * A lista é de PERMISSÃO, não de negação. Um estado novo que alguém acrescente
 * ao modelo e esqueça de classificar cai fora dela e fica somente leitura — que
 * é o lado seguro do erro.
 */
const ESTADOS_COM_ESCRITA: readonly SubscriptionState[] = [
  "trialing",
  "active",
  "past_due_tolerance",
  "cancel_scheduled",
];

export function canWrite(state: SubscriptionState): boolean {
  return ESTADOS_COM_ESCRITA.includes(state);
}

/** `true` quando o acesso é apenas de leitura. Complementar de `canWrite`. */
export function isReadOnly(state: SubscriptionState): boolean {
  return !canWrite(state);
}
