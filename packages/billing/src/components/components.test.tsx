import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BillingError } from "../core/errors"
import { formatMoney, parseCurrencyRegistry } from "../core/money"
import {
  checkoutSessionSchema,
  invoiceSchema,
  paymentMethodSchema,
  subscriptionSchema,
  type CheckoutSession,
  type PaymentMethod,
} from "../core/schemas"
import currencies from "../test/fixtures/wire/currencies.json"
import subscriptionFixture from "../test/fixtures/wire/subscription.json"
import { CheckoutView } from "./checkout-view"
import { InvoiceList } from "./invoice-list"
import { SavedMethods } from "./saved-methods"
import { SubscriptionRecovery } from "./subscription-recovery"
import { SubscriptionState } from "./subscription-state"

const registry = parseCurrencyRegistry(currencies)
const money = {
  format: (amount: string | null | undefined, currency: string | undefined) =>
    formatMoney(amount, currency, registry),
}
const subscription = subscriptionSchema.parse(subscriptionFixture)
const formatDate = (iso: string | null | undefined) =>
  iso ? iso.slice(0, 10) : ""

const method: PaymentMethod = paymentMethodSchema.parse({
  id: "pm_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  object: "payment_method",
  type: "card",
  rail: "nmi",
  psp_id: "55555555-5555-5555-5555-555555555555",
  card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
  created_at: "2026-09-16T00:00:00Z",
  health: { expiry_status: "expiring_soon", active: true },
  collection_default_currencies: ["USD"],
  subscriptions: [
    {
      id: subscription.id,
      display_name: "Pro",
      description: "",
      created_at: "2026-09-16T00:00:00Z",
    },
  ],
})

