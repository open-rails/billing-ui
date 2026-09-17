import type { Subscription } from "../core/schemas"
import { subscriptionStateLabels, type SubscriptionStateLabels } from "./labels"
import {
  cardLabel,
  cx,
  defaultFormatDate,
  expiryLabel,
  type DateFormatter,
  type MoneyFormatter,
} from "./shared"

export interface SubscriptionStateProps {
  subscription: Subscription
  money: MoneyFormatter
  formatDate?: DateFormatter
  labels?: Partial<SubscriptionStateLabels>
  className?: string
  onCancel?: (subscription: Subscription) => void
  onResume?: (subscription: Subscription) => void
  onChangePaymentMethod?: (subscription: Subscription) => void
  onChangePlan?: (subscription: Subscription) => void
  busy?: boolean
}

// Which controls appear follows the DTO: `resumable`, `cancel_scheduled`,
// `cancel_mode` ("external_portal" hands the cancel to cancel_portal_url)
// and the lifecycle timestamps. Whether a cancel/resume is accepted is
// still OpenRails' decision on the request.
export function SubscriptionState({
  subscription,
  money,
  formatDate = defaultFormatDate,
  labels: overrides,
  className,
  onCancel,
  onResume,
  onChangePaymentMethod,
  onChangePlan,
  busy = false,
}: SubscriptionStateProps) {
  const labels = { ...subscriptionStateLabels, ...overrides }
  const s = subscription
  const external = s.cancel_mode === "external_portal"
  const ended =
    !!s.ended_at || s.status === "cancelled" || s.status === "expired"
  const showCancel = !!onCancel && !external && !ended && !s.cancel_scheduled
  const showResume = !!onResume && s.resumable
  const price = s.price
  const scheduled = s.scheduled_price

  return (
    <section
      className={cx("orb-subscription", className)}
      data-subscription-id={s.id}
      data-status={s.status}
      data-cancel-scheduled={String(s.cancel_scheduled)}
      data-cancel-mode={s.cancel_mode}
      data-rail={s.rail}
    >
      <header className="orb-subscription__header">
        <h3 className="orb-subscription__product">
          {s.product?.display_name ?? s.product_id}
        </h3>
        <span className="orb-subscription__status" data-status={s.status}>
          {labels.status[s.status] ?? s.status}
        </span>
      </header>
      <dl className="orb-subscription__facts">
        {price ? (
          <>
            <dt>{labels.price}</dt>
            <dd className="orb-money">
              {money.format(price.unit_amount, price.currency)}
            </dd>
          </>
        ) : null}
        {s.cancel_scheduled && s.current_period_ends_at ? (
          <>
            <dt>{labels.endsOn}</dt>
            <dd>{formatDate(s.current_period_ends_at)}</dd>
          </>
        ) : s.current_period_ends_at && !ended ? (
          <>
            <dt>{labels.renews}</dt>
            <dd>{formatDate(s.current_period_ends_at)}</dd>
          </>
        ) : null}
        {scheduled ? (
          <>
            <dt>{labels.scheduledChange}</dt>
            <dd className="orb-money">
              {s.scheduled_product?.display_name ?? scheduled.key}{" "}
              {money.format(scheduled.unit_amount, scheduled.currency)}
            </dd>
          </>
        ) : null}
        <dt>{labels.paymentMethod}</dt>
        <dd>
          {s.card
            ? `${cardLabel(s.card.brand, s.card.last4, s.rail)} ${expiryLabel(s.card.exp_month, s.card.exp_year)}`.trim()
            : s.payment_method_id
              ? s.rail
              : labels.noPaymentMethod}
        </dd>
      </dl>
      {s.cancel_scheduled ? (
        <p className="orb-subscription__notice" data-notice="cancel-scheduled">
          {labels.cancelScheduled}
        </p>
      ) : null}
      {external ? (
        <p className="orb-subscription__notice" data-notice="external-portal">
          {labels.managedExternally}{" "}
          {s.cancel_portal_url ? (
            <a
              href={s.cancel_portal_url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {labels.openPortal}
            </a>
          ) : null}
        </p>
      ) : null}
      <div className="orb-subscription__actions">
        {onChangePlan ? (
          <button
            type="button"
            className="orb-button orb-button--secondary"
            disabled={busy}
            onClick={() => onChangePlan(s)}
          >
            {labels.changePlan}
          </button>
        ) : null}
        {onChangePaymentMethod ? (
          <button
            type="button"
            className="orb-button orb-button--secondary"
            disabled={busy}
            onClick={() => onChangePaymentMethod(s)}
          >
            {labels.changePaymentMethod}
          </button>
        ) : null}
        {showResume ? (
          <button
            type="button"
            className="orb-button orb-button--primary"
            disabled={busy}
            aria-busy={busy}
            onClick={() => onResume?.(s)}
          >
            {labels.resume}
          </button>
        ) : null}
        {showCancel ? (
          <button
            type="button"
            className="orb-button orb-button--danger"
            disabled={busy}
            aria-busy={busy}
            onClick={() => onCancel?.(s)}
          >
            {labels.cancel}
          </button>
        ) : null}
      </div>
    </section>
  )
}
