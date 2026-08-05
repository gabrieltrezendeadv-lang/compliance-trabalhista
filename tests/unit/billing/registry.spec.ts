/**
 * COMPORTAMENTO DA SELEÇÃO DE PROVIDER — Etapa 12C.0
 *
 * A guarda estática prova que o registry tem a FORMA certa. Este arquivo prova
 * que ele se COMPORTA — e os dois são necessários: uma forma correta com
 * comportamento errado passa na primeira e reprova aqui.
 *
 * O ambiente é INJETADO em toda chamada. Nenhum caso mexe no `process.env` do
 * processo, então nenhum caso pode vazar para o vizinho — e a ordem de execução
 * deixa de importar.
 *
 * Nenhum teste abre rede: `tests/setup/no-network.ts` transforma qualquer
 * `fetch` em falha, e o caminho do Asaas recusa antes de existir adaptador.
 */

import { describe, expect, it } from "vitest";

import { BillingProviderMock } from "@/lib/billing/providers/mock/deterministic";
import {
  BillingProviderNotConfiguredError,
  BillingProviderNotImplementedError,
  PROVIDERS_DE_COBRANCA,
  nomeDoProviderAtivo,
  resolveBillingProvider,
  seletorDeProvider,
  type AmbienteDeProvider,
} from "@/lib/billing/registry";

/** Ambiente de desenvolvimento, onde o mock é permitido. */
const DEV: AmbienteDeProvider = { NODE_ENV: "test", VERCEL_ENV: "development" };

const ASAAS_COMPLETO: AmbienteDeProvider = {
  ...DEV,
  BILLING_PROVIDER: "asaas",
  ASAAS_API_KEY: "$aact_chave_de_teste_nunca_usada",
  ASAAS_ENVIRONMENT: "sandbox",
  ASAAS_WEBHOOK_TOKEN: "token-de-teste",
};

describe("seleção de provider — o seletor é a única fonte de intenção", () => {
  it("o conjunto aceito é fechado: mock e asaas, nada mais", () => {
    expect([...PROVIDERS_DE_COBRANCA]).toEqual(["mock", "asaas"]);
  });

  it("seletor AUSENTE recusa quando o provider é pedido", () => {
    expect(() => resolveBillingProvider(DEV)).toThrow(BillingProviderNotConfiguredError);
    expect(() => resolveBillingProvider(DEV)).toThrow(/não está definida/);
  });

  it("seletor VAZIO conta como ausente — variável declarada em branco é acidente", () => {
    expect(() => seletorDeProvider({ ...DEV, BILLING_PROVIDER: "   " })).toThrow(
      BillingProviderNotConfiguredError
    );
  });

  it("seletor DESCONHECIDO recusa, e a mensagem diz o que recebeu", () => {
    expect(() => seletorDeProvider({ ...DEV, BILLING_PROVIDER: "stripe" })).toThrow(
      /"stripe" não é um valor conhecido/
    );
  });

  it("ter ASAAS_API_KEY sem seletor NÃO seleciona o Asaas", () => {
    // É o defeito que a 12C.0 corrigiu: criar um secret ligava cobrança real.
    const env: AmbienteDeProvider = { ...DEV, ASAAS_API_KEY: "$aact_qualquer" };
    expect(() => resolveBillingProvider(env)).toThrow(BillingProviderNotConfiguredError);
    expect(nomeDoProviderAtivo(env)).toBeNull();
  });

  it("ausência de seleção válida NÃO vira um provider chamado `not-configured`", () => {
    expect(nomeDoProviderAtivo(DEV)).toBeNull();
    expect(nomeDoProviderAtivo({ ...DEV, BILLING_PROVIDER: "mock" })).toBe("mock");
  });
});

