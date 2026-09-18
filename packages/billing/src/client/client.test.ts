import { describe, expect, it } from "vitest"

import { BillingError } from "../core/errors"
import { RECOVERY_REFUSAL_CODES, recoveryDeclineOf } from "../core/recovery"
import billingStatus from "../test/fixtures/wire/billing_status.json"
import currencies from "../test/fixtures/wire/currencies.json"
import invoicePayNow from "../test/fixtures/wire/invoice_pay_now.json"
import notification from "../test/fixtures/wire/notification.json"
import payment from "../test/fixtures/wire/payment.json"
import subscription from "../test/fixtures/wire/subscription.json"
import subscriptionRetryNow from "../test/fixtures/wire/subscription_retry_now.json"
import {
  NetworkFailure,
  errorEnvelope,
  fixtureServer,
  json,
} from "../test/server"
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
})

describe("#809 customer payment recovery", () => {
  const invoiceId = invoicePayNow.invoice.id
  const payNowPath = `/v1/me/invoices/${invoiceId}/pay-now`
  const retryNowPath = `/v1/me/subscriptions/${subId}/retry-now`
  const operationId = invoicePayNow.operation.id
  const settled = {
    ...invoicePayNow,
    invoice: {
      ...invoicePayNow.invoice,
      status: "paid",
      amount_paid: invoicePayNow.invoice.amount_due,
      amount_due: "0",
      recovery: {
        retryable: false,
        blocked_reason: "not_due",
        attempt_count: 3,
        compatible_payment_method_ids: [pmId],
      },
    },
    attempt: {
      ...invoicePayNow.attempt,
      status: "settled",
      settled_at: "2026-09-16T00:00:01Z",
    },
    operation: { id: operationId, status: "succeeded" },
  }

  it("pay-now: 200 terminal result with the key sent once", async () => {
    const { server, client } = setup()
    server.route("POST", payNowPath, () => json(settled))
    const result = await client.payInvoiceNow(invoiceId, {
      payment_method_id: pmId,
    })
    expect(result.status).toBe(200)
    expect(result.idempotencyKey).toBe("idem_1")
    expect(result.data.invoice.status).toBe("paid")
    expect(result.data.attempt.status).toBe("settled")
    expect(result.data.operation.status).toBe("succeeded")
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0].headers.get("Idempotency-Key")).toBe("idem_1")
    expect(server.requests[0].body).toEqual({ payment_method_id: pmId })
  })

  it("pay-now: 202 carries the unresolved operation (canonical fixture)", async () => {
    const { server, client } = setup()
    server.route("POST", payNowPath, () => json(invoicePayNow, 202))
    const result = await client.payInvoiceNow(invoiceId, {
      payment_method_id: pmId,
    })
    expect(result.status).toBe(202)
    expect(result.data.operation).toEqual({
      id: operationId,
      status: "unknown_needs_verify",
    })
    expect(result.data.invoice.recovery?.operation?.id).toBe(operationId)
  })

  it("retry-now: optional body, 200 with the renewed subscription and payment", async () => {
    const { server, client } = setup()
    server.route("POST", retryNowPath, () => json(subscriptionRetryNow))
    const plain = await client.retrySubscriptionNow(subId)
    expect(plain.data.operation.status).toBe("succeeded")
    expect(plain.data.payment?.id).toBe(
      "pay_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    )
    expect(server.requests[0].body).toEqual({})
    await client.retrySubscriptionNow(
      subId,
      { payment_method_id: pmId },
      { idempotencyKey: "idem_host" }
    )
    expect(server.requests[1].body).toEqual({ payment_method_id: pmId })
    expect(server.requests[1].headers.get("Idempotency-Key")).toBe("idem_host")
  })

  it("reads the invoice attempt history behind a 202", async () => {
    const { server, client } = setup()
    server.route("GET", `/v1/me/invoices/${invoiceId}/payments`, () =>
      json({
        object: "list",
        data: [settled.attempt, invoicePayNow.attempt],
        total: 2,
        limit: 20,
        offset: 0,
        has_more: false,
      })
    )
    const page = await client.listInvoicePayments(invoiceId, { limit: 20 })
    expect(page.data.map((a) => a.status)).toEqual(["settled", "attempted"])
    expect(server.requests[0].query.get("limit")).toBe("20")
  })

  it("402 card_declined exposes the recorded attempt in typed metadata", async () => {
    const { server, client } = setup()
    const metadata = {
      decline_reason: "insufficient_funds",
      failure_code: "201",
      attempt_id: invoicePayNow.attempt.id,
      invoice_id: invoiceId,
      operation_id: operationId,
      replayed: false,
      retryable: true,
      attempt_count: 3,
      next_attempt_at: "2026-09-19T00:00:00Z",
    }
    server.route("POST", payNowPath, () =>
      errorEnvelope(402, "card_declined", { metadata })
    )
    const error = await client
      .payInvoiceNow(invoiceId, { payment_method_id: pmId })
      .catch((e) => e)
    expect(error.isPaymentRefused).toBe(true)
    expect(recoveryDeclineOf(error)).toEqual(metadata)
    expect(recoveryDeclineOf(new Error("x"))).toBeNull()
    expect(server.requests).toHaveLength(1)
  })

  it("surfaces every 409 refusal code, 400 and 404 typed and without a retry", async () => {
    const { server, client } = setup()
    let code = ""
    server.route("POST", payNowPath, () => errorEnvelope(409, code))
    for (code of RECOVERY_REFUSAL_CODES) {
      const error = await client
        .payInvoiceNow(invoiceId, { payment_method_id: pmId })
        .catch((e) => e)
      expect(error, code).toBeInstanceOf(BillingError)
      expect(error.status).toBe(409)
      expect(error.code).toBe(code)
      expect(error.isConflict).toBe(true)
    }
    expect(server.requests).toHaveLength(RECOVERY_REFUSAL_CODES.length)
    const unknown = await (async () => {
      code = "subscription_retry_outcome_unknown"
      return client
        .payInvoiceNow(invoiceId, { payment_method_id: pmId })
        .catch((e) => e)
    })()
    expect(unknown.isOutcomeUnknown).toBe(true)

    server.route("POST", retryNowPath, () =>
      errorEnvelope(400, "collection_payment_method_invalid")
    )
    const invalid = await client
      .retrySubscriptionNow(subId, { payment_method_id: pmId })
      .catch((e) => e)
    expect(invalid.code).toBe("collection_payment_method_invalid")

    server.route(
      "POST",
      `/v1/me/invoices/99999999-9999-4999-8999-999999999990/pay-now`,
      () => errorEnvelope(404, "resource_not_found")
    )
    const notMine = await client
      .payInvoiceNow("99999999-9999-4999-8999-999999999990", {
        payment_method_id: pmId,
      })
      .catch((e) => e)
    expect(notMine.isNotFound).toBe(true)
  })

  it("never auto-retries a pay-now on a lost response or a 5xx", async () => {
    const { server, client } = setup()
    server.route("POST", payNowPath, () => {
      throw new NetworkFailure()
    })
    const lost = await client
      .payInvoiceNow(invoiceId, { payment_method_id: pmId })
      .catch((e) => e)
    expect(lost.isOutcomeUnknown).toBe(true)
    server.route("POST", retryNowPath, () =>
      errorEnvelope(503, "service_unavailable")
    )
    await expect(client.retrySubscriptionNow(subId)).rejects.toMatchObject({
      status: 503,
    })
    expect(server.requests.map((r) => r.path)).toEqual([
      payNowPath,
      retryNowPath,
    ])
  })

  it("refuses a malformed request or host key before anything is sent", async () => {
    const { server, client } = setup()
    await expect(
      client.payInvoiceNow(invoiceId, {
        payment_method_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as never,
      })
    ).rejects.toThrow()
    await expect(
      client.retrySubscriptionNow(subId, {
        payment_method_id: pmId,
        amount: "1",
      } as never)
    ).rejects.toThrow()
    await expect(
      client.payInvoiceNow(
        invoiceId,
        { payment_method_id: pmId },
        { idempotencyKey: "" }
      )
    ).rejects.toThrow(/1–255 bytes/)
    await expect(
      client.payInvoiceNow(
        invoiceId,
        { payment_method_id: pmId },
        { idempotencyKey: "k".repeat(256) }
      )
    ).rejects.toThrow(/1–255 bytes/)
    expect(server.requests).toHaveLength(0)
  })
})

