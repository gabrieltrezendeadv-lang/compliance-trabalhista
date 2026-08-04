/**
 * PROVIDER MOCK DETERMINÍSTICO — Etapa 12B
 *
 * Sem rede, sem segredo, sem relógio próprio. Instante e identificador entram
 * por injeção; o mesmo roteiro produz exatamente a mesma sequência de eventos.
 *
 * ── IMPOSSÍVEL EM PRODUÇÃO ──────────────────────────────────────────────────
 *
 * O construtor ABORTA quando `NODE_ENV=production` ou `VERCEL_ENV=production`.
 * Não é aviso, não é log, não é fallback: é exceção no ato da construção. A
 * verificação é feita no CONSTRUTOR, e não no primeiro uso, para que a
 * tentativa falhe no momento em que alguém a escreve — e não meses depois, na
 * primeira cobrança.
 *
 * As duas variáveis são checadas porque respondem perguntas diferentes:
 * `NODE_ENV` é do processo Node, `VERCEL_ENV` é do ambiente de deploy. Um
 * preview da Vercel roda com `NODE_ENV=production` e `VERCEL_ENV=preview`;
 * produção de verdade tem as duas em `production`. Checar só uma deixaria uma
 * porta aberta.
 *
 * ── CENÁRIOS DECLARATIVOS ───────────────────────────────────────────────────
 *
 * O comportamento de cada cobrança é decidido por um roteiro passado na
 * construção, não por acaso. É o que permite escrever "esta cobrança falha, a
 * seguinte expira, a terceira duplica o webhook" e obter exatamente isso.
 */

import { fail, ok, type Result } from "../../core/errors";
import type { IdGenerator } from "../../core/ports";
import type {
  BillingProviderPort,
  ProviderCharge,
  ProviderChargeInput,
  ProviderCustomer,
  ProviderCustomerInput,
  ProviderEvent,
} from "../../core/provider";

/** O que o mock deve fazer com a próxima cobrança criada. */
export type MockScenario =
  /** Cobrança criada e paga quando `simulatePayment` for chamado. */
  | "approve"
  /** Cobrança criada; pagamento recusado. */
  | "decline"
  /** PIX criado e pendente até que o pagamento seja simulado. */
  | "pix_pending"
  /** `createCharge` estoura por tempo — nada é persistido do lado do provider. */
  | "timeout"
  /** `createCharge` falha ANTES de qualquer efeito. */
  | "unavailable_before_persist"
  /** `createCharge` cria a cobrança e SÓ ENTÃO falha em responder. */
  | "unavailable_after_persist";

export interface MockProviderOptions {
  readonly ids: IdGenerator;
  /**
   * Roteiro consumido em ordem, uma entrada por `createCharge`. Esgotado o
   * roteiro, o padrão é `approve`.
   */
  readonly scenarios?: readonly MockScenario[];
  /** Injeção de ambiente, para que o teste do bloqueio não precise mexer no
   *  `process.env` do processo inteiro. */
  readonly env?: { NODE_ENV?: string; VERCEL_ENV?: string };
}

export class MockProviderForbiddenInProductionError extends Error {
  constructor(qual: string) {
    super(
      `BillingProviderMock é proibido em produção (${qual}). ` +
        "Ausência de provider configurado deve ABORTAR, nunca cair no mock."
    );
    this.name = "MockProviderForbiddenInProductionError";
  }
}

interface EstadoCobranca {
  readonly externalChargeId: string;
  status: ProviderCharge["status"];
  readonly amountCents: number;
  readonly pixPayload: string | null;
  readonly cenario: MockScenario;
}

export class BillingProviderMock implements BillingProviderPort {
  readonly name = "mock";

  readonly #ids: IdGenerator;
  readonly #roteiro: MockScenario[];
  readonly #cobrancas = new Map<string, EstadoCobranca>();
  readonly #clientes = new Map<string, string>();
  readonly #chamadas: ProviderChargeInput[] = [];
  /** `chave → recurso externo`, com o fingerprint que o produziu. */
  readonly #porChave = new Map<
    string,
    { fingerprint: string; externalChargeId: string; amountCents: number; pixPayload: string | null }
  >();

  constructor(options: MockProviderOptions) {
    const env = options.env ?? {
      NODE_ENV: process.env.NODE_ENV,
      VERCEL_ENV: process.env.VERCEL_ENV,
    };

    // A recusa é no CONSTRUTOR. Quem tentar instanciar em produção não recebe
    // um objeto degradado — não recebe objeto nenhum.
    if (env.NODE_ENV === "production") {
      throw new MockProviderForbiddenInProductionError("NODE_ENV=production");
    }
    if (env.VERCEL_ENV === "production") {
      throw new MockProviderForbiddenInProductionError("VERCEL_ENV=production");
    }

    this.#ids = options.ids;
    this.#roteiro = [...(options.scenarios ?? [])];
  }

  /**
   * Cliente por ORGANIZAÇÃO, não por chamada.
   *
   * Numa retomada, criar um segundo cliente abandonaria o primeiro no provider
   * — e o identificador gravado no banco deixaria de corresponder ao que existe
   * do outro lado.
   */
  async createCustomer(input: ProviderCustomerInput): Promise<Result<ProviderCustomer>> {
    if (input.cnpj.trim() === "") {
      return fail("invalid_input", "CNPJ é obrigatório para criar cliente");
    }
    const existente = this.#clientes.get(input.organizationId);
    if (existente !== undefined) return ok({ externalCustomerId: existente });

    const novo = this.#ids.next("cus");
    this.#clientes.set(input.organizationId, novo);
    return ok({ externalCustomerId: novo });
  }