describe("mock — permitido só onde pode", () => {
  it("`mock` devolve o provider determinístico da 12B em desenvolvimento", () => {
    const p = resolveBillingProvider({ ...DEV, BILLING_PROVIDER: "mock" });
    expect(p).toBeInstanceOf(BillingProviderMock);
    expect(p.name).toBe("mock");
  });

  it("`mock` ABORTA com NODE_ENV=production", () => {
    expect(() =>
      resolveBillingProvider({ BILLING_PROVIDER: "mock", NODE_ENV: "production" })
    ).toThrow(/proibido em produção \(NODE_ENV=production\)/);
  });

  it("`mock` ABORTA com VERCEL_ENV=production", () => {
    // Um preview da Vercel roda com NODE_ENV=production e VERCEL_ENV=preview;
    // produção tem VERCEL_ENV=production. As duas barreiras existem porque
    // nenhuma das duas variáveis sozinha descreve o ambiente.
    expect(() =>
      resolveBillingProvider({
        BILLING_PROVIDER: "mock",
        NODE_ENV: "test",
        VERCEL_ENV: "production",
      })
    ).toThrow(/proibido em produção \(VERCEL_ENV=production\)/);
  });

  it("o mock continua determinístico: mesma chave e fingerprint, mesmo recurso", async () => {
    const p = resolveBillingProvider({ ...DEV, BILLING_PROVIDER: "mock" });
    const pedido = {
      idempotencyKey: "ck-registry",
      fingerprint: "fp-registry",
      externalCustomerId: "cus-registry",
      amountCents: 9_990,
      method: "pix" as const,
      description: "teste",
      dueAt: "2026-09-01T00:00:00.000Z",
    };
    const um = await p.createCharge(pedido);
    const dois = await p.createCharge(pedido);
    expect(um.ok && dois.ok).toBe(true);
    if (um.ok && dois.ok) {
      expect(dois.value.externalChargeId).toBe(um.value.externalChargeId);
    }
  });
});

describe("asaas — exige configuração completa antes de qualquer coisa", () => {
  it("sem nenhuma variável, recusa e NOMEIA o que falta", () => {
    let capturado: unknown;
    try {
      resolveBillingProvider({ ...DEV, BILLING_PROVIDER: "asaas" });
    } catch (e) {
      capturado = e;
    }
    expect(capturado).toBeInstanceOf(BillingProviderNotConfiguredError);
    const msg = (capturado as Error).message;
    expect(msg).toMatch(/ASAAS_API_KEY/);
    expect(msg).toMatch(/ASAAS_WEBHOOK_TOKEN/);
    expect(msg).toMatch(/ASAAS_ENVIRONMENT/);
  });

  it.each(["ASAAS_API_KEY", "ASAAS_WEBHOOK_TOKEN", "ASAAS_ENVIRONMENT"] as const)(
    "faltando só %s, ainda recusa",
    (ausente) => {
      const env = { ...ASAAS_COMPLETO, [ausente]: "" };
      expect(() => resolveBillingProvider(env)).toThrow(BillingProviderNotConfiguredError);
    }
  );

  it("ASAAS_ENVIRONMENT com valor inventado recusa", () => {
    expect(() =>
      resolveBillingProvider({ ...ASAAS_COMPLETO, ASAAS_ENVIRONMENT: "homolog" })
    ).toThrow(/sandbox.*production/);
  });

  it("com tudo configurado, recusa por NÃO IMPLEMENTADO — nunca cai no mock", () => {
    // O adaptador do Asaas para o contrato da 12B é a Etapa 12D. Até lá, a
    // recusa é tipada e explícita; devolver o mock aqui seria cobrar de mentira.
    let capturado: unknown;
    try {
      resolveBillingProvider(ASAAS_COMPLETO);
    } catch (e) {
      capturado = e;
    }
    expect(capturado).toBeInstanceOf(BillingProviderNotImplementedError);
    expect(capturado).not.toBeInstanceOf(BillingProviderNotConfiguredError);
  });

  it("nenhuma mensagem de erro reproduz o valor do secret", () => {
    const segredo = "$aact_valor_secreto_que_nao_pode_vazar";
    for (const env of [
      { ...DEV, BILLING_PROVIDER: "asaas", ASAAS_API_KEY: segredo },
      { ...ASAAS_COMPLETO, ASAAS_API_KEY: segredo, ASAAS_ENVIRONMENT: "homolog" },
    ]) {
      try {
        resolveBillingProvider(env);
        throw new Error("deveria ter recusado");
      } catch (e) {
        expect((e as Error).message).not.toContain(segredo);
      }
    }
  });
});

describe("a flag de produto e a seleção de provider são decisões separadas", () => {
  it("o registry não lê BILLING_ENABLED", () => {
    // Se lesse, "billing desligado" e "provider não configurado" produziriam o
    // mesmo diagnóstico — e são problemas diferentes, com respostas diferentes.
    const comFlag = { ...DEV, BILLING_PROVIDER: "mock", BILLING_ENABLED: "false" } as
      AmbienteDeProvider & { BILLING_ENABLED: string };
    expect(resolveBillingProvider(comFlag)).toBeInstanceOf(BillingProviderMock);
  });
});
