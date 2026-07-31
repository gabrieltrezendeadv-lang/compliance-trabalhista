/**
 * DIREITO ADQUIRIDO E CORTESIA.
 *
 * Cobre os itens 20 a 23 dos testes obrigatórios: grandfathering por
 * organization_id, organização nova do mesmo usuário sem benefício, retorno ao
 * Essencial gratuito após cancelamento de upgrade, e cortesia com prazo e
 * auditoria.
 */

import { describe, expect, it } from "vitest";

import {
  grantCourtesy,
  grantGrandfathering,
  holdsGrandfathering,
  isCourtesyActive,
  isEligibleForGrandfathering,
  resolveEligibility,
} from "@/lib/billing/plans/eligibility";
import { requestCancellation, startTrial } from "@/lib/billing/plans/lifecycle";
import type { Grandfathering, Subscription } from "@/lib/billing/plans/model";

const CORTE = "2026-08-01T00:00:00.000Z";
const ORG_ANTIGA = "org-antiga";
const ORG_NOVA = "org-nova";

const beneficio: Grandfathering = {
  organizationId: ORG_ANTIGA,
  cutoffAt: CORTE,
  grantedAt: CORTE,
};

function assinatura(overrides: Partial<Subscription> = {}): Subscription {
  const base = startTrial({
    organizationId: ORG_ANTIGA,
    plan: "completo",
    tier: "t1_20",
    period: "monthly",
    workerCount: 10,
    cnpj: "00.000.000/0001-91",
    startedAt: "2026-09-01T00:00:00.000Z",
  });
  return {
    ...base,
    state: "active",
    trialEndsAt: null,
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("elegibilidade ao direito adquirido", () => {
  it("organização que já existia na data de corte é elegível", () => {
    expect(isEligibleForGrandfathering("2026-05-10T00:00:00.000Z", CORTE)).toBe(true);
    // Borda: existir EXATAMENTE no instante do corte conta.
    expect(isEligibleForGrandfathering(CORTE, CORTE)).toBe(true);
  });

  it("organização criada depois do corte NÃO é elegível", () => {
    expect(isEligibleForGrandfathering("2026-08-01T00:00:01.000Z", CORTE)).toBe(false);
  });

  it("sem data de corte registrada, ninguém é elegível", () => {
    // A data de corte não foi fixada na Etapa 12A. O padrão tem de NEGAR:
    // conceder gratuidade permanente indevida é irreversível na prática.
    expect(isEligibleForGrandfathering("2020-01-01T00:00:00.000Z", null)).toBe(false);
    expect(grantGrandfathering(ORG_ANTIGA, "2020-01-01T00:00:00.000Z", null, CORTE)).toBeNull();
  });

  it("o registro é idempotente", () => {
    const a = grantGrandfathering(ORG_ANTIGA, "2026-05-10T00:00:00.000Z", CORTE, CORTE);
    const b = grantGrandfathering(ORG_ANTIGA, "2026-05-10T00:00:00.000Z", CORTE, CORTE);
    expect(a).toEqual(b);
  });
});

describe("o benefício pertence à ORGANIZAÇÃO, não ao usuário", () => {
  it("vale para a organização registrada", () => {
    expect(holdsGrandfathering(ORG_ANTIGA, beneficio)).toBe(true);
  });

  it("NÃO vale para outra organização, mesmo do mesmo proprietário", () => {
    // Se o benefício seguisse o usuário, qualquer beneficiado criaria
    // organizações novas indefinidamente e a data de corte não valeria nada.
    expect(holdsGrandfathering(ORG_NOVA, beneficio)).toBe(false);
  });

  it("organização nova não recebe benefício nenhum na resolução", () => {
    const resultado = resolveEligibility({
      organizationId: ORG_NOVA,
      subscription: null,
      grandfathering: beneficio, // registro da OUTRA organização
      courtesy: null,
      now: "2026-09-15T00:00:00.000Z",
    });
    expect(resultado.source).toBe("none");
    expect(resultado.plan).toBeNull();
    expect(resultado.state).toBe("read_only");
  });
});

describe("retorno ao Essencial gratuito", () => {
  it("organização beneficiada sem assinatura fica no Essencial gratuito", () => {
    const r = resolveEligibility({
      organizationId: ORG_ANTIGA,
      subscription: null,
      grandfathering: beneficio,
      courtesy: null,
      now: "2026-09-15T00:00:00.000Z",
    });
    expect(r.source).toBe("grandfathered");
    expect(r.plan).toBe("essencial");
    expect(r.free).toBe(true);
    expect(r.state).toBe("active");
  });

  it("durante o upgrade, quem manda é a assinatura paga", () => {
    const r = resolveEligibility({
      organizationId: ORG_ANTIGA,
      subscription: assinatura(),
      grandfathering: beneficio,
      courtesy: null,
      now: "2026-09-15T00:00:00.000Z",
    });
    expect(r.source).toBe("subscription");
    expect(r.plan).toBe("completo");
    expect(r.free).toBe(false);
  });

  it("cancelado o upgrade, a organização VOLTA ao Essencial gratuito", () => {
    // O direito adquirido é o PISO: não se extingue por ter sido superado.
    // Sem esta regra, a organização cairia em modo leitura — que é exatamente
    // o que "direito adquirido" existe para impedir.
    const cancelada = requestCancellation(assinatura());
    const r = resolveEligibility({
      organizationId: ORG_ANTIGA,
      subscription: cancelada,
      grandfathering: beneficio,
      courtesy: null,
      now: "2026-10-02T00:00:00.000Z", // depois do fim do período pago
    });
    expect(r.source).toBe("grandfathered");
    expect(r.plan).toBe("essencial");
    expect(r.free).toBe(true);
  });

  it("sem direito adquirido, o mesmo cancelamento leva a modo leitura", () => {
    const cancelada = requestCancellation(assinatura());
    const r = resolveEligibility({
      organizationId: ORG_ANTIGA,
      subscription: cancelada,
      grandfathering: null,
      courtesy: null,
      now: "2026-10-02T00:00:00.000Z",
    });
    expect(r.source).toBe("none");
    expect(r.state).toBe("read_only");
  });
});

describe("cortesia administrativa", () => {
  const cortesia = grantCourtesy({
    organizationId: ORG_NOVA,
    plan: "completo",
    startsAt: "2026-09-01T00:00:00.000Z",
    days: 30,
    reason: "Piloto comercial acordado com o cliente",
    grantedBy: "usuario-admin-1",
  });

  it("exige prazo, motivo e autor", () => {
    const base = {
      organizationId: ORG_NOVA,
      plan: "completo" as const,
      startsAt: "2026-09-01T00:00:00.000Z",
      days: 30,
      reason: "motivo",
      grantedBy: "autor",
    };
    // Cortesia sem prazo é plano gratuito disfarçado.
    expect(() => grantCourtesy({ ...base, days: 0 })).toThrow(/prazo/);
    expect(() => grantCourtesy({ ...base, days: -1 })).toThrow(/prazo/);
    expect(() => grantCourtesy({ ...base, days: 1.5 })).toThrow(/prazo/);
    expect(() => grantCourtesy({ ...base, reason: "  " })).toThrow(/motivo/);
    expect(() => grantCourtesy({ ...base, grantedBy: "" })).toThrow(/autor/);
  });

  it("registra prazo, motivo e autor — a trilha de auditoria mínima", () => {
    expect(cortesia.endsAt).toBe("2026-10-01T00:00:00.000Z");
    expect(cortesia.reason).toBe("Piloto comercial acordado com o cliente");
    expect(cortesia.grantedBy).toBe("usuario-admin-1");
  });

  it("vigora do início (inclusive) ao fim (exclusive)", () => {
    expect(isCourtesyActive(ORG_NOVA, cortesia, "2026-08-31T23:59:59.999Z")).toBe(false);
    expect(isCourtesyActive(ORG_NOVA, cortesia, "2026-09-01T00:00:00.000Z")).toBe(true);
    expect(isCourtesyActive(ORG_NOVA, cortesia, "2026-09-30T23:59:59.999Z")).toBe(true);
    expect(isCourtesyActive(ORG_NOVA, cortesia, "2026-10-01T00:00:00.000Z")).toBe(false);
  });

  it("não vaza para outra organização", () => {
    expect(isCourtesyActive(ORG_ANTIGA, cortesia, "2026-09-15T00:00:00.000Z")).toBe(false);
  });

  it("tem precedência sobre a assinatura enquanto vigora, e só enquanto vigora", () => {
    const entrada = {
      organizationId: ORG_NOVA,
      subscription: { ...assinatura(), organizationId: ORG_NOVA },
      grandfathering: null,
      courtesy: cortesia,
    };

    const durante = resolveEligibility({ ...entrada, now: "2026-09-15T00:00:00.000Z" });
    expect(durante.source).toBe("courtesy");
    expect(durante.free).toBe(true);

    const depois = resolveEligibility({ ...entrada, now: "2026-10-01T00:00:00.000Z" });
    expect(depois.source).not.toBe("courtesy");
  });
});