const invoice = invoiceSchema.parse({
  id: "88888888-8888-4888-8888-888888888888",
  currency: "JPY",
  invoice_number: "INV-7",
  period_from: "2026-08-01T00:00:00Z",
  period_to: "2026-09-01T00:00:00Z",
  usage_total: "12340000",
  deposits_total: "0",
  owed_accrued: "0",
  owed_paid: "0",
  closing_balance: "0",
  subtotal_amount: "12340000",
  total_amount: "12340000",
  amount_paid: "0",
  amount_due: "12340000",
  status: "past_due",
  collection_method: "charge_automatically",
  collection_failure_count: 1,
  recovery: {
    retryable: true,
    attempt_count: 1,
    failure_category: "insufficient_funds",
    last_failure_code: "201",
    next_attempt_at: "2026-09-19T00:00:00Z",
    compatible_payment_method_ids: ["pm_dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
  },
  created_at: "2026-09-01T00:00:00Z",
})

describe("SubscriptionState", () => {
  it("renders DTO facts and offers cancel only while the DTO allows it", () => {
    const onCancel = vi.fn()
    const onResume = vi.fn()
    const { rerender } = render(
      <SubscriptionState
        subscription={subscription}
        money={money}
        formatDate={formatDate}
        onCancel={onCancel}
        onResume={onResume}
        labels={{ status: { active: "Active" } }}
      />
    )
    expect(screen.getByText("Pro")).toBeInTheDocument()
    expect(screen.getByText("Active")).toBeInTheDocument()
    expect(screen.getByText("$9,223,372,036,854.775807")).toBeInTheDocument()
    expect(screen.getByText(/Visa •••• 4242 12\/30/)).toBeInTheDocument()
    expect(screen.getByText("Changes to")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancel subscription" }))
    expect(onCancel).toHaveBeenCalledWith(subscription)
    expect(
      screen.queryByRole("button", { name: "Resume subscription" })
    ).toBeNull()

    rerender(
      <SubscriptionState
        subscription={{
          ...subscription,
          cancel_scheduled: true,
          resumable: true,
        }}
        money={money}
        formatDate={formatDate}
        onCancel={onCancel}
        onResume={onResume}
      />
    )
    expect(
      screen.queryByRole("button", { name: "Cancel subscription" })
    ).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Resume subscription" }))
    expect(onResume).toHaveBeenCalled()
    expect(screen.getByText("Cancellation scheduled")).toBeInTheDocument()
    expect(screen.getByText("Access ends")).toBeInTheDocument()

    rerender(
      <SubscriptionState
        subscription={{ ...subscription, cancel_mode: "external_portal" }}
        money={money}
        onCancel={onCancel}
      />
    )
    expect(
      screen.queryByRole("button", { name: "Cancel subscription" })
    ).toBeNull()
    expect(
      screen.getByRole("link", { name: "Manage on provider site" })
    ).toHaveAttribute("href", "https://support.ccbill.com/")
  })
})

const operationId = "01999999-9999-7999-8999-999999999999"

function declined(extra: Record<string, unknown> = {}) {
  return BillingError.fromResponse("POST", "https://b/x", 402, {
    error: {
      type: "card_error",
      code: "card_declined",
      message: "Your card has insufficient funds.",
      metadata: {
        decline_reason: "insufficient_funds",
        failure_code: "201",
        retryable: true,
        attempt_count: 3,
        ...extra,
      },
    },
  })
}

function refused(code: string, status = 409) {
  return BillingError.fromResponse("POST", "https://b/x", status, {
    error: { type: "invalid_request_error", code, message: "diagnostic text" },
  })
}

describe("SubscriptionRecovery", () => {
  const pastDue = {
    ...subscription,
    status: "past_due",
    grace_ends_at: "2026-09-25T00:00:00Z",
    payments: [
      { ...subscription.payments![0], status: "failed", amount: "9990000" },
    ],
    recovery: {
      retryable: true,
      attempt_count: 2,
      failure_category: "insufficient_funds",
      last_failure_code: "201",
      last_failed_at: "2026-09-15T00:00:00Z",
      next_attempt_at: "2026-09-19T00:00:00Z",
      compatible_payment_method_ids: [subscription.payment_method_id!],
    },
  }

  it("shows the server's recovery facts and offers retry only when retryable", () => {
    const onRetryNow = vi.fn()
    const { rerender, container } = render(
      <SubscriptionRecovery
        subscription={pastDue}
        money={money}
        formatDate={formatDate}
        onRetryNow={onRetryNow}
        labels={{
          recovery: {
            failureCategory: { insufficient_funds: "Insufficient funds" },
          },
        }}
      />
    )
    expect(screen.getByText("$9.99")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("Insufficient funds")).toHaveAttribute(
      "data-failure-code",
      "201"
    )
    expect(screen.getByText("2026-09-19")).toBeInTheDocument()
    expect(screen.getByText("2026-09-25")).toBeInTheDocument()
    expect(container.firstChild).toHaveAttribute("data-retryable", "true")
    fireEvent.click(screen.getByRole("button", { name: "Retry payment now" }))
    expect(onRetryNow).toHaveBeenCalledWith(pastDue)

    // Not retryable: the server's blocked reason is shown, the control is not.
    rerender(
      <SubscriptionRecovery
        subscription={{
          ...pastDue,
          recovery: {
            ...pastDue.recovery,
            retryable: false,
            blocked_reason: "rail_unsupported",
          },
        }}
        money={money}
        onRetryNow={onRetryNow}
      />
    )
    expect(
      screen.queryByRole("button", { name: "Retry payment now" })
    ).toBeNull()
    expect(
      screen.getByText("This payment is managed by the payment provider.")
    ).toHaveAttribute("data-blocked-reason", "rail_unsupported")

    // No recovery block (non-self shape): nothing is inferred, no control.
    rerender(
      <SubscriptionRecovery
        subscription={{ ...pastDue, recovery: undefined }}
        money={money}
        onRetryNow={onRetryNow}
      />
    )
    expect(
      screen.queryByRole("button", { name: "Retry payment now" })
    ).toBeNull()
  })

  it("shows confirming while an operation is unresolved and hides retry", () => {
    const { rerender } = render(
      <SubscriptionRecovery
        subscription={pastDue}
        money={money}
        onRetryNow={vi.fn()}
        operation={{ id: operationId, status: "unknown_needs_verify" }}
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Confirming your payment"
    )
    expect(
      screen.queryByRole("button", { name: "Retry payment now" })
    ).toBeNull()

    rerender(
      <SubscriptionRecovery
        subscription={{
          ...pastDue,
          recovery: {
            ...pastDue.recovery,
            retryable: false,
            blocked_reason: "in_progress",
            operation: { id: operationId, status: "in_flight" },
          },
        }}
        money={money}
        onRetryNow={vi.fn()}
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Confirming your payment"
    )
  })

  it("displays a 402 decline and each 409 refusal by code", () => {
    const { rerender } = render(
      <SubscriptionRecovery
        subscription={pastDue}
        money={money}
        error={declined()}
        labels={{
          recovery: {
            failureCategory: { insufficient_funds: "(insufficient funds)" },
          },
        }}
      />
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your payment was declined. (insufficient funds)"
    )
    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-decline-reason",
      "insufficient_funds"
    )

    for (const code of [
      "payment_recovery_rail_unsupported",
      "subscription_not_retryable",
      "subscription_retry_in_progress",
      "subscription_retry_outcome_unknown",
    ]) {
      rerender(
        <SubscriptionRecovery
          subscription={pastDue}
          money={money}
          error={refused(code)}
        />
      )
      expect(screen.getByRole("alert"), code).toHaveAttribute("data-code", code)
      expect(screen.getByRole("alert").textContent).not.toContain(
        "diagnostic text"
      )
    }
    rerender(
      <SubscriptionRecovery
        subscription={pastDue}
        money={money}
        error={refused("collection_payment_method_invalid", 400)}
      />
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That payment method cannot be used"
    )
    rerender(
      <SubscriptionRecovery
        subscription={pastDue}
        money={money}
        error={refused("brand_new_code")}
      />
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The payment could not be attempted."
    )
  })
})

describe("SavedMethods", () => {
  it("lists cards with health flags, collection defaults and controlled selection", () => {
    const onSelect = vi.fn()
    const onRemove = vi.fn()
    const onDefault = vi.fn()
    render(
      <SavedMethods
        methods={[
          method,
          {
            ...method,
            id: "pm_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            collection_default_currencies: [],
          },
        ]}
        selectedId={method.id}
        onSelect={onSelect}
        onRemove={onRemove}
        onMakeCollectionDefault={onDefault}
        collectionCurrency="usd"
      />
    )
    const options = screen.getAllByRole("option")
    expect(options[0]).toHaveAttribute("aria-selected", "true")
    expect(options[0]).toHaveAttribute("data-expiry-status", "expiring_soon")
    expect(screen.getAllByText("Expiring soon")).toHaveLength(2)
    expect(screen.getByText("Collects invoices in USD")).toBeInTheDocument()
    expect(screen.getAllByText("Used by Pro")).toHaveLength(2)
    // Only the method that is not yet the USD default offers the action.
    expect(
      screen.getAllByRole("button", { name: "Use for invoices" })
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Use for invoices" }))
    expect(onDefault).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "pm_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      }),
      "USD"
    )
    fireEvent.click(
      screen.getAllByRole("button", { name: /Visa •••• 4242/ })[1]
    )
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pm_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })
    )
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0])
    expect(onRemove).toHaveBeenCalledWith(method)
  })
})

