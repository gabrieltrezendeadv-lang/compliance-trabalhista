/**
 * REPOSITÓRIO DE BILLING SOBRE SUPABASE — exclusivo do servidor
 *
 * ── POR QUE `server-only` ESTÁ NA PRIMEIRA LINHA ────────────────────────────
 *
 * Este módulo alcança o schema `billing` com `service_role`. Importá-lo de um
 * componente cliente colocaria a chave no bundle do browser. Com `server-only`,
 * a tentativa é ERRO DE BUILD — não um risco a documentar.
 *
 * ── O QUE ELE NÃO FAZ ───────────────────────────────────────────────────────
 *
 *   * não guarda credencial: a chave é lida por `createServiceClient()`, que já
 *     é `server-only` e falha alto se a variável não existir;
 *   * não registra URL, token, chave nem `connection string` em log algum —
 *     mensagens de erro do driver NÃO são propagadas, só o NOME do erro;
 *   * não autoriza: recebe uma organização já autorizada pelo caso de uso.
 *
 * ── ISOLAMENTO ENTRE TENANTS ────────────────────────────────────────────────
 *
 * TODA consulta filtra `organization_id`, inclusive as que buscam por chave
 * primária. Uma cobrança encontrada por `id` mas de outra organização é
 * tratada como inexistente. RLS não substitui isso: `service_role` tem
 * BYPASSRLS, então o filtro no cliente é a barreira efetiva — e é por isso que
 * `scripts/ci/assert-billing-orchestration.sql` prova o isolamento com dois
 * tenants contra PostgreSQL de verdade.
 */

import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { fail, fromThrown, ok, type Result } from "../core/errors";
import type { BillingActionOrigin } from "../core/ports";
import type {
  AuditEvent,
  AuditEventInput,
  BillingCustomer,
  BillingRepository,
  CatalogPrice,
  Charge,
  CourtesyRevocation,
  CreateChargeInput,
  CreateSubscriptionInput,
  IdempotencyRecord,
  NewCourtesy,
  StoredCourtesy,
  StoredSubscription,
  UpdateSubscriptionInput,
} from "../core/repository";
import type { Grandfathering, PriceSnapshot } from "../plans/model";

/** Schema dedicado. Não é `public`, e é isso que mantém o cliente fora. */
const SCHEMA = "billing";

type Cliente = ReturnType<typeof createServiceClient>;

/** Código do PostgreSQL para violação de unicidade. */
const UNIQUE_VIOLATION = "23505";

interface ErroSupabase {
  message?: string;
  code?: string;
}

/**
 * Converte erro do driver em erro tipado.
 *
 * A mensagem original NUNCA é propagada: mensagens de driver carregam host,
 * usuário e, em alguns casos, a URL de conexão inteira. Só o `code` sobrevive,
 * e ele não identifica ninguém.
 */
function erroDeLeitura<T>(erro: ErroSupabase, contexto: string): Result<T> {
  return fail("repository_unavailable", `${contexto}: leitura indisponível`, {
    code: erro.code ?? null,
  });
}

export class SupabaseBillingRepository implements BillingRepository {
  readonly #db: Cliente;

  constructor(cliente?: Cliente) {
    this.#db = cliente ?? createServiceClient();
  }

