/**
 * PORTAS DE DEPENDÊNCIA — tudo o que o domínio não pode inventar sozinho
 *
 * Relógio, gerador de identificador e contexto de autorização entram por
 * argumento. Nenhum caso de uso chama `new Date()`, `Date.now()`,
 * `Math.random()`, `crypto.randomUUID()` ou lê `process.env`.
 *
 * ── NÃO É PURISMO ───────────────────────────────────────────────────────────
 *
 * Um `Date.now()` escondido dentro de uma transição torna o resultado
 * dependente do instante da execução: o teste da borda "último milissegundo do
 * trial" deixa de ser possível, e o mesmo código passa e falha conforme a hora
 * em que o CI rodar. Com o relógio injetado, a borda vira um argumento.
 *
 * O mesmo vale para identificadores: `randomUUID()` num caso de uso torna
 * impossível afirmar "reprocessar o evento X produz exatamente o registro Y".
 * A idempotência ficaria indemonstrável.
 *
 * `tests/billing-orchestration-guard.mjs` reprova qualquer reintrodução, e
 * `tests/billing-orchestration-mutation-guard.mjs` prova que a guarda tem
 * dente.
 */

/** Relógio injetado. Devolve o instante em ISO 8601 UTC. */
export interface Clock {
  now(): string;
}

/** Gerador de identificador injetado. Determinístico nos testes. */
export interface IdGenerator {
  next(prefixo: string): string;
}

/**
 * Contexto de autorização — SEMPRE resolvido no servidor.
 *
 * `organizationId` aqui é o que o SERVIDOR resolveu a partir da sessão, nunca
 * o que o cliente enviou. O identificador vindo do cliente entra como
 * `requestedOrganizationId` nos comandos e é comparado com este; divergência é
 * recusa. Ver `assertTenant`.
 */
export interface BillingAuthContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: "owner";
}

/**
 * Origem da ação, para a trilha de auditoria.
 *
 * Distingue o que o proprietário pediu do que um webhook trouxe e do que uma
 * rotina executou. Sem isso, a auditoria registra "o estado mudou" sem dizer
 * quem provocou.
 */
export type BillingActionOrigin = "owner" | "provider_webhook" | "scheduler" | "admin";

/** Dependências comuns a todos os casos de uso. */
export interface BillingDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Relógio fixo. Existe no código de produção, e não só nos testes, porque uma
 * operação precisa usar UM instante do começo ao fim: se cada passo chamasse o
 * relógio, uma transição poderia começar antes e terminar depois de uma borda.
 */
export function fixedClock(instante: string): Clock {
  return { now: () => instante };
}

/**
 * Gerador determinístico por contador. Usado por testes e pelo mock.
 *
 * Não é criptográfico e não deve ser usado para segredo — só para correlação.
 */
export function sequentialIds(semente = 0): IdGenerator {
  let n = semente;
  return {
    next(prefixo: string) {
      n += 1;
      return `${prefixo}_${String(n).padStart(6, "0")}`;
    },
  };
}
