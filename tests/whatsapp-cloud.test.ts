/**
 * Unit tests for WhatsAppCloudProvider.parseWebhook
 *
 * Run: npx tsx tests/whatsapp-cloud.test.ts
 */

import assert from "node:assert/strict"
import crypto from "node:crypto"
import { WhatsAppCloudProvider } from "../src/lib/integrations/providers/whatsapp-cloud.ts"

const provider = new WhatsAppCloudProvider({
  accessToken: "test-token",
  phoneNumberId: "123456",
})

const emptyHeaders: Record<string, string> = {}

/** Helper: wrap a WhatsApp status object into the full webhook payload shape */
function makePayload(statusObj: Record<string, unknown>) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [statusObj],
            },
          },
        ],
      },
    ],
  }
}

/** Helper: compute the expected deterministic eventId */
function expectedEventId(msgId: string, status: string): string {
  return crypto
    .createHash("sha256")
    .update(`whatsapp:${msgId}:${status}`)
    .digest("hex")
    .slice(0, 32)
}

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  PASS  ${name}`)
  } catch (err) {
    failed++
    console.error(`  FAIL  ${name}`)
    console.error(`        ${err instanceof Error ? err.message : err}`)
  }
}

console.log("WhatsAppCloudProvider.parseWebhook\n")

// ─── Normal events ─────────────────────────────────────────────────────

test("sent status produces correct WebhookEvent", () => {
  const payload = makePayload({
    id: "wamid.abc123",
    status: "sent",
    timestamp: "1700000000",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.notEqual(event, null)
  assert.equal(event!.status, "sent")
  assert.equal(event!.providerId, "wamid.abc123")
  assert.equal(event!.rawEventType, "whatsapp.sent")
  assert.equal(event!.eventId, expectedEventId("wamid.abc123", "sent"))
  assert.equal(event!.timestamp, new Date(1700000000 * 1000).toISOString())
  assert.equal(event!.error, undefined)
})

test("delivered status produces correct WebhookEvent", () => {
  const payload = makePayload({
    id: "wamid.def456",
    status: "delivered",
    timestamp: "1700000100",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.notEqual(event, null)
  assert.equal(event!.status, "delivered")
  assert.equal(event!.eventId, expectedEventId("wamid.def456", "delivered"))
})

test("read status produces correct WebhookEvent", () => {
  const payload = makePayload({
    id: "wamid.ghi789",
    status: "read",
    timestamp: "1700000200",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.notEqual(event, null)
  assert.equal(event!.status, "read")
  assert.equal(event!.eventId, expectedEventId("wamid.ghi789", "read"))
})

test("failed status produces correct WebhookEvent with error", () => {
  const payload = makePayload({
    id: "wamid.fail001",
    status: "failed",
    timestamp: "1700000300",
    errors: [{ code: 131026, title: "Message undeliverable" }],
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.notEqual(event, null)
  assert.equal(event!.status, "failed")
  assert.deepEqual(event!.error, {
    code: "131026",
    message: "Message undeliverable",
  })
})

// ─── Deterministic eventId ─────────────────────────────────────────────

test("repeated event with same messageId+status produces same deterministic eventId", () => {
  const payload1 = makePayload({
    id: "wamid.repeat001",
    status: "delivered",
    timestamp: "1700000400",
  })
  const payload2 = makePayload({
    id: "wamid.repeat001",
    status: "delivered",
    timestamp: "1700000500", // different timestamp, same id+status
  })
  const event1 = provider.parseWebhook(payload1, emptyHeaders)
  const event2 = provider.parseWebhook(payload2, emptyHeaders)
  assert.notEqual(event1, null)
  assert.notEqual(event2, null)
  assert.equal(event1!.eventId, event2!.eventId)
})

test("deterministic eventId matches sha256('whatsapp:{msgId}:{status}').slice(0,32)", () => {
  const msgId = "wamid.verify123"
  const status = "sent"
  const payload = makePayload({
    id: msgId,
    status,
    timestamp: "1700000600",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  const manualHash = crypto
    .createHash("sha256")
    .update(`whatsapp:${msgId}:${status}`)
    .digest("hex")
    .slice(0, 32)
  assert.equal(event!.eventId, manualHash)
})

// ─── Missing messageId ─────────────────────────────────────────────────

test("missing messageId returns null", () => {
  const payload = makePayload({
    status: "sent",
    timestamp: "1700000700",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

test("empty string messageId returns null", () => {
  const payload = makePayload({
    id: "",
    status: "sent",
    timestamp: "1700000700",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

// ─── Missing status ────────────────────────────────────────────────────

test("missing status returns null", () => {
  const payload = makePayload({
    id: "wamid.nostatus",
    timestamp: "1700000800",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

// ─── Unknown status type ───────────────────────────────────────────────

test("unknown status type (e.g. 'billing') returns null", () => {
  const payload = makePayload({
    id: "wamid.billing001",
    status: "billing",
    timestamp: "1700000900",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

test("unknown status type 'accepted' returns null", () => {
  const payload = makePayload({
    id: "wamid.accepted001",
    status: "accepted",
    timestamp: "1700001000",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

// ─── Timestamp: Unix epoch ─────────────────────────────────────────────

test("Unix epoch timestamp converts to ISO correctly", () => {
  const epochStr = "1700000000" // 2023-11-14T22:13:20.000Z
  const payload = makePayload({
    id: "wamid.epoch001",
    status: "sent",
    timestamp: epochStr,
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.notEqual(event, null)
  const expected = new Date(1700000000 * 1000).toISOString()
  assert.equal(event!.timestamp, expected)
  assert.equal(event!.timestamp, "2023-11-14T22:13:20.000Z")
})

// ─── Timestamp: ISO string ─────────────────────────────────────────────

test("ISO timestamp is kept as-is (normalized)", () => {
  const isoStr = "2024-06-15T10:30:00.000Z"
  const payload = makePayload({
    id: "wamid.iso001",
    status: "delivered",
    timestamp: isoStr,
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.notEqual(event, null)
  assert.equal(event!.timestamp, isoStr)
})

test("ISO timestamp without milliseconds is normalized", () => {
  const isoStr = "2024-06-15T10:30:00Z"
  const payload = makePayload({
    id: "wamid.iso002",
    status: "delivered",
    timestamp: isoStr,
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.notEqual(event, null)
  // new Date().toISOString() always includes milliseconds
  assert.equal(event!.timestamp, "2024-06-15T10:30:00.000Z")
})

// ─── Timestamp: invalid / garbage ──────────────────────────────────────

test("invalid timestamp (garbage string) returns null", () => {
  const payload = makePayload({
    id: "wamid.garbage001",
    status: "sent",
    timestamp: "not-a-timestamp",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

test("invalid timestamp (random letters) returns null", () => {
  const payload = makePayload({
    id: "wamid.garbage002",
    status: "sent",
    timestamp: "abcdef",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

// ─── Timestamp: missing ────────────────────────────────────────────────

test("missing timestamp returns null", () => {
  const payload = makePayload({
    id: "wamid.nots001",
    status: "sent",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

// ─── Timestamp: boundary validation ────────────────────────────────────

test("timestamp before year 2000 returns null", () => {
  // 1999-12-31T23:59:59Z = epoch 946684799
  const payload = makePayload({
    id: "wamid.old001",
    status: "sent",
    timestamp: "946684799",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

test("timestamp at year 2000 boundary is accepted", () => {
  // 2000-01-01T00:00:00Z = epoch 946684800
  const payload = makePayload({
    id: "wamid.y2k001",
    status: "sent",
    timestamp: "946684800",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.notEqual(event, null)
  assert.equal(event!.timestamp, "2000-01-01T00:00:00.000Z")
})

test("timestamp at year 2100 boundary returns null", () => {
  // 2100-01-01T00:00:00Z = epoch 4102444800
  const payload = makePayload({
    id: "wamid.future001",
    status: "sent",
    timestamp: "4102444800",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

test("timestamp epoch 0 (1970) returns null", () => {
  const payload = makePayload({
    id: "wamid.zero001",
    status: "sent",
    timestamp: "0",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

// ─── Edge cases: empty/malformed payload ───────────────────────────────

test("empty payload returns null", () => {
  const event = provider.parseWebhook({}, emptyHeaders)
  assert.equal(event, null)
})

test("payload with no statuses array returns null", () => {
  const payload = {
    entry: [{ changes: [{ value: {} }] }],
  }
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

test("payload with empty statuses array returns null", () => {
  const payload = {
    entry: [{ changes: [{ value: { statuses: [] } }] }],
  }
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.equal(event, null)
})

// ─── Metadata ──────────────────────────────────────────────────────────

test("metadata contains whatsapp_status and whatsapp_message_id", () => {
  const payload = makePayload({
    id: "wamid.meta001",
    status: "delivered",
    timestamp: "1700001100",
  })
  const event = provider.parseWebhook(payload, emptyHeaders)
  assert.notEqual(event, null)
  assert.deepEqual(event!.metadata, {
    whatsapp_status: "delivered",
    whatsapp_message_id: "wamid.meta001",
  })
})

// ─── Summary ───────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
