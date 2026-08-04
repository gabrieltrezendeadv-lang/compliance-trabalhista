/**
 * REPOSITÓRIO DE BILLING EM MEMÓRIA — dublê de teste
 *
 * Implementa o MESMO contrato de `SupabaseBillingRepository`, e a suíte em
 * `tests/contract/billing-repository.contract.ts` roda as MESMAS expectativas
 * sobre os dois. Paridade aqui não é "implementação parecida": é o mesmo teste
 * passando nos dois.
 *
 * ── PROIBIDO EM PRODUÇÃO ────────────────────────────────────────────────────
 *
 * O construtor aborta com `NODE_ENV=production` ou `VERCEL_ENV=production`. A
 * recusa é no ato da construção — não é aviso, não é degradação, não é
 * fallback.
 *
 * ── O QUE ELE REPRODUZ, E O QUE NÃO TEM COMO REPRODUZIR ─────────────────────
 *
 * REPRODUZ: a máquina de estados da idempotência com lease, o conflito de
 * fingerprint, as unicidades GLOBAIS, as transições fechadas de cobrança, os
 * campos imutáveis e o isolamento por organização.
 *
 * NÃO REPRODUZ: RLS, privilégios, transação real do PostgreSQL e concorrência
 * entre processos. É por isso que existem
 * `scripts/ci/assert-billing-orchestration.sql` e
 * `scripts/ci/assert-billing-concurrency.sh` — e é por isso que a suíte de
 * contrato roda também contra o PostgREST local.
 *
 * ── A RESERVA É INDIVISÍVEL ─────────────────────────────────────────────────
 *
 * `claimIdempotency` NÃO tem `await` entre conferir a chave e registrar o
 * vencedor. Em JavaScript, um `await` no meio cede o event loop e permite que
 * outra chamada passe pela mesma checagem — que é exatamente a corrida que a
 * versão anterior deste arquivo tinha, com `get` seguido de `set`.
 *
 * O trecho crítico é síncrono do começo ao fim. Não há mutex porque não é
 * preciso: sem ponto de suspensão, não há intercalação.
 */

import { fail, ok, type Result } from "../core/errors";
import type { BillingActionOrigin, Clock } from "../core/ports";
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
  BillingPeriod,
  Grandfathering,
  PlanSlug,
  PriceSnapshot,
  SubscriptionState,
  TierSlug,
} from "../plans/model";

/** Papel de um ator numa organização. Espelha `public.organization_members`. */
export type PapelDeMembro =
  | "owner"
  | "admin"
  | "manager"
  | "collaborator"
  | "investigator"
  | "auditor";

export interface MembroFixture {
  readonly actorId: string;
  readonly organizationId: string;
  readonly role: PapelDeMembro;
}

/** Pontos que podem ser forçados a falhar, por nome de método do contrato. */
export type InMemoryFailurePoint =
  | "readState"
  | "readCatalog"
  | "readLedger"
  | "startTrial"
  | "changePlan"
  | "scheduleDowngrade"
  | "cancelAtPeriodEnd"
  | "transitionState"
  | "recordWorkerCount"
  | "claimIdempotency"
  | "failIdempotency"
  | "finalizeCheckout"
  | "applyProviderEvent"
  | "grantCourtesy"
  | "revokeCourtesy"
  | "saveGrandfathering";

export interface InMemoryOptions {
  readonly clock: Clock;
  readonly catalog?: readonly CatalogPrice[];
  readonly grandfatheringCutoff?: string | null;
  /** Membros conhecidos. Autorização é revalidada aqui, como na RPC. */
  readonly members?: readonly MembroFixture[];
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

type EstadoDeReserva = "in_progress" | "completed" | "failed";

interface Reserva {
  status: EstadoDeReserva;
  fingerprint: string;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  correlationId: string | null;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
}

interface EventoExterno {
  organizationId: string;
  chargeId: string;
}

/**
 * DURAÇÃO DA LEASE — POLÍTICA FIXA, IGUAL À DO SQL.
 *
 * Cinco minutos, e deliberadamente NÃO configurável. Uma duração vinda de fora
 * permitiria pedir lease zero e tomar uma reserva viva — que é exatamente o
 * efeito que a lease existe para impedir. Quem precisa exercitar a expiração
 * move o RELÓGIO, não a política; é o que o contrato compartilhado faz, contra
 * as duas variantes.
 *
 * O par em `fn_billing_claim_idempotency` é `interval '5 minutes'`.
 */
const LEASE_MS = 5 * 60 * 1000;

export class InMemoryBillingRepository implements BillingRepository {
  readonly #clock: Clock;
  readonly #catalogo: readonly CatalogPrice[];
  readonly #corteGlobal: string | null;
  readonly #membros: readonly MembroFixture[];
  /**
   * Pontos de falha injetados.
   *
   * MUTÁVEL de propósito: "o `finalize` falhou, e a retomada funcionou" só é
   * testável se a falha puder ser ligada e desligada SEM recriar o repositório
   * — recriar perderia o estado, e é justamente o estado que precisa
   * sobreviver à falha.
   */
  #falhas: ReadonlySet<InMemoryFailurePoint>;

