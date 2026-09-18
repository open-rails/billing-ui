import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { createBillingClient } from "../client"
import billingStatus from "../test/fixtures/wire/billing_status.json"
import currencies from "../test/fixtures/wire/currencies.json"
import invoicePayNow from "../test/fixtures/wire/invoice_pay_now.json"
import subscription from "../test/fixtures/wire/subscription.json"
import {
  NetworkFailure,
  errorEnvelope,
  fixtureServer,
  json,
} from "../test/server"
import { bearerAuth, type AuthProvider } from "../transport/auth"
import { createTransport } from "../transport/request"
import { billingKeys } from "./keys"
import {
  useCancelSubscription,
  useDeletePaymentMethod,
  usePayInvoiceNow,
  useRetrySubscriptionNow,
} from "./mutations"
import {
  useInvoiceRecoverySettlement,
  usePolledQuery,
  useSubscriptionRecoverySettlement,
  useSubscriptionSettlement,
} from "./polling"
import { BillingProvider } from "./provider"
import {
  useBillingStatus,
  useInvoicePayments,
  useMoney,
  useSubscription,
} from "./queries"

const subId = "sub_cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const pmId = "pm_dddddddd-dddd-4ddd-8ddd-dddddddddddd"

function page<T>(data: T[]) {
  return {
    object: "list",
    data,
    total: data.length,
    limit: 20,
    offset: 0,
    has_more: false,
  }
}

function harness(
  options: {
    baseUrl?: string
    merchant?: string
    subject?: string | null
    auth?: AuthProvider
    queryClient?: QueryClient
  } = {}
) {
  const server = fixtureServer()
  const transport = createTransport({
    baseUrl: options.baseUrl ?? "https://billing.example",
    auth: options.auth ?? bearerAuth("tok"),
    fetch: server.fetch,
    sleep: async () => {},
    idempotencyKey: () => "idem_1",
  })
  const client = createBillingClient(transport)
  const queryClient =
    options.queryClient ??
    new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <BillingProvider
        client={client}
        merchant={options.merchant ?? "acme"}
        subject={options.subject === undefined ? "user-1" : options.subject}
      >
        {children}
      </BillingProvider>
    </QueryClientProvider>
  )
  return { server, client, queryClient, wrapper }
}

describe("billingKeys", () => {
  it("scopes every key by base URL, merchant and subject", () => {
    const a = billingKeys({
      baseUrl: "https://a.example",
      merchant: "acme",
      subject: "u1",
    })
    const b = billingKeys({
      baseUrl: "https://a.example",
      merchant: "acme",
      subject: "u2",
    })
    const c = billingKeys({
      baseUrl: "https://a.example",
      merchant: "other",
      subject: "u1",
    })
    const d = billingKeys({
      baseUrl: "https://b.example",
      merchant: "acme",
      subject: "u1",
    })
    expect(a.status).toEqual([
      "openrails-billing",
      "https://a.example",
      "acme",
      "u1",
      "status",
    ])
    for (const other of [b, c, d]) expect(other.status).not.toEqual(a.status)
    expect(a.subscriptions.detail("sub_1").slice(0, 4)).toEqual(a.root)
    expect(a.invoices.list({ limit: 5 })).toEqual([
      ...a.root,
      "invoices",
      "list",
      { limit: 5 },
    ])
    // The registry is deployment-scoped only: the same for every merchant/subject.
    expect(a.currencies).toEqual(b.currencies)
    expect(a.currencies).toEqual(c.currencies)
    expect(a.currencies).not.toEqual(d.currencies)
  })
})

