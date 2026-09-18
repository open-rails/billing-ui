// Mutation hooks. Dependent query keys are invalidated only after the
// server accepted the operation (a 2xx, including 202 "queued"); a refused
// or lost request invalidates nothing, so the cache never pretends a change
// happened. Automatic retry is always off, whatever the host QueryClient's
// defaults: a retry would carry a new Idempotency-Key. After an
// outcome-unknown failure the hook keeps that call's key and reuses it when
// the host retries with identical variables, so a replay is the same
// operation; any certain outcome clears it. The host's own onSuccess /
// onError run after ours.
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query"
import { useRef } from "react"

import type { Accepted, MutationOptions } from "../client"
import { BillingError } from "../core/errors"
import type {
  CheckoutSessionID,
  PaymentMethodID,
  PriceID,
  SubscriptionID,
} from "../core/ids"
import type {
  CancelSubscriptionRequest,
  CheckoutSession,
  ConfirmCheckoutSessionRequest,
  CreateCheckoutSessionRequest,
  CreatePaymentMethodRequest,
  InvoicePayNowResult,
  MutationOutcome,
  PayInvoiceNowRequest,
  PaymentMethod,
  QueuedResult,
  RetrySubscriptionNowRequest,
  SetCollectionPaymentMethodRequest,
  Subscription,
  SubscriptionRetryNowResult,
  TierChangeResponse,
  UpdatePaymentMethodRequest,
} from "../core/schemas"
import { useBilling, type BillingContextValue } from "./context"

export type MutationOverrides<TData, TVariables> = Omit<
  UseMutationOptions<TData, BillingError, TVariables>,
  "mutationFn" | "retry" | "retryDelay"
>

type Invalidate = (billing: BillingContextValue) => QueryKey[]

// A stable fingerprint of the operation's terms: the variables without the
// signal and key, with object keys sorted.
function operationTerms(variables: MutationOptions & object): string {
  const terms: Record<string, unknown> = { ...variables }
  delete terms.signal
  delete terms.idempotencyKey
  return JSON.stringify(terms, (_name, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        )
      : value
  )
}

function useBillingMutation<TData, TVariables extends MutationOptions & object>(
  mutationFn: (
    billing: BillingContextValue,
    variables: TVariables
  ) => Promise<TData>,
  invalidates: Invalidate,
  overrides?: MutationOverrides<TData, TVariables>
): UseMutationResult<TData, BillingError, TVariables> {
  const billing = useBilling()
  const queryClient = useQueryClient()
  const unresolved = useRef<{ terms: string; key: string } | null>(null)
  return useMutation<TData, BillingError, TVariables>({
    ...overrides,
    retry: false,
    mutationFn: async (variables) => {
      const terms = operationTerms(variables)
      const pending = unresolved.current
      const replay =
        !variables.idempotencyKey && pending?.terms === terms
          ? pending.key
          : undefined
      try {
        const result = await mutationFn(
          billing,
          replay ? { ...variables, idempotencyKey: replay } : variables
        )
        unresolved.current = null
        return result
      } catch (error) {
        unresolved.current =
          error instanceof BillingError &&
          error.isOutcomeUnknown &&
          error.idempotencyKey
            ? { terms, key: error.idempotencyKey }
            : null
        throw error
      }
    },
    onSuccess: async (data, variables, onMutateResult, context) => {
      await Promise.all(
        invalidates(billing).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey })
        )
      )
      await overrides?.onSuccess?.(data, variables, onMutateResult, context)
    },
  })
}

const subscriptionState: Invalidate = ({ keys }) => [
  keys.subscriptions.root,
  keys.status,
  keys.entitlements(),
]
const paymentMethodState: Invalidate = ({ keys }) => [
  keys.paymentMethods.root,
  keys.subscriptions.root,
]
const purchaseState: Invalidate = ({ keys }) => [
  keys.status,
  keys.subscriptions.root,
  keys.payments.root,
  keys.entitlements(),
  keys.checkoutSessions.root,
]

export function useCancelSubscription(
  overrides?: MutationOverrides<
    Accepted<QueuedResult>,
    { id: SubscriptionID; request: CancelSubscriptionRequest } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { id, request, ...options }) =>
      client.cancelSubscription(id, request, options),
    subscriptionState,
    overrides
  )
}

