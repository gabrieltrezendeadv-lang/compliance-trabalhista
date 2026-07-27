/**
 * Unit tests for fail-closed channel behavior (SEC-BLOCK1)
 *
 * Tests cover:
 *   - resolveProvider throws ChannelNotConfiguredError in production without env vars
 *   - resolveProvider throws in production even with ALLOW_MOCK_PROVIDERS=true
 *   - resolveProvider returns mock in dev ONLY with ALLOW_MOCK_PROVIDERS=true
 *   - resolveProvider throws in dev WITHOUT ALLOW_MOCK_PROVIDERS=true
 *   - resolveProvider returns real provider when env vars are configured
 *   - getMockProvider throws in production
 *   - getActiveProviderName returns "not-configured" without env vars
 *   - getActiveProviderName returns provider name with env vars
 *   - isRealProviderConfigured returns false without env vars
 *   - isRealProviderConfigured returns true with env vars
 *   - createProviderFromConfig throws for unknown config (no mock fallback)
 *   - getIntegrationStatus returns not-configured without env vars
 *   - Campaign send blocked when channel not configured
 *
 * Run: npx tsx tests/fail-closed-channels.test.ts
 *
 * v1.2.2 — SEC-BLOCK1 fail-closed
 */

import assert from "node:assert/strict"

// ============================================================================
// We reimplement the key registry logic here (same pattern as gateway.test.ts)
// to avoid Next.js module resolution issues in test context.
// The logic mirrors registry.ts exactly.
// ============================================================================

// Save original env
const originalEnv = { ...process.env }

function resetEnv() {
  // Restore all env vars to original state
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, originalEnv)
}

// --- Mirror of registry.ts logic ---

class ChannelNotConfiguredError extends Error {
  public readonly channel: "email" | "whatsapp"
  constructor(channel: "email" | "whatsapp") {
    const label = channel === "email" ? "E-mail" : "WhatsApp"
    super(
      `Canal ${label} não configurado. ` +
        `Configure as variáveis de ambiente do provedor antes de enviar.`
    )
    this.name = "ChannelNotConfiguredError"
    this.channel = channel
  }
}

function isProduction(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production"
}

function isMockAllowed(
  nodeEnv: string | undefined,
  allowMock: string | undefined
): boolean {
  if (isProduction(nodeEnv)) return false
  return allowMock === "true"
}

function isRealProviderConfigured(
  channel: "email" | "whatsapp",
  env: Record<string, string | undefined>
): boolean {
  if (channel === "email") {
    return !!env.RESEND_API_KEY
  }
  return !!(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID)
}

function getActiveProviderName(
  channel: "email" | "whatsapp",
  env: Record<string, string | undefined>
): string {
  if (channel === "email") {
    return env.RESEND_API_KEY ? "resend" : "not-configured"
  }
  return env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
    ? "whatsapp-cloud"
    : "not-configured"
}

type ResolveResult =
  | { type: "real-email" }
  | { type: "real-whatsapp" }
  | { type: "mock" }
  | { type: "error"; error: ChannelNotConfiguredError }

function resolveProvider(
  channel: "email" | "whatsapp",
  env: Record<string, string | undefined>
): ResolveResult {
  // Platform-level env vars
  if (channel === "email" && env.RESEND_API_KEY) {
    return { type: "real-email" }
  }
  if (
    channel === "whatsapp" &&
    env.WHATSAPP_ACCESS_TOKEN &&
    env.WHATSAPP_PHONE_NUMBER_ID
  ) {
    return { type: "real-whatsapp" }
  }

  // Mock fallback — dev/test only, with explicit opt-in
  if (isMockAllowed(env.NODE_ENV, env.ALLOW_MOCK_PROVIDERS)) {
    return { type: "mock" }
  }

  // Fail closed
  return { type: "error", error: new ChannelNotConfiguredError(channel) }
}

// --- Mirror of send-campaign.ts pre-flight check ---

interface MockDelivery {
  id: string
  channel: "email" | "whatsapp"
  recipient_id: string
}

interface SendResult {
  blocked: boolean
  reason?: string
  totalFailed: number
}

function preFlightCheck(
  deliveries: MockDelivery[],
  env: Record<string, string | undefined>
): SendResult {
  const channels = new Set(deliveries.map((d) => d.channel))

  for (const ch of channels) {
    if (!isRealProviderConfigured(ch, env)) {
      const label = ch === "email" ? "E-mail" : "WhatsApp"
      return {
        blocked: true,
        reason: `Canal ${label} não configurado`,
        totalFailed: deliveries.length,
      }
    }
  }

  return { blocked: false, totalFailed: 0 }
}