  readonly #assinaturas = new Map<string, StoredSubscription>();
  readonly #snapshots = new Map<string, PriceSnapshot[]>();
  readonly #cobrancas = new Map<string, Charge>();
  readonly #reservas = new Map<string, Reserva>();
  readonly #eventos = new Map<string, EventoExterno>();
  readonly #cortesias = new Map<string, StoredCourtesy>();
  readonly #grandfathering = new Map<string, Grandfathering>();
  readonly #clientes = new Map<string, string>();
  readonly #auditoria: AuditEvent[] = [];

  #sequencia = 0;

  constructor(opcoes: InMemoryOptions) {
    const env = opcoes.env ?? {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
    };
    if (env.NODE_ENV === "production") {
      throw new InMemoryRepositoryForbiddenInProductionError("NODE_ENV=production");
    }
    if (env.VERCEL_ENV === "production") {
      throw new InMemoryRepositoryForbiddenInProductionError("VERCEL_ENV=production");
    }

    this.#clock = opcoes.clock;
    this.#catalogo = opcoes.catalog ?? [];
    this.#corteGlobal = opcoes.grandfatheringCutoff ?? null;
    this.#membros = opcoes.members ?? [];
    this.#falhas = new Set(opcoes.failAt ?? []);
  }

  // ── Infraestrutura do dublê ──────────────────────────────────────────────

  /** Liga ou desliga pontos de falha entre uma chamada e outra. */
  definirFalhas(pontos: readonly InMemoryFailurePoint[]): void {
    this.#falhas = new Set(pontos);
  }

  #talvezFalhar<T>(ponto: InMemoryFailurePoint): Result<T> | null {
    if (!this.#falhas.has(ponto)) return null;
    return fail("repository_unavailable", `${ponto}: indisponível`);
  }

  #proximoId(prefixo: string): string {
    this.#sequencia += 1;
    return `${prefixo}_${String(this.#sequencia).padStart(6, "0")}`;
  }