  #from(tabela: string) {
    // `.schema()` é o que mantém tudo fora de `public`.
    return this.#db.schema(SCHEMA).from(tabela);
  }

  // ── Catálogo ─────────────────────────────────────────────────────────────

  async listCatalogPrices(catalogVersion: string): Promise<Result<readonly CatalogPrice[]>> {
    try {
      const { data, error } = await this.#from("price_catalog")
        .select("catalog_version, plan, tier, monthly_cents, yearly_cents")
        .eq("catalog_version", catalogVersion)
        .order("plan", { ascending: true })
        .order("tier", { ascending: true });

      if (error) return erroDeLeitura(error, "catálogo de preços");
      return ok(
        (data ?? []).map((l) => ({
          catalogVersion: l.catalog_version as string,
          plan: l.plan as CatalogPrice["plan"],
          tier: l.tier as CatalogPrice["tier"],
          monthlyCents: l.monthly_cents as number | null,
          yearlyCents: l.yearly_cents as number | null,
        }))
      );
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "catálogo de preços");
    }
  }

  // ── Assinatura ───────────────────────────────────────────────────────────

  async findSubscription(organizationId: string): Promise<Result<StoredSubscription | null>> {
    try {
      const { data, error } = await this.#from("subscriptions")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) return erroDeLeitura(error, "assinatura");
      if (!data) return ok(null);

      const snapshot = await this.#ultimoSnapshot(data.id as string);
      if (!snapshot.ok) return snapshot;

      return ok(paraAssinatura(data, snapshot.value));
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "assinatura");
    }
  }

  /**
   * Último snapshot da assinatura.
   *
   * O filtro é por `subscription_id`, e não por organização: `price_snapshots`
   * não tem coluna de organização — a 12A a amarrou à assinatura, que por sua
   * vez é única por organização. O isolamento se mantém porque o
   * `subscriptionId` usado aqui SEMPRE vem de uma assinatura já buscada por
   * `organization_id`.
   */
  async #ultimoSnapshot(subscriptionId: string): Promise<Result<PriceSnapshot | null>> {
    const { data, error } = await this.#from("price_snapshots")
      .select("plan, tier, period, amount_cents, catalog_version, captured_at")
      .eq("subscription_id", subscriptionId)
      .order("captured_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return erroDeLeitura(error, "snapshot de preço");
    if (!data) return ok(null);
    return ok(paraSnapshot(data));
  }

  /** Resolve a assinatura da organização, para amarrar leituras por id. */
  async #idDaAssinatura(organizationId: string): Promise<Result<string | null>> {
    const { data, error } = await this.#from("subscriptions")
      .select("id")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) return erroDeLeitura(error, "assinatura");
    return ok((data?.id as string | undefined) ?? null);
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<Result<StoredSubscription>> {
    try {
      const { data, error } = await this.#from("subscriptions")
        .insert({
          organization_id: input.organizationId,
          plan: input.plan,
          tier: input.tier,
          period: input.period,
          state: input.state,
          worker_count: input.workerCount,
          cnpj: input.cnpj,
          current_period_start: input.currentPeriodStart,
          current_period_end: input.currentPeriodEnd,
          trial_ends_at: input.trialEndsAt,
        })
        .select("*")
        .single();

      if (error) {
        // Uma assinatura por organização — o UNIQUE do banco é quem decide.
        if (error.code === UNIQUE_VIOLATION) {
          return fail("conflict", "já existe assinatura para esta organização");
        }
        return erroDeLeitura(error, "criação de assinatura");
      }
      return ok(paraAssinatura(data, null));
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "criação de assinatura");
    }
  }

  async updateSubscription(
    organizationId: string,
    patch: UpdateSubscriptionInput
  ): Promise<Result<StoredSubscription>> {
    try {
      const payload: Record<string, unknown> = {};
      if (patch.plan !== undefined) payload.plan = patch.plan;
      if (patch.tier !== undefined) payload.tier = patch.tier;
      if (patch.state !== undefined) payload.state = patch.state;
      if (patch.workerCount !== undefined) payload.worker_count = patch.workerCount;
      if (patch.currentPeriodStart !== undefined) {
        payload.current_period_start = patch.currentPeriodStart;
      }
      if (patch.currentPeriodEnd !== undefined) {
        payload.current_period_end = patch.currentPeriodEnd;
      }
      if (patch.trialEndsAt !== undefined) payload.trial_ends_at = patch.trialEndsAt;
      if (patch.paymentFailedAt !== undefined) {
        payload.payment_failed_at = patch.paymentFailedAt;
      }
      if (patch.scheduledDowngrade !== undefined) {
        payload.scheduled_downgrade_plan = patch.scheduledDowngrade?.plan ?? null;
        payload.scheduled_downgrade_tier = patch.scheduledDowngrade?.tier ?? null;
      }

      const { data, error } = await this.#from("subscriptions")
        .update(payload)
        // O filtro de organização vai junto com o UPDATE: sem ele, um id
        // trocado alcançaria a assinatura de outro tenant.
        .eq("organization_id", organizationId)
        .select("*")
        .maybeSingle();

      if (error) return erroDeLeitura(error, "atualização de assinatura");
      if (!data) return fail("not_found", "assinatura inexistente para esta organização");

      const snapshot = await this.#ultimoSnapshot(data.id as string);
      if (!snapshot.ok) return snapshot;
      return ok(paraAssinatura(data, snapshot.value));
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "atualização de assinatura");
    }
  }

  // ── Snapshot ─────────────────────────────────────────────────────────────

  async appendPriceSnapshot(
    organizationId: string,
    subscriptionId: string,
    snapshot: PriceSnapshot
  ): Promise<Result<PriceSnapshot>> {
    try {
      // A assinatura precisa ser DESTA organização — sem isto, um
      // `subscriptionId` alheio gravaria snapshot no tenant errado.
      const meu = await this.#idDaAssinatura(organizationId);
      if (!meu.ok) return meu;
      if (meu.value !== subscriptionId) {
        return fail("not_found", "assinatura inexistente para esta organização");
      }

      const { data, error } = await this.#from("price_snapshots")
        .insert({
          subscription_id: subscriptionId,
          plan: snapshot.plan,
          tier: snapshot.tier,
          period: snapshot.period,
          amount_cents: snapshot.amountCents,
          catalog_version: snapshot.catalogVersion,
          captured_at: snapshot.capturedAt,
        })
        .select("plan, tier, period, amount_cents, catalog_version, captured_at")
        .single();

      if (error) return erroDeLeitura(error, "snapshot de preço");
      return ok(paraSnapshot(data));
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "snapshot de preço");
    }
  }

  async listPriceSnapshots(organizationId: string): Promise<Result<readonly PriceSnapshot[]>> {
    try {
      const meu = await this.#idDaAssinatura(organizationId);
      if (!meu.ok) return meu;
      if (meu.value === null) return ok([]);

      const { data, error } = await this.#from("price_snapshots")
        .select("plan, tier, period, amount_cents, catalog_version, captured_at")
        .eq("subscription_id", meu.value)
        .order("captured_at", { ascending: true });

      if (error) return erroDeLeitura(error, "histórico de preços");
      return ok((data ?? []).map(paraSnapshot));
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "histórico de preços");
    }
  }

  // ── Cliente ──────────────────────────────────────────────────────────────

  async findCustomer(
    organizationId: string,
    provider: string
  ): Promise<Result<BillingCustomer | null>> {
    try {
      const { data, error } = await this.#from("customers")
        .select("organization_id, provider, external_customer_id, created_at")
        .eq("organization_id", organizationId)
        .eq("provider", provider)
        .maybeSingle();

      if (error) return erroDeLeitura(error, "cliente do provider");
      if (!data) return ok(null);
      return ok({
        organizationId: data.organization_id as string,
        provider: data.provider as string,
        externalCustomerId: data.external_customer_id as string,
        createdAt: data.created_at as string,
      });
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "cliente do provider");
    }
  }

  async saveCustomer(customer: BillingCustomer): Promise<Result<BillingCustomer>> {
    try {
      const { error } = await this.#from("customers").insert({
        organization_id: customer.organizationId,
        provider: customer.provider,
        external_customer_id: customer.externalCustomerId,
        created_at: customer.createdAt,
      });

      // Corrida: outro processo criou o mesmo cliente. O vencedor é quem já
      // está gravado — trocar o identificador abandonaria o cliente criado no
      // provider.
      if (error && error.code === UNIQUE_VIOLATION) {
        return this.findCustomer(customer.organizationId, customer.provider) as Promise<
          Result<BillingCustomer>
        >;
      }
      if (error) return erroDeLeitura(error, "gravação de cliente");
      return ok(customer);
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "gravação de cliente");
    }
  }

  // ── Cobranças ────────────────────────────────────────────────────────────

  async createCharge(input: CreateChargeInput): Promise<Result<Charge>> {
    try {
      const { data, error } = await this.#from("charges")
        .insert({
          organization_id: input.organizationId,
          subscription_id: input.subscriptionId,
          provider: input.provider,
          external_charge_id: input.externalChargeId,
          method: input.method,
          amount_cents: input.amountCents,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          created_at: input.createdAt,
          idempotency_key: input.idempotencyKey,
        })
        .select("*")
        .single();

      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          return fail("conflict", "cobrança já registrada para este identificador");
        }
        return erroDeLeitura(error, "criação de cobrança");
      }
      return ok(paraCobranca(data));
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "criação de cobrança");
    }
  }

  async findChargeByExternalId(
    organizationId: string,
    provider: string,
    externalChargeId: string
  ): Promise<Result<Charge | null>> {
    try {
      const { data, error } = await this.#from("charges")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("provider", provider)
        .eq("external_charge_id", externalChargeId)
        .maybeSingle();

      if (error) return erroDeLeitura(error, "cobrança");
      return ok(data ? paraCobranca(data) : null);
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "cobrança");
    }
  }

  async findChargeByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string
  ): Promise<Result<Charge | null>> {
    try {
      const { data, error } = await this.#from("charges")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) return erroDeLeitura(error, "cobrança por chave de comando");
      return ok(data ? paraCobranca(data) : null);
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "cobrança por chave de comando");
    }
  }

  async listCharges(organizationId: string): Promise<Result<readonly Charge[]>> {
    try {
      const { data, error } = await this.#from("charges")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });

      if (error) return erroDeLeitura(error, "cobranças");
      return ok((data ?? []).map(paraCobranca));
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "cobranças");
    }
  }

  async markChargePaid(
    organizationId: string,
    chargeId: string,
    paidAt: string
  ): Promise<Result<Charge>> {
    return this.#marcarCobranca(organizationId, chargeId, "paid", paidAt);
  }

  async markChargeFailed(
    organizationId: string,
    chargeId: string,
    failedAt: string
  ): Promise<Result<Charge>> {
    return this.#marcarCobranca(organizationId, chargeId, "failed", failedAt);
  }

  async #marcarCobranca(
    organizationId: string,
    chargeId: string,
    status: "paid" | "failed",
    quando: string
  ): Promise<Result<Charge>> {
    try {
      // As constraints `charges_pago_tem_data` e `charges_falha_tem_data`
      // exigem que estado e carimbo andem juntos: gravá-los na mesma sentença
      // é o que impede um estado sem data.
      const payload =
        status === "paid"
          ? { status, paid_at: quando, updated_at: quando }
          : { status, failed_at: quando, updated_at: quando };

      const { data, error } = await this.#from("charges")
        .update(payload)
        .eq("id", chargeId)
        // Sem este filtro, um id de outra organização seria atualizado.
        .eq("organization_id", organizationId)
        .select("*")
        .maybeSingle();

      if (error) return erroDeLeitura(error, "atualização de cobrança");
      if (!data) return fail("not_found", "cobrança inexistente para esta organização");
      return ok(paraCobranca(data));
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "atualização de cobrança");
    }
  }

  // ── Grandfathering e cortesia ────────────────────────────────────────────

  async findGrandfatheringCutoff(): Promise<Result<string | null>> {
    try {
      const { data, error } = await this.#from("grandfathering_cutoff")
        .select("cutoff_at")
        .maybeSingle();
      if (error) return erroDeLeitura(error, "data de corte");
      return ok((data?.cutoff_at as string | undefined) ?? null);
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "data de corte");
    }
  }

  async findGrandfathering(organizationId: string): Promise<Result<Grandfathering | null>> {
    try {
      const { data, error } = await this.#from("grandfathered_organizations")
        .select("organization_id, cutoff_at, granted_at")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) return erroDeLeitura(error, "direito adquirido");
      if (!data) return ok(null);
      return ok({
        organizationId: data.organization_id as string,
        cutoffAt: data.cutoff_at as string,
        grantedAt: data.granted_at as string,
      });
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "direito adquirido");
    }
  }

  async saveGrandfathering(record: Grandfathering): Promise<Result<Grandfathering>> {
    try {
      const { error } = await this.#from("grandfathered_organizations").insert({
        organization_id: record.organizationId,
        cutoff_at: record.cutoffAt,
        granted_at: record.grantedAt,
        reason: "organização existente na data de corte",
      });
      if (error && error.code === UNIQUE_VIOLATION) {
        return this.findGrandfathering(record.organizationId) as Promise<
          Result<Grandfathering>
        >;
      }
      if (error) return erroDeLeitura(error, "gravação de direito adquirido");
      return ok(record);
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "gravação de direito adquirido");
    }
  }

  async listCourtesies(organizationId: string): Promise<Result<readonly StoredCourtesy[]>> {
    try {
      const { data, error } = await this.#from("courtesies")
        .select("id, organization_id, plan, starts_at, ends_at, reason, granted_by")
        .eq("organization_id", organizationId)
        .order("starts_at", { ascending: true });
      if (error) return erroDeLeitura(error, "cortesias");

      const { data: revogadas, error: erroRev } = await this.#from("courtesy_revocations")
        .select("courtesy_id, revoked_at")
        .eq("organization_id", organizationId);
      if (erroRev) return erroDeLeitura(erroRev, "revogações de cortesia");

      const mapa = new Map(
        (revogadas ?? []).map((r) => [r.courtesy_id as string, r.revoked_at as string])
      );

      return ok(
        (data ?? []).map((c) => ({
          id: c.id as string,
          organizationId: c.organization_id as string,
          plan: c.plan as StoredCourtesy["plan"],
          startsAt: c.starts_at as string,
          endsAt: c.ends_at as string,
          reason: c.reason as string,
          grantedBy: c.granted_by as string,
          revokedAt: mapa.get(c.id as string) ?? null,
        }))
      );
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "cortesias");
    }
  }

  async saveCourtesy(courtesy: NewCourtesy): Promise<Result<StoredCourtesy>> {
    try {
      // Sem `id` no payload: a coluna é `uuid DEFAULT gen_random_uuid()`, e
      // quem atribui a identidade é o banco.
      const { data, error } = await this.#from("courtesies")
        .insert({
          organization_id: courtesy.organizationId,
          plan: courtesy.plan,
          starts_at: courtesy.startsAt,
          ends_at: courtesy.endsAt,
          reason: courtesy.reason,
          granted_by: courtesy.grantedBy,
        })
        .select("id")
        .single();
      if (error) return erroDeLeitura(error, "gravação de cortesia");
      return ok({ ...courtesy, id: data.id as string, revokedAt: null });
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "gravação de cortesia");
    }
  }

  async revokeCourtesy(input: CourtesyRevocation): Promise<Result<CourtesyRevocation>> {
    try {
      // A cortesia precisa ser DESTA organização — conferido antes de gravar.
      const { data: alvo, error: erroAlvo } = await this.#from("courtesies")
        .select("id")
        .eq("id", input.courtesyId)
        .eq("organization_id", input.organizationId)
        .maybeSingle();
      if (erroAlvo) return erroDeLeitura(erroAlvo, "cortesia");
      if (!alvo) return fail("not_found", "cortesia inexistente para esta organização");

      const { error } = await this.#from("courtesy_revocations").insert({
        courtesy_id: input.courtesyId,
        organization_id: input.organizationId,
        revoked_at: input.revokedAt,
        revoked_by: input.revokedBy,
        reason: input.reason,
      });
      if (error && error.code === UNIQUE_VIOLATION) {
        return fail("conflict", "cortesia já revogada");
      }
      if (error) return erroDeLeitura(error, "revogação de cortesia");
      return ok(input);
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "revogação de cortesia");
    }
  }

  // ── Idempotência ─────────────────────────────────────────────────────────

  /**
   * Reserva ATÔMICA.
   *
   * A decisão entre "criei" e "já existia" é do banco, pela violação do
   * `UNIQUE`. Não há `SELECT` antes do `INSERT`: entre o select e o insert
   * cabe outra transação, e é exatamente aí que a duplicata nasceria.
   */
  async reserveIdempotency(
    record: IdempotencyRecord
  ): Promise<Result<{ created: boolean; record: IdempotencyRecord }>> {
    try {
      const { error } = await this.#from("idempotency_records").insert({
        organization_id: record.organizationId,
        scope: record.scope,
        provider: record.provider,
        key: record.key,
        result: record.result,
        created_at: record.createdAt,
      });

      if (!error) return ok({ created: true, record });

      if (error.code !== UNIQUE_VIOLATION) {
        return erroDeLeitura(error, "reserva de idempotência");
      }

      const { data, error: erroLeitura } = await this.#from("idempotency_records")
        .select("organization_id, scope, provider, key, result, created_at")
        .eq("organization_id", record.organizationId)
        .eq("scope", record.scope)
        .eq("provider", record.provider)
        .eq("key", record.key)
        .maybeSingle();

      if (erroLeitura) return erroDeLeitura(erroLeitura, "leitura de idempotência");
      if (!data) return fail("conflict", "chave de idempotência em disputa");

      return ok({
        created: false,
        record: {
          organizationId: data.organization_id as string,
          scope: data.scope as IdempotencyRecord["scope"],
          provider: data.provider as string,
          key: data.key as string,
          result: (data.result ?? {}) as Record<string, unknown>,
          createdAt: data.created_at as string,
        },
      });
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "reserva de idempotência");
    }
  }

  // ── Auditoria ────────────────────────────────────────────────────────────

  async appendAuditEvent(event: AuditEventInput): Promise<Result<AuditEvent>> {
    try {
      const { data, error } = await this.#from("audit_events")
        .insert({
          organization_id: event.organizationId,
          subscription_id: event.subscriptionId,
          subject: event.subject,
          actor_id: event.actorId,
          origin: event.origin,
          occurred_at: event.occurredAt,
          previous_value: event.previousValue,
          new_value: event.newValue,
          reason: event.reason,
          idempotency_key: event.idempotencyKey,
          correlation_id: event.correlationId,
        })
        .select("id")
        .single();

      if (error) return erroDeLeitura(error, "gravação de auditoria");
      return ok({ ...event, id: String(data.id) });
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "gravação de auditoria");
    }
  }

  async listAuditEvents(organizationId: string): Promise<Result<readonly AuditEvent[]>> {
    try {
      const { data, error } = await this.#from("audit_events")
        .select("*")
        .eq("organization_id", organizationId)
        .order("id", { ascending: true });

      if (error) return erroDeLeitura(error, "auditoria");
      return ok(
        (data ?? []).map((e) => ({
          id: String(e.id),
          organizationId: e.organization_id as string,
          subscriptionId: (e.subscription_id as string | null) ?? null,
          subject: e.subject as AuditEvent["subject"],
          actorId: (e.actor_id as string | null) ?? null,
          origin: (e.origin as BillingActionOrigin | null) ?? "scheduler",
          occurredAt: e.occurred_at as string,
          previousValue: (e.previous_value as Record<string, unknown> | null) ?? null,
          newValue: (e.new_value as Record<string, unknown> | null) ?? null,
          reason: (e.reason as string | null) ?? null,
          idempotencyKey: (e.idempotency_key as string | null) ?? null,
          correlationId: (e.correlation_id as string | null) ?? null,
        }))
      );
    } catch (causa) {
      return fromThrown(causa, "repository_unavailable", "auditoria");
    }
  }
}

