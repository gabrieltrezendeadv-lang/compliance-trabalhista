/**
 * CASOS DE USO DE ASSINATURA — trial, plano, faixa, upgrade, downgrade e
 * cancelamento.
 *
 * Toda regra comercial vem de `docs/decisions/PLANOS-E-PRECIFICACAO.md` e é
 * calculada pelos módulos puros da 12A. Aqui só há orquestração: autorizar,
 * ler, decidir com função pura, persistir e auditar.
 */

import { fail, ok, type Result } from "../core/errors";
import type { PlanSlug, Subscription, TierSlug } from "../plans/model";
import { CATALOG_VERSION } from "../plans/catalog";
import {
  applyRenewal,
  applyUpgrade,
  requestCancellation,
  resolveState,
  scheduleDowngrade as agendarDowngrade,
  startTrial as iniciarTrial,
  trialEndsAt,
} from "../plans/lifecycle";
import { capturePriceSnapshot, priceCents, selectTier } from "../plans/pricing";
import type { StoredSubscription } from "../core/repository";
import { assertTenant, auditar, exigirAssinatura, reservar, type UseCaseEnv } from "./shared";

/** Todo comando carrega a organização informada pelo cliente. Ela é conferida. */
export interface ComandoBase {
  readonly requestedOrganizationId?: string;
}

// ─── 1. startTrial ─────────────────────────────────────────────────────────

export interface StartTrialInput extends ComandoBase {
  readonly plan: PlanSlug;
  readonly period: "monthly" | "yearly";
  readonly workerCount: number;
  readonly cnpj: string;
}

/**
 * Inicia o trial de 7 dias, sem meio de pagamento, no plano ESCOLHIDO.
 *
 * A faixa é derivada de `workerCount` — nunca informada pelo cliente. Deixar o
 * cliente escolher a faixa seria deixá-lo escolher o próprio preço.
 */
export async function startTrial(
  env: UseCaseEnv,
  input: StartTrialInput
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const existente = await env.repo.findSubscription(env.auth.organizationId);
  if (!existente.ok) return existente;
  if (existente.value !== null) {
    return fail("conflict", "esta organização já tem assinatura");
  }

  let tier: TierSlug;
  let modelo: Subscription;
  try {
    tier = selectTier(input.workerCount);
    modelo = iniciarTrial({
      organizationId: env.auth.organizationId,
      plan: input.plan,
      tier,
      period: input.period,
      workerCount: input.workerCount,
      cnpj: input.cnpj,
      startedAt: env.clock.now(),
    });
  } catch (erro) {
    // `startTrial` puro lança para CNPJ ausente e para Enterprise; `selectTier`
    // lança para worker_count inválido. Nenhum dos três é autorização.
    return fail("invalid_input", erro instanceof Error ? erro.message : "entrada inválida");
  }

  const criada = await env.repo.createSubscription({
    organizationId: env.auth.organizationId,
    plan: modelo.plan,
    tier: modelo.tier,
    period: modelo.period,
    state: "trialing",
    workerCount: modelo.workerCount,
    cnpj: input.cnpj,
    currentPeriodStart: modelo.currentPeriodStart,
    currentPeriodEnd: modelo.currentPeriodEnd,
    trialEndsAt: trialEndsAt(env.clock.now()),
  });
  if (!criada.ok) return criada;

  const snap = await env.repo.appendPriceSnapshot(
    env.auth.organizationId,
    criada.value.id,
    modelo.priceSnapshot
  );
  if (!snap.ok) return snap;

  const trilha = await auditar(env, {
    subject: "subscription_state",
    subscriptionId: criada.value.id,
    previousValue: null,
    newValue: {
      state: "trialing",
      plan: modelo.plan,
      tier: modelo.tier,
      period: modelo.period,
      workerCount: modelo.workerCount,
      amountCents: modelo.priceSnapshot.amountCents,
      catalogVersion: modelo.priceSnapshot.catalogVersion,
      trialEndsAt: modelo.trialEndsAt,
    },
  });
  if (!trilha.ok) return trilha;

  return ok({ ...criada.value, priceSnapshot: snap.value });
}

// ─── 2. choosePlan ─────────────────────────────────────────────────────────

