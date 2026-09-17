import { describe, expect, it } from "vitest"

import { BillingError } from "../core/errors"
import billingStatus from "../test/fixtures/wire/billing_status.json"
import currencies from "../test/fixtures/wire/currencies.json"
import notification from "../test/fixtures/wire/notification.json"
import payment from "../test/fixtures/wire/payment.json"
import subscription from "../test/fixtures/wire/subscription.json"
import { errorEnvelope, fixtureServer, json } from "../test/server"
import { bearerAuth } from "../transport/auth"
import { createTransport } from "../transport/request"
import { createBillingClient } from "./index"

const subId = "sub_cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const pmId = "pm_dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const priceId = "price_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

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

const paymentMethod = {
  id: pmId,
  object: "payment_method",
  type: "card",
  rail: "nmi",
  psp_id: "55555555-5555-5555-5555-555555555555",
  card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
  created_at: "2026-09-16T00:00:00.123456789Z",
  health: { expiry_status: "valid", active: true },
  collection_default_currencies: ["USD"],
}

const invoice = {
  id: "88888888-8888-4888-8888-888888888888",
  currency: "USD",
  invoice_number: "INV-1",
  period_from: "2026-08-01T00:00:00Z",
  period_to: "2026-09-01T00:00:00Z",
  usage_total: "9223372036854775807",
  deposits_total: "0",
  owed_accrued: "0",
  owed_paid: "0",
  closing_balance: "0",
  subtotal_amount: "9223372036854775807",
  total_amount: "9223372036854775807",
  amount_paid: "0",
  amount_due: "9223372036854775807",
  line_items: [
    { event_type: "usage", amount: "9223372036854775807", count: 1 },
  ],
  status: "open",
  collection_method: "charge_automatically",
  collection_failure_count: 2,
  next_collection_attempt_at: "2026-09-18T00:00:00Z",
  last_collection_failure_code: "insufficient_funds",
  created_at: "2026-09-01T00:00:00Z",
}

const checkoutSession = {
  object: "checkout_session",
  id: "cs_ffffffff-ffff-4fff-8fff-ffffffffffff",
  status: "requires_action",
  mode: "subscription",
  price_id: priceId,
  amount: "9223372036854775807",
  currency: "USD",
  payment: { rail: "ccbill", redirect_url: "https://pay.ccbill.example/x" },
  created_at: "2026-09-16T00:00:00.123456789Z",
  next_action: {
    type: "redirect_to_url",
    redirect_to_url: { url: "https://pay.ccbill.example/x" },
  },
}

function setup() {
  const server = fixtureServer({ prefix: "/api/openrails" })
  const transport = createTransport({
    baseUrl: "https://site.example/api/openrails",
    auth: bearerAuth("tok"),
    fetch: server.fetch,
    sleep: async () => {},
    idempotencyKey: () => "idem_1",
  })
  return { server, client: createBillingClient(transport) }
}