export function useResumeSubscription(
  overrides?: MutationOverrides<
    Accepted<QueuedResult>,
    { id: SubscriptionID } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { id, ...options }) => client.resumeSubscription(id, options),
    subscriptionState,
    overrides
  )
}

export function useUpdateSubscriptionPaymentMethod(
  overrides?: MutationOverrides<
    Accepted<Subscription>,
    { id: SubscriptionID; paymentMethodId: PaymentMethodID } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { id, paymentMethodId, ...options }) =>
      client.updateSubscriptionPaymentMethod(id, paymentMethodId, options),
    paymentMethodState,
    overrides
  )
}

export function useChangeTier(
  overrides?: MutationOverrides<
    Accepted<TierChangeResponse>,
    { id: SubscriptionID; priceId: PriceID } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { id, priceId, ...options }) =>
      client.changeTier(id, priceId, options),
    purchaseState,
    overrides
  )
}

export function useCreatePaymentMethod(
  overrides?: MutationOverrides<
    Accepted<PaymentMethod>,
    { request: CreatePaymentMethodRequest } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { request, ...options }) =>
      client.createPaymentMethod(request, options),
    paymentMethodState,
    overrides
  )
}

export function useUpdatePaymentMethod(
  overrides?: MutationOverrides<
    Accepted<{ outcome: MutationOutcome; method?: PaymentMethod }>,
    {
      id: PaymentMethodID
      request: UpdatePaymentMethodRequest
    } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { id, request, ...options }) =>
      client.updatePaymentMethod(id, request, options),
    paymentMethodState,
    overrides
  )
}

export function useDeletePaymentMethod(
  overrides?: MutationOverrides<
    Accepted<{ outcome: MutationOutcome }>,
    { id: PaymentMethodID } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { id, ...options }) => client.deletePaymentMethod(id, options),
    paymentMethodState,
    overrides
  )
}

export function useSetCollectionPaymentMethod(
  overrides?: MutationOverrides<
    Accepted<undefined>,
    { request: SetCollectionPaymentMethodRequest } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { request, ...options }) =>
      client.setCollectionPaymentMethod(request, options),
    ({ keys }) => [keys.paymentMethods.root],
    overrides
  )
}

export function useMarkNotificationRead(
  overrides?: MutationOverrides<
    Accepted<undefined>,
    { id: string } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { id, ...options }) =>
      client.markNotificationRead(id, options),
    ({ keys }) => [keys.notifications.root],
    overrides
  )
}

export function useCreateCheckoutSession(
  overrides?: MutationOverrides<
    Accepted<CheckoutSession>,
    { request: CreateCheckoutSessionRequest } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { request, ...options }) =>
      client.createCheckoutSession(request, options),
    purchaseState,
    overrides
  )
}

export function useConfirmCheckoutSession(
  overrides?: MutationOverrides<
    Accepted<CheckoutSession>,
    {
      id: CheckoutSessionID
      request: ConfirmCheckoutSessionRequest
    } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { id, request, ...options }) =>
      client.confirmCheckoutSession(id, request, options),
    purchaseState,
    overrides
  )
}

// #809 customer payment recovery. One Idempotency-Key per call, never
// retried. The invoice/subscription keys are invalidated on 200 and on 202
// (the reads then show recovery.operation); follow a 202 with
// useInvoiceRecoverySettlement / useSubscriptionRecoverySettlement.
export function usePayInvoiceNow(
  overrides?: MutationOverrides<
    Accepted<InvoicePayNowResult>,
    { invoiceId: string; request: PayInvoiceNowRequest } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { invoiceId, request, ...options }) =>
      client.payInvoiceNow(invoiceId, request, options),
    ({ keys }) => [keys.invoices.root, keys.status],
    overrides
  )
}

export function useRetrySubscriptionNow(
  overrides?: MutationOverrides<
    Accepted<SubscriptionRetryNowResult>,
    {
      id: SubscriptionID
      request?: RetrySubscriptionNowRequest
    } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { id, request, ...options }) =>
      client.retrySubscriptionNow(id, request, options),
    ({ keys }) => [
      keys.subscriptions.root,
      keys.status,
      keys.entitlements(),
      keys.payments.root,
    ],
    overrides
  )
}