  /**
   * Autorização, revalidada como a RPC faz.
   *
   * A recusa é a MESMA para organização inexistente e organização alheia — a
   * mensagem não distingue os casos, e o teste de contrato compara as duas
   * mensagens para garantir que continue assim.
   */
  #autorizar<T>(
    actorId: string,
    organizationId: string,
    exigirDono: boolean
  ): Result<T> | null {
    const membro = this.#membros.find(
      (m) => m.actorId === actorId && m.organizationId === organizationId
    );
    if (membro === undefined || (exigirDono && membro.role !== "owner")) {
      return fail("not_owner", "somente o proprietário administra a assinatura");
    }
    return null;
  }

  #chaveDeReserva(
    organizationId: string,
    scope: string,
    provider: string,
    key: string
  ): string {
    return `${organizationId}|${scope}|${provider}|${key}`;
  }

  #registrarAuditoria(
    organizationId: string,
    subscriptionId: string | null,
    subject: AuditEvent["subject"],
    actorId: string | null,
    origin: BillingActionOrigin,
    previousValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null,
    reason: string | null,
    idempotencyKey: string | null,
    correlationId: string | null
  ): void {
    this.#auditoria.push({
      id: this.#proximoId("aud"),
      organizationId,
      subscriptionId,
      subject,
      // Ator humano só quando a origem é humana. Webhook e rotina não têm autor.
      actorId: origin === "owner" || origin === "admin" ? actorId : null,
      origin,
      occurredAt: this.#clock.now(),
      previousValue,
      newValue,
      reason,
      idempotencyKey,
      correlationId,
    });
  }

  // ── Leitura ──────────────────────────────────────────────────────────────

  async readState(actorId: string, organizationId: string): Promise<Result<BillingState>> {
    const f = this.#talvezFalhar<BillingState>("readState");
    if (f) return f;
    // Consulta de entitlement: qualquer membro ativo.
    const negado = this.#autorizar<BillingState>(actorId, organizationId, false);
    if (negado) return negado;

    return ok({
      subscription: this.#assinaturas.get(organizationId) ?? null,
      courtesies: [...this.#cortesias.values()]
        .filter((c) => c.organizationId === organizationId)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      grandfathering: this.#grandfathering.get(organizationId) ?? null,
      grandfatheringCutoff: this.#corteGlobal,
    });
  }

  async readCatalog(
    actorId: string,
    organizationId: string,
    catalogVersion: string
  ): Promise<Result<readonly CatalogPrice[]>> {
    const f = this.#talvezFalhar<readonly CatalogPrice[]>("readCatalog");
    if (f) return f;
    const negado = this.#autorizar<readonly CatalogPrice[]>(actorId, organizationId, false);
    if (negado) return negado;

    return ok(this.#catalogo.filter((p) => p.catalogVersion === catalogVersion));
  }

  async readLedger(actorId: string, organizationId: string): Promise<Result<BillingLedger>> {
    const f = this.#talvezFalhar<BillingLedger>("readLedger");
    if (f) return f;
    // Trilha e cobranças são dado financeiro: exige dono.
    const negado = this.#autorizar<BillingLedger>(actorId, organizationId, true);
    if (negado) return negado;

    const assinatura = this.#assinaturas.get(organizationId);
    return ok({
      charges: [...this.#cobrancas.values()]
        .filter((c) => c.organizationId === organizationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      snapshots: assinatura ? (this.#snapshots.get(assinatura.id) ?? []) : [],
      auditEvents: this.#auditoria.filter((a) => a.organizationId === organizationId),
    });
  }

  // ── Ciclo de vida ────────────────────────────────────────────────────────

  async startTrial(input: StartTrialInput): Promise<Result<StoredSubscription>> {
    const f = this.#talvezFalhar<StoredSubscription>("startTrial");
    if (f) return f;
    const negado = this.#autorizar<StoredSubscription>(
      input.actorId,
      input.organizationId,
      true
    );
    if (negado) return negado;

    if (input.cnpj.trim() === "") {
      return fail("invalid_input", "CNPJ é obrigatório para iniciar o trial");
    }
    if (input.workerCount < 1) {
      return fail("invalid_input", "número de trabalhadores inválido");
    }
    if (this.#assinaturas.has(input.organizationId)) {
      return fail("conflict", "já existe assinatura para esta organização");
    }

    const id = this.#proximoId("sub");
    const snapshot: PriceSnapshot = Object.freeze({
      plan: input.plan,
      tier: input.tier,
      period: input.period,
      amountCents: input.amountCents ?? 0,
      catalogVersion: input.catalogVersion ?? "pendente",
      capturedAt: input.periodStart,
    });

    const assinatura: StoredSubscription = {
      id,
      organizationId: input.organizationId,
      plan: input.plan,
      tier: input.tier,
      period: input.period,
      state: "trialing",
      workerCount: input.workerCount,
      cnpj: input.cnpj,
      currentPeriodStart: input.periodStart,
      currentPeriodEnd: input.periodEnd,
      trialEndsAt: input.trialEndsAt,
      paymentFailedAt: null,
      scheduledDowngrade: null,
      priceSnapshot: snapshot,
    };

    this.#assinaturas.set(input.organizationId, assinatura);
    if (input.amountCents !== null && input.catalogVersion !== null) {
      this.#snapshots.set(id, [snapshot]);
    }
    this.#registrarAuditoria(
      input.organizationId,
      id,
      "subscription_state",
      input.actorId,
      "owner",
      null,
      {
        state: "trialing",
        plan: input.plan,
        tier: input.tier,
        trialEndsAt: input.trialEndsAt,
      },
      "início de trial",
      null,
      input.correlationId
    );

    return ok(assinatura);
  }

  /** Escrita de assinatura + snapshot + auditoria, como `fn_write_subscription`. */
  #escrever(
    ctx: ComandoContexto,
    origin: BillingActionOrigin,
    patch: {
      plan?: PlanSlug | null;
      tier?: TierSlug | null;
      period?: BillingPeriod | null;
      state?: SubscriptionState | null;
      workerCount?: number | null;
      periodStart?: string | null;
      periodEnd?: string | null;
      clearTrial?: boolean;
      clearDowngrade?: boolean;
      downgrade?: { plan: PlanSlug; tier: TierSlug } | null;
      paymentFailedAt?: string | null;
      clearFailure?: boolean;
    },
    snapshot: { amountCents: number; catalogVersion: string } | null,
    subject: AuditEvent["subject"],
    reason: string | null,
    idempotencyKey: string | null,
    now: string
  ): Result<StoredSubscription> {
    const antes = this.#assinaturas.get(ctx.organizationId);
    if (antes === undefined) {
      return fail("not_found", "nenhuma assinatura para esta organização");
    }

    const depois: StoredSubscription = {
      ...antes,
      plan: patch.plan ?? antes.plan,
      tier: patch.tier ?? antes.tier,
      period: patch.period ?? antes.period,
      state: patch.state ?? antes.state,
      workerCount: patch.workerCount ?? antes.workerCount,
      currentPeriodStart: patch.periodStart ?? antes.currentPeriodStart,
      currentPeriodEnd: patch.periodEnd ?? antes.currentPeriodEnd,
      trialEndsAt: patch.clearTrial ? null : antes.trialEndsAt,
      paymentFailedAt: patch.clearFailure
        ? null
        : (patch.paymentFailedAt ?? antes.paymentFailedAt),
      scheduledDowngrade: patch.clearDowngrade
        ? null
        : (patch.downgrade ?? antes.scheduledDowngrade),
    };

    let comSnapshot = depois;
    if (snapshot !== null) {
      const novo: PriceSnapshot = Object.freeze({
        plan: depois.plan,
        tier: depois.tier,
        period: depois.period,
        amountCents: snapshot.amountCents,
        catalogVersion: snapshot.catalogVersion,
        capturedAt: now,
      });
      const lista = this.#snapshots.get(depois.id) ?? [];
      lista.push(novo);
      this.#snapshots.set(depois.id, lista);
      comSnapshot = { ...depois, priceSnapshot: novo };
    }

    this.#assinaturas.set(ctx.organizationId, comSnapshot);
    this.#registrarAuditoria(
      ctx.organizationId,
      comSnapshot.id,
      subject,
      ctx.actorId,
      origin,
      {
        plan: antes.plan,
        tier: antes.tier,
        period: antes.period,
        state: antes.state,
        workerCount: antes.workerCount,
        currentPeriodStart: antes.currentPeriodStart,
        currentPeriodEnd: antes.currentPeriodEnd,
      },
      {
        plan: comSnapshot.plan,
        tier: comSnapshot.tier,
        period: comSnapshot.period,
        state: comSnapshot.state,
        workerCount: comSnapshot.workerCount,
        currentPeriodStart: comSnapshot.currentPeriodStart,
        currentPeriodEnd: comSnapshot.currentPeriodEnd,
      },
      reason,
      idempotencyKey,
      ctx.correlationId
    );

    return ok(comSnapshot);
  }

  async changePlan(input: ChangePlanInput): Promise<Result<StoredSubscription>> {
    const f = this.#talvezFalhar<StoredSubscription>("changePlan");
    if (f) return f;
    const negado = this.#autorizar<StoredSubscription>(
      input.actorId,
      input.organizationId,
      true
    );
    if (negado) return negado;

    return this.#escrever(
      input,
      "owner",
      {
        plan: input.plan,
        tier: input.tier,
        period: input.period,
        state: input.state,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        clearDowngrade: true,
      },
      input.amountCents !== null && input.catalogVersion !== null
        ? { amountCents: input.amountCents, catalogVersion: input.catalogVersion }
        : null,
      input.subject,
      input.reason,
      input.idempotencyKey,
      input.now
    );
  }

  async scheduleDowngrade(
    ctx: ComandoContexto,
    plan: PlanSlug,
    tier: TierSlug,
    reason: string | null,
    now: string
  ): Promise<Result<StoredSubscription>> {
    const f = this.#talvezFalhar<StoredSubscription>("scheduleDowngrade");
    if (f) return f;
    const negado = this.#autorizar<StoredSubscription>(ctx.actorId, ctx.organizationId, true);
    if (negado) return negado;

    return this.#escrever(
      ctx,
      "owner",
      { downgrade: { plan, tier } },
      null,
      "plan_change",
      reason,
      null,
      now
    );
  }

  async cancelAtPeriodEnd(
    ctx: ComandoContexto,
    reason: string | null,
    now: string
  ): Promise<Result<StoredSubscription>> {
    const f = this.#talvezFalhar<StoredSubscription>("cancelAtPeriodEnd");
    if (f) return f;
    const negado = this.#autorizar<StoredSubscription>(ctx.actorId, ctx.organizationId, true);
    if (negado) return negado;

    return this.#escrever(
      ctx,
      "owner",
      { state: "cancel_scheduled", clearDowngrade: true },
      null,
      "subscription_state",
      reason,
      null,
      now
    );
  }

  async transitionState(
    ctx: ComandoContexto,
    state: SubscriptionState,
    origin: Extract<BillingActionOrigin, "owner" | "scheduler">,
    reason: string | null,
    now: string
  ): Promise<Result<StoredSubscription>> {
    const f = this.#talvezFalhar<StoredSubscription>("transitionState");
    if (f) return f;
    // Rotina não tem dono humano; pedido do proprietário tem.
    if (origin === "owner") {
      const negado = this.#autorizar<StoredSubscription>(ctx.actorId, ctx.organizationId, true);
      if (negado) return negado;
    }

    return this.#escrever(ctx, origin, { state }, null, "subscription_state", reason, null, now);
  }

  async recordWorkerCount(
    ctx: ComandoContexto,
    workerCount: number,
    now: string
  ): Promise<Result<StoredSubscription>> {
    const f = this.#talvezFalhar<StoredSubscription>("recordWorkerCount");
    if (f) return f;
    const negado = this.#autorizar<StoredSubscription>(ctx.actorId, ctx.organizationId, true);
    if (negado) return negado;
    if (workerCount < 1) return fail("invalid_input", "número de trabalhadores inválido");

    // Declarar trabalhadores NÃO muda faixa nem preço agora: a faixa é
    // recalculada na renovação.
    return this.#escrever(ctx, "owner", { workerCount }, null, "worker_count", null, null, now);
  }

  // ── Idempotência ─────────────────────────────────────────────────────────

  async claimIdempotency(input: ClaimInput): Promise<Result<ClaimOutcome>> {
    const f = this.#talvezFalhar<ClaimOutcome>("claimIdempotency");
    if (f) return f;
    const negado = this.#autorizar<ClaimOutcome>(input.actorId, input.organizationId, true);
    if (negado) return negado;
    if (input.fingerprint.trim() === "") {
      return fail("invalid_input", "fingerprint do pedido é obrigatório");
    }

    // ── TRECHO CRÍTICO — SÍNCRONO DO COMEÇO AO FIM ─────────────────────────
    //
    // Nenhum `await` daqui até o `set`. Um ponto de suspensão no meio cederia
    // o event loop e deixaria outra chamada passar pela mesma checagem — que é
    // a corrida que a versão anterior tinha, com `get` seguido de `set`.
    const chave = this.#chaveDeReserva(
      input.organizationId,
      input.scope,
      input.provider,
      input.key
    );
    const existente = this.#reservas.get(chave);

    if (existente === undefined) {
      this.#reservas.set(chave, {
        status: "in_progress",
        fingerprint: input.fingerprint,
        result: null,
        errorCode: null,
        correlationId: input.correlationId,
        startedAt: input.now,
        completedAt: null,
        failedAt: null,
      });
      return ok({ kind: "claimed" });
    }

    // Mesma chave com OUTRO pedido não é repetição: é reuso de chave. Devolver
    // o resultado do primeiro faria o segundo pedido sumir sem aviso.
    if (existente.fingerprint !== input.fingerprint) {
      return ok({ kind: "fingerprint_conflict" });
    }

    if (existente.status === "completed") {
      return ok({ kind: "completed", result: { ...(existente.result ?? {}) } });
    }

    if (existente.status === "in_progress") {
      // LEASE. Enquanto vale, outra execução está em curso e o efeito não se
      // repete. Vencida, a operação é ABANDONADA — quem a iniciou pode ter
      // morrido — e o MESMO pedido pode retomá-la. Sem isso, um processo morto
      // entre o claim e o finalize travaria a chave para sempre.
      // Borda: `now >= startedAt + LEASE_MS` é lease VENCIDA. No limite exato
      // ela já venceu — a mesma borda do `>=` no SQL.
      const expiraEm = Date.parse(existente.startedAt) + LEASE_MS;
      if (Date.parse(input.now) < expiraEm) {
        return ok({ kind: "in_progress" });
      }
      existente.startedAt = input.now;
      existente.correlationId = input.correlationId;
      this.#reservas.set(chave, existente);
      return ok({ kind: "claimed" });
    }

    // `failed` significa que o efeito NÃO aconteceu. Repetir é legítimo com o
    // mesmo pedido — o fingerprint já foi conferido acima.
    existente.status = "in_progress";
    existente.startedAt = input.now;
    existente.failedAt = null;
    existente.errorCode = null;
    existente.correlationId = input.correlationId;
    this.#reservas.set(chave, existente);
    return ok({ kind: "claimed" });
  }

  async failIdempotency(input: ClaimInput, errorCode: string): Promise<Result<SettleOutcome>> {
    const f = this.#talvezFalhar<SettleOutcome>("failIdempotency");
    if (f) return f;
    const negado = this.#autorizar<SettleOutcome>(input.actorId, input.organizationId, true);
    if (negado) return negado;

    const chave = this.#chaveDeReserva(
      input.organizationId,
      input.scope,
      input.provider,
      input.key
    );
    const reserva = this.#reservas.get(chave);
    if (reserva === undefined) {
      return fail("not_found", "reserva de idempotência inexistente");
    }
    if (reserva.fingerprint !== input.fingerprint) {
      return ok({ kind: "fingerprint_conflict" });
    }
    if (reserva.status === "completed") {
      return ok({ kind: "completed", result: { ...(reserva.result ?? {}) } });
    }
    // `fail` repetido é inócuo e devolve o mesmo desfecho.
    if (reserva.status === "failed") {
      return ok({ kind: "failed" });
    }

    // Marca a falha SEM declarar efeito: `result` continua nulo.
    reserva.status = "failed";
    reserva.failedAt = input.now;
    reserva.errorCode = errorCode;
    this.#reservas.set(chave, reserva);
    return ok({ kind: "failed" });
  }

  async finalizeCheckout(input: FinalizeCheckoutInput): Promise<Result<FinalizeOutcome>> {
    const f = this.#talvezFalhar<FinalizeOutcome>("finalizeCheckout");
    if (f) return f;
    const negado = this.#autorizar<FinalizeOutcome>(
      input.actorId,
      input.organizationId,
      true
    );
    if (negado) return negado;

    const chave = this.#chaveDeReserva(
      input.organizationId,
      "command",
      input.provider,
      input.idempotencyKey
    );
    const reserva = this.#reservas.get(chave);
    if (reserva === undefined) {
      return fail("not_found", "finalização sem reserva prévia");
    }
    if (reserva.fingerprint !== input.fingerprint) {
      return ok({ kind: "fingerprint_conflict" });
    }
    if (reserva.status === "completed") {
      // Replay: devolve a MESMA cobrança, sem criar outra.
      const idAnterior = reserva.result?.chargeId;
      const anterior =
        typeof idAnterior === "string" ? this.#cobrancas.get(idAnterior) : undefined;
      if (anterior === undefined) {
        return fail("conflict", "reserva concluída sem cobrança correspondente");
      }
      return ok({
        kind: "completed",
        result: { ...(reserva.result ?? {}) },
        charge: anterior,
      });
    }
    if (reserva.status !== "in_progress") {
      return fail("invalid_state", "reserva não está em andamento");
    }

    const assinatura = this.#assinaturas.get(input.organizationId);
    if (assinatura === undefined) {
      return fail("not_found", "nenhuma assinatura para esta organização");
    }

    // UNICIDADE GLOBAL do identificador externo — sem `organizationId` na
    // chave. Por tenant, o mesmo identificador do mesmo provider poderia
    // existir em duas organizações, e um evento seria aplicável ao tenant
    // errado.
    const externa = `${input.provider}|${input.providerAccountId}|${input.externalChargeId}`;
    for (const c of this.#cobrancas.values()) {
      if (`${c.provider}|${c.providerAccountId}|${c.externalChargeId}` === externa) {
        return fail("conflict", "cobrança já registrada para este identificador");
      }
    }

    this.#clientes.set(
      `${input.organizationId}|${input.provider}|${input.providerAccountId}`,
      input.externalCustomerId
    );

    const id = this.#proximoId("chg");
    const cobranca: Charge = {
      id,
      organizationId: input.organizationId,
      subscriptionId: assinatura.id,
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      externalCustomerId: input.externalCustomerId,
      externalChargeId: input.externalChargeId,
      method: input.method,
      amountCents: input.amountCents,
      currency: "BRL",
      billingPeriod: assinatura.period,
      status: "pending",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      createdAt: input.now,
      paidAt: null,
      failedAt: null,
      cancelledAt: null,
      idempotencyKey: input.idempotencyKey,
    };
    this.#cobrancas.set(id, cobranca);

    this.#registrarAuditoria(
      input.organizationId,
      assinatura.id,
      "charge",
      input.actorId,
      "owner",
      null,
      {
        externalChargeId: input.externalChargeId,
        amountCents: input.amountCents,
        method: input.method,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
      null,
      input.idempotencyKey,
      input.correlationId
    );

    // O resultado só é gravado AGORA, com o efeito já feito.
    reserva.status = "completed";
    reserva.completedAt = input.now;
    reserva.result = { chargeId: id };
    this.#reservas.set(chave, reserva);

    return ok({ kind: "completed", result: { chargeId: id }, charge: cobranca });
  }

  async applyProviderEvent(input: ProviderEventInput): Promise<Result<ProviderEventOutcome>> {
    const f = this.#talvezFalhar<ProviderEventOutcome>("applyProviderEvent");
    if (f) return f;

    // Sem autorização por ator: o webhook não tem sessão. A organização é
    // RESOLVIDA pela cobrança, nunca informada.
    const cobranca = [...this.#cobrancas.values()].find(
      (c) =>
        c.provider === input.provider &&
        c.providerAccountId === input.providerAccountId &&
        c.externalChargeId === input.externalChargeId
    );
    if (cobranca === undefined) {
      return fail("not_found", "cobrança desconhecida");
    }

    // Unicidade GLOBAL do evento.
    const chaveEvento = `${input.provider}|${input.providerAccountId}|${input.externalEventId}`;
    if (this.#eventos.has(chaveEvento)) {
      return ok({ kind: "duplicate" });
    }

    const assinatura = this.#assinaturas.get(cobranca.organizationId);
    if (assinatura === undefined) {
      return fail("not_found", "assinatura ausente para a cobrança");
    }

    // ORDEM. O evento pertence ao ciclo em que a cobrança foi emitida, e não ao
    // ciclo em que ele chegou.
    if (Date.parse(input.occurredAt) < Date.parse(cobranca.periodStart)) {
      return ok({ kind: "out_of_order", reason: "evento anterior ao período da cobrança" });
    }
    if (Date.parse(cobranca.periodEnd) <= Date.parse(assinatura.currentPeriodStart)) {
      return ok({ kind: "out_of_order", reason: "cobrança de período já encerrado" });
    }

    // TRANSIÇÕES FECHADAS: `pending` é o único estado de onde se sai.
    if (cobranca.status !== "pending") {
      return fail("invalid_state", `cobrança já está ${cobranca.status}`);
    }

    this.#eventos.set(chaveEvento, {
      organizationId: cobranca.organizationId,
      chargeId: cobranca.id,
    });

    const paga = input.eventType === "charge_paid";
    // CAMPOS IMUTÁVEIS: só status e carimbos mudam. Valor, tenant, período e
    // identificadores externos vêm do espalhamento e não são tocados.
    const atualizada: Charge = {
      ...cobranca,
      status: paga ? "paid" : "failed",
      paidAt: paga ? input.occurredAt : cobranca.paidAt,
      failedAt: paga ? cobranca.failedAt : input.occurredAt,
    };
    this.#cobrancas.set(cobranca.id, atualizada);

    const novaAssinatura: StoredSubscription = {
      ...assinatura,
      state: paga ? "active" : "past_due_tolerance",
      paymentFailedAt: paga ? null : input.occurredAt,
    };
    this.#assinaturas.set(cobranca.organizationId, novaAssinatura);

    this.#registrarAuditoria(
      cobranca.organizationId,
      assinatura.id,
      "payment",
      null,
      "provider_webhook",
      { state: assinatura.state, chargeStatus: cobranca.status },
      {
        state: novaAssinatura.state,
        chargeStatus: atualizada.status,
        externalChargeId: cobranca.externalChargeId,
        amountCents: cobranca.amountCents,
      },
      null,
      input.externalEventId,
      input.correlationId
    );

    return ok({
      kind: "applied",
      organizationId: cobranca.organizationId,
      charge: atualizada,
      subscription: novaAssinatura,
    });
  }

  // ── Acesso ───────────────────────────────────────────────────────────────

  async grantCourtesy(
    ctx: ComandoContexto,
    plan: PlanSlug,
    startsAt: string,
    endsAt: string,
    reason: string
  ): Promise<Result<StoredCourtesy>> {
    const f = this.#talvezFalhar<StoredCourtesy>("grantCourtesy");
    if (f) return f;
    const negado = this.#autorizar<StoredCourtesy>(ctx.actorId, ctx.organizationId, true);
    if (negado) return negado;

    if (reason.trim() === "") return fail("invalid_input", "cortesia exige motivo");
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      return fail("invalid_input", "cortesia exige prazo positivo");
    }

    const id = this.#proximoId("crt");
    const cortesia: StoredCourtesy = {
      id,
      organizationId: ctx.organizationId,
      plan,
      startsAt,
      endsAt,
      reason,
      // O autor vem do CONTEXTO, nunca do argumento.
      grantedBy: ctx.actorId,
      revokedAt: null,
    };
    this.#cortesias.set(id, cortesia);

    this.#registrarAuditoria(
      ctx.organizationId,
      null,
      "courtesy",
      ctx.actorId,
      "admin",
      null,
      { courtesyId: id, plan, startsAt, endsAt },
      reason,
      null,
      ctx.correlationId
    );

    return ok(cortesia);
  }

  async revokeCourtesy(
    ctx: ComandoContexto,
    courtesyId: string,
    revokedAt: string,
    reason: string
  ): Promise<Result<RevokeCourtesyOutcome>> {
    const f = this.#talvezFalhar<RevokeCourtesyOutcome>("revokeCourtesy");
    if (f) return f;
    const negado = this.#autorizar<RevokeCourtesyOutcome>(ctx.actorId, ctx.organizationId, true);
    if (negado) return negado;

    const cortesia = this.#cortesias.get(courtesyId);
    // Cortesia de outra organização é tratada como inexistente.
    if (cortesia === undefined || cortesia.organizationId !== ctx.organizationId) {
      return fail("not_found", "cortesia inexistente para esta organização");
    }
    if (cortesia.revokedAt !== null) {
      return ok({ kind: "already_revoked" });
    }

    // Append-only: a concessão original PERMANECE, com autor e motivo.
    this.#cortesias.set(courtesyId, { ...cortesia, revokedAt });

    this.#registrarAuditoria(
      ctx.organizationId,
      null,
      "courtesy",
      ctx.actorId,
      "admin",
      { courtesyId, revoked: false },
      { courtesyId, revoked: true },
      reason,
      null,
      ctx.correlationId
    );

    return ok({ kind: "revoked", courtesyId, revokedAt });
  }

  async saveGrandfathering(
    ctx: ComandoContexto,
    cutoffAt: string,
    grantedAt: string
  ): Promise<Result<GrandfatheringOutcome>> {
    const f = this.#talvezFalhar<GrandfatheringOutcome>("saveGrandfathering");
    if (f) return f;
    const negado = this.#autorizar<GrandfatheringOutcome>(ctx.actorId, ctx.organizationId, true);
    if (negado) return negado;

    if (this.#grandfathering.has(ctx.organizationId)) {
      return ok({ kind: "already_granted" });
    }

    // Direito adquirido é por ORGANIZAÇÃO, nunca por usuário: quem trocar de
    // dono não perde o direito, e quem entrar na organização não o ganha à
    // revelia.
    const registro: Grandfathering = {
      organizationId: ctx.organizationId,
      cutoffAt,
      grantedAt,
    };
    this.#grandfathering.set(ctx.organizationId, registro);

    this.#registrarAuditoria(
      ctx.organizationId,
      null,
      "grandfathering",
      ctx.actorId,
      "admin",
      null,
      { cutoffAt, grantedAt },
      null,
      null,
      ctx.correlationId
    );

    return ok({ kind: "granted", record: registro });
  }
}
