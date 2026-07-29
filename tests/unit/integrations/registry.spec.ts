/**
 * Testes do registry de provedores — CONTRA O CÓDIGO REAL.
 *
 * Substitui a parte de registry de `tests/fail-closed-channels.test.ts`, que
 * declarava "We reimplement the key registry logic here (...) The logic
 * mirrors registry.ts exactly" e portanto testava uma cópia. Um defeito em
 * `src/lib/integrations/registry.ts` não fazia aquele teste falhar.
 *
 * Aqui o módulo real é importado e executado.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChannelNotConfiguredError,
  areChannelsReady,
  getActiveProviderName,
  getMockProvider,
  getRequiredChannels,
  isProduction,
  isRealProviderConfigured,
  resolveProvider,
} from "@/lib/integrations/registry";

const PROVIDER_ENV = [
  "RESEND_API_KEY",
  "RESEND_FROM_ADDRESS",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "ALLOW_MOCK_PROVIDERS",
] as const;

/** Zera todas as variáveis de provedor — ponto de partida "nada configurado". */
function clearProviderEnv() {
  for (const key of PROVIDER_ENV) vi.stubEnv(key, "");
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NODE_ENV", "test");
  clearProviderEnv();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════
// Produção jamais seleciona mock
// ══════════════════════════════════════════════════════════════════════════

describe("produção falha fechada", () => {
  it("lança ChannelNotConfiguredError sem credenciais (email)", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => resolveProvider("email")).toThrow(ChannelNotConfiguredError);
  });

  it("lança ChannelNotConfiguredError sem credenciais (whatsapp)", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => resolveProvider("whatsapp")).toThrow(ChannelNotConfiguredError);
  });

  it("lança MESMO com ALLOW_MOCK_PROVIDERS=true — opt-in não vale em produção", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_MOCK_PROVIDERS", "true");

    expect(() => resolveProvider("email")).toThrow(ChannelNotConfiguredError);
    expect(() => resolveProvider("whatsapp")).toThrow(ChannelNotConfiguredError);
  });

  it("getMockProvider lança em produção mesmo se chamado diretamente", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => getMockProvider("email")).toThrow(ChannelNotConfiguredError);
    expect(() => getMockProvider("whatsapp")).toThrow(ChannelNotConfiguredError);
  });

  it("isProduction reflete NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProduction()).toBe(true);

    vi.stubEnv("NODE_ENV", "development");
    expect(isProduction()).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Desenvolvimento exige opt-in explícito
// ══════════════════════════════════════════════════════════════════════════

describe("desenvolvimento", () => {
  it("SEM opt-in e sem credenciais, falha fechada — não há fallback silencioso", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(() => resolveProvider("email")).toThrow(ChannelNotConfiguredError);
  });

  it("COM opt-in explícito, devolve provider mock", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_MOCK_PROVIDERS", "true");

    const provider = resolveProvider("email");

    expect(provider).toBeDefined();
    expect(typeof provider.send).toBe("function");
  });

  it("mock é singleton por canal", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_MOCK_PROVIDERS", "true");

    expect(resolveProvider("email")).toBe(resolveProvider("email"));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Provedores reais
// ══════════════════════════════════════════════════════════════════════════

describe("resolução de provedor real", () => {
  it("usa Resend quando RESEND_API_KEY está presente", () => {
    vi.stubEnv("RESEND_API_KEY", "re_chave_de_teste");

    const provider = resolveProvider("email");

    expect(provider.constructor.name).toBe("ResendProvider");
  });

  it("usa WhatsApp Cloud quando token E phone id estão presentes", () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token-teste");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123456");

    const provider = resolveProvider("whatsapp");

    expect(provider.constructor.name).toBe("WhatsAppCloudProvider");
  });

  it("token de WhatsApp SEM phone id não configura o canal", () => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token-teste");

    expect(isRealProviderConfigured("whatsapp")).toBe(false);
    expect(() => resolveProvider("whatsapp")).toThrow(ChannelNotConfiguredError);
  });

  it("config de tenant com provider desconhecido falha fechada, sem cair em mock", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_MOCK_PROVIDERS", "true");

    expect(() =>
      resolveProvider("email", { provider: "provedor-inexistente", apiKey: "k" })
    ).toThrow(ChannelNotConfiguredError);
  });

  it("config de tenant válida tem prioridade sobre a variável de plataforma", () => {
    vi.stubEnv("RESEND_API_KEY", "chave-da-plataforma");

    const provider = resolveProvider("email", {
      provider: "resend",
      apiKey: "chave-do-tenant",
      settings: { fromAddress: "tenant@exemplo.test" },
    });

    expect(provider.constructor.name).toBe("ResendProvider");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Exposição de estado na interface
// ══════════════════════════════════════════════════════════════════════════

describe("nome do provedor ativo", () => {
  it("devolve 'not-configured' sem credenciais — nunca expõe nome de mock", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_MOCK_PROVIDERS", "true");

    expect(getActiveProviderName("email")).toBe("not-configured");
    expect(getActiveProviderName("whatsapp")).toBe("not-configured");
  });

  it("devolve o nome real quando configurado", () => {
    vi.stubEnv("RESEND_API_KEY", "re_chave");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");

    expect(getActiveProviderName("email")).toBe("resend");
    expect(getActiveProviderName("whatsapp")).toBe("whatsapp-cloud");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Canais exigidos por campanha
// ══════════════════════════════════════════════════════════════════════════

describe("canais exigidos pela campanha", () => {
  it("mapeia o valor do canal para a lista concreta", () => {
    expect(getRequiredChannels("email")).toEqual(["email"]);
    expect(getRequiredChannels("whatsapp")).toEqual(["whatsapp"]);
    expect(getRequiredChannels("both")).toEqual(["email", "whatsapp"]);
    expect(getRequiredChannels("valor-desconhecido")).toEqual([]);
  });

  it("'both' exige AMBOS os canais configurados", () => {
    vi.stubEnv("RESEND_API_KEY", "re_chave");

    const status = areChannelsReady("both");

    expect(status.ready).toBe(false);
    expect(status.missing).toEqual(["whatsapp"]);
  });

  it("'both' fica pronto somente com os dois configurados", () => {
    vi.stubEnv("RESEND_API_KEY", "re_chave");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123");

    const status = areChannelsReady("both");

    expect(status.ready).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it("relata os dois canais faltantes quando nada está configurado", () => {
    expect(areChannelsReady("both").missing).toEqual(["email", "whatsapp"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Mensagem de erro
// ══════════════════════════════════════════════════════════════════════════

describe("ChannelNotConfiguredError", () => {
  it("identifica o canal e orienta o usuário sem vazar configuração", () => {
    const error = new ChannelNotConfiguredError("email");

    expect(error.channel).toBe("email");
    expect(error.name).toBe("ChannelNotConfiguredError");
    expect(error.message).toContain("E-mail");
    expect(error.message).not.toContain("RESEND_API_KEY");
  });

  it("usa o rótulo correto para WhatsApp", () => {
    expect(new ChannelNotConfiguredError("whatsapp").message).toContain(
      "WhatsApp"
    );
  });
});
