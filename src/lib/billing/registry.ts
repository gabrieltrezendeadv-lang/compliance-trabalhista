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

export class BillingNotConfiguredError extends Error {
  constructor() {
    super("Billing provider is not configured")
    this.name = "BillingNotConfiguredError"
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production"
}

function isMockAllowed(): boolean {
  return (
    !isProduction() &&
    process.env.ALLOW_MOCK_BILLING_PROVIDER === "true"
  )
}

/**
 * Resolve the billing provider.
 * Priority: ASAAS_API_KEY env var → explicit dev-only mock opt-in.
 * Production always fails closed when Asaas is not configured.
 */
export function resolveBillingProvider(): BillingProvider {
  const apiKey = process.env.ASAAS_API_KEY
  if (apiKey) {
    const sandbox = process.env.ASAAS_SANDBOX === "true"
    return new AsaasProvider({ apiKey, sandbox })
  }

  if (isMockAllowed()) return getMockBillingProvider()

  throw new BillingNotConfiguredError()
}

export function getMockBillingProvider(): BillingProvider {
  if (!isMockAllowed()) throw new BillingNotConfiguredError()
  if (!mockBilling) mockBilling = new MockBillingProvider()
  return mockBilling
}

export function isBillingConfigured(): boolean {
  return !!process.env.ASAAS_API_KEY
}

export function getActiveBillingProviderName(): string {
  if (process.env.ASAAS_API_KEY) return "asaas"
  return isMockAllowed() ? "mock-billing" : "not-configured"
}
