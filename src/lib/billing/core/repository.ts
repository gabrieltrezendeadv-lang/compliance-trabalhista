/**
 * CONTRATO DE PERSISTÊNCIA DE BILLING
 *
 * Uma interface, duas implementações: `SupabaseBillingRepository` (servidor) e
 * `InMemoryBillingRepository` (teste). A suíte de contrato roda contra as
 * DUAS — um comportamento que só a versão em memória tem é um teste que mede o
 * dublê, não o produto.
 *
 * ── O QUE O REPOSITÓRIO GARANTE, E O QUE NÃO GARANTE ────────────────────────
 *
 * GARANTE: isolamento por `organization_id` em toda leitura e escrita,
 * idempotência por chave única, auditoria em toda escrita relevante, e erro
 * TIPADO — nunca uma exceção crua vazando driver.
 *
 * NÃO GARANTE: autorização. Quem decide se o chamador pode operar é o caso de
 * uso, com o contexto resolvido no servidor. O repositório recebe uma
 * organização já autorizada e não tem como saber se a autorização aconteceu —
 * é por isso que `assertTenant` fica na camada de cima, e não aqui.
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
  readonly externalChargeId: string;
  readonly method: ChargeMethod;
  readonly amountCents: number;
  readonly status: ChargeStatus;
  /** Período que esta cobrança quita — é o que impede pagamento antigo de
   *  reativar período posterior. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly createdAt: string;
  readonly paidAt: string | null;
  readonly failedAt: string | null;
  /** Chave do comando que criou a cobrança. Nulo quando a origem é automática. */
  readonly idempotencyKey: string | null;
}

export interface CreateChargeInput {
  readonly organizationId: string;
  readonly subscriptionId: string;
  readonly provider: string;
  readonly externalChargeId: string;
  readonly method: ChargeMethod;
  readonly amountCents: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly createdAt: string;
  readonly idempotencyKey: string | null;
}

// ─── Cliente no provider ───────────────────────────────────────────────────

export interface BillingCustomer {
  readonly organizationId: string;
  readonly provider: string;
  readonly externalCustomerId: string;
  readonly createdAt: string;
}

// ─── Idempotência ──────────────────────────────────────────────────────────

/**
 * `provider_event` — chave é o identificador do evento no provider.
 * `command`        — chave é a informada por quem comanda (upgrade, checkout).
 */
export type IdempotencyScope = "provider_event" | "command";

export interface IdempotencyRecord {
  readonly organizationId: string;
  readonly scope: IdempotencyScope;
  readonly provider: string;
  readonly key: string;
  /** Resultado gravado na primeira execução, devolvido nas repetições. */
  readonly result: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

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
  | "charge";

export interface AuditEventInput {
  readonly organizationId: string;
  readonly subscriptionId: string | null;
  readonly subject: AuditSubject;
  /** Nulo apenas quando a origem não é humana (webhook, rotina). */
  readonly actorId: string | null;
  readonly origin: BillingActionOrigin;
  readonly occurredAt: string;
  readonly previousValue: Record<string, unknown> | null;
  readonly newValue: Record<string, unknown> | null;
  readonly reason: string | null;
  readonly idempotencyKey: string | null;
  /** Liga eventos da mesma operação — checkout, cobrança e transição. */
  readonly correlationId: string | null;
}

export interface AuditEvent extends AuditEventInput {
  readonly id: string;
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

export interface CreateSubscriptionInput {
  readonly organizationId: string;
  readonly plan: PlanSlug;
  readonly tier: TierSlug;
  readonly period: BillingPeriod;
  readonly state: SubscriptionState;
  readonly workerCount: number;
  readonly cnpj: string;
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly trialEndsAt: string | null;
}

/** Campos que a assinatura aceita mudar. Preço nunca está aqui. */
export interface UpdateSubscriptionInput {
  readonly plan?: PlanSlug;
  readonly tier?: TierSlug;
  readonly state?: SubscriptionState;
  readonly workerCount?: number;
  readonly currentPeriodStart?: string;
  readonly currentPeriodEnd?: string;
  readonly trialEndsAt?: string | null;
  readonly paymentFailedAt?: string | null;
  readonly scheduledDowngrade?: { plan: PlanSlug; tier: TierSlug } | null;
}

/**
 * Assinatura como o banco a guarda.
 *
 * Acrescenta à `Subscription` da 12A o que só existe na persistência: a
 * identidade (`id`) e o `cnpj`. O modelo puro da 12A recebe o CNPJ como
 * ENTRADA de `startTrial` e não o carrega adiante — os cálculos não dependem
 * dele. A coluna, porém, é `NOT NULL`, e é aqui que essa diferença é
 * declarada, em vez de alterar o modelo puro só para agradar ao banco.
 */
export interface StoredSubscription extends Subscription {
  readonly id: string;
  readonly cnpj: string;
}

// ─── O contrato ────────────────────────────────────────────────────────────

export interface BillingRepository {
  // Catálogo — leitura apenas.
  listCatalogPrices(catalogVersion: string): Promise<Result<readonly CatalogPrice[]>>;

