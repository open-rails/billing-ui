// @openrails/billing/client — the direct /v1/me operations, typed against
// the core schemas. Every call goes through one Transport; every response is
// validated before a host sees it. OpenRails decides eligibility and money;
// this layer only serializes, validates and names outcomes.
import type { z } from "zod"

import { BillingError, ErrorCode } from "../core/errors"
import type {
  CheckoutSessionID,
  PaymentMethodID,
  PriceID,
  SubscriptionID,
} from "../core/ids"
import { parseCurrencyRegistry, type CurrencyRegistry } from "../core/money"
import {
  activeEntitlementListSchema,
  billingStatusSchema,
  cancelSubscriptionRequestSchema,
  changeTierRequestSchema,
  checkoutSessionSchema,
  confirmCheckoutSessionRequestSchema,
  createCheckoutSessionRequestSchema,
  createPaymentMethodRequestSchema,
  invoiceListResponseSchema,
  invoicePaymentAttemptPageSchema,
  invoicePayNowResultSchema,
  invoiceSchema,
  messageResultSchema,
  notificationPageSchema,
  payInvoiceNowRequestSchema,
  paymentMethodPageSchema,
  paymentMethodSchema,
  paymentPageSchema,
  queuedResultSchema,
  retrySubscriptionNowRequestSchema,
  setCollectionPaymentMethodRequestSchema,
  subscriptionPageSchema,
  subscriptionRetryNowResultSchema,
  subscriptionSchema,
  tierChangePreviewSchema,
  tierChangeResponseSchema,
  unreadCountSchema,
  updatePaymentMethodRequestSchema,
  updateSubscriptionPaymentMethodRequestSchema,
  type ActiveEntitlement,
  type BillingStatus,
  type CancelSubscriptionRequest,
  type CheckoutSession,
  type ConfirmCheckoutSessionRequest,
  type CreateCheckoutSessionRequest,
  type CreatePaymentMethodRequest,
  type Invoice,
  type InvoiceListResponse,
  type InvoicePaymentAttempt,
  type InvoicePayNowResult,
  type MutationOutcome,
  type Notification,
  type Page,
  type PayInvoiceNowRequest,
  type Payment,
  type PaymentMethod,
  type QueuedResult,
  type RetrySubscriptionNowRequest,
  type SetCollectionPaymentMethodRequest,
  type Subscription,
  type SubscriptionRetryNowResult,
  type TierChangePreview,
  type TierChangeResponse,
  type UpdatePaymentMethodRequest,
} from "../core/schemas"
import type { RawResponse, Transport } from "../transport/request"

export interface PageParams {
  limit?: number
  offset?: number
}

export interface CallOptions {
  signal?: AbortSignal
}

export interface MutationOptions extends CallOptions {
  // The canonical key for this operation. Generated when absent; pass the
  // same key to replay a financial operation whose outcome was lost.
  idempotencyKey?: string
}

// A mutation result with the key it was sent under, so a host can retry the
// identical operation deliberately.
export interface Accepted<T> {
  status: number
  data: T
  idempotencyKey?: string
  requestId?: string
}

function decode<T>(schema: z.ZodType<T>, response: RawResponse): T {
  const parsed = schema.safeParse(response.body)
  if (parsed.success) return parsed.data
  throw new BillingError({
    kind: "invalid_response",
    status: response.status,
    code: ErrorCode.invalidResponse,
    message: `The billing service answered with an unexpected ${response.status} body`,
    requestId: response.requestId,
    method: response.method,
    url: response.url,
    idempotencyKey: response.idempotencyKey,
    cause: parsed.error,
  })
}

function accepted<T>(response: RawResponse, data: T): Accepted<T> {
  return {
    status: response.status,
    data,
    idempotencyKey: response.idempotencyKey,
    requestId: response.requestId,
  }
}

function outcome(response: RawResponse): MutationOutcome {
  return response.status === 202 ? "pending" : "completed"
}

const encode = encodeURIComponent

export interface BillingClient {
  readonly transport: Transport

  // Public registry: the scale of every currency on the wire.
  currencies(options?: CallOptions): Promise<CurrencyRegistry>

