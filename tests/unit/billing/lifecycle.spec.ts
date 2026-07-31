/**
 * CICLO DE VIDA — trial, tolerância, modo leitura, upgrade, downgrade e
 * cancelamento.
 *
 * Cobre os itens 6 a 11 dos testes obrigatórios.
 *
 * Nenhum teste usa relógio falso: todas as funções recebem o instante por
 * argumento. É o que permite fixar as bordas exatas — o minuto antes e o
 * minuto depois de cada vencimento — sem depender de `vi.useFakeTimers`.
 */

import { describe, expect, it } from "vitest";

import {
  applyRenewal,
  applyUpgrade,
  dunningNoticeSchedule,
  readOnlyEndsAt,
  registerPaymentFailure,
  registerPaymentRecovered,
  requestCancellation,
  resolveState,
  scheduleDowngrade,
  startTrial,
  terminate,
  toleranceEndsAt,
  trialEndsAt,
  trialNoticeSchedule,
} from "@/lib/billing/plans/lifecycle";
import type { Subscription } from "@/lib/billing/plans/model";

const INICIO = "2026-08-01T00:00:00.000Z";

function trial(): Subscription {
  return startTrial({
    organizationId: "org-1",
    plan: "essencial",
    tier: "t1_20",
    period: "monthly",
    workerCount: 12,
    cnpj: "00.000.000/0001-91",
    startedAt: INICIO,
  });
}

/** Assinatura paga, período mensal de 01/08 a 01/09 — 31 dias. */
function ativa(): Subscription {
  return {
    ...trial(),
    state: "active",
    trialEndsAt: null,
    currentPeriodStart: "2026-08-01T00:00:00.000Z",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
  };
}

describe("trial de 7 dias", () => {
  it("termina exatamente 7 dias depois do início", () => {
    expect(trialEndsAt(INICIO)).toBe("2026-08-08T00:00:00.000Z");
    expect(trial().trialEndsAt).toBe("2026-08-08T00:00:00.000Z");
  });

  it("exige CNPJ", () => {
    expect(() =>
      startTrial({
        organizationId: "org-1",
        plan: "essencial",
        tier: "t1_20",
        period: "monthly",
        workerCount: 12,
        cnpj: "   ",
        startedAt: INICIO,
      })
    ).toThrow(/CNPJ é obrigatório/);
  });

  it("o cliente testa o plano ESCOLHIDO, com o preço já congelado", () => {
    const t = startTrial({
      organizationId: "org-1",
      plan: "completo",
      tier: "t51_100",
      period: "yearly",
      workerCount: 80,
      cnpj: "00.000.000/0001-91",
      startedAt: INICIO,
    });
    expect(t.plan).toBe("completo");
    expect(t.priceSnapshot.amountCents).toBe(863_892);
  });

  it("continua em trial no último instante, e vira leitura no vencimento", () => {
    const t = trial();
    expect(resolveState(t, "2026-08-07T23:59:59.999Z")).toBe("trialing");
    expect(resolveState(t, "2026-08-08T00:00:00.000Z")).toBe("read_only");
  });

  it("os avisos do trial saem em D−3, D−1 e no encerramento", () => {
    expect(trialNoticeSchedule("2026-08-08T00:00:00.000Z")).toEqual([
      "2026-08-05T00:00:00.000Z",
      "2026-08-07T00:00:00.000Z",
      "2026-08-08T00:00:00.000Z",
    ]);
  });
});

describe("tolerância de 7 dias após falha de pagamento", () => {
  it("termina exatamente 7 dias depois da falha", () => {
    expect(toleranceEndsAt("2026-08-10T00:00:00.000Z")).toBe("2026-08-17T00:00:00.000Z");
  });

  it("dá ACESSO NORMAL durante a janela, e só depois vira leitura", () => {
    const s = registerPaymentFailure(ativa(), "2026-08-10T00:00:00.000Z");
    expect(resolveState(s, "2026-08-10T00:00:00.000Z")).toBe("past_due_tolerance");
    expect(resolveState(s, "2026-08-16T23:59:59.999Z")).toBe("past_due_tolerance");
    expect(resolveState(s, "2026-08-17T00:00:00.000Z")).toBe("read_only");
  });

  it("regularizar o pagamento fecha a janela", () => {
    const s = registerPaymentRecovered(
      registerPaymentFailure(ativa(), "2026-08-10T00:00:00.000Z")
    );
    expect(s.paymentFailedAt).toBeNull();
    expect(resolveState(s, "2026-08-20T00:00:00.000Z")).toBe("active");
  });

  it("os avisos de cobrança saem em D−3, vencimento, D+1, D+4 e D+7", () => {
    expect(dunningNoticeSchedule("2026-08-10T00:00:00.000Z")).toEqual([
      "2026-08-07T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
      "2026-08-11T00:00:00.000Z",
      "2026-08-14T00:00:00.000Z",
      "2026-08-17T00:00:00.000Z",
    ]);
  });
});

describe("modo leitura", () => {
  it("período vencido sem renovação vira leitura", () => {
    expect(resolveState(ativa(), "2026-09-02T00:00:00.000Z")).toBe("read_only");
  });

  it("após o encerramento definitivo seguem 12 meses de modo leitura", () => {
    const s = terminate(ativa());
    expect(resolveState(s, "2027-01-01T00:00:00.000Z")).toBe("terminated");
    expect(readOnlyEndsAt("2026-09-01T00:00:00.000Z")).toBe("2027-09-01T00:00:00.000Z");
  });
});

