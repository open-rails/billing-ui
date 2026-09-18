import { createContext, useContext } from "react"

import type { BillingClient } from "../client"
import type { BillingKeys, BillingScope } from "./keys"

export interface BillingContextValue {
  client: BillingClient
  scope: BillingScope
  keys: BillingKeys
}

export const BillingContext = createContext<BillingContextValue | null>(null)

// useBilling returns the provider's client, scope and key factory. It throws
// outside a BillingProvider rather than returning a partial value.
export function useBilling(): BillingContextValue {
  const value = useContext(BillingContext)
  if (!value)
    throw new Error(
      "@openrails/billing: useBilling requires a <BillingProvider>"
    )
  return value
}
