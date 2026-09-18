// Query keys scoped by deployment (base URL), merchant and authenticated
// subject, so two merchants, two OpenRails deployments or two accounts in one
// browser never share a cache entry. The registry is deployment-scoped only.
export interface BillingScope {
  baseUrl: string
  merchant: string
  // The authenticated subject (the host's stable user or customer id), or
  // null when signed out: every /me query is disabled then.
  subject: string | null
}

export type PageKeyParams = {
  limit?: number
  offset?: number
  status?: string
  type?: string
  seen?: boolean
  at?: string
}

export function billingKeys(scope: BillingScope) {
  const root = [
    "openrails-billing",
    scope.baseUrl,
    scope.merchant,
    scope.subject,
  ] as const
  const deployment = ["openrails-billing", scope.baseUrl] as const
  return {
    root,
    deployment,
    currencies: [...deployment, "currencies"] as const,
    status: [...root, "status"] as const,
    entitlements: (params: PageKeyParams = {}) =>
      [...root, "entitlements", params] as const,
    subscriptions: {
      root: [...root, "subscriptions"] as const,
      list: (params: PageKeyParams = {}) =>
        [...root, "subscriptions", "list", params] as const,
      detail: (id: string) => [...root, "subscriptions", "detail", id] as const,
    },
    paymentMethods: {
      root: [...root, "payment-methods"] as const,
      list: (params: PageKeyParams = {}) =>
        [...root, "payment-methods", "list", params] as const,
    },
    payments: {
      root: [...root, "payments"] as const,
      list: (params: PageKeyParams = {}) =>
        [...root, "payments", "list", params] as const,
    },
    invoices: {
      root: [...root, "invoices"] as const,
      list: (params: PageKeyParams = {}) =>
        [...root, "invoices", "list", params] as const,
      detail: (id: string) => [...root, "invoices", "detail", id] as const,
      payments: (id: string, params: PageKeyParams = {}) =>
        [...root, "invoices", "payments", id, params] as const,
    },
    notifications: {
      root: [...root, "notifications"] as const,
      list: (params: PageKeyParams = {}) =>
        [...root, "notifications", "list", params] as const,
      unreadCount: [...root, "notifications", "unread-count"] as const,
    },
    checkoutSessions: {
      root: [...root, "checkout-sessions"] as const,
      detail: (id: string) =>
        [...root, "checkout-sessions", "detail", id] as const,
    },
  }
}

export type BillingKeys = ReturnType<typeof billingKeys>