describe("BillingClient reads", () => {
  it("loads the registry, status, subscriptions, payments, notifications and invoices", async () => {
    const { server, client } = setup()
    server.route("GET", "/v1/currencies", () => json(currencies))
    server.route("GET", "/v1/me/status", () => json(billingStatus))
    server.route("GET", "/v1/me/subscriptions", () =>
      json(page([subscription]))
    )
    server.route("GET", `/v1/me/subscriptions/${subId}`, () =>
      json(subscription)
    )
    server.route("GET", "/v1/me/payments", () => json(page([payment])))
    server.route("GET", "/v1/me/payment-methods", () =>
      json(page([paymentMethod]))
    )
    server.route("GET", "/v1/me/notifications", () =>
      json(page([notification]))
    )
    server.route("GET", "/v1/me/notifications/unread-count", () =>
      json({ unread_count: 3 })
    )
    server.route("GET", "/v1/me/invoices", () =>
      json({ invoices: [invoice], total: 1, limit: 50, offset: 0 })
    )
    server.route("GET", `/v1/me/invoices/${invoice.id}`, () => json(invoice))
    server.route("GET", "/v1/me/entitlements/active", () =>
      json({
        object: "list",
        has_more: false,
        data: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            customer_id: "22222222-2222-2222-2222-222222222222",
            lookup_key: "premium",
            start_at: "2026-09-16T00:00:00Z",
            source_type: "subscription",
            source_id: subId,
          },
        ],
      })
    )

    expect((await client.currencies()).get("USD")?.decimals).toBe(6)
    expect((await client.status()).subscription?.id).toBe(subId)
    const subs = await client.listSubscriptions({ status: "active", limit: 5 })
    expect(subs.data[0].price?.unit_amount).toBe("9223372036854775807")
    expect(server.requests.at(-1)?.url).toBe(
      "https://site.example/api/openrails/v1/me/subscriptions?status=active&limit=5"
    )
    expect((await client.getSubscription(subId)).card?.last4).toBe("4242")
    expect(
      (await client.listPayments({ type: "nmi" })).data[0].created_at
    ).toBe("2026-09-16T00:00:00.123456789Z")
    expect(
      (await client.listPaymentMethods()).data[0].collection_default_currencies
    ).toEqual(["USD"])
    expect(
      (await client.listNotifications({ seen: false })).data[0].data.old_amount
    ).toBe("9223372036854775807")
    expect(server.requests.at(-1)?.query.get("seen")).toBe("false")
    expect(await client.unreadNotificationCount()).toBe(3)
    expect((await client.listInvoices()).invoices[0].amount_due).toBe(
      "9223372036854775807"
    )
    expect((await client.getInvoice(invoice.id)).collection_failure_count).toBe(
      2
    )
    expect((await client.activeEntitlements())[0].lookup_key).toBe("premium")
  })

  it("refuses a body that drifts from the contract as invalid_response", async () => {
    const { server, client } = setup()
    server.route("GET", "/v1/me/status", () =>
      json({
        ...billingStatus,
        subscription: {
          ...subscription,
          price: { ...subscription.price, unit_amount: 1 },
        },
      })
    )
    const error = await client.status().catch((e) => e)
    expect(error).toBeInstanceOf(BillingError)
    expect(error.kind).toBe("invalid_response")
    expect(error.code).toBe("invalid_response")
  })

  it("surfaces another subject's resource as a typed refusal, never as data", async () => {
    const { server, client } = setup()
    server.route(
      "GET",
      "/v1/me/subscriptions/sub_99999999-9999-4999-8999-999999999999",
      () => errorEnvelope(404, "resource_not_found")
    )
    server.route("POST", `/v1/me/subscriptions/${subId}/cancel`, () =>
      errorEnvelope(403, "resource_access_denied")
    )
    const notFound = await client
      .getSubscription("sub_99999999-9999-4999-8999-999999999999")
      .catch((e) => e)
    expect(notFound.isNotFound).toBe(true)
    const denied = await client
      .cancelSubscription(subId, { feedback: "wrong account" })
      .catch((e) => e)
    expect(denied.isDenied).toBe(true)
    expect(denied.code).toBe("resource_access_denied")
  })
})

