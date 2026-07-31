/**
 * REPOSITÓRIO EM MEMÓRIA — exclusivo para teste e desenvolvimento controlado
 *
 * Implementa o MESMO contrato do repositório real e é exercido pela MESMA
 * suíte. Um comportamento que só existisse aqui seria um teste medindo o
 * dublê, e não o produto.
 *
 * ── O QUE ELE REPRODUZ DE PROPÓSITO ─────────────────────────────────────────
 *
 *   * isolamento por `organization_id` em TODA leitura e escrita — nada é
 *     devolvido sem que a organização confira;
 *   * unicidade de `(organization_id, scope, provider, key)` na idempotência,
 *     que é o que o `UNIQUE` do banco garante;
 *   * imutabilidade de snapshot e de auditoria;
 *   * uma assinatura por organização.
 *
 * ── O QUE ELE NÃO REPRODUZ, E ESTÁ DECLARADO ────────────────────────────────
 *
 * RLS, grants, transação real e concorrência real. Essas quatro só se provam
 * contra PostgreSQL — e é por isso que `scripts/ci/assert-billing-orchestration.sql`
 * existe e roda no CI contra a stack descartável.
 *
 * ── NÃO É SELECIONÁVEL EM PRODUÇÃO ──────────────────────────────────────────
 *
 * Mesma regra do provider mock: o construtor aborta em produção. Um
 * repositório em memória em produção significaria assinaturas que somem no
 * próximo deploy.
 */

import { fail, ok, type Result } from "../core/errors";
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

/** Operações que podem ter falha injetada, para provar o fail-closed. */
export type InMemoryFailurePoint =
  | "findSubscription"
  | "createSubscription"
  | "updateSubscription"
  | "appendPriceSnapshot"
  | "createCharge"
  | "markChargePaid"
  | "reserveIdempotency"
  | "appendAuditEvent"
  | "listCatalogPrices";

export interface InMemoryOptions {
  readonly catalog?: readonly CatalogPrice[];
  readonly grandfatheringCutoff?: string | null;
  /** Operações que devem falhar como `repository_unavailable`. */
  readonly failAt?: readonly InMemoryFailurePoint[];
  readonly env?: { NODE_ENV?: string; VERCEL_ENV?: string };
}

export class InMemoryRepositoryForbiddenInProductionError extends Error {
  constructor(qual: string) {
    super(`InMemoryBillingRepository é proibido em produção (${qual}).`);
    this.name = "InMemoryRepositoryForbiddenInProductionError";
  }
}

export class InMemoryBillingRepository implements BillingRepository {
  readonly #catalog: readonly CatalogPrice[];
  readonly #cutoff: string | null;
  readonly #falhas: ReadonlySet<InMemoryFailurePoint>;

  readonly #subs = new Map<string, StoredSubscription>();
  readonly #snapshots: Array<PriceSnapshot & { organizationId: string }> = [];
  readonly #customers = new Map<string, BillingCustomer>();
  readonly #charges = new Map<string, Charge>();
  readonly #idem = new Map<string, IdempotencyRecord>();
  readonly #grandfathering = new Map<string, Grandfathering>();
  readonly #courtesies = new Map<string, StoredCourtesy>();
  readonly #audit: AuditEvent[] = [];
  #seqAudit = 0;

  constructor(options: InMemoryOptions = {}) {
    const env = options.env ?? {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
    };
    if (env.NODE_ENV === "production") {
      throw new InMemoryRepositoryForbiddenInProductionError("NODE_ENV=production");
    }
    if (env.VERCEL_ENV === "production") {
      throw new InMemoryRepositoryForbiddenInProductionError("VERCEL_ENV=production");
    }

    this.#catalog = options.catalog ?? [];
    this.#cutoff = options.grandfatheringCutoff ?? null;
    this.#falhas = new Set(options.failAt ?? []);
  }

  #talvezFalhar<T>(ponto: InMemoryFailurePoint): Result<T> | null {
    if (!this.#falhas.has(ponto)) return null;
    return fail("repository_unavailable", `falha injetada em ${ponto}`);
  }

  // ── Catálogo ─────────────────────────────────────────────────────────────

