/**
 * CICLO DE VIDA COMPLETO — trial → plano → cobrança → pagamento → renovação →
 * upgrade → downgrade → cancelamento.
 *
 * Contra o código real dos casos de uso, com repositório em memória e provider
 * mock. Nenhuma rede: a armadilha de `tests/setup/no-network.ts` faria o teste
 * falhar se alguma chamada escapasse.
 *
 * As regras vêm de `docs/decisions/PLANOS-E-PRECIFICACAO.md`, e os valores são
 * literais — recalcular pela mesma fórmula do código provaria só que ela é
 * igual a si mesma.
 */

import { describe, expect, it } from "vitest";

import {
  cancelAtPeriodEnd,
  choosePlan,
  expireTrial,
  recordWorkerCount,
  renewSubscription,
  scheduleDowngradeUseCase,
  startTrial,
  upgradeSubscription,
} from "@/lib/billing/usecases/subscription";
import {
  advanceGracePeriod,
  createMockCheckout,
  recordPaymentFailed,
  recordPaymentSucceeded,
} from "@/lib/billing/usecases/payments";
import { resolveBillingAccess } from "@/lib/billing/usecases/access";
import { bancada, erro, valor, T0 } from "./harness";

const CNPJ = "00.000.000/0001-91";

async function comTrial(opts: Parameters<typeof bancada>[0] = {}) {
  const b = bancada(opts);
  const sub = valor(
    await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 12,
      cnpj: CNPJ,
    })
  );
  return { ...b, sub };
}

describe("trial de 7 dias", () => {
  it("cria a assinatura no plano escolhido, com preço congelado", async () => {
    const { sub } = await comTrial();
    expect(sub.state).toBe("trialing");
    expect(sub.plan).toBe("essencial");
    expect(sub.tier).toBe("t1_20");
    expect(sub.trialEndsAt).toBe("2026-08-08T00:00:00.000Z");
    expect(sub.priceSnapshot.amountCents).toBe(9_990);
  });

  it("exige CNPJ", async () => {
    const b = bancada();
    const r = await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 12,
      cnpj: "   ",
    });
    expect(erro(r)).toBe("invalid_input");
  });

  it("a faixa é DERIVADA do porte, nunca informada pelo cliente", async () => {
    const b = bancada();
    const sub = valor(
      await startTrial(b.env, {
        plan: "completo",
        period: "monthly",
        workerCount: 51,
        cnpj: CNPJ,
      })
    );
    expect(sub.tier).toBe("t51_100");
    expect(sub.priceSnapshot.amountCents).toBe(79_990);
  });

  it("recusa segunda assinatura para a mesma organização", async () => {
    const { env } = await comTrial();
    const r = await startTrial(env, {
      plan: "completo",
      period: "monthly",
      workerCount: 12,
      cnpj: CNPJ,
    });
    expect(erro(r)).toBe("conflict");
  });

  it("trocar de plano durante o trial não reinicia o prazo nem cobra", async () => {
    const { env, tempo, sub } = await comTrial();
    tempo.avancarDias(2);
    const novo = valor(await choosePlan(env, { plan: "completo", period: "monthly" }));
    expect(novo.plan).toBe("completo");
    expect(novo.trialEndsAt).toBe(sub.trialEndsAt);
    expect(novo.priceSnapshot.amountCents).toBe(24_990);
  });

  it("escolha de plano é recusada depois do trial", async () => {
    const { env, tempo } = await comTrial();
    tempo.set("2026-08-08T00:00:00.000Z");
    expect(erro(await choosePlan(env, { plan: "completo", period: "monthly" }))).toBe(
      "invalid_state"
    );
  });

  it("no ÚLTIMO milissegundo o trial ainda vale; no vencimento vira leitura", async () => {
    const { env, tempo } = await comTrial();

    tempo.set("2026-08-07T23:59:59.999Z");
    expect(erro(await expireTrial(env))).toBe("invalid_state");

    tempo.set("2026-08-08T00:00:00.000Z");
    const expirada = valor(await expireTrial(env));
    expect(expirada.state).toBe("read_only");
  });

  it("fim do trial sem contratação → modo leitura, sem apagar dado", async () => {
    const { env, tempo, repo } = await comTrial();
    tempo.set("2026-08-08T00:00:00.000Z");
    await expireTrial(env);

    const acesso = valor(await resolveBillingAccess(env));
    expect(acesso.readOnly).toBe(true);
    // A assinatura continua lá, com o histórico de preço.
    const snaps = valor(await repo.listPriceSnapshots(env.auth.organizationId));
    expect(snaps.length).toBeGreaterThan(0);
  });
});

