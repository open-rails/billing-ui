import type { FormEvent } from "react"

import type { CheckoutSession, PaymentMethod } from "../core/schemas"
import { SavedMethods } from "./saved-methods"
import {
  checkoutViewLabels,
  type CheckoutViewLabels,
  type SavedMethodsLabels,
} from "./labels"
import { checkoutRedirectURL, cx, type MoneyFormatter } from "./shared"

export interface CheckoutOffer {
  display_name: string
  unit_amount: string
  currency: string
  auto_renew: boolean
  interval?: string | null
}

export interface CheckoutViewProps {
  offer: CheckoutOffer
  money: MoneyFormatter
  labels?: Partial<CheckoutViewLabels>
  methodLabels?: Partial<SavedMethodsLabels>
  className?: string
  savedMethods?: PaymentMethod[]
  // Controlled selection: a saved method id, or null for the host's new-card
  // path (the host tokenizes and creates the session).
  selectedMethodId: string | null
  onSelectMethod: (id: string | null) => void
  allowNewMethod?: boolean
  onSubmit: () => void
  submitting?: boolean
  // The session after create/confirm; drives the outcome region.
  session?: CheckoutSession | null
  error?: string | null
  // A requires_action redirect (next_action.redirect_to_url / payment
  // .redirect_url / url) is followed by the host: the view only offers it.
  onContinue?: (url: string) => void
}

export function CheckoutView({
  offer,
  money,
  labels: overrides,
  methodLabels,
  className,
  savedMethods = [],
  selectedMethodId,
  onSelectMethod,
  allowNewMethod = true,
  onSubmit,
  submitting = false,
  session,
  error,
  onContinue,
}: CheckoutViewProps) {
  const labels = { ...checkoutViewLabels, ...overrides }
  const done = session?.status === "succeeded"
  const redirect = session ? checkoutRedirectURL(session) : null
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!submitting && !done) onSubmit()
  }
  return (
    <form
      className={cx("orb-checkout", className)}
      onSubmit={submit}
      data-status={session?.status ?? "idle"}
      aria-busy={submitting}
    >
      <section className="orb-checkout__summary">
        <h3>{labels.summary}</h3>
        <dl>
          <dt>{offer.display_name}</dt>
          <dd className="orb-money">
            {money.format(offer.unit_amount, offer.currency)}
            {offer.interval ? ` / ${offer.interval}` : ""}
          </dd>
        </dl>
        <p className="orb-checkout__terms">
          {offer.auto_renew ? labels.recurring : labels.oneTime}
        </p>
      </section>
      {!done ? (
        <fieldset className="orb-checkout__methods" disabled={submitting}>
          <legend>{labels.paymentMethod}</legend>
          <SavedMethods
            methods={savedMethods}
            labels={methodLabels}
            selectedId={selectedMethodId}
            onSelect={(method) => onSelectMethod(method.id)}
          />
          {allowNewMethod ? (
            <label className="orb-checkout__new-method">
              <input
                type="radio"
                name="orb-method"
                value=""
                checked={selectedMethodId === null}
                onChange={() => onSelectMethod(null)}
              />
              {labels.newMethod}
            </label>
          ) : null}
        </fieldset>
      ) : null}
      {error ? (
        <p className="orb-checkout__error" role="alert">
          {error}
        </p>
      ) : null}
      {session ? (
        <p
          className="orb-checkout__outcome"
          data-status={session.status}
          role="status"
        >
          {session.status === "succeeded"
            ? labels.succeeded
            : session.status === "requires_action"
              ? labels.requiresAction
              : session.status === "failed"
                ? session.message || labels.failed
                : session.status === "blocked"
                  ? session.message || labels.blocked
                  : session.status === "expired"
                    ? labels.expired
                    : session.status === "canceled"
                      ? labels.canceled
                      : session.message}
        </p>
      ) : null}
      {redirect && session?.status === "requires_action" ? (
        onContinue ? (
          <button
            type="button"
            className="orb-button orb-button--primary"
            onClick={() => onContinue(redirect)}
          >
            {labels.continueToProvider}
          </button>
        ) : (
          <a className="orb-button orb-button--primary" href={redirect}>
            {labels.continueToProvider}
          </a>
        )
      ) : !done ? (
        <button
          type="submit"
          className="orb-button orb-button--primary"
          disabled={submitting}
        >
          {submitting
            ? labels.processing
            : `${labels.pay} ${money.format(offer.unit_amount, offer.currency)}`}
        </button>
      ) : null}
    </form>
  )
}
