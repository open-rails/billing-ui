# @openrails/billing

A thin direct-browser client for OpenRails' self-service (`/v1/me`) surface:
exact-money DTOs, one transport, React Query hooks and neutral views. Hosts
own AuthKit tokens, routing, copy and support workflows; OpenRails owns
billing policy and state transitions; this package owns transport, schema
checks, exact money, cache state, idempotency and neutral controls. It never
imports host routers, stores, i18n or themes, and never receives merchant
credentials, PSP secrets, a PAN or a CVV.

```tsx
import { createTransport, dpopAuth } from "@openrails/billing/transport"
import { createBillingClient } from "@openrails/billing/client"
import { BillingProvider, useBillingStatus, useMoney } from "@openrails/billing/react"

const transport = createTransport({
  baseUrl: "https://billing.example", // or "https://site.example/api/openrails"
  auth: dpopAuth(() => session.delegatedToken, session.dpopKey),
})
const client = createBillingClient(transport)

<QueryClientProvider client={queryClient}>
  <BillingProvider client={client} merchant="acme" subject={user?.id ?? null}>
    <Account />
  </BillingProvider>
</QueryClientProvider>
```

## `core`

Zod schemas for every `/v1/me` shape (subscription, billing status,
entitlements, notifications, payments, payment methods, invoices, checkout
sessions, tier changes), typed ids (`sub_`, `price_`, `pm_`, ...), the error
envelope with `ErrorCode`/`ErrorType`, and money: `Amount` is an int64 decimal
string, `parseCurrencyRegistry` reads `GET /v1/currencies`, `formatMoney`
renders at the registry scale with BigInt + Intl and refuses what it cannot
show exactly. Schemas strip unknown fields and are pinned by the canonical
OpenRails fixtures in `src/test/fixtures/wire`.

## `transport`

`createTransport({ baseUrl, auth, fetch?, credentials?, headers?, retry?,
timeoutMs? })` gives one `request` function. `AuthProvider.credential()` is
asked per request (Bearer, DPoP with a fresh ES256 proof whose `htu` is the
final URL, or the host's cookie contract); `refresh()` runs once on a 401 and
the request is replayed with the same `Idempotency-Key`. Cross-origin
`credentials` defaults to `omit`. GETs retry network / 5xx / 429 with
`Retry-After`; mutations never retry. Errors are `BillingError` with
`status`, `code`, `param`, `requestId`, `metadata`, `retryAfterMs` and
`kind` (`response`, `network` = outcome unknown, `invalid_response`).

## `client`

`createBillingClient(transport)`: `currencies`, `status`,
`activeEntitlements`, `listSubscriptions`/`getSubscription`/
`cancelSubscription`/`resumeSubscription`/`updateSubscriptionPaymentMethod`/
`previewTierChange`/`changeTier`, `listPaymentMethods`/`createPaymentMethod`/
`updatePaymentMethod`/`deletePaymentMethod`/`setCollectionPaymentMethod`,
`listPayments`, `listInvoices`/`getInvoice`, `listNotifications`/
`unreadNotificationCount`/`markNotificationRead`, `createCheckoutSession`/
`getCheckoutSession`/`confirmCheckoutSession`. Mutations return
`Accepted<T>` (`status`, `data`, `idempotencyKey`); 202/204 outcomes are
named (`"queued"`, `outcome: "pending" | "completed"`). `payInvoiceNow` and
`retrySubscriptionNow` are typed against the #809 contract and pending its
core PR.

## `react`

`BillingProvider` binds a client and scope on the host's `QueryClient`.
`billingKeys(scope)` scopes every key by base URL, merchant and subject.
Read hooks (`useBillingStatus`, `useSubscriptions`, `useSubscription`,
`usePaymentMethods`, `usePayments`, `useInvoices`, `useInvoice`,
`useNotifications`, `useUnreadNotificationCount`, `useCheckoutSession`,
`useActiveEntitlements`, `useCurrencies`, `useMoney`) are disabled without a
subject. Mutation hooks invalidate dependent keys only after an accepted
response. `useSubscriptionSettlement`/`useInvoiceSettlement`/
`usePaymentMethodSettlement` poll after a 202 until a predicate holds, with
a timeout.

## `components`

Controlled, unstyled views with `orb-*` class hooks, `data-*` state and
replaceable `labels`: `InvoiceList`, `SavedMethods`, `SubscriptionState`,
`PaymentRecovery`, `CheckoutView`. They render DTO flags (`resumable`,
`cancel_scheduled`, `cancel_mode`, `next_retry_at`, `health`,
`collection_default_currencies`) and never decide eligibility; pay-now and
retry-now controls appear only when the host passes the server's flag.

## `checkout`

Re-exports `openrails-checkout` (the hosted checkout flow) until the direct
`/v1/me/checkout` flow is qualified and the component moves in here.
Requires the optional peer `openrails-checkout`.