export interface ChoosePlanInput extends ComandoBase {
  readonly plan: PlanSlug;
  readonly period: "monthly" | "yearly";
}

/**
 * Troca o plano DURANTE o trial, sem cobrança e sem reiniciar o prazo.
 *
 * Só vale enquanto o trial corre: depois dele, mudar de plano é upgrade ou
 * downgrade, com as regras de pró-rata e renovação. Permitir aqui seria uma
 * porta lateral para trocar de plano sem pagar a diferença.
 */
export async function choosePlan(
  env: UseCaseEnv,
  input: ChoosePlanInput
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;

  const estado = resolveState(atual.value, env.clock.now());
  if (estado !== "trialing") {
    return fail("invalid_state", "escolha de plano só vale durante o trial");
  }

  if (priceCents(input.plan, atual.value.tier, input.period) === null) {
    return fail("invalid_input", "faixa Enterprise é sob proposta e não tem checkout");
  }

  const atualizada = await env.repo.updateSubscription(env.auth.organizationId, {
    plan: input.plan,
  });
  if (!atualizada.ok) return atualizada;

  const snapshot = capturePriceSnapshot(
    input.plan,
    atual.value.tier,
    input.period,
    env.clock.now()
  );
  const snap = await env.repo.appendPriceSnapshot(
    env.auth.organizationId,
    atual.value.id,
    snapshot
  );
  if (!snap.ok) return snap;

  const trilha = await auditar(env, {
    subject: "plan_change",
    subscriptionId: atual.value.id,
    previousValue: { plan: atual.value.plan, period: atual.value.period },
    newValue: { plan: input.plan, period: input.period, amountCents: snapshot.amountCents },
  });
  if (!trilha.ok) return trilha;

  return ok({ ...atualizada.value, priceSnapshot: snap.value });
}

// ─── 3. expireTrial ────────────────────────────────────────────────────────

/**
 * Encerra o trial vencido sem contratação: a conta vai para MODO LEITURA.
 *
 * Nenhum dado é apagado — é regra explícita do modelo aprovado.
 */
export async function expireTrial(
  env: UseCaseEnv,
  input: ComandoBase = {}
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;

  if (atual.value.state !== "trialing") {
    return fail("invalid_state", "a assinatura não está em trial");
  }
  if (resolveState(atual.value, env.clock.now()) !== "read_only") {
    return fail("invalid_state", "o trial ainda não venceu");
  }

  const atualizada = await env.repo.updateSubscription(env.auth.organizationId, {
    state: "read_only",
  });
  if (!atualizada.ok) return atualizada;

  const trilha = await auditar(env, {
    subject: "subscription_state",
    subscriptionId: atual.value.id,
    previousValue: { state: "trialing" },
    newValue: { state: "read_only" },
    reason: "trial encerrado sem contratação",
  });
  if (!trilha.ok) return trilha;

  return ok(atualizada.value);
}

// ─── 4. upgradeSubscription ────────────────────────────────────────────────

export interface UpgradeInput extends ComandoBase {
  readonly plan: PlanSlug;
  /** Obrigatória: repetir o mesmo upgrade não pode cobrar duas vezes. */
  readonly idempotencyKey: string;
}

export interface UpgradeResult {
  readonly subscription: StoredSubscription;
  readonly chargeCents: number;
}

/**
 * Upgrade IMEDIATO, cobrando a diferença proporcional ao que resta do período.
 *
 * O período NÃO é reiniciado: a renovação continua na mesma data, que é o que
 * torna a cobrança proporcional coerente.
 */
