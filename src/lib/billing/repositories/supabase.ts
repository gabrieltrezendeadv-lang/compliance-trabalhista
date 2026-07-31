/**
 * REPOSITÓRIO DE BILLING SOBRE SUPABASE — exclusivo do servidor
 *
 * ── POR QUE ESTE ARQUIVO FOI REESCRITO POR INTEIRO ──────────────────────────
 *
 * A versão anterior alcançava o schema com `.schema("billing").from(...)` e
 * NUNCA funcionou. `.schema()` do supabase-js não abre conexão SQL: define o
 * cabeçalho HTTP `Accept-Profile` para o PostgREST, que recusa qualquer schema
 * fora de `db-schemas` com PGRST106. Como `billing` nunca esteve exposto — e
 * continua não estando, por decisão — toda chamada falhava. Nenhum teste
 * percebeu porque nenhum teste instanciava a classe.
 *
 * Agora o acesso é EXCLUSIVAMENTE por `rpc()`, contra as dezesseis funções de
 * `public`, que é o único schema exposto ao PostgREST. Elas rodam como owner e
 * alcançam `billing` por dentro; o `service_role` não tem nem `USAGE` no
 * schema.
 *
 * ── `server-only` NA PRIMEIRA LINHA ─────────────────────────────────────────
 *
 * Este módulo usa a chave `service_role`. Importá-lo de um componente cliente
 * colocaria a chave no bundle do browser. Com `server-only`, a tentativa é ERRO
 * DE BUILD — não um risco a documentar.
 *
 * ── A ALLOWLIST É UM TIPO, NÃO UM COMENTÁRIO ────────────────────────────────
 *
 * `NomeDeRpc` é a união fechada dos dezesseis nomes. Chamar qualquer outra
 * coisa não compila. É mais forte do que uma guarda textual: não há como
 * escrever o nome errado, nem montá-lo dinamicamente.
 *
 * ── FAIL-CLOSED ────────────────────────────────────────────────────────────
 *
 * Erro do PostgREST, resposta ausente, `null` inesperado ou formato diferente
 * do previsto viram `Result` de FALHA. Nenhum caminho deste arquivo converte
 * falha em autorização, e a mensagem do driver NUNCA é propagada — só o
 * `code`, porque mensagens de driver carregam host, usuário e às vezes a URL de
 * conexão inteira.
 */

import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { fail, fromThrown, ok, type Result } from "../core/errors";
import type { BillingActionOrigin } from "../core/ports";
import type {
  AuditEvent,
  BillingLedger,
  BillingRepository,
  BillingState,
  CatalogPrice,
  ChangePlanInput,
  Charge,
  ClaimInput,
  ClaimOutcome,
  ComandoContexto,
  FinalizeCheckoutInput,
  FinalizeOutcome,
  GrandfatheringOutcome,
  ProviderEventInput,
  ProviderEventOutcome,
  RevokeCourtesyOutcome,
  SettleOutcome,
  StartTrialInput,
  StoredCourtesy,
  StoredSubscription,
} from "../core/repository";
import type {
  Grandfathering,
  PlanSlug,
  PriceSnapshot,
  SubscriptionState,
  TierSlug,
} from "../plans/model";

/**
 * As dezesseis, e nada mais.
 *
 * Mantida em sincronia com `scripts/ci/billing-rpc-allowlist.mjs` por
 * `BO-23` — que reprova se as duas divergirem.
 */
type NomeDeRpc =
  | "fn_billing_read_state"
  | "fn_billing_read_catalog"
  | "fn_billing_read_ledger"
  | "fn_billing_start_trial"
  | "fn_billing_change_plan"
  | "fn_billing_schedule_downgrade"
  | "fn_billing_cancel_at_period_end"
  | "fn_billing_transition_state"
  | "fn_billing_record_worker_count"
  | "fn_billing_claim_idempotency"
  | "fn_billing_fail_idempotency"
  | "fn_billing_finalize_checkout"
  | "fn_billing_apply_provider_event"
  | "fn_billing_grant_courtesy"
  | "fn_billing_revoke_courtesy"
  | "fn_billing_save_grandfathering";

