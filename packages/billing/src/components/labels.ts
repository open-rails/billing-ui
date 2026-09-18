// Default English labels for every neutral view. Hosts replace them through
// each component's `labels` prop; nothing here is product copy policy.

// Recovery facts shared by InvoiceList and SubscriptionRecovery. Keys of
// `blocked` and `failureCategory` are OpenRails' wire values.
export interface RecoveryLabels {
  attempts: string
  nextAttempt: string
  lastFailure: string
  lastFailedAt: string
  // Shown while recovery.operation (or a 202's operation) is unresolved.
  confirming: string
  blocked: Record<string, string>
  failureCategory: Record<string, string>
  // 402 card_declined after pay-now / retry-now.
  declined: string
  // A coded 409 / 400 refusal to attempt; keyed by error code.
  refused: Record<string, string>
  refusedFallback: string
}

export const recoveryLabels: RecoveryLabels = {
  attempts: "Attempts",
  nextAttempt: "Next automatic attempt",
  lastFailure: "Last failure",
  lastFailedAt: "Last failed",
  confirming: "Confirming your payment with the provider…",
  blocked: {
    not_due: "Nothing is due right now.",
    uncollectible: "This balance can no longer be collected here.",
    in_progress: "A payment attempt is already in progress.",
    outcome_unknown: "A previous attempt is still being confirmed.",
    rail_unsupported: "This payment is managed by the payment provider.",
    no_compatible_payment_method: "Add a payment method to pay now.",
  },
  failureCategory: {},
  declined: "Your payment was declined.",
  refused: {
    payment_recovery_rail_unsupported:
      "This payment is managed by the payment provider.",
    invoice_not_retryable: "This invoice cannot be paid now.",
    invoice_retry_in_progress: "A payment attempt is already in progress.",
    invoice_retry_outcome_unknown:
      "A previous attempt is still being confirmed.",
    invoice_retry_idempotency_conflict:
      "This request was already used for a different payment.",
    subscription_not_retryable: "This subscription cannot be retried now.",
    subscription_retry_in_progress: "A payment attempt is already in progress.",
    subscription_retry_outcome_unknown:
      "A previous attempt is still being confirmed.",
    collection_payment_method_invalid:
      "That payment method cannot be used for this payment.",
    tier_change_in_flight: "A plan change is already in progress.",
    tier_change_idempotency_conflict:
      "That request was already used for a different plan change.",
    tier_change_idempotency_key_required:
      "The plan change could not be started. Try again.",
    tier_change_refused: "The plan change was refused.",
  },
  refusedFallback: "The payment could not be attempted.",
}

export interface InvoiceListLabels {
  empty: string
  number: string
  period: string
  due: string
  amountDue: string
  total: string
  status: Record<string, string>
  payNow: string
  view: string
  recovery: RecoveryLabels
}

export const invoiceListLabels: InvoiceListLabels = {
  empty: "No invoices yet.",
  number: "Invoice",
  period: "Period",
  due: "Due",
  amountDue: "Amount due",
  total: "Total",
  status: {},
  payNow: "Pay now",
  view: "View",
  recovery: recoveryLabels,
}

export interface SavedMethodsLabels {
  empty: string
  card: string
  expires: string
  expired: string
  expiringSoon: string
  inactive: string
  collectsFor: string
  usedBy: string
  remove: string
  makeDefault: string
  selected: string
}

export const savedMethodsLabels: SavedMethodsLabels = {
  empty: "No saved payment methods.",
  card: "Card",
  expires: "Expires",
  expired: "Expired",
  expiringSoon: "Expiring soon",
  inactive: "Needs attention",
  collectsFor: "Collects invoices in",
  usedBy: "Used by",
  remove: "Remove",
  makeDefault: "Use for invoices",
  selected: "Selected",
}

export interface SubscriptionStateLabels {
  status: Record<string, string>
  price: string
  renews: string
  endsOn: string
  cancelScheduled: string
  scheduledChange: string
  paymentMethod: string
  noPaymentMethod: string
  cancel: string
  resume: string
  changePaymentMethod: string
  changePlan: string
  managedExternally: string
  openPortal: string
}

export const subscriptionStateLabels: SubscriptionStateLabels = {
  status: {},
  price: "Plan",
  renews: "Renews",
  endsOn: "Access ends",
  cancelScheduled: "Cancellation scheduled",
  scheduledChange: "Changes to",
  paymentMethod: "Payment method",
  noPaymentMethod: "No payment method on file",
  cancel: "Cancel subscription",
  resume: "Resume subscription",
  changePaymentMethod: "Change payment method",
  changePlan: "Change plan",
  managedExternally: "This subscription is managed by the payment provider.",
  openPortal: "Manage on provider site",
}

export interface SubscriptionRecoveryLabels {
  title: string
  lastPayment: string
  graceEnds: string
  retryNow: string
  updatePaymentMethod: string
  scheduled: string
  recovery: RecoveryLabels
}

export const subscriptionRecoveryLabels: SubscriptionRecoveryLabels = {
  title: "Payment needed",
  lastPayment: "Last payment",
  graceEnds: "Access continues until",
  retryNow: "Retry payment now",
  updatePaymentMethod: "Update payment method",
  scheduled: "We will try again automatically.",
  recovery: recoveryLabels,
}

export interface CheckoutViewLabels {
  summary: string
  recurring: string
  oneTime: string
  paymentMethod: string
  newMethod: string
  pay: string
  processing: string
  succeeded: string
  requiresAction: string
  continueToProvider: string
  unsafeRedirect: string
  failed: string
  blocked: string
  expired: string
  canceled: string
}

export const checkoutViewLabels: CheckoutViewLabels = {
  summary: "Order summary",
  recurring: "Renews automatically",
  oneTime: "One-time purchase",
  paymentMethod: "Payment method",
  newMethod: "Use a new card",
  pay: "Pay",
  processing: "Processing…",
  succeeded: "Payment complete.",
  requiresAction: "Continue with the payment provider to finish.",
  continueToProvider: "Continue",
  unsafeRedirect:
    "The payment provider link could not be verified. Contact support.",
  failed: "Payment failed.",
  blocked: "This purchase is not available for your account.",
  expired: "This checkout has expired.",
  canceled: "This checkout was canceled.",
}
