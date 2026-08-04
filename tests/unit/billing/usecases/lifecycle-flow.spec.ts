/**
 * CICLO DE VIDA COMPLETO — trial → plano → cobrança → pagamento → renovação →
 * upgrade → downgrade → cancelamento.
 *
 * Tudo com RELÓGIO EXPLÍCITO. Nenhuma espera real, nenhum `Date.now()`. As
 * bordas — último milissegundo do trial, sétimo dia de tolerância, virada de
 * faixa em 20/21 — só são testáveis porque o tempo é um valor que o teste
 * controla.
 */

import { describe, expect, it } from "vitest";

import { applyProviderEvent, createCheckout } from "@/lib/billing/usecases/payments";
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
  grantCourtesy,
  podeUsarModulo,
  resolveBillingAccess,
  resolveGrandfatheredAccess,
  revokeCourtesy,
  saveGrandfathering,
} from "@/lib/billing/usecases/access";
import { monthlyPriceCents, selectTier, yearlyPriceCents } from "@/lib/billing/plans/pricing";
import { montarBancada, T0 } from "./harness";

const DIA = 86_400_000;

async function trial(
  opcoes: Parameters<typeof montarBancada>[0] = {},
  plano: "essencial" | "completo" = "essencial",
  trabalhadores = 10
) {
  const b = montarBancada(opcoes);
  const r = await startTrial(b.env, {
    plan: plano,
    period: "monthly",
    workerCount: trabalhadores,
    cnpj: "00000000000191",
  });
  expect(r.ok).toBe(true);
  return b;
}

function acesso(b: Awaited<ReturnType<typeof trial>>) {
  return resolveBillingAccess(b.env, { billingEnabled: true });
}

// ─── Trial ─────────────────────────────────────────────────────────────────

