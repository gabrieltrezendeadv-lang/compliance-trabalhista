/**
 * IDEMPOTÊNCIA, ORDEM, CONCORRÊNCIA E FALHAS CONTROLADAS.
 *
 * É a seção da 12B em que um defeito custa dinheiro de verdade: cobrança
 * duplicada, pagamento antigo reativando ciclo novo, ou falha de leitura
 * virando autorização.
 *
 * Nenhum teste toca a rede — a armadilha de `tests/setup/no-network.ts` faria
 * a chamada explodir com o alvo na mensagem.
 */

import { describe, expect, it } from "vitest";

import { startTrial, upgradeSubscription } from "@/lib/billing/usecases/subscription";
import {
  createMockCheckout,
  recordPaymentFailed,
  recordPaymentSucceeded,
} from "@/lib/billing/usecases/payments";
import { resolveBillingAccess } from "@/lib/billing/usecases/access";
import {
  BillingProviderMock,
  MockProviderForbiddenInProductionError,
} from "@/lib/billing/providers/mock/deterministic";
import {
  InMemoryBillingRepository,
  InMemoryRepositoryForbiddenInProductionError,
} from "@/lib/billing/repositories/in-memory";
import { sequentialIds } from "@/lib/billing/core/ports";
import { NetworkAccessInTestError } from "../../../setup/no-network";
import { bancada, erro, valor, ORG_A } from "./harness";

const CNPJ = "00.000.000/0001-91";

async function comCobranca(opts: Parameters<typeof bancada>[0] = {}) {
  const b = bancada(opts);
  valor(
    await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: CNPJ,
    })
  );
  const checkout = valor(
    await createMockCheckout(b.env, {
      method: "pix",
      idempotencyKey: "ck-1",
      customerName: "Empresa",
      customerEmail: "fin@x.test",
    })
  );
  return { ...b, checkout };
}

describe("evento duplicado", () => {
  it("não duplica pagamento, snapshot nem transição", async () => {
    const b = await comCobranca();
    const evento = valor(
      await b.provider.simulatePayment(
        b.checkout.charge.externalChargeId,
        "2026-08-03T00:00:00.000Z"
      )
    );

    const primeira = valor(await recordPaymentSucceeded(b.env, evento));
    const snapsAntes = valor(await b.repo.listPriceSnapshots(ORG_A)).length;
    const auditAntes = valor(await b.repo.listAuditEvents(ORG_A)).length;

    // O MESMO evento chega de novo — é o mock que o reemite, como faria um
    // provider de verdade reenviando o webhook.
    const segunda = valor(await recordPaymentSucceeded(b.env, b.provider.duplicate(evento)));

    expect(segunda.state).toBe(primeira.state);
    expect(valor(await b.repo.listPriceSnapshots(ORG_A))).toHaveLength(snapsAntes);
    expect(valor(await b.repo.listAuditEvents(ORG_A))).toHaveLength(auditAntes);

    const cobrancas = valor(await b.repo.listCharges(ORG_A));
    expect(cobrancas).toHaveLength(1);
    expect(cobrancas[0].status).toBe("paid");
  });

  it("checkout repetido com a mesma chave não cria segunda cobrança", async () => {
    const b = await comCobranca();
    const repetido = await createMockCheckout(b.env, {
      method: "pix",
      idempotencyKey: "ck-1",
      customerName: "Empresa",
      customerEmail: "fin@x.test",
    });
    expect(repetido.ok).toBe(true);
    expect(valor(await b.repo.listCharges(ORG_A))).toHaveLength(1);
  });

  it("upgrade repetido com a mesma chave é idempotente e não cobra de novo", async () => {
    const b = bancada();
    valor(
      await startTrial(b.env, {
        plan: "essencial",
        period: "monthly",
        workerCount: 10,
        cnpj: CNPJ,
      })
    );
    b.tempo.set("2026-08-05T00:00:00.000Z");

    const primeira = valor(
      await upgradeSubscription(b.env, { plan: "completo", idempotencyKey: "up-x" })
    );
    const snapsAntes = valor(await b.repo.listPriceSnapshots(ORG_A)).length;

    const segunda = valor(
      await upgradeSubscription(b.env, { plan: "completo", idempotencyKey: "up-x" })
    );

    expect(segunda.subscription.plan).toBe(primeira.subscription.plan);
    expect(valor(await b.repo.listPriceSnapshots(ORG_A))).toHaveLength(snapsAntes);
  });

  it("a chave pertence ao TENANT e ao PROVIDER", async () => {
    const b = await comCobranca();
    const reservada = valor(
      await b.repo.reserveIdempotency({
        organizationId: ORG_A,
        scope: "command",
        provider: "mock",
        key: "ck-1",
        result: {},
        createdAt: "2026-08-01T00:00:00.000Z",
      })
    );
    expect(reservada.created).toBe(false);

    // Outra organização, mesma chave: é uma chave DIFERENTE.
    const outroTenant = valor(
      await b.repo.reserveIdempotency({
        organizationId: "bbbbbbbb-0000-4000-8000-00000000000b",
        scope: "command",
        provider: "mock",
        key: "ck-1",
        result: {},
        createdAt: "2026-08-01T00:00:00.000Z",
      })
    );
    expect(outroTenant.created).toBe(true);

    // Mesmo tenant, outro provider: também diferente.
    const outroProvider = valor(
      await b.repo.reserveIdempotency({
        organizationId: ORG_A,
        scope: "command",
        provider: "outro",
        key: "ck-1",
        result: {},
        createdAt: "2026-08-01T00:00:00.000Z",
      })
    );
    expect(outroProvider.created).toBe(true);
  });
});