  // Status and entitlements.
  status(options?: CallOptions): Promise<BillingStatus>
  activeEntitlements(
    params?: { at?: string },
    options?: CallOptions
  ): Promise<ActiveEntitlement[]>

  // Subscriptions.
  listSubscriptions(
    params?: PageParams & { status?: string },
    options?: CallOptions
  ): Promise<Page<Subscription>>
  getSubscription(
    id: SubscriptionID,
    options?: CallOptions
  ): Promise<Subscription>
  cancelSubscription(
    id: SubscriptionID,
    request: CancelSubscriptionRequest,
    options?: MutationOptions
  ): Promise<Accepted<QueuedResult>>
  resumeSubscription(
    id: SubscriptionID,
    options?: MutationOptions
  ): Promise<Accepted<QueuedResult>>
  updateSubscriptionPaymentMethod(
    id: SubscriptionID,
    paymentMethodId: PaymentMethodID,
    options?: MutationOptions
  ): Promise<Accepted<Subscription>>
  previewTierChange(
    id: SubscriptionID,
    priceId: PriceID,
    options?: MutationOptions
  ): Promise<TierChangePreview>
  changeTier(
    id: SubscriptionID,
    priceId: PriceID,
    options?: MutationOptions
  ): Promise<Accepted<TierChangeResponse>>

  // Payment methods.
  listPaymentMethods(
    params?: PageParams,
    options?: CallOptions
  ): Promise<Page<PaymentMethod>>
  createPaymentMethod(
    request: CreatePaymentMethodRequest,
    options?: MutationOptions
  ): Promise<Accepted<PaymentMethod>>
  updatePaymentMethod(
    id: PaymentMethodID,
    request: UpdatePaymentMethodRequest,
    options?: MutationOptions
  ): Promise<Accepted<{ outcome: MutationOutcome; method?: PaymentMethod }>>
  deletePaymentMethod(
    id: PaymentMethodID,
    options?: MutationOptions
  ): Promise<Accepted<{ outcome: MutationOutcome }>>
  setCollectionPaymentMethod(
    request: SetCollectionPaymentMethodRequest,
    options?: MutationOptions
  ): Promise<Accepted<undefined>>

  // Payments and invoices.
  listPayments(
    params?: PageParams & { type?: string },
    options?: CallOptions
  ): Promise<Page<Payment>>
  listInvoices(
    params?: PageParams,
    options?: CallOptions
  ): Promise<InvoiceListResponse>
  getInvoice(id: string, options?: CallOptions): Promise<Invoice>

  // Notifications.
  listNotifications(
    params?: PageParams & { seen?: boolean },
    options?: CallOptions
  ): Promise<Page<Notification>>
  unreadNotificationCount(options?: CallOptions): Promise<number>
  markNotificationRead(
    id: string,
    options?: MutationOptions
  ): Promise<Accepted<undefined>>

  // Checkout sessions (direct /v1/me/checkout).
  createCheckoutSession(
    request: CreateCheckoutSessionRequest,
    options?: MutationOptions
  ): Promise<Accepted<CheckoutSession>>
  getCheckoutSession(
    id: CheckoutSessionID,
    options?: CallOptions
  ): Promise<CheckoutSession>
  confirmCheckoutSession(
    id: CheckoutSessionID,
    request: ConfirmCheckoutSessionRequest,
    options?: MutationOptions
  ): Promise<Accepted<CheckoutSession>>

  // #809 customer payment recovery. Each call sends one Idempotency-Key and
  // is never retried: 200 is terminal, 202 carries the unresolved operation
  // (watch it with the invoice/subscription reads, never resend), a provider
  // refusal is a 402 BillingError (recoveryDeclineOf) and a refusal to
  // attempt is a coded 409.
  payInvoiceNow(
    invoiceId: string,
    request: PayInvoiceNowRequest,
    options?: MutationOptions
  ): Promise<Accepted<InvoicePayNowResult>>
  retrySubscriptionNow(
    id: SubscriptionID,
    request?: RetrySubscriptionNowRequest,
    options?: MutationOptions
  ): Promise<Accepted<SubscriptionRetryNowResult>>
  // The invoice's immutable attempt history, newest first.
  listInvoicePayments(
    invoiceId: string,
    params?: PageParams,
    options?: CallOptions
  ): Promise<Page<InvoicePaymentAttempt>>
}

