/**
 * Testes do gateway de denúncias — CONTRA O CÓDIGO REAL.
 *
 * Substitui `tests/gateway.test.ts`, que reimplementava a lógica do gateway
 * dentro do próprio arquivo de teste ("mirroring gateway.ts exactly") e por
 * isso passava mesmo que `src/lib/complaints/gateway.ts` estivesse quebrado.
 *
 * Aqui o módulo de produção é importado e executado. O que é substituído são
 * apenas as fronteiras externas: `next/headers` e o cliente Supabase.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

// ─── Fronteiras externas ──────────────────────────────────────────────────

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));

import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import {
  gatewayAccessComplaint,
  gatewaySendReporterMessage,
} from "@/lib/complaints/gateway";

// ─── Auxiliares ───────────────────────────────────────────────────────────

const VALID_SECRET = "x".repeat(32);

function setHeaders(map: Record<string, string>) {
  vi.mocked(headers).mockResolvedValue({
    get: (name: string) => map[name.toLowerCase()] ?? null,
  } as unknown as Awaited<ReturnType<typeof headers>>);
}

/** Instala um cliente falso e devolve o registro das RPCs chamadas. */
function setRpc(response: { data: unknown; error: unknown }) {
  const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  vi.mocked(createServiceClient).mockReturnValue({
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return response;
    },
  } as unknown as ReturnType<typeof createServiceClient>);
  return rpcCalls;
}

const VALID_ACCESS = { protocol: "ABC123", pin: "123456" };
const VALID_MESSAGE = { protocol: "ABC123", pin: "123456", body: "olá" };

const GENERIC_ERROR = "Protocolo ou PIN inválido";
const RATE_LIMIT_ERROR = "Muitas tentativas. Tente novamente em alguns minutos.";
const CLOSED_ERROR = "Esta denúncia foi encerrada e não aceita novas mensagens.";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("RATE_LIMIT_HMAC_SECRET", VALID_SECRET);
  vi.stubEnv("NODE_ENV", "test");
  setHeaders({ "x-forwarded-for": "203.0.113.7" });
  // Silencia os logs do gateway sem esconder falhas de teste.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ══════════════════════════════════════════════════════════════════════════
// Pré-checagem de HMAC — fail closed
// ══════════════════════════════════════════════════════════════════════════

