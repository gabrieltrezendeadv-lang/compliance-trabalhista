/**
 * CONTRATO DE PERSISTÊNCIA DE BILLING — Etapa 12B
 *
 * Uma interface, duas implementações: `SupabaseBillingRepository` (servidor,
 * por RPC) e `InMemoryBillingRepository` (teste). A suíte de contrato em
 * `tests/contract/billing-repository.contract.ts` roda as MESMAS expectativas
 * sobre as duas — a real contra PostgREST local, no CI.
 *
 * ── POR QUE O CONTRATO ESPELHA AS RPCs, UMA A UMA ───────────────────────────
 *
 * A versão anterior deste arquivo expunha operações finas — `createCharge`,
 * `appendAuditEvent`, `updateSubscription` — e os casos de uso as encadeavam.
 * Cada elo era uma requisição HTTP, logo uma transação: "cobrança + auditoria"
 * eram duas, e um erro entre elas deixava cobrança sem trilha.
 *
 * Agora cada método é UMA RPC, e cada RPC é UMA transação. O contrato não
 * oferece mais nenhuma peça com a qual se possa montar uma escrita parcial.
 *
 * ── O QUE O CONTRATO GARANTE, E O QUE NÃO GARANTE ───────────────────────────
 *
 * GARANTE: atomicidade de cada chamada, erro TIPADO (nunca exceção crua
 * vazando driver), e recusa INDISTINGUÍVEL entre tenant alheio e inexistente.
 *
 * NÃO GARANTE: atomicidade entre o banco e o provider externo. Isso não existe,
 * e nenhum comentário deste repositório vai fingir que existe. A garantia real
 * está descrita em `docs/decisions/ARQUITETURA-BILLING-12B.md` §5: efeitos
 * idempotentes, estado recuperável, e processamento efetivamente único sob a
 * chave declarada.
 *
 * ── O ATOR NÃO VEM DO CLIENTE ───────────────────────────────────────────────
 *
 * `actorId` e `organizationId` são resolvidos NO SERVIDOR, a partir da sessão,
 * antes de qualquer chamada aqui. O repositório os repassa à RPC, que os
 * revalida contra `public.organization_members` dentro da mesma transação do
 * efeito. Nem o repositório nem a RPC confiam no que o cliente mandou.
 */

import type {
  BillingPeriod,
  Courtesy,
  Grandfathering,
  PlanSlug,
  PriceSnapshot,
  Subscription,
  SubscriptionState,
  TierSlug,
} from "../plans/model";
import type { BillingActionOrigin } from "./ports";
import type { Result } from "./errors";

// ─── Cobrança ──────────────────────────────────────────────────────────────

export type ChargeStatus = "pending" | "paid" | "failed" | "cancelled";

/** Meios aceitos pelo modelo aprovado: PIX e cartão. Nada além disso. */
export type ChargeMethod = "pix" | "credit_card";

export interface Charge {
  readonly id: string;
  readonly organizationId: string;
  readonly subscriptionId: string;
  readonly provider: string;
  readonly providerAccountId: string;
  readonly externalCustomerId: string;
  readonly externalChargeId: string;
  readonly method: ChargeMethod;
  readonly amountCents: number;
  readonly currency: string;
  readonly billingPeriod: BillingPeriod;
  readonly status: ChargeStatus;
  /** Período que esta cobrança quita — impede pagamento antigo de reativar
   *  período posterior. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly createdAt: string;
  readonly paidAt: string | null;
  readonly failedAt: string | null;
  readonly cancelledAt: string | null;
  /** Chave do comando que criou a cobrança. Nulo quando a origem é automática. */
  readonly idempotencyKey: string | null;
}

// ─── Idempotência ──────────────────────────────────────────────────────────

/**
 * `provider_event` — chave é o identificador do evento no provider.
 * `command`        — chave é a informada por quem comanda (upgrade, checkout).
 */
export type IdempotencyScope = "provider_event" | "command";

