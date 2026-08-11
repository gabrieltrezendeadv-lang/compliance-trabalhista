/**
 * CICLO DE VIDA DA ASSINATURA
 *
 * ── UMA ESCRITA POR CASO DE USO ─────────────────────────────────────────────
 *
 * Cada função aqui faz exatamente UMA chamada de escrita ao repositório, e essa
 * chamada é uma RPC atômica que grava assinatura, snapshot e auditoria na mesma
 * transação.
 *
 * A versão anterior compunha: `updateSubscription` + `appendPriceSnapshot` +
 * `appendAuditEvent` — três requisições HTTP, três transações. Um erro no meio
 * deixava preço novo sem trilha, ou trilha sem preço. Não há mais como escrever
 * esse defeito: o contrato não oferece as peças.
 *
 * ── O CÁLCULO É PURO, A ESCRITA É ATÔMICA ───────────────────────────────────
 *
 * Faixa, preço, pró-rata e datas vêm das funções puras de `plans/`. Elas não
 * tocam relógio, banco nem rede: recebem tudo por argumento. O caso de uso
 * calcula, decide, e só então escreve uma vez.
 */

import { fail, ok, type Result } from "../core/errors";
import type { StoredSubscription } from "../core/repository";
import { CATALOG_VERSION } from "../plans/catalog";
import { resolveState, trialEndsAt } from "../plans/lifecycle";
import type { BillingPeriod, PlanSlug, SubscriptionState, TierSlug } from "../plans/model";
import { addMonths, priceCents, prorationCents, selectTier } from "../plans/pricing";
import { exigirVersaoVigente, TermsVersionMismatchError } from "../terms";
import {
  assertTenant,
  contexto,
  exigirAssinatura,
  type ComandoBase,
  type UseCaseEnv,
} from "./shared";

// ─── 1. startTrial ─────────────────────────────────────────────────────────

export interface StartTrialInput extends ComandoBase {
  readonly plan: PlanSlug;
  readonly period: BillingPeriod;
  readonly workerCount: number;
  readonly cnpj: string;
  /** Contato financeiro. OPCIONAL: ausente e vazio significam a mesma coisa. */
  readonly billingEmail?: string | null;
  /**
   * Versão dos termos que a tela EXIBIU. OBRIGATÓRIA, e conferida contra
   * `TERMS_VERSION` — o que chega aqui é afirmação, não escolha.
   */
  readonly termsVersion: string;
}

/**
 * Inicia o trial de 7 dias.
 *
 * CNPJ é obrigatório por decisão comercial — não é validação de formato, é
 * requisito do modelo aprovado. Sem ele não há trial.
 *
 * ── ACEITE DOS TERMOS É CONDIÇÃO, NÃO CAMPO ─────────────────────────────────
 *
 * Trial novo sem aceite não existe. A versão vem da tela e é comparada com a
 * vigente: uma sessão aberta antes da publicação de termos novos manda a versão
 * antiga, e tem de ser recusada — a pessoa leu outro documento.
 */
export async function startTrial(
  env: UseCaseEnv,
  input: StartTrialInput
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  if (input.cnpj.trim() === "") {
    return fail("invalid_input", "CNPJ é obrigatório para iniciar o trial");
  }
  if (!Number.isInteger(input.workerCount) || input.workerCount < 1) {
    return fail("invalid_input", "número de trabalhadores inválido");
  }

  const versao = conferirVersaoDosTermos(input.termsVersion);
  if (!versao.ok) return versao;

  const agora = env.clock.now();
  const faixa = selectTier(input.workerCount);
  const valor = priceCents(input.plan, faixa, input.period);

  return env.repo.startTrial({
    ...contexto(env),
    plan: input.plan,
    tier: faixa,
    period: input.period,
    workerCount: input.workerCount,
    cnpj: input.cnpj,
    periodStart: agora,
    periodEnd: addMonths(agora, input.period === "yearly" ? 12 : 1),
    trialEndsAt: trialEndsAt(agora),
    // Faixa Enterprise não tem preço de tabela: o snapshot fica sem valor, e é
    // isso que impede o checkout automático mais adiante.
    amountCents: valor,
    catalogVersion: valor === null ? null : CATALOG_VERSION,
    billingEmail: input.billingEmail ?? null,
    // A versão OFICIAL, devolvida por `exigirVersaoVigente` — nunca a string
    // que chegou do cliente. Assim nenhum caminho a jusante persiste o que foi
    // recebido, mesmo que a comparação um dia vire só um aviso.
    termsVersion: versao.value,
    termsAcceptedAt: agora,
  });
}

