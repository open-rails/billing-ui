# Changelog

## 0.1.0 (unreleased)

First cut of the shared direct-browser billing package (tracker #1011).

- `core`: `/v1/me` schemas pinned by OpenRails' canonical wire fixtures,
  typed ids, the error envelope and machine codes, the currency registry and
  lossless `formatMoney`.
- `transport`: base URL + request function with Bearer, DPoP (fresh proof per
  attempt, `htu` = final URL) and cookie credential modes, one 401 refresh
  replay, canonical `Idempotency-Key` on every mutation, GET-only retries with
  `Retry-After`, `credentials: omit` by default.
- `client`: status/entitlements, subscriptions (cancel, resume, payment
  method, tier change), payment methods, payments, invoices, notifications,
  checkout sessions; #809 `payInvoiceNow`/`retrySubscriptionNow`/
  `listInvoicePayments` on the exact core contract (openrails `dca35f2f3`),
  the `recovery` block on invoices and subscriptions, typed 402 declines and
  409 refusal codes.
- `react`: provider, scoped query keys, read and mutation hooks on the host's
  QueryClient, 202 settlement polling (operation-driven for #809).
- `components`: neutral `InvoiceList`, `SavedMethods`, `SubscriptionState`,
  `SubscriptionRecovery`, `RecoveryFacts`, `CheckoutView`.
- `checkout`: re-export of `openrails-checkout`.