export async function upgradeSubscription(
  env: UseCaseEnv,
  input: UpgradeInput
): Promise<Result<UpgradeResult>> {
  const negado = assertTenant<UpgradeResult>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  if (input.idempotencyKey.trim() === "") {
    return fail("invalid_input", "chave de idempotência é obrigatória no upgrade");
  }

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;

  const reserva = await reservar(env, {
    scope: "command",
    key: input.idempotencyKey,
    result: { plan: input.plan },
  });
  if (!reserva.ok) return reserva;

  // Chave já usada: devolve o resultado da primeira execução SEM repetir o
  // efeito. É o que impede o upgrade repetido de cobrar duas vezes.
  if (!reserva.value.novo) {
    const anterior = reserva.value.anterior as { chargeCents?: number };
    return ok({
      subscription: atual.value,
      chargeCents: typeof anterior.chargeCents === "number" ? anterior.chargeCents : 0,
    });
  }

  let calculado;
  try {
    calculado = applyUpgrade(
      atual.value,
      { plan: input.plan, tier: atual.value.tier },
      env.clock.now()
    );
  } catch (erro) {
    return fail("invalid_state", erro instanceof Error ? erro.message : "upgrade inválido");
  }

  const atualizada = await env.repo.updateSubscription(env.auth.organizationId, {
    plan: calculado.subscription.plan,
    state: "active",
    scheduledDowngrade: null,
  });
  if (!atualizada.ok) return atualizada;

  const snap = await env.repo.appendPriceSnapshot(
    env.auth.organizationId,
    atual.value.id,
    calculado.subscription.priceSnapshot
  );
  if (!snap.ok) return snap;

  const trilha = await auditar(env, {
    subject: "plan_change",
    subscriptionId: atual.value.id,
    previousValue: {
      plan: atual.value.plan,
      amountCents: atual.value.priceSnapshot.amountCents,
    },
    newValue: {
      plan: calculado.subscription.plan,
      amountCents: snap.value.amountCents,
      prorationCents: calculado.chargeCents,
      catalogVersion: CATALOG_VERSION,
    },
    idempotencyKey: input.idempotencyKey,
  });
  if (!trilha.ok) return trilha;

  return ok({
    subscription: { ...atualizada.value, priceSnapshot: snap.value },
    chargeCents: calculado.chargeCents,
  });
}

// ─── 5. scheduleDowngrade ──────────────────────────────────────────────────

export interface DowngradeInput extends ComandoBase {
  readonly plan: PlanSlug;
}

/**
 * Agenda o downgrade para a PRÓXIMA RENOVAÇÃO. Nada muda agora: nem plano, nem
 * preço, nem acesso, e não há crédito retroativo.
 */
export async function scheduleDowngradeUseCase(
  env: UseCaseEnv,
  input: DowngradeInput
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;

  let calculado;
  try {
    calculado = agendarDowngrade(atual.value, { plan: input.plan, tier: atual.value.tier });
  } catch (erro) {
    return fail("invalid_state", erro instanceof Error ? erro.message : "downgrade inválido");
  }

  const atualizada = await env.repo.updateSubscription(env.auth.organizationId, {
    scheduledDowngrade: calculado.scheduledDowngrade,
  });
  if (!atualizada.ok) return atualizada;

  const trilha = await auditar(env, {
    subject: "plan_change",
    subscriptionId: atual.value.id,
    previousValue: { plan: atual.value.plan, scheduledDowngrade: null },
    newValue: { scheduledDowngrade: calculado.scheduledDowngrade, efeito: "proxima_renovacao" },
  });
  if (!trilha.ok) return trilha;

  return ok(atualizada.value);
}

// ─── 6. cancelAtPeriodEnd ──────────────────────────────────────────────────

/** Cancelamento vale ao FIM do período pago. Até lá o acesso é normal. */
export async function cancelAtPeriodEnd(
  env: UseCaseEnv,
  input: ComandoBase = {}
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;

  if (atual.value.state === "terminated") {
    return fail("invalid_state", "assinatura já encerrada");
  }

  const calculado = requestCancellation(atual.value);
  const atualizada = await env.repo.updateSubscription(env.auth.organizationId, {
    state: calculado.state,
    scheduledDowngrade: null,
  });
  if (!atualizada.ok) return atualizada;

  const trilha = await auditar(env, {
    subject: "subscription_state",
    subscriptionId: atual.value.id,
    previousValue: { state: atual.value.state },
    newValue: { state: "cancel_scheduled", efetivoEm: atual.value.currentPeriodEnd },
  });
  if (!trilha.ok) return trilha;

  return ok(atualizada.value);
}

// ─── 7. renewSubscription ──────────────────────────────────────────────────

