// The OpenRails error contract (docs/api/errors.md). Every unsuccessful
// response carries {"error": {type, code, message, request_id?, param?,
// metadata?}}; classification uses the HTTP status and the machine code,
// never the human message.
import { z } from "zod"

export const errorDetailsSchema = z.object({
  type: z.string(),
  code: z.string(),
  message: z.string().optional().default(""),
  request_id: z.string().optional(),
  param: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type ErrorDetails = z.infer<typeof errorDetailsSchema>

export const errorEnvelopeSchema = z.object({ error: errorDetailsSchema })
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>

export const ErrorType = {
  invalidRequest: "invalid_request_error",
  authentication: "authentication_error",
  authorization: "authorization_error",
  api: "api_error",
  card: "card_error",
  rateLimit: "rate_limit_error",
} as const

// Machine codes the browser package reacts to. The server owns the list;
// these are the ones with client-side meaning.
export const ErrorCode = {
  // request
  invalidParam: "invalid_param",
  invalidRequestBody: "invalid_request_body",
  requestBodyTooLarge: "request_body_too_large",
  resourceNotFound: "resource_not_found",
  resourceConflict: "resource_conflict",
  idempotencyKeyReused: "idempotency_key_reused",
  rateLimitExceeded: "rate_limit_exceeded",
  // authentication / authorization
  unauthorized: "unauthorized",
  authenticationRequired: "authentication_required",
  resourceAccessDenied: "resource_access_denied",
  // payment refusals (402 / 502)
  paymentFailed: "payment_failed",
  cardDeclined: "card_declined",
  paymentMethodStale: "payment_method_stale",
  paymentProviderRejected: "payment_provider_rejected",
  insufficientCredits: "insufficient_credits",
  // saved payment methods
  paymentMethodUpdateRetryRequired: "payment_method_update_retry_required",
  paymentMethodUpdateFailed: "payment_method_update_failed",
  paymentMethodDeleteFailed: "payment_method_delete_failed",
  paymentMethodDeleteUnsupported: "payment_method_delete_unsupported",
  providerOutcomeUnknown: "provider_outcome_unknown",
  // customer payment recovery (#809) and invoices
  paymentRecoveryRailUnsupported: "payment_recovery_rail_unsupported",
  subscriptionNotRetryable: "subscription_not_retryable",
  subscriptionRetryInProgress: "subscription_retry_in_progress",
  subscriptionRetryOutcomeUnknown: "subscription_retry_outcome_unknown",
  invoiceNotRetryable: "invoice_not_retryable",
  invoiceRetryInProgress: "invoice_retry_in_progress",
  invoiceRetryOutcomeUnknown: "invoice_retry_outcome_unknown",
  invoiceRetryIdempotencyConflict: "invoice_retry_idempotency_conflict",
  collectionPaymentMethodRequired: "collection_payment_method_required",
  collectionPaymentMethodInvalid: "collection_payment_method_invalid",
  // server
  internalError: "internal_error",
  serviceUnavailable: "service_unavailable",
  // package-side (no usable server response)
  networkError: "network_error",
  requestTimeout: "request_timeout",
  requestAborted: "request_aborted",
  responseBodyInterrupted: "response_body_interrupted",
  invalidResponse: "invalid_response",
  notSignedIn: "not_signed_in",
} as const
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

// Why a BillingError exists:
// - response: OpenRails answered with an error envelope (or a bare status);
// - network: no response arrived (connection loss or timeout);
// - body: the response started but its body could not be read to the end;
// - aborted: the caller cancelled a mutation after it was dispatched;
// - invalid_response: a complete body that does not match the contract;
// - unauthenticated: no credential, so nothing was sent.
// Only a response proves what the server decided; see isOutcomeUnknown.
export type BillingErrorKind =
  | "response"
  | "network"
  | "body"
  | "aborted"
  | "invalid_response"
  | "unauthenticated"

export interface BillingErrorInit {
  kind: BillingErrorKind
  status: number
  type?: string
  code: string
  message?: string
  requestId?: string
  param?: string
  metadata?: Record<string, unknown>
  retryAfterMs?: number
  method: string
  url: string
  // The Idempotency-Key the mutation was sent under.
  idempotencyKey?: string
  cause?: unknown
}

export class BillingError extends Error {
  readonly kind: BillingErrorKind
  readonly status: number
  readonly type: string
  readonly code: string
  readonly requestId?: string
  readonly param?: string
  readonly metadata?: Record<string, unknown>
  readonly retryAfterMs?: number
  readonly method: string
  readonly url: string
  // The mutation's Idempotency-Key. After an outcome-unknown failure the
  // caller must replay with exactly this key (the mutation hooks do so for
  // an identical retry); a new key could execute the operation twice.
  readonly idempotencyKey?: string

  constructor(init: BillingErrorInit) {
    super(init.message || init.code, { cause: init.cause })
    this.name = "BillingError"
    this.kind = init.kind
    this.status = init.status
    this.type = init.type ?? ""
    this.code = init.code
    this.requestId = init.requestId
    this.param = init.param
    this.metadata = init.metadata
    this.retryAfterMs = init.retryAfterMs
    this.method = init.method
    this.url = init.url
    this.idempotencyKey = init.idempotencyKey
  }

  static fromResponse(
    method: string,
    url: string,
    status: number,
    body: unknown,
    retryAfterMs?: number,
    headerRequestId?: string,
    idempotencyKey?: string
  ): BillingError {
    const parsed = errorEnvelopeSchema.safeParse(body)
    if (parsed.success) {
      const details = parsed.data.error
      return new BillingError({
        kind: "response",
        status,
        type: details.type,
        code: details.code,
        message: details.message,
        requestId: details.request_id || headerRequestId,
        param: details.param ?? undefined,
        metadata: details.metadata,
        retryAfterMs,
        method,
        url,
        idempotencyKey,
      })
    }
    return new BillingError({
      kind: "response",
      status,
      type: fallbackType(status),
      code: fallbackCode(status),
      message: `HTTP ${status}`,
      requestId: headerRequestId,
      retryAfterMs,
      method,
      url,
      idempotencyKey,
    })
  }

  get isUnauthorized(): boolean {
    return (
      (this.kind === "response" && this.status === 401) ||
      this.kind === "unauthenticated"
    )
  }
  get isDenied(): boolean {
    return this.kind === "response" && this.status === 403
  }
  get isNotFound(): boolean {
    return this.kind === "response" && this.status === 404
  }
  get isConflict(): boolean {
    return this.kind === "response" && this.status === 409
  }
  get isRateLimited(): boolean {
    return this.kind === "response" && this.status === 429
  }
  // The provider refused the charge; nothing was charged.
  get isPaymentRefused(): boolean {
    return this.kind === "response" && this.status === 402
  }
  get isServerError(): boolean {
    return this.kind === "response" && this.status >= 500
  }
  // Retrying the identical operation with the same key changed its terms.
  get isIdempotencyReuse(): boolean {
    return this.code === ErrorCode.idempotencyKeyReused
  }
  get isMutation(): boolean {
    return this.method !== "" && this.method !== "GET"
  }
  // The operation may or may not have committed: a mutation whose response
  // was lost, cut off, cancelled after dispatch, unreadable or a 5xx, or a
  // server code that says so. Replay only with idempotencyKey.
  get isOutcomeUnknown(): boolean {
    if (
      this.code === ErrorCode.providerOutcomeUnknown ||
      this.code === ErrorCode.invoiceRetryOutcomeUnknown ||
      this.code === ErrorCode.subscriptionRetryOutcomeUnknown
    )
      return true
    switch (this.kind) {
      case "network":
      case "body":
        return true
      case "aborted":
      case "invalid_response":
        return this.isMutation
      case "response":
        return this.isMutation && this.status >= 500
      default:
        return false
    }
  }
}

export function isBillingError(value: unknown): value is BillingError {
  return value instanceof BillingError
}

function fallbackType(status: number): string {
  if (status === 401) return ErrorType.authentication
  if (status === 403) return ErrorType.authorization
  if (status === 402) return ErrorType.card
  if (status === 429) return ErrorType.rateLimit
  if (status >= 500) return ErrorType.api
  return ErrorType.invalidRequest
}

function fallbackCode(status: number): string {
  switch (status) {
    case 401:
      return ErrorCode.authenticationRequired
    case 403:
      return ErrorCode.resourceAccessDenied
    case 404:
      return ErrorCode.resourceNotFound
    case 409:
      return ErrorCode.resourceConflict
    case 429:
      return ErrorCode.rateLimitExceeded
    case 402:
      return ErrorCode.paymentFailed
    case 503:
      return ErrorCode.serviceUnavailable
    default:
      return status >= 500 ? ErrorCode.internalError : ErrorCode.invalidParam
  }
}