describe("InvoiceList", () => {
  it("renders exact JPY money and pay-now only when recovery.retryable", () => {
    const onPayNow = vi.fn()
    const { rerender } = render(
      <InvoiceList
        invoices={[invoice]}
        money={money}
        formatDate={formatDate}
        onPayNow={onPayNow}
        labels={{ status: { past_due: "Past due" } }}
      />
    )
    expect(screen.getByText("Invoice INV-7")).toBeInTheDocument()
    expect(screen.getByText("Past due")).toBeInTheDocument()
    expect(screen.getAllByText("¥1,234")).toHaveLength(2)
    expect(screen.getByText("2026-09-19")).toBeInTheDocument()
    expect(screen.getByText("insufficient_funds")).toHaveAttribute(
      "data-failure-code",
      "201"
    )
    fireEvent.click(screen.getByRole("button", { name: "Pay now" }))
    expect(onPayNow).toHaveBeenCalledWith(invoice)

    rerender(
      <InvoiceList
        invoices={[
          {
            ...invoice,
            recovery: {
              ...invoice.recovery!,
              retryable: false,
              blocked_reason: "no_compatible_payment_method",
            },
          },
        ]}
        money={money}
        onPayNow={onPayNow}
      />
    )
    expect(screen.queryByRole("button", { name: "Pay now" })).toBeNull()
    expect(
      screen.getByText("Add a payment method to pay now.")
    ).toBeInTheDocument()
  })

  it("tracks the active invoice's 202 operation and last error", () => {
    const { rerender } = render(
      <InvoiceList
        invoices={[invoice]}
        money={money}
        onPayNow={vi.fn()}
        active={{
          invoiceId: invoice.id,
          operation: { id: operationId, status: "pending" },
        }}
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Confirming your payment"
    )
    expect(screen.queryByRole("button", { name: "Pay now" })).toBeNull()

    rerender(
      <InvoiceList
        invoices={[invoice]}
        money={money}
        onPayNow={vi.fn()}
        active={{
          invoiceId: invoice.id,
          error: refused("invoice_retry_idempotency_conflict"),
        }}
      />
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "already used for a different payment"
    )
    expect(screen.getByRole("button", { name: "Pay now" })).toBeInTheDocument()

    rerender(
      <InvoiceList
        invoices={[invoice]}
        money={money}
        active={{ invoiceId: invoice.id, error: declined() }}
      />
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your payment was declined."
    )
  })

  it("shows the empty state", () => {
    render(
      <InvoiceList
        invoices={[]}
        money={money}
        labels={{ empty: "Nothing here" }}
      />
    )
    expect(screen.getByText("Nothing here")).toBeInTheDocument()
  })
})