/**
 * Renova: aplica o downgrade agendado, RECALCULA A FAIXA a partir do
 * `worker_count` vigente e abre novo período com preço congelado hoje.
 *
 * É aqui — e só aqui — que mudança de faixa entra em vigor. É o que cumpre
 * "mudança de faixa entra no próximo ciclo, sem bloquear dados": durante o
 * ciclo o `worker_count` pode subir à vontade, e nada é bloqueado.
 */
export async function renewSubscription(
  env: UseCaseEnv,
  input: ComandoBase = {}
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;

  if (atual.value.state === "terminated") {
    return fail("invalid_state", "assinatura encerrada não renova");
  }

  const faixaNova = selectTier(atual.value.workerCount);
  const destino = atual.value.scheduledDowngrade ?? {
    plan: atual.value.plan,
    tier: faixaNova,
  };

  if (priceCents(destino.plan, faixaNova, atual.value.period) === null) {
    return fail(
      "invalid_state",
      "a faixa apurada é Enterprise — renovação exige proposta comercial"
    );
  }

  const renovada = applyRenewal(
    { ...atual.value, scheduledDowngrade: { plan: destino.plan, tier: faixaNova } },
    env.clock.now()
  );

  const atualizada = await env.repo.updateSubscription(env.auth.organizationId, {
    plan: renovada.plan,
    tier: renovada.tier,
    state: "active",
    currentPeriodStart: renovada.currentPeriodStart,
    currentPeriodEnd: renovada.currentPeriodEnd,
    paymentFailedAt: null,
    scheduledDowngrade: null,
  });
  if (!atualizada.ok) return atualizada;

  const snap = await env.repo.appendPriceSnapshot(
    env.auth.organizationId,
    atual.value.id,
    renovada.priceSnapshot
  );
  if (!snap.ok) return snap;

  if (faixaNova !== atual.value.tier) {
    const t = await auditar(env, {
      subject: "tier_change",
      subscriptionId: atual.value.id,
      previousValue: { tier: atual.value.tier },
      newValue: { tier: faixaNova, workerCount: atual.value.workerCount },
      reason: "mudança de faixa aplicada na renovação",
    });
    if (!t.ok) return t;
  }

  const trilha = await auditar(env, {
    subject: "subscription_state",
    subscriptionId: atual.value.id,
    previousValue: {
      state: atual.value.state,
      periodEnd: atual.value.currentPeriodEnd,
      amountCents: atual.value.priceSnapshot.amountCents,
    },
    newValue: {
      state: "active",
      periodStart: renovada.currentPeriodStart,
      periodEnd: renovada.currentPeriodEnd,
      amountCents: snap.value.amountCents,
    },
  });
  if (!trilha.ok) return trilha;

  return ok({ ...atualizada.value, priceSnapshot: snap.value });
}

// ─── 8. recordWorkerCount ──────────────────────────────────────────────────

export interface WorkerCountInput extends ComandoBase {
  readonly workerCount: number;
}

/**
 * Registra a quantidade de trabalhadores informada pelo proprietário.
 *
 * NÃO muda faixa nem preço agora, e NÃO bloqueia nada: a faixa é recalculada
 * na renovação. É a diferença entre "auditar o porte" e "cobrar na hora".
 */
export async function recordWorkerCount(
  env: UseCaseEnv,
  input: WorkerCountInput
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  let faixaApurada: TierSlug;
  try {
    faixaApurada = selectTier(input.workerCount);
  } catch (erro) {
    return fail("invalid_input", erro instanceof Error ? erro.message : "quantidade inválida");
  }

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;

  const atualizada = await env.repo.updateSubscription(env.auth.organizationId, {
    workerCount: input.workerCount,
  });
  if (!atualizada.ok) return atualizada;

  const trilha = await auditar(env, {
    subject: "worker_count",
    subscriptionId: atual.value.id,
    previousValue: { workerCount: atual.value.workerCount, tier: atual.value.tier },
    newValue: {
      workerCount: input.workerCount,
      tierApurada: faixaApurada,
      tierVigente: atual.value.tier,
      aplicaEm: "proxima_renovacao",
    },
  });
  if (!trilha.ok) return trilha;

  return ok(atualizada.value);
}
