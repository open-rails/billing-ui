import { useMemo, type ReactNode } from "react"

import type { BillingClient } from "../client"
import { BillingContext } from "./context"
import { billingKeys } from "./keys"

export interface BillingProviderProps {
  client: BillingClient
  // The merchant this client is bound to (slug or merchant id); part of every
  // query key so one browser can hold several merchants' caches apart.
  merchant: string
  // The authenticated subject, or null when signed out.
  subject: string | null
  children?: ReactNode
}

// BillingProvider binds one client and scope for the hooks below. It uses
// the host's QueryClientProvider; it never creates a QueryClient.
export function BillingProvider({
  client,
  merchant,
  subject,
  children,
}: BillingProviderProps) {
  const value = useMemo(() => {
    const scope = { baseUrl: client.transport.baseUrl, merchant, subject }
    return { client, scope, keys: billingKeys(scope) }
  }, [client, merchant, subject])
  return (
    <BillingContext.Provider value={value}>{children}</BillingContext.Provider>
  )
}
