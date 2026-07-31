/**
 * PREÇOS E FAIXAS — contra o código real, sem banco e sem relógio.
 *
 * Cobre os itens 1 a 5 dos testes obrigatórios da Etapa 12A: limites de faixa,
 * preços mensais, totais anuais, arredondamento exclusivamente em centavos e
 * pró-rata.
 *
 * ── POR QUE OS VALORES SÃO LITERAIS ─────────────────────────────────────────
 *
 * As asserções repetem os números da tabela aprovada em vez de recalculá-los
 * pela fórmula. Um teste que aplicasse a mesma fórmula do código provaria
 * apenas que a fórmula é igual a si mesma: qualquer erro nela apareceria nos
 * dois lados e passaria. Os literais vêm de
 * docs/decisions/PLANOS-E-PRECIFICACAO.md §1, que é o documento aprovado.
 */

import { describe, expect, it } from "vitest";

import { PRICES, TIERS } from "@/lib/billing/plans/catalog";
import {
  addMonths,
  assertIntegerCents,
  capturePriceSnapshot,
  daysBetween,
  monthlyPriceCents,
  nextRenewalAt,
  priceCents,
  prorationCents,
  requiresQuote,
  selectTier,
  yearlyPriceCents,
  yearlySavingsCents,
} from "@/lib/billing/plans/pricing";
import type { PlanSlug, TierSlug } from "@/lib/billing/plans/model";

describe("seleção de faixa", () => {
  // As BORDAS são onde o erro de faixa custa dinheiro: um trabalhador a mais
  // muda o preço em dezenas de reais por mês. Cada limite é fixado nas duas
  // pontas, e não por amostragem no meio da faixa.
  const bordas: Array<[number, TierSlug]> = [
    [1, "t1_20"],
    [20, "t1_20"],
    [21, "t21_50"],
    [50, "t21_50"],
    [51, "t51_100"],
    [100, "t51_100"],
    [101, "enterprise"],
  ];

  for (const [trabalhadores, esperada] of bordas) {
    it(`${trabalhadores} trabalhador(es) → ${esperada}`, () => {
      expect(selectTier(trabalhadores)).toBe(esperada);
    });
  }

  it("acima de 100 exige proposta comercial; as demais faixas, não", () => {
    expect(requiresQuote("enterprise")).toBe(true);
    expect(requiresQuote("t1_20")).toBe(false);
    expect(requiresQuote("t21_50")).toBe(false);
    expect(requiresQuote("t51_100")).toBe(false);
  });

  it("recusa entrada inválida em vez de escolher uma faixa qualquer", () => {
    // Escolher uma faixa "por perto" para entrada inválida cobraria o valor
    // errado em silêncio. Recusar é a única saída honesta.
    expect(() => selectTier(0)).toThrow(/ao menos 1/);
    expect(() => selectTier(-3)).toThrow(/ao menos 1/);
    expect(() => selectTier(12.5)).toThrow(/inteiro/);
    expect(() => selectTier(20.0001)).toThrow(/inteiro/);
    expect(() => selectTier(null as unknown as number)).toThrow(/inteiro/);
    expect(() => selectTier(undefined as unknown as number)).toThrow(/inteiro/);
    expect(() => selectTier(NaN)).toThrow(/inteiro/);
    expect(() => selectTier(Infinity)).toThrow(/inteiro/);
    expect(() => selectTier(-Infinity)).toThrow(/inteiro/);
    expect(() => selectTier("30" as unknown as number)).toThrow(/inteiro/);
  });

  it("valores excessivos caem em Enterprise, sem estourar", () => {
    expect(selectTier(1_000_000)).toBe("enterprise");
    expect(selectTier(Number.MAX_SAFE_INTEGER)).toBe("enterprise");
  });

  it("as faixas cobrem 1..∞ sem lacuna e sem sobreposição", () => {
    const ordenadas = [...TIERS].sort((a, b) => a.minWorkers - b.minWorkers);
    expect(ordenadas[0].minWorkers).toBe(1);
    expect(ordenadas.at(-1)?.maxWorkers).toBeNull();
    for (let i = 1; i < ordenadas.length; i += 1) {
      expect(ordenadas[i].minWorkers).toBe((ordenadas[i - 1].maxWorkers ?? 0) + 1);
    }
  });
});

