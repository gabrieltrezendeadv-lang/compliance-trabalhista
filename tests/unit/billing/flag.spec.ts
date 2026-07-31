/**
 * FEATURE FLAG DE BILLING.
 *
 * Cobre o item 15 dos testes obrigatórios: com a flag desligada, o
 * comportamento atual é preservado por CAMINHO EXPLÍCITO — e não por captura
 * de erro nem por acaso.
 *
 * O caso que mais importa aqui é o da AUSÊNCIA. A forma perigosa seria
 * `BILLING_DISABLED === "true"`: nela, esquecer de definir a variável — num
 * runner novo, num preview, numa máquina recém-configurada — LIGA a cobrança.
 * O padrão de um sistema de billing tem de ser "não cobra".
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BILLING_FLAG_ENV,
  BILLING_FLAG_ON,
  isBillingEnabled,
} from "@/lib/billing/flag";

const original = process.env[BILLING_FLAG_ENV];

beforeEach(() => {
  delete process.env[BILLING_FLAG_ENV];
});

afterEach(() => {
  if (original === undefined) delete process.env[BILLING_FLAG_ENV];
  else process.env[BILLING_FLAG_ENV] = original;
});

describe("desligada por padrão", () => {
  it("ausência da variável DESLIGA", () => {
    expect(process.env[BILLING_FLAG_ENV]).toBeUndefined();
    expect(isBillingEnabled()).toBe(false);
  });

  it("string vazia desliga", () => {
    process.env[BILLING_FLAG_ENV] = "";
    expect(isBillingEnabled()).toBe(false);
  });

  for (const valor of ["1", "yes", "TRUE", "True", "on", "sim", "false", " true"]) {
    it(`o valor ${JSON.stringify(valor)} NÃO liga`, () => {
      process.env[BILLING_FLAG_ENV] = valor;
      expect(isBillingEnabled()).toBe(false);
    });
  }
});

describe("ligada apenas pelo valor exato", () => {
  it(`somente ${JSON.stringify(BILLING_FLAG_ON)} liga`, () => {
    process.env[BILLING_FLAG_ENV] = BILLING_FLAG_ON;
    expect(isBillingEnabled()).toBe(true);
  });

  it("o valor que liga é 'true', e a variável é BILLING_ENABLED", () => {
    // Fixa o contrato: uma renomeação silenciosa da variável faria a flag
    // passar a ler algo que ninguém configura — e ficaria desligada para
    // sempre, sem que nada acusasse.
    expect(BILLING_FLAG_ENV).toBe("BILLING_ENABLED");
    expect(BILLING_FLAG_ON).toBe("true");
  });
});

describe("sem cache entre chamadas", () => {
  it("responde ao ambiente vigente, não ao do carregamento do módulo", () => {
    expect(isBillingEnabled()).toBe(false);
    process.env[BILLING_FLAG_ENV] = "true";
    expect(isBillingEnabled()).toBe(true);
    process.env[BILLING_FLAG_ENV] = "false";
    expect(isBillingEnabled()).toBe(false);
  });
});