describe("BillingClient mutations", () => {
  it("cancel/resume return the accepted 202 with the key sent", async () => {
    const { server, client } = setup()
    server.route("POST", `/v1/me/subscriptions/${subId}/cancel`, () =>
      json({ status: "queued" }, 202)
    )
    server.route("POST", `/v1/me/subscriptions/${subId}/resume`, () =>
      json({ status: "queued" }, 202)
    )
    const cancel = await client.cancelSubscription(subId, {
      feedback: "moving on",
    })
    expect(cancel).toMatchObject({
      status: 202,
      data: { status: "queued" },
      idempotencyKey: "idem_1",
    })
    expect(server.requests[0].body).toEqual({ feedback: "moving on" })
    const resume = await client.resumeSubscription(subId, {
      idempotencyKey: "idem_resume",
    })
    expect(resume.idempotencyKey).toBe("idem_resume")
    expect(server.requests[1].headers.get("Idempotency-Key")).toBe(
      "idem_resume"
    )
  })

  it("validates request bodies before they leave the browser", async () => {
    const { client } = setup()
    await expect(
      client.cancelSubscription(subId, { feedback: "no" })
    ).rejects.toThrow()
    await expect(
      client.updateSubscriptionPaymentMethod(
        subId,
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as never
      )
    ).rejects.toThrow()
    for (const raw of [
      "card_number",
      "number",
      "pan",
      "cvv",
      "cvc",
      "security_code",
    ])
      await expect(
        client.createPaymentMethod({
          payment_token: "tok",
          [raw]: "4111",
        } as never),
        raw
      ).rejects.toThrow()
  })

  it("payment-method delete and update distinguish completed from pending", async () => {
    const { server, client } = setup()
    server.route("DELETE", `/v1/me/payment-methods/${pmId}`, (_r, n) =>
      n === 1
        ? new Response(null, { status: 204 })
        : new Response(null, { status: 202 })
    )
    server.route("PUT", `/v1/me/payment-methods/${pmId}`, (_r, n) =>
      n === 1 ? json(paymentMethod) : new Response(null, { status: 202 })
    )
    expect((await client.deletePaymentMethod(pmId)).data.outcome).toBe(
      "completed"
    )
    expect((await client.deletePaymentMethod(pmId)).data.outcome).toBe(
      "pending"
    )
    const update = {
      payment_token: "tok",
      last_four: "4242",
      card_type: "visa",
      expiry_date: "12/30",
    }
    const first = await client.updatePaymentMethod(pmId, update)
    expect(first.data).toMatchObject({
      outcome: "completed",
      method: { id: pmId },
    })
    const second = await client.updatePaymentMethod(pmId, update)
    expect(second.data).toEqual({ outcome: "pending", method: undefined })
    expect(second.status).toBe(202)
  })

  it("creates and reads a direct checkout session with the redirect offered, not followed", async () => {
    const { server, client } = setup()
    server.route("POST", "/v1/me/checkout", () => json(checkoutSession))
    server.route("GET", `/v1/me/checkout/${checkoutSession.id}`, () =>
      json({ ...checkoutSession, status: "succeeded" })
    )
    const created = await client.createCheckoutSession({
      price_id: priceId,
      payment: {
        rail: "ccbill",
        name_on_card: "A Buyer",
        zip: "10001",
        country: "US",
      },
    })
    expect(created.data.next_action?.redirect_to_url?.url).toBe(
      "https://pay.ccbill.example/x"
    )
    expect(server.requests[0].headers.get("Idempotency-Key")).toBe("idem_1")
    expect(server.requests[0].body).toMatchObject({
      price_id: priceId,
      payment: { rail: "ccbill" },
    })
    expect((await client.getCheckoutSession(created.data.id)).status).toBe(
      "succeeded"
    )
  })

  it("surfaces a provider refusal on checkout as a typed 402", async () => {
    const { server, client } = setup()
    server.route("POST", "/v1/me/checkout", () =>
      errorEnvelope(402, "card_declined", {
        metadata: { decline_reason: "insufficient_funds" },
      })
    )
    const error = await client
      .createCheckoutSession({
        price_id: priceId,
        payment: { payment_method_id: pmId },
      })
      .catch((e) => e)
    expect(error.isPaymentRefused).toBe(true)
    expect(error.code).toBe("card_declined")
    expect(error.metadata?.decline_reason).toBe("insufficient_funds")
  })

  it("types the pending #809 actions against the provisional contract", async () => {
    const { server, client } = setup()
    server.route("POST", `/v1/me/invoices/${invoice.id}/pay-now`, () =>
      json({ status: "queued" }, 202)
    )
    server.route("POST", `/v1/me/subscriptions/${subId}/retry-now`, () =>
      json({ status: "succeeded", subscription })
    )
    const pay = await client.payInvoiceNow(invoice.id, {
      payment_method_id: pmId,
    })
    expect(pay.status).toBe(202)
    expect(pay.data.status).toBe("queued")
    expect(server.requests[0].body).toEqual({ payment_method_id: pmId })
    const retry = await client.retrySubscriptionNow(subId)
    expect(retry.data.status).toBe("succeeded")
  })
})
