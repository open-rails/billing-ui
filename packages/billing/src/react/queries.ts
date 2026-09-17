// Read hooks on the host's QueryClient. Each is disabled while there is no
// authenticated subject; each retries only what the transport could not
// settle (network / 5xx / 429 are already retried once per GET there, so the
// query layer retries nothing by default).
import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query"

import type { PageParams } from "../client"
import { BillingError } from "../core/errors"
import type { CheckoutSessionID, SubscriptionID } from "../core/ids"
import {
  formatMoney,
  lookupCurrency,
  type Amount,
  type CurrencyRegistry,
  type CurrencyUnits,
  type FormatMoneyOptions,
} from "../core/money"
import type {
  ActiveEntitlement,
  BillingStatus,
  CheckoutSession,
  Invoice,
  InvoiceListResponse,
  Notification,
  Page,
  Payment,
  PaymentMethod,
  Subscription,
} from "../core/schemas"
import { useBilling } from "./context"

// Host overrides for a read hook: anything but the key and function.
export type QueryOverrides<T> = Omit<
  UseQueryOptions<T, BillingError, T, QueryKey>,
  "queryKey" | "queryFn"
>

function useScopedQuery<T>(
  queryKey: QueryKey,
  queryFn: (signal: AbortSignal) => Promise<T>,
  enabled: boolean,
  overrides?: QueryOverrides<T>
): UseQueryResult<T, BillingError> {
  return useQuery<T, BillingError, T, QueryKey>({
    retry: false,
    ...overrides,
    queryKey,
    queryFn: ({ signal }) => queryFn(signal),
    enabled: enabled && (overrides?.enabled ?? true),
  })
}

export function useCurrencies(
  overrides?: QueryOverrides<CurrencyRegistry>
): UseQueryResult<CurrencyRegistry, BillingError> {
  const { client, keys } = useBilling()
  return useScopedQuery(
    keys.currencies,
    (signal) => client.currencies({ signal }),
    true,
    { staleTime: Infinity, gcTime: Infinity, ...overrides }
  )
}

export interface Money {
  ready: boolean
  registry: CurrencyRegistry | undefined
  units(currency: string | undefined): CurrencyUnits | undefined
  format(
    amount: Amount | null | undefined,
    currency: string | undefined,
    options?: FormatMoneyOptions
  ): string
}

// useMoney binds formatMoney to the loaded registry. Until it loads, or for
// a currency it does not carry, format renders the refusal notice rather
// than a wrong figure.
export function useMoney(): Money {
  const { data: registry } = useCurrencies()
  return {
    ready: registry !== undefined,
    registry,
    units: (currency) => lookupCurrency(registry, currency),
    format: (amount, currency, options) =>
      formatMoney(amount, currency, registry, options),
  }
}

export function useBillingStatus(
  overrides?: QueryOverrides<BillingStatus>
): UseQueryResult<BillingStatus, BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.status,
    (signal) => client.status({ signal }),
    scope.subject !== null,
    overrides
  )
}

export function useActiveEntitlements(
  params: { at?: string } = {},
  overrides?: QueryOverrides<ActiveEntitlement[]>
): UseQueryResult<ActiveEntitlement[], BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.entitlements(params),
    (signal) => client.activeEntitlements(params, { signal }),
    scope.subject !== null,
    overrides
  )
}

export function useSubscriptions(
  params: PageParams & { status?: string } = {},
  overrides?: QueryOverrides<Page<Subscription>>
): UseQueryResult<Page<Subscription>, BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.subscriptions.list(params),
    (signal) => client.listSubscriptions(params, { signal }),
    scope.subject !== null,
    overrides
  )
}

export function useSubscription(
  id: SubscriptionID | null | undefined,
  overrides?: QueryOverrides<Subscription>
): UseQueryResult<Subscription, BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.subscriptions.detail(id ?? ""),
    (signal) => client.getSubscription(id as SubscriptionID, { signal }),
    scope.subject !== null && !!id,
    overrides
  )
}

export function usePaymentMethods(
  params: PageParams = {},
  overrides?: QueryOverrides<Page<PaymentMethod>>
): UseQueryResult<Page<PaymentMethod>, BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.paymentMethods.list(params),
    (signal) => client.listPaymentMethods(params, { signal }),
    scope.subject !== null,
    overrides
  )
}

export function usePayments(
  params: PageParams & { type?: string } = {},
  overrides?: QueryOverrides<Page<Payment>>
): UseQueryResult<Page<Payment>, BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.payments.list(params),
    (signal) => client.listPayments(params, { signal }),
    scope.subject !== null,
    overrides
  )
}

export function useInvoices(
  params: PageParams = {},
  overrides?: QueryOverrides<InvoiceListResponse>
): UseQueryResult<InvoiceListResponse, BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.invoices.list(params),
    (signal) => client.listInvoices(params, { signal }),
    scope.subject !== null,
    overrides
  )
}

export function useInvoice(
  id: string | null | undefined,
  overrides?: QueryOverrides<Invoice>
): UseQueryResult<Invoice, BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.invoices.detail(id ?? ""),
    (signal) => client.getInvoice(id as string, { signal }),
    scope.subject !== null && !!id,
    overrides
  )
}

export function useNotifications(
  params: PageParams & { seen?: boolean } = {},
  overrides?: QueryOverrides<Page<Notification>>
): UseQueryResult<Page<Notification>, BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.notifications.list(params),
    (signal) => client.listNotifications(params, { signal }),
    scope.subject !== null,
    overrides
  )
}

export function useUnreadNotificationCount(
  overrides?: QueryOverrides<number>
): UseQueryResult<number, BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.notifications.unreadCount,
    (signal) => client.unreadNotificationCount({ signal }),
    scope.subject !== null,
    overrides
  )
}

export function useCheckoutSession(
  id: CheckoutSessionID | null | undefined,
  overrides?: QueryOverrides<CheckoutSession>
): UseQueryResult<CheckoutSession, BillingError> {
  const { client, keys, scope } = useBilling()
  return useScopedQuery(
    keys.checkoutSessions.detail(id ?? ""),
    (signal) => client.getCheckoutSession(id as CheckoutSessionID, { signal }),
    scope.subject !== null && !!id,
    overrides
  )
}
