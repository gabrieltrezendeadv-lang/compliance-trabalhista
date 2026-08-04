/**
 * CASOS DE USO DE ACESSO — o que a organização pode fazer agora, e por quê.
 *
 * ── OS MOTIVOS SÃO DISCRIMINADOS, E ISSO É A REGRA CENTRAL ──────────────────
 *
 * "Sem assinatura", "resposta malformada" e "repositório indisponível" NÃO
 * podem cair no mesmo caminho. A primeira é uma resposta legítima e conhecida;
 * as outras duas são ausência de informação. Colapsá-las num único `null`
 * levaria a camada de cima a tratar um banco fora do ar como "conta sem plano"
 * — e a decidir acesso sobre um estado que ninguém leu.
 *
 * Por isso `AccessDecision` carrega um `reason` fechado, e por isso a falha de
 * leitura sobe como erro em vez de virar decisão.
 *
 * ── FAIL-CLOSED ────────────────────────────────────────────────────────────
 *
 * Nenhum caminho deste arquivo produz acesso a partir de erro. Plano
 * desconhecido, estado desconhecido e falha de leitura NEGAM.
 */

import { fail, ok, type Result } from "../core/errors";
import type { StoredCourtesy } from "../core/repository";
import { isCourtesyActive } from "../plans/eligibility";
import {
  canWrite,
  lockedFeatures,
  planFeatures,
  storageQuotaMib,
} from "../plans/entitlements";
import { resolveState } from "../plans/lifecycle";
import type { FeatureKey, Grandfathering, PlanSlug } from "../plans/model";
import {
  assertTenant,
  contexto,
  type ComandoBase,
  type UseCaseEnv,
} from "./shared";

// ─── Decisão de acesso ─────────────────────────────────────────────────────

/** De onde vem o direito vigente. Fechado: não há "outro". */
export type AccessSource = "courtesy" | "grandfathered" | "subscription" | "trial" | "none";

/**
 * Por que o acesso é o que é.
 *
 * Cada motivo corresponde a uma situação DISTINTA que a camada de cima precisa
 * distinguir — inclusive para escolher a mensagem certa.
 */
export type AccessReason =
  | "flag_desligada"
  | "cortesia_vigente"
  | "trial_em_curso"
  | "assinatura_ativa"
  | "tolerancia_de_pagamento"
  | "direito_adquirido"
  | "downgrade_agendado"
  | "cancelamento_agendado"
  | "modo_leitura_trial_vencido"
  | "modo_leitura_inadimplencia"
  | "modo_leitura_encerrada"
  | "sem_assinatura"
  | "plano_desconhecido"
  | "estado_desconhecido";

export interface AccessDecision {
  readonly source: AccessSource;
  readonly plan: PlanSlug | null;
  readonly readOnly: boolean;
  readonly free: boolean;
  readonly features: readonly FeatureKey[];
  /** Módulos do Completo visíveis SÓ em leitura após downgrade. */
  readonly readOnlyFeatures: readonly FeatureKey[];
  readonly storageMib: number;
  readonly reason: AccessReason;
}

const NEGADO: AccessDecision = {
  source: "none",
  plan: null,
  readOnly: true,
  free: false,
  features: [],
  readOnlyFeatures: [],
  storageMib: 0,
  reason: "sem_assinatura",
};

function negar(reason: AccessReason): AccessDecision {
  return { ...NEGADO, reason };
}

/**
 * Direito de acesso vigente.
 *
 * Precedência: bandeira → cortesia → assinatura → direito adquirido → nada.
 *
 * O direito adquirido é o PISO: é por ele que a organização beneficiada que
 * fez upgrade e depois cancelou volta ao Essencial gratuito em vez de cair em
 * modo leitura. O direito não se extingue por ter sido superado.
 */