describe("queries", () => {
  it("reads status through the provider and is disabled without a subject", async () => {
    const { server, wrapper } = harness()
    server.route("GET", "/v1/me/status", () => json(billingStatus))
    const { result } = renderHook(() => useBillingStatus(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.subscription?.id).toBe(subId)

    const anonymous = harness({ subject: null })
    const { result: off } = renderHook(() => useBillingStatus(), {
      wrapper: anonymous.wrapper,
    })
    expect(off.current.fetchStatus).toBe("idle")
    expect(anonymous.server.requests).toHaveLength(0)
  })

  it("never serves one merchant's cache to another scope on a shared QueryClient", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const acme = harness({ merchant: "acme", queryClient })
    acme.server.route("GET", `/v1/me/subscriptions/${subId}`, () =>
      json(subscription)
    )
    const { result } = renderHook(() => useSubscription(subId), {
      wrapper: acme.wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const other = harness({ merchant: "other", queryClient })
    other.server.route("GET", `/v1/me/subscriptions/${subId}`, () =>
      errorEnvelope(404, "resource_not_found")
    )
    const { result: refused } = renderHook(() => useSubscription(subId), {
      wrapper: other.wrapper,
    })
    await waitFor(() => expect(refused.current.isError).toBe(true))
    expect(refused.current.data).toBeUndefined()
    expect(refused.current.error?.isNotFound).toBe(true)
    expect(other.server.requests).toHaveLength(1)
  })

  it("useMoney formats at the registry scale once it loads", async () => {
    const { server, wrapper } = harness()
    server.route("GET", "/v1/currencies", () => json(currencies))
    const { result } = renderHook(() => useMoney(), { wrapper })
    expect(result.current.ready).toBe(false)
    expect(result.current.format("12340000", "JPY")).toBe(
      "JPY amount in unregistered currency"
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.format("12340000", "JPY")).toBe("¥1,234")
    expect(result.current.format("9223372036854775807", "USD")).toBe(
      "$9,223,372,036,854.775807"
    )
  })

  it("refreshes once on 401 through the host AuthProvider", async () => {
    const refresh = vi.fn(async () => ({
      scheme: "Bearer" as const,
      token: "fresh",
    }))
    const { server, wrapper } = harness({
      auth: {
        credential: () => ({ scheme: "Bearer", token: "stale" }),
        refresh,
      },
    })
    server.route("GET", "/v1/me/status", (req) =>
      req.headers.get("Authorization") === "Bearer fresh"
        ? json(billingStatus)
        : errorEnvelope(401, "unauthorized")
    )
    const { result } = renderHook(() => useBillingStatus(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(server.requests).toHaveLength(2)
  })
})

describe("mutations", () => {
  it("invalidates subscription and status keys only after an accepted 202", async () => {
    const { server, wrapper, queryClient } = harness()
    let cancelled = false
    server.route("GET", "/v1/me/status", () =>
      json({
        ...billingStatus,
        subscription: { ...subscription, cancel_scheduled: cancelled },
      })
    )
    server.route("POST", `/v1/me/subscriptions/${subId}/cancel`, (_r, n) => {
      if (n === 1)
        return errorEnvelope(400, "invalid_param", { param: "feedback" })
      cancelled = true
      return json({ status: "queued" }, 202)
    })
    const { result } = renderHook(
      () => ({ status: useBillingStatus(), cancel: useCancelSubscription() }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.status.isSuccess).toBe(true))
    const statusFetches = () =>
      server.requests.filter((r) => r.path === "/v1/me/status").length
    expect(statusFetches()).toBe(1)

    // Refused: nothing is invalidated, the cache still shows the old state.
    await act(async () => {
      await result.current.cancel
        .mutateAsync({ id: subId, request: { feedback: "nope" } })
        .catch(() => undefined)
    })
    await waitFor(() => expect(result.current.cancel.error?.status).toBe(400))
    expect(statusFetches()).toBe(1)
    expect(result.current.status.data?.subscription?.cancel_scheduled).toBe(
      false
    )

    // Accepted: dependent keys are invalidated and refetched.
    await act(async () => {
      await result.current.cancel.mutateAsync({
        id: subId,
        request: { feedback: "done here" },
      })
    })
    await waitFor(() =>
      expect(result.current.cancel.data).toMatchObject({
        status: 202,
        idempotencyKey: "idem_1",
      })
    )
    await waitFor(() => expect(statusFetches()).toBe(2))
    await waitFor(() =>
      expect(result.current.status.data?.subscription?.cancel_scheduled).toBe(
        true
      )
    )
    const keys = billingKeys({
      baseUrl: "https://billing.example",
      merchant: "acme",
      subject: "user-1",
    })
    expect(queryClient.getQueryState(keys.status)?.isInvalidated).toBe(false)
  })

  it("does not invalidate on a lost response", async () => {
    const { server, wrapper } = harness()
    server.route("GET", "/v1/me/payment-methods", () => json(page([])))
    server.route("DELETE", `/v1/me/payment-methods/${pmId}`, () => {
      throw new TypeError("fetch failed")
    })
    const { result } = renderHook(() => useDeletePaymentMethod(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: pmId }).catch(() => undefined)
    })
    await waitFor(() => expect(result.current.error?.kind).toBe("network"))
    expect(result.current.error?.isOutcomeUnknown).toBe(true)
    expect(server.requests.filter((r) => r.method === "GET")).toHaveLength(0)
  })
})

describe("202 polling", () => {
  it("re-reads the subscription until the predicate holds, then invalidates once", async () => {
    const { server, wrapper, queryClient } = harness()
    let reads = 0
    server.route("GET", `/v1/me/subscriptions/${subId}`, () => {
      reads += 1
      return json({ ...subscription, cancel_scheduled: reads >= 3 })
    })
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(
      () =>
        useSubscriptionSettlement(subId, (s) => s.cancel_scheduled, {
          intervalMs: 10,
          timeoutMs: 5_000,
        }),
      { wrapper }
    )
    expect(result.current.polling).toBe(true)
    await waitFor(() => expect(result.current.settled).toBe(true), {
      timeout: 3_000,
    })
    expect(result.current.polling).toBe(false)
    expect(result.current.timedOut).toBe(false)
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    const keys = billingKeys({
      baseUrl: "https://billing.example",
      merchant: "acme",
      subject: "user-1",
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: keys.subscriptions.root,
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.status })
    // Settled at the third read; the invalidation refetches the detail once
    // more (it is under subscriptions.root) and then polling is over.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))
    const calls = invalidate.mock.calls.length
    const settledReads = reads
    expect(settledReads).toBeGreaterThanOrEqual(3)
    expect(settledReads).toBeLessThanOrEqual(4)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(invalidate.mock.calls.length).toBe(calls)
    expect(reads).toBe(settledReads)
  })

  it("stops and reports a timeout when the change never lands", async () => {
    const { server, wrapper } = harness()
    server.route("GET", `/v1/me/subscriptions/${subId}`, () =>
      json(subscription)
    )
    const { result } = renderHook(
      () =>
        useSubscriptionSettlement(subId, (s) => s.cancel_scheduled, {
          intervalMs: 10,
          timeoutMs: 60,
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.timedOut).toBe(true), {
      timeout: 3_000,
    })
    expect(result.current.settled).toBe(false)
    expect(result.current.polling).toBe(false)
    const reads = server.requests.length
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(server.requests.length).toBe(reads)
  })
})

describe("#809 recovery hooks", () => {
  const invoiceId = invoicePayNow.invoice.id
  const operation = invoicePayNow.operation
  const recoveryDone = {
    retryable: false,
    blocked_reason: "not_due",
    attempt_count: 3,
    compatible_payment_method_ids: [pmId],
  }

  it("pay-now 202 → polls the invoice by operation status → settled → reads the attempt", async () => {
    const { server, wrapper, queryClient } = harness()
    let invoiceReads = 0
    server.route("POST", `/v1/me/invoices/${invoiceId}/pay-now`, () =>
      json(invoicePayNow, 202)
    )
    server.route("GET", `/v1/me/invoices/${invoiceId}`, () => {
      invoiceReads += 1
      // Unresolved on the first two reads, then the verifier settles it.
      return invoiceReads < 3
        ? json({
            ...invoicePayNow.invoice,
            recovery: {
              ...invoicePayNow.invoice.recovery,
              operation: { ...operation, status: "in_flight" },
            },
          })
        : json({
            ...invoicePayNow.invoice,
            status: "paid",
            amount_due: "0",
            recovery: recoveryDone,
          })
    })
    server.route("GET", `/v1/me/invoices/${invoiceId}/payments`, () =>
      json({
        object: "list",
        data: [{ ...invoicePayNow.attempt, status: "settled" }],
        total: 1,
        limit: 20,
        offset: 0,
        has_more: false,
      })
    )
    const invalidate = vi.spyOn(queryClient, "invalidateQueries")
    const { result } = renderHook(
      () => {
        const pay = usePayInvoiceNow()
        const settlement = useInvoiceRecoverySettlement(
          invoiceId,
          pay.data?.status === 202 ? pay.data.data.operation : null,
          { intervalMs: 10, timeoutMs: 5_000 }
        )
        const attempts = useInvoicePayments(
          settlement.settled ? invoiceId : null
        )
        return { pay, settlement, attempts }
      },
      { wrapper }
    )
    expect(result.current.settlement.polling).toBe(false)
    await act(async () => {
      await result.current.pay.mutateAsync({
        invoiceId,
        request: { payment_method_id: pmId },
      })
    })
    await waitFor(() => expect(result.current.pay.data?.status).toBe(202))
    await waitFor(() => expect(result.current.settlement.settled).toBe(true), {
      timeout: 3_000,
    })
    expect(invoiceReads).toBeGreaterThanOrEqual(3)
    expect(result.current.settlement.query.data?.status).toBe("paid")
    await waitFor(() =>
      expect(result.current.attempts.data?.data[0].status).toBe("settled")
    )
    const keys = billingKeys({
      baseUrl: "https://billing.example",
      merchant: "acme",
      subject: "user-1",
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.invoices.root })
    // One POST, one key, never resent while polling.
    const posts = server.requests.filter((r) => r.method === "POST")
    expect(posts).toHaveLength(1)
    expect(posts[0].headers.get("Idempotency-Key")).toBe("idem_1")
  })

  it("stays idle for a 200 and never polls a resolved operation", async () => {
    const { server, wrapper } = harness()
    const { result } = renderHook(
      () =>
        useSubscriptionRecoverySettlement(
          subId,
          { ...operation, status: "succeeded" },
          { intervalMs: 10 }
        ),
      { wrapper }
    )
    expect(result.current.polling).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(server.requests).toHaveLength(0)
  })

  it("retry-now on a lost response sends once, invalidates nothing and reports outcome unknown", async () => {
    const { server, wrapper } = harness()
    server.route("POST", `/v1/me/subscriptions/${subId}/retry-now`, () => {
      throw new NetworkFailure()
    })
    const { result } = renderHook(() => useRetrySubscriptionNow(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: subId }).catch(() => undefined)
    })
    await waitFor(() =>
      expect(result.current.error?.isOutcomeUnknown).toBe(true)
    )
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0].headers.get("Idempotency-Key")).toBe("idem_1")
  })
})