describe("pré-checagem de HMAC", () => {
  it("em produção sem segredo, falha fechada e NÃO chama a RPC", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "");
    const rpcCalls = setRpc({ data: null, error: null });

    const result = await gatewayAccessComplaint(VALID_ACCESS);

    expect(result.error).toBe(GENERIC_ERROR);
    expect(result.correlationId).toBeTruthy();
    expect(rpcCalls).toHaveLength(0);
  });

  it("rejeita segredo com menos de 32 caracteres e NÃO chama a RPC", async () => {
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "curto-demais");
    const rpcCalls = setRpc({ data: null, error: null });

    const result = await gatewayAccessComplaint(VALID_ACCESS);

    expect(result.error).toBe(GENERIC_ERROR);
    expect(rpcCalls).toHaveLength(0);
  });

  it("fora de produção sem segredo e sem opt-in, NÃO chama a RPC", async () => {
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "");
    const rpcCalls = setRpc({ data: null, error: null });

    const result = await gatewayAccessComplaint(VALID_ACCESS);

    expect(result.error).toBe(GENERIC_ERROR);
    expect(rpcCalls).toHaveLength(0);
  });

  it("fora de produção sem segredo COM opt-in explícito, prossegue sem hash de IP", async () => {
    vi.stubEnv("RATE_LIMIT_HMAC_SECRET", "");
    vi.stubEnv("RATE_LIMIT_HMAC_ALLOW_MISSING", "true");
    const rpcCalls = setRpc({ data: { success: true }, error: null });

    await gatewayAccessComplaint(VALID_ACCESS);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].params.p_caller_ip_hash).toBeNull();
  });

  it("em produção sem hash de IP disponível, falha fechada e NÃO chama a RPC", async () => {
    vi.stubEnv("NODE_ENV", "production");
    setHeaders({}); // nenhum header de IP
    const rpcCalls = setRpc({ data: { success: true }, error: null });

    const result = await gatewayAccessComplaint(VALID_ACCESS);

    expect(result.error).toBe(GENERIC_ERROR);
    expect(rpcCalls).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Validação estrita — nenhuma RPC deve ser chamada quando a entrada é inválida
// ══════════════════════════════════════════════════════════════════════════

describe("validação estrita da entrada", () => {
  const invalidInputs: Array<[string, unknown]> = [
    ["campo extra (tentativa de injeção de tenant_id)", { ...VALID_ACCESS, tenant_id: "injetado" }],
    ["PIN não numérico", { protocol: "ABC123", pin: "abcdef" }],
    ["PIN curto demais", { protocol: "ABC123", pin: "12" }],
    ["protocolo acima de 20 caracteres", { protocol: "A".repeat(21), pin: "123456" }],
    ["protocolo vazio", { protocol: "", pin: "123456" }],
    ["entrada nula", null],
    ["entrada primitiva", "string solta"],
  ];

  it.each(invalidInputs)("rejeita %s sem chamar RPC", async (_label, input) => {
    const rpcCalls = setRpc({ data: { success: true }, error: null });

    const result = await gatewayAccessComplaint(input);

    expect(result.error).toBe(GENERIC_ERROR);
    expect(result.correlationId).toBeTruthy();
    expect(rpcCalls).toHaveLength(0);
  });

  it("rejeita corpo de mensagem acima de 10.000 caracteres sem chamar RPC", async () => {
    const rpcCalls = setRpc({ data: { success: true }, error: null });

    const result = await gatewaySendReporterMessage({
      ...VALID_MESSAGE,
      body: "x".repeat(10_001),
    });

    expect(result.error).toBe(GENERIC_ERROR);
    expect(rpcCalls).toHaveLength(0);
  });

  it("normaliza o protocolo para maiúsculas e sem espaços antes da RPC", async () => {
    const rpcCalls = setRpc({ data: { success: true }, error: null });

    await gatewayAccessComplaint({ protocol: " ab c123 ", pin: "123456" });

    expect(rpcCalls[0].params.p_protocol).toBe("ABC123");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Pseudonimização de IP
// ══════════════════════════════════════════════════════════════════════════

describe("hash de IP", () => {
  async function capturedIpHash(hdrs: Record<string, string>) {
    setHeaders(hdrs);
    const rpcCalls = setRpc({ data: { success: true }, error: null });
    await gatewayAccessComplaint(VALID_ACCESS);
    return rpcCalls[0]?.params.p_caller_ip_hash as string | null;
  }

  it("prefere x-vercel-forwarded-for sobre x-forwarded-for", async () => {
    const hash = await capturedIpHash({
      "x-vercel-forwarded-for": "198.51.100.1",
      "x-forwarded-for": "203.0.113.9",
    });
    const expected = crypto
      .createHmac("sha256", VALID_SECRET)
      .update("198.51.100.1")
      .digest("hex");

    expect(hash).toBe(expected);
  });

  it("usa o primeiro IP da cadeia x-forwarded-for", async () => {
    const hash = await capturedIpHash({
      "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178",
    });
    const expected = crypto
      .createHmac("sha256", VALID_SECRET)
      .update("203.0.113.5")
      .digest("hex");

    expect(hash).toBe(expected);
  });

  it("cai para x-real-ip quando não há forwarded-for", async () => {
    const hash = await capturedIpHash({ "x-real-ip": "192.0.2.44" });
    const expected = crypto
      .createHmac("sha256", VALID_SECRET)
      .update("192.0.2.44")
      .digest("hex");

    expect(hash).toBe(expected);
  });

  it("é determinístico para o mesmo IP", async () => {
    const first = await capturedIpHash({ "x-real-ip": "192.0.2.44" });
    const second = await capturedIpHash({ "x-real-ip": "192.0.2.44" });

    expect(first).toBe(second);
  });

  it("produz hashes distintos para IPs distintos", async () => {
    const first = await capturedIpHash({ "x-real-ip": "192.0.2.44" });
    const second = await capturedIpHash({ "x-real-ip": "192.0.2.45" });

    expect(first).not.toBe(second);
  });

  it("nunca envia o IP em texto puro para a RPC", async () => {
    setHeaders({ "x-real-ip": "192.0.2.44" });
    const rpcCalls = setRpc({ data: { success: true }, error: null });

    await gatewayAccessComplaint(VALID_ACCESS);

    expect(JSON.stringify(rpcCalls[0].params)).not.toContain("192.0.2.44");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Contrato das RPCs
// ══════════════════════════════════════════════════════════════════════════

describe("contrato das RPCs", () => {
  it("acesso chama fn_access_complaint_v2 com os parâmetros esperados", async () => {
    const rpcCalls = setRpc({ data: { success: true }, error: null });

    await gatewayAccessComplaint(VALID_ACCESS);

    expect(rpcCalls[0].fn).toBe("fn_access_complaint_v2");
    expect(Object.keys(rpcCalls[0].params).sort()).toEqual([
      "p_caller_ip_hash",
      "p_pin_hash",
      "p_protocol",
    ]);
    // O PIN validado segue bruto para o hasher do banco (guard P0-02).
    expect(rpcCalls[0].params.p_pin_hash).toBe("123456");
  });

  it("mensagem chama fn_send_reporter_message_v2 com os parâmetros esperados", async () => {
    const rpcCalls = setRpc({ data: { success: true }, error: null });

    await gatewaySendReporterMessage(VALID_MESSAGE);

    expect(rpcCalls[0].fn).toBe("fn_send_reporter_message_v2");
    expect(Object.keys(rpcCalls[0].params).sort()).toEqual([
      "p_body",
      "p_caller_ip_hash",
      "p_pin_hash",
      "p_protocol",
    ]);
  });

  it("nunca chama as funções legadas v1", async () => {
    const rpcCalls = setRpc({ data: { success: true }, error: null });

    await gatewayAccessComplaint(VALID_ACCESS);
    await gatewaySendReporterMessage(VALID_MESSAGE);

    const names = rpcCalls.map((c) => c.fn);
    expect(names).not.toContain("fn_access_complaint");
    expect(names).not.toContain("fn_send_reporter_message");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Anti-enumeração e sanitização de erro
// ══════════════════════════════════════════════════════════════════════════

describe("anti-enumeração", () => {
  it("PIN incorreto e protocolo inexistente produzem mensagem idêntica", async () => {
    setRpc({ data: { success: false, error: "invalid_pin" }, error: null });
    const wrongPin = await gatewayAccessComplaint(VALID_ACCESS);

    setRpc({ data: { success: false, error: "not_found" }, error: null });
    const notFound = await gatewayAccessComplaint(VALID_ACCESS);

    expect(wrongPin.error).toBe(notFound.error);
    expect(wrongPin.error).toBe(GENERIC_ERROR);
  });

  it("erro do Supabase vira mensagem genérica, sem vazar detalhe interno", async () => {
    setRpc({
      data: null,
      error: { message: 'relation "complaints" does not exist', code: "42P01" },
    });

    const result = await gatewayAccessComplaint(VALID_ACCESS);

    expect(result.error).toBe(GENERIC_ERROR);
    expect(result.error).not.toContain("complaints");
    expect(result.error).not.toContain("42P01");
    expect(result.correlationId).toBeTruthy();
  });

  it("exceção inesperada não vaza stack trace", async () => {
    vi.mocked(createServiceClient).mockImplementation(() => {
      throw new Error("segredo interno: conexão recusada em 10.0.0.1");
    });

    const result = await gatewayAccessComplaint(VALID_ACCESS);

    expect(result.error).toBe(GENERIC_ERROR);
    expect(result.error).not.toContain("10.0.0.1");
  });

  it("correlation ID é distinto a cada chamada", async () => {
    setRpc({ data: { success: false, error: "not_found" }, error: null });

    const first = await gatewayAccessComplaint(VALID_ACCESS);
    const second = await gatewayAccessComplaint(VALID_ACCESS);

    expect(first.correlationId).not.toBe(second.correlationId);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Erros expostos deliberadamente ao usuário
// ══════════════════════════════════════════════════════════════════════════

describe("erros que o usuário precisa ver", () => {
  it("rate_limited tem mensagem própria, distinta da de autenticação", async () => {
    setRpc({ data: { success: false, error: "rate_limited" }, error: null });

    const result = await gatewayAccessComplaint(VALID_ACCESS);

    expect(result.error).toBe(RATE_LIMIT_ERROR);
    expect(result.error).not.toBe(GENERIC_ERROR);
  });

  it("complaint_closed tem mensagem própria no envio de mensagem", async () => {
    setRpc({ data: { success: false, error: "complaint_closed" }, error: null });

    const result = await gatewaySendReporterMessage(VALID_MESSAGE);

    expect(result.error).toBe(CLOSED_ERROR);
  });

  it("complaint_closed NÃO é exposto no fluxo de acesso (anti-enumeração)", async () => {
    setRpc({ data: { success: false, error: "complaint_closed" }, error: null });

    const result = await gatewayAccessComplaint(VALID_ACCESS);

    expect(result.error).toBe(GENERIC_ERROR);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Caminho de sucesso
// ══════════════════════════════════════════════════════════════════════════

describe("caminho de sucesso", () => {
  it("devolve denúncia e mensagens sanitizadas", async () => {
    const complaint = {
      status: "in_progress",
      category: "assedio_moral",
      severity: "high",
      is_anonymous: true,
      created_at: "2026-07-01T10:00:00Z",
      updated_at: "2026-07-02T10:00:00Z",
    };
    setRpc({
      data: {
        success: true,
        complaint,
        messages: [
          { id: "m1", sender_type: "reporter", body: "olá", created_at: "2026-07-01T10:05:00Z" },
        ],
      },
      error: null,
    });

    const result = await gatewayAccessComplaint(VALID_ACCESS);

    expect(result.success).toBe(true);
    expect(result.complaint).toEqual(complaint);
    expect(result.messages).toHaveLength(1);
  });

  it("normaliza mensagens ausentes para lista vazia", async () => {
    setRpc({ data: { success: true, complaint: undefined }, error: null });

    const result = await gatewayAccessComplaint(VALID_ACCESS);

    expect(result.messages).toEqual([]);
  });

  it("envio bem-sucedido não devolve mensagem de erro", async () => {
    setRpc({ data: { success: true, message_id: "m9" }, error: null });

    const result = await gatewaySendReporterMessage(VALID_MESSAGE);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
