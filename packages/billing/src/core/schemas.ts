// Runtime schemas for the self-service (/v1/me) wire shapes, mirrored from
// the OpenRails Go DTOs (subscriptions.go, notifications.go, payments.go,
// payment_methods.go, invoices.go, client.go, the checkout module's session
// response) and pinned by testdata/wire fixtures. Unknown fields are
// stripped, so additive server changes never break a host; a missing or
// mistyped field fails loudly at the boundary instead of rendering garbage.
// Money is always an exact int64 decimal string; timestamps are RFC3339.
import { z } from "zod"

import {
  checkoutSessionIdSchema,
  customerIdSchema,
  paymentIdSchema,
  paymentMethodIdSchema,
  priceIdSchema,
  productIdSchema,
  subscriptionIdSchema,
  uuidSchema,
} from "./ids"
import { amountSchema, unitDecimalsSchema } from "./money"
import { paymentOperationSchema, paymentRecoverySchema } from "./recovery"

export const instantSchema = z.iso.datetime({ offset: true })
export type Instant = z.infer<typeof instantSchema>

const optionalInstant = instantSchema.nullish()
const optionalString = z.string().nullish()

// Page is the bounded list envelope ({object:"list", data, total, limit,
// offset, has_more}); empty lists carry data: [].
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    object: z.literal("list"),
    data: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int(),
    offset: z.number().int().nonnegative(),
    has_more: z.boolean(),
  })
}
export interface Page<T> {
  object: "list"
  data: T[]
  total: number
  limit: number
  offset: number
  has_more: boolean
}

// ---------------------------------------------------------------------------
// Subscriptions (openrails.Subscription; the self routes fill scheduled_*,
// cancel_portal_url and access).

export const subscriptionStatusSchema = z.enum([
  "pending",
  "active",
  "past_due",
  "cancelled",
  "expired",
  "paused",
])
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>

export const subscriptionPaymentSchema = z.object({
  id: paymentIdSchema,
  status: z.string(),
  amount: amountSchema,
  currency: z.string().min(1),
  rail: z.string(),
  transaction_id: z.string(),
  purchased_at: instantSchema,
})
export type SubscriptionPayment = z.infer<typeof subscriptionPaymentSchema>

export const subscriptionPriceSchema = z.object({
  id: priceIdSchema,
  key: z.string(),
  product_id: productIdSchema,
  unit_amount: amountSchema,
  currency: z.string().min(1),
  auto_renew: z.boolean(),
  access_duration_hours: z.number().int().nullish(),
  archived: z.boolean(),
})
export type SubscriptionPrice = z.infer<typeof subscriptionPriceSchema>

export const subscriptionProductSchema = z.object({
  id: productIdSchema,
  key: z.string(),
  display_name: z.string(),
  description: z.string(),
  tier_group: optionalString,
  tier_rank: z.number().int(),
  archived: z.boolean(),
})
export type SubscriptionProduct = z.infer<typeof subscriptionProductSchema>

export const subscriptionCardSchema = z.object({
  brand: z.string().optional(),
  last4: z.string().optional(),
  exp_month: z.number().int().nullish(),
  exp_year: z.number().int().nullish(),
})
export type SubscriptionCard = z.infer<typeof subscriptionCardSchema>

// How the customer currently holds premium access: the subscription itself
// or a standing entitlement window (one-off purchase, admin grant).
export const subscriptionAccessSchema = z.object({
  kind: z.enum(["subscription", "entitlement"]),
  entitlement: z.string(),
  source_type: z.string().optional(),
  source_id: z.string().optional(),
  subscription_id: subscriptionIdSchema.optional(),
  rail: z.string().optional(),
  start_at: instantSchema,
  end_at: optionalInstant,
})
export type SubscriptionAccess = z.infer<typeof subscriptionAccessSchema>

// cancel_mode says who executes a cancel: "reversible" (OpenRails, resumable
// before period end), "immediate" or "external_portal" (cancel_portal_url).
export const cancelModeSchema = z.string()

