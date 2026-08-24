/**
 * O FINGERPRINT COBRE O PEDIDO INTEIRO
 *
 * ── O DEFEITO QUE ESTE ARQUIVO IMPEDE ───────────────────────────────────────
 *
 * `createCheckout` mandava ao provider `cnpj`, `customerName` e
 * `customerEmail` — e NENHUM dos três entrava no fingerprint. Consequência:
 *
 *   1. primeira chamada: intenção I, pagador "Fulano", fulano@x.com;
 *   2. retry: mesma intenção I, mesmo plano e meio, pagador "Sicrano";
 *   3. fingerprint idêntico;
 *   4. o banco entende "mesmo pedido" e devolve replay (ou retoma a operação);
 *   5. o conteúdo destinado ao provider mudou sem produzir conflito algum.
 *
 * O teste que existia trocava apenas PIX por cartão. Ele provava `method`, e
 * mais nada.
 *
 * ── O QUE SE ASSERTA, E POR QUE NÃO É O RESULTADO ───────────────────────────
 *
 * O mock memoiza o cliente por organização e devolve o existente sem olhar
 * nome, e-mail ou CNPJ. Olhar o resultado, portanto, não provaria nada: ele
 * seria igual mesmo com o produto quebrado, porque o mock descarta o campo.
 *
 * A asserção certa é a que o produto controla: o conflito acontece ANTES, e o
 * provider NÃO recebe a segunda versão. `chamadasDeCliente` mede isso.
 */

import { describe, expect, it } from "vitest";

import { criarCheckout } from "@/lib/billing/facade";
import type { MockScenario } from "@/lib/billing/providers/mock/deterministic";
import {
  normalizarCnpj,
  normalizarEmail,
  normalizarNome,
} from "@/lib/billing/usecases/shared";

import { comIntencao, comTrial, montarBancada } from "./harness";

const PAGADOR = { customerName: "Fulano de Tal", customerEmail: "fulano@empresa.com.br" };

/** Bancada com trial e uma intenção pronta. */
async function pronta(
  scenarios: readonly MockScenario[] = ["pix_pending", "approve"]
) {
  const b = montarBancada({ scenarios });
  await comTrial(b);
  const intencao = await comIntencao(b);
  return { b, intencao };
}

describe("normalização, por extenso", () => {
  it("CNPJ: só os dígitos", () => {
    expect(normalizarCnpj("00.000.000/0001-91")).toBe("00000000000191");
    expect(normalizarCnpj(" 00000000000191 ")).toBe("00000000000191");
  });

  it("nome: `trim`, e o espaço INTERNO é preservado", () => {
    expect(normalizarNome("  Fulano de Tal  ")).toBe("Fulano de Tal");
    // Deliberado: é o que vai impresso na cobrança, e não cabe ao billing
    // decidir que dois espaços são um.
    expect(normalizarNome("Maria  Silva")).not.toBe(normalizarNome("Maria Silva"));
  });

  it("e-mail: `trim` e caixa baixa", () => {
    expect(normalizarEmail("  Fulano@Empresa.COM.br ")).toBe("fulano@empresa.com.br");
  });
});

describe("mesma intenção, pagador DIFERENTE → conflito", () => {
  it("mudar o NOME conflita, e o provider não recebe a segunda versão", async () => {
    const { b, intencao } = await pronta();

    const primeira = await criarCheckout(
      { checkoutIntentId: intencao, method: "pix", ...PAGADOR },
      b.deps
    );
    expect(primeira.ok).toBe(true);
    const clientesAntes = b.provider.chamadasDeCliente.length;
    const cobrancasAntes = b.provider.chamadasDeCobranca.length;

    const segunda = await criarCheckout(
      { checkoutIntentId: intencao, method: "pix", ...PAGADOR, customerName: "Sicrano de Tal" },
      b.deps
    );

    expect(segunda.ok, "o pagador mudou e não houve conflito").toBe(false);
    if (!segunda.ok) expect(segunda.error.code).toBe("conflict");

    // O conflito acontece no `claim`, ANTES do provider.
    expect(b.provider.chamadasDeCliente).toHaveLength(clientesAntes);
    expect(b.provider.chamadasDeCobranca).toHaveLength(cobrancasAntes);
    // E nenhum nome novo chegou ao provider.
    expect(b.provider.chamadasDeCliente.map((c) => c.name)).not.toContain("Sicrano de Tal");
  });

  it("mudar o E-MAIL conflita, e o provider não recebe o endereço novo", async () => {
    const { b, intencao } = await pronta();

    await criarCheckout({ checkoutIntentId: intencao, method: "pix", ...PAGADOR }, b.deps);
    const antes = b.provider.chamadasDeCliente.length;

    const segunda = await criarCheckout(
      { checkoutIntentId: intencao, method: "pix", ...PAGADOR, customerEmail: "outro@empresa.com.br" },
      b.deps
    );

    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.error.code).toBe("conflict");
    expect(b.provider.chamadasDeCliente).toHaveLength(antes);
    expect(b.provider.chamadasDeCliente.map((c) => c.email)).not.toContain("outro@empresa.com.br");
  });

  it("mudar o MEIO continua conflitando — a cobertura antiga não regrediu", async () => {
    const { b, intencao } = await pronta();

    await criarCheckout({ checkoutIntentId: intencao, method: "pix", ...PAGADOR }, b.deps);
    const segunda = await criarCheckout(
      { checkoutIntentId: intencao, method: "credit_card", ...PAGADOR },
      b.deps
    );

    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.error.code).toBe("conflict");
  });
});

