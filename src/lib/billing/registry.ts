/**
 * Billing Provider Registry
 *
 * Resolves the correct BillingProvider based on environment config.
 * Same pattern as message provider registry (ADR-004).
 */

import type { BillingProvider } from "./types"
import { AsaasProvider } from "./providers/asaas"
import { MockBillingProvider } from "./providers/mock-billing"

let mockBilling: MockBillingProvider | null = null

/**
 * Resolve the billing provider.
 * Priority: ASAAS_API_KEY env var → mock fallback
 */
export function resolveBillingProvider(): BillingProvider {
  const apiKey = process.env.ASAAS_API_KEY
  if (apiKey) {
    const sandbox = process.env.ASAAS_SANDBOX === "true"
    return new AsaasProvider({ apiKey, sandbox })
  }

  return getMockBillingProvider()
}

export function getMockBillingProvider(): BillingProvider {
  if (!mockBilling) mockBilling = new MockBillingProvider()
  return mockBilling
}

export function isBillingConfigured(): boolean {
  return !!process.env.ASAAS_API_KEY
}

export function getActiveBillingProviderName(): string {
  return process.env.ASAAS_API_KEY ? "asaas" : "mock-billing"
}