// PR13 review findings 2, 3, 5 and 6.
describe("mutation identity", () => {
  it("does not inherit host automatic mutation retries with fresh operation keys", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: 3, retryDelay: 0 },
        queries: { retry: false },
      },
    })
    let n = 0
    const server = fixtureServer()
    server.route("POST", `/v1/me/subscriptions/${subId}/cancel`, () => {
      throw new NetworkFailure()
    })
    const transport = createTransport({
      baseUrl: "https://billing.example",
      auth: bearerAuth("tok"),
      fetch: server.fetch,
      idempotencyKey: () => `generated-${++n}`,
    })
    const client = createBillingClient(transport)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <BillingProvider client={client} merchant="acme" subject="user-1">
          {children}
        </BillingProvider>
      </QueryClientProvider>
    )
    const { result } = renderHook(() => useCancelSubscription(), { wrapper })
    await act(async () => {
      await result.current
        .mutateAsync({ id: subId, request: { feedback: "No longer needed" } })
        .catch(() => undefined)
    })
    expect(
      server.requests.map((r) => r.headers.get("Idempotency-Key"))
    ).toEqual(["generated-1"])
    await waitFor(() =>
      expect(result.current.error?.idempotencyKey).toBe("generated-1")
    )
  })

  it("reuses the key for an identical retry after an uncertain failure only", async () => {
    let n = 0
    const server = fixtureServer()
    let outcome: "lost" | "ok" | "refused" = "lost"
    server.route(
      "POST",
      `/v1/me/invoices/${invoicePayNow.invoice.id}/pay-now`,
      () => {
        if (outcome === "lost") throw new NetworkFailure()
        if (outcome === "refused")
          return errorEnvelope(409, "invoice_not_retryable")
        return json({
          ...invoicePayNow,
          operation: { ...invoicePayNow.operation, status: "succeeded" },
        })
      }
    )
    const transport = createTransport({
      baseUrl: "https://billing.example",
      auth: bearerAuth("tok"),
      fetch: server.fetch,
      idempotencyKey: () => `generated-${++n}`,
    })
    const client = createBillingClient(transport)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <BillingProvider client={client} merchant="acme" subject="user-1">
          {children}
        </BillingProvider>
      </QueryClientProvider>
    )
    const { result } = renderHook(() => usePayInvoiceNow(), { wrapper })
    const pay = (payment_method_id: string) =>
      act(async () => {
        await result.current
          .mutateAsync({
            invoiceId: invoicePayNow.invoice.id,
            request: { payment_method_id: payment_method_id as typeof pmId },
          })
          .catch(() => undefined)
      })
    const keys = () =>
      server.requests.map((r) => r.headers.get("Idempotency-Key"))

    await pay(pmId) // lost
    await pay(pmId) // identical retry: same operation
    expect(keys()).toEqual(["generated-1", "generated-1"])
    await pay("pm_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee") // different terms: new operation
    expect(keys()[2]).toBe("generated-2")
    outcome = "ok"
    await pay("pm_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee") // replays generated-2 and succeeds
    expect(keys()[3]).toBe("generated-2")
    await pay("pm_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee") // after success: a new operation
    expect(keys()[4]).toBe("generated-3")
    outcome = "refused"
    await pay(pmId) // certain refusal clears it
    await pay(pmId)
    expect(keys().slice(5)).toEqual(["generated-4", "generated-5"])
  })
})