/**
 * Resultado de uma reserva.
 *
 * União DISCRIMINADA, e não booleano: `created: boolean` não tinha como
 * expressar "a chave existe, está em andamento e o pedido é outro" — que é
 * justamente o caso em que devolver o resultado anterior faz o segundo pedido
 * sumir sem aviso.
 */
export type ClaimOutcome =
  /** A reserva é minha; siga para o provider. */
  | { readonly kind: "claimed" }
  /** Outra execução está em curso sob a mesma chave e o mesmo pedido. */
  | { readonly kind: "in_progress" }
  /** Já concluída: devolva ISTO, sem repetir o efeito. */
  | { readonly kind: "completed"; readonly result: Readonly<Record<string, unknown>> }
  /** Mesma chave, OUTRO pedido. Nunca devolve o resultado do primeiro. */
  | { readonly kind: "fingerprint_conflict" };

export type SettleOutcome =
  | { readonly kind: "failed" }
  | { readonly kind: "completed"; readonly result: Readonly<Record<string, unknown>> }
  | { readonly kind: "in_progress" }
  | { readonly kind: "fingerprint_conflict" };

export type FinalizeOutcome =
  | {
      readonly kind: "completed";
      readonly result: Readonly<Record<string, unknown>>;
      readonly charge: Charge;
    }
  | { readonly kind: "fingerprint_conflict" };

// ─── Evento do provider ────────────────────────────────────────────────────

/**
 * Resultado de um evento externo.
 *
 * `applied` traz a organização RESOLVIDA pelo banco a partir do identificador
 * externo. Ela não é entrada: aceitar a organização do corpo do webhook
 * deixaria quem manda o evento escolher a quem ele se aplica.
 */
export type ProviderEventOutcome =
  | {
      readonly kind: "applied";
      readonly organizationId: string;
      readonly charge: Charge;
      readonly subscription: StoredSubscription;
    }
  | { readonly kind: "duplicate" }
  | { readonly kind: "out_of_order"; readonly reason: string };

// ─── Auditoria ─────────────────────────────────────────────────────────────

export type AuditSubject =
  | "worker_count"
  | "tier_change"
  | "plan_change"
  | "courtesy"
  | "grandfathering"
  | "subscription_state"
  | "price_catalog"
  | "payment"
  | "charge"
  /** Aceite dos termos. `newValue` traz a VERSÃO e o instante, nunca o texto. */
  | "terms_acceptance"
  /** Troca de contato financeiro. `newValue` traz a MÁSCARA, nunca o endereço. */
  | "billing_email";

export interface AuditEvent {
  readonly id: string;
  readonly organizationId: string;
  readonly subscriptionId: string | null;
  readonly subject: AuditSubject;
  /** Nulo quando a origem não é humana (webhook, rotina). */
  readonly actorId: string | null;
  readonly origin: BillingActionOrigin;
  readonly occurredAt: string;
  readonly previousValue: Record<string, unknown> | null;
  readonly newValue: Record<string, unknown> | null;
  readonly reason: string | null;
  readonly idempotencyKey: string | null;
  readonly correlationId: string | null;
}

// ─── Catálogo ──────────────────────────────────────────────────────────────

export interface CatalogPrice {
  readonly catalogVersion: string;
  readonly plan: PlanSlug;
  readonly tier: TierSlug;
  readonly monthlyCents: number | null;
  readonly yearlyCents: number | null;
}

// ─── Assinatura ────────────────────────────────────────────────────────────

/**
 * Assinatura como o banco a guarda.
 *
 * Acrescenta à `Subscription` da 12A o que só existe na persistência: a
 * identidade (`id`) e o `cnpj`.
 */
