/**
 * A POLÍTICA DE IDEMPOTÊNCIA DO CHECKOUT, EXERCITADA — Etapa 12C.2
 *
 * A política está escrita em `src/lib/billing/facade/idempotencia.ts`. Aqui ela
 * é medida: a mesma chave entre tentativas, conflito quando o pedido muda,
 * e nenhuma chave escolhida pelo chamador.
 */

import { describe, expect, it } from "vitest";

import { criarCheckout, iniciarTrial, lerAssinatura } from "@/lib/billing/facade";
import { derivarChave } from "@/lib/billing/facade/idempotencia";
import { TERMS_VERSION } from "@/lib/billing/terms";

import { comTrial, montarBancada, ORG_A } from "./harness";

const PAGADOR = { customerName: "Fulano de Tal", customerEmail: "fulano@empresa.com.br" };

describe("derivação da chave", () => {
  it("é determinística: mesmos dados, mesma chave", () => {
    const a = derivarChave("checkout", ORG_A, "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    const b = derivarChave("checkout", ORG_A, "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    expect(a).toBe(b);
  });

  it("muda com a organização e com o período — e só com eles", () => {
    const base = derivarChave("checkout", ORG_A, "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    const outraOrg = derivarChave("checkout", "org-outra", "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    const outroPeriodo = derivarChave("checkout", ORG_A, "2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z");

    expect(outraOrg).not.toBe(base);
    expect(outroPeriodo).not.toBe(base);
  });

  it("é opaca: não devolve organização nem datas em claro", () => {
    const k = derivarChave("checkout", ORG_A, "2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
    expect(k).not.toContain(ORG_A);
    expect(k).not.toContain("2026-08-01");
    expect(k).toMatch(/^idem_checkout_fp_[0-9a-f]{8}$/);
  });
});

describe("retry e conflito", () => {
  it("retry legítimo reutiliza a MESMA chave e devolve replay", async () => {
    const b = montarBancada({ scenarios: ["pix_pending", "pix_pending"] });
    await comTrial(b);

    const primeira = await criarCheckout({ method: "pix", ...PAGADOR }, b.deps);
    expect(primeira.ok).toBe(true);

    const segunda = await criarCheckout({ method: "pix", ...PAGADOR }, b.deps);
    expect(segunda.ok).toBe(true);

    // Replay: a cobrança é a mesma, e o provider NÃO foi chamado de novo.
    if (primeira.ok && segunda.ok) {
      expect(segunda.value.replay).toBe(true);
      expect(segunda.value.charge.id).toBe(primeira.value.charge.id);
    }

    // E a chave foi a mesma nas duas tentativas — nada foi sorteado.
    const chaves = b.chavesUsadas();
    expect(new Set(chaves).size).toBe(1);
    expect(chaves.length).toBeGreaterThanOrEqual(2);
  });

  it("a chave sobrevive a instâncias diferentes da fachada", async () => {
    // Duas bancadas com o MESMO repositório não existem; o que se prova aqui é
    // que a chave não depende de estado em memória: recalculá-la a partir do
    // estado lido dá a mesma string.
    const b = montarBancada({ scenarios: ["pix_pending"] });
    await comTrial(b);
    await criarCheckout({ method: "pix", ...PAGADOR }, b.deps);

    const estado = await lerAssinatura({}, b.deps);
    expect(estado.ok).toBe(true);
    if (!estado.ok || estado.value.subscription === null) return;

    const recalculada = derivarChave(
      "checkout",
      estado.value.subscription.organizationId,
      estado.value.subscription.currentPeriodStart,
      estado.value.subscription.currentPeriodEnd
    );
    expect(b.chavesUsadas()[0]).toBe(recalculada);
  });

  it("pedido DIFERENTE sob a mesma chave é CONFLITO, e não cobrança nova", async () => {
    const b = montarBancada({ scenarios: ["pix_pending", "approve"] });
    await comTrial(b);

    const pix = await criarCheckout({ method: "pix", ...PAGADOR }, b.deps);
    expect(pix.ok).toBe(true);

    // Mesmo período, logo mesma chave; meio diferente, logo fingerprint
    // diferente. É exatamente o caso que a política existe para pegar.
    const cartao = await criarCheckout({ method: "credit_card", ...PAGADOR }, b.deps);
    expect(cartao.ok).toBe(false);
    if (!cartao.ok) expect(cartao.error.code).toBe("conflict");

    expect(new Set(b.chavesUsadas()).size).toBe(1);
  });

  it("o chamador não escolhe a chave: mandá-la é erro", async () => {
    const b = montarBancada();
    await comTrial(b);
    const r = await criarCheckout(
      { method: "pix", ...PAGADOR, idempotencyKey: "escolhida-pelo-cliente" },
      b.deps
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("sem assinatura não há checkout, e a recusa é a de tenant alheio", async () => {
    const b = montarBancada();
    const r = await criarCheckout({ method: "pix", ...PAGADOR }, b.deps);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("not_found");
      // Mesma mensagem de `not_owner`: não confirma existência de organização.
      expect(r.error.message).toMatch(/proprietário/i);
    }
    // O provider foi resolvido (o checkout precisa dele), mas não foi chamado.
    expect(b.chamadasDoProvider()).toBe(0);
  });
});

describe("falhas do provider", () => {
  it("timeout do provider NÃO vira sucesso", async () => {
    const b = montarBancada({ scenarios: ["timeout"] });
    await comTrial(b);
    const r = await criarCheckout({ method: "pix", ...PAGADOR }, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(["provider_timeout", "provider_unavailable"]).toContain(r.error.code);
  });

  it("erro AMBÍGUO (falhou depois de persistir) não vira sucesso nem cobrança perdida", async () => {
    const b = montarBancada({ scenarios: ["unavailable_after_persist"] });
    await comTrial(b);
    const r = await criarCheckout({ method: "pix", ...PAGADOR }, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(["provider_unavailable", "provider_timeout"]).toContain(r.error.code);

    // A chave permanece reservada com o mesmo fingerprint: a retentativa
    // legítima reutiliza, e é isso que impede a cobrança em duplicidade.
    expect(new Set(b.chavesUsadas()).size).toBe(1);
  });

  it("falha ANTES de persistir também não vira sucesso", async () => {
    const b = montarBancada({ scenarios: ["unavailable_before_persist"] });
    await comTrial(b);
    const r = await criarCheckout({ method: "pix", ...PAGADOR }, b.deps);
    expect(r.ok).toBe(false);
  });

  it("nenhum cenário do mock é escolhível pela entrada da fachada", async () => {
    const b = montarBancada();
    await comTrial(b);
    for (const campo of ["scenario", "scenarios", "mockScenario"]) {
      const r = await criarCheckout(
        { method: "pix", ...PAGADOR, [campo]: "decline" },
        b.deps
      );
      expect(r.ok, `aceitou ${campo}`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
    }
  });
});

describe("o trial que precede o checkout", () => {
  it("é o mesmo caminho da fachada, com a versão oficial", async () => {
    const b = montarBancada();
    const r = await iniciarTrial(
      {
        plan: "essencial",
        period: "monthly",
        workerCount: 10,
        cnpj: "00000000000191",
        termsVersion: TERMS_VERSION,
      },
      b.deps
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.termsVersion).toBe(TERMS_VERSION);
  });
});
