import { describe, expect, it } from "vitest"

import {
  billingStatusSchema,
  errorEnvelopeSchema,
  invoicePayNowResultSchema,
  isOperationUnresolved,
  paymentRecoverySchema,
  subscriptionRetryNowResultSchema,
  notificationSchema,
  pageSchema,
  parseCurrencyRegistry,
  paymentSchema,
  subscriptionSchema,
  subscriptionIdSchema,
} from "./index"
import billingStatus from "../test/fixtures/wire/billing_status.json"
import currencies from "../test/fixtures/wire/currencies.json"
import errorEnvelope from "../test/fixtures/wire/error_envelope.json"
import invoicePayNow from "../test/fixtures/wire/invoice_pay_now.json"
import notification from "../test/fixtures/wire/notification.json"
import pageEmpty from "../test/fixtures/wire/page_empty.json"
import payment from "../test/fixtures/wire/payment.json"
import subscription from "../test/fixtures/wire/subscription.json"
import subscriptionRetryNow from "../test/fixtures/wire/subscription_retry_now.json"

const maxInt64 = "9223372036854775807"
const minInt64 = "-9223372036854775808"

// The canonical OpenRails fixtures (src/test/fixtures/wire/SOURCES.md) decode
// with int64 boundary money, typed ids and RFC3339 nanosecond instants intact.
describe("wire fixtures", () => {
  it("decodes subscription.json (self shape)", () => {
    const parsed = subscriptionSchema.parse(subscription)
    expect(parsed.id).toBe("sub_cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    expect(parsed.price?.unit_amount).toBe(maxInt64)
    expect(parsed.scheduled_price?.key).toBe("pro-annual")
    expect(parsed.card?.last4).toBe("4242")
    expect(parsed.cancel_portal_url).toBe("https://support.ccbill.com/")
    expect(parsed.access?.kind).toBe("subscription")
    expect(parsed.payments?.[0].amount).toBe(maxInt64)
    expect(parsed.next_retry_at).toBeNull()
    expect(parsed.created_at).toBe("2026-09-16T00:00:00.123456789Z")
  })

  it("decodes billing_status.json", () => {
    const parsed = billingStatusSchema.parse(billingStatus)
    expect(parsed.has_active_subscription).toBe(true)
    expect(parsed.subscription?.id).toBe(parsed.access?.subscription_id)
    expect(parsed.entitlements?.[0].source_id).toBe(
      "sub_cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    )
    expect(parsed.next_renewal_at).toBe("2026-09-16T00:00:00.123456789Z")
  })

  it("decodes notification.json with exact money in data", () => {
    const parsed = notificationSchema.parse(notification)
    expect(parsed.event_type).toBe("subscription_reprice_scheduled")
    expect(parsed.data.old_amount).toBe(maxInt64)
    expect(parsed.data.new_amount).toBe(minInt64)
    expect(parsed.data.to_price_id).toBe(
      "price_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc"
    )
  })

  it("decodes payment.json with an RFC3339 created_at", () => {
    const parsed = paymentSchema.parse(payment)
    expect(parsed.amount).toBe(maxInt64)
    expect(parsed.amount_refunded).toBe("0")
    expect(parsed.created_at).toBe("2026-09-16T00:00:00.123456789Z")
    expect(parsed.price?.unit_amount).toBe(maxInt64)
  })

  it("decodes currencies.json into the registry", () => {
    const registry = parseCurrencyRegistry(currencies)
    expect(registry.get("JPY")).toEqual({
      code: "JPY",
      decimals: 4,
      minor_decimals: 0,
    })
    expect(registry.get("USD")?.decimals).toBe(6)
    expect(registry.size).toBe(3)
  })

  it("decodes error_envelope.json with metadata precision intact", () => {
    const parsed = errorEnvelopeSchema.parse(errorEnvelope)
    expect(parsed.error.code).toBe("idempotency_key_reused")
    expect(parsed.error.param).toBe("amount")
    expect(parsed.error.request_id).toBe("req_fixture")
    expect(parsed.error.metadata?.committed_amount).toBe(maxInt64)
  })

  it("decodes the recovery block on subscription.json and billing_status.json", () => {
    for (const parsed of [
      subscriptionSchema.parse(subscription),
      billingStatusSchema.parse(billingStatus).subscription!,
    ]) {
      expect(parsed.recovery).toEqual({
        retryable: false,
        blocked_reason: "not_due",
        attempt_count: 0,
        compatible_payment_method_ids: [
          "pm_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        ],
      })
    }
  })

  it("decodes invoice_pay_now.json (unresolved 202 shape)", () => {
    const parsed = invoicePayNowResultSchema.parse(invoicePayNow)
    expect(parsed.invoice.amount_due).toBe(maxInt64)
    expect(parsed.invoice.status).toBe("past_due")
    expect(parsed.invoice.recovery).toMatchObject({
      retryable: false,
      blocked_reason: "outcome_unknown",
      attempt_count: 2,
      failure_category: "insufficient_funds",
      last_failure_code: "201",
      operation: { status: "unknown_needs_verify" },
    })
    expect(parsed.attempt).toMatchObject({
      amount: maxInt64,
      status: "attempted",
      payment_method_id: "pm_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    })
    expect(parsed.operation).toEqual({
      id: "01999999-9999-7999-8999-999999999999",
      status: "unknown_needs_verify",
    })
    expect(isOperationUnresolved(parsed.operation)).toBe(true)
    expect(parsed.replayed).toBe(false)
  })

  it("decodes subscription_retry_now.json (terminal 200 shape)", () => {
    const parsed = subscriptionRetryNowResultSchema.parse(subscriptionRetryNow)
    expect(parsed.subscription.recovery?.blocked_reason).toBe("not_due")
    expect(parsed.payment?.amount).toBe(maxInt64)
    expect(parsed.operation.status).toBe("succeeded")
    expect(isOperationUnresolved(parsed.operation)).toBe(false)
  })

  it("decodes page_empty.json", () => {
    const parsed = pageSchema(subscriptionSchema).parse(pageEmpty)
    expect(parsed.data).toEqual([])
    expect(parsed.has_more).toBe(false)
  })
})

describe("boundary refusals", () => {
  it("refuses numeric money, a bare UUID id and an epoch timestamp", () => {
    for (const override of [
      { price: { ...subscription.price, unit_amount: 99_000_000 } },
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      { price_id: "prod_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { created_at: 1789430400 },
      { payments: [{ ...subscription.payments[0], amount: "1.5" }] },
    ]) {
      expect(
        subscriptionSchema.safeParse({ ...subscription, ...override }).success,
        JSON.stringify(override)
      ).toBe(false)
    }
    expect(subscriptionIdSchema.safeParse("sub_not-a-uuid").success).toBe(false)
  })

  it("tolerates additive fields and refuses missing required ones", () => {
    expect(
      subscriptionSchema.safeParse({ ...subscription, future_field: 1 }).success
    ).toBe(true)
    const withoutStatus: Record<string, unknown> = { ...subscription }
    delete withoutStatus.status
    expect(subscriptionSchema.safeParse(withoutStatus).success).toBe(false)
  })
})

describe("recovery", () => {
  const base = {
    retryable: true,
    attempt_count: 1,
    compatible_payment_method_ids: null,
  }

  it("reads a null method list as empty and keeps optional facts", () => {
    expect(
      paymentRecoverySchema.parse(base).compatible_payment_method_ids
    ).toEqual([])
    expect(
      paymentRecoverySchema.parse({
        ...base,
        next_attempt_at: "2026-09-19T00:00:00Z",
        operation: {
          id: "01999999-9999-7999-8999-999999999999",
          status: "pending",
        },
      }).operation?.status
    ).toBe("pending")
  })

  it("refuses unknown operation statuses and blocked reasons rather than guessing", () => {
    for (const override of [
      { blocked_reason: "maybe_later" },
      {
        operation: {
          id: "01999999-9999-7999-8999-999999999999",
          status: "done",
        },
      },
      { retryable: "true" },
      {
        compatible_payment_method_ids: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
      },
    ])
      expect(
        paymentRecoverySchema.safeParse({ ...base, ...override }).success,
        JSON.stringify(override)
      ).toBe(false)
  })

  it("names the unresolved operation statuses as openrails PaymentOperation.Unresolved does", () => {
    const id = "01999999-9999-7999-8999-999999999999"
    for (const status of [
      "pending",
      "in_flight",
      "unknown_needs_verify",
      "failed_retryable",
    ] as const)
      expect(isOperationUnresolved({ id, status }), status).toBe(true)
    for (const status of [
      "succeeded",
      "failed_terminal",
      "superseded",
      "expired",
    ] as const)
      expect(isOperationUnresolved({ id, status }), status).toBe(false)
    expect(isOperationUnresolved(null)).toBe(false)
  })
})