type Cliente = ReturnType<typeof createServiceClient>;

type Json = Record<string, unknown>;

/** Erro do PostgREST, no formato mínimo que consumimos. */
interface ErroPostgrest {
  code?: string | null;
  message?: string | null;
}

/**
 * Códigos que a RPC pode levantar e que têm significado de domínio.
 *
 * `42501` é a recusa de autorização — e ela é a MESMA para tenant alheio e
 * inexistente, de propósito. `P0002` é `no_data_found`. `22023`/`23514` são
 * entrada inválida. Qualquer outro é indisponibilidade.
 */
function erroDeRpc<T>(erro: ErroPostgrest, contexto: string): Result<T> {
  const code = erro.code ?? null;

  if (code === "42501") {
    return fail("not_owner", "somente o proprietário administra a assinatura");
  }
  if (code === "P0002") {
    return fail("not_found", `${contexto}: registro inexistente`);
  }
  if (code === "22023" || code === "23514" || code === "22P02") {
    return fail("invalid_input", `${contexto}: entrada rejeitada pelo banco`, { code });
  }
  if (code === "23505") {
    return fail("conflict", `${contexto}: conflito de unicidade`, { code });
  }
  // `restrict_violation` é o que as triggers de `billing.charges` levantam:
  // transição inválida (`paid → failed`) e alteração de coluna imutável. São
  // recusas de DOMÍNIO, decididas pelo banco — mapeá-las como
  // indisponibilidade diria "tente de novo" para algo que nunca vai passar, e
  // esconderia um defeito de lógica atrás de um erro de infraestrutura.
  if (code === "23001") {
    return fail("invalid_state", `${contexto}: transição ou alteração recusada`, { code });
  }
  // Inclusive PGRST202 ("função não encontrada") e PGRST106 ("schema não
  // exposto"): os dois significam que o caminho está quebrado, e caminho
  // quebrado NEGA.
  return fail("repository_unavailable", `${contexto}: indisponível`, { code });
}