describe("diferenças apenas de NORMALIZAÇÃO → replay", () => {
  it("espaço em volta do nome não cria pedido novo", async () => {
    const { b, intencao } = await pronta(["pix_pending"]);

    const primeira = await criarCheckout(
      { checkoutIntentId: intencao, method: "pix", ...PAGADOR },
      b.deps
    );
    const segunda = await criarCheckout(
      { checkoutIntentId: intencao, method: "pix", ...PAGADOR, customerName: "  Fulano de Tal  " },
      b.deps
    );

    expect(primeira.ok).toBe(true);
    expect(segunda.ok, "trim virou pedido diferente").toBe(true);
    if (primeira.ok && segunda.ok) {
      expect(segunda.value.replay).toBe(true);
      expect(segunda.value.charge.id).toBe(primeira.value.charge.id);
    }
    // Uma cobrança, e o provider chamado uma vez só.
    expect(b.provider.chamadasDeCobranca).toHaveLength(1);
  });

  it("caixa do e-mail não cria pedido novo", async () => {
    const { b, intencao } = await pronta(["pix_pending"]);

    const primeira = await criarCheckout(
      { checkoutIntentId: intencao, method: "pix", ...PAGADOR },
      b.deps
    );
    const segunda = await criarCheckout(
      { checkoutIntentId: intencao, method: "pix", ...PAGADOR, customerEmail: "FULANO@EMPRESA.COM.BR" },
      b.deps
    );

    expect(primeira.ok).toBe(true);
    expect(segunda.ok, "a caixa do e-mail virou pedido diferente").toBe(true);
    if (segunda.ok) expect(segunda.value.replay).toBe(true);
    expect(b.provider.chamadasDeCobranca).toHaveLength(1);
  });

  it("o provider recebe o valor NORMALIZADO, e não o bruto", async () => {
    const { b, intencao } = await pronta(["pix_pending"]);

    await criarCheckout(
      {
        checkoutIntentId: intencao,
        method: "pix",
        customerName: "  Fulano de Tal  ",
        customerEmail: "  Fulano@Empresa.COM.BR  ",
      },
      b.deps
    );

    const cliente = b.provider.chamadasDeCliente.at(-1);
    expect(cliente).toBeDefined();
    // Se a normalização valesse só para o fingerprint, a identidade diria
    // "mesmo pedido" enquanto o provider receberia bytes diferentes.
    expect(cliente?.name).toBe("Fulano de Tal");
    expect(cliente?.email).toBe("fulano@empresa.com.br");
    expect(cliente?.cnpj).toBe("00000000000191");
  });
});

describe("CNPJ", () => {
  it("entra no fingerprint: organizações com CNPJ distinto não colidem", async () => {
    // O domínio NÃO permite alterar o CNPJ: ele entra por `start_trial` e é
    // imutável por trigger — não existe RPC que o mude. Logo o cenário
    // "mudar o CNPJ sob a mesma intenção" não é alcançável hoje, e um teste
    // que o encenasse estaria encenando.
    //
    // O que se prova é a propriedade que importa: o CNPJ PARTICIPA da
    // identidade do pedido. Dois trials com CNPJ diferente, tudo o mais igual,
    // produzem fingerprints diferentes.
    const um = montarBancada({ scenarios: ["pix_pending"] });
    await comTrial(um, { cnpj: "00000000000191" });
    const i1 = await comIntencao(um);
    await criarCheckout({ checkoutIntentId: i1, method: "pix", ...PAGADOR }, um.deps);

    const outro = montarBancada({ scenarios: ["pix_pending"] });
    await comTrial(outro, { cnpj: "11444777000161" });
    const i2 = await comIntencao(outro);
    await criarCheckout({ checkoutIntentId: i2, method: "pix", ...PAGADOR }, outro.deps);

    const fpUm = um.provider.chamadasDeCobranca.at(-1)?.fingerprint;
    const fpOutro = outro.provider.chamadasDeCobranca.at(-1)?.fingerprint;

    expect(fpUm).toBeDefined();
    expect(fpOutro).toBeDefined();
    expect(fpUm, "o CNPJ não altera o fingerprint").not.toBe(fpOutro);
  });
});
