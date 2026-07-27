/**
 * Provider Registry
 *
 * Resolves the correct MessageProvider for a given channel.
 *
 * SECURITY (SEC-BLOCK1):
 * - In production: real providers MUST be configured via env vars.
 *   Missing env vars → ChannelNotConfiguredError (fail closed).
 *   Mock providers CANNOT be selected in production.
 * - In development/test: mock providers allowed only with explicit
 *   opt-in (ALLOW_MOCK_PROVIDERS=true).
 */

import type { Channel, MessageProvider, ProviderConfig } from "./types"
import { MockEmailProvider } from "./providers/mock-email"
import { MockWhatsAppProvider } from "./providers/mock-whatsapp"
import { ResendProvider } from "./providers/resend"
import { WhatsAppCloudProvider } from "./providers/whatsapp-cloud"

// ─── Errors ───────────────────────────────────────────────────────────────

/**
 * Thrown when a channel's real provider is not configured and
 * mock fallback is not allowed (production, or dev without opt-in).
 */
export class ChannelNotConfiguredError extends Error {
  public readonly channel: Channel

  constructor(channel: Channel) {
    const label = channel === "email" ? "E-mail" : "WhatsApp"
    super(
      `Canal ${label} não configurado. ` +
        `Configure as variáveis de ambiente do provedor antes de enviar.`
    )
    this.name = "ChannelNotConfiguredError"
    this.channel = channel
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Returns true when NODE_ENV === "production". */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production"
}

/**
 * Returns true when mock providers are explicitly allowed.
 * Requires ALLOW_MOCK_PROVIDERS=true AND a non-production environment.
 */
function isMockAllowed(): boolean {
  if (isProduction()) return false
  return process.env.ALLOW_MOCK_PROVIDERS === "true"
}

// Singleton instances for mock providers
let mockEmail: MockEmailProvider | null = null
let mockWhatsApp: MockWhatsAppProvider | null = null

/**
 * Resolve a MessageProvider for the given channel.
 *
 * Priority:
 * 1. Tenant-specific config (if provided) — allows each tenant to use their own API keys
 * 2. Platform-level env vars (RESEND_API_KEY, WHATSAPP_ACCESS_TOKEN)
 * 3. Mock providers (ONLY in dev/test with ALLOW_MOCK_PROVIDERS=true)
 * 4. Throw ChannelNotConfiguredError (fail closed)
 */
export function resolveProvider(
  channel: Channel,
  tenantConfig?: ProviderConfig
): MessageProvider {
  // 1. Tenant-specific config
  if (tenantConfig?.apiKey) {
    return createProviderFromConfig(channel, tenantConfig)
  }

  // 2. Platform-level env vars
  if (channel === "email") {
    const resendKey = process.env.RESEND_API_KEY
    const fromAddress =
      process.env.RESEND_FROM_ADDRESS ?? "noreply@compliance.app"
    if (resendKey) {
      return new ResendProvider({ apiKey: resendKey, fromAddress })
    }
  }

  if (channel === "whatsapp") {
    const waToken = process.env.WHATSAPP_ACCESS_TOKEN
    const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (waToken && waPhoneId) {
      return new WhatsAppCloudProvider({
        accessToken: waToken,
        phoneNumberId: waPhoneId,
      })
    }
  }

  // 3. Mock fallback — dev/test only, with explicit opt-in
  if (isMockAllowed()) {
    console.warn(
      `[registry] Canal "${channel}" sem provedor real configurado — usando mock (ALLOW_MOCK_PROVIDERS=true)`
    )
    return getMockProvider(channel)
  }

  // 4. Fail closed — no mock in production, no opt-in in dev
  throw new ChannelNotConfiguredError(channel)
}

/**
 * Get a mock provider instance.
 *
 * SECURITY: This function MUST NOT be called in production code paths.
 * It is exported only for direct use in test suites.
 *
 * @throws {ChannelNotConfiguredError} if called in production
 */
export function getMockProvider(channel: Channel): MessageProvider {
  if (isProduction()) {
    throw new ChannelNotConfiguredError(channel)
  }

  if (channel === "email") {
    if (!mockEmail) mockEmail = new MockEmailProvider()
    return mockEmail
  }
  if (!mockWhatsApp) mockWhatsApp = new MockWhatsAppProvider()
  return mockWhatsApp
}

/**
 * Check if a real (non-mock) provider is configured for a channel
 */
export function isRealProviderConfigured(channel: Channel): boolean {
  if (channel === "email") {
    return !!process.env.RESEND_API_KEY
  }
  return !!(
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID
  )
}

/**
 * Resolve which concrete channels a campaign's delivery channel requires.
 * Campaign `channel` can be "email", "whatsapp", or "both".
 * Returns the list of Channel values ("email" | "whatsapp") needed.
 */
export function getRequiredChannels(
  campaignChannel: string
): Channel[] {
  if (campaignChannel === "both") return ["email", "whatsapp"]
  if (campaignChannel === "email" || campaignChannel === "whatsapp") {
    return [campaignChannel]
  }
  return []
}

/**
 * Check that ALL required channels for a campaign's delivery channel
 * have real providers configured. For "both", both email AND whatsapp
 * must be ready.
 *
 * Returns { ready: true } or { ready: false, missing: Channel[] }.
 */
export function areChannelsReady(campaignChannel: string): {
  ready: boolean
  missing: Channel[]
} {
  const required = getRequiredChannels(campaignChannel)
  const missing = required.filter((ch) => !isRealProviderConfigured(ch))
  return { ready: missing.length === 0, missing }
}

/**
 * Get the name of the active provider for a channel.
 *
 * Returns "not-configured" when no real provider is set up,
 * instead of exposing mock provider names.
 */
export function getActiveProviderName(channel: Channel): string {
  if (channel === "email") {
    return process.env.RESEND_API_KEY ? "resend" : "not-configured"
  }
  return process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID
    ? "whatsapp-cloud"
    : "not-configured"
}

// ─── Internal ──────────────────────────────────────────────────────────────

function createProviderFromConfig(
  channel: Channel,
  config: ProviderConfig
): MessageProvider {
  if (channel === "email" && config.provider === "resend") {
    return new ResendProvider({
      apiKey: config.apiKey!,
      fromAddress:
        (config.settings?.fromAddress as string) ??
        "noreply@compliance.app",
    })
  }

  if (channel === "whatsapp" && config.provider === "whatsapp-cloud") {
    return new WhatsAppCloudProvider({
      accessToken: config.apiKey!,
      phoneNumberId: (config.settings?.phoneNumberId as string) ?? "",
    })
  }

  // Unknown config — fail closed (no mock fallback)
  throw new ChannelNotConfiguredError(channel)
}
