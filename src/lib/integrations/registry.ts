/**
 * Provider Registry
 *
 * Resolves the correct MessageProvider for a given channel.
 * In development: uses mock providers.
 * In production: uses real providers based on env vars / tenant config.
 */

import type { Channel, MessageProvider, ProviderConfig } from "./types"
import { MockEmailProvider } from "./providers/mock-email"
import { MockWhatsAppProvider } from "./providers/mock-whatsapp"
import { ResendProvider } from "./providers/resend"
import { WhatsAppCloudProvider } from "./providers/whatsapp-cloud"

// Singleton instances for mock providers
let mockEmail: MockEmailProvider | null = null
let mockWhatsApp: MockWhatsAppProvider | null = null

/**
 * Resolve a MessageProvider for the given channel.
 *
 * Priority:
 * 1. Tenant-specific config (if provided) — allows each tenant to use their own API keys
 * 2. Platform-level env vars (RESEND_API_KEY, WHATSAPP_ACCESS_TOKEN)
 * 3. Mock providers (fallback for development)
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

  // 3. Fallback: mock providers
  return getMockProvider(channel)
}

/**
 * Always get a mock provider (useful for testing)
 */
export function getMockProvider(channel: Channel): MessageProvider {
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
 * Get the name of the active provider for a channel
 */
export function getActiveProviderName(channel: Channel): string {
  if (channel === "email") {
    return process.env.RESEND_API_KEY ? "resend" : "mock-email"
  }
  return process.env.WHATSAPP_ACCESS_TOKEN
    ? "whatsapp-cloud"
    : "mock-whatsapp"
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

  // Unknown config — fall back to mock
  return getMockProvider(channel)
}
