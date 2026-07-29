/**
 * Schemas Zod do canal de denúncias — CONTRA O CÓDIGO REAL.
 *
 * Os schemas são a primeira barreira de validação e a base da allowlist de
 * campos. São código puro, sem dependência de Next.js ou Supabase, e por isso
 * testáveis diretamente.
 */

import { describe, expect, it } from "vitest";

import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_SEVERITIES,
  COMPLAINT_STATUSES,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  COMPLAINT_STATUS_LABELS,
  accessComplaintSchema,
  sendReporterMessageSchema,
  submitComplaintSchema,
  updateComplaintStatusSchema,
} from "@/lib/schemas/complaint";

// ══════════════════════════════════════════════════════════════════════════
// Allowlist de campos — .strict()
// ══════════════════════════════════════════════════════════════════════════

describe("allowlist de campos (.strict)", () => {
  it("accessComplaintSchema rejeita campo extra", () => {
    const result = accessComplaintSchema.safeParse({
      protocol: "ABC123",
      pin: "123456",
      tenant_id: "injetado",
    });

    expect(result.success).toBe(false);
  });

  it("sendReporterMessageSchema rejeita campo extra", () => {
    const result = sendReporterMessageSchema.safeParse({
      protocol: "ABC123",
      pin: "123456",
      body: "olá",
      sender_type: "investigator",
    });

    expect(result.success).toBe(false);
  });

  it("submitComplaintSchema rejeita campo extra", () => {
    const result = submitComplaintSchema.safeParse({
      tenant_slug: "org",
      subject: "Assunto válido",
      description: "Descrição suficientemente longa",
      pin: "123456",
      tenant_id: "injetado",
    });

    expect(result.success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Regras do PIN
// ══════════════════════════════════════════════════════════════════════════

describe("regras do PIN", () => {
  const invalid: Array<[string, string]> = [
    ["não numérico", "abcdef"],
    ["alfanumérico", "12ab56"],
    ["com espaço", "123 56"],
    ["curto demais", "123"],
    ["vazio", ""],
    ["com sinal", "-12345"],
    ["decimal", "123.45"],
  ];

  it.each(invalid)("acesso rejeita PIN %s", (_label, pin) => {
    expect(accessComplaintSchema.safeParse({ protocol: "ABC123", pin }).success).toBe(
      false
    );
  });

  it("acesso rejeita PIN acima de 32 dígitos", () => {
    const result = accessComplaintSchema.safeParse({
      protocol: "ABC123",
      pin: "1".repeat(33),
    });

    expect(result.success).toBe(false);
  });

  it("submissão exige no mínimo 6 dígitos, mais que os 4 do acesso", () => {
    const base = {
      tenant_slug: "org",
      subject: "Assunto válido",
      description: "Descrição suficientemente longa",
    };

    expect(submitComplaintSchema.safeParse({ ...base, pin: "1234" }).success).toBe(false);
    expect(submitComplaintSchema.safeParse({ ...base, pin: "123456" }).success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Normalização de protocolo
// ══════════════════════════════════════════════════════════════════════════

describe("normalização de protocolo", () => {
  it("converte para maiúsculas e remove espaços", () => {
    const result = accessComplaintSchema.parse({
      protocol: " ab c123 ",
      pin: "123456",
    });

    expect(result.protocol).toBe("ABC123");
  });

  it("rejeita protocolo acima de 20 caracteres", () => {
    const result = accessComplaintSchema.safeParse({
      protocol: "A".repeat(21),
      pin: "123456",
    });

    expect(result.success).toBe(false);
  });

  it("aceita exatamente 20 caracteres", () => {
    const result = accessComplaintSchema.safeParse({
      protocol: "A".repeat(20),
      pin: "123456",
    });

    expect(result.success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Corpo da mensagem
// ══════════════════════════════════════════════════════════════════════════

describe("corpo da mensagem", () => {
  const base = { protocol: "ABC123", pin: "123456" };

  it("rejeita corpo vazio", () => {
    expect(sendReporterMessageSchema.safeParse({ ...base, body: "" }).success).toBe(false);
  });

  it("aceita exatamente 10.000 caracteres", () => {
    expect(
      sendReporterMessageSchema.safeParse({ ...base, body: "x".repeat(10_000) }).success
    ).toBe(true);
  });

  it("rejeita 10.001 caracteres", () => {
    expect(
      sendReporterMessageSchema.safeParse({ ...base, body: "x".repeat(10_001) }).success
    ).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Submissão pública
// ══════════════════════════════════════════════════════════════════════════

describe("submissão pública", () => {
  const valid = {
    tenant_slug: "org",
    subject: "Assunto válido",
    description: "Descrição suficientemente longa",
    pin: "123456",
  };

  it("aplica anonimato como padrão", () => {
    expect(submitComplaintSchema.parse(valid).is_anonymous).toBe(true);
  });

  it("aplica categoria 'other' como padrão", () => {
    expect(submitComplaintSchema.parse(valid).category).toBe("other");
  });

  it("rejeita assunto com menos de 5 caracteres", () => {
    expect(submitComplaintSchema.safeParse({ ...valid, subject: "abcd" }).success).toBe(
      false
    );
  });

  it("rejeita descrição com menos de 10 caracteres", () => {
    expect(
      submitComplaintSchema.safeParse({ ...valid, description: "curta" }).success
    ).toBe(false);
  });

  it("rejeita e-mail malformado", () => {
    expect(
      submitComplaintSchema.safeParse({ ...valid, reporter_email: "nao-e-email" }).success
    ).toBe(false);
  });

  it("aceita e-mail vazio (campo opcional do denunciante anônimo)", () => {
    expect(
      submitComplaintSchema.safeParse({ ...valid, reporter_email: "" }).success
    ).toBe(true);
  });

  it("rejeita categoria fora do catálogo", () => {
    expect(
      submitComplaintSchema.safeParse({ ...valid, category: "categoria_inventada" })
        .success
    ).toBe(false);
  });

  it("exige tenant_slug", () => {
    expect(submitComplaintSchema.safeParse({ ...valid, tenant_slug: "" }).success).toBe(
      false
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Atualização de status
// ══════════════════════════════════════════════════════════════════════════

describe("atualização de status", () => {
  it("exige UUID válido para complaint_id", () => {
    expect(
      updateComplaintStatusSchema.safeParse({
        complaint_id: "nao-e-uuid",
        new_status: "resolved",
      }).success
    ).toBe(false);
  });

  it("rejeita status fora do enum", () => {
    expect(
      updateComplaintStatusSchema.safeParse({
        complaint_id: "aaaaaaaa-0000-4000-8000-000000000001",
        new_status: "status_inventado",
      }).success
    ).toBe(false);
  });

  it.each(COMPLAINT_STATUSES)("aceita o status catalogado '%s'", (status) => {
    expect(
      updateComplaintStatusSchema.safeParse({
        complaint_id: "aaaaaaaa-0000-4000-8000-000000000001",
        new_status: status,
      }).success
    ).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Integridade dos catálogos usados na interface
// ══════════════════════════════════════════════════════════════════════════

describe("catálogos", () => {
  it("todo status tem rótulo em português", () => {
    for (const status of COMPLAINT_STATUSES) {
      expect(COMPLAINT_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("toda severidade tem rótulo", () => {
    for (const severity of COMPLAINT_SEVERITIES) {
      expect(SEVERITY_LABELS[severity]).toBeTruthy();
    }
  });

  it("toda categoria tem rótulo", () => {
    for (const category of COMPLAINT_CATEGORIES) {
      expect(CATEGORY_LABELS[category]).toBeTruthy();
    }
  });
});