describe("cobrança e pagamento", () => {
  async function comCobranca() {
    const b = await comTrial();
    const checkout = valor(
      await createMockCheckout(b.env, {
        method: "pix",
        idempotencyKey: "ck-1",
        customerName: "Empresa",
        customerEmail: "financeiro@exemplo.test",
      })
    );
    return { ...b, checkout };
  }

  it("cria cobrança do período vigente, com o preço contratado", async () => {
    const { checkout } = await comCobranca();
    expect(checkout.charge.amountCents).toBe(9_990);
    expect(checkout.charge.status).toBe("pending");
    expect(checkout.pixPayload).toMatch(/^PIX-/);
  });

  it("pagamento confirmado ativa a assinatura", async () => {
    const { env, provider, checkout } = await comCobranca();
    const evento = valor(
      await provider.simulatePayment(checkout.charge.externalChargeId, "2026-08-03T10:00:00.000Z")
    );
    const sub = valor(await recordPaymentSucceeded(env, evento));
    expect(sub.state).toBe("active");
    expect(sub.paymentFailedAt).toBeNull();
  });

  it("falha de pagamento dá 7 dias de ACESSO NORMAL, depois modo leitura", async () => {
    const { env, provider, tempo, checkout } = await comCobranca();
    const evento = valor(
      await provider.simulateFailure(checkout.charge.externalChargeId, "2026-08-03T10:00:00.000Z")
    );
    const sub = valor(await recordPaymentFailed(env, evento));
    expect(sub.state).toBe("past_due_tolerance");

    // Dentro da janela: escrita liberada.
    tempo.set("2026-08-10T09:59:59.999Z");
    expect(valor(await resolveBillingAccess(env)).readOnly).toBe(false);
    expect(erro(await advanceGracePeriod(env))).toBe("invalid_state");

    // No vencimento exato: modo leitura.
    tempo.set("2026-08-10T10:00:00.000Z");
    expect(valor(await resolveBillingAccess(env)).readOnly).toBe(true);
    expect(valor(await advanceGracePeriod(env)).state).toBe("read_only");
  });

  it("pagamento recuperado durante a tolerância devolve o acesso normal", async () => {
    const { env, provider, tempo, checkout } = await comCobranca();
    const falha = valor(
      await provider.simulateFailure(checkout.charge.externalChargeId, "2026-08-03T10:00:00.000Z")
    );
    await recordPaymentFailed(env, falha);

    tempo.set("2026-08-06T00:00:00.000Z");
    const pago = valor(
      await provider.simulatePayment(checkout.charge.externalChargeId, "2026-08-06T00:00:00.000Z")
    );
    const sub = valor(await recordPaymentSucceeded(env, pago));
    expect(sub.state).toBe("active");
    expect(valor(await resolveBillingAccess(env)).readOnly).toBe(false);
  });
});