export const subscriptionSchema = z.object({
  id: subscriptionIdSchema,
  customer_id: customerIdSchema,
  product_id: productIdSchema,
  price_id: priceIdSchema,
  psp_id: z.string(),
  rail: z.string(),
  rail_subscription_id: z.string(),
  status: z.string(),
  scheduled_price_id: priceIdSchema.nullish(),
  payment_method_id: paymentMethodIdSchema.nullish(),
  started_at: instantSchema,
  ended_at: optionalInstant,
  current_period_starts_at: optionalInstant,
  current_period_ends_at: optionalInstant,
  cancelled_at: optionalInstant,
  cancel_type: optionalString,
  cancel_feedback: optionalString,
  resumable: z.boolean(),
  cancel_scheduled: z.boolean(),
  cancel_mode: cancelModeSchema,
  // Recovery state (past_due): what OpenRails' dunning has done and will do.
  last_retry_at: optionalInstant,
  retry_attempts: z.number().int().nullish(),
  next_retry_at: optionalInstant,
  grace_ends_at: optionalInstant,
  deletion_scheduled_at: optionalInstant,
  payments: z.array(subscriptionPaymentSchema).nullish(),
  price: subscriptionPriceSchema.nullish(),
  product: subscriptionProductSchema.nullish(),
  scheduled_price: subscriptionPriceSchema.nullish(),
  scheduled_product: subscriptionProductSchema.nullish(),
  card: subscriptionCardSchema.nullish(),
  cancel_portal_url: optionalString,
  access: subscriptionAccessSchema.nullish(),
  // #809 retry-now state; the self routes fill it.
  recovery: paymentRecoverySchema.nullish(),
  created_at: instantSchema,
  updated_at: instantSchema,
})
export type Subscription = z.infer<typeof subscriptionSchema>

export const subscriptionPageSchema = pageSchema(subscriptionSchema)

// POST .../cancel and .../resume answer 202 {"status":"queued"}: the change
// is recorded locally and the remote step runs as a durable intent.
export const queuedResultSchema = z.object({ status: z.literal("queued") })
export type QueuedResult = z.infer<typeof queuedResultSchema>

export const cancelSubscriptionRequestSchema = z.object({
  feedback: z.string().min(4).max(500),
})
export type CancelSubscriptionRequest = z.infer<
  typeof cancelSubscriptionRequestSchema
>

export const updateSubscriptionPaymentMethodRequestSchema = z.object({
  payment_method_id: paymentMethodIdSchema,
})

// ---------------------------------------------------------------------------
// Billing status (GET /v1/me/status) and entitlements.

export const entitlementRecordSchema = z.object({
  id: z.string(),
  customer_id: customerIdSchema.optional(),
  entitlement: z.string(),
  start_at: instantSchema,
  end_at: optionalInstant,
  source_id: optionalString,
  source_type: z.string(),
  revoked_at: optionalInstant,
  revoke_reason: optionalString,
  created_at: instantSchema,
  updated_at: instantSchema,
})
export type EntitlementRecord = z.infer<typeof entitlementRecordSchema>

export const billingStatusSchema = z.object({
  has_active_subscription: z.boolean(),
  subscription: subscriptionSchema.nullish(),
  access: subscriptionAccessSchema.nullish(),
  next_renewal_at: optionalInstant,
  entitlements: z.array(entitlementRecordSchema).nullish(),
})
export type BillingStatus = z.infer<typeof billingStatusSchema>

// GET /v1/me/entitlements/active: {object:"list", has_more:false, data[]}.
export const activeEntitlementSchema = z.object({
  id: uuidSchema,
  customer_id: customerIdSchema,
  lookup_key: z.string(),
  start_at: instantSchema,
  end_at: optionalInstant,
  source_type: z.string(),
  source_id: z.string().optional(),
})
export type ActiveEntitlement = z.infer<typeof activeEntitlementSchema>

export const activeEntitlementListSchema = z.object({
  object: z.literal("list"),
  has_more: z.boolean(),
  data: z.array(activeEntitlementSchema),
})

// ---------------------------------------------------------------------------
// Notifications (openrails.Notification / NotificationData).