export function createBillingClient(transport: Transport): BillingClient {
  const get = (
    path: string,
    query?: Record<string, unknown>,
    options?: CallOptions
  ) =>
    transport.request({
      method: "GET",
      path,
      query: query as Record<string, string | number | boolean | undefined>,
      signal: options?.signal,
    })
  const send = (
    method: "POST" | "PUT" | "DELETE",
    path: string,
    body: unknown,
    options?: MutationOptions
  ) =>
    transport.request({
      method,
      path,
      body,
      signal: options?.signal,
      idempotencyKey: options?.idempotencyKey,
    })

  return {
    transport,

    async currencies(options) {
      const response = await transport.request({
        method: "GET",
        path: "/v1/currencies",
        signal: options?.signal,
        auth: "none",
      })
      try {
        return parseCurrencyRegistry(response.body)
      } catch (cause) {
        throw new BillingError({
          kind: "invalid_response",
          status: response.status,
          code: ErrorCode.invalidResponse,
          message: "The currency registry has an unexpected shape",
          method: "GET",
          url: response.url,
          cause,
        })
      }
    },

    async status(options) {
      return decode(
        billingStatusSchema,
        await get("/v1/me/status", undefined, options)
      )
    },

    async activeEntitlements(params, options) {
      const response = await get(
        "/v1/me/entitlements/active",
        { at: params?.at },
        options
      )
      return decode(activeEntitlementListSchema, response).data
    },

    async listSubscriptions(params, options) {
      const response = await get(
        "/v1/me/subscriptions",
        {
          status: params?.status,
          limit: params?.limit,
          offset: params?.offset,
        },
        options
      )
      return decode(subscriptionPageSchema, response)
    },

    async getSubscription(id, options) {
      return decode(
        subscriptionSchema,
        await get(`/v1/me/subscriptions/${encode(id)}`, undefined, options)
      )
    },

    async cancelSubscription(id, request, options) {
      const body = cancelSubscriptionRequestSchema.parse(request)
      const response = await send(
        "POST",
        `/v1/me/subscriptions/${encode(id)}/cancel`,
        body,
        options
      )
      return accepted(response, decode(queuedResultSchema, response))
    },

    async resumeSubscription(id, options) {
      const response = await send(
        "POST",
        `/v1/me/subscriptions/${encode(id)}/resume`,
        undefined,
        options
      )
      return accepted(response, decode(queuedResultSchema, response))
    },

    async updateSubscriptionPaymentMethod(id, paymentMethodId, options) {
      const body = updateSubscriptionPaymentMethodRequestSchema.parse({
        payment_method_id: paymentMethodId,
      })
      const response = await send(
        "PUT",
        `/v1/me/subscriptions/${encode(id)}/payment-method`,
        body,
        options
      )
      return accepted(response, decode(subscriptionSchema, response))
    },

    async previewTierChange(id, priceId, options) {
      const body = changeTierRequestSchema.parse({ price_id: priceId })
      const response = await send(
        "POST",
        `/v1/me/subscriptions/${encode(id)}/change-tier/preview`,
        body,
        options
      )
      return decode(tierChangePreviewSchema, response)
    },

    async changeTier(id, priceId, options) {
      const body = changeTierRequestSchema.parse({ price_id: priceId })
      const response = await send(
        "POST",
        `/v1/me/subscriptions/${encode(id)}/change-tier`,
        body,
        options
      )
      return accepted(response, decode(tierChangeResponseSchema, response))
    },

    async listPaymentMethods(params, options) {
      const response = await get(
        "/v1/me/payment-methods",
        { limit: params?.limit, offset: params?.offset },
        options
      )
      return decode(paymentMethodPageSchema, response)
    },

    async createPaymentMethod(request, options) {
      const body = createPaymentMethodRequestSchema.parse(request)
      const response = await send(
        "POST",
        "/v1/me/payment-methods",
        body,
        options
      )
      return accepted(response, decode(paymentMethodSchema, response))
    },

    async updatePaymentMethod(id, request, options) {
      const body = updatePaymentMethodRequestSchema.parse(request)
      const response = await send(
        "PUT",
        `/v1/me/payment-methods/${encode(id)}`,
        body,
        options
      )
      const result = outcome(response)
      return accepted(response, {
        outcome: result,
        method:
          result === "completed"
            ? decode(paymentMethodSchema, response)
            : undefined,
      })
    },

    async deletePaymentMethod(id, options) {
      const response = await send(
        "DELETE",
        `/v1/me/payment-methods/${encode(id)}`,
        undefined,
        options
      )
      return accepted(response, { outcome: outcome(response) })
    },

    async setCollectionPaymentMethod(request, options) {
      const body = setCollectionPaymentMethodRequestSchema.parse(request)
      const response = await send(
        "PUT",
        "/v1/me/collection-payment-method",
        body,
        options
      )
      return accepted(response, undefined)
    },

    async listPayments(params, options) {
      const response = await get(
        "/v1/me/payments",
        { type: params?.type, limit: params?.limit, offset: params?.offset },
        options
      )
      return decode(paymentPageSchema, response)
    },

    async listInvoices(params, options) {
      const response = await get(
        "/v1/me/invoices",
        { limit: params?.limit, offset: params?.offset },
        options
      )
      return decode(invoiceListResponseSchema, response)
    },

    async getInvoice(id, options) {
      return decode(
        invoiceSchema,
        await get(`/v1/me/invoices/${encode(id)}`, undefined, options)
      )
    },

    async listNotifications(params, options) {
      const response = await get(
        "/v1/me/notifications",
        { limit: params?.limit, offset: params?.offset, seen: params?.seen },
        options
      )
      return decode(notificationPageSchema, response)
    },

    async unreadNotificationCount(options) {
      const response = await get(
        "/v1/me/notifications/unread-count",
        undefined,
        options
      )
      return decode(unreadCountSchema, response).unread_count
    },

    async markNotificationRead(id, options) {
      const response = await send(
        "POST",
        `/v1/me/notifications/${encode(id)}/read`,
        undefined,
        options
      )
      decode(messageResultSchema, response)
      return accepted(response, undefined)
    },

    async createCheckoutSession(request, options) {
      const body = createCheckoutSessionRequestSchema.parse(request)
      const response = await send("POST", "/v1/me/checkout", body, options)
      return accepted(response, decode(checkoutSessionSchema, response))
    },

    async getCheckoutSession(id, options) {
      return decode(
        checkoutSessionSchema,
        await get(`/v1/me/checkout/${encode(id)}`, undefined, options)
      )
    },

    async confirmCheckoutSession(id, request, options) {
      const body = confirmCheckoutSessionRequestSchema.parse(request)
      const response = await send(
        "POST",
        `/v1/me/checkout/${encode(id)}/confirm`,
        body,
        options
      )
      return accepted(response, decode(checkoutSessionSchema, response))
    },

    async payInvoiceNow(invoiceId, request, options) {
      const body = payInvoiceNowRequestSchema.parse(request)
      const response = await send(
        "POST",
        `/v1/me/invoices/${encode(invoiceId)}/pay-now`,
        body,
        options
      )
      return accepted(response, decode(invoicePayNowResultSchema, response))
    },

    async retrySubscriptionNow(id, request, options) {
      const body = retrySubscriptionNowRequestSchema.parse(request ?? {})
      const response = await send(
        "POST",
        `/v1/me/subscriptions/${encode(id)}/retry-now`,
        body,
        options
      )
      return accepted(
        response,
        decode(subscriptionRetryNowResultSchema, response)
      )
    },

    async listInvoicePayments(invoiceId, params, options) {
      const response = await get(
        `/v1/me/invoices/${encode(invoiceId)}/payments`,
        { limit: params?.limit, offset: params?.offset },
        options
      )
      return decode(invoicePaymentAttemptPageSchema, response)
    },
  }
}