// ─── 1.1 Metadados contratuais depois do trial ─────────────────────────────

/**
 * Confere a versão afirmada pelo cliente contra a vigente e devolve a OFICIAL.
 *
 * `exigirVersaoVigente` lança; aqui a exceção vira `Result`, porque é assim que
 * o resto desta camada fala. A recusa NÃO diz qual é a versão vigente: quem
 * está com a tela velha recarrega e recebe a nova, e quem está sondando não
 * ganha nada.
 */
function conferirVersaoDosTermos(recebida: string): Result<string> {
  try {
    return ok(exigirVersaoVigente(recebida));
  } catch (erro) {
    if (erro instanceof TermsVersionMismatchError) {
      return fail("invalid_input", "aceite dos termos ausente ou desatualizado");
    }
    throw erro;
  }
}

export interface UpdateBillingEmailInput extends ComandoBase {
  /** Vazio ou `null` LIMPA o contato. É intenção, não erro. */
  readonly billingEmail: string | null;
}

/**
 * Troca o contato financeiro — depois do trial, quantas vezes for preciso.
 *
 * Existe separado de `startTrial` por exigência do desenho: uma coluna que só
 * se preenche na criação é uma coluna que ninguém consegue corrigir.
 *
 * A mensagem de recusa NÃO reproduz o endereço. Ela vai para log, para tela e
 * para relatório, e um e-mail rejeitado continua sendo o e-mail de alguém.
 */
export async function updateBillingEmail(
  env: UseCaseEnv,
  input: UpdateBillingEmailInput
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const bruto = (input.billingEmail ?? "").trim();
  if (bruto.length > 254) {
    return fail("invalid_input", "contato financeiro excede o tamanho permitido");
  }

  return env.repo.updateBillingEmail(
    contexto(env),
    bruto === "" ? null : bruto,
    env.clock.now()
  );
}

export interface AcceptTermsInput extends ComandoBase {
  /** Versão que a tela exibiu. Conferida contra a vigente. */
  readonly termsVersion: string;
}

/**
 * Registra o aceite de uma versão dos termos, depois do trial.
 *
 * Reenviar a versão já aceita é no-op idempotente — o instante original é a
 * prova, e sobrescrevê-lo por um reenvio apagaria a data que interessa.
 */
export async function acceptTerms(
  env: UseCaseEnv,
  input: AcceptTermsInput
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const versao = conferirVersaoDosTermos(input.termsVersion);
  if (!versao.ok) return versao;

  return env.repo.acceptTerms(contexto(env), versao.value, env.clock.now());
}

// ─── 2. choosePlan ─────────────────────────────────────────────────────────

export interface ChoosePlanInput extends ComandoBase {
  readonly plan: PlanSlug;
  readonly period: BillingPeriod;
}

/** Escolhe o plano ao fim do trial. A faixa vem do número declarado. */
export async function choosePlan(
  env: UseCaseEnv,
  input: ChoosePlanInput
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;
  const sub = atual.value;

  const faixa = selectTier(sub.workerCount);
  const valor = priceCents(input.plan, faixa, input.period);
  if (valor === null) {
    return fail("invalid_state", "faixa Enterprise é contratada sob proposta");
  }

  const agora = env.clock.now();
  return env.repo.changePlan({
    ...contexto(env),
    plan: input.plan,
    tier: faixa,
    period: input.period,
    state: "active",
    periodStart: agora,
    periodEnd: addMonths(agora, input.period === "yearly" ? 12 : 1),
    amountCents: valor,
    catalogVersion: CATALOG_VERSION,
    subject: "plan_change",
    reason: "plano escolhido ao fim do trial",
    idempotencyKey: null,
    now: agora,
  });
}

