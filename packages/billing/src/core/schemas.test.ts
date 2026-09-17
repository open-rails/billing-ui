import { describe, expect, it } from "vitest"

import {
  billingStatusSchema,
  errorEnvelopeSchema,
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
import notification from "../test/fixtures/wire/notification.json"
import pageEmpty from "../test/fixtures/wire/page_empty.json"
import payment from "../test/fixtures/wire/payment.json"
import subscription from "../test/fixtures/wire/subscription.json"

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
