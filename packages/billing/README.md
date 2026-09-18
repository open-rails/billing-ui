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
final URL, or the host's cookie contract); with no credential nothing is sent
(`not_signed_in`). `refresh()` runs once on a 401 and the request is replayed
with the same `Idempotency-Key`. Cross-origin `credentials` defaults to
`omit`. Timeout and cancellation cover the whole attempt, body included. GETs
retry network / body / 5xx / 429 with `Retry-After`; mutations never retry.

Errors are `BillingError` with `status`, `code`, `param`, `requestId`,
`metadata`, `retryAfterMs`, `idempotencyKey` and `kind`: `response`,
`network`, `body` (response cut off, `response_body_interrupted`), `aborted`
(mutation cancelled after dispatch), `invalid_response`, `unauthenticated`.
`isOutcomeUnknown` marks a mutation that may have committed (lost, cut off,
cancelled, unreadable, 5xx): replay it only with `error.idempotencyKey`.

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
named (`"queued"`, `outcome: "pending" | "completed"`).

A tier change (#491/#495) always carries an `Idempotency-Key`: the server
refuses a keyless request, 202 means `status: "processing"` with
`operation_id`, replaying the same key reads the outcome back, another key
while one is unresolved is `tier_change_in_flight`, and a reused key with
different terms is `tier_change_idempotency_conflict`. `previewTierChange`
mutates nothing and is the one POST sent without a key.

Customer payment recovery (#809): `payInvoiceNow(invoiceId,
{payment_method_id})`, `retrySubscriptionNow(id, {payment_method_id?})` and
`listInvoicePayments(invoiceId)`. Each action sends one `Idempotency-Key`
(1–255 bytes) and is never retried. 200 is terminal; 202 returns the same
`{invoice|subscription, attempt|payment, operation, replayed}` with an
unresolved `operation` — watch it, never resend. A provider refusal is a 402
`BillingError` (`recoveryDeclineOf(error)` reads the recorded attempt); a
refusal to attempt is a coded 409 (`RECOVERY_REFUSAL_CODES`). Every `/v1/me`
invoice and subscription carries OpenRails' `recovery` block (`retryable`,
`blocked_reason`, `next_attempt_at`, `attempt_count`, `failure_category`,
`compatible_payment_method_ids`, `operation`); hosts read it instead of
re-deriving rail or dunning policy.

## `react`

`BillingProvider` binds a client and scope on the host's `QueryClient`.
`billingKeys(scope)` scopes every key by base URL, merchant and subject.
Read hooks (`useBillingStatus`, `useSubscriptions`, `useSubscription`,
`usePaymentMethods`, `usePayments`, `useInvoices`, `useInvoice`,
`useNotifications`, `useUnreadNotificationCount`, `useCheckoutSession`,
`useActiveEntitlements`, `useCurrencies`, `useMoney`) are disabled without a
subject. Mutation hooks never retry (whatever the host QueryClient's
defaults), invalidate dependent keys only after an accepted response, and
reuse the key of an outcome-unknown call when the host retries with identical
variables. `useSubscriptionSettlement`/`useInvoiceSettlement`/
`usePaymentMethodSettlement` poll after a 202 until a predicate holds, with
a timeout. Every polling generation reads under its own cache entry, so
settlement is judged only from a read fetched after the action; it restarts
when the resource, operation or subject changes and stops when signed out or
on 401/403/404; `useInvoiceRecoverySettlement(invoiceId, operation)` and
`useSubscriptionRecoverySettlement(id, operation)` poll a #809 202 by the
resource's `recovery.operation` and invalidate the invoice, its `/payments`
attempts and the status once it resolves. `usePayInvoiceNow`,
`useRetrySubscriptionNow` and `useInvoicePayments` wrap the recovery calls.

## `components`

Controlled, unstyled views with `orb-*` class hooks, `data-*` state and
replaceable `labels`: `InvoiceList`, `SavedMethods`, `SubscriptionState`,
`SubscriptionRecovery`, `CheckoutView`, and `RecoveryFacts`. They render DTO
flags (`resumable`, `cancel_scheduled`, `cancel_mode`, `health`,
`collection_default_currencies`, and the `recovery` block) and never decide
eligibility: pay-now / retry-now controls appear only when the server reports
`recovery.retryable` and no operation is unresolved; `blocked_reason`, 402
declines and 409 codes map to replaceable labels.

Server URLs are navigated only through `safeRedirectURL(url, {
allowedOrigins })`: absolute https, no credentials, origin on the host's list.
`CheckoutView` requires `redirectOrigins` and refuses any other provider hop;
`SubscriptionState` renders the cancel-portal link only with an allowed
`redirectOrigins`.

The hosted checkout flow is not part of this package yet; it moves in only
after the direct `/v1/me/checkout` contract is qualified.
