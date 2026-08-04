/**
 * PEÇAS COMUNS DOS CASOS DE USO
 *
 * ── O QUE SUMIU DAQUI, E POR QUÊ ────────────────────────────────────────────
 *
 * A versão anterior tinha `auditar()`: os casos de uso gravavam a trilha numa
 * chamada SEPARADA, depois do efeito. Eram duas requisições HTTP, logo duas
 * transações — e "a cobrança foi criada mas a auditoria falhou" era um estado
 * alcançável.
 *
 * Agora a auditoria acontece DENTRO da mesma RPC do efeito, na mesma
 * transação. Não há mais o que orquestrar aqui, e por isso a função deixou de
 * existir em vez de virar um invólucro.
 *
 * ── O QUE PERMANECE ─────────────────────────────────────────────────────────
 *
 * A autorização de fronteira: comparar o que o cliente pediu com o que o
 * servidor resolveu, ANTES de tocar repositório ou provider. O banco revalida
 * depois — as duas checagens são deliberadas, e nenhuma substitui a outra.
 */

import { fail, ok, type Result } from "../core/errors";
import type { BillingAuthContext, BillingDeps } from "../core/ports";
import type { BillingProviderPort } from "../core/provider";
import type {
  BillingRepository,
  ComandoContexto,
  StoredSubscription,
} from "../core/repository";

/** Tudo o que um caso de uso recebe. Nada é buscado de variável global. */
export interface UseCaseEnv extends BillingDeps {
  readonly repo: BillingRepository;
  readonly provider: BillingProviderPort;
  readonly auth: BillingAuthContext;
  /** Conta do provider. Entra na identidade global do recurso externo. */
  readonly providerAccountId: string;
  /** Liga todos os eventos de uma mesma operação. */
  readonly correlationId: string;
}

/** Campos que todo comando aceita do cliente. */
export interface ComandoBase {
  /**
   * A organização que o CLIENTE afirma. Nunca autoriza — só é comparada com a
   * que o servidor resolveu.
   */
  readonly requestedOrganizationId?: string;
}

/**
 * Confere que a organização pedida pelo cliente é a resolvida no servidor.
 *
 * A recusa é `not_owner`, e não `not_found`, mesmo quando a organização não
 * existe. Distinguir os dois casos entregaria ao chamador a informação "esta
 * organização existe" — que é exatamente o que uma varredura de identificadores
 * procura. O banco usa a MESMA mensagem, e o teste de contrato compara as duas
 * para garantir que continue assim.
 */
export function assertTenant<T>(
  auth: BillingAuthContext,
  requestedOrganizationId: string | undefined
): Result<T> | null {
  if (auth.role !== "owner") {
    return fail("not_owner", "somente o proprietário administra a assinatura");
  }
  if (requestedOrganizationId === undefined) return null;
  if (typeof requestedOrganizationId !== "string" || requestedOrganizationId.trim() === "") {
    return fail("invalid_input", "organização inválida");
  }
  if (requestedOrganizationId !== auth.organizationId) {
    return fail("not_owner", "somente o proprietário administra a assinatura");
  }
  return null;
}

/** Contexto de comando, montado a partir do que o servidor resolveu. */
export function contexto(env: UseCaseEnv): ComandoContexto {
  return {
    actorId: env.auth.userId,
    organizationId: env.auth.organizationId,
    correlationId: env.correlationId,
  };
}

/** Lê a assinatura da organização autorizada, ou falha de forma tipada. */
export async function exigirAssinatura(
  env: UseCaseEnv
): Promise<Result<StoredSubscription>> {
  const estado = await env.repo.readState(env.auth.userId, env.auth.organizationId);
  if (!estado.ok) return estado;
  if (estado.value.subscription === null) {
    return fail("not_found", "nenhuma assinatura para esta organização");
  }
  return ok(estado.value.subscription);
}

/**
 * Fingerprint canônico do pedido.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * A chave de idempotência sozinha diz "é a mesma tentativa". Ela NÃO diz "é o
 * mesmo pedido". Sem fingerprint, mandar a mesma chave com outro valor devolve
 * silenciosamente o resultado do primeiro, e o segundo pedido some.
 *
 * ── POR QUE É UM HASH, E NÃO O PEDIDO ───────────────────────────────────────
 *
 * O fingerprint é gravado no banco. Guardar o pedido inteiro colocaria dado de
 * pagamento numa tabela que não precisa dele. O hash basta para comparar, e não
 * reconstrói nada.
 *
 * A canonicalização ordena as chaves: `{a,b}` e `{b,a}` são o MESMO pedido, e
 * precisam produzir o mesmo fingerprint — senão um reenvio com outra ordem de
 * campos viraria conflito falso.
 */
export function fingerprintDe(campos: Readonly<Record<string, string | number>>): string {
  const canonico = Object.keys(campos)
    .sort()
    .map((k) => `${k}=${String(campos[k])}`)
    .join("&");

  // FNV-1a de 32 bits, determinístico e sem dependência. Não é criptográfico e
  // não precisa ser: aqui se compara igualdade de pedido, não se protege
  // segredo.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonico.length; i += 1) {
    h ^= canonico.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fp_${h.toString(16).padStart(8, "0")}`;
}
