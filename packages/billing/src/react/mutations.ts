// Mutation hooks. Dependent query keys are invalidated only after the
// server accepted the operation (a 2xx, including 202 "queued"); a refused
// or lost request invalidates nothing, so the cache never pretends a change
// happened. The host's own onSuccess/onError run after ours.
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query"

import type { Accepted, MutationOptions } from "../client"
import type { BillingError } from "../core/errors"
import type {
  PaymentMethodID,
  PriceID,
  SubscriptionID,
  CheckoutSessionID,
} from "../core/ids"
import type {
  CancelSubscriptionRequest,
  CheckoutSession,
  ConfirmCheckoutSessionRequest,
  CreateCheckoutSessionRequest,
  CreatePaymentMethodRequest,
  MutationOutcome,
  PayInvoiceNowRequest,
  PayInvoiceNowResult,
  PaymentMethod,
  QueuedResult,
  RetrySubscriptionNowResult,
  SetCollectionPaymentMethodRequest,
  Subscription,
  TierChangeResponse,
  UpdatePaymentMethodRequest,
} from "../core/schemas"
import { useBilling, type BillingContextValue } from "./context"

export type MutationOverrides<TData, TVariables> = Omit<
  UseMutationOptions<TData, BillingError, TVariables>,
  "mutationFn"
>

type Invalidate = (billing: BillingContextValue) => QueryKey[]

function useBillingMutation<TData, TVariables>(
  mutationFn: (
    billing: BillingContextValue,
    variables: TVariables
  ) => Promise<TData>,
  invalidates: Invalidate,
  overrides?: MutationOverrides<TData, TVariables>
): UseMutationResult<TData, BillingError, TVariables> {
  const billing = useBilling()
  const queryClient = useQueryClient()
  return useMutation<TData, BillingError, TVariables>({
    ...overrides,
    mutationFn: (variables) => mutationFn(billing, variables),
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

// #809 — PENDING the core contract; see client/index.ts.
export function usePayInvoiceNow(
  overrides?: MutationOverrides<
    Accepted<PayInvoiceNowResult>,
    { invoiceId: string; request: PayInvoiceNowRequest } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { invoiceId, request, ...options }) =>
      client.payInvoiceNow(invoiceId, request, options),
    ({ keys }) => [keys.invoices.root, keys.payments.root, keys.status],
    overrides
  )
}

export function useRetrySubscriptionNow(
  overrides?: MutationOverrides<
    Accepted<RetrySubscriptionNowResult>,
    { id: SubscriptionID } & MutationOptions
  >
) {
  return useBillingMutation(
    ({ client }, { id, ...options }) =>
      client.retrySubscriptionNow(id, options),
    ({ keys }) => [keys.subscriptions.root, keys.status, keys.payments.root],
    overrides
  )
}
