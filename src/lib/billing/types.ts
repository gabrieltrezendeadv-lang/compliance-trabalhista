/**
 * Billing Module — Abstract interfaces for billing providers
 *
 * Follows ADR-004 (interface abstrata) and ADR-005 (bloqueio gradual).
 * All billing providers implement BillingProvider for decoupling.
 */

// ─── Subscription Status (matches DB enum) ────────────────────────────────
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "grace_period"
  | "partially_blocked"
  | "fully_blocked"
  | "cancelled"

// ─── Billing Cycle ────────────────────────────────────────────────────────
export type BillingCycle = "monthly" | "yearly"

// ─── Payment Method ───────────────────────────────────────────────────────
export type PaymentMethod = "boleto" | "pix" | "credit_card"

// ─── Invoice Status ───────────────────────────────────────────────────────
export type InvoiceStatus = "pending" | "paid" | "overdue" | "cancelled" | "refunded"

// ─── Plan Limits ──────────────────────────────────────────────────────────
export interface PlanLimits {
  maxEstablishments: number | null
  maxDepartments: number | null
  maxMembers: number | null
  maxCampaignsPerMonth: number | null
  maxAssessmentsPerMonth: number | null
  evidenceStorageMb: number | null
  hasApiAccess: boolean
  hasCustomBranding: boolean
  hasPrioritySupport: boolean
}

// ─── Create Customer Request ──────────────────────────────────────────────
export interface CreateCustomerRequest {
  name: string
  email: string
  cpfCnpj: string
  phone?: string
  mobilePhone?: string
  postalCode?: string
}

// ─── Create Customer Result ───────────────────────────────────────────────
export interface CreateCustomerResult {
  success: boolean
  customerId?: string
  error?: string
}

// ─── Create Subscription Request ──────────────────────────────────────────
export interface CreateSubscriptionRequest {
  customerId: string
  billingType: PaymentMethod
  value: number // em reais (ex: 199.00)
  cycle: "MONTHLY" | "YEARLY"
  description: string
  externalReference?: string // tenant_id for correlation
  nextDueDate?: string // YYYY-MM-DD
}

// ─── Create Subscription Result ───────────────────────────────────────────
export interface CreateSubscriptionResult {
  success: boolean
  subscriptionId?: string
  error?: string
}

// ─── Billing Webhook Event (normalized) ───────────────────────────────────
export interface BillingWebhookEvent {
  eventId: string
  eventType: BillingEventType
  externalPaymentId?: string
  externalSubscriptionId?: string
  externalCustomerId?: string
  value?: number
  dueDate?: string
  paymentDate?: string
  billingType?: string
  status?: string
  rawPayload: Record<string, unknown>
}

export type BillingEventType =
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_OVERDUE"
  | "PAYMENT_DELETED"
  | "PAYMENT_REFUNDED"
  | "PAYMENT_CREATED"
  | "PAYMENT_UPDATED"
  | "SUBSCRIPTION_CREATED"
  | "SUBSCRIPTION_RENEWED"
  | "SUBSCRIPTION_CANCELLED"
  | "SUBSCRIPTION_EXPIRED"
  | "UNKNOWN"

// ─── Billing Provider Interface ───────────────────────────────────────────
export interface BillingProvider {
  readonly name: string

  /** Create a customer on the billing platform */
  createCustomer(request: CreateCustomerRequest): Promise<CreateCustomerResult>

  /** Create a recurring subscription */
  createSubscription(request: CreateSubscriptionRequest): Promise<CreateSubscriptionResult>

  /** Cancel a subscription */
  cancelSubscription(subscriptionId: string): Promise<{ success: boolean; error?: string }>

  /** Parse and normalize a webhook payload */
  parseWebhook(
    payload: Record<string, unknown>,
    headers: Record<string, string>
  ): BillingWebhookEvent | null

  /** Verify webhook authenticity */
  verifyWebhookSignature(
    payload: string,
    token: string,
    secret: string
  ): boolean
}
