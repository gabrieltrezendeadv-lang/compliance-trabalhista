/**
 * ERROS TIPADOS DE BILLING — Etapa 12B
 *
 * Nenhum caso de uso lança para o chamador. Todos devolvem `Result<T>`, e a
 * falha é um valor com `code` de um conjunto FECHADO.
 *
 * ── POR QUE RESULT, E NÃO EXCEÇÃO ───────────────────────────────────────────
 *
 * Exceção é invisível na assinatura: nada obriga o chamador a tratá-la, e o
 * TypeScript não ajuda. Num módulo cujo defeito característico é "falhou e
 * mesmo assim autorizou", o tipo precisa forçar a decisão. `Result` faz isso —
 * para ler o valor é preciso passar por `ok`.
 *
 * ── A REGRA QUE ATRAVESSA O ARQUIVO INTEIRO ─────────────────────────────────
 *
 * NENHUM erro é conversível em autorização. Não existe código que signifique
 * "deu errado, mas pode seguir". `repository_unavailable`, `provider_timeout` e
 * `provider_unavailable` são falhas — e falha nega.
 *
 * ── ORÁCULO DE ENUMERAÇÃO ───────────────────────────────────────────────────
 *
 * `not_owner` cobre DELIBERADAMENTE dois casos distintos: a organização não
 * existe, e a organização existe mas é de outro. Distingui-los devolveria ao
 * chamador a informação "esta organização existe", que é exatamente o que um
 * atacante quer descobrir varrendo identificadores.
 */

export type BillingErrorCode =
  /** Sem sessão. */
  | "unauthorized"
  /** Autenticado, mas não é proprietário — cobre também "não existe". */
  | "not_owner"
  /** Organização pedida difere da resolvida no servidor. */
  | "tenant_mismatch"
  | "not_found"
  /** Estado já mudou; a operação não se aplica mais. */
  | "conflict"
  /** A transição pedida não existe a partir do estado atual. */
  | "invalid_state"
  | "invalid_input"
  | "repository_unavailable"
  | "provider_unavailable"
  | "provider_timeout"
  /** Evento já processado — resultado anterior é devolvido. */
  | "duplicate_event"
  /** Evento anterior ao período vigente. */
  | "out_of_order_event"
  /** Configuração proibida no ambiente atual (mock em produção). */
  | "misconfigured";

export class BillingError extends Error {
  readonly code: BillingErrorCode;
  /** Contexto seguro para log. NUNCA carrega credencial nem dado de cartão. */
  readonly details: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: BillingErrorCode,
    message: string,
    details: Record<string, string | number | boolean | null> = {}
  ) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BillingError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(
  code: BillingErrorCode,
  message: string,
  details?: Record<string, string | number | boolean | null>
): Result<T> {
  return { ok: false, error: new BillingError(code, message, details) };
}

/**
 * Converte qualquer coisa lançada num erro tipado de INDISPONIBILIDADE.
 *
 * O `code` é sempre de falha. Não existe caminho aqui que produza sucesso: uma
 * exceção desconhecida é, por definição, algo que não sabemos ter dado certo.
 */
export function fromThrown<T>(
  causa: unknown,
  code: Extract<
    BillingErrorCode,
    "repository_unavailable" | "provider_unavailable" | "provider_timeout"
  >,
  contexto: string
): Result<T> {
  // A mensagem original NÃO é propagada: mensagens de driver costumam conter
  // host, usuário e às vezes a URL de conexão inteira.
  const tipo = causa instanceof Error ? causa.name : typeof causa;
  return fail(code, `${contexto}: falha não recuperável`, { causa: tipo });
}

/** Mensagens para a interface. Nenhuma revela existência de organização. */
export const MENSAGENS_BILLING: Record<BillingErrorCode, string> = {
  unauthorized: "Sessão expirada. Faça login novamente.",
  not_owner: "Somente o proprietário da organização pode administrar a assinatura.",
  tenant_mismatch: "Somente o proprietário da organização pode administrar a assinatura.",
  not_found: "Registro não encontrado.",
  conflict: "O estado da assinatura mudou. Recarregue e tente novamente.",
  invalid_state: "Esta operação não é possível no estado atual da assinatura.",
  invalid_input: "Revise os dados informados.",
  repository_unavailable: "Não foi possível consultar sua assinatura agora. Tente novamente.",
  provider_unavailable: "O meio de pagamento está indisponível. Tente novamente.",
  provider_timeout: "O meio de pagamento demorou a responder. Tente novamente.",
  duplicate_event: "Este evento já foi processado.",
  out_of_order_event: "Evento fora de ordem — ignorado.",
  misconfigured: "Cobrança não está configurada neste ambiente.",
};
