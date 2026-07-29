/**
 * WhatsAppCloudProvider.parseWebhook — conversão de `tests/whatsapp-cloud.test.ts`.
 *
 * Este era o único dos quatro `.test.ts` que já importava o código real de
 * produção. A conversão preserva todas as asserções e troca o executor
 * artesanal (`test()` caseiro + `node:assert`) pelo Vitest.
 *
 * Nota de escopo: o Meta Cloud API é, por decisão registrada em
 * docs/baseline/architecture.md §6, o adaptador FUTURO. O provider
 * experimental principal passa a ser a Evolution API (Etapa 7). Este arquivo
 * é preservado — nada foi removido.
 */

import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { WhatsAppCloudProvider } from "@/lib/integrations/providers/whatsapp-cloud";

const provider = new WhatsAppCloudProvider({
  accessToken: "test-token",
  phoneNumberId: "123456",
});

const emptyHeaders: Record<string, string> = {};

/** Envolve um objeto de status no formato completo do webhook. */
function makePayload(statusObj: Record<string, unknown>) {
  return {
    entry: [{ changes: [{ value: { statuses: [statusObj] } }] }],
  };
}

/** Reproduz o eventId determinístico esperado. */
function expectedEventId(msgId: string, status: string): string {
  return crypto
    .createHash("sha256")
    .update(`whatsapp:${msgId}:${status}`)
    .digest("hex")
    .slice(0, 32);
}

// ══════════════════════════════════════════════════════════════════════════

describe("eventos normais", () => {
  it("status 'sent' produz WebhookEvent correto", () => {
    const event = provider.parseWebhook(
      makePayload({ id: "wamid.abc123", status: "sent", timestamp: "1700000000" }),
      emptyHeaders
    );

    expect(event).not.toBeNull();
    expect(event!.status).toBe("sent");
    expect(event!.providerId).toBe("wamid.abc123");
    expect(event!.rawEventType).toBe("whatsapp.sent");
    expect(event!.eventId).toBe(expectedEventId("wamid.abc123", "sent"));
    expect(event!.timestamp).toBe(new Date(1700000000 * 1000).toISOString());
    expect(event!.error).toBeUndefined();
  });

  it("status 'delivered' produz WebhookEvent correto", () => {
    const event = provider.parseWebhook(
      makePayload({ id: "wamid.def456", status: "delivered", timestamp: "1700000100" }),
      emptyHeaders
    );

    expect(event!.status).toBe("delivered");
    expect(event!.eventId).toBe(expectedEventId("wamid.def456", "delivered"));
  });

  it("status 'read' produz WebhookEvent correto", () => {
    const event = provider.parseWebhook(
      makePayload({ id: "wamid.ghi789", status: "read", timestamp: "1700000200" }),
      emptyHeaders
    );

    expect(event!.status).toBe("read");
    expect(event!.eventId).toBe(expectedEventId("wamid.ghi789", "read"));
  });

  it("status 'failed' carrega o erro do provedor", () => {
    const event = provider.parseWebhook(
      makePayload({
        id: "wamid.fail001",
        status: "failed",
        timestamp: "1700000300",
        errors: [{ code: 131026, title: "Message undeliverable" }],
      }),
      emptyHeaders
    );

    expect(event!.status).toBe("failed");
    expect(event!.error).toEqual({ code: "131026", message: "Message undeliverable" });
  });
});

describe("eventId determinístico (base da idempotência)", () => {
  it("mesmo messageId+status produz o mesmo eventId, ainda que o timestamp mude", () => {
    const first = provider.parseWebhook(
      makePayload({ id: "wamid.repeat001", status: "delivered", timestamp: "1700000400" }),
      emptyHeaders
    );
    const second = provider.parseWebhook(
      makePayload({ id: "wamid.repeat001", status: "delivered", timestamp: "1700000500" }),
      emptyHeaders
    );

    expect(first!.eventId).toBe(second!.eventId);
  });

  it("corresponde a sha256('whatsapp:{msgId}:{status}').slice(0,32)", () => {
    const event = provider.parseWebhook(
      makePayload({ id: "wamid.verify123", status: "sent", timestamp: "1700000600" }),
      emptyHeaders
    );

    expect(event!.eventId).toBe(expectedEventId("wamid.verify123", "sent"));
  });
});