export async function resolveBillingAccess(
  env: UseCaseEnv,
  input: ComandoBase & { readonly billingEnabled: boolean }
): Promise<Result<AccessDecision>> {
  const negado = assertTenant<AccessDecision>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  // Com a bandeira desligada, billing não governa nada — e é assim que a 12B
  // permanece inalcançável para o usuário final.
  if (!input.billingEnabled) {
    return ok({
      ...negar("flag_desligada"),
      readOnly: false,
      free: true,
    });
  }

  // Falha de leitura SOBE como erro. Não vira decisão, não vira `none`.
  const estado = await env.repo.readState(env.auth.userId, env.auth.organizationId);
  if (!estado.ok) return estado;

  const agora = env.clock.now();
  const { subscription, courtesies, grandfathering } = estado.value;

  // 1. CORTESIA vigente e não revogada.
  const cortesia = cortesiaVigente(courtesies, env.auth.organizationId, agora);
  if (cortesia !== null) {
    return ok(comPlano("courtesy", cortesia.plan, false, true, "cortesia_vigente", null));
  }

  // 2. ASSINATURA.
  if (subscription !== null) {
    const estadoVigente = resolveState(subscription, agora);
    const plano = subscription.plan;

    // Plano fora do conjunto conhecido NEGA. Um `default` que liberasse o
    // Essencial transformaria dado corrompido em acesso.
    if (plano !== "essencial" && plano !== "completo") {
      return ok(negar("plano_desconhecido"));
    }

    const agendado = subscription.scheduledDowngrade;

    switch (estadoVigente) {
      case "trialing":
        return ok(comPlano("trial", plano, false, true, "trial_em_curso", agendado?.plan ?? null));
      case "active":
        return ok(
          comPlano(
            "subscription",
            plano,
            false,
            false,
            agendado ? "downgrade_agendado" : "assinatura_ativa",
            agendado?.plan ?? null
          )
        );
      case "past_due_tolerance":
        // Tolerância é ACESSO NORMAL por 7 dias — não é degradação.
        return ok(
          comPlano("subscription", plano, false, false, "tolerancia_de_pagamento", null)
        );
      case "cancel_scheduled":
        return ok(
          comPlano("subscription", plano, false, false, "cancelamento_agendado", null)
        );
      case "read_only":
        return ok(
          comPlano(
            "subscription",
            plano,
            true,
            false,
            subscription.paymentFailedAt !== null
              ? "modo_leitura_inadimplencia"
              : "modo_leitura_trial_vencido",
            null
          )
        );
      case "terminated":
        // 12 meses de leitura após o encerramento. Nada é apagado.
        return ok(comPlano("subscription", plano, true, false, "modo_leitura_encerrada", null));
      default:
        // Estado fora do conjunto conhecido NEGA.
        return ok(negar("estado_desconhecido"));
    }
  }

  // 3. DIREITO ADQUIRIDO — o piso.
  if (grandfathering !== null) {
    return ok(comPlano("grandfathered", "essencial", false, true, "direito_adquirido", null));
  }

  // 4. Nada.
  return ok(negar("sem_assinatura"));
}

/** Cortesia vigente da organização, ignorando as revogadas. */
function cortesiaVigente(
  cortesias: readonly StoredCourtesy[],
  organizationId: string,
  agora: string
): StoredCourtesy | null {
  for (const c of cortesias) {
    if (c.revokedAt !== null) continue;
    if (isCourtesyActive(organizationId, c, agora)) return c;
  }
  return null;
}

/**
 * Monta a decisão a partir do plano VIGENTE.
 *
 * ── DOWNGRADE AGENDADO NÃO É DOWNGRADE ──────────────────────────────────────
 *
 * Enquanto o downgrade está apenas AGENDADO, o plano vigente ainda é o
 * Completo, e `lockedFeatures("completo")` é vazio: acesso integral até o fim
 * do período já pago. Nada é reduzido por antecipação — o ciclo foi comprado.
 *
 * Depois que a renovação EFETIVA o downgrade, o plano vigente passa a ser o
 * Essencial, e `lockedFeatures("essencial")` são os módulos exclusivos do
 * Completo. Eles entram em `readOnlyFeatures`: os dados continuam VISÍVEIS,
 * mas nenhum registro novo é aceito. Apagá-los seria destruir dado do cliente
 * por mudança de plano, e o modelo aprovado é explícito em que nada desaparece.
 *
 * O parâmetro `downgradeAlvo` serve só ao motivo relatado; ele NÃO reduz
 * acesso.
 */
function comPlano(
  source: AccessSource,
  plan: PlanSlug,
  readOnly: boolean,
  free: boolean,
  reason: AccessReason,
  _downgradeAlvo: PlanSlug | null
): AccessDecision {
  return {
    source,
    plan,
    readOnly,
    free,
    // Em modo leitura os módulos continuam listados: o acesso existe, a
    // escrita é que não. `canWrite` é a fonte dessa distinção.
    features: planFeatures(plan),
    readOnlyFeatures: readOnly ? planFeatures(plan) : lockedFeatures(plan),
    storageMib: storageQuotaMib(plan),
    reason,
  };
}

/** Conveniência para a camada de cima: pode escrever agora? */
export function podeEscrever(decisao: AccessDecision): boolean {
  return !decisao.readOnly;
}