export interface StoredSubscription extends Subscription {
  readonly id: string;
  readonly cnpj: string;
  /**
   * Contato financeiro. OPCIONAL — nulo é estado válido, e não pendência.
   *
   * Fica aqui, e não em `Subscription`, porque é metadado CONTRATUAL: nenhuma
   * regra de acesso, preço ou ciclo de vida o consulta. O domínio da 12A não
   * precisa saber que ele existe.
   */
  readonly billingEmail: string | null;
  /** Versão do documento aceito. Nulo nas assinaturas anteriores à 12C.1. */
  readonly termsVersion: string | null;
  /** Instante do aceite. Sempre casado com `termsVersion`, por CHECK no banco. */
  readonly termsAcceptedAt: string | null;
}

/** Cortesia com identidade e estado de revogação. */
export interface StoredCourtesy extends Courtesy {
  readonly id: string;
  readonly revokedAt: string | null;
}

export type RevokeCourtesyOutcome =
  | { readonly kind: "revoked"; readonly courtesyId: string; readonly revokedAt: string }
  | { readonly kind: "already_revoked" };

export type GrandfatheringOutcome =
  | { readonly kind: "granted"; readonly record: Grandfathering }
  | { readonly kind: "already_granted" };

/** Tudo o que uma organização precisa para decidir acesso, numa leitura só. */
export interface BillingState {
  readonly subscription: StoredSubscription | null;
  readonly courtesies: readonly StoredCourtesy[];
  readonly grandfathering: Grandfathering | null;
  readonly grandfatheringCutoff: string | null;
}

export interface BillingLedger {
  readonly charges: readonly Charge[];
  readonly snapshots: readonly PriceSnapshot[];
  readonly auditEvents: readonly AuditEvent[];
}

// ─── Entradas ──────────────────────────────────────────────────────────────

/** O que TODA operação carrega: quem, por qual organização, sob qual correlação. */
export interface ComandoContexto {
  readonly actorId: string;
  readonly organizationId: string;
  readonly correlationId: string;
}

export interface StartTrialInput extends ComandoContexto {
  readonly plan: PlanSlug;
  readonly tier: TierSlug;
  readonly period: BillingPeriod;
  readonly workerCount: number;
  readonly cnpj: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly trialEndsAt: string;
  readonly amountCents: number | null;
  readonly catalogVersion: string | null;
  /** Contato financeiro, OPCIONAL. `null` e `""` significam a mesma coisa. */
  readonly billingEmail: string | null;
  /**
   * Versão dos termos, OBRIGATÓRIA. Já conferida contra `TERMS_VERSION` pelo
   * caso de uso — o repositório recebe a versão OFICIAL, não a do cliente.
   */
  readonly termsVersion: string;
  /** Instante do aceite, do relógio injetado. Nunca `new Date()` aqui dentro. */
  readonly termsAcceptedAt: string;
}

export interface ChangePlanInput extends ComandoContexto {
  readonly plan: PlanSlug | null;
  readonly tier: TierSlug | null;
  readonly period: BillingPeriod | null;
  readonly state: SubscriptionState | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly amountCents: number | null;
  readonly catalogVersion: string | null;
  readonly subject: Extract<AuditSubject, "plan_change" | "tier_change" | "subscription_state">;
  readonly reason: string | null;
  readonly idempotencyKey: string | null;
  readonly now: string;
}

export interface ClaimInput extends ComandoContexto {
  readonly scope: IdempotencyScope;
  readonly provider: string;
  readonly key: string;
  /** Hash canônico do pedido. NUNCA o pedido em si. */
  readonly fingerprint: string;
  readonly now: string;
}

export interface FinalizeCheckoutInput extends ComandoContexto {
  readonly provider: string;
  readonly providerAccountId: string;
  readonly externalCustomerId: string;
  readonly externalChargeId: string;
  readonly method: ChargeMethod;
  readonly amountCents: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
  readonly now: string;
}

/**
 * Entrada do evento externo.
 *
 * NÃO tem `organizationId` nem `actorId`, e a ausência é o ponto: o webhook não
 * tem sessão, e a organização é resolvida pelo banco a partir do identificador
 * externo. Um campo de organização aqui seria um convite a confiar nele.
 */