describe("payloads rejeitados", () => {
  const rejected: Array<[string, Record<string, unknown>]> = [
    ["messageId ausente", { status: "sent", timestamp: "1700000700" }],
    ["messageId vazio", { id: "", status: "sent", timestamp: "1700000700" }],
    ["status ausente", { id: "wamid.nostatus", timestamp: "1700000800" }],
    ["status desconhecido 'billing'", { id: "wamid.b1", status: "billing", timestamp: "1700000900" }],
    ["status desconhecido 'accepted'", { id: "wamid.a1", status: "accepted", timestamp: "1700001000" }],
    ["timestamp ausente", { id: "wamid.nots001", status: "sent" }],
    ["timestamp lixo", { id: "wamid.g1", status: "sent", timestamp: "not-a-timestamp" }],
    ["timestamp com letras", { id: "wamid.g2", status: "sent", timestamp: "abcdef" }],
    ["timestamp anterior a 2000", { id: "wamid.old1", status: "sent", timestamp: "946684799" }],
    ["timestamp no limite de 2100", { id: "wamid.f1", status: "sent", timestamp: "4102444800" }],
    ["timestamp epoch 0", { id: "wamid.z1", status: "sent", timestamp: "0" }],
  ];

  it.each(rejected)("devolve null: %s", (_label, statusObj) => {
    expect(provider.parseWebhook(makePayload(statusObj), emptyHeaders)).toBeNull();
  });

  it("devolve null para payload vazio", () => {
    expect(provider.parseWebhook({}, emptyHeaders)).toBeNull();
  });

  it("devolve null sem array de statuses", () => {
    expect(
      provider.parseWebhook({ entry: [{ changes: [{ value: {} }] }] }, emptyHeaders)
    ).toBeNull();
  });

  it("devolve null com array de statuses vazio", () => {
    expect(
      provider.parseWebhook(
        { entry: [{ changes: [{ value: { statuses: [] } }] }] },
        emptyHeaders
      )
    ).toBeNull();
  });
});

describe("normalização de timestamp", () => {
  it("converte epoch Unix para ISO", () => {
    const event = provider.parseWebhook(
      makePayload({ id: "wamid.epoch001", status: "sent", timestamp: "1700000000" }),
      emptyHeaders
    );

    expect(event!.timestamp).toBe("2023-11-14T22:13:20.000Z");
  });

  it("preserva ISO já normalizado", () => {
    const iso = "2024-06-15T10:30:00.000Z";
    const event = provider.parseWebhook(
      makePayload({ id: "wamid.iso001", status: "delivered", timestamp: iso }),
      emptyHeaders
    );

    expect(event!.timestamp).toBe(iso);
  });

  it("normaliza ISO sem milissegundos", () => {
    const event = provider.parseWebhook(
      makePayload({ id: "wamid.iso002", status: "delivered", timestamp: "2024-06-15T10:30:00Z" }),
      emptyHeaders
    );

    expect(event!.timestamp).toBe("2024-06-15T10:30:00.000Z");
  });

  it("aceita exatamente o limite inferior (ano 2000)", () => {
    const event = provider.parseWebhook(
      makePayload({ id: "wamid.y2k001", status: "sent", timestamp: "946684800" }),
      emptyHeaders
    );

    expect(event).not.toBeNull();
    expect(event!.timestamp).toBe("2000-01-01T00:00:00.000Z");
  });
});

describe("metadados", () => {
  it("contém whatsapp_status e whatsapp_message_id", () => {
    const event = provider.parseWebhook(
      makePayload({ id: "wamid.meta001", status: "delivered", timestamp: "1700001100" }),
      emptyHeaders
    );

    expect(event!.metadata).toEqual({
      whatsapp_status: "delivered",
      whatsapp_message_id: "wamid.meta001",
    });
  });
});