/** Módulo exclusivo do Completo disponível para ESCRITA? */
export function podeUsarModulo(decisao: AccessDecision, feature: FeatureKey): boolean {
  if (decisao.readOnly) return false;
  if (decisao.readOnlyFeatures.includes(feature)) return false;
  return decisao.features.includes(feature);
}

// ─── Direito adquirido ─────────────────────────────────────────────────────

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
 * O benefício é da ORGANIZAÇÃO. Esta função não usa `userId` para decidir, e é
 * deliberado: não há como vinculá-lo ao usuário por engano.
 */
export async function resolveGrandfatheredAccess(
  env: UseCaseEnv,
  input: ComandoBase & { readonly organizationCreatedAt: string }
): Promise<Result<GrandfatheredDecision>> {
  const negado = assertTenant<GrandfatheredDecision>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const estado = await env.repo.readState(env.auth.userId, env.auth.organizationId);
  if (!estado.ok) return estado;

  if (estado.value.grandfathering !== null) {
    return ok({ eligible: true, plan: "essencial", reason: "ja_registrado" });
  }

  const corte = estado.value.grandfatheringCutoff;
  if (corte === null) {
    return ok({ eligible: false, plan: null, reason: "sem_corte" });
  }
  if (Date.parse(input.organizationCreatedAt) >= Date.parse(corte)) {
    return ok({ eligible: false, plan: null, reason: "posterior_ao_corte" });
  }

  return ok({ eligible: true, plan: "essencial", reason: "elegivel" });
}

/** Registra o direito adquirido. Idempotente: repetir devolve o mesmo. */
export async function saveGrandfathering(
  env: UseCaseEnv,
  input: ComandoBase & { readonly cutoffAt: string }
): Promise<Result<Grandfathering>> {
  const negado = assertTenant<Grandfathering>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const gravado = await env.repo.saveGrandfathering(
    contexto(env),
    input.cutoffAt,
    env.clock.now()
  );
  if (!gravado.ok) return gravado;

  if (gravado.value.kind === "already_granted") {
    const estado = await env.repo.readState(env.auth.userId, env.auth.organizationId);
    if (!estado.ok) return estado;
    if (estado.value.grandfathering === null) {
      return fail("conflict", "direito adquirido registrado e ausente na leitura");
    }
    return ok(estado.value.grandfathering);
  }

  return ok(gravado.value.record);
}

// ─── Cortesia ──────────────────────────────────────────────────────────────

export interface GrantCourtesyInput extends ComandoBase {
  readonly plan: PlanSlug;
  readonly days: number;
  readonly reason: string;
}

/**
 * Concede cortesia por prazo determinado.
 *
 * Prazo é OBRIGATÓRIO e positivo: cortesia sem prazo é plano gratuito
 * disfarçado, e nunca aparece num relatório de receita.
 */
export async function grantCourtesy(
  env: UseCaseEnv,
  input: GrantCourtesyInput
): Promise<Result<StoredCourtesy>> {
  const negado = assertTenant<StoredCourtesy>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  if (!Number.isInteger(input.days) || input.days < 1) {
    return fail("invalid_input", "cortesia exige prazo em dias inteiro e positivo");
  }
  if (input.reason.trim() === "") {
    return fail("invalid_input", "cortesia exige motivo");
  }

  const inicio = env.clock.now();
  const fim = new Date(Date.parse(inicio) + input.days * 86_400_000).toISOString();

  return env.repo.grantCourtesy(contexto(env), input.plan, inicio, fim, input.reason);
}

export interface RevokeCourtesyInput extends ComandoBase {
  readonly courtesyId: string;
  readonly reason: string;
}

/**
 * Revoga cortesia. APPEND-ONLY: a concessão original permanece, com autor e
 * motivo — apagá-la apagaria a prova de que existiu.
 */
export async function revokeCourtesy(
  env: UseCaseEnv,
  input: RevokeCourtesyInput
): Promise<Result<{ readonly revoked: boolean }>> {
  const negado = assertTenant<{ readonly revoked: boolean }>(
    env.auth,
    input.requestedOrganizationId
  );
  if (negado) return negado;

  if (input.reason.trim() === "") {
    return fail("invalid_input", "revogação exige motivo");
  }

  const r = await env.repo.revokeCourtesy(
    contexto(env),
    input.courtesyId,
    env.clock.now(),
    input.reason
  );
  if (!r.ok) return r;

  // Repetir a revogação não é erro: o estado desejado já vale.
  return ok({ revoked: r.value.kind === "revoked" });
}

/** Reexportado para a camada de cima decidir escrita sem reimplementar. */
export { canWrite };