// ─── 3. expireTrial ────────────────────────────────────────────────────────

/**
 * Encerra o trial vencido: a conta vai para MODO LEITURA.
 *
 * A transição é derivada da DATA, não da vontade de quem chama — se o trial
 * ainda corre, é recusada. Origem `scheduler`: é rotina, não pedido, e por isso
 * a trilha fica sem ator humano.
 */
export async function expireTrial(
  env: UseCaseEnv,
  input: ComandoBase = {}
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;

  const agora = env.clock.now();
  if (atual.value.trialEndsAt === null) {
    return fail("invalid_state", "esta assinatura não está em trial");
  }
  if (resolveState(atual.value, agora) !== "read_only") {
    return fail("invalid_state", "o trial ainda não venceu");
  }

  return env.repo.transitionState(
    contexto(env),
    "read_only",
    "scheduler",
    "trial encerrado sem contratação",
    agora
  );
}

// ─── 4. upgradeSubscription ────────────────────────────────────────────────

export interface UpgradeInput extends ComandoBase {
  readonly plan: PlanSlug;
}

export interface UpgradeResult {
  readonly subscription: StoredSubscription;
  /** Diferença proporcional aos dias restantes do ciclo. */
  readonly prorationCents: number;
}

/**
 * Upgrade IMEDIATO, com pró-rata.
 *
 * O período NÃO é reiniciado: quem paga a diferença dos dias restantes tem
 * direito ao ciclo que já contratou. Reiniciar cobraria duas vezes o mesmo
 * intervalo.
 */
export async function upgradeSubscription(
  env: UseCaseEnv,
  input: UpgradeInput
): Promise<Result<UpgradeResult>> {
  const negado = assertTenant<UpgradeResult>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;
  const sub = atual.value;

  if (sub.plan === input.plan) {
    return fail("invalid_state", "a assinatura já está neste plano");
  }
  // Upgrade é de `essencial` para `completo`. O caminho inverso é downgrade, e
  // downgrade vale no próximo ciclo — tratá-lo aqui aplicaria redução imediata.
  if (input.plan !== "completo") {
    return fail("invalid_state", "redução de plano é agendada, não imediata");
  }
  if (sub.state !== "trialing" && sub.state !== "active") {
    return fail("invalid_state", `upgrade não é possível no estado ${sub.state}`);
  }

  const atualValor = priceCents(sub.plan, sub.tier, sub.period);
  const novoValor = priceCents(input.plan, sub.tier, sub.period);
  if (atualValor === null || novoValor === null) {
    return fail("invalid_state", "faixa Enterprise é contratada sob proposta");
  }

  const agora = env.clock.now();
  const diferenca = prorationCents({
    currentAmountCents: atualValor,
    targetAmountCents: novoValor,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
    changeAt: agora,
  });

  const escrito = await env.repo.changePlan({
    ...contexto(env),
    plan: input.plan,
    tier: sub.tier,
    period: sub.period,
    state: null,
    // Período preservado, deliberadamente.
    periodStart: null,
    periodEnd: null,
    amountCents: novoValor,
    catalogVersion: CATALOG_VERSION,
    subject: "plan_change",
    reason: "upgrade imediato com pró-rata",
    idempotencyKey: null,
    now: agora,
  });
  if (!escrito.ok) return escrito;

  return ok({ subscription: escrito.value, prorationCents: diferenca });
}

// ─── 5. scheduleDowngrade ──────────────────────────────────────────────────