export const notificationDataSchema = z.object({
  reason: z.string().optional(),
  message: z.string().optional(),
  source: z.string().optional(),
  entitlement: z.string().optional(),
  ended_at: optionalInstant,
  currency: z.string().optional(),
  subscription_id: subscriptionIdSchema.optional(),
  from_price_id: priceIdSchema.optional(),
  to_price_id: priceIdSchema.optional(),
  to_product_id: productIdSchema.optional(),
  to_product_name: z.string().optional(),
  old_amount: amountSchema.optional(),
  new_amount: amountSchema.optional(),
  effective_at: optionalInstant,
  downgrade_applied: z.boolean().optional(),
  new_product: z.string().optional(),
  overdue_amount: amountSchema.optional(),
  overdue_invoices: z.number().int().optional(),
  overdue_since: optionalInstant,
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  invoice_id: uuidSchema.optional(),
  invoice_number: z.string().optional(),
  amount_due: amountSchema.optional(),
  due_at: optionalInstant,
  failure_code: z.string().optional(),
  failure_reason: z.string().optional(),
  decline_outcome: z.string().optional(),
  next_attempt_at: optionalInstant,
  rail: z.string().optional(),
  rail_subscription_id: z.string().optional(),
  transaction_id: z.string().optional(),
  amount: amountSchema.optional(),
  product_name: z.string().optional(),
  payment_method: z.string().optional(),
  user_email: z.string().optional(),
  kind: z.string().optional(),
  provider: z.string().optional(),
  operation: z.string().optional(),
  affected_customer_id: customerIdSchema.optional(),
  original_payment_id: paymentIdSchema.optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type NotificationData = z.infer<typeof notificationDataSchema>

export const notificationSchema = z.object({
  id: uuidSchema,
  customer_id: customerIdSchema,
  event_type: z.string(),
  data: notificationDataSchema,
  seen: z.boolean(),
  created_at: instantSchema,
})
export type Notification = z.infer<typeof notificationSchema>

export const notificationPageSchema = pageSchema(notificationSchema)

export const unreadCountSchema = z.object({
  unread_count: z.number().int().nonnegative(),
})
export type UnreadCount = z.infer<typeof unreadCountSchema>

export const messageResultSchema = z.object({ message: z.string() })

// ---------------------------------------------------------------------------
// Payments (openrails.Payment; the self route adds card and omits refunds).

export const publicPriceSchema = z.object({
  id: priceIdSchema,
  key: z.string().optional(),
  object: z.literal("price"),
  unit_amount: amountSchema,
  currency: z.string().min(1),
  type: z.string().optional(),
  recurring: z.object({ interval: z.string() }).nullish(),
  product: productIdSchema,
  active: z.boolean(),
  providers: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  created_at: instantSchema,
})
export type PublicPrice = z.infer<typeof publicPriceSchema>

export const paymentStatusSchema = z.enum([
  "succeeded",
  "pending",
  "failed",
  "refunded",
  "partially_refunded",
])

export const paymentSchema = z.object({
  id: paymentIdSchema,
  object: z.literal("charge"),
  status: z.string().optional(),
  amount: amountSchema,
  amount_refunded: amountSchema,
  currency: z.string().min(1),
  customer_id: customerIdSchema,
  subscription_id: subscriptionIdSchema.nullish(),
  rail: z.string(),
  transaction_id: z.string().optional(),
  refunded: z.boolean(),
  captured: z.boolean().optional(),
  failure_code: optionalString,
  failure_reason: optionalString,
  created_at: instantSchema,
  price: publicPriceSchema.nullish(),
  card: z
    .object({ brand: z.string().optional(), last4: z.string().optional() })
    .nullish(),
})
export type Payment = z.infer<typeof paymentSchema>

export const paymentPageSchema = pageSchema(paymentSchema)

// ---------------------------------------------------------------------------
// Payment methods (openrails.PaymentMethod). Display data only: no PAN, no
// token ever appears on this surface.

export const paymentMethodHealthSchema = z.object({
  expiry_status: z.enum(["valid", "expiring_soon", "expired"]).optional(),
  last_charged_at: optionalInstant,
  last_charge_outcome: z.string().optional(),
  active: z.boolean(),
})
export type PaymentMethodHealth = z.infer<typeof paymentMethodHealthSchema>

export const billingAddressSchema = z.object({
  line1: optionalString,
  line2: optionalString,
  city: optionalString,
  state: optionalString,
  postal_code: optionalString,
  country: optionalString,
})

export const billingDetailsSchema = z.object({
  name: optionalString,
  email: optionalString,
  phone: optionalString,
  address: billingAddressSchema.nullish(),
})
export type BillingDetails = z.infer<typeof billingDetailsSchema>

export const cardDetailsSchema = z.object({
  brand: optionalString,
  last4: optionalString,
  exp_month: z.number().int().nullish(),
  exp_year: z.number().int().nullish(),
})
export type CardDetails = z.infer<typeof cardDetailsSchema>

export const paymentMethodSchema = z.object({
  id: paymentMethodIdSchema,
  object: z.literal("payment_method"),
  type: z.string(),
  rail: z.string(),
  psp_id: z.string(),
  customer: customerIdSchema.nullish(),
  billing_details: billingDetailsSchema.nullish(),
  card: cardDetailsSchema.nullish(),
  metadata: z.record(z.string(), z.string()).nullish(),
  created_at: instantSchema,
  health: paymentMethodHealthSchema.nullish(),
  subscriptions: z
    .array(
      z.object({
        id: subscriptionIdSchema,
        display_name: z.string(),
        description: z.string(),
        created_at: instantSchema,
      })
    )
    .nullish(),
  // The billing currencies this method collects invoices for (the explicit
  // PUT /v1/me/collection-payment-method choice); empty when none.
  collection_default_currencies: z.array(z.string()).nullish(),
})
export type PaymentMethod = z.infer<typeof paymentMethodSchema>

export const paymentMethodPageSchema = pageSchema(paymentMethodSchema)

// POST /v1/me/payment-methods: a Collect.js token plus billing identity. The
// schema is strict so a raw card field (card_number, cvv, ...) is refused
// before it can leave the browser.
export const createPaymentMethodRequestSchema = z.strictObject({
  payment_token: z.string().min(1),
  name_on_card: z.string().max(200).optional(),
  email: z.string().optional(),
  address1: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zip: z.string().max(20).optional(),
  country: z.string().max(2).optional(),
  phone: z.string().optional(),
  last_four: z.string().optional(),
  card_type: z.string().optional(),
  expiry_date: z.string().optional(),
})
export type CreatePaymentMethodRequest = z.infer<
  typeof createPaymentMethodRequestSchema
>

export const updatePaymentMethodRequestSchema = z.strictObject({
  ...createPaymentMethodRequestSchema.shape,
  last_four: z.string().min(1),
  card_type: z.string().min(1),
  expiry_date: z.string().min(1),
})
export type UpdatePaymentMethodRequest = z.infer<
  typeof updatePaymentMethodRequestSchema
>

export const setCollectionPaymentMethodRequestSchema = z.object({
  currency: z.string().min(1),
  payment_method_id: paymentMethodIdSchema,
})
export type SetCollectionPaymentMethodRequest = z.infer<
  typeof setCollectionPaymentMethodRequestSchema
>

// A durable provider-aware mutation answers "completed" (the row is final)
// or "pending" (202: convergence continues; re-read to observe the result).
export type MutationOutcome = "completed" | "pending"

// ---------------------------------------------------------------------------
// Invoices (openrails.InvoiceDTO). The self list is {invoices, total, limit,
// offset}; amounts are at the currency's registered scale (no unit_decimals
// on the self shape — take it from the registry).

export const invoiceLineItemSchema = z.object({
  event_type: z.string(),
  amount: amountSchema,
  count: z.number().int(),
  dimensions: z.record(z.string(), z.number().int()).nullish(),
})
export type InvoiceLineItem = z.infer<typeof invoiceLineItemSchema>

export const invoiceContactSchema = z.object({
  name: z.string().optional(),
  email: z.string(),
})

export const invoiceStatusSchema = z.enum([
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
  "past_due",
])

export const invoiceSchema = z.object({
  id: uuidSchema,
  currency: z.string().min(1),
  invoice_number: optionalString,
  period_from: instantSchema,
  period_to: instantSchema,
  usage_total: amountSchema,
  deposits_total: amountSchema,
  owed_accrued: amountSchema,
  owed_paid: amountSchema,
  closing_balance: amountSchema,
  subtotal_amount: amountSchema,
  total_amount: amountSchema,
  amount_paid: amountSchema,
  amount_due: amountSchema,
  line_items: z.array(invoiceLineItemSchema).nullish(),
  money_movements: z.record(z.string(), amountSchema).nullish(),
  po_number: optionalString,
  tax: z.record(z.string(), z.unknown()).nullish(),
  billing_contacts: z.array(invoiceContactSchema).nullish(),
  memo: optionalString,
  status: z.string(),
  collection_method: z.string(),
  issued_at: optionalInstant,
  due_at: optionalInstant,
  paid_at: optionalInstant,
  voided_at: optionalInstant,
  uncollectible_at: optionalInstant,
  finalized_at: optionalInstant,
  external_invoice_id: optionalString,
  // Collection state: what automatic collection has done and will do next.
  collection_failure_count: z.number().int(),
  collection_failed_at: optionalInstant,
  next_collection_attempt_at: optionalInstant,
  last_collection_failure_code: optionalString,
  // The live collection operation; no competing collection runs while set.
  collection_intent_id: uuidSchema.nullish(),
  unit_decimals: unitDecimalsSchema.optional(),
  // #809 pay-now state; the customer routes fill it.
  recovery: paymentRecoverySchema.nullish(),
  created_at: instantSchema,
})
export type Invoice = z.infer<typeof invoiceSchema>

export const invoiceListResponseSchema = z.object({
  invoices: z
    .array(invoiceSchema)
    .nullable()
    .transform((v) => v ?? []),
  total: z.number().int().nonnegative(),
  limit: z.number().int(),
  offset: z.number().int().nonnegative(),
})
export type InvoiceListResponse = z.infer<typeof invoiceListResponseSchema>

export const invoicePaymentAttemptSchema = z.object({
  id: uuidSchema,
  invoice_id: uuidSchema,
  currency: z.string().min(1),
  amount: amountSchema,
  status: z.string(),
  payment_method_id: paymentMethodIdSchema.nullish(),
  rail: optionalString,
  rail_payment_id: optionalString,
  failure_code: optionalString,
  failure_reason: optionalString,
  attempted_at: instantSchema,
  settled_at: optionalInstant,
})
export type InvoicePaymentAttempt = z.infer<typeof invoicePaymentAttemptSchema>

// ---------------------------------------------------------------------------
// Checkout sessions (the checkout module's CheckoutSessionResponse, served by
// POST/GET /v1/me/checkout[/{id}] and .../confirm).

export const checkoutSessionStatusSchema = z.enum([
  "created",
  "requires_action",
  "succeeded",
  "failed",
  "blocked",
  "expired",
  "canceled",
])
export type CheckoutSessionStatus = z.infer<typeof checkoutSessionStatusSchema>

export const checkoutNextActionSchema = z.object({
  type: z.string(),
  redirect_to_url: z.object({ url: z.string().optional() }).nullish(),
  transactions: z.array(z.string()).nullish(),
})
export type CheckoutNextAction = z.infer<typeof checkoutNextActionSchema>

export const checkoutPaymentResponseSchema = z.object({
  rail: z.string(),
  reference: z.string().optional(),
  transaction_url: z.string().optional(),
  solana_pay_url: z.string().optional(),
  redirect_url: z.string().optional(),
  transaction_id: z.string().optional(),
})

export const checkoutSessionSchema = z.object({
  object: z.literal("checkout_session"),
  id: checkoutSessionIdSchema,
  status: checkoutSessionStatusSchema,
  mode: z.string(),
  price_id: priceIdSchema,
  amount: amountSchema,
  currency: z.string().min(1),
  url: z.string().optional(),
  payment: checkoutPaymentResponseSchema,
  payment_id: paymentIdSchema.nullish(),
  subscription_id: subscriptionIdSchema.nullish(),
  expires_at: optionalInstant,
  created_at: instantSchema,
  next_action: checkoutNextActionSchema.nullish(),
  message: z.string().optional(),
  metadata: z.record(z.string(), z.string()).nullish(),
})
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>

// POST /v1/me/checkout. price_id names the price; payment names a saved
// method or a one-time token plus the billing identity the rail needs. No
// PAN, CVV or credential can be expressed here.
export const checkoutPaymentRequestSchema = z.object({
  rail: z.string().optional(),
  payment_method_id: paymentMethodIdSchema.optional(),
  payment_token: z.string().optional(),
  token_symbol: z.string().optional(),
  flow: z.enum(["transfer_request", "transaction_request"]).optional(),
  wallet: z.string().optional(),
  email: z.string().optional(),
  name_on_card: z.string().max(200).optional(),
  address1: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zip: z.string().max(20).optional(),
  country: z.string().max(2).optional(),
  last_four: z.string().optional(),
  card_type: z.string().optional(),
  expiry_date: z.string().optional(),
})
export type CheckoutPaymentRequest = z.infer<
  typeof checkoutPaymentRequestSchema
>

export const createCheckoutSessionRequestSchema = z.object({
  price_id: priceIdSchema,
  mode: z.enum(["one_off", "subscription"]).optional(),
  payment: checkoutPaymentRequestSchema,
  metadata: z.record(z.string(), z.string()).optional(),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
})
export type CreateCheckoutSessionRequest = z.infer<
  typeof createCheckoutSessionRequestSchema
>

export const confirmCheckoutSessionRequestSchema = z.object({
  payment: z.object({
    rail: z.literal("solana"),
    signature: z.string().optional(),
    wallet: z.string().optional(),
  }),
})
export type ConfirmCheckoutSessionRequest = z.infer<
  typeof confirmCheckoutSessionRequestSchema
>

// ---------------------------------------------------------------------------
// Tier changes (openrails.TierChangeResponse / TierChangePreviewResponse).

export const tierChangeResponseSchema = z.object({
  object: z.literal("tier_change"),
  status: z.enum(["succeeded", "requires_action", "blocked"]),
  mode: z.string(),
  action: z.string().optional(),
  price_id: priceIdSchema,
  url: z.string().optional(),
  payment: checkoutPaymentResponseSchema,
  subscription_id: subscriptionIdSchema.nullish(),
  next_action: checkoutNextActionSchema.nullish(),
  message: z.string().optional(),
  delayed_start: optionalInstant,
  currency: z.string().optional(),
  amount_due_now: amountSchema,
  next_charge_amount: amountSchema,
  next_charge_date: optionalInstant,
})
export type TierChangeResponse = z.infer<typeof tierChangeResponseSchema>

export const tierChangePreviewSchema = z.object({
  object: z.literal("tier_change_preview"),
  action: z.string(),
  price_id: priceIdSchema,
  rail: z.string(),
  currency: z.string(),
  amount_due_now: amountSchema,
  next_charge_amount: amountSchema,
  next_charge_date: optionalInstant,
  effective: z.string(),
  is_estimate: z.boolean(),
  message: z.string().optional(),
})
export type TierChangePreview = z.infer<typeof tierChangePreviewSchema>

export const changeTierRequestSchema = z.object({ price_id: priceIdSchema })

// ---------------------------------------------------------------------------
// #809 customer payment recovery (openrails recovery.go). Both actions require
// an Idempotency-Key; 200 is terminal, 202 carries the same shape while
// operation is unresolved (poll the invoice / subscription, never resend); a
// provider refusal is the 402 card_declined error (see recoveryDeclineOf).

export const invoicePaymentAttemptPageSchema = pageSchema(
  invoicePaymentAttemptSchema
)

export const payInvoiceNowRequestSchema = z.strictObject({
  payment_method_id: paymentMethodIdSchema,
})
export type PayInvoiceNowRequest = z.infer<typeof payInvoiceNowRequestSchema>

export const invoicePayNowResultSchema = z.object({
  invoice: invoiceSchema,
  attempt: invoicePaymentAttemptSchema,
  operation: paymentOperationSchema,
  replayed: z.boolean(),
})
export type InvoicePayNowResult = z.infer<typeof invoicePayNowResultSchema>

// payment_method_id, when given, must be the subscription's current method.
export const retrySubscriptionNowRequestSchema = z.strictObject({
  payment_method_id: paymentMethodIdSchema.optional(),
})
export type RetrySubscriptionNowRequest = z.infer<
  typeof retrySubscriptionNowRequestSchema
>

export const subscriptionRetryNowResultSchema = z.object({
  subscription: subscriptionSchema,
  payment: subscriptionPaymentSchema.nullish(),
  operation: paymentOperationSchema,
  replayed: z.boolean(),
})
export type SubscriptionRetryNowResult = z.infer<
  typeof subscriptionRetryNowResultSchema
>