function ehObjeto(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function texto(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function inteiro(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export class SupabaseBillingRepository implements BillingRepository {
  readonly #db: Cliente;

  constructor(cliente?: Cliente) {
    this.#db = cliente ?? createServiceClient();
  }

  /**
   * Único ponto de contato com o PostgREST no arquivo inteiro.
   *
   * `nome` é do tipo fechado `NomeDeRpc`: não há como chamar função fora da
   * allowlist, e não há como montar o nome dinamicamente.
   */
  async #chamar<T>(
    nome: NomeDeRpc,
    args: Json,
    mapear: (bruto: unknown) => T | null,
    contexto: string
  ): Promise<Result<T>> {
    try {
      const { data, error } = await this.#db.rpc(nome, args);

      if (error) return erroDeRpc(error as ErroPostgrest, contexto);

      // `data` ausente não é "vazio": é resposta que não entendemos.
      if (data === null || data === undefined) {
        return fail("repository_unavailable", `${contexto}: resposta vazia`);
      }

      const valor = mapear(data);
      if (valor === null) {
        // Formato inesperado. Adivinhar aqui seria transformar um defeito
        // silencioso em comportamento.
        return fail("repository_unavailable", `${contexto}: resposta em formato inesperado`);
      }
      return ok(valor);
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", contexto);
    }
  }

  // ── Leitura ──────────────────────────────────────────────────────────────

  async readState(actorId: string, organizationId: string): Promise<Result<BillingState>> {
    return this.#chamar(
      "fn_billing_read_state",
      { p_actor_id: actorId, p_organization_id: organizationId },
      (bruto) => {
        if (!ehObjeto(bruto)) return null;
        const cortesias = Array.isArray(bruto.courtesies) ? bruto.courtesies : [];
        const assinatura = ehObjeto(bruto.subscription)
          ? paraAssinatura(bruto.subscription)
          : null;
        return {
          subscription: assinatura,
          courtesies: cortesias.map(paraCortesia).filter((c): c is StoredCourtesy => c !== null),
          grandfathering: ehObjeto(bruto.grandfathering)
            ? paraGrandfathering(bruto.grandfathering)
            : null,
          grandfatheringCutoff: texto(bruto.grandfatheringCutoff),
        } satisfies BillingState;
      },
      "estado de billing"
    );
  }

  async readCatalog(
    actorId: string,
    organizationId: string,
    catalogVersion: string
  ): Promise<Result<readonly CatalogPrice[]>> {
    return this.#chamar(
      "fn_billing_read_catalog",
      {
        p_actor_id: actorId,
        p_organization_id: organizationId,
        p_catalog_version: catalogVersion,
      },
      (bruto) => {
        if (!Array.isArray(bruto)) return null;
        const linhas = bruto.map(paraPrecoDeCatalogo);
        return linhas.some((l) => l === null)
          ? null
          : (linhas as CatalogPrice[]);
      },
      "catálogo de preços"
    );
  }

  async readLedger(actorId: string, organizationId: string): Promise<Result<BillingLedger>> {
    return this.#chamar(
      "fn_billing_read_ledger",
      { p_actor_id: actorId, p_organization_id: organizationId },
      (bruto) => {
        if (!ehObjeto(bruto)) return null;
        if (
          !Array.isArray(bruto.charges) ||
          !Array.isArray(bruto.snapshots) ||
          !Array.isArray(bruto.auditEvents)
        ) {
          return null;
        }
        return {
          charges: bruto.charges
            .map(paraCobranca)
            .filter((c): c is Charge => c !== null),
          snapshots: bruto.snapshots
            .map(paraSnapshot)
            .filter((s): s is PriceSnapshot => s !== null),
          auditEvents: bruto.auditEvents
            .map(paraAuditoria)
            .filter((a): a is AuditEvent => a !== null),
        } satisfies BillingLedger;
      },
      "trilha de billing"
    );
  }

  // ── Ciclo de vida ────────────────────────────────────────────────────────

  async startTrial(input: StartTrialInput): Promise<Result<StoredSubscription>> {
    return this.#chamar(
      "fn_billing_start_trial",
      {
        p_actor_id: input.actorId,
        p_organization_id: input.organizationId,
        p_plan: input.plan,
        p_tier: input.tier,
        p_period: input.period,
        p_worker_count: input.workerCount,
        p_cnpj: input.cnpj,
        p_period_start: input.periodStart,
        p_period_end: input.periodEnd,
        p_trial_ends_at: input.trialEndsAt,
        p_amount_cents: input.amountCents,
        p_catalog_version: input.catalogVersion,
        p_correlation_id: input.correlationId,
      },
      (b) => (ehObjeto(b) ? paraAssinatura(b) : null),
      "início de trial"
    );
  }

  async changePlan(input: ChangePlanInput): Promise<Result<StoredSubscription>> {
    return this.#chamar(
      "fn_billing_change_plan",
      {
        p_actor_id: input.actorId,
        p_organization_id: input.organizationId,
        p_plan: input.plan,
        p_tier: input.tier,
        p_period: input.period,
        p_state: input.state,
        p_period_start: input.periodStart,
        p_period_end: input.periodEnd,
        p_amount_cents: input.amountCents,
        p_catalog_version: input.catalogVersion,
        p_subject: input.subject,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId,
        p_now: input.now,
      },
      (b) => (ehObjeto(b) ? paraAssinatura(b) : null),
      "troca de plano"
    );
  }

  async scheduleDowngrade(
    ctx: ComandoContexto,
    plan: PlanSlug,
    tier: TierSlug,
    reason: string | null,
    now: string
  ): Promise<Result<StoredSubscription>> {
    return this.#chamar(
      "fn_billing_schedule_downgrade",
      {
        p_actor_id: ctx.actorId,
        p_organization_id: ctx.organizationId,
        p_plan: plan,
        p_tier: tier,
        p_reason: reason,
        p_correlation_id: ctx.correlationId,
        p_now: now,
      },
      (b) => (ehObjeto(b) ? paraAssinatura(b) : null),
      "agendamento de downgrade"
    );
  }

  async cancelAtPeriodEnd(
    ctx: ComandoContexto,
    reason: string | null,
    now: string
  ): Promise<Result<StoredSubscription>> {
    return this.#chamar(
      "fn_billing_cancel_at_period_end",
      {
        p_actor_id: ctx.actorId,
        p_organization_id: ctx.organizationId,
        p_reason: reason,
        p_correlation_id: ctx.correlationId,
        p_now: now,
      },
      (b) => (ehObjeto(b) ? paraAssinatura(b) : null),
      "cancelamento"
    );
  }

  async transitionState(
    ctx: ComandoContexto,
    state: SubscriptionState,
    origin: Extract<BillingActionOrigin, "owner" | "scheduler">,
    reason: string | null,
    now: string
  ): Promise<Result<StoredSubscription>> {
    return this.#chamar(
      "fn_billing_transition_state",
      {
        p_actor_id: ctx.actorId,
        p_organization_id: ctx.organizationId,
        p_state: state,
        p_origin: origin,
        p_reason: reason,
        p_correlation_id: ctx.correlationId,
        p_now: now,
      },
      (b) => (ehObjeto(b) ? paraAssinatura(b) : null),
      "transição de estado"
    );
  }

  async recordWorkerCount(
    ctx: ComandoContexto,
    workerCount: number,
    now: string
  ): Promise<Result<StoredSubscription>> {
    return this.#chamar(
      "fn_billing_record_worker_count",
      {
        p_actor_id: ctx.actorId,
        p_organization_id: ctx.organizationId,
        p_worker_count: workerCount,
        p_correlation_id: ctx.correlationId,
        p_now: now,
      },
      (b) => (ehObjeto(b) ? paraAssinatura(b) : null),
      "registro de trabalhadores"
    );
  }

  // ── Idempotência ─────────────────────────────────────────────────────────

  async claimIdempotency(input: ClaimInput): Promise<Result<ClaimOutcome>> {
    return this.#chamar(
      "fn_billing_claim_idempotency",
      {
        p_actor_id: input.actorId,
        p_organization_id: input.organizationId,
        p_scope: input.scope,
        p_provider: input.provider,
        p_key: input.key,
        p_fingerprint: input.fingerprint,
        p_correlation_id: input.correlationId,
        p_now: input.now,
      },
      (b) => {
        if (!ehObjeto(b)) return null;
        switch (texto(b.outcome)) {
          case "claimed":
            return { kind: "claimed" } as const;
          case "in_progress":
            return { kind: "in_progress" } as const;
          case "fingerprint_conflict":
            return { kind: "fingerprint_conflict" } as const;
          case "completed":
            return {
              kind: "completed",
              result: ehObjeto(b.result) ? b.result : {},
            } as const;
          default:
            // Desfecho desconhecido é falha, nunca "siga em frente".
            return null;
        }
      },
      "reserva de idempotência"
    );
  }

  async failIdempotency(input: ClaimInput, errorCode: string): Promise<Result<SettleOutcome>> {
    return this.#chamar(
      "fn_billing_fail_idempotency",
      {
        p_actor_id: input.actorId,
        p_organization_id: input.organizationId,
        p_scope: input.scope,
        p_provider: input.provider,
        p_key: input.key,
        p_fingerprint: input.fingerprint,
        p_error_code: errorCode,
        p_now: input.now,
      },
      (b) => {
        if (!ehObjeto(b)) return null;
        switch (texto(b.outcome)) {
          case "failed":
            return { kind: "failed" } as const;
          case "in_progress":
            return { kind: "in_progress" } as const;
          case "fingerprint_conflict":
            return { kind: "fingerprint_conflict" } as const;
          case "completed":
            return {
              kind: "completed",
              result: ehObjeto(b.result) ? b.result : {},
            } as const;
          default:
            return null;
        }
      },
      "marcação de falha"
    );
  }

  async finalizeCheckout(input: FinalizeCheckoutInput): Promise<Result<FinalizeOutcome>> {
    return this.#chamar(
      "fn_billing_finalize_checkout",
      {
        p_actor_id: input.actorId,
        p_organization_id: input.organizationId,
        p_provider: input.provider,
        p_provider_account_id: input.providerAccountId,
        p_external_customer_id: input.externalCustomerId,
        p_external_charge_id: input.externalChargeId,
        p_method: input.method,
        p_amount_cents: input.amountCents,
        p_period_start: input.periodStart,
        p_period_end: input.periodEnd,
        p_idempotency_key: input.idempotencyKey,
        p_fingerprint: input.fingerprint,
        p_correlation_id: input.correlationId,
        p_now: input.now,
      },
      (b) => {
        if (!ehObjeto(b)) return null;
        if (texto(b.outcome) === "fingerprint_conflict") {
          return { kind: "fingerprint_conflict" } as const;
        }
        if (texto(b.outcome) !== "completed") return null;
        const cobranca = ehObjeto(b.charge) ? paraCobranca(b.charge) : null;
        if (cobranca === null) return null;
        return {
          kind: "completed",
          result: ehObjeto(b.result) ? b.result : {},
          charge: cobranca,
        } as const;
      },
      "finalização de checkout"
    );
  }

  async applyProviderEvent(input: ProviderEventInput): Promise<Result<ProviderEventOutcome>> {
    return this.#chamar(
      "fn_billing_apply_provider_event",
      {
        p_provider: input.provider,
        p_provider_account_id: input.providerAccountId,
        p_external_event_id: input.externalEventId,
        p_external_charge_id: input.externalChargeId,
        p_event_type: input.eventType,
        p_occurred_at: input.occurredAt,
        p_correlation_id: input.correlationId,
        p_now: input.now,
      },
      (b) => {
        if (!ehObjeto(b)) return null;
        const desfecho = texto(b.outcome);
        if (desfecho === "duplicate") return { kind: "duplicate" } as const;
        if (desfecho === "out_of_order") {
          return { kind: "out_of_order", reason: texto(b.reason) ?? "fora de ordem" } as const;
        }
        if (desfecho !== "applied") return null;

        const org = texto(b.organizationId);
        const cobranca = ehObjeto(b.charge) ? paraCobranca(b.charge) : null;
        const assinatura = ehObjeto(b.subscription) ? paraAssinatura(b.subscription) : null;
        if (org === null || cobranca === null || assinatura === null) return null;
        return {
          kind: "applied",
          organizationId: org,
          charge: cobranca,
          subscription: assinatura,
        } as const;
      },
      "evento do provider"
    );
  }

  // ── Acesso ───────────────────────────────────────────────────────────────

  async grantCourtesy(
    ctx: ComandoContexto,
    plan: PlanSlug,
    startsAt: string,
    endsAt: string,
    reason: string
  ): Promise<Result<StoredCourtesy>> {
    return this.#chamar(
      "fn_billing_grant_courtesy",
      {
        p_actor_id: ctx.actorId,
        p_organization_id: ctx.organizationId,
        p_plan: plan,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_reason: reason,
        p_correlation_id: ctx.correlationId,
      },
      (b) => (ehObjeto(b) ? paraCortesia(b) : null),
      "concessão de cortesia"
    );
  }

  async revokeCourtesy(
    ctx: ComandoContexto,
    courtesyId: string,
    revokedAt: string,
    reason: string
  ): Promise<Result<RevokeCourtesyOutcome>> {
    return this.#chamar(
      "fn_billing_revoke_courtesy",
      {
        p_actor_id: ctx.actorId,
        p_organization_id: ctx.organizationId,
        p_courtesy_id: courtesyId,
        p_revoked_at: revokedAt,
        p_reason: reason,
        p_correlation_id: ctx.correlationId,
      },
      (b) => {
        if (!ehObjeto(b)) return null;
        const desfecho = texto(b.outcome);
        if (desfecho === "already_revoked") return { kind: "already_revoked" } as const;
        if (desfecho !== "revoked") return null;
        const id = texto(b.courtesyId);
        const quando = texto(b.revokedAt);
        if (id === null || quando === null) return null;
        return { kind: "revoked", courtesyId: id, revokedAt: quando } as const;
      },
      "revogação de cortesia"
    );
  }

  async saveGrandfathering(
    ctx: ComandoContexto,
    cutoffAt: string,
    grantedAt: string
  ): Promise<Result<GrandfatheringOutcome>> {
    return this.#chamar(
      "fn_billing_save_grandfathering",
      {
        p_actor_id: ctx.actorId,
        p_organization_id: ctx.organizationId,
        p_cutoff_at: cutoffAt,
        p_granted_at: grantedAt,
        p_correlation_id: ctx.correlationId,
      },
      (b) => {
        if (!ehObjeto(b)) return null;
        const desfecho = texto(b.outcome);
        if (desfecho === "already_granted") return { kind: "already_granted" } as const;
        if (desfecho !== "granted") return null;
        const registro = paraGrandfathering(b);
        if (registro === null) return null;
        return { kind: "granted", record: registro } as const;
      },
      "direito adquirido"
    );
  }
}