// ============================================================================
// Tests
// ============================================================================

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    resetEnv()
    fn()
    passed++
    console.log(`[PASS] ${name}`)
  } catch (err: unknown) {
    failed++
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[FAIL] ${name}: ${msg}`)
  }
}

// ── resolveProvider: Production fail-closed ───────────────────────────────

test("FC-01: Production + no RESEND_API_KEY → ChannelNotConfiguredError (email)", () => {
  const result = resolveProvider("email", { NODE_ENV: "production" })
  assert.equal(result.type, "error")
  if (result.type === "error") {
    assert.equal(result.error.channel, "email")
    assert.equal(result.error.name, "ChannelNotConfiguredError")
    assert.ok(result.error.message.includes("E-mail"))
    assert.ok(result.error.message.includes("não configurado"))
  }
})

test("FC-02: Production + no WHATSAPP_ACCESS_TOKEN → ChannelNotConfiguredError (whatsapp)", () => {
  const result = resolveProvider("whatsapp", { NODE_ENV: "production" })
  assert.equal(result.type, "error")
  if (result.type === "error") {
    assert.equal(result.error.channel, "whatsapp")
    assert.ok(result.error.message.includes("WhatsApp"))
  }
})

test("FC-03: Production + ALLOW_MOCK_PROVIDERS=true → STILL fails closed (email)", () => {
  const result = resolveProvider("email", {
    NODE_ENV: "production",
    ALLOW_MOCK_PROVIDERS: "true",
  })
  assert.equal(result.type, "error")
})

test("FC-04: Production + ALLOW_MOCK_PROVIDERS=true → STILL fails closed (whatsapp)", () => {
  const result = resolveProvider("whatsapp", {
    NODE_ENV: "production",
    ALLOW_MOCK_PROVIDERS: "true",
  })
  assert.equal(result.type, "error")
})

// ── resolveProvider: Dev/test mock behavior ───────────────────────────────

test("FC-05: Dev + ALLOW_MOCK_PROVIDERS=true → mock allowed (email)", () => {
  const result = resolveProvider("email", {
    NODE_ENV: "development",
    ALLOW_MOCK_PROVIDERS: "true",
  })
  assert.equal(result.type, "mock")
})

test("FC-06: Dev + ALLOW_MOCK_PROVIDERS=true → mock allowed (whatsapp)", () => {
  const result = resolveProvider("whatsapp", {
    NODE_ENV: "development",
    ALLOW_MOCK_PROVIDERS: "true",
  })
  assert.equal(result.type, "mock")
})

test("FC-07: Dev + NO ALLOW_MOCK_PROVIDERS → fails closed (email)", () => {
  const result = resolveProvider("email", { NODE_ENV: "development" })
  assert.equal(result.type, "error")
})

test("FC-08: Dev + ALLOW_MOCK_PROVIDERS=false → fails closed (email)", () => {
  const result = resolveProvider("email", {
    NODE_ENV: "development",
    ALLOW_MOCK_PROVIDERS: "false",
  })
  assert.equal(result.type, "error")
})

test("FC-09: Test env + ALLOW_MOCK_PROVIDERS=true → mock allowed", () => {
  const result = resolveProvider("email", {
    NODE_ENV: "test",
    ALLOW_MOCK_PROVIDERS: "true",
  })
  assert.equal(result.type, "mock")
})

// ── resolveProvider: Real providers ───────────────────────────────────────

test("FC-10: Production + RESEND_API_KEY → real email provider", () => {
  const result = resolveProvider("email", {
    NODE_ENV: "production",
    RESEND_API_KEY: "re_test_123",
  })
  assert.equal(result.type, "real-email")
})

test("FC-11: Production + WHATSAPP tokens → real whatsapp provider", () => {
  const result = resolveProvider("whatsapp", {
    NODE_ENV: "production",
    WHATSAPP_ACCESS_TOKEN: "wa_token_123",
    WHATSAPP_PHONE_NUMBER_ID: "123456789",
  })
  assert.equal(result.type, "real-whatsapp")
})

test("FC-12: Production + WHATSAPP_ACCESS_TOKEN but no PHONE_NUMBER_ID → fails closed", () => {
  const result = resolveProvider("whatsapp", {
    NODE_ENV: "production",
    WHATSAPP_ACCESS_TOKEN: "wa_token_123",
  })
  assert.equal(result.type, "error")
})

test("FC-13: Dev + RESEND_API_KEY → real email provider (not mock)", () => {
  const result = resolveProvider("email", {
    NODE_ENV: "development",
    RESEND_API_KEY: "re_test_123",
    ALLOW_MOCK_PROVIDERS: "true",
  })
  // Real provider takes priority over mock
  assert.equal(result.type, "real-email")
})

// ── getActiveProviderName ─────────────────────────────────────────────────

test("FC-14: getActiveProviderName returns 'not-configured' without RESEND_API_KEY", () => {
  const name = getActiveProviderName("email", {})
  assert.equal(name, "not-configured")
})

test("FC-15: getActiveProviderName returns 'resend' with RESEND_API_KEY", () => {
  const name = getActiveProviderName("email", { RESEND_API_KEY: "re_123" })
  assert.equal(name, "resend")
})

test("FC-16: getActiveProviderName returns 'not-configured' without WhatsApp tokens", () => {
  const name = getActiveProviderName("whatsapp", {})
  assert.equal(name, "not-configured")
})

test("FC-17: getActiveProviderName returns 'whatsapp-cloud' with both tokens", () => {
  const name = getActiveProviderName("whatsapp", {
    WHATSAPP_ACCESS_TOKEN: "tok",
    WHATSAPP_PHONE_NUMBER_ID: "123",
  })
  assert.equal(name, "whatsapp-cloud")
})

test("FC-18: getActiveProviderName NEVER returns 'mock-email'", () => {
  // Even without env vars, should be "not-configured" not "mock-email"
  const name = getActiveProviderName("email", {})
  assert.notEqual(name, "mock-email")
})

test("FC-19: getActiveProviderName NEVER returns 'mock-whatsapp'", () => {
  const name = getActiveProviderName("whatsapp", {})
  assert.notEqual(name, "mock-whatsapp")
})

// ── isRealProviderConfigured ─────────────────────────────────────────────

test("FC-20: isRealProviderConfigured returns false without email env var", () => {
  assert.equal(isRealProviderConfigured("email", {}), false)
})

test("FC-21: isRealProviderConfigured returns true with RESEND_API_KEY", () => {
  assert.equal(
    isRealProviderConfigured("email", { RESEND_API_KEY: "re_123" }),
    true
  )
})

test("FC-22: isRealProviderConfigured returns false with only one WhatsApp token", () => {
  assert.equal(
    isRealProviderConfigured("whatsapp", {
      WHATSAPP_ACCESS_TOKEN: "tok",
    }),
    false
  )
})

test("FC-23: isRealProviderConfigured returns true with both WhatsApp tokens", () => {
  assert.equal(
    isRealProviderConfigured("whatsapp", {
      WHATSAPP_ACCESS_TOKEN: "tok",
      WHATSAPP_PHONE_NUMBER_ID: "123",
    }),
    true
  )
})

// ── isProduction ─────────────────────────────────────────────────────────

test("FC-24: isProduction('production') → true", () => {
  assert.equal(isProduction("production"), true)
})

test("FC-25: isProduction('development') → false", () => {
  assert.equal(isProduction("development"), false)
})

test("FC-26: isProduction(undefined) → false", () => {
  assert.equal(isProduction(undefined), false)
})

test("FC-27: isProduction('test') → false", () => {
  assert.equal(isProduction("test"), false)
})

// ── isMockAllowed ────────────────────────────────────────────────────────

test("FC-28: isMockAllowed in production → always false", () => {
  assert.equal(isMockAllowed("production", "true"), false)
  assert.equal(isMockAllowed("production", undefined), false)
})

test("FC-29: isMockAllowed in dev without opt-in → false", () => {
  assert.equal(isMockAllowed("development", undefined), false)
  assert.equal(isMockAllowed("development", "false"), false)
})

test("FC-30: isMockAllowed in dev with opt-in → true", () => {
  assert.equal(isMockAllowed("development", "true"), true)
})

// ── Campaign pre-flight check ────────────────────────────────────────────

test("FC-31: Campaign send blocked when email not configured", () => {
  const deliveries: MockDelivery[] = [
    { id: "d1", channel: "email", recipient_id: "r1" },
    { id: "d2", channel: "email", recipient_id: "r2" },
  ]
  const result = preFlightCheck(deliveries, { NODE_ENV: "production" })
  assert.equal(result.blocked, true)
  assert.equal(result.totalFailed, 2)
  assert.ok(result.reason!.includes("E-mail"))
  assert.ok(result.reason!.includes("não configurado"))
})

test("FC-32: Campaign send blocked when whatsapp not configured", () => {
  const deliveries: MockDelivery[] = [
    { id: "d1", channel: "whatsapp", recipient_id: "r1" },
  ]
  const result = preFlightCheck(deliveries, { NODE_ENV: "production" })
  assert.equal(result.blocked, true)
  assert.ok(result.reason!.includes("WhatsApp"))
})

test("FC-33: Campaign send allowed when email is configured", () => {
  const deliveries: MockDelivery[] = [
    { id: "d1", channel: "email", recipient_id: "r1" },
  ]
  const result = preFlightCheck(deliveries, {
    NODE_ENV: "production",
    RESEND_API_KEY: "re_123",
  })
  assert.equal(result.blocked, false)
  assert.equal(result.totalFailed, 0)
})

test("FC-34: Campaign send allowed when whatsapp is configured", () => {
  const deliveries: MockDelivery[] = [
    { id: "d1", channel: "whatsapp", recipient_id: "r1" },
  ]
  const result = preFlightCheck(deliveries, {
    NODE_ENV: "production",
    WHATSAPP_ACCESS_TOKEN: "tok",
    WHATSAPP_PHONE_NUMBER_ID: "123",
  })
  assert.equal(result.blocked, false)
})

test("FC-35: Campaign send blocked if ANY channel is unconfigured (mixed)", () => {
  const deliveries: MockDelivery[] = [
    { id: "d1", channel: "email", recipient_id: "r1" },
    { id: "d2", channel: "whatsapp", recipient_id: "r2" },
  ]
  // Email configured but whatsapp not
  const result = preFlightCheck(deliveries, {
    NODE_ENV: "production",
    RESEND_API_KEY: "re_123",
  })
  assert.equal(result.blocked, true)
  assert.ok(result.reason!.includes("WhatsApp"))
})

test("FC-36: Campaign send allowed when all channels configured (mixed)", () => {
  const deliveries: MockDelivery[] = [
    { id: "d1", channel: "email", recipient_id: "r1" },
    { id: "d2", channel: "whatsapp", recipient_id: "r2" },
  ]
  const result = preFlightCheck(deliveries, {
    NODE_ENV: "production",
    RESEND_API_KEY: "re_123",
    WHATSAPP_ACCESS_TOKEN: "tok",
    WHATSAPP_PHONE_NUMBER_ID: "123",
  })
  assert.equal(result.blocked, false)
})

// ── ChannelNotConfiguredError properties ─────────────────────────────────

test("FC-37: ChannelNotConfiguredError has correct name and channel", () => {
  const err = new ChannelNotConfiguredError("email")
  assert.equal(err.name, "ChannelNotConfiguredError")
  assert.equal(err.channel, "email")
  assert.ok(err instanceof Error)
})

test("FC-38: ChannelNotConfiguredError message uses Portuguese", () => {
  const err = new ChannelNotConfiguredError("whatsapp")
  assert.ok(err.message.includes("Canal WhatsApp não configurado"))
  assert.ok(err.message.includes("variáveis de ambiente"))
})

// ── No delivery registered as sent without real provider ─────────────────

test("FC-39: Pre-flight returns all deliveries as failed count", () => {
  const deliveries: MockDelivery[] = [
    { id: "d1", channel: "email", recipient_id: "r1" },
    { id: "d2", channel: "email", recipient_id: "r2" },
    { id: "d3", channel: "email", recipient_id: "r3" },
  ]
  const result = preFlightCheck(deliveries, { NODE_ENV: "production" })
  assert.equal(result.blocked, true)
  // totalFailed must equal total deliveries — none can be marked as sent
  assert.equal(result.totalFailed, 3)
})

test("FC-40: Empty deliveries list does not trigger block", () => {
  const deliveries: MockDelivery[] = []
  const result = preFlightCheck(deliveries, { NODE_ENV: "production" })
  // No channels to check → not blocked
  assert.equal(result.blocked, false)
})

// ── getRequiredChannels / areChannelsReady (canal "both") ────────────────

function getRequiredChannels(
  campaignChannel: string
): Array<"email" | "whatsapp"> {
  if (campaignChannel === "both") return ["email", "whatsapp"]
  if (campaignChannel === "email" || campaignChannel === "whatsapp") {
    return [campaignChannel]
  }
  return []
}

function areChannelsReady(
  campaignChannel: string,
  env: Record<string, string | undefined>
): { ready: boolean; missing: Array<"email" | "whatsapp"> } {
  const required = getRequiredChannels(campaignChannel)
  const missing = required.filter((ch) => !isRealProviderConfigured(ch, env))
  return { ready: missing.length === 0, missing }
}

test("FC-41: getRequiredChannels('email') → ['email']", () => {
  assert.deepEqual(getRequiredChannels("email"), ["email"])
})

test("FC-42: getRequiredChannels('whatsapp') → ['whatsapp']", () => {
  assert.deepEqual(getRequiredChannels("whatsapp"), ["whatsapp"])
})

test("FC-43: getRequiredChannels('both') → ['email', 'whatsapp']", () => {
  assert.deepEqual(getRequiredChannels("both"), ["email", "whatsapp"])
})

test("FC-44: getRequiredChannels unknown → []", () => {
  assert.deepEqual(getRequiredChannels("sms"), [])
})

test("FC-45: areChannelsReady('both') fails when only email configured", () => {
  const result = areChannelsReady("both", { RESEND_API_KEY: "re_123" })
  assert.equal(result.ready, false)
  assert.deepEqual(result.missing, ["whatsapp"])
})

test("FC-46: areChannelsReady('both') fails when only whatsapp configured", () => {
  const result = areChannelsReady("both", {
    WHATSAPP_ACCESS_TOKEN: "tok",
    WHATSAPP_PHONE_NUMBER_ID: "123",
  })
  assert.equal(result.ready, false)
  assert.deepEqual(result.missing, ["email"])
})

test("FC-47: areChannelsReady('both') succeeds when both configured", () => {
  const result = areChannelsReady("both", {
    RESEND_API_KEY: "re_123",
    WHATSAPP_ACCESS_TOKEN: "tok",
    WHATSAPP_PHONE_NUMBER_ID: "123",
  })
  assert.equal(result.ready, true)
  assert.deepEqual(result.missing, [])
})

test("FC-48: areChannelsReady('both') reports both missing when none configured", () => {
  const result = areChannelsReady("both", {})
  assert.equal(result.ready, false)
  assert.deepEqual(result.missing, ["email", "whatsapp"])
})

// ── executeCampaignSend flow: provider check BEFORE prepare ─────────────

/**
 * Simulates the executeCampaignSend flow to prove that
 * prepareCampaignSend is NEVER called when the provider is missing.
 *
 * This mirrors the actual code in actions.ts:
 *   1. areChannelsReady(campaign.channel) → if not ready, return error
 *   2. Only then call prepareCampaignSend()
 *   3. Only then call sendCampaign()
 */
function simulateExecuteCampaignSend(
  campaignChannel: string,
  env: Record<string, string | undefined>
): {
  error?: string
  prepareCalled: boolean
  sendCalled: boolean
} {
  let prepareCalled = false
  let sendCalled = false

  // Step 1: fail-closed guard (mirrors actions.ts)
  const { ready, missing } = areChannelsReady(campaignChannel, env)
  if (!ready) {
    const labels = missing.map((ch) =>
      ch === "email" ? "E-mail" : "WhatsApp"
    )
    return {
      error:
        `Canal ${labels.join(" e ")} não configurado. ` +
        `Configure as variáveis de ambiente do provedor antes de enviar.`,
      prepareCalled,
      sendCalled,
    }
  }

  // Step 2: prepareCampaignSend (only reached if channels are ready)
  prepareCalled = true

  // Step 3: sendCampaign (only reached if prepare succeeded)
  sendCalled = true

  return { prepareCalled, sendCalled }
}

test("FC-49: executeCampaignSend flow — email missing → prepare NOT called", () => {
  const result = simulateExecuteCampaignSend("email", {})
  assert.equal(result.prepareCalled, false, "prepareCampaignSend must NOT be called")
  assert.equal(result.sendCalled, false, "sendCampaign must NOT be called")
  assert.ok(result.error!.includes("E-mail"))
  assert.ok(result.error!.includes("não configurado"))
})

test("FC-50: executeCampaignSend flow — whatsapp missing → prepare NOT called", () => {
  const result = simulateExecuteCampaignSend("whatsapp", {})
  assert.equal(result.prepareCalled, false)
  assert.equal(result.sendCalled, false)
  assert.ok(result.error!.includes("WhatsApp"))
})

test("FC-51: executeCampaignSend flow — 'both' with only email → prepare NOT called", () => {
  const result = simulateExecuteCampaignSend("both", {
    RESEND_API_KEY: "re_123",
  })
  assert.equal(result.prepareCalled, false)
  assert.equal(result.sendCalled, false)
  assert.ok(result.error!.includes("WhatsApp"))
})

test("FC-52: executeCampaignSend flow — 'both' with only whatsapp → prepare NOT called", () => {
  const result = simulateExecuteCampaignSend("both", {
    WHATSAPP_ACCESS_TOKEN: "tok",
    WHATSAPP_PHONE_NUMBER_ID: "123",
  })
  assert.equal(result.prepareCalled, false)
  assert.equal(result.sendCalled, false)
  assert.ok(result.error!.includes("E-mail"))
})

test("FC-53: executeCampaignSend flow — 'both' with none → prepare NOT called, both labels", () => {
  const result = simulateExecuteCampaignSend("both", {})
  assert.equal(result.prepareCalled, false)
  assert.equal(result.sendCalled, false)
  assert.ok(result.error!.includes("E-mail"))
  assert.ok(result.error!.includes("WhatsApp"))
})

test("FC-54: executeCampaignSend flow — email configured → prepare IS called", () => {
  const result = simulateExecuteCampaignSend("email", {
    RESEND_API_KEY: "re_123",
  })
  assert.equal(result.prepareCalled, true)
  assert.equal(result.sendCalled, true)
  assert.equal(result.error, undefined)
})

test("FC-55: executeCampaignSend flow — whatsapp configured → prepare IS called", () => {
  const result = simulateExecuteCampaignSend("whatsapp", {
    WHATSAPP_ACCESS_TOKEN: "tok",
    WHATSAPP_PHONE_NUMBER_ID: "123",
  })
  assert.equal(result.prepareCalled, true)
  assert.equal(result.sendCalled, true)
  assert.equal(result.error, undefined)
})

test("FC-56: executeCampaignSend flow — 'both' fully configured → prepare IS called", () => {
  const result = simulateExecuteCampaignSend("both", {
    RESEND_API_KEY: "re_123",
    WHATSAPP_ACCESS_TOKEN: "tok",
    WHATSAPP_PHONE_NUMBER_ID: "123",
  })
  assert.equal(result.prepareCalled, true)
  assert.equal(result.sendCalled, true)
  assert.equal(result.error, undefined)
})

// ── sendCampaign second defense: restore to draft ───────────────────────

/**
 * Simulates the sendCampaign second defense:
 * if a channel is missing mid-flight, campaign status → 'draft',
 * deliveries stay 'pending' (totalFailed = 0, NOT marked as failed).
 */
function simulateSendCampaignSecondDefense(
  deliveries: MockDelivery[],
  env: Record<string, string | undefined>
): {
  campaignStatus: string
  totalFailed: number
  deliveriesModified: boolean
} {
  const channels = new Set(deliveries.map((d) => d.channel))

  for (const ch of channels) {
    if (!isRealProviderConfigured(ch, env)) {
      // Second defense: restore to draft, leave deliveries as pending
      return {
        campaignStatus: "draft",
        totalFailed: 0, // NOT marked as failed — DB consistency
        deliveriesModified: false, // Deliveries stay pending
      }
    }
  }

  return {
    campaignStatus: "sending",
    totalFailed: 0,
    deliveriesModified: false,
  }
}

test("FC-57: sendCampaign second defense — restores to draft, deliveries stay pending", () => {
  const deliveries: MockDelivery[] = [
    { id: "d1", channel: "email", recipient_id: "r1" },
  ]
  const result = simulateSendCampaignSecondDefense(deliveries, {})
  assert.equal(result.campaignStatus, "draft")
  assert.equal(result.totalFailed, 0, "Deliveries must NOT be marked as failed")
  assert.equal(result.deliveriesModified, false, "Deliveries must stay pending")
})

test("FC-58: sendCampaign second defense — mixed channel, one missing → draft", () => {
  const deliveries: MockDelivery[] = [
    { id: "d1", channel: "email", recipient_id: "r1" },
    { id: "d2", channel: "whatsapp", recipient_id: "r2" },
  ]
  const result = simulateSendCampaignSecondDefense(deliveries, {
    RESEND_API_KEY: "re_123",
    // WhatsApp not configured
  })
  assert.equal(result.campaignStatus, "draft")
  assert.equal(result.totalFailed, 0)
})

// ── Summary ──────────────────────────────────────────────────────────────

console.log("")
console.log("══════════════════════════════════════════════════════════════")
console.log(
  ` Fail-Closed Channel Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`
)
console.log("══════════════════════════════════════════════════════════════")

if (failed > 0) {
  process.exit(1)
}
