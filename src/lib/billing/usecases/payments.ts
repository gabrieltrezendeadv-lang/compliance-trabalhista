/**
 * CHECKOUT E PAGAMENTO — máquina de estados recuperável
 *
 * ── A GARANTIA, DITA COM PRECISÃO ───────────────────────────────────────────
 *
 * NÃO existe atomicidade entre o PostgreSQL e o provider. São dois sistemas,
 * cada um com o seu commit, e nenhuma linha deste arquivo vai fingir o
 * contrário. "Exatamente-uma-vez" entre sistemas distribuídos não é uma
 * garantia disponível.
 *
 * O que ESTÁ garantido, e é o que basta:
 *
 *   * cada RPC é atômica INDIVIDUALMENTE;
 *   * os efeitos são idempotentes sob a chave declarada;
 *   * o estado é recuperável — nenhuma falha deixa a operação presa;
 *   * o processamento é EFETIVAMENTE ÚNICO sob aquela chave: no máximo uma
 *     cobrança lógica no provider, e no máximo uma cobrança, um snapshot e uma
 *     transição no banco.
 *
 * ── AS TRÊS FASES ───────────────────────────────────────────────────────────
 *
 *   CLAIM     RPC atômica reserva a chave e devolve o desfecho.
 *   PROVIDER  chamado FORA de qualquer transação, com a MESMA chave.
 *   FINALIZE  RPC atômica grava cobrança, auditoria e conclusão — ou FAIL
 *             registra a falha sem declarar efeito.
 *
 * ── QUANDO O PROVIDER NÃO PODE SER CHAMADO ──────────────────────────────────
 *
 * Autorização negada, fingerprint conflitante, operação já concluída, ou lease
 * de outro processamento ainda válida. Nos quatro casos a função retorna antes,
 * e o teste `resilience` prova contando as chamadas do mock.
 *
 * ── PROVIDER CONCLUIU E O FINALIZE FALHOU ───────────────────────────────────
 *
 * A reserva PERMANECE `in_progress`: marcar `failed` seria mentira, porque o
 * recurso externo existe. Vencida a lease, a repetição chama o provider com a
 * mesma chave, recebe o MESMO recurso externo — o mock guarda
 * `provider + chave + fingerprint → resultado` — e refaz o finalize. Nenhuma
 * segunda cobrança é criada.
 */

import { fail, ok, type Result } from "../core/errors";
import type { Charge, ChargeMethod, StoredSubscription } from "../core/repository";
import { priceCents } from "../plans/pricing";
import {
  assertTenantOwner,
  chaveDeIdempotencia,
  contexto,
  exigirAssinatura,
  fingerprintDe,
  type ComandoBase,
  type UseCaseEnv,
} from "./shared";

// ─── Checkout ──────────────────────────────────────────────────────────────

export interface CheckoutInput extends ComandoBase {
  readonly method: ChargeMethod;
  /**
   * A INTENÇÃO de checkout, cunhada pelo servidor.
   *
   * Não é a chave de idempotência: a chave é DERIVADA dela aqui dentro, junto
   * com organização e operação. O caso de uso nunca recebe chave pronta, e a
   * fachada nunca a calcula — assim não existe caminho em que o chamador
   * escolha, direta ou indiretamente, o que o banco vai reservar.
   */
  readonly checkoutIntentId: string;
  readonly customerName: string;
  readonly customerEmail: string;
}

export interface CheckoutResult {
  readonly charge: Charge;
  readonly pixPayload: string | null;
  /** `true` quando a cobrança já existia e foi apenas devolvida. */
  readonly replay: boolean;
}