describe("trial", () => {
  it("exige CNPJ", async () => {
    const b = montarBancada();
    const r = await startTrial(b.env, {
      plan: "essencial",
      period: "monthly",
      workerCount: 10,
      cnpj: "   ",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("dura exatamente sete dias e usa o plano escolhido", async () => {
    const b = await trial({}, "completo");
    const s = await b.assinatura();

    expect(s?.state).toBe("trialing");
    expect(s?.plan).toBe("completo");

    const estado = await b.repo.readState(b.env.auth.userId, b.env.auth.organizationId);
    expect(estado.ok).toBe(true);
    if (estado.ok && estado.value.subscription) {
      const fim = Date.parse(estado.value.subscription.trialEndsAt ?? "");
      expect(fim - Date.parse(T0)).toBe(7 * DIA);
    }
  });

  it("no último instante antes do fim ainda há acesso normal", async () => {
    const b = await trial();
    b.relogio.avancarMs(7 * DIA - 1);

    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.value.readOnly).toBe(false);
      expect(a.value.reason).toBe("trial_em_curso");
      expect(a.value.free).toBe(true);
    }
  });

  it("no término entra em modo leitura", async () => {
    const b = await trial();
    b.relogio.avancarMs(7 * DIA);

    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.value.readOnly).toBe(true);
      expect(a.value.reason).toBe("modo_leitura_trial_vencido");
    }

    // E a rotina pode registrar a transição.
    const expirado = await expireTrial(b.env);
    expect(expirado.ok).toBe(true);
  });

  it("expireTrial recusa enquanto o trial corre", async () => {
    const b = await trial();
    b.relogio.avancarMs(3 * DIA);

    const r = await expireTrial(b.env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_state");
  });
});

// ─── Upgrade ───────────────────────────────────────────────────────────────

describe("upgrade", () => {
  it("libera recursos na hora, cobra só a diferença e NÃO reinicia o período", async () => {
    const b = await trial();
    const antes = await b.repo.readState(b.env.auth.userId, b.env.auth.organizationId);
    const fimOriginal =
      antes.ok && antes.value.subscription ? antes.value.subscription.currentPeriodEnd : "";

    b.relogio.avancarDias(15);
    const r = await upgradeSubscription(b.env, { plan: "completo" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Diferença proporcional aos dias restantes, nunca o preço cheio.
    const cheio = monthlyPriceCents("completo", "t1_20") ?? 0;
    expect(r.value.prorationCents).toBeGreaterThan(0);
    expect(r.value.prorationCents).toBeLessThan(cheio);

    // A data de renovação é a MESMA: o ciclo já contratado não recomeça.
    expect(r.value.subscription.currentPeriodEnd).toBe(fimOriginal);

    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.value.plan).toBe("completo");
      expect(a.value.features).toContain("risks");
      expect(a.value.features).toContain("complaints");
    }
  });

  it("redução de plano não passa por upgrade", async () => {
    const b = await trial({}, "completo");
    const r = await upgradeSubscription(b.env, { plan: "essencial" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_state");
  });

  it("Enterprise não tem checkout automático", async () => {
    // Acima de 100 trabalhadores a faixa é Enterprise, sem preço de tabela.
    const b = await trial({}, "essencial", 150);
    expect(selectTier(150)).toBe("enterprise");

    const r = await createCheckout(b.env, {
      method: "pix",
      idempotencyKey: "ck-ent",
      customerName: "n",
      customerEmail: "e@t.local",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_state");
    expect(b.chamadasDoProvider()).toBe(0);
  });
});

// ─── Downgrade: os dois momentos ───────────────────────────────────────────

describe("downgrade", () => {
  it("AGENDADO: o Completo continua integral até o fim do período pago", async () => {
    const b = await trial({}, "completo");
    await choosePlan(b.env, { plan: "completo", period: "monthly" });

    const agendado = await scheduleDowngradeUseCase(b.env, { plan: "essencial" });
    expect(agendado.ok).toBe(true);

    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      // Plano vigente ainda é Completo.
      expect(a.value.plan).toBe("completo");
      expect(a.value.readOnly).toBe(false);
      expect(a.value.reason).toBe("downgrade_agendado");
      // NADA é reduzido por antecipação.
      expect(a.value.readOnlyFeatures).toEqual([]);
      expect(podeUsarModulo(a.value, "risks")).toBe(true);
      expect(podeUsarModulo(a.value, "complaints")).toBe(true);
      expect(podeUsarModulo(a.value, "campaigns_automatic")).toBe(true);
    }
  });

  it("EFETIVADO na renovação: Essencial, exclusivos visíveis em leitura, escrita recusada", async () => {
    const b = await trial({}, "completo");
    await choosePlan(b.env, { plan: "completo", period: "monthly" });
    await scheduleDowngradeUseCase(b.env, { plan: "essencial" });

    b.relogio.avancarDias(31);
    const renovado = await renewSubscription(b.env);
    expect(renovado.ok).toBe(true);
    if (renovado.ok) expect(renovado.value.plan).toBe("essencial");

    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.value.plan).toBe("essencial");
      expect(a.value.readOnly).toBe(false);

      // Os dados exclusivos do Completo continuam VISÍVEIS…
      expect(a.value.readOnlyFeatures).toContain("risks");
      expect(a.value.readOnlyFeatures).toContain("complaints");
      expect(a.value.readOnlyFeatures).toContain("campaigns_automatic");

      // …e nenhum registro novo é aceito neles.
      expect(podeUsarModulo(a.value, "risks")).toBe(false);
      expect(podeUsarModulo(a.value, "complaints")).toBe(false);

      // O que é do Essencial continua gravável.
      expect(podeUsarModulo(a.value, "establishments")).toBe(true);
      expect(podeUsarModulo(a.value, "campaigns_manual")).toBe(true);
    }
  });
});

// ─── Trabalhadores, faixas e preços ────────────────────────────────────────

describe("trabalhadores e renovação", () => {
  it("recordWorkerCount registra sem mudar faixa nem preço agora", async () => {
    const b = await trial({}, "essencial", 10);
    const antes = await b.assinatura();
    expect(antes?.tier).toBe("t1_20");

    const r = await recordWorkerCount(b.env, { workerCount: 40 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.workerCount).toBe(40);
      // Faixa e preço INALTERADOS no ciclo corrente.
      expect(r.value.tier).toBe("t1_20");
      expect(r.value.priceSnapshot.amountCents).toBe(monthlyPriceCents("essencial", "t1_20"));
    }
  });

  it("a nova faixa entra em vigor na renovação", async () => {
    const b = await trial({}, "essencial", 10);
    await choosePlan(b.env, { plan: "essencial", period: "monthly" });
    await recordWorkerCount(b.env, { workerCount: 40 });

    b.relogio.avancarDias(31);
    const renovado = await renewSubscription(b.env);

    expect(renovado.ok).toBe(true);
    if (renovado.ok) {
      expect(renovado.value.tier).toBe("t21_50");
      expect(renovado.value.priceSnapshot.amountCents).toBe(
        monthlyPriceCents("essencial", "t21_50")
      );
    }
  });

  it("bordas de faixa 20/21, 50/51 e 100/101", () => {
    expect(selectTier(20)).toBe("t1_20");
    expect(selectTier(21)).toBe("t21_50");
    expect(selectTier(50)).toBe("t21_50");
    expect(selectTier(51)).toBe("t51_100");
    expect(selectTier(100)).toBe("t51_100");
    expect(selectTier(101)).toBe("enterprise");
  });

  it("anual aplica exatamente 10% de desconto sobre doze mensalidades", () => {
    for (const plano of ["essencial", "completo"] as const) {
      for (const faixa of ["t1_20", "t21_50", "t51_100"] as const) {
        const mensal = monthlyPriceCents(plano, faixa);
        const anual = yearlyPriceCents(plano, faixa);
        expect(mensal).not.toBeNull();
        expect(anual).not.toBeNull();
        if (mensal !== null && anual !== null) {
          expect(anual).toBe((mensal * 12 * 9) / 10);
        }
      }
    }
  });

  it("Enterprise não tem preço de tabela", () => {
    expect(monthlyPriceCents("essencial", "enterprise")).toBeNull();
    expect(yearlyPriceCents("completo", "enterprise")).toBeNull();
  });
});

// ─── Inadimplência e cancelamento ──────────────────────────────────────────

describe("inadimplência", () => {
  async function comCobrancaPendente() {
    const b = await trial();
    await choosePlan(b.env, { plan: "essencial", period: "monthly" });
    const c = await createCheckout(b.env, {
      method: "pix",
      idempotencyKey: "ck-1",
      customerName: "n",
      customerEmail: "e@t.local",
    });
    if (!c.ok) throw new Error("checkout falhou na preparação");
    return { b, externo: c.value.charge.externalChargeId };
  }

  it("falha de pagamento abre tolerância com ACESSO NORMAL por sete dias", async () => {
    const { b, externo } = await comCobrancaPendente();
    const quando = b.relogio.now();

    const r = await applyProviderEvent(b.env, {
      externalEventId: "ev-falha",
      externalChargeId: externo,
      eventType: "charge_failed",
      occurredAt: quando,
    });
    expect(r.ok).toBe(true);

    // Sexto dia: ainda normal. Tolerância não é degradação.
    b.relogio.avancarDias(6);
    const durante = await acesso(b);
    expect(durante.ok).toBe(true);
    if (durante.ok) {
      expect(durante.value.readOnly).toBe(false);
      expect(durante.value.reason).toBe("tolerancia_de_pagamento");
    }
  });

  it("depois da tolerância, modo leitura por inadimplência", async () => {
    const { b, externo } = await comCobrancaPendente();
    const quando = b.relogio.now();
    await applyProviderEvent(b.env, {
      externalEventId: "ev-falha",
      externalChargeId: externo,
      eventType: "charge_failed",
      occurredAt: quando,
    });

    b.relogio.avancarDias(8);
    const depois = await acesso(b);
    expect(depois.ok).toBe(true);
    if (depois.ok) {
      expect(depois.value.readOnly).toBe(true);
      expect(depois.value.reason).toBe("modo_leitura_inadimplencia");
    }
  });

  it("pagamento atrasado de ciclo antigo não reativa ciclo novo", async () => {
    const { b, externo } = await comCobrancaPendente();

    // A cobrança é do ciclo corrente; a assinatura avança para o próximo.
    b.relogio.avancarDias(31);
    const renovado = await renewSubscription(b.env);
    expect(renovado.ok).toBe(true);

    const atrasado = await applyProviderEvent(b.env, {
      externalEventId: "ev-atrasado",
      externalChargeId: externo,
      eventType: "charge_paid",
      occurredAt: b.relogio.now(),
    });

    expect(atrasado.ok).toBe(true);
    if (atrasado.ok) expect(atrasado.value.kind).toBe("out_of_order");
  });
});

describe("cancelamento", () => {
  it("mantém acesso até o fim do período e não renova depois", async () => {
    const b = await trial();
    await choosePlan(b.env, { plan: "essencial", period: "monthly" });

    const c = await cancelAtPeriodEnd(b.env);
    expect(c.ok).toBe(true);

    const durante = await acesso(b);
    expect(durante.ok).toBe(true);
    if (durante.ok) {
      expect(durante.value.readOnly).toBe(false);
      expect(durante.value.reason).toBe("cancelamento_agendado");
    }

    b.relogio.avancarDias(31);
    const renovado = await renewSubscription(b.env);
    expect(renovado.ok).toBe(true);
    if (renovado.ok) expect(renovado.value.state).toBe("terminated");

    const depois = await acesso(b);
    expect(depois.ok).toBe(true);
    if (depois.ok) {
      expect(depois.value.readOnly).toBe(true);
      expect(depois.value.reason).toBe("modo_leitura_encerrada");
    }
  });

  it("assinatura terminada não renova", async () => {
    const b = await trial();
    await choosePlan(b.env, { plan: "essencial", period: "monthly" });
    await cancelAtPeriodEnd(b.env);
    b.relogio.avancarDias(31);
    await renewSubscription(b.env);

    const outra = await renewSubscription(b.env);
    expect(outra.ok).toBe(false);
    if (!outra.ok) expect(outra.error.code).toBe("invalid_state");
  });

  it("cancelar duas vezes é recusado", async () => {
    const b = await trial();
    await cancelAtPeriodEnd(b.env);
    const outra = await cancelAtPeriodEnd(b.env);
    expect(outra.ok).toBe(false);
  });
});

// ─── Grandfathering e cortesia ─────────────────────────────────────────────

describe("direito adquirido", () => {
  it("sem data de corte, ninguém é elegível", async () => {
    const b = montarBancada({ grandfatheringCutoff: null });
    const r = await resolveGrandfatheredAccess(b.env, {
      organizationCreatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.eligible).toBe(false);
      expect(r.value.reason).toBe("sem_corte");
    }
  });

  it("organização posterior ao corte não é elegível", async () => {
    const b = montarBancada({ grandfatheringCutoff: "2026-01-01T00:00:00.000Z" });
    const r = await resolveGrandfatheredAccess(b.env, {
      organizationCreatedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reason).toBe("posterior_ao_corte");
  });

  it("pertence à ORGANIZAÇÃO e sobrevive a upgrade e cancelamento", async () => {
    const b = await trial({ grandfatheringCutoff: "2026-01-01T00:00:00.000Z" });
    const gravado = await saveGrandfathering(b.env, { cutoffAt: "2026-01-01T00:00:00.000Z" });
    expect(gravado.ok).toBe(true);
    if (gravado.ok) expect(gravado.value.organizationId).toBe(b.env.auth.organizationId);

    await upgradeSubscription(b.env, { plan: "completo" });
    await cancelAtPeriodEnd(b.env);
    b.relogio.avancarDias(31);
    await renewSubscription(b.env);

    // Terminada a assinatura, o direito adquirido é o PISO: Essencial gratuito.
    const a = await acesso(b);
    expect(a.ok).toBe(true);

    const ainda = await resolveGrandfatheredAccess(b.env, {
      organizationCreatedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(ainda.ok).toBe(true);
    if (ainda.ok) {
      expect(ainda.value.eligible).toBe(true);
      expect(ainda.value.reason).toBe("ja_registrado");
    }
  });

  it("gravar duas vezes é idempotente", async () => {
    const b = await trial({ grandfatheringCutoff: "2026-01-01T00:00:00.000Z" });
    const um = await saveGrandfathering(b.env, { cutoffAt: "2026-01-01T00:00:00.000Z" });
    const dois = await saveGrandfathering(b.env, { cutoffAt: "2026-01-01T00:00:00.000Z" });
    expect(um.ok && dois.ok).toBe(true);
    if (um.ok && dois.ok) expect(dois.value.organizationId).toBe(um.value.organizationId);
  });
});

describe("cortesia", () => {
  it("vale dentro do prazo e concede o plano concedido", async () => {
    const b = montarBancada();
    const c = await grantCourtesy(b.env, { plan: "completo", days: 30, reason: "piloto" });
    expect(c.ok).toBe(true);

    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.value.source).toBe("courtesy");
      expect(a.value.plan).toBe("completo");
      expect(a.value.free).toBe(true);
      expect(a.value.reason).toBe("cortesia_vigente");
    }
  });

  it("vencida deixa de conceder", async () => {
    const b = montarBancada();
    await grantCourtesy(b.env, { plan: "completo", days: 30, reason: "piloto" });

    b.relogio.avancarDias(31);
    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value.source).not.toBe("courtesy");
  });

  it("revogação encerra o benefício e é idempotente", async () => {
    const b = montarBancada();
    const c = await grantCourtesy(b.env, { plan: "completo", days: 30, reason: "piloto" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;

    const um = await revokeCourtesy(b.env, { courtesyId: c.value.id, reason: "fim" });
    expect(um.ok).toBe(true);
    if (um.ok) expect(um.value.revoked).toBe(true);

    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value.source).not.toBe("courtesy");

    // Repetir não é erro: o estado desejado já vale.
    const dois = await revokeCourtesy(b.env, { courtesyId: c.value.id, reason: "fim" });
    expect(dois.ok).toBe(true);
    if (dois.ok) expect(dois.value.revoked).toBe(false);
  });

  it("prazo não positivo é recusado", async () => {
    const b = montarBancada();
    const r = await grantCourtesy(b.env, { plan: "completo", days: 0, reason: "x" });
    expect(r.ok).toBe(false);
  });

  it("organização sem direito algum NÃO recebe Essencial gratuito", async () => {
    const b = montarBancada();
    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.value.source).toBe("none");
      expect(a.value.plan).toBeNull();
      expect(a.value.free).toBe(false);
      expect(a.value.readOnly).toBe(true);
    }
  });
});

// ─── Acesso por plano ──────────────────────────────────────────────────────

describe("recursos por plano", () => {
  const ESSENCIAL = [
    "establishments",
    "departments",
    "users",
    "documents",
    "evidence",
    "action_plans",
    "campaigns_manual",
    "reports_basic",
  ] as const;

  const EXCLUSIVOS_DO_COMPLETO = [
    "risks",
    "complaints",
    "campaigns_automatic",
    "alerts",
    "reports_advanced",
    "history",
    "seal_hash",
    "priority_support",
  ] as const;

  it("Essencial libera os oito módulos base e bloqueia os exclusivos", async () => {
    const b = await trial({}, "essencial");
    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    for (const f of ESSENCIAL) expect(podeUsarModulo(a.value, f)).toBe(true);
    for (const f of EXCLUSIVOS_DO_COMPLETO) expect(podeUsarModulo(a.value, f)).toBe(false);
  });

  it("Completo libera base e exclusivos", async () => {
    const b = await trial({}, "completo");
    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    for (const f of [...ESSENCIAL, ...EXCLUSIVOS_DO_COMPLETO]) {
      expect(podeUsarModulo(a.value, f)).toBe(true);
    }
  });

  it("modo leitura mantém os módulos visíveis e proíbe escrita", async () => {
    const b = await trial({}, "completo");
    b.relogio.avancarDias(8);

    const a = await acesso(b);
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    expect(a.value.readOnly).toBe(true);
    expect(a.value.features.length).toBeGreaterThan(0);
    for (const f of ESSENCIAL) expect(podeUsarModulo(a.value, f)).toBe(false);
  });

  it("com a bandeira desligada, billing não governa nada", async () => {
    const b = await trial();
    const a = await resolveBillingAccess(b.env, { billingEnabled: false });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.value.reason).toBe("flag_desligada");
      expect(a.value.readOnly).toBe(false);
    }
  });
});
