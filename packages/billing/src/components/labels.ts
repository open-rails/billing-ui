// Default English labels for every neutral view. Hosts replace them through
// each component's `labels` prop; nothing here is product copy policy.

export interface InvoiceListLabels {
  empty: string
  number: string
  period: string
  due: string
  amountDue: string
  total: string
  status: Record<string, string>
  nextAttempt: string
  failedAttempts: string
  payNow: string
  view: string
}

export const invoiceListLabels: InvoiceListLabels = {
  empty: "No invoices yet.",
  number: "Invoice",
  period: "Period",
  due: "Due",
  amountDue: "Amount due",
  total: "Total",
  status: {},
  nextAttempt: "Next collection attempt",
  failedAttempts: "Failed attempts",
  payNow: "Pay now",
  view: "View",
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

export interface PaymentRecoveryLabels {
  title: string
  lastAttempt: string
  attempts: string
  nextAttempt: string
  graceEnds: string
  lastPayment: string
  retryNow: string
  updatePaymentMethod: string
  scheduled: string
}

export const paymentRecoveryLabels: PaymentRecoveryLabels = {
  title: "Payment needed",
  lastAttempt: "Last attempt",
  attempts: "Attempts",
  nextAttempt: "Next automatic attempt",
  graceEnds: "Access continues until",
  lastPayment: "Last payment",
  retryNow: "Retry payment now",
  updatePaymentMethod: "Update payment method",
  scheduled: "We will try again automatically.",
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
  failed: "Payment failed.",
  blocked: "This purchase is not available for your account.",
  expired: "This checkout has expired.",
  canceled: "This checkout was canceled.",
}