// ─── Conversões ────────────────────────────────────────────────────────────

type Linha = Record<string, unknown>;

function paraSnapshot(l: Linha): PriceSnapshot {
  return Object.freeze({
    plan: l.plan as PriceSnapshot["plan"],
    tier: l.tier as PriceSnapshot["tier"],
    period: l.period as PriceSnapshot["period"],
    amountCents: l.amount_cents as number,
    catalogVersion: l.catalog_version as string,
    capturedAt: l.captured_at as string,
  });
}

function paraAssinatura(l: Linha, snapshot: PriceSnapshot | null): StoredSubscription {
  const plan = l.plan as StoredSubscription["plan"];
  const tier = l.tier as StoredSubscription["tier"];
  const period = l.period as StoredSubscription["period"];

  return {
    id: l.id as string,
    organizationId: l.organization_id as string,
    plan,
    tier,
    period,
    state: l.state as StoredSubscription["state"],
    workerCount: l.worker_count as number,
    cnpj: l.cnpj as string,
    currentPeriodStart: l.current_period_start as string,
    currentPeriodEnd: l.current_period_end as string,
    trialEndsAt: (l.trial_ends_at as string | null) ?? null,
    paymentFailedAt: (l.payment_failed_at as string | null) ?? null,
    scheduledDowngrade:
      l.scheduled_downgrade_plan && l.scheduled_downgrade_tier
        ? {
            plan: l.scheduled_downgrade_plan as StoredSubscription["plan"],
            tier: l.scheduled_downgrade_tier as StoredSubscription["tier"],
          }
        : null,
    priceSnapshot:
      snapshot ??
      Object.freeze({
        plan,
        tier,
        period,
        amountCents: 0,
        catalogVersion: "pendente",
        capturedAt: l.current_period_start as string,
      }),
  };
}

function paraCobranca(l: Linha): Charge {
  return {
    id: l.id as string,
    organizationId: l.organization_id as string,
    subscriptionId: l.subscription_id as string,
    provider: l.provider as string,
    externalChargeId: l.external_charge_id as string,
    method: l.method as Charge["method"],
    amountCents: l.amount_cents as number,
    status: l.status as Charge["status"],
    periodStart: l.period_start as string,
    periodEnd: l.period_end as string,
    createdAt: l.created_at as string,
    paidAt: (l.paid_at as string | null) ?? null,
    failedAt: (l.failed_at as string | null) ?? null,
    idempotencyKey: (l.idempotency_key as string | null) ?? null,
  };
}
