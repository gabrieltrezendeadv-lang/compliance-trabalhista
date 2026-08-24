/**
 * A INTENÇÃO DE CHECKOUT, EXERCITADA — Etapa 12C.2 (correção)
 *
 * ── O QUE ESTE ARQUIVO SUBSTITUI ────────────────────────────────────────────
 *
 * O antigo `idempotencia.spec.ts` tinha um teste chamado "pedido DIFERENTE sob
 * a mesma chave é CONFLITO", e ele afirmava como CORRETO que o proprietário,
 * depois de um PIX, ficasse impedido de tentar cartão no mesmo período. Aquilo
 * não era conflito de idempotência: era a organização presa a uma única
 * cobrança por ciclo, porque a chave codificava o PERÍODO em vez da TENTATIVA.
 *
 * O teste foi removido e substituído pelos dois que realmente separam os casos:
 *
 *   * MESMA intenção + payload diferente  → conflito  (o pedido mudou embaixo)
 *   * NOVA intenção  + payload diferente  → sucesso   (nova tentativa comercial)
 *
 * A política inteira está em `src/lib/billing/facade/intencao.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  criarCheckout,
  iniciarTrial,
  prepararIntencaoDeCheckout,
} from "@/lib/billing/facade";
import { cunharIntencao, FORMATO_DE_INTENCAO } from "@/lib/billing/facade/intencao";
import { chaveDeIdempotencia } from "@/lib/billing/usecases/shared";
import { TERMS_VERSION } from "@/lib/billing/terms";

import { comIntencao, comTrial, montarBancada, ORG_A } from "./harness";

const PAGADOR = { customerName: "Fulano de Tal", customerEmail: "fulano@empresa.com.br" };

describe("a cunhagem de produção", () => {
  // `cunharIntencao` é o que roda em produção; a bancada tem a própria fábrica
  // determinística. Sem estes casos, trocar a cunhagem real por uma constante
  // não faria teste algum falhar — a mutação `MUT-FC-38` encontrou exatamente
  // isso.
  it("tem o formato fechado que o schema exige", () => {
    expect(cunharIntencao()).toMatch(FORMATO_DE_INTENCAO);
  });

  it("não se repete: mil cunhagens, mil valores distintos", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i += 1) vistos.add(cunharIntencao());
    expect(vistos.size).toBe(1000);
  });

  it("usa os 128 bits: nenhum nibble fica constante entre amostras", () => {
    // Uma cunhagem truncada, ou de entropia menor, deixaria posições fixas.
    // Com 200 amostras, a chance de um nibble genuinamente aleatório repetir
    // em todas é 16^-199 — indistinguível de zero.
    const amostras = Array.from({ length: 200 }, () => cunharIntencao().slice(3));
    for (let pos = 0; pos < 32; pos += 1) {
      const distintos = new Set(amostras.map((a) => a[pos]));
      expect(distintos.size, `o nibble ${pos} não varia`).toBeGreaterThan(1);
    }
  });
});

describe("preparar intenção", () => {
  it("devolve identificador opaco no formato do servidor", async () => {
    const b = montarBancada();
    const r = await prepararIntencaoDeCheckout({}, b.deps);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.checkoutIntentId).toMatch(FORMATO_DE_INTENCAO);
    // Opaca: nem organização, nem período, nem ator.
    expect(r.value.checkoutIntentId).not.toContain(ORG_A);
  });

  it("não faz I/O algum: nem repositório, nem provider", async () => {
    const b = montarBancada();
    await prepararIntencaoDeCheckout({}, b.deps);

    expect(b.vezesRepositorio()).toBe(0);
    expect(b.vezesProvider()).toBe(0);
    expect(b.vezesAutorizacao()).toBe(1);
  });

  it("com a flag desligada, nem autoriza nem cunha", async () => {
    const b = montarBancada({ flagLigada: false });
    const r = await prepararIntencaoDeCheckout({}, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("billing_disabled");
    expect(b.vezesAutorizacao()).toBe(0);
    expect(b.intencoesCunhadas()).toBe(0);
  });

  it("exige PROPRIETÁRIO: membro comum não prepara intenção", async () => {
    const b = montarBancada({ comoMembro: true });
    const r = await prepararIntencaoDeCheckout({}, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_owner");
    expect(b.intencoesCunhadas()).toBe(0);
  });

  it("cada preparo deliberado cunha uma intenção NOVA", async () => {
    const b = montarBancada();
    const a1 = await comIntencao(b);
    const a2 = await comIntencao(b);

    expect(a1).not.toBe(a2);
    expect(b.intencoesCunhadas()).toBe(2);
  });

  it("organização alheia é recusada, e nada é cunhado", async () => {
    const b = montarBancada();
    const r = await prepararIntencaoDeCheckout({ organizationId: "org-outra" }, b.deps);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_owner");
    expect(b.intencoesCunhadas()).toBe(0);
  });
});

describe("a chave deriva da intenção, e só dela", () => {
  it("muda com a intenção, com a organização e com a operação", () => {
    const base = chaveDeIdempotencia("checkout", ORG_A, "ci_" + "0".repeat(32));
    const outraIntencao = chaveDeIdempotencia("checkout", ORG_A, "ci_" + "1".repeat(32));
    const outraOrg = chaveDeIdempotencia("checkout", "org-outra", "ci_" + "0".repeat(32));

    expect(outraIntencao).not.toBe(base);
    expect(outraOrg).not.toBe(base);
  });

  it("NÃO muda com o período — a rigidez antiga desapareceu", async () => {
    // Prova negativa deliberada: a assinatura da função não tem onde receber
    // período. Se alguém reintroduzir o período na derivação, este arquivo
    // deixa de compilar, que é a falha mais barata possível.
    const antes = chaveDeIdempotencia("checkout", ORG_A, "ci_" + "a".repeat(32));
    const depois = chaveDeIdempotencia("checkout", ORG_A, "ci_" + "a".repeat(32));
    expect(antes).toBe(depois);
    expect(chaveDeIdempotencia.length).toBe(3);
  });

  it("é SHA-256 com geração no prefixo, e não um hash de 32 bits", () => {
    const k = chaveDeIdempotencia("checkout", ORG_A, "ci_" + "0".repeat(32));
    expect(k).toMatch(/^idem1_[0-9a-f]{64}$/);
  });
});

describe("retry técnico × nova tentativa comercial", () => {
  it("retry com a MESMA intenção devolve replay e não cunha nada", async () => {
    const b = montarBancada({ scenarios: ["pix_pending", "pix_pending"] });
    await comTrial(b);
    const intencao = await comIntencao(b);
    const cunhadasAntes = b.intencoesCunhadas();

    const primeira = await criarCheckout({ checkoutIntentId: intencao, method: "pix", ...PAGADOR }, b.deps);
    const segunda = await criarCheckout({ checkoutIntentId: intencao, method: "pix", ...PAGADOR }, b.deps);

    expect(primeira.ok).toBe(true);
    expect(segunda.ok).toBe(true);
    if (primeira.ok && segunda.ok) {
      expect(segunda.value.replay).toBe(true);
      expect(segunda.value.charge.id).toBe(primeira.value.charge.id);
    }
    // Nenhuma intenção nova nasceu no caminho: o retry não sorteia.
    expect(b.intencoesCunhadas()).toBe(cunhadasAntes);
    expect(new Set(b.chavesUsadas()).size).toBe(1);
  });

  it("MESMA intenção com payload DIFERENTE é conflito", async () => {
    const b = montarBancada({ scenarios: ["pix_pending", "approve"] });
    await comTrial(b);
    const intencao = await comIntencao(b);

    const pix = await criarCheckout({ checkoutIntentId: intencao, method: "pix", ...PAGADOR }, b.deps);
    expect(pix.ok).toBe(true);

    // O pedido mudou embaixo da mesma tentativa. Devolver a cobrança anterior
    // faria o segundo pedido sumir sem aviso.
    const cartao = await criarCheckout(
      { checkoutIntentId: intencao, method: "credit_card", ...PAGADOR },
      b.deps
    );
    expect(cartao.ok).toBe(false);
    if (!cartao.ok) expect(cartao.error.code).toBe("conflict");
  });

  it("NOVA intenção permite trocar PIX por cartão — o defeito que isto corrige", async () => {
    const b = montarBancada({ scenarios: ["pix_pending", "approve"] });
    await comTrial(b);

    const primeira = await comIntencao(b);
    const pix = await criarCheckout({ checkoutIntentId: primeira, method: "pix", ...PAGADOR }, b.deps);
    expect(pix.ok).toBe(true);

    // Ação deliberada do usuário: desistir do PIX e pedir cartão. Na versão
    // anterior isto era `conflict` para sempre, porque a chave era do PERÍODO.
    const segunda = await comIntencao(b);
    expect(segunda).not.toBe(primeira);

    const cartao = await criarCheckout(
      { checkoutIntentId: segunda, method: "credit_card", ...PAGADOR },
      b.deps
    );
    expect(cartao.ok).toBe(true);
    if (cartao.ok && pix.ok) {
      expect(cartao.value.replay).toBe(false);
      expect(cartao.value.charge.id).not.toBe(pix.value.charge.id);
    }
    // Duas chaves distintas, uma por tentativa comercial.
    expect(new Set(b.chavesUsadas()).size).toBe(2);
  });

  it("recusa DETERMINÍSTICA libera a repetição do MESMO pedido, na hora", async () => {
    // `rejected` produz um código não-ambíguo: o provider disse não e nada
    // existe do lado de fora, então a reserva vira `failed` e repetir é
    // legítimo sem esperar lease.
    const b = montarBancada({ scenarios: ["rejected", "approve"] });
    await comTrial(b);
    const intencao = await comIntencao(b);
    const pedido = { checkoutIntentId: intencao, method: "pix" as const, ...PAGADOR };

    const recusado = await criarCheckout(pedido, b.deps);
    expect(recusado.ok).toBe(false);

    const repetido = await criarCheckout(pedido, b.deps);
    expect(repetido.ok).toBe(true);
  });

  it("falha AMBÍGUA não libera repetição imediata — a lease governa", async () => {
    const b = montarBancada({ scenarios: ["unavailable_after_persist"] });
    await comTrial(b);
    const intencao = await comIntencao(b);
    const pedido = { checkoutIntentId: intencao, method: "pix" as const, ...PAGADOR };

    const ambigua = await criarCheckout(pedido, b.deps);
    expect(ambigua.ok).toBe(false);

    // Marcar `failed` aqui afirmaria "nada aconteceu", e a repetição criaria a
    // SEGUNDA cobrança no provider.
    const cedo = await criarCheckout(pedido, b.deps);
    expect(cedo.ok).toBe(false);
    if (!cedo.ok) expect(cedo.error.code).toBe("conflict");
  });

  it("recusa não tranca o período: nova intenção segue com outro meio", async () => {
    const b = montarBancada({ scenarios: ["rejected", "approve"] });
    await comTrial(b);

    const primeira = await comIntencao(b);
    const recusado = await criarCheckout(
      { checkoutIntentId: primeira, method: "pix", ...PAGADOR },
      b.deps
    );
    expect(recusado.ok).toBe(false);

    const segunda = await comIntencao(b);
    const cartao = await criarCheckout(
      { checkoutIntentId: segunda, method: "credit_card", ...PAGADOR },
      b.deps
    );
    expect(cartao.ok).toBe(true);
  });
});

describe("o chamador não escolhe nada além da intenção", () => {
  it("mandar a chave de idempotência é ERRO", async () => {
    const b = montarBancada();
    await comTrial(b);
    const intencao = await comIntencao(b);

    const r = await criarCheckout(
      { checkoutIntentId: intencao, method: "pix", ...PAGADOR, idempotencyKey: "escolhida" },
      b.deps
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("intenção AUSENTE é erro — nada é inventado em silêncio", async () => {
    const b = montarBancada();
    await comTrial(b);

    const r = await criarCheckout({ method: "pix", ...PAGADOR }, b.deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
    // E, sobretudo, nenhuma reserva foi feita.
    expect(b.chavesUsadas()).toHaveLength(0);
  });

  it("intenção de formato inventado é recusada", async () => {
    const b = montarBancada();
    await comTrial(b);

    for (const forjada of ["ci_curta", "nao-e-intencao", "ci_" + "z".repeat(32), ""]) {
      const r = await criarCheckout(
        { checkoutIntentId: forjada, method: "pix", ...PAGADOR },
        b.deps
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
    }
    expect(b.chavesUsadas()).toHaveLength(0);
  });

  it("nenhum cenário do mock é escolhível pela entrada", async () => {
    const b = montarBancada({ scenarios: ["approve"] });
    await comTrial(b);
    const intencao = await comIntencao(b);

    const r = await criarCheckout(
      { checkoutIntentId: intencao, method: "pix", ...PAGADOR, scenario: "decline" },
      b.deps
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("sem assinatura não há checkout, e a recusa é a de tenant alheio", async () => {
    const b = montarBancada();
    const intencao = await comIntencao(b);

    const r = await criarCheckout({ checkoutIntentId: intencao, method: "pix", ...PAGADOR }, b.deps);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("not_found");
      expect(r.error.message).toMatch(/proprietário/i);
    }
    expect(b.chamadasDoProvider()).toBe(0);
  });
});

describe("falhas do provider", () => {
  it("timeout NÃO vira sucesso", async () => {
    const b = montarBancada({ scenarios: ["timeout"] });
    await comTrial(b);
    const intencao = await comIntencao(b);

    const r = await criarCheckout({ checkoutIntentId: intencao, method: "pix", ...PAGADOR }, b.deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("provider_timeout");
  });

  it("falha AMBÍGUA (persistiu e não respondeu) não vira sucesso nem cobrança perdida", async () => {
    const b = montarBancada({ scenarios: ["unavailable_after_persist"] });
    await comTrial(b);
    const intencao = await comIntencao(b);

    const r = await criarCheckout({ checkoutIntentId: intencao, method: "pix", ...PAGADOR }, b.deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("provider_unavailable");
  });

  it("falha ANTES de persistir também não vira sucesso", async () => {
    const b = montarBancada({ scenarios: ["unavailable_before_persist"] });
    await comTrial(b);
    const intencao = await comIntencao(b);

    const r = await criarCheckout({ checkoutIntentId: intencao, method: "pix", ...PAGADOR }, b.deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("provider_unavailable");
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
