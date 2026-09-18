import { isOperationUnresolved, type PaymentOperation } from "../core/recovery"
import type { Invoice } from "../core/schemas"
import {
  invoiceListLabels,
  type InvoiceListLabels,
  type RecoveryLabels,
} from "./labels"
import { RecoveryFacts } from "./recovery-facts"
import {
  cx,
  defaultFormatDate,
  type DateFormatter,
  type MoneyFormatter,
} from "./shared"

export interface InvoiceListProps {
  invoices: Invoice[]
  money: MoneyFormatter
  formatDate?: DateFormatter
  labels?: Partial<Omit<InvoiceListLabels, "recovery">> & {
    recovery?: Partial<RecoveryLabels>
  }
  className?: string
  onSelect?: (invoice: Invoice) => void
  // #809 pay-now. The control renders only when the server reports
  // `recovery.retryable` and no operation is unresolved; the host picks the
  // method from `recovery.compatible_payment_method_ids`.
  onPayNow?: (invoice: Invoice) => void
  // The invoice the host is acting on, with its 202 operation and the last
  // BillingError (402 decline / 409 refusal) for that invoice.
  active?: {
    invoiceId: string
    busy?: boolean
    operation?: PaymentOperation | null
    error?: unknown
  } | null
}

export function InvoiceList({
  invoices,
  money,
  formatDate = defaultFormatDate,
  labels: overrides,
  className,
  onSelect,
  onPayNow,
  active,
}: InvoiceListProps) {
  const labels = {
    ...invoiceListLabels,
    ...overrides,
    recovery: { ...invoiceListLabels.recovery, ...overrides?.recovery },
  }
  if (invoices.length === 0)
    return (
      <p className={cx("orb-invoices orb-invoices--empty", className)}>
        {labels.empty}
      </p>
    )
  return (
    <ul className={cx("orb-invoices", className)}>
      {invoices.map((invoice) => {
        const recovery = invoice.recovery
        const mine = active?.invoiceId === invoice.id ? active : null
        const confirming =
          isOperationUnresolved(mine?.operation) ||
          isOperationUnresolved(recovery?.operation)
        const payable = !!onPayNow && !!recovery?.retryable && !confirming
        const busy = !!mine?.busy
        return (
          <li
            key={invoice.id}
            className="orb-invoice"
            data-status={invoice.status}
            data-invoice-id={invoice.id}
            data-retryable={String(recovery?.retryable ?? false)}
            data-blocked-reason={recovery?.blocked_reason ?? ""}
          >
            <div className="orb-invoice__header">
              <span className="orb-invoice__number">
                {labels.number}{" "}
                {invoice.invoice_number ?? invoice.id.slice(0, 8)}
              </span>
              <span
                className="orb-invoice__status"
                data-status={invoice.status}
              >
                {labels.status[invoice.status] ?? invoice.status}
              </span>
            </div>
            <dl className="orb-invoice__facts">
              <dt>{labels.period}</dt>
              <dd>
                {formatDate(invoice.period_from)} –{" "}
                {formatDate(invoice.period_to)}
              </dd>
              <dt>{labels.total}</dt>
              <dd className="orb-money">
                {money.format(invoice.total_amount, invoice.currency)}
              </dd>
              <dt>{labels.amountDue}</dt>
              <dd className="orb-money">
                {money.format(invoice.amount_due, invoice.currency)}
              </dd>
              {invoice.due_at ? (
                <>
                  <dt>{labels.due}</dt>
                  <dd>{formatDate(invoice.due_at)}</dd>
                </>
              ) : null}
            </dl>
            <RecoveryFacts
              recovery={recovery}
              operation={mine?.operation}
              error={mine?.error}
              labels={labels.recovery}
              formatDate={formatDate}
            />
            <div className="orb-invoice__actions">
              {onSelect ? (
                <button
                  type="button"
                  className="orb-button orb-button--secondary"
                  onClick={() => onSelect(invoice)}
                >
                  {labels.view}
                </button>
              ) : null}
              {payable ? (
                <button
                  type="button"
                  className="orb-button orb-button--primary"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => onPayNow?.(invoice)}
                >
                  {labels.payNow}
                </button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
