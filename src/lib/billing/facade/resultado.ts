/**
 * RESULTADO DA FACHADA — união fechada, sem exceção virando autorização
 *
 * ── POR QUE UM TIPO PRÓPRIO, E NÃO O `Result` DO DOMÍNIO ────────────────────
 *
 * O domínio já tem `Result<T>` com `BillingErrorCode` fechado, e ele continua
 * valendo lá dentro. A fachada acrescenta DOIS estados que o domínio não tem
 * como conhecer, porque acontecem ANTES de ele ser chamado:
 *
 *   `billing_disabled`   a feature flag está desligada. Não é erro, não é
 *                        negação de permissão: é a etapa inteira não existindo
 *                        para quem chamou. Precisa ser distinguível, senão o
 *                        futuro frontend mostra "erro" onde deveria mostrar
 *                        nada.
 *
 *   `unauthenticated`    não há sessão. O domínio recebe um ator já resolvido e
 *                        não tem vocabulário para a ausência dele.
 *
 * Misturar os dois em `invalid_state` ou `unauthorized` apagaria a diferença
 * exatamente onde ela importa — e é a diferença entre "billing não está no ar"
 * e "você não pode".
 *
 * ── NENHUMA MENSAGEM DE INFRAESTRUTURA ATRAVESSA ────────────────────────────
 *
 * O que sai daqui é código fechado + mensagem escrita à mão. Mensagem de driver
 * carrega host, usuário e às vezes a URL de conexão; mensagem de PostgREST
 * carrega nome de função e schema. Nenhuma das duas chega ao chamador, e
 * `traduzir` é o único caminho de conversão.
 */

import "server-only";

import type { BillingError, BillingErrorCode, Result } from "../core/errors";

/**
 * Códigos que a fachada devolve.
 *
 * É a união do domínio MAIS os dois estados de fronteira. Fechada: um código
 * novo exige tocar aqui, e o compilador cobra os `switch` que dependem dela.
 */
export type FacadeErrorCode = BillingErrorCode | "billing_disabled" | "unauthenticated";

export interface FacadeError {
  readonly code: FacadeErrorCode;
  /** Texto para pessoas. Nunca traz host, usuário, SQL, secret ou PII. */
  readonly message: string;
}

export type FacadeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FacadeError };

export function sucesso<T>(value: T): FacadeResult<T> {
  return { ok: true, value };
}

export function recusa<T>(code: FacadeErrorCode, message: string): FacadeResult<T> {
  return { ok: false, error: { code, message } };
}

/**
 * Mensagens da fachada, uma por código.
 *
 * ── ALHEIO E INEXISTENTE DIZEM A MESMA COISA ────────────────────────────────
 *
 * `not_owner`, `tenant_mismatch` e `not_found` de assinatura convergem para o
 * MESMO texto. Distingui-los entregaria "esta organização existe" a quem varre
 * identificadores — e o banco já toma o mesmo cuidado, em
 * `billing.fn_require_member`. Quebrar a simetria aqui desfaria o cuidado de lá.
 */
const MENSAGENS: Record<FacadeErrorCode, string> = {
  billing_disabled: "Assinaturas não estão disponíveis.",
  unauthenticated: "Sessão expirada. Faça login novamente.",
  unauthorized: "Sessão expirada. Faça login novamente.",
  not_owner: "Somente o proprietário da organização administra a assinatura.",
  tenant_mismatch: "Somente o proprietário da organização administra a assinatura.",
  not_found: "Somente o proprietário da organização administra a assinatura.",
  conflict: "Esta operação já está em andamento ou já foi concluída.",
  invalid_state: "A operação não se aplica ao estado atual da assinatura.",
  invalid_input: "Dados inválidos.",
  repository_unavailable: "Não foi possível concluir agora. Tente novamente.",
  provider_unavailable: "Não foi possível concluir agora. Tente novamente.",
  provider_timeout: "Não foi possível concluir agora. Tente novamente.",
  duplicate_event: "Este evento já foi processado.",
  out_of_order_event: "Este evento é anterior ao período vigente.",
  misconfigured: "Assinaturas não estão disponíveis.",
};

/**
 * Converte o `Result` do domínio no resultado da fachada.
 *
 * A mensagem do domínio é DESCARTADA e substituída pela da tabela acima. É
 * deliberado: `repository_unavailable` do repositório traz o contexto da
 * chamada ("estado de billing: indisponível"), que é útil no log do servidor e
 * não é assunto de quem chamou.
 */
export function traduzir<T>(r: Result<T>): FacadeResult<T> {
  if (r.ok) return sucesso(r.value);
  const erro: BillingError = r.error;
  return recusa(erro.code, MENSAGENS[erro.code]);
}

/** Recusa da fachada com a mensagem canônica do código. */
export function recusaPadrao<T>(code: FacadeErrorCode): FacadeResult<T> {
  return recusa(code, MENSAGENS[code]);
}
