import type { Invoice } from "../core/schemas"
import { invoiceListLabels, type InvoiceListLabels } from "./labels"
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
  labels?: Partial<InvoiceListLabels>
  className?: string
  onSelect?: (invoice: Invoice) => void
  // #809 pay-now. The host passes canPayNow from the server's retryability
  // flag; the view never decides eligibility itself.
  onPayNow?: (invoice: Invoice) => void
  canPayNow?: (invoice: Invoice) => boolean
  busyInvoiceId?: string | null
}

export function InvoiceList({
  invoices,
  money,
  formatDate = defaultFormatDate,
  labels: overrides,
  className,
  onSelect,
  onPayNow,
  canPayNow,
  busyInvoiceId,
}: InvoiceListProps) {
  const labels = { ...invoiceListLabels, ...overrides }
  if (invoices.length === 0)
    return (
      <p className={cx("orb-invoices orb-invoices--empty", className)}>
        {labels.empty}
      </p>
    )
  return (
    <ul className={cx("orb-invoices", className)}>
      {invoices.map((invoice) => {
        const payable = !!onPayNow && (canPayNow?.(invoice) ?? false)
        const busy = busyInvoiceId === invoice.id
        return (
          <li
            key={invoice.id}
            className="orb-invoice"
            data-status={invoice.status}
            data-invoice-id={invoice.id}
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
              {invoice.next_collection_attempt_at ? (
                <>
                  <dt>{labels.nextAttempt}</dt>
                  <dd>{formatDate(invoice.next_collection_attempt_at)}</dd>
                </>
              ) : null}
              {invoice.collection_failure_count > 0 ? (
                <>
                  <dt>{labels.failedAttempts}</dt>
                  <dd
                    data-failure-code={
                      invoice.last_collection_failure_code ?? ""
                    }
                  >
                    {invoice.collection_failure_count}
                  </dd>
                </>
              ) : null}
            </dl>
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
