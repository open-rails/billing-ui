// A 202 means the server recorded the request and a durable intent carries
// it out. There is no operation-status route yet, so settlement is observed
// by re-reading the resource until the host's predicate holds, bounded by a
// timeout. When it settles, the dependent keys are invalidated once.
import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import type { BillingError } from "../core/errors"
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
  polling: boolean
}

interface Generation {
  enabled: boolean
  n: number
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

  // A new polling window opens whenever `enabled` flips on: the generation
  // counter is adjusted during render (pure), its start time is stamped in
  // an effect, and the timeout/invalidation are keyed on it.
  const [gen, setGen] = useState<Generation>({ enabled, n: 0 })
  if (gen.enabled !== enabled)
    setGen({ enabled, n: enabled ? gen.n + 1 : gen.n })
  const generation = enabled ? gen.n : null
  const startedAt = useRef<number | null>(null)
  useEffect(() => {
    startedAt.current = generation === null ? null : Date.now()
  }, [generation])

  const [expiredGeneration, setExpiredGeneration] = useState<number | null>(
    null
  )
  const timedOut = generation !== null && expiredGeneration === generation
  const invalidatedGeneration = useRef<number | null>(null)

  const query = useQuery<T, BillingError, T, QueryKey>({
    queryKey,
    queryFn: ({ signal }) => queryFn(signal),
    enabled,
    retry: false,
    staleTime: 0,
    refetchInterval: (state) => {
      if (generation === null) return false
      const data = state.state.data
      if (data !== undefined && settled(data)) return false
      const began = startedAt.current ?? Date.now()
      if (Date.now() - began >= timeoutMs) return false
      return intervalMs
    },
  })

  const isSettled = query.data !== undefined && settled(query.data)

  useEffect(() => {
    if (generation === null || isSettled) return
    const timer = setTimeout(() => setExpiredGeneration(generation), timeoutMs)
    return () => clearTimeout(timer)
  }, [generation, isSettled, timeoutMs])

  useEffect(() => {
    if (
      !isSettled ||
      generation === null ||
      invalidatedGeneration.current === generation
    )
      return
    invalidatedGeneration.current = generation
    for (const key of invalidates)
      void queryClient.invalidateQueries({ queryKey: key })
  }, [isSettled, generation, invalidates, queryClient])

  return {
    query,
    settled: isSettled,
    timedOut: timedOut && !isSettled,
    polling: generation !== null && !isSettled && !timedOut,
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
  const { client, keys } = useBilling()
  return usePolledQuery<Subscription>({
    queryKey: keys.subscriptions.detail(id ?? ""),
    queryFn: (signal) =>
      client.getSubscription(id as SubscriptionID, { signal }),
    settled,
    invalidates: [keys.subscriptions.root, keys.status],
    ...options,
    enabled: (options.enabled ?? true) && !!id,
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
  const { client, keys } = useBilling()
  return usePolledQuery<Invoice>({
    queryKey: keys.invoices.detail(id ?? ""),
    queryFn: (signal) => client.getInvoice(id as string, { signal }),
    settled,
    invalidates: [keys.invoices.root, keys.payments.root, keys.status],
    ...options,
    enabled: (options.enabled ?? true) && !!id,
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
  const { client, keys } = useBilling()
  return usePolledQuery<PaymentMethod[]>({
    queryKey: [...keys.paymentMethods.root, "settlement"],
    queryFn: async (signal) =>
      (await client.listPaymentMethods({ limit: 100 }, { signal })).data,
    settled,
    invalidates: [keys.paymentMethods.root, keys.subscriptions.root],
    ...options,
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
  const { client, keys } = useBilling()
  const watching =
    !!invoiceId && !!operation && isOperationUnresolved(operation)
  return usePolledQuery<Invoice>({
    queryKey: keys.invoices.detail(invoiceId ?? ""),
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
  const { client, keys } = useBilling()
  const watching =
    !!subscriptionId && !!operation && isOperationUnresolved(operation)
  return usePolledQuery<Subscription>({
    queryKey: keys.subscriptions.detail(subscriptionId ?? ""),
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