export async function createCheckout(
  env: UseCaseEnv,
  input: CheckoutInput
): Promise<Result<CheckoutResult>> {
  // 1. AUTORIZAÇÃO — antes de qualquer efeito, e antes do provider.
  const negado = assertTenantOwner<CheckoutResult>(env.auth, input.requestedOrganizationId);
  if (negado) return negado;

  if (input.checkoutIntentId.trim() === "") {
    return fail("invalid_input", "intenção de checkout é obrigatória");
  }

  // A CHAVE, derivada aqui e só aqui, de (operação, organização, intenção).
  //
  // Nenhum dos três vem de leitura do banco, e é isso que elimina o TOCTOU que
  // existia enquanto a chave dependia do período: não há mais janela entre
  // "descobrir de que período é a chave" e "reservá-la".
  const idempotencyKey = chaveDeIdempotencia(
    "checkout",
    env.auth.organizationId,
    input.checkoutIntentId
  );

  // LEITURA ÚNICA do estado. A fachada não lê antes; toda decisão comercial
  // sobre a assinatura — inclusive "não existe" — acontece a partir daqui.
  const assinatura = await exigirAssinatura(env);
  if (!assinatura.ok) return assinatura;
  const sub = assinatura.value;

  const valor = priceCents(sub.plan, sub.tier, sub.period);
  if (valor === null) {
    return fail("invalid_state", "faixa Enterprise não tem checkout automático");
  }

  // 2. FINGERPRINT — fixado ANTES do claim, a partir do pedido inteiro. Mudar
  //    qualquer campo muda o fingerprint, e a mesma chave passa a conflitar.
  const fingerprint = fingerprintDe({
    intent: "checkout",
    plan: sub.plan,
    tier: sub.tier,
    period: sub.period,
    amountCents: valor,
    method: input.method,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
  });

  const agora = env.clock.now();
  const reserva = {
    ...contexto(env),
    scope: "command" as const,
    provider: env.provider.name,
    key: idempotencyKey,
    fingerprint,
    now: agora,
  };

  // 3. CLAIM.
  const claim = await env.repo.claimIdempotency(reserva);
  if (!claim.ok) return claim;

  switch (claim.value.kind) {
    case "fingerprint_conflict":
      // Mesma chave, outro pedido. O provider NÃO é chamado.
      return fail("conflict", "esta chave já foi usada para um pedido diferente");

    case "in_progress":
      // Outro processamento válido tem a lease. O provider NÃO é chamado.
      return fail("conflict", "operação em andamento para esta chave");

    case "completed": {
      // Replay: devolve a cobrança já criada, sem tocar no provider.
      const idAnterior = claim.value.result.chargeId;
      if (typeof idAnterior !== "string") {
        return fail("conflict", "reserva concluída sem cobrança correspondente");
      }
      const anterior = await buscarCobranca(env, idAnterior);
      if (!anterior.ok) return anterior;
      return ok({ charge: anterior.value, pixPayload: null, replay: true });
    }

    case "claimed":
      break;
  }

  // 4. PROVIDER — fora de transação, com a MESMA chave de idempotência. Numa
  //    retomada, o provider devolve o mesmo recurso externo em vez de criar
  //    outro; é essa propriedade que impede a segunda cobrança.
  const cliente = await env.provider.createCustomer({
    organizationId: env.auth.organizationId,
    cnpj: sub.cnpj,
    name: input.customerName,
    email: input.customerEmail,
  });
  if (!cliente.ok) {
    await talvezMarcarFalha(env, reserva, cliente.error.code);
    return cliente;
  }

  const cobranca = await env.provider.createCharge({
    externalCustomerId: cliente.value.externalCustomerId,
    amountCents: valor,
    method: input.method,
    description: `Neo SST — ${sub.plan} ${sub.period}`,
    dueAt: sub.currentPeriodEnd,
    // A MESMA chave e o MESMO fingerprint que foram ao banco. É esta
    // igualdade que faz a retomada recuperar o recurso externo já criado.
    idempotencyKey: idempotencyKey,
    fingerprint,
  });
  if (!cobranca.ok) {
    await talvezMarcarFalha(env, reserva, cobranca.error.code);
    return cobranca;
  }

  // 5. FINALIZE — cobrança, auditoria e conclusão da chave, em UMA transação.
  const finalizado = await env.repo.finalizeCheckout({
    ...contexto(env),
    provider: env.provider.name,
    providerAccountId: env.providerAccountId,
    externalCustomerId: cliente.value.externalCustomerId,
    externalChargeId: cobranca.value.externalChargeId,
    method: input.method,
    amountCents: valor,
    periodStart: sub.currentPeriodStart,
    periodEnd: sub.currentPeriodEnd,
    idempotencyKey: idempotencyKey,
    fingerprint,
    now: agora,
  });

  if (!finalizado.ok) {
    // DELIBERADAMENTE não marcamos `failed`: o recurso externo EXISTE. Dizer
    // que falhou permitiria uma retomada criar uma segunda cobrança no
    // provider. A reserva fica `in_progress` e a lease governa a retomada.
    return finalizado;
  }

  if (finalizado.value.kind === "fingerprint_conflict") {
    return fail("conflict", "esta chave já foi usada para um pedido diferente");
  }

  return ok({
    charge: finalizado.value.charge,
    pixPayload: cobranca.value.pixPayload,
    replay: false,
  });
}