export interface DowngradeInput extends ComandoBase {
  readonly plan: PlanSlug;
}

/**
 * Downgrade AGENDADO para a próxima renovação.
 *
 * Nunca imediato: o ciclo já foi pago no plano atual, e reduzir agora retiraria
 * acesso já contratado.
 */
export async function scheduleDowngradeUseCase(
  env: UseCaseEnv,
  input: DowngradeInput
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;
  const sub = atual.value;

  if (sub.plan === input.plan) {
    return fail("invalid_state", "a assinatura já está neste plano");
  }
  if (input.plan !== "essencial") {
    return fail("invalid_state", "aumento de plano é imediato, não agendado");
  }

  return env.repo.scheduleDowngrade(
    contexto(env),
    input.plan,
    sub.tier,
    "downgrade agendado para a renovação",
    env.clock.now()
  );
}

// ─── 6. cancelAtPeriodEnd ──────────────────────────────────────────────────

/** Cancelamento com efeito no FIM do período já pago. */
export async function cancelAtPeriodEnd(
  env: UseCaseEnv,
  input: ComandoBase = {}
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;

  if (atual.value.state === "cancel_scheduled") {
    return fail("invalid_state", "o cancelamento já está agendado");
  }
  if (atual.value.state === "terminated") {
    return fail("invalid_state", "a assinatura já foi encerrada");
  }

  return env.repo.cancelAtPeriodEnd(
    contexto(env),
    "cancelamento pedido pelo proprietário",
    env.clock.now()
  );
}

// ─── 7. renewSubscription ──────────────────────────────────────────────────

/**
 * Renova o ciclo.
 *
 * É aqui — e só aqui — que a faixa é recalculada a partir do número de
 * trabalhadores declarado, e que um downgrade agendado passa a valer.
 */
export async function renewSubscription(
  env: UseCaseEnv,
  input: ComandoBase = {}
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  const atual = await exigirAssinatura(env);
  if (!atual.ok) return atual;
  const sub = atual.value;

  if (sub.state === "terminated") {
    return fail("invalid_state", "assinatura encerrada não renova");
  }

  const planoNovo: PlanSlug = sub.scheduledDowngrade?.plan ?? sub.plan;
  const faixaNova: TierSlug = selectTier(sub.workerCount);
  const valor = priceCents(planoNovo, faixaNova, sub.period);
  if (valor === null) {
    return fail("invalid_state", "faixa Enterprise é contratada sob proposta");
  }

  const inicio = sub.currentPeriodEnd;
  const estadoNovo: SubscriptionState =
    sub.state === "cancel_scheduled" ? "terminated" : "active";

  return env.repo.changePlan({
    ...contexto(env),
    plan: planoNovo,
    tier: faixaNova,
    period: sub.period,
    state: estadoNovo,
    periodStart: inicio,
    periodEnd: addMonths(inicio, sub.period === "yearly" ? 12 : 1),
    amountCents: valor,
    catalogVersion: CATALOG_VERSION,
    subject: "plan_change",
    reason: "renovação de ciclo",
    idempotencyKey: null,
    now: env.clock.now(),
  });
}

// ─── 8. recordWorkerCount ──────────────────────────────────────────────────

export interface WorkerCountInput extends ComandoBase {
  readonly workerCount: number;
}

/**
 * Declara o número de trabalhadores.
 *
 * NÃO muda faixa nem preço agora: a faixa é recalculada na renovação. Aplicar
 * imediatamente cobraria a mais no meio de um ciclo já pago.
 */
export async function recordWorkerCount(
  env: UseCaseEnv,
  input: WorkerCountInput
): Promise<Result<StoredSubscription>> {
  const negado = assertTenant<StoredSubscription>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  if (!Number.isInteger(input.workerCount) || input.workerCount < 1) {
    return fail("invalid_input", "número de trabalhadores inválido");
  }

  return env.repo.recordWorkerCount(contexto(env), input.workerCount, env.clock.now());
}