describe("settlement freshness and scope", () => {
  const invoiceId = invoicePayNow.invoice.id
  const inFlight = { ...invoicePayNow.operation, status: "in_flight" as const }

  it("does not settle a new 202 from the cached pre-action invoice", async () => {
    const { server, wrapper, queryClient } = harness()
    let release!: () => void
    server.route(
      "GET",
      `/v1/me/invoices/${invoiceId}`,
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              json({
                ...invoicePayNow.invoice,
                recovery: {
                  ...invoicePayNow.invoice.recovery,
                  operation: null,
                },
              })
            )
        })
    )
    const keys = billingKeys({
      baseUrl: "https://billing.example",
      merchant: "acme",
      subject: "user-1",
    })
    // Pre-action cache: no live operation.
    queryClient.setQueryData(keys.invoices.detail(invoiceId), {
      ...invoicePayNow.invoice,
      recovery: { ...invoicePayNow.invoice.recovery, operation: null },
    })
    const { result } = renderHook(
      () =>
        useInvoiceRecoverySettlement(invoiceId, inFlight, { intervalMs: 10 }),
      { wrapper }
    )
    expect(result.current.settled).toBe(false)
    expect(result.current.polling).toBe(true)
    await waitFor(() => expect(server.requests).toHaveLength(1))
    expect(result.current.settled).toBe(false)
    // The fresh post-action read settles it.
    await act(async () => release())
    await waitFor(() => expect(result.current.settled).toBe(true))
  })

  it("does not run a settlement read while signed out", async () => {
    const { server, wrapper } = harness({ subject: null })
    server.route("GET", `/v1/me/invoices/${invoiceId}`, () =>
      json(invoicePayNow.invoice)
    )
    const { result } = renderHook(
      () => ({
        invoice: useInvoiceRecoverySettlement(invoiceId, inFlight, {
          intervalMs: 5,
        }),
        subscription: useSubscriptionRecoverySettlement(subId, inFlight, {
          intervalMs: 5,
        }),
        predicate: useSubscriptionSettlement(subId, () => false, {
          intervalMs: 5,
        }),
      }),
      { wrapper }
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(server.requests).toHaveLength(0)
    expect(result.current.invoice.polling).toBe(false)
    expect(result.current.subscription.polling).toBe(false)
    expect(result.current.predicate.polling).toBe(false)
  })

  it("stops polling when the credential goes away mid-settlement", async () => {
    let token: string | null = "tok"
    const { server, wrapper } = harness({ auth: bearerAuth(() => token) })
    server.route("GET", `/v1/me/invoices/${invoiceId}`, () => {
      token = null // signed out after the first read
      return json(invoicePayNow.invoice)
    })
    const { result } = renderHook(
      () =>
        useInvoiceRecoverySettlement(invoiceId, inFlight, {
          intervalMs: 5,
          timeoutMs: 5_000,
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.stopped).toBe(true))
    expect(result.current.polling).toBe(false)
    expect(result.current.query.error?.code).toBe("not_signed_in")
    const sent = server.requests.length
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(server.requests).toHaveLength(sent)
    expect(sent).toBe(1)
  })

  it("starts a fresh polling generation when the resource changes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result, rerender } = renderHook(
      ({ id }) =>
        usePolledQuery({
          queryKey: ["resource", id],
          queryFn: async () => ({ id }),
          settled: () => false,
          intervalMs: 5,
          timeoutMs: 20,
        }),
      { initialProps: { id: "A" }, wrapper }
    )
    await waitFor(() => expect(result.current.timedOut).toBe(true))
    rerender({ id: "B" })
    expect(result.current.timedOut).toBe(false)
    expect(result.current.polling).toBe(true)
    await waitFor(() => expect(result.current.query.data).toEqual({ id: "B" }))
    await waitFor(() => expect(result.current.timedOut).toBe(true))
  })

  it("starts a fresh generation when the subject changes", async () => {
    const server = fixtureServer()
    server.route("GET", `/v1/me/subscriptions/${subId}`, () =>
      json(subscription)
    )
    const client = createBillingClient(
      createTransport({
        baseUrl: "https://billing.example",
        auth: bearerAuth("tok"),
        fetch: server.fetch,
      })
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    let subject = "user-1"
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <BillingProvider client={client} merchant="acme" subject={subject}>
          {children}
        </BillingProvider>
      </QueryClientProvider>
    )
    const { result, rerender } = renderHook(
      () =>
        useSubscriptionSettlement(subId, () => false, {
          intervalMs: 5,
          timeoutMs: 20,
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.timedOut).toBe(true))
    subject = "user-2"
    rerender()
    expect(result.current.timedOut).toBe(false)
    expect(result.current.polling).toBe(true)
  })
})
