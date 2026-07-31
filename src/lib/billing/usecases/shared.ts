/**
 * PEÇAS COMUNS DOS CASOS DE USO
 *
 * Autorização, auditoria e idempotência entram por aqui, uma vez, em vez de
 * serem reescritas em cada caso de uso. Repetir a checagem dezesseis vezes
 * significa dezesseis chances de esquecer uma.
 */

import { fail, ok, type Result } from "../core/errors";
import type { BillingActionOrigin, BillingAuthContext, BillingDeps } from "../core/ports";
import type { BillingProviderPort } from "../core/provider";
import type {
  AuditSubject,
  BillingRepository,
  IdempotencyScope,
} from "../core/repository";

/** Tudo o que um caso de uso recebe. Nada é buscado de variável global. */
export interface UseCaseEnv extends BillingDeps {
  readonly repo: BillingRepository;
  readonly provider: BillingProviderPort;
  readonly auth: BillingAuthContext;
  readonly origin: BillingActionOrigin;
  /** Liga todos os eventos de uma mesma operação. */
  readonly correlationId: string;
}

/**
 * Confere que a organização pedida pelo cliente é a resolvida no servidor.
 *
 * ── POR QUE ISTO É UMA FUNÇÃO, E OBRIGATÓRIA ────────────────────────────────
 *
 * Todo comando recebe `requestedOrganizationId` — o valor que veio do
 * formulário, da rota ou do corpo da requisição. Ele NUNCA autoriza: só é
 * comparado com `auth.organizationId`, que o servidor resolveu a partir da
 * sessão.
 *
 * A recusa é `not_owner`, e não `not_found`, mesmo quando a organização não
 * existe. Distinguir os dois casos entregaria ao chamador a informação "esta
 * organização existe" — que é exatamente o que uma varredura de identificadores
 * procura.
 */
export function assertTenant<T>(
  auth: BillingAuthContext,
  requestedOrganizationId: string | undefined
): Result<T> | null {
  if (auth.role !== "owner") {
    return fail("not_owner", "somente o proprietário administra a assinatura");
  }
  if (requestedOrganizationId === undefined) return null;
  if (
    typeof requestedOrganizationId !== "string" ||
    requestedOrganizationId.trim() === ""
  ) {
    return fail("invalid_input", "organização inválida");
  }
  if (requestedOrganizationId !== auth.organizationId) {
    return fail("not_owner", "somente o proprietário administra a assinatura");
  }
  return null;
}

export interface AuditoriaInput {
  readonly subject: AuditSubject;
  readonly subscriptionId: string | null;
  readonly previousValue: Record<string, unknown> | null;
  readonly newValue: Record<string, unknown> | null;
  readonly reason?: string | null;
  readonly idempotencyKey?: string | null;
}

/**
 * Grava o evento de auditoria da operação.
 *
 * O ator vem do contexto — nunca do argumento. Um caso de uso não escolhe quem
 * assinou a ação: isso é propriedade da sessão, e permitir sobrescrever seria
 * abrir caminho para atribuir a mudança a outra pessoa.
 *
 * Falha de auditoria FALHA a operação. Uma escrita relevante sem trilha é pior
 * do que a escrita não ter acontecido: fica um estado sem explicação.
 */
export async function auditar(
  env: UseCaseEnv,
  input: AuditoriaInput
): Promise<Result<true>> {
  const r = await env.repo.appendAuditEvent({
    organizationId: env.auth.organizationId,
    subscriptionId: input.subscriptionId,
    subject: input.subject,
    actorId: env.origin === "owner" || env.origin === "admin" ? env.auth.userId : null,
    origin: env.origin,
    occurredAt: env.clock.now(),
    previousValue: input.previousValue,
    newValue: input.newValue,
    reason: input.reason ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    correlationId: env.correlationId,
  });
  if (!r.ok) return r;
  return ok(true);
}

export interface IdempotenciaInput {
  readonly scope: IdempotencyScope;
  readonly key: string;
  readonly result: Record<string, unknown>;
}

/**
 * Reserva a chave de idempotência.
 *
 * Devolve `{ novo: false, anterior }` quando a chave já existia — e o caso de
 * uso deve devolver o resultado anterior SEM repetir o efeito. É esta função,
 * apoiada num `UNIQUE` do banco, que faz a diferença entre "conferi antes de
 * escrever" (que perde para concorrência) e "só um consegue escrever".
 */
export async function reservar(
  env: UseCaseEnv,
  input: IdempotenciaInput
): Promise<Result<{ novo: boolean; anterior: Record<string, unknown> }>> {
  const r = await env.repo.reserveIdempotency({
    organizationId: env.auth.organizationId,
    scope: input.scope,
    provider: env.provider.name,
    key: input.key,
    result: input.result,
    createdAt: env.clock.now(),
  });
  if (!r.ok) return r;
  return ok({ novo: r.value.created, anterior: { ...r.value.record.result } });
}

/** Lê a assinatura da organização autorizada, ou falha de forma tipada. */
export async function exigirAssinatura(env: UseCaseEnv) {
  const r = await env.repo.findSubscription(env.auth.organizationId);
  if (!r.ok) return r;
  if (r.value === null) {
    return fail<NonNullable<typeof r.value>>(
      "not_found",
      "nenhuma assinatura para esta organização"
    );
  }
  return ok(r.value);
}