// ─── Conversões ────────────────────────────────────────────────────────────
//
// Cada uma devolve `null` quando a forma não bate. `null` vira
// `repository_unavailable` no `#chamar` — nunca um objeto meio preenchido.

function paraSnapshot(bruto: unknown): PriceSnapshot | null {
  if (!ehObjeto(bruto)) return null;
  const valor = inteiro(bruto.amount_cents);
  const plan = texto(bruto.plan);
  const tier = texto(bruto.tier);
  const period = texto(bruto.period);
  const versao = texto(bruto.catalog_version);
  const quando = texto(bruto.captured_at);
  if (valor === null || !plan || !tier || !period || !versao || !quando) return null;
  return Object.freeze({
    plan: plan as PriceSnapshot["plan"],
    tier: tier as PriceSnapshot["tier"],
    period: period as PriceSnapshot["period"],
    amountCents: valor,
    catalogVersion: versao,
    capturedAt: quando,
  });
}

function paraAssinatura(bruto: Json): StoredSubscription | null {
  const id = texto(bruto.id);
  const org = texto(bruto.organization_id);
  const plan = texto(bruto.plan);
  const tier = texto(bruto.tier);
  const period = texto(bruto.period);
  const state = texto(bruto.state);
  const trabalhadores = inteiro(bruto.worker_count);
  const cnpj = texto(bruto.cnpj);
  const inicio = texto(bruto.current_period_start);
  const fim = texto(bruto.current_period_end);
  if (
    !id || !org || !plan || !tier || !period || !state ||
    trabalhadores === null || !cnpj || !inicio || !fim
  ) {
    return null;
  }

  const downPlan = texto(bruto.scheduled_downgrade_plan);
  const downTier = texto(bruto.scheduled_downgrade_tier);

  return {
    id,
    organizationId: org,
    plan: plan as StoredSubscription["plan"],
    tier: tier as StoredSubscription["tier"],
    period: period as StoredSubscription["period"],
    state: state as StoredSubscription["state"],
    workerCount: trabalhadores,
    cnpj,
    currentPeriodStart: inicio,
    currentPeriodEnd: fim,
    trialEndsAt: texto(bruto.trial_ends_at),
    paymentFailedAt: texto(bruto.payment_failed_at),
    scheduledDowngrade:
      downPlan && downTier
        ? {
            plan: downPlan as StoredSubscription["plan"],
            tier: downTier as StoredSubscription["tier"],
          }
        : null,
    priceSnapshot:
      paraSnapshot(bruto.price_snapshot) ??
      Object.freeze({
        plan: plan as StoredSubscription["plan"],
        tier: tier as StoredSubscription["tier"],
        period: period as StoredSubscription["period"],
        amountCents: 0,
        catalogVersion: "pendente",
        capturedAt: inicio,
      }),
  };
}