describe("CheckoutView", () => {
  const offer = {
    display_name: "Premium",
    unit_amount: "99000000",
    currency: "USD",
    auto_renew: true,
    interval: "month",
  }

  it("submits the controlled selection and offers a requires_action redirect", () => {
    const onSubmit = vi.fn()
    const onSelectMethod = vi.fn()
    const onContinue = vi.fn()
    const { rerender } = render(
      <CheckoutView
        offer={offer}
        money={money}
        savedMethods={[method]}
        selectedMethodId={null}
        onSelectMethod={onSelectMethod}
        onSubmit={onSubmit}
      />
    )
    expect(screen.getByText("$99.00 / month")).toBeInTheDocument()
    expect(screen.getByText("Renews automatically")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Visa •••• 4242/ }))
    expect(onSelectMethod).toHaveBeenCalledWith(method.id)
    fireEvent.click(screen.getByRole("button", { name: "Pay $99.00" }))
    expect(onSubmit).toHaveBeenCalledTimes(1)

    const session: CheckoutSession = checkoutSessionSchema.parse({
      object: "checkout_session",
      id: "cs_ffffffff-ffff-4fff-8fff-ffffffffffff",
      status: "requires_action",
      mode: "subscription",
      price_id: "price_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      amount: "99000000",
      currency: "USD",
      payment: { rail: "ccbill" },
      created_at: "2026-09-16T00:00:00Z",
      next_action: {
        type: "redirect_to_url",
        redirect_to_url: { url: "https://pay.example/x" },
      },
    })
    rerender(
      <CheckoutView
        offer={offer}
        money={money}
        selectedMethodId={null}
        onSelectMethod={onSelectMethod}
        onSubmit={onSubmit}
        session={session}
        onContinue={onContinue}
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Continue with the payment provider"
    )
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(onContinue).toHaveBeenCalledWith("https://pay.example/x")
    expect(screen.queryByRole("button", { name: /^Pay/ })).toBeNull()

    rerender(
      <CheckoutView
        offer={offer}
        money={money}
        selectedMethodId={null}
        onSelectMethod={onSelectMethod}
        onSubmit={onSubmit}
        session={{ ...session, status: "succeeded" }}
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent("Payment complete.")
    expect(screen.queryByRole("button")).toBeNull()
  })
})
