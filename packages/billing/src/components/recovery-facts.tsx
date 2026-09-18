import { BillingError } from "../core/errors"
import {
  isOperationUnresolved,
  recoveryDeclineOf,
  type PaymentOperation,
  type PaymentRecovery,
} from "../core/recovery"
import type { RecoveryLabels } from "./labels"
import type { DateFormatter } from "./shared"

// RecoveryFacts renders OpenRails' recovery block and the outcome of the last
// pay-now / retry-now: the server's flags and codes mapped to labels, nothing
// derived.
export function RecoveryFacts({
  recovery,
  operation,
  error,
  labels,
  formatDate,
}: {
  recovery: PaymentRecovery | null | undefined
  // The operation a 202 returned, until the resource stops reporting it.
  operation?: PaymentOperation | null
  // The BillingError the last action raised, if any.
  error?: unknown
  labels: RecoveryLabels
  formatDate: DateFormatter
}) {
  const confirming =
    isOperationUnresolved(operation) ||
    isOperationUnresolved(recovery?.operation)
  const decline = recoveryDeclineOf(error)
  const refusal =
    !decline &&
    error instanceof BillingError &&
    (error.status === 409 || error.status === 400)
      ? (labels.refused[error.code] ?? labels.refusedFallback)
      : null
  const category = decline?.decline_reason ?? recovery?.failure_category
  const blocked =
    recovery && !recovery.retryable && recovery.blocked_reason && !confirming
      ? (labels.blocked[recovery.blocked_reason] ?? null)
      : null
  return (
    <>
      {recovery ? (
        <dl className="orb-recovery__facts">
          {recovery.attempt_count > 0 ? (
            <>
              <dt>{labels.attempts}</dt>
              <dd>{recovery.attempt_count}</dd>
            </>
          ) : null}
          {recovery.failure_category ? (
            <>
              <dt>{labels.lastFailure}</dt>
              <dd
                data-failure-category={recovery.failure_category}
                data-failure-code={recovery.last_failure_code ?? ""}
              >
                {labels.failureCategory[recovery.failure_category] ??
                  recovery.failure_category}
              </dd>
            </>
          ) : null}
          {recovery.last_failed_at ? (
            <>
              <dt>{labels.lastFailedAt}</dt>
              <dd>{formatDate(recovery.last_failed_at)}</dd>
            </>
          ) : null}
          {recovery.next_attempt_at ? (
            <>
              <dt>{labels.nextAttempt}</dt>
              <dd>{formatDate(recovery.next_attempt_at)}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {confirming ? (
        <p
          className="orb-recovery__notice"
          data-notice="confirming"
          role="status"
        >
          {labels.confirming}
        </p>
      ) : blocked ? (
        <p
          className="orb-recovery__notice"
          data-notice="blocked"
          data-blocked-reason={recovery?.blocked_reason}
        >
          {blocked}
        </p>
      ) : null}
      {decline ? (
        <p
          className="orb-recovery__outcome"
          data-outcome="declined"
          data-decline-reason={decline.decline_reason}
          role="alert"
        >
          {labels.declined}
          {category
            ? ` ${labels.failureCategory[category] ?? ""}`.trimEnd()
            : ""}
        </p>
      ) : refusal ? (
        <p
          className="orb-recovery__outcome"
          data-outcome="refused"
          data-code={(error as BillingError).code}
          role="alert"
        >
          {refusal}
        </p>
      ) : null}
    </>
  )
}