  async listCatalogPrices(catalogVersion: string): Promise<Result<readonly CatalogPrice[]>> {
    const f = this.#talvezFalhar<readonly CatalogPrice[]>("listCatalogPrices");
    if (f) return f;
    return ok(this.#catalog.filter((c) => c.catalogVersion === catalogVersion));
  }

  // ── Assinatura ───────────────────────────────────────────────────────────

  async findSubscription(organizationId: string): Promise<Result<StoredSubscription | null>> {
    const f = this.#talvezFalhar<StoredSubscription | null>("findSubscription");
    if (f) return f;
    return ok(this.#subs.get(organizationId) ?? null);
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<Result<StoredSubscription>> {
    const f = this.#talvezFalhar<StoredSubscription>("createSubscription");
    if (f) return f;

    // Uma por organização — é o UNIQUE do banco.
    if (this.#subs.has(input.organizationId)) {
      return fail("conflict", "já existe assinatura para esta organização");
    }

    const sub: StoredSubscription = {
      id: `sub_${this.#subs.size + 1}`,
      organizationId: input.organizationId,
      plan: input.plan,
      tier: input.tier,
      period: input.period,
      state: input.state,
      workerCount: input.workerCount,
      cnpj: input.cnpj,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      trialEndsAt: input.trialEndsAt,
      paymentFailedAt: null,
      scheduledDowngrade: null,
      // O snapshot vive em tabela própria; aqui guarda-se um placeholder que o
      // caso de uso substitui logo em seguida com `appendPriceSnapshot`.
      priceSnapshot: {
        plan: input.plan,
        tier: input.tier,
        period: input.period,
        amountCents: 0,
        capturedAt: input.currentPeriodStart,
        catalogVersion: "pendente",
      },
    };

    this.#subs.set(input.organizationId, sub);
    return ok(sub);
  }

  async updateSubscription(
    organizationId: string,
    patch: UpdateSubscriptionInput
  ): Promise<Result<StoredSubscription>> {
    const f = this.#talvezFalhar<StoredSubscription>("updateSubscription");
    if (f) return f;

    const atual = this.#subs.get(organizationId);
    if (!atual) return fail("not_found", "assinatura inexistente");

    const novo: StoredSubscription = {
      ...atual,
      ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
      ...(patch.tier !== undefined ? { tier: patch.tier } : {}),
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.workerCount !== undefined ? { workerCount: patch.workerCount } : {}),
      ...(patch.currentPeriodStart !== undefined
        ? { currentPeriodStart: patch.currentPeriodStart }
        : {}),
      ...(patch.currentPeriodEnd !== undefined
        ? { currentPeriodEnd: patch.currentPeriodEnd }
        : {}),
      ...(patch.trialEndsAt !== undefined ? { trialEndsAt: patch.trialEndsAt } : {}),
      ...(patch.paymentFailedAt !== undefined
        ? { paymentFailedAt: patch.paymentFailedAt }
        : {}),
      ...(patch.scheduledDowngrade !== undefined
        ? { scheduledDowngrade: patch.scheduledDowngrade }
        : {}),
    };

    this.#subs.set(organizationId, novo);
    return ok(novo);
  }

  // ── Snapshot ─────────────────────────────────────────────────────────────

  async appendPriceSnapshot(
    organizationId: string,
    subscriptionId: string,
    snapshot: PriceSnapshot
  ): Promise<Result<PriceSnapshot>> {
    const f = this.#talvezFalhar<PriceSnapshot>("appendPriceSnapshot");
    if (f) return f;

    const sub = this.#subs.get(organizationId);
    if (!sub || sub.id !== subscriptionId) {
      return fail("not_found", "assinatura inexistente para esta organização");
    }

    // Congelado: nem o repositório reescreve o preço contratado.
    const congelado = Object.freeze({ ...snapshot });
    this.#snapshots.push({ ...congelado, organizationId });
    this.#subs.set(organizationId, { ...sub, priceSnapshot: congelado });
    return ok(congelado);
  }

  async listPriceSnapshots(organizationId: string): Promise<Result<readonly PriceSnapshot[]>> {
    return ok(
      this.#snapshots
        .filter((s) => s.organizationId === organizationId)
        .map(({ organizationId: _org, ...resto }) => resto)
    );
  }

  // ── Cliente ──────────────────────────────────────────────────────────────

  async findCustomer(
    organizationId: string,
    provider: string
  ): Promise<Result<BillingCustomer | null>> {
    return ok(this.#customers.get(`${organizationId}|${provider}`) ?? null);
  }

  async saveCustomer(customer: BillingCustomer): Promise<Result<BillingCustomer>> {
    const chave = `${customer.organizationId}|${customer.provider}`;
    const existente = this.#customers.get(chave);
    // Idempotente: salvar de novo devolve o que já havia, sem trocar o id
    // externo — trocar significaria abandonar o cliente criado no provider.
    if (existente) return ok(existente);
    this.#customers.set(chave, customer);
    return ok(customer);
  }

  // ── Cobranças ────────────────────────────────────────────────────────────

  async createCharge(input: CreateChargeInput): Promise<Result<Charge>> {
    const f = this.#talvezFalhar<Charge>("createCharge");
    if (f) return f;

    const chave = `${input.organizationId}|${input.provider}|${input.externalChargeId}`;
    if (this.#charges.has(chave)) {
      return fail("conflict", "cobrança já registrada");
    }

    const charge: Charge = {
      id: `chg_${this.#charges.size + 1}`,
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId,
      provider: input.provider,
      externalChargeId: input.externalChargeId,
      method: input.method,
      amountCents: input.amountCents,
      status: "pending",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      createdAt: input.createdAt,
      paidAt: null,
      failedAt: null,
      idempotencyKey: input.idempotencyKey,
    };
    this.#charges.set(chave, charge);
    return ok(charge);
  }

  async findChargeByExternalId(
    organizationId: string,
    provider: string,
    externalChargeId: string
  ): Promise<Result<Charge | null>> {
    return ok(this.#charges.get(`${organizationId}|${provider}|${externalChargeId}`) ?? null);
  }

  async findChargeByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string
  ): Promise<Result<Charge | null>> {
    // Isolamento: a organização entra na busca, não só a chave.
    const achada = [...this.#charges.values()].find(
      (c) => c.organizationId === organizationId && c.idempotencyKey === idempotencyKey
    );
    return ok(achada ?? null);
  }

  async listCharges(organizationId: string): Promise<Result<readonly Charge[]>> {
    return ok([...this.#charges.values()].filter((c) => c.organizationId === organizationId));
  }

  #acharCobranca(organizationId: string, chargeId: string): [string, Charge] | null {
    for (const [k, c] of this.#charges) {
      if (c.id === chargeId && c.organizationId === organizationId) return [k, c];
    }
    return null;
  }

  async markChargePaid(
    organizationId: string,
    chargeId: string,
    paidAt: string
  ): Promise<Result<Charge>> {
    const f = this.#talvezFalhar<Charge>("markChargePaid");
    if (f) return f;

    const achado = this.#acharCobranca(organizationId, chargeId);
    if (!achado) return fail("not_found", "cobrança inexistente para esta organização");
    const [k, c] = achado;
    if (c.status === "paid") return ok(c);
    const novo: Charge = { ...c, status: "paid", paidAt };
    this.#charges.set(k, novo);
    return ok(novo);
  }

  async markChargeFailed(
    organizationId: string,
    chargeId: string,
    failedAt: string
  ): Promise<Result<Charge>> {
    const achado = this.#acharCobranca(organizationId, chargeId);
    if (!achado) return fail("not_found", "cobrança inexistente para esta organização");
    const [k, c] = achado;
    if (c.status === "failed") return ok(c);
    const novo: Charge = { ...c, status: "failed", failedAt };
    this.#charges.set(k, novo);
    return ok(novo);
  }

  // ── Grandfathering e cortesia ────────────────────────────────────────────

  async findGrandfatheringCutoff(): Promise<Result<string | null>> {
    return ok(this.#cutoff);
  }

  async findGrandfathering(organizationId: string): Promise<Result<Grandfathering | null>> {
    return ok(this.#grandfathering.get(organizationId) ?? null);
  }

  async saveGrandfathering(record: Grandfathering): Promise<Result<Grandfathering>> {
    const existente = this.#grandfathering.get(record.organizationId);
    if (existente) return ok(existente);
    this.#grandfathering.set(record.organizationId, record);
    return ok(record);
  }

  async listCourtesies(organizationId: string): Promise<Result<readonly StoredCourtesy[]>> {
    return ok(
      [...this.#courtesies.values()].filter((c) => c.organizationId === organizationId)
    );
  }

  async saveCourtesy(courtesy: NewCourtesy): Promise<Result<StoredCourtesy>> {
    // Identidade atribuída pela persistência, como no banco.
    const gravada: StoredCourtesy = {
      ...courtesy,
      id: `crt_${this.#courtesies.size + 1}`,
      revokedAt: null,
    };
    this.#courtesies.set(gravada.id, gravada);
    return ok(gravada);
  }

  async revokeCourtesy(input: CourtesyRevocation): Promise<Result<CourtesyRevocation>> {
    const atual = this.#courtesies.get(input.courtesyId);
    // Isolamento: a cortesia precisa ser DESTA organização.
    if (!atual || atual.organizationId !== input.organizationId) {
      return fail("not_found", "cortesia inexistente para esta organização");
    }
    if (atual.revokedAt !== null) return fail("conflict", "cortesia já revogada");
    this.#courtesies.set(input.courtesyId, { ...atual, revokedAt: input.revokedAt });
    return ok(input);
  }

  // ── Idempotência ─────────────────────────────────────────────────────────

  async reserveIdempotency(
    record: IdempotencyRecord
  ): Promise<Result<{ created: boolean; record: IdempotencyRecord }>> {
    const f = this.#talvezFalhar<{ created: boolean; record: IdempotencyRecord }>(
      "reserveIdempotency"
    );
    if (f) return f;

    // A chave inclui organização E provider: um `eventId` do provider A não
    // colide com o do provider B, e nenhum tenant alcança a chave de outro.
    const chave = `${record.organizationId}|${record.scope}|${record.provider}|${record.key}`;
    const existente = this.#idem.get(chave);
    if (existente) return ok({ created: false, record: existente });
    this.#idem.set(chave, record);
    return ok({ created: true, record });
  }

  // ── Auditoria ────────────────────────────────────────────────────────────

  async appendAuditEvent(event: AuditEventInput): Promise<Result<AuditEvent>> {
    const f = this.#talvezFalhar<AuditEvent>("appendAuditEvent");
    if (f) return f;

    this.#seqAudit += 1;
    const gravado: AuditEvent = Object.freeze({ ...event, id: String(this.#seqAudit) });
    this.#audit.push(gravado);
    return ok(gravado);
  }

  async listAuditEvents(organizationId: string): Promise<Result<readonly AuditEvent[]>> {
    return ok(this.#audit.filter((e) => e.organizationId === organizationId));
  }
}