  /** Toda tentativa de cobrança, na ordem. É o que os testes contam. */
  get chamadasDeCobranca(): readonly ProviderChargeInput[] {
    return this.#chamadas;
  }

  /** Quantas vezes esta chave foi apresentada ao provider. */
  contagemPorChave(idempotencyKey: string): number {
    return this.#chamadas.filter((c) => c.idempotencyKey === idempotencyKey).length;
  }

  async createCharge(input: ProviderChargeInput): Promise<Result<ProviderCharge>> {
    // Registra ANTES de qualquer validação: o teste precisa contar inclusive as
    // tentativas recusadas.
    this.#chamadas.push(input);

    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return fail("invalid_input", "valor da cobrança precisa ser centavo inteiro positivo");
    }

    // ── IDEMPOTÊNCIA DO LADO DO PROVIDER ──────────────────────────────────
    //
    // `chave + fingerprint → recurso externo`. É esta relação que faz uma
    // retomada devolver a MESMA cobrança em vez de criar a segunda — inclusive
    // quando a primeira tentativa foi `unavailable_after_persist`, em que o
    // recurso existe e o chamador não soube.
    const anterior = this.#porChave.get(input.idempotencyKey);
    if (anterior !== undefined) {
      if (anterior.fingerprint !== input.fingerprint) {
        return fail("conflict", "chave de idempotência reusada com outro pedido");
      }
      return ok({
        externalChargeId: anterior.externalChargeId,
        status: "pending",
        amountCents: anterior.amountCents,
        pixPayload: anterior.pixPayload,
      });
    }

    const cenario = this.#roteiro.shift() ?? "approve";

    if (cenario === "timeout") {
      return fail("provider_timeout", "provider não respondeu a tempo");
    }
    if (cenario === "unavailable_before_persist") {
      return fail("provider_unavailable", "provider indisponível antes de criar a cobrança");
    }

    const externalChargeId = this.#ids.next("chg");
    const pix = input.method === "pix" ? `PIX-${externalChargeId}` : null;

    this.#cobrancas.set(externalChargeId, {
      externalChargeId,
      status: "pending",
      amountCents: input.amountCents,
      pixPayload: pix,
      cenario,
    });

    // Registrado ANTES do desfecho: em `unavailable_after_persist` o recurso
    // externo EXISTE, e é exatamente por isso que a retomada com a mesma chave
    // precisa encontrá-lo aqui em vez de criar outro.
    this.#porChave.set(input.idempotencyKey, {
      fingerprint: input.fingerprint,
      externalChargeId,
      amountCents: input.amountCents,
      pixPayload: pix,
    });

    if (cenario === "unavailable_after_persist") {
      // A cobrança EXISTE do lado do provider, mas o chamador recebe falha.
      // É o cenário que obriga o caso de uso a ser recuperável: reprocessar
      // com a mesma chave não pode criar uma segunda cobrança.
      return fail("provider_unavailable", "provider criou a cobrança e falhou ao responder");
    }

    return ok({
      externalChargeId,
      status: "pending",
      amountCents: input.amountCents,
      pixPayload: pix,
    });
  }

  async getCharge(externalChargeId: string): Promise<Result<ProviderCharge>> {
    const c = this.#cobrancas.get(externalChargeId);
    if (!c) return fail("not_found", "cobrança inexistente no provider");
    return ok({
      externalChargeId: c.externalChargeId,
      status: c.status,
      amountCents: c.amountCents,
      pixPayload: c.pixPayload,
    });
  }

  async cancelCharge(externalChargeId: string): Promise<Result<ProviderCharge>> {
    const c = this.#cobrancas.get(externalChargeId);
    if (!c) return fail("not_found", "cobrança inexistente no provider");
    if (c.status === "paid") {
      return fail("invalid_state", "cobrança já paga não pode ser cancelada");
    }
    c.status = "cancelled";
    return this.getCharge(externalChargeId);
  }

  async simulatePayment(
    externalChargeId: string,
    occurredAt: string
  ): Promise<Result<ProviderEvent>> {
    const c = this.#cobrancas.get(externalChargeId);
    if (!c) return fail("not_found", "cobrança inexistente no provider");
    if (c.cenario === "decline") {
      return fail("invalid_state", "cenário declarado como recusado");
    }
    c.status = "paid";
    return ok({
      eventId: this.#ids.next("evt"),
      type: "charge_paid",
      externalChargeId,
      occurredAt,
      amountCents: c.amountCents,
    });
  }

  async simulateFailure(
    externalChargeId: string,
    occurredAt: string
  ): Promise<Result<ProviderEvent>> {
    const c = this.#cobrancas.get(externalChargeId);
    if (!c) return fail("not_found", "cobrança inexistente no provider");
    c.status = "failed";
    return ok({
      eventId: this.#ids.next("evt"),
      type: "charge_failed",
      externalChargeId,
      occurredAt,
      amountCents: c.amountCents,
    });
  }

  /**
   * Reemite um evento com o MESMO `eventId` — webhook duplicado.
   *
   * Existe para que a duplicata seja produzida pelo provider, como acontece na
   * vida real, e não fabricada pelo teste copiando um objeto.
   */
  duplicate(evento: ProviderEvent): ProviderEvent {
    return { ...evento };
  }
}