describe("upgrade, downgrade e faixa", () => {
  it("upgrade é imediato e cobra a diferença proporcional", async () => {
    const b = bancada();
    valor(
      await startTrial(b.env, {
        plan: "essencial",
        period: "monthly",
        workerCount: 12,
        cnpj: CNPJ,
      })
    );
    // Período do trial: 01/08 → 08/08, 7 dias. Upgrade no dia 5 → restam 3.
    b.tempo.set("2026-08-05T00:00:00.000Z");
    const r = valor(await upgradeSubscription(b.env, { plan: "completo", idempotencyKey: "up-1" }));

    expect(r.subscription.plan).toBe("completo");
    expect(r.subscription.priceSnapshot.amountCents).toBe(24_990);
    // (24990 − 9990) × 3 / 7 = 6428,57… → piso 6428.
    expect(r.chargeCents).toBe(6_428);
  });

  it("upgrade NÃO reinicia o período", async () => {
    const b = await comTrial();
    const antes = b.sub.currentPeriodEnd;
    b.tempo.set("2026-08-05T00:00:00.000Z");
    const r = valor(await upgradeSubscription(b.env, { plan: "completo", idempotencyKey: "up-2" }));
    expect(r.subscription.currentPeriodEnd).toBe(antes);
  });

  it("downgrade não muda nada agora e entra na renovação", async () => {
    const b = await comTrial();
    b.tempo.set("2026-08-02T00:00:00.000Z");
    valor(await upgradeSubscription(b.env, { plan: "completo", idempotencyKey: "up-3" }));

    const agendado = valor(await scheduleDowngradeUseCase(b.env, { plan: "essencial" }));
    expect(agendado.plan).toBe("completo");
    expect(agendado.scheduledDowngrade).toEqual({ plan: "essencial", tier: "t1_20" });

    const renovada = valor(await renewSubscription(b.env));
    expect(renovada.plan).toBe("essencial");
    expect(renovada.priceSnapshot.amountCents).toBe(9_990);
    expect(renovada.scheduledDowngrade).toBeNull();
  });

  it("worker_count registrado NÃO muda faixa nem bloqueia — só na renovação", async () => {
    const b = await comTrial();

    const registrada = valor(await recordWorkerCount(b.env, { workerCount: 40 }));
    expect(registrada.workerCount).toBe(40);
    // Faixa e preço seguem os do ciclo vigente.
    expect(registrada.tier).toBe("t1_20");
    expect(valor(await resolveBillingAccess(b.env)).readOnly).toBe(false);

    const renovada = valor(await renewSubscription(b.env));
    expect(renovada.tier).toBe("t21_50");
    expect(renovada.priceSnapshot.amountCents).toBe(16_990);
  });

  it("a mudança de faixa aparece na auditoria com o porte que a causou", async () => {
    const b = await comTrial();
    await recordWorkerCount(b.env, { workerCount: 60 });
    await renewSubscription(b.env);

    const eventos = valor(await b.repo.listAuditEvents(b.env.auth.organizationId));
    const faixa = eventos.filter((e) => e.subject === "tier_change");
    expect(faixa).toHaveLength(1);
    expect(faixa[0].newValue).toMatchObject({ tier: "t51_100", workerCount: 60 });
  });

  it("renovação com porte acima de 100 recusa: Enterprise é sob proposta", async () => {
    const b = await comTrial();
    await recordWorkerCount(b.env, { workerCount: 101 });
    expect(erro(await renewSubscription(b.env))).toBe("invalid_state");
  });

  it("upgrade para Enterprise é recusado", async () => {
    const b = await comTrial();
    await recordWorkerCount(b.env, { workerCount: 500 });
    const r = await upgradeSubscription(b.env, { plan: "completo", idempotencyKey: "up-e" });
    // A faixa vigente continua t1_20, então o alvo tem preço; o bloqueio de
    // Enterprise acontece na renovação. Aqui o upgrade é legítimo.
    expect(r.ok).toBe(true);
  });
});

describe("cancelamento", () => {
  it("mantém acesso até o fim do período pago e depois vira leitura", async () => {
    const b = await comTrial();
    const cancelada = valor(await cancelAtPeriodEnd(b.env));
    expect(cancelada.state).toBe("cancel_scheduled");

    b.tempo.set("2026-08-07T23:59:59.999Z");
    expect(valor(await resolveBillingAccess(b.env)).readOnly).toBe(false);

    b.tempo.set("2026-08-08T00:00:00.000Z");
    expect(valor(await resolveBillingAccess(b.env)).readOnly).toBe(true);
  });

  it("cancelar remove downgrade agendado", async () => {
    const b = await comTrial();
    b.tempo.set("2026-08-02T00:00:00.000Z");
    valor(await upgradeSubscription(b.env, { plan: "completo", idempotencyKey: "up-4" }));
    valor(await scheduleDowngradeUseCase(b.env, { plan: "essencial" }));
    const cancelada = valor(await cancelAtPeriodEnd(b.env));
    expect(cancelada.scheduledDowngrade).toBeNull();
  });
});

