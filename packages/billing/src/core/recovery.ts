// Customer payment recovery (#809, openrails recovery.go). OpenRails decides
// whether pay-now/retry-now would be accepted and reports it on every /v1/me
// invoice and subscription as `recovery`; hosts and views read these flags
// and never re-derive rail or dunning policy.
import { z } from "zod"

import { BillingError, ErrorCode } from "./errors"
import { paymentMethodIdSchema, uuidSchema } from "./ids"

// One durable collection operation. The first four statuses are unresolved
// (openrails PaymentOperation.Unresolved): the server answers 202, no money
// is known to have moved, and nothing may be resent until it resolves.
export const paymentOperationStatusSchema = z.enum([
  "pending",
  "in_flight",
  "unknown_needs_verify",
  "failed_retryable",
  "succeeded",
  "failed_terminal",
  "superseded",
  "expired",
])
export type PaymentOperationStatus = z.infer<
  typeof paymentOperationStatusSchema
>

export const paymentOperationSchema = z.object({
  id: uuidSchema,
  status: paymentOperationStatusSchema,
})
export type PaymentOperation = z.infer<typeof paymentOperationSchema>

const UNRESOLVED: ReadonlySet<PaymentOperationStatus> = new Set([
  "pending",
  "in_flight",
  "unknown_needs_verify",
  "failed_retryable",
])

export function isOperationUnresolved(
  operation: PaymentOperation | null | undefined
): boolean {
  return !!operation && UNRESOLVED.has(operation.status)
}

export const recoveryBlockedReasonSchema = z.enum([
  "not_due",
  "uncollectible",
  "in_progress",
  "outcome_unknown",
  "rail_unsupported",
  "no_compatible_payment_method",
])
export type RecoveryBlockedReason = z.infer<typeof recoveryBlockedReasonSchema>

export const paymentRecoverySchema = z.object({
  // pay-now / retry-now would be accepted right now.
  retryable: z.boolean(),
  blocked_reason: recoveryBlockedReasonSchema.optional(),
  // The engine's own next scheduled attempt.
  next_attempt_at: z.iso.datetime({ offset: true }).nullish(),
  attempt_count: z.number().int().nonnegative(),
  // Normalized reason of the newest failed attempt (insufficient_funds, ...).
  failure_category: z.string().optional(),
  // The provider's verbatim code of that attempt.
  last_failure_code: z.string().optional(),
  last_failed_at: z.iso.datetime({ offset: true }).nullish(),
  // Saved methods a recovery charge may use (retry-now charges the
  // subscription's current one).
  compatible_payment_method_ids: z
    .array(paymentMethodIdSchema)
    .nullable()
    .transform((ids) => ids ?? []),
  // The live operation while one is unresolved.
  operation: paymentOperationSchema.nullish(),
})
export type PaymentRecovery = z.infer<typeof paymentRecoverySchema>

// The 402 card_declined a pay-now / retry-now answers with when the provider
// refused: the attempt is recorded and its facts ride the error metadata.
export const recoveryDeclineSchema = z.object({
  decline_reason: z.string(),
  failure_code: z.string().optional(),
  attempt_id: uuidSchema.optional(),
  invoice_id: uuidSchema.optional(),
  subscription_id: z.string().optional(),
  subscription_status: z.string().optional(),
  operation_id: uuidSchema.optional(),
  replayed: z.boolean().optional(),
  retryable: z.boolean().optional(),
  attempt_count: z.number().int().optional(),
  next_attempt_at: z.iso.datetime({ offset: true }).optional(),
})
export type RecoveryDecline = z.infer<typeof recoveryDeclineSchema>

// recoveryDeclineOf reads a recorded decline off a BillingError, or null when
// the error is anything else.
export function recoveryDeclineOf(error: unknown): RecoveryDecline | null {
  if (!(error instanceof BillingError)) return null
  if (error.status !== 402 || error.code !== ErrorCode.cardDeclined) return null
  const parsed = recoveryDeclineSchema.safeParse(error.metadata ?? {})
  return parsed.success ? parsed.data : null
}

// Refusals where OpenRails declined to attempt at all (409). No attempt was
// created and no provider was called.
export const RECOVERY_REFUSAL_CODES = [
  ErrorCode.paymentRecoveryRailUnsupported,
  ErrorCode.invoiceNotRetryable,
  ErrorCode.invoiceRetryInProgress,
  ErrorCode.invoiceRetryOutcomeUnknown,
  ErrorCode.invoiceRetryIdempotencyConflict,
  ErrorCode.subscriptionNotRetryable,
  ErrorCode.subscriptionRetryInProgress,
  ErrorCode.subscriptionRetryOutcomeUnknown,
] as const