function paraCobranca(bruto: unknown): Charge | null {
  if (!ehObjeto(bruto)) return null;
  const id = texto(bruto.id);
  const org = texto(bruto.organization_id);
  const sub = texto(bruto.subscription_id);
  const provider = texto(bruto.provider);
  const conta = texto(bruto.provider_account_id);
  const cliente = texto(bruto.external_customer_id);
  const externo = texto(bruto.external_charge_id);
  const metodo = texto(bruto.method);
  const valor = inteiro(bruto.amount_cents);
  const moeda = texto(bruto.currency);
  const periodicidade = texto(bruto.billing_period);
  const status = texto(bruto.status);
  const inicio = texto(bruto.period_start);
  const fim = texto(bruto.period_end);
  const criada = texto(bruto.created_at);
  if (
    !id || !org || !sub || !provider || !conta || !cliente || !externo ||
    !metodo || valor === null || !moeda || !periodicidade || !status ||
    !inicio || !fim || !criada
  ) {
    return null;
  }
  return {
    id,
    organizationId: org,
    subscriptionId: sub,
    provider,
    providerAccountId: conta,
    externalCustomerId: cliente,
    externalChargeId: externo,
    method: metodo as Charge["method"],
    amountCents: valor,
    currency: moeda,
    billingPeriod: periodicidade as Charge["billingPeriod"],
    status: status as Charge["status"],
    periodStart: inicio,
    periodEnd: fim,
    createdAt: criada,
    paidAt: texto(bruto.paid_at),
    failedAt: texto(bruto.failed_at),
    cancelledAt: texto(bruto.cancelled_at),
    idempotencyKey: texto(bruto.idempotency_key),
  };
}