describe("concorrência", () => {
  it("duas tentativas simultâneas produzem UM único resultado", async () => {
    const b = await comCobranca();
    const evento = valor(
      await b.provider.simulatePayment(
        b.checkout.charge.externalChargeId,
        "2026-08-03T00:00:00.000Z"
      )
    );

    const [r1, r2] = await Promise.all([
      recordPaymentSucceeded(b.env, evento),
      recordPaymentSucceeded(b.env, b.provider.duplicate(evento)),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Um único efeito: uma cobrança, paga uma vez.
    const cobrancas = valor(await b.repo.listCharges(ORG_A));
    expect(cobrancas).toHaveLength(1);
    expect(valor(await b.repo.listAuditEvents(ORG_A)).filter((e) => e.subject === "payment"))
      .toHaveLength(1);
  });

  it("dois checkouts simultâneos com a mesma chave criam UMA cobrança", async () => {
    const b = bancada();
    valor(
      await startTrial(b.env, {
        plan: "essencial",
        period: "monthly",
        workerCount: 10,
        cnpj: CNPJ,
      })
    );

    await Promise.all([
      createMockCheckout(b.env, {
        method: "pix",
        idempotencyKey: "mesma",
        customerName: "E",
        customerEmail: "e@x.test",
      }),
      createMockCheckout(b.env, {
        method: "pix",
        idempotencyKey: "mesma",
        customerName: "E",
        customerEmail: "e@x.test",
      }),
    ]);

    expect(valor(await b.repo.listCharges(ORG_A))).toHaveLength(1);
  });
});

describe("ordem dos eventos", () => {
  it("pagamento de período ANTIGO não reativa o período atual", async () => {
    const b = await comCobranca();
    const antiga = b.checkout.charge;

    // A assinatura avança para um período posterior ao da cobrança.
    valor(
      await b.repo.updateSubscription(ORG_A, {
        currentPeriodStart: "2026-09-01T00:00:00.000Z",
        currentPeriodEnd: "2026-10-01T00:00:00.000Z",
        state: "read_only",
      })
    );

    const evento = valor(
      await b.provider.simulatePayment(antiga.externalChargeId, "2026-09-15T00:00:00.000Z")
    );
    expect(erro(await recordPaymentSucceeded(b.env, evento))).toBe("out_of_order_event");

    const depois = valor(await b.repo.findSubscription(ORG_A));
    expect(depois?.state).toBe("read_only");
  });

  it("evento anterior ao início da cobrança é recusado", async () => {
    const b = await comCobranca();
    const evento = valor(
      await b.provider.simulatePayment(
        b.checkout.charge.externalChargeId,
        "2026-07-01T00:00:00.000Z"
      )
    );
    expect(erro(await recordPaymentSucceeded(b.env, evento))).toBe("out_of_order_event");
  });

  it("evento de cobrança desconhecida é recusado", async () => {
    const b = await comCobranca();
    expect(
      erro(
        await recordPaymentSucceeded(b.env, {
          eventId: "evt-fantasma",
          type: "charge_paid",
          externalChargeId: "chg_inexistente",
          occurredAt: "2026-08-03T00:00:00.000Z",
          amountCents: 9_990,
        })
      )
    ).toBe("not_found");
  });
});

describe("falhas controladas — nada vira autorização", () => {
  it("repositório indisponível na leitura NEGA o acesso", async () => {
    const b = bancada({ repo: { failAt: ["findSubscription"] } });
    const r = await resolveBillingAccess(b.env);
    expect(erro(r)).toBe("repository_unavailable");
  });

  it("repositório indisponível na auditoria FALHA a operação", async () => {
    // Escrita relevante sem trilha é pior que a escrita não ter acontecido:
    // fica um estado sem explicação.
    const b = bancada({ repo: { failAt: ["appendAuditEvent"] } });
    expect(
      erro(
        await startTrial(b.env, {
          plan: "essencial",
          period: "monthly",
          workerCount: 10,
          cnpj: CNPJ,
        })
      )
    ).toBe("repository_unavailable");
  });

  it("falha ao reservar idempotência NÃO deixa passar o efeito", async () => {
    const b = bancada({ repo: { failAt: ["reserveIdempotency"] } });
    valor(
      await startTrial(b.env, {
        plan: "essencial",
        period: "monthly",
        workerCount: 10,
        cnpj: CNPJ,
      })
    );
    const r = await createMockCheckout(b.env, {
      method: "pix",
      idempotencyKey: "k",
      customerName: "E",
      customerEmail: "e@x.test",
    });
    expect(erro(r)).toBe("repository_unavailable");
    expect(valor(await b.repo.listCharges(ORG_A))).toHaveLength(0);
  });

  it("timeout do provider é erro tipado, e nenhuma cobrança é registrada", async () => {
    const b = bancada({ scenarios: ["timeout"] });
    valor(
      await startTrial(b.env, {
        plan: "essencial",
        period: "monthly",
        workerCount: 10,
        cnpj: CNPJ,
      })
    );
    const r = await createMockCheckout(b.env, {
      method: "pix",
      idempotencyKey: "k-timeout",
      customerName: "E",
      customerEmail: "e@x.test",
    });
    expect(erro(r)).toBe("provider_timeout");
    expect(valor(await b.repo.listCharges(ORG_A))).toHaveLength(0);
  });

  it("provider indisponível ANTES de persistir não deixa resíduo", async () => {
    const b = bancada({ scenarios: ["unavailable_before_persist"] });
    valor(
      await startTrial(b.env, {
        plan: "essencial",
        period: "monthly",
        workerCount: 10,
        cnpj: CNPJ,
      })
    );
    expect(
      erro(
        await createMockCheckout(b.env, {
          method: "pix",
          idempotencyKey: "k-antes",
          customerName: "E",
          customerEmail: "e@x.test",
        })
      )
    ).toBe("provider_unavailable");
    expect(valor(await b.repo.listCharges(ORG_A))).toHaveLength(0);
  });

  it("falha DEPOIS da persistência no provider é recuperável sem duplicar", async () => {
    // O provider criou a cobrança e não conseguiu responder. A repetição com a
    // MESMA chave não pode gerar uma segunda cobrança do lado de cá.
    const b = bancada({ scenarios: ["unavailable_after_persist"] });
    valor(
      await startTrial(b.env, {
        plan: "essencial",
        period: "monthly",
        workerCount: 10,
        cnpj: CNPJ,
      })
    );

    expect(
      erro(
        await createMockCheckout(b.env, {
          method: "pix",
          idempotencyKey: "k-depois",
          customerName: "E",
          customerEmail: "e@x.test",
        })
      )
    ).toBe("provider_unavailable");

    const retentativa = await createMockCheckout(b.env, {
      method: "pix",
      idempotencyKey: "k-depois",
      customerName: "E",
      customerEmail: "e@x.test",
    });
    expect(erro(retentativa)).toBe("duplicate_event");
    expect(valor(await b.repo.listCharges(ORG_A))).toHaveLength(0);
  });

  it("pagamento recusado pelo cenário não marca a cobrança como paga", async () => {
    const b = await comCobranca({ scenarios: ["decline"] });
    const r = await b.provider.simulatePayment(
      b.checkout.charge.externalChargeId,
      "2026-08-03T00:00:00.000Z"
    );
    expect(r.ok).toBe(false);
    expect(valor(await b.repo.listCharges(ORG_A))[0].status).toBe("pending");
  });

  it("falha de pagamento registrada muda o estado da cobrança", async () => {
    const b = await comCobranca();
    const evento = valor(
      await b.provider.simulateFailure(
        b.checkout.charge.externalChargeId,
        "2026-08-03T00:00:00.000Z"
      )
    );
    valor(await recordPaymentFailed(b.env, evento));
    expect(valor(await b.repo.listCharges(ORG_A))[0].status).toBe("failed");
  });
});

describe("mock e repositório em memória são proibidos em produção", () => {
  const ids = sequentialIds();

  it("mock aborta com NODE_ENV=production", () => {
    expect(
      () => new BillingProviderMock({ ids, env: { NODE_ENV: "production" } })
    ).toThrow(MockProviderForbiddenInProductionError);
  });

  it("mock aborta com VERCEL_ENV=production, mesmo com NODE_ENV de teste", () => {
    // Um preview da Vercel roda com NODE_ENV=production e VERCEL_ENV=preview.
    // Checar só uma das duas deixaria uma porta aberta.
    expect(
      () => new BillingProviderMock({ ids, env: { NODE_ENV: "test", VERCEL_ENV: "production" } })
    ).toThrow(MockProviderForbiddenInProductionError);
  });

  it("NODE_ENV=production bloqueia SOZINHO, mesmo num preview da Vercel", () => {
    // A regra é OR, não AND. Consequência declarada: o mock também não é
    // instanciável num preview da Vercel, porque preview roda com
    // NODE_ENV=production. É mais restritivo do que o estritamente necessário,
    // e essa é a direção segura do erro — o mock existe para teste local e CI.
    expect(
      () =>
        new BillingProviderMock({
          ids,
          env: { NODE_ENV: "production", VERCEL_ENV: "preview" },
        })
    ).toThrow(MockProviderForbiddenInProductionError);
  });

  it("mock é permitido em desenvolvimento e em teste", () => {
    expect(
      () => new BillingProviderMock({ ids, env: { NODE_ENV: "test", VERCEL_ENV: "development" } })
    ).not.toThrow();
    expect(
      () => new BillingProviderMock({ ids, env: { NODE_ENV: "development" } })
    ).not.toThrow();
  });

  it("repositório em memória aborta em produção", () => {
    expect(
      () => new InMemoryBillingRepository({ env: { NODE_ENV: "production" } })
    ).toThrow(InMemoryRepositoryForbiddenInProductionError);
    expect(
      () => new InMemoryBillingRepository({ env: { VERCEL_ENV: "production" } })
    ).toThrow(InMemoryRepositoryForbiddenInProductionError);
  });

  it("a recusa é na CONSTRUÇÃO, não no primeiro uso", () => {
    // Falhar no ato de construir faz o erro aparecer onde alguém o escreveu, e
    // não meses depois, na primeira cobrança.
    let instancia: unknown = "não construída";
    try {
      instancia = new BillingProviderMock({ ids, env: { NODE_ENV: "production" } });
    } catch {
      /* esperado */
    }
    expect(instancia).toBe("não construída");
  });
});

describe("a armadilha de rede está armada", () => {
  it("qualquer fetch num teste falha, com o alvo na mensagem", () => {
    expect(() => fetch("https://api.asaas.com/v3/payments")).toThrow(NetworkAccessInTestError);
    expect(() => fetch("https://api.asaas.com/v3/payments")).toThrow(/api\.asaas\.com/);
  });

  it("o provider mock não usa rede em nenhum caminho", async () => {
    const b = await comCobranca();
    // Se qualquer um destes tocasse a rede, a armadilha teria lançado.
    expect(
      (await b.provider.getCharge(b.checkout.charge.externalChargeId)).ok
    ).toBe(true);
    expect(
      (await b.provider.cancelCharge(b.checkout.charge.externalChargeId)).ok
    ).toBe(true);
  });
});
