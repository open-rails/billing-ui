import type { Subscription } from "../core/schemas"
import { paymentRecoveryLabels, type PaymentRecoveryLabels } from "./labels"
import {
  cx,
  defaultFormatDate,
  type DateFormatter,
  type MoneyFormatter,
} from "./shared"

export interface PaymentRecoveryProps {
  subscription: Subscription
  money: MoneyFormatter
  formatDate?: DateFormatter
  labels?: Partial<PaymentRecoveryLabels>
  className?: string
  // #809 retry-now. `retryable` is the server's flag (pending in the DTO);
  // the button renders only when the host passes it true.
  retryable?: boolean
  onRetryNow?: (subscription: Subscription) => void
  onUpdatePaymentMethod?: (subscription: Subscription) => void
  busy?: boolean
}

// Recovery state as OpenRails reports it: what dunning has done
// (retry_attempts, last_retry_at), will do (next_retry_at) and how long
// access lasts (grace_ends_at). The most recent failed payment, when the
// DTO carries one, shows its rail outcome.
export function PaymentRecovery({
  subscription,
  money,
  formatDate = defaultFormatDate,
  labels: overrides,
  className,
  retryable = false,
  onRetryNow,
  onUpdatePaymentMethod,
  busy = false,
}: PaymentRecoveryProps) {
  const labels = { ...paymentRecoveryLabels, ...overrides }
  const s = subscription
  const failed = s.payments?.find((p) => p.status === "failed")
  return (
    <section
      className={cx("orb-recovery", className)}
      data-subscription-id={s.id}
      data-status={s.status}
      data-retryable={String(retryable)}
    >
      <h3 className="orb-recovery__title">{labels.title}</h3>
      <dl className="orb-recovery__facts">
        {failed ? (
          <>
            <dt>{labels.lastPayment}</dt>
            <dd className="orb-money" data-payment-status={failed.status}>
              {money.format(failed.amount, failed.currency)}
            </dd>
          </>
        ) : null}
        {s.last_retry_at ? (
          <>
            <dt>{labels.lastAttempt}</dt>
            <dd>{formatDate(s.last_retry_at)}</dd>
          </>
        ) : null}
        {s.retry_attempts != null ? (
          <>
            <dt>{labels.attempts}</dt>
            <dd>{s.retry_attempts}</dd>
          </>
        ) : null}
        {s.next_retry_at ? (
          <>
            <dt>{labels.nextAttempt}</dt>
            <dd>{formatDate(s.next_retry_at)}</dd>
          </>
        ) : null}
        {s.grace_ends_at ? (
          <>
            <dt>{labels.graceEnds}</dt>
            <dd>{formatDate(s.grace_ends_at)}</dd>
          </>
        ) : null}
      </dl>
      {s.next_retry_at ? (
        <p className="orb-recovery__notice" data-notice="scheduled">
          {labels.scheduled}
        </p>
      ) : null}
      <div className="orb-recovery__actions">
        {onUpdatePaymentMethod ? (
          <button
            type="button"
            className="orb-button orb-button--secondary"
            disabled={busy}
            onClick={() => onUpdatePaymentMethod(s)}
          >
            {labels.updatePaymentMethod}
          </button>
        ) : null}
        {retryable && onRetryNow ? (
          <button
            type="button"
            className="orb-button orb-button--primary"
            disabled={busy}
            aria-busy={busy}
            onClick={() => onRetryNow(s)}
          >
            {labels.retryNow}
          </button>
        ) : null}
      </div>
    </section>
  )
}