describe("preços mensais", () => {
  const tabela: Array<[PlanSlug, TierSlug, number]> = [
    ["essencial", "t1_20", 9_990],
    ["essencial", "t21_50", 16_990],
    ["essencial", "t51_100", 34_990],
    ["completo", "t1_20", 24_990],
    ["completo", "t21_50", 39_990],
    ["completo", "t51_100", 79_990],
  ];

  for (const [plano, faixa, centavos] of tabela) {
    it(`${plano}/${faixa} = ${centavos} centavos`, () => {
      expect(monthlyPriceCents(plano, faixa)).toBe(centavos);
      expect(priceCents(plano, faixa, "monthly")).toBe(centavos);
    });
  }

  it("Enterprise não tem preço de tabela — nulo, e não zero", () => {
    // Zero seria um preço VÁLIDO e passaria por qualquer checkout. Nulo não.
    expect(monthlyPriceCents("essencial", "enterprise")).toBeNull();
    expect(monthlyPriceCents("completo", "enterprise")).toBeNull();
  });
});

describe("preços anuais", () => {
  const tabela: Array<[PlanSlug, TierSlug, number]> = [
    ["essencial", "t1_20", 107_892],
    ["essencial", "t21_50", 183_492],
    ["essencial", "t51_100", 377_892],
    ["completo", "t1_20", 269_892],
    ["completo", "t21_50", 431_892],
    ["completo", "t51_100", 863_892],
  ];

  for (const [plano, faixa, centavos] of tabela) {
    it(`${plano}/${faixa} = ${centavos} centavos`, () => {
      expect(yearlyPriceCents(plano, faixa)).toBe(centavos);
      expect(priceCents(plano, faixa, "yearly")).toBe(centavos);
    });
  }

  it("o anual é exatamente 12 mensalidades com 10% de desconto", () => {
    for (const [plano, faixa] of tabela.map(([p, t]) => [p, t] as const)) {
      const mensal = monthlyPriceCents(plano, faixa) as number;
      expect(yearlyPriceCents(plano, faixa)).toBe((mensal * 12 * 9) / 10);
    }
  });

  it("a economia anual equivale a 1,2 mensalidade", () => {
    for (const [plano, faixa] of tabela.map(([p, t]) => [p, t] as const)) {
      const mensal = monthlyPriceCents(plano, faixa) as number;
      expect(yearlySavingsCents(plano, faixa)).toBe(mensal * 12 - ((mensal * 12 * 9) / 10));
    }
  });

  it("Enterprise não tem anual", () => {
    expect(yearlyPriceCents("essencial", "enterprise")).toBeNull();
    expect(yearlySavingsCents("completo", "enterprise")).toBeNull();
  });
});

describe("arredondamento — exclusivamente em centavos inteiros", () => {
  it("todo preço do catálogo é inteiro", () => {
    for (const entrada of PRICES) {
      for (const valor of [entrada.monthlyCents, entrada.yearlyCents]) {
        if (valor !== null) expect(Number.isInteger(valor)).toBe(true);
      }
    }
  });

  it("todo anual calculado é inteiro, sem resto de divisão", () => {
    for (const entrada of PRICES) {
      if (entrada.monthlyCents === null) continue;
      expect((entrada.monthlyCents * 12 * 9) % 10).toBe(0);
      expect(Number.isInteger(yearlyPriceCents(entrada.plan, entrada.tier))).toBe(true);
    }
  });

  it("a rede de segurança recusa valor fracionário e negativo", () => {
    // Se algum dia um centavo fracionário escapar, tem de FALHAR ALTO, e não
    // ser arredondado em silêncio por quem consumir o valor.
    expect(() => assertIntegerCents(99.5, "teste")).toThrow(/centavo inteiro/);
    expect(() => assertIntegerCents(0.1 + 0.2, "teste")).toThrow(/centavo inteiro/);
    expect(() => assertIntegerCents(-1, "teste")).toThrow(/negativo/);
    expect(assertIntegerCents(0, "teste")).toBe(0);
  });
});