  // Assinatura.
  findSubscription(organizationId: string): Promise<Result<StoredSubscription | null>>;
  createSubscription(input: CreateSubscriptionInput): Promise<Result<StoredSubscription>>;
  updateSubscription(
    organizationId: string,
    patch: UpdateSubscriptionInput
  ): Promise<Result<StoredSubscription>>;

  // Snapshot de preço — insere; nunca atualiza.
  appendPriceSnapshot(
    organizationId: string,
    subscriptionId: string,
    snapshot: PriceSnapshot
  ): Promise<Result<PriceSnapshot>>;
  listPriceSnapshots(organizationId: string): Promise<Result<readonly PriceSnapshot[]>>;

  // Cliente no provider.
  findCustomer(organizationId: string, provider: string): Promise<Result<BillingCustomer | null>>;
  saveCustomer(customer: BillingCustomer): Promise<Result<BillingCustomer>>;

  // Cobranças.
  createCharge(input: CreateChargeInput): Promise<Result<Charge>>;
  findChargeByExternalId(
    organizationId: string,
    provider: string,
    externalChargeId: string
  ): Promise<Result<Charge | null>>;
  /**
   * Busca pela chave do COMANDO.
   *
   * É o que permite que um checkout repetido devolva a cobrança original em
   * vez de erro — idempotência de verdade, e não apenas "não duplicou".
   */
  findChargeByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string
  ): Promise<Result<Charge | null>>;
  listCharges(organizationId: string): Promise<Result<readonly Charge[]>>;
  markChargePaid(organizationId: string, chargeId: string, paidAt: string): Promise<Result<Charge>>;
  markChargeFailed(
    organizationId: string,
    chargeId: string,
    failedAt: string
  ): Promise<Result<Charge>>;

  // Grandfathering e cortesia.
  findGrandfatheringCutoff(): Promise<Result<string | null>>;
  findGrandfathering(organizationId: string): Promise<Result<Grandfathering | null>>;
  saveGrandfathering(record: Grandfathering): Promise<Result<Grandfathering>>;
  listCourtesies(organizationId: string): Promise<Result<readonly StoredCourtesy[]>>;
  /**
   * A identidade é atribuída pela PERSISTÊNCIA, não pelo chamador.
   *
   * `billing.courtesies.id` é `uuid DEFAULT gen_random_uuid()`. Deixar o caso
   * de uso inventar o identificador exigiria que ele gerasse um uuid válido —
   * e gerar uuid no domínio é justamente o que a 12B proíbe, porque tornaria o
   * resultado não determinístico.
   */
  saveCourtesy(courtesy: NewCourtesy): Promise<Result<StoredCourtesy>>;
  revokeCourtesy(input: CourtesyRevocation): Promise<Result<CourtesyRevocation>>;

  // Idempotência.
  //
  // `reserve` é a operação ATÔMICA que sustenta a concorrência: devolve
  // `created` quando a chave é nova e `existing` quando já havia — nunca as
  // duas coisas, nunca duas vezes `created` para a mesma chave.
  reserveIdempotency(
    record: IdempotencyRecord
  ): Promise<Result<{ created: boolean; record: IdempotencyRecord }>>;

  // Auditoria.
  appendAuditEvent(event: AuditEventInput): Promise<Result<AuditEvent>>;
  listAuditEvents(organizationId: string): Promise<Result<readonly AuditEvent[]>>;
}

/** Cortesia ainda sem identidade — é a persistência que a atribui. */
export type NewCourtesy = Courtesy;

/** Cortesia com identidade e estado de revogação. */
export interface StoredCourtesy extends Courtesy {
  readonly id: string;
  readonly revokedAt: string | null;
}

export interface CourtesyRevocation {
  readonly courtesyId: string;
  readonly organizationId: string;
  readonly revokedAt: string;
  readonly revokedBy: string;
  readonly reason: string;
}
