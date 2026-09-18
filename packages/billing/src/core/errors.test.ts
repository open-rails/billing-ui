import { describe, expect, it } from "vitest"

import errorEnvelope from "../test/fixtures/wire/error_envelope.json"
import { BillingError, ErrorCode, ErrorType, isBillingError } from "./errors"

describe("BillingError", () => {
  it("classifies by status and machine code from the envelope", () => {
    const error = BillingError.fromResponse(
      "POST",
      "https://billing.example/v1/me/checkout",
      409,
      errorEnvelope,
      undefined,
      "req_header"
    )
    expect(isBillingError(error)).toBe(true)
    expect(error.status).toBe(409)
    expect(error.type).toBe(ErrorType.invalidRequest)
    expect(error.code).toBe(ErrorCode.idempotencyKeyReused)
    expect(error.param).toBe("amount")
    // The body request id wins over the header.
    expect(error.requestId).toBe("req_fixture")
    expect(error.metadata?.committed_amount).toBe("9223372036854775807")
    expect(error.isConflict).toBe(true)
    expect(error.isIdempotencyReuse).toBe(true)
    expect(error.isOutcomeUnknown).toBe(false)
    expect(error.message).toBe("retry changed the committed amount")
  })

  it("falls back to status-derived type and code for a non-envelope body", () => {
    const error = BillingError.fromResponse(
      "GET",
      "https://b/v1/me/status",
      401,
      "nope",
      undefined,
      "req_h"
    )
    expect(error.code).toBe(ErrorCode.authenticationRequired)
    expect(error.type).toBe(ErrorType.authentication)
    expect(error.requestId).toBe("req_h")
    expect(error.isUnauthorized).toBe(true)
    expect(
      BillingError.fromResponse("GET", "u", 402, {}).isPaymentRefused
    ).toBe(true)
    expect(
      BillingError.fromResponse("GET", "u", 429, {}, 1500).retryAfterMs
    ).toBe(1500)
    expect(BillingError.fromResponse("GET", "u", 503, {}).code).toBe(
      ErrorCode.serviceUnavailable
    )
    expect(BillingError.fromResponse("GET", "u", 500, {}).isServerError).toBe(
      true
    )
  })

  it("marks a lost response as outcome-unknown, never as a refusal", () => {
    const lost = new BillingError({
      kind: "network",
      status: 0,
      code: ErrorCode.networkError,
      method: "POST",
      url: "https://b/v1/me/invoices/x/pay-now",
    })
    expect(lost.isOutcomeUnknown).toBe(true)
    expect(lost.isServerError).toBe(false)
    expect(lost.isUnauthorized).toBe(false)
  })
})