describe("upgrade — imediato, com diferença proporcional", () => {
  it("troca o plano na hora e cobra o proporcional do que resta", () => {
    const antes = ativa(); // essencial/t1_20 mensal: 9990, período 01/08→01/09
    const { subscription, chargeCents } = applyUpgrade(
      antes,
      { plan: "completo", tier: "t1_20" },
      "2026-08-16T00:00:00.000Z"
    );

    expect(subscription.plan).toBe("completo");
    expect(subscription.priceSnapshot.amountCents).toBe(24_990);
    // Período de 31 dias (01/08→01/09), 16 restantes a partir de 16/08.
    // Diferença 24990 − 9990 = 15000. 15000 × 16 / 31 = 7741,93… → piso 7741.
    // O valor é LITERAL de propósito: repetir a fórmula do código provaria
    // apenas que ela é igual a si mesma.
    expect(chargeCents).toBe(7_741);
  });

  it("NÃO reinicia o período — a renovação continua na mesma data", () => {
    // Reiniciar o período tornaria a cobrança proporcional incoerente: o
    // cliente pagaria a diferença de um período que passaria a durar mais.
    const antes = ativa();
    const { subscription } = applyUpgrade(
      antes,
      { plan: "completo", tier: "t1_20" },
      "2026-08-16T00:00:00.000Z"
    );
    expect(subscription.currentPeriodStart).toBe(antes.currentPeriodStart);
    expect(subscription.currentPeriodEnd).toBe(antes.currentPeriodEnd);
  });

  it("recusa alvo que não é upgrade", () => {
    const caro = applyUpgrade(
      ativa(),
      { plan: "completo", tier: "t1_20" },
      INICIO
    ).subscription;
    expect(() =>
      applyUpgrade(caro, { plan: "essencial", tier: "t1_20" }, INICIO)
    ).toThrow(/não é upgrade/);
  });

  it("recusa Enterprise — sob proposta, sem checkout automático", () => {
    expect(() =>
      applyUpgrade(ativa(), { plan: "completo", tier: "enterprise" }, INICIO)
    ).toThrow(/Enterprise/);
  });
});

describe("downgrade — na renovação, sem crédito retroativo", () => {
  it("não muda nada agora: plano, preço e acesso continuam os mesmos", () => {
    const antes = applyUpgrade(
      ativa(),
      { plan: "completo", tier: "t1_20" },
      INICIO
    ).subscription;

    const agendado = scheduleDowngrade(antes, { plan: "essencial", tier: "t1_20" });

    expect(agendado.plan).toBe("completo");
    expect(agendado.priceSnapshot.amountCents).toBe(24_990);
    expect(agendado.scheduledDowngrade).toEqual({ plan: "essencial", tier: "t1_20" });
    expect(resolveState(agendado, "2026-08-20T00:00:00.000Z")).toBe("active");
  });

  it("só entra em vigor na renovação, com preço novo congelado", () => {
    const agendado = scheduleDowngrade(
      applyUpgrade(ativa(), { plan: "completo", tier: "t1_20" }, INICIO).subscription,
      { plan: "essencial", tier: "t1_20" }
    );

    const renovada = applyRenewal(agendado, "2026-09-01T00:00:00.000Z");

    expect(renovada.plan).toBe("essencial");
    expect(renovada.priceSnapshot.amountCents).toBe(9_990);
    expect(renovada.scheduledDowngrade).toBeNull();
    expect(renovada.currentPeriodStart).toBe("2026-09-01T00:00:00.000Z");
    expect(renovada.currentPeriodEnd).toBe("2026-10-01T00:00:00.000Z");
  });

  it("recusa alvo que não é downgrade", () => {
    expect(() =>
      scheduleDowngrade(ativa(), { plan: "completo", tier: "t51_100" })
    ).toThrow(/não é downgrade/);
  });
});

describe("cancelamento — ao fim do período pago", () => {
  it("mantém acesso normal até o fim do período", () => {
    const s = requestCancellation(ativa());
    expect(resolveState(s, "2026-08-20T00:00:00.000Z")).toBe("cancel_scheduled");
    expect(resolveState(s, "2026-08-31T23:59:59.999Z")).toBe("cancel_scheduled");
  });

  it("vira modo leitura a partir do fim do período — sem apagar dado", () => {
    const s = requestCancellation(ativa());
    expect(resolveState(s, "2026-09-01T00:00:00.000Z")).toBe("read_only");
  });

  it("cancela qualquer downgrade agendado", () => {
    const agendado = scheduleDowngrade(
      applyUpgrade(ativa(), { plan: "completo", tier: "t1_20" }, INICIO).subscription,
      { plan: "essencial", tier: "t1_20" }
    );
    expect(requestCancellation(agendado).scheduledDowngrade).toBeNull();
  });
});

describe("estado derivado, não armazenado", () => {
  it("uma assinatura marcada como ativa mas vencida NÃO continua ativa", () => {
    // É o motivo de o estado ser derivado: se dependesse de um job de
    // transição, uma falha desse job manteria acesso liberado indefinidamente.
    const vencida: Subscription = { ...ativa(), state: "active" };
    expect(vencida.state).toBe("active");
    expect(resolveState(vencida, "2026-12-01T00:00:00.000Z")).toBe("read_only");
  });
});