function paraCortesia(bruto: unknown): StoredCourtesy | null {
  if (!ehObjeto(bruto)) return null;
  const id = texto(bruto.id);
  const org = texto(bruto.organizationId) ?? texto(bruto.organization_id);
  const plan = texto(bruto.plan);
  const inicio = texto(bruto.startsAt) ?? texto(bruto.starts_at);
  const fim = texto(bruto.endsAt) ?? texto(bruto.ends_at);
  const motivo = texto(bruto.reason);
  const autor = texto(bruto.grantedBy) ?? texto(bruto.granted_by);
  if (!id || !org || !plan || !inicio || !fim || !motivo || !autor) return null;
  return {
    id,
    organizationId: org,
    plan: plan as StoredCourtesy["plan"],
    startsAt: inicio,
    endsAt: fim,
    reason: motivo,
    grantedBy: autor,
    revokedAt: texto(bruto.revokedAt) ?? texto(bruto.revoked_at),
  };
}

function paraGrandfathering(bruto: Json): Grandfathering | null {
  const org = texto(bruto.organizationId) ?? texto(bruto.organization_id);
  const corte = texto(bruto.cutoffAt) ?? texto(bruto.cutoff_at);
  const concedido = texto(bruto.grantedAt) ?? texto(bruto.granted_at);
  if (!org || !corte || !concedido) return null;
  return { organizationId: org, cutoffAt: corte, grantedAt: concedido };
}

