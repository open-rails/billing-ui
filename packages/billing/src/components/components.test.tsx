import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

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
import { PaymentRecovery } from "./payment-recovery"
import { SavedMethods } from "./saved-methods"
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
  last_collection_failure_code: "insufficient_funds",
  next_collection_attempt_at: "2026-09-19T00:00:00Z",
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

describe("PaymentRecovery", () => {
  it("shows dunning facts and the retry action only with the server flag", () => {
    const pastDue = {
      ...subscription,
      status: "past_due",
      retry_attempts: 2,
      last_retry_at: "2026-09-15T00:00:00Z",
      next_retry_at: "2026-09-19T00:00:00Z",
      grace_ends_at: "2026-09-25T00:00:00Z",
      payments: [
        { ...subscription.payments![0], status: "failed", amount: "9990000" },
      ],
    }
    const onRetryNow = vi.fn()
    const { rerender, container } = render(
      <PaymentRecovery
        subscription={pastDue}
        money={money}
        formatDate={formatDate}
        onRetryNow={onRetryNow}
      />
    )
    expect(screen.getByText("$9.99")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("2026-09-19")).toBeInTheDocument()
    expect(screen.getByText("2026-09-25")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Retry payment now" })
    ).toBeNull()
    expect(container.firstChild).toHaveAttribute("data-retryable", "false")

    rerender(
      <PaymentRecovery
        subscription={pastDue}
        money={money}
        retryable
        onRetryNow={onRetryNow}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Retry payment now" }))
    expect(onRetryNow).toHaveBeenCalledWith(pastDue)
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
  it("renders exact JPY money, collection state and pay-now only when the host allows", () => {
    const onPayNow = vi.fn()
    render(
      <InvoiceList
        invoices={[invoice]}
        money={money}
        formatDate={formatDate}
        onPayNow={onPayNow}
        canPayNow={(i) => i.status === "past_due"}
        labels={{ status: { past_due: "Past due" } }}
      />
    )
    expect(screen.getByText("Invoice INV-7")).toBeInTheDocument()
    expect(screen.getByText("Past due")).toBeInTheDocument()
    expect(screen.getAllByText("¥1,234")).toHaveLength(2)
    expect(screen.getByText("2026-09-19")).toBeInTheDocument()
    expect(screen.getByText("1")).toHaveAttribute(
      "data-failure-code",
      "insufficient_funds"
    )
    fireEvent.click(screen.getByRole("button", { name: "Pay now" }))
    expect(onPayNow).toHaveBeenCalledWith(invoice)
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