export interface ProviderEventInput {
  readonly provider: string;
  readonly providerAccountId: string;
  readonly externalEventId: string;
  readonly externalChargeId: string;
  readonly eventType: "charge_paid" | "charge_failed";
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly now: string;
}

// ─── O contrato ────────────────────────────────────────────────────────────

export interface BillingRepository {
  // Leitura.
  readState(actorId: string, organizationId: string): Promise<Result<BillingState>>;
  readCatalog(
    actorId: string,
    organizationId: string,
    catalogVersion: string
  ): Promise<Result<readonly CatalogPrice[]>>;
  readLedger(actorId: string, organizationId: string): Promise<Result<BillingLedger>>;

  // Ciclo de vida — cada um é uma transação.
  startTrial(input: StartTrialInput): Promise<Result<StoredSubscription>>;
  changePlan(input: ChangePlanInput): Promise<Result<StoredSubscription>>;
  scheduleDowngrade(
    ctx: ComandoContexto,
    plan: PlanSlug,
    tier: TierSlug,
    reason: string | null,
    now: string
  ): Promise<Result<StoredSubscription>>;
  cancelAtPeriodEnd(
    ctx: ComandoContexto,
    reason: string | null,
    now: string
  ): Promise<Result<StoredSubscription>>;
  transitionState(
    ctx: ComandoContexto,
    state: SubscriptionState,
    origin: Extract<BillingActionOrigin, "owner" | "scheduler">,
    reason: string | null,
    now: string
  ): Promise<Result<StoredSubscription>>;
  recordWorkerCount(
    ctx: ComandoContexto,
    workerCount: number,
    now: string
  ): Promise<Result<StoredSubscription>>;

  // Metadados contratuais — Etapa 12C.1.
  //
  // Duas operações ESTREITAS, e não um `updateSubscription` genérico. Um método
  // que aceitasse um patch livre seria um método que se pode enganar a mudar
  // plano junto com o e-mail, e a auditoria registraria o assunto errado.
  /**
   * Troca o contato financeiro. Vazio limpa o campo. Repetir o mesmo valor não
   * gera evento de auditoria — a trilha registra mudança, não requisição.
   */
  updateBillingEmail(
    ctx: ComandoContexto,
    billingEmail: string | null,
    now: string
  ): Promise<Result<StoredSubscription>>;
  /**
   * Registra o aceite de uma versão dos termos.
   *
   * `termsVersion` já vem conferida contra a vigente. Reenviar a versão já
   * aceita é no-op idempotente: preserva o instante original, que é a prova.
   * Versão anterior à já aceita é RECUSADA pelo banco.
   */
  acceptTerms(
    ctx: ComandoContexto,
    termsVersion: string,
    acceptedAt: string
  ): Promise<Result<StoredSubscription>>;

  // Máquina de estados da idempotência.
  claimIdempotency(input: ClaimInput): Promise<Result<ClaimOutcome>>;
  failIdempotency(
    input: ClaimInput,
    errorCode: string
  ): Promise<Result<SettleOutcome>>;
  finalizeCheckout(input: FinalizeCheckoutInput): Promise<Result<FinalizeOutcome>>;
  applyProviderEvent(input: ProviderEventInput): Promise<Result<ProviderEventOutcome>>;

  // Acesso.
  grantCourtesy(
    ctx: ComandoContexto,
    plan: PlanSlug,
    startsAt: string,
    endsAt: string,
    reason: string
  ): Promise<Result<StoredCourtesy>>;
  revokeCourtesy(
    ctx: ComandoContexto,
    courtesyId: string,
    revokedAt: string,
    reason: string
  ): Promise<Result<RevokeCourtesyOutcome>>;
  saveGrandfathering(
    ctx: ComandoContexto,
    cutoffAt: string,
    grantedAt: string
  ): Promise<Result<GrandfatheringOutcome>>;
}