describe("snapshot de preço", () => {
  it("congela valor, catálogo e instante", () => {
    const snap = capturePriceSnapshot(
      "completo",
      "t21_50",
      "yearly",
      "2026-08-01T00:00:00.000Z"
    );
    expect(snap.amountCents).toBe(431_892);
    expect(snap.capturedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(snap.catalogVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("o objeto é congelado — não dá para reescrever o preço contratado", () => {
    const snap = capturePriceSnapshot("essencial", "t1_20", "monthly", "2026-08-01T00:00:00.000Z");
    expect(Object.isFrozen(snap)).toBe(true);
    expect(() => {
      (snap as { amountCents: number }).amountCents = 1;
    }).toThrow();
    expect(snap.amountCents).toBe(9_990);
  });

  it("Enterprise não gera snapshot — não passa por checkout automático", () => {
    expect(() =>
      capturePriceSnapshot("completo", "enterprise", "monthly", "2026-08-01T00:00:00.000Z")
    ).toThrow(/sob proposta/);
  });
});

describe("pró-rata do upgrade", () => {
  const periodo = {
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-08-31T00:00:00.000Z", // 30 dias
  };

  it("cobra a diferença inteira quando o upgrade é no início do período", () => {
    expect(
      prorationCents({
        ...periodo,
        currentAmountCents: 9_990,
        targetAmountCents: 24_990,
        changeAt: periodo.periodStart,
      })
    ).toBe(15_000);
  });

  it("cobra metade quando restam 15 dos 30 dias", () => {
    expect(
      prorationCents({
        ...periodo,
        currentAmountCents: 9_990,
        targetAmountCents: 24_990,
        changeAt: "2026-08-16T00:00:00.000Z",
      })
    ).toBe(7_500);
  });

  it("não cobra nada quando o período já acabou", () => {
    expect(
      prorationCents({
        ...periodo,
        currentAmountCents: 9_990,
        targetAmountCents: 24_990,
        changeAt: "2026-09-10T00:00:00.000Z",
      })
    ).toBe(0);
  });

  it("downgrade não gera cobrança nem crédito retroativo", () => {
    expect(
      prorationCents({
        ...periodo,
        currentAmountCents: 24_990,
        targetAmountCents: 9_990,
        changeAt: "2026-08-10T00:00:00.000Z",
      })
    ).toBe(0);
  });

  it("arredonda para BAIXO, em centavos, e nunca produz fração", () => {
    // 1000 centavos de diferença, 7 de 30 dias restantes → 233,33…
    // A regra declarada é o PISO: 233. Um Math.round daria 233 aqui e 234 em
    // outro caso, e a diferença entre as duas regras é dinheiro do cliente.
    const valor = prorationCents({
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-31T00:00:00.000Z",
      currentAmountCents: 1_000,
      targetAmountCents: 2_000,
      changeAt: "2026-08-24T00:00:00.000Z",
    });
    expect(valor).toBe(233);
    expect(Number.isInteger(valor)).toBe(true);
  });

  it("recusa período inválido em vez de dividir por zero", () => {
    expect(() =>
      prorationCents({
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-01T00:00:00.000Z",
        currentAmountCents: 1_000,
        targetAmountCents: 2_000,
        changeAt: "2026-08-01T00:00:00.000Z",
      })
    ).toThrow(/período inválido/);
  });
});

describe("datas de renovação", () => {
  it("mensal renova um mês depois; anual, doze", () => {
    expect(nextRenewalAt("2026-08-01T00:00:00.000Z", "monthly")).toBe(
      "2026-09-01T00:00:00.000Z"
    );
    expect(nextRenewalAt("2026-08-01T00:00:00.000Z", "yearly")).toBe(
      "2027-08-01T00:00:00.000Z"
    );
  });

  it("31 de janeiro + 1 mês cai no último dia de fevereiro, não em março", () => {
    // Sem o clamp, o Date do JavaScript transborda: 31/01 + 1 mês daria 03/03,
    // e uma assinatura contratada em 31 de janeiro renovaria no mês errado.
    expect(addMonths("2026-01-31T00:00:00.000Z", 1)).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonths("2028-01-31T00:00:00.000Z", 1)).toBe("2028-02-29T00:00:00.000Z");
    expect(addMonths("2026-05-31T00:00:00.000Z", 1)).toBe("2026-06-30T00:00:00.000Z");
  });

  it("conta dias inteiros em UTC", () => {
    expect(daysBetween("2026-08-01T00:00:00.000Z", "2026-08-31T00:00:00.000Z")).toBe(30);
    expect(daysBetween("2026-08-31T00:00:00.000Z", "2026-08-01T00:00:00.000Z")).toBe(-30);
  });
});