describe("decode failures on mutations", () => {
  it("keep the key and are outcome-unknown: the server answered 2xx", async () => {
    const { server, client } = setup()
    server.route(
      "POST",
      `/v1/me/invoices/${invoicePayNow.invoice.id}/pay-now`,
      () => json({ unexpected: true })
    )
    const error = await client
      .payInvoiceNow(invoicePayNow.invoice.id, { payment_method_id: pmId })
      .catch((e) => e)
    expect(error.kind).toBe("invalid_response")
    expect(error.method).toBe("POST")
    expect(error.idempotencyKey).toBe("idem_1")
    expect(error.isOutcomeUnknown).toBe(true)
  })
})

// #491/#495: a tier change is a durable operation keyed by the client's
// Idempotency-Key; the server refuses a keyless request outright.
describe("tier changes", () => {
  const changeTierPath = `/v1/me/subscriptions/${subId}/change-tier`
  const tierChange = {
    object: "tier_change",
    status: "succeeded",
    mode: "tier_change",
    action: "upgrade",
    price_id: priceId,
    payment: { rail: "nmi" },
    subscription_id: subId,
    amount_due_now: "4000000",
    next_charge_amount: "9000000",
  }

  it("sends an Idempotency-Key on every change-tier call", async () => {
    const { server, client } = setup()
    server.route("POST", changeTierPath, () => json(tierChange))
    const first = await client.changeTier(subId, priceId)
    expect(first.idempotencyKey).toBe("idem_1")
    expect(server.requests[0].headers.get("Idempotency-Key")).toBe("idem_1")
    expect(server.requests[0].body).toEqual({ price_id: priceId })
    // Replaying a lost outcome reuses the caller's key byte for byte.
    const replay = await client.changeTier(subId, priceId, {
      idempotencyKey: "idem_1",
    })
    expect(replay.idempotencyKey).toBe("idem_1")
    expect(server.requests[1].headers.get("Idempotency-Key")).toBe("idem_1")
  })

  it("makes a keyless change-tier impossible through the client API", async () => {
    const { server, client } = setup()
    server.route("POST", changeTierPath, () => json(tierChange))
    // There is no option that suppresses the key, and an empty or oversized
    // one is refused before anything is sent.
    for (const idempotencyKey of ["", " ", "k".repeat(256)])
      await expect(
        client.changeTier(subId, priceId, { idempotencyKey }),
        JSON.stringify(idempotencyKey)
      ).rejects.toThrow(/1–255 bytes/)
    expect(server.requests).toHaveLength(0)
    await client.changeTier(subId, priceId, { idempotencyKey: undefined })
    expect(server.requests[0].headers.get("Idempotency-Key")).toBe("idem_1")
  })

  it("keeps the preview keyless: it mutates nothing", async () => {
    const { server, client } = setup()
    server.route("POST", `${changeTierPath}/preview`, () =>
      json({
        object: "tier_change_preview",
        action: "upgrade",
        price_id: priceId,
        rail: "nmi",
        currency: "USD",
        amount_due_now: "4000000",
        next_charge_amount: "9000000",
        effective: "now",
        is_estimate: false,
      })
    )
    const preview = await client.previewTierChange(subId, priceId)
    expect(preview.amount_due_now).toBe("4000000")
    expect(server.requests[0].headers.get("Idempotency-Key")).toBeNull()
  })

  it("answers 202 processing with the durable operation id", async () => {
    const { server, client } = setup()
    server.route("POST", changeTierPath, () =>
      json(
        {
          ...tierChange,
          status: "processing",
          operation_id: "01999999-9999-7999-8999-999999999999",
          message: "We are confirming this change with the provider.",
        },
        202
      )
    )
    const result = await client.changeTier(subId, priceId)
    expect(result.status).toBe(202)
    expect(result.data.status).toBe("processing")
    expect(result.data.operation_id).toBe(
      "01999999-9999-7999-8999-999999999999"
    )
    expect(result.idempotencyKey).toBe("idem_1")
  })

  it("surfaces the tier-change refusal codes typed", async () => {
    const { server, client } = setup()
    const cases = [
      {
        status: 409,
        code: "tier_change_in_flight",
        conflict: true,
        reuse: false,
      },
      {
        status: 409,
        code: "tier_change_idempotency_conflict",
        conflict: true,
        reuse: true,
      },
      {
        status: 400,
        code: "tier_change_idempotency_key_required",
        conflict: false,
        reuse: false,
      },
      {
        status: 409,
        code: "tier_change_refused",
        conflict: true,
        reuse: false,
      },
    ]
    for (const expected of cases) {
      server.route("POST", changeTierPath, () =>
        errorEnvelope(expected.status, expected.code, {
          metadata: { operation_id: "01999999-9999-7999-8999-999999999999" },
        })
      )
      const error = await client.changeTier(subId, priceId).catch((e) => e)
      expect(error, expected.code).toBeInstanceOf(BillingError)
      expect(error.status).toBe(expected.status)
      expect(error.code).toBe(expected.code)
      expect(error.isConflict).toBe(expected.conflict)
      expect(error.isIdempotencyReuse).toBe(expected.reuse)
      expect(error.isOutcomeUnknown).toBe(false)
      expect(error.idempotencyKey).toBe("idem_1")
      expect(error.metadata?.operation_id).toBe(
        "01999999-9999-7999-8999-999999999999"
      )
    }
  })
})