function paraPrecoDeCatalogo(bruto: unknown): CatalogPrice | null {
  if (!ehObjeto(bruto)) return null;
  const versao = texto(bruto.catalog_version);
  const plan = texto(bruto.plan);
  const tier = texto(bruto.tier);
  if (!versao || !plan || !tier) return null;
  return {
    catalogVersion: versao,
    plan: plan as CatalogPrice["plan"],
    tier: tier as CatalogPrice["tier"],
    monthlyCents: inteiro(bruto.monthly_cents),
    yearlyCents: inteiro(bruto.yearly_cents),
  };
}

function paraAuditoria(bruto: unknown): AuditEvent | null {
  if (!ehObjeto(bruto)) return null;
  const id = texto(bruto.id);
  const org = texto(bruto.organization_id);
  const assunto = texto(bruto.subject);
  const quando = texto(bruto.occurred_at);
  if (!id || !org || !assunto || !quando) return null;
  return {
    id,
    organizationId: org,
    subscriptionId: texto(bruto.subscription_id),
    subject: assunto as AuditEvent["subject"],
    actorId: texto(bruto.actor_id),
    origin: (texto(bruto.origin) ?? "scheduler") as BillingActionOrigin,
    occurredAt: quando,
    previousValue: ehObjeto(bruto.previous_value) ? bruto.previous_value : null,
    newValue: ehObjeto(bruto.new_value) ? bruto.new_value : null,
    reason: texto(bruto.reason),
    idempotencyKey: texto(bruto.idempotency_key),
    correlationId: texto(bruto.correlation_id),
  };
}