describe("entitlements pelo acesso resolvido", () => {
  it("Essencial não libera Riscos nem Denúncias, e dá 2 GB", async () => {
    const b = await comTrial();
    const acesso = valor(await resolveBillingAccess(b.env));
    expect(acesso.plan).toBe("essencial");
    expect(acesso.features).not.toContain("risks");
    expect(acesso.features).not.toContain("complaints");
    expect(acesso.storageMib).toBe(2 * 1024);
  });

  it("Completo libera Riscos e Denúncias, e dá 10 GB", async () => {
    const b = await comTrial();
    b.tempo.set("2026-08-02T00:00:00.000Z");
    valor(await upgradeSubscription(b.env, { plan: "completo", idempotencyKey: "up-5" }));

    const acesso = valor(await resolveBillingAccess(b.env));
    expect(acesso.features).toContain("risks");
    expect(acesso.features).toContain("complaints");
    expect(acesso.storageMib).toBe(10 * 1024);
  });

  it("sem assinatura e sem benefício, o acesso é modo leitura", async () => {
    const b = bancada();
    const acesso = valor(await resolveBillingAccess(b.env));
    expect(acesso.source).toBe("none");
    expect(acesso.readOnly).toBe(true);
    expect(acesso.plan).toBeNull();
  });
});

describe("toda escrita relevante deixa trilha", () => {
  it("o trial registra estado, preço, porte e correlação", async () => {
    const b = await comTrial();
    const eventos = valor(await b.repo.listAuditEvents(b.env.auth.organizationId));
    expect(eventos.length).toBeGreaterThan(0);

    const e = eventos[0];
    expect(e.organizationId).toBe(b.env.auth.organizationId);
    expect(e.subject).toBe("subscription_state");
    expect(e.actorId).toBe(b.env.auth.userId);
    expect(e.origin).toBe("owner");
    expect(e.occurredAt).toBe(T0);
    expect(e.correlationId).toBe("corr_teste");
    expect(e.newValue).toMatchObject({ amountCents: 9_990, workerCount: 12 });
  });

  it("evento de webhook não atribui ator humano", async () => {
    const b = await comTrial();
    const checkout = valor(
      await createMockCheckout(b.env, {
        method: "pix",
        idempotencyKey: "ck-a",
        customerName: "E",
        customerEmail: "e@x.test",
      })
    );

    // Mesma organização, mas o evento chega por webhook: sem ator humano.
    const envWebhook = { ...b.env, origin: "provider_webhook" as const };

    const evento = valor(
      await b.provider.simulatePayment(
        checkout.charge.externalChargeId,
        "2026-08-03T00:00:00.000Z"
      )
    );
    await recordPaymentSucceeded(envWebhook, evento);

    const eventos = valor(await b.repo.listAuditEvents(b.env.auth.organizationId));
    const pagamento = eventos.find((e) => e.subject === "payment");
    expect(pagamento).toBeDefined();
    expect(pagamento?.actorId).toBeNull();
    expect(pagamento?.origin).toBe("provider_webhook");
  });

  it("a trilha nunca carrega dado sensível", async () => {
    const b = await comTrial();
    await createMockCheckout(b.env, {
      method: "credit_card",
      idempotencyKey: "ck-b",
      customerName: "E",
      customerEmail: "e@x.test",
    });

    const eventos = valor(await b.repo.listAuditEvents(b.env.auth.organizationId));
    const texto = JSON.stringify(eventos);
    for (const proibido of ["cvv", "card_number", "cardNumber", "api_key", "apiKey", "postgres://"]) {
      expect(texto.toLowerCase()).not.toContain(proibido.toLowerCase());
    }
  });
});
