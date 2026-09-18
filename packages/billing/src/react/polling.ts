// A 202 means the server recorded the request and a durable intent carries
// it out. Settlement is observed by re-reading the resource until the
// host's predicate holds, bounded by a timeout, then the dependent keys are
// invalidated once.
//
// Each polling generation is identified by the resource key (which carries
// base URL, merchant and subject) and reads under its own cache entry, so
// settlement is only ever judged from a read fetched in that generation —
// never from data cached before the action. Changing the resource, the
// subject or toggling `enabled` starts a new generation; a 401, 403 or 404
// ends polling.
import {
  hashKey,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { BillingError } from "../core/errors"
import type { SubscriptionID } from "../core/ids"
import {
  isOperationUnresolved,
  type PaymentOperation,
  type PaymentRecovery,
} from "../core/recovery"
import type { Invoice, PaymentMethod, Subscription } from "../core/schemas"
import { useBilling } from "./context"

export interface PollOptions<T> {
  queryKey: QueryKey
  queryFn: (signal: AbortSignal) => Promise<T>
  // True once the resource shows the accepted change.
  settled: (data: T) => boolean
  // Keys to invalidate when settled.
  invalidates?: QueryKey[]
  intervalMs?: number
  timeoutMs?: number
  enabled?: boolean
}

export interface PollResult<T> {
  query: UseQueryResult<T, BillingError>
  settled: boolean
  timedOut: boolean
  // Polling ended on a 401/403/404: signed out, denied or not the caller's.
  stopped: boolean
  polling: boolean
}

let generations = 0
function nextGeneration(): number {
  generations += 1
  return generations
}

interface Generation {
  identity: string | null
  token: number | null
}

function terminal(error: unknown): boolean {
  return (
    error instanceof BillingError &&
    (error.isUnauthorized || error.isDenied || error.isNotFound)
  )
}

export function usePolledQuery<T>(options: PollOptions<T>): PollResult<T> {
  const {
    queryKey,
    queryFn,
    settled,
    invalidates = [],
    intervalMs = 2_000,
    timeoutMs = 60_000,
    enabled = true,
  } = options
  const queryClient = useQueryClient()

  const identity = enabled ? hashKey(queryKey) : null
  const [gen, setGen] = useState<Generation>(() => ({
    identity,
    token: identity === null ? null : nextGeneration(),
  }))
  if (gen.identity !== identity)
    setGen({ identity, token: identity === null ? null : nextGeneration() })
  const token = gen.identity === identity ? gen.token : null

  const startedAt = useRef<number | null>(null)
  useEffect(() => {
    startedAt.current = token === null ? null : Date.now()
  }, [token])

  const [expiredToken, setExpiredToken] = useState<number | null>(null)
  const invalidatedToken = useRef<number | null>(null)

  const query = useQuery<T, BillingError, T, QueryKey>({
    queryKey: [...queryKey, { settlement: token ?? "idle" }],
    queryFn: ({ signal }) => queryFn(signal),
    enabled: token !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (state) => {
      if (token === null) return false
      const data = state.state.data
      if (data !== undefined && settled(data)) return false
      if (terminal(state.state.error)) return false
      const began = startedAt.current ?? Date.now()
      if (Date.now() - began >= timeoutMs) return false
      return intervalMs
    },
  })

  const isSettled =
    token !== null && query.data !== undefined && settled(query.data)
  const stopped = token !== null && !isSettled && terminal(query.error)
  const timedOut =
    token !== null && !isSettled && !stopped && expiredToken === token

  useEffect(() => {
    if (token === null || isSettled || stopped) return
    const timer = setTimeout(() => setExpiredToken(token), timeoutMs)
    return () => clearTimeout(timer)
  }, [token, isSettled, stopped, timeoutMs])

  useEffect(() => {
    if (!isSettled || token === null || invalidatedToken.current === token)
      return
    invalidatedToken.current = token
    for (const key of invalidates)
      void queryClient.invalidateQueries({ queryKey: key })
  }, [isSettled, token, invalidates, queryClient])

  return {
    query,
    settled: isSettled,
    timedOut,
    stopped,
    polling: token !== null && !isSettled && !stopped && !timedOut,
  }
}

// After an accepted cancel/resume/retry, watch one subscription until the
// host's predicate holds (e.g. `(s) => s.cancel_scheduled`).
export function useSubscriptionSettlement(
  id: SubscriptionID | null | undefined,
  settled: (subscription: Subscription) => boolean,
  options: Pick<
    PollOptions<Subscription>,
    "intervalMs" | "timeoutMs" | "enabled"
  > = {}
): PollResult<Subscription> {
  const { client, keys, scope } = useBilling()
  return usePolledQuery<Subscription>({
    queryKey: keys.subscriptions.detail(id ?? ""),
    queryFn: (signal) =>
      client.getSubscription(id as SubscriptionID, { signal }),
    settled,
    invalidates: [keys.subscriptions.root, keys.status],
    ...options,
    enabled: (options.enabled ?? true) && !!id && scope.subject !== null,
  })
}

export function useInvoiceSettlement(
  id: string | null | undefined,
  settled: (invoice: Invoice) => boolean,
  options: Pick<
    PollOptions<Invoice>,
    "intervalMs" | "timeoutMs" | "enabled"
  > = {}
): PollResult<Invoice> {
  const { client, keys, scope } = useBilling()
  return usePolledQuery<Invoice>({
    queryKey: keys.invoices.detail(id ?? ""),
    queryFn: (signal) => client.getInvoice(id as string, { signal }),
    settled,
    invalidates: [keys.invoices.root, keys.payments.root, keys.status],
    ...options,
    enabled: (options.enabled ?? true) && !!id && scope.subject !== null,
  })
}

// After a 202 on a payment-method delete/update, watch the list until the
// method is gone (or shows the replacement).
export function usePaymentMethodSettlement(
  settled: (methods: PaymentMethod[]) => boolean,
  options: Pick<
    PollOptions<PaymentMethod[]>,
    "intervalMs" | "timeoutMs" | "enabled"
  > = {}
): PollResult<PaymentMethod[]> {
  const { client, keys, scope } = useBilling()
  return usePolledQuery<PaymentMethod[]>({
    queryKey: [...keys.paymentMethods.root, "settlement"],
    queryFn: async (signal) =>
      (await client.listPaymentMethods({ limit: 100 }, { signal })).data,
    settled,
    invalidates: [keys.paymentMethods.root, keys.subscriptions.root],
    ...options,
    enabled: (options.enabled ?? true) && scope.subject !== null,
  })
}

// A #809 operation is settled once the resource no longer reports it as its
// unresolved recovery.operation (it resolved, or a newer one replaced it).
function operationSettled(
  recovery: PaymentRecovery | null | undefined,
  operation: PaymentOperation
): boolean {
  const live = recovery?.operation
  return !live || live.id !== operation.id || !isOperationUnresolved(live)
}

// After a 202 pay-now, poll GET /v1/me/invoices/{id} while `operation` is
// unresolved; when it settles, the invoice, its /payments attempts and the
// status are invalidated so the outcome is read, never inferred. Pass the
// 202's operation (or null to stay idle). Nothing is ever resent.
export function useInvoiceRecoverySettlement(
  invoiceId: string | null | undefined,
  operation: PaymentOperation | null | undefined,
  options: Pick<PollOptions<Invoice>, "intervalMs" | "timeoutMs"> = {}
): PollResult<Invoice> {
  const { client, keys, scope } = useBilling()
  const watching =
    !!invoiceId &&
    !!operation &&
    isOperationUnresolved(operation) &&
    scope.subject !== null
  return usePolledQuery<Invoice>({
    queryKey: [
      ...keys.invoices.detail(invoiceId ?? ""),
      "operation",
      operation?.id ?? "",
    ],
    queryFn: (signal) => client.getInvoice(invoiceId as string, { signal }),
    settled: (invoice) =>
      !operation || operationSettled(invoice.recovery, operation),
    invalidates: [keys.invoices.root, keys.payments.root, keys.status],
    ...options,
    enabled: watching,
  })
}

// After a 202 retry-now, poll GET /v1/me/subscriptions/{id} the same way.
export function useSubscriptionRecoverySettlement(
  subscriptionId: SubscriptionID | null | undefined,
  operation: PaymentOperation | null | undefined,
  options: Pick<PollOptions<Subscription>, "intervalMs" | "timeoutMs"> = {}
): PollResult<Subscription> {
  const { client, keys, scope } = useBilling()
  const watching =
    !!subscriptionId &&
    !!operation &&
    isOperationUnresolved(operation) &&
    scope.subject !== null
  return usePolledQuery<Subscription>({
    queryKey: [
      ...keys.subscriptions.detail(subscriptionId ?? ""),
      "operation",
      operation?.id ?? "",
    ],
    queryFn: (signal) =>
      client.getSubscription(subscriptionId as SubscriptionID, { signal }),
    settled: (subscription) =>
      !operation || operationSettled(subscription.recovery, operation),
    invalidates: [
      keys.subscriptions.root,
      keys.status,
      keys.entitlements(),
      keys.payments.root,
    ],
    ...options,
    enabled: watching,
  })
}