/**
 * Códigos em que a falha do provider é AMBÍGUA.
 *
 * ── A DISTINÇÃO QUE O CHAMADOR NÃO TEM ──────────────────────────────────────
 *
 * "Indisponível" e "não respondeu a tempo" NÃO dizem se o recurso externo foi
 * criado. Uma conexão que cai depois do commit do provider é indistinguível de
 * uma que cai antes — do lado de cá chega o mesmo erro.
 *
 * Marcar `failed` nesses casos afirmaria "nada aconteceu", e uma retomada
 * imediata criaria a SEGUNDA cobrança. Por isso a reserva fica `in_progress` e
 * quem governa a retomada é a lease: passado o prazo, a retomada chama o
 * provider com a mesma chave e recupera o que houver.
 *
 * `failed` fica reservado às recusas DETERMINÍSTICAS — entrada inválida,
 * conflito, configuração proibida — em que o provider rejeitou sem criar nada.
 */
const AMBIGUOS: ReadonlySet<string> = new Set(["provider_unavailable", "provider_timeout"]);

async function talvezMarcarFalha(
  env: UseCaseEnv,
  reserva: Parameters<UseCaseEnv["repo"]["failIdempotency"]>[0],
  code: string
): Promise<void> {
  if (AMBIGUOS.has(code)) return;
  await env.repo.failIdempotency(reserva, code);
}

async function buscarCobranca(env: UseCaseEnv, chargeId: string): Promise<Result<Charge>> {
  const ledger = await env.repo.readLedger(env.auth.userId, env.auth.organizationId);
  if (!ledger.ok) return ledger;
  const achada = ledger.value.charges.find((c) => c.id === chargeId);
  if (achada === undefined) {
    return fail("not_found", "cobrança referida pela reserva não existe");
  }
  return ok(achada);
}

// ─── Evento do provider ────────────────────────────────────────────────────

export interface WebhookInput {
  readonly externalEventId: string;
  readonly externalChargeId: string;
  readonly eventType: "charge_paid" | "charge_failed";
  readonly occurredAt: string;
}

export type WebhookResult =
  | { readonly kind: "applied"; readonly subscription: StoredSubscription; readonly charge: Charge }
  | { readonly kind: "duplicate" }
  | { readonly kind: "out_of_order"; readonly reason: string };

/**
 * Aplica um evento do provider.
 *
 * NÃO recebe organização nem ator, e a ausência é o desenho: o webhook não tem
 * sessão, e o tenant é RESOLVIDO pelo banco a partir do identificador externo,
 * que é único globalmente. Aceitar a organização do corpo do evento deixaria
 * quem manda o evento escolher a quem ele se aplica.
 */
export async function applyProviderEvent(
  env: UseCaseEnv,
  input: WebhookInput
): Promise<Result<WebhookResult>> {
  const aplicado = await env.repo.applyProviderEvent({
    provider: env.provider.name,
    providerAccountId: env.providerAccountId,
    externalEventId: input.externalEventId,
    externalChargeId: input.externalChargeId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    correlationId: env.correlationId,
    now: env.clock.now(),
  });
  if (!aplicado.ok) return aplicado;

  switch (aplicado.value.kind) {
    case "duplicate":
      return ok({ kind: "duplicate" });
    case "out_of_order":
      return ok({ kind: "out_of_order", reason: aplicado.value.reason });
    case "applied":
      return ok({
        kind: "applied",
        subscription: aplicado.value.subscription,
        charge: aplicado.value.charge,
      });
  }
}
