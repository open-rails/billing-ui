import { isOperationUnresolved, type PaymentOperation } from "../core/recovery"
import type { Subscription } from "../core/schemas"
import {
  subscriptionRecoveryLabels,
  type RecoveryLabels,
  type SubscriptionRecoveryLabels,
} from "./labels"
import { RecoveryFacts } from "./recovery-facts"
import {
  cx,
  defaultFormatDate,
  type DateFormatter,
  type MoneyFormatter,
} from "./shared"

export interface SubscriptionRecoveryProps {
  subscription: Subscription
  money: MoneyFormatter
  formatDate?: DateFormatter
  labels?: Partial<Omit<SubscriptionRecoveryLabels, "recovery">> & {
    recovery?: Partial<RecoveryLabels>
  }
  className?: string
  onRetryNow?: (subscription: Subscription) => void
  onUpdatePaymentMethod?: (subscription: Subscription) => void
  // The operation a 202 retry-now returned, while it is being settled.
  operation?: PaymentOperation | null
  // The BillingError the last retry-now raised (402 decline, 409 refusal).
  error?: unknown
  busy?: boolean
}

// Recovery state as OpenRails reports it on `subscription.recovery`: whether
// retry-now would be accepted (`retryable`), why not (`blocked_reason`), what
// dunning did and will do, and the live operation. The retry control renders
// only when the server says `retryable` and no operation is unresolved.
export function SubscriptionRecovery({
  subscription,
  money,
  formatDate = defaultFormatDate,
  labels: overrides,
  className,
  onRetryNow,
  onUpdatePaymentMethod,
  operation,
  error,
  busy = false,
}: SubscriptionRecoveryProps) {
  const labels = {
    ...subscriptionRecoveryLabels,
    ...overrides,
    recovery: {
      ...subscriptionRecoveryLabels.recovery,
      ...overrides?.recovery,
    },
  }
  const s = subscription
  const recovery = s.recovery
  const confirming =
    isOperationUnresolved(operation) ||
    isOperationUnresolved(recovery?.operation)
  const canRetry = !!onRetryNow && !!recovery?.retryable && !confirming
  const failed = s.payments?.find((p) => p.status === "failed")
  return (
    <section
      className={cx("orb-recovery", className)}
      data-subscription-id={s.id}
      data-status={s.status}
      data-retryable={String(recovery?.retryable ?? false)}
      data-blocked-reason={recovery?.blocked_reason ?? ""}
      data-operation-status={(operation ?? recovery?.operation)?.status ?? ""}
    >
      <h3 className="orb-recovery__title">{labels.title}</h3>
      {failed || s.grace_ends_at ? (
        <dl className="orb-recovery__subscription">
          {failed ? (
            <>
              <dt>{labels.lastPayment}</dt>
              <dd className="orb-money" data-payment-status={failed.status}>
                {money.format(failed.amount, failed.currency)}
              </dd>
            </>
          ) : null}
          {s.grace_ends_at ? (
            <>
              <dt>{labels.graceEnds}</dt>
              <dd>{formatDate(s.grace_ends_at)}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <RecoveryFacts
        recovery={recovery}
        operation={operation}
        error={error}
        labels={labels.recovery}
        formatDate={formatDate}
      />
      {recovery?.next_attempt_at && !confirming ? (
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
        {canRetry ? (
          <button
            type="button"
            className="orb-button orb-button--primary"
            disabled={busy}
            aria-busy={busy}
            onClick={() => onRetryNow?.(s)}
          >
            {labels.retryNow}
          </button>
        ) : null}
      </div>
    </section>
  )
}
