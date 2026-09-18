import type { PaymentMethod } from "../core/schemas"
import { savedMethodsLabels, type SavedMethodsLabels } from "./labels"
import { cardLabel, cx, expiryLabel } from "./shared"

export interface SavedMethodsProps {
  methods: PaymentMethod[]
  labels?: Partial<SavedMethodsLabels>
  className?: string
  // Controlled selection (a checkout or payment-method picker).
  selectedId?: string | null
  onSelect?: (method: PaymentMethod) => void
  onRemove?: (method: PaymentMethod) => void
  // Invoice collection default for one billing currency
  // (PUT /v1/me/collection-payment-method).
  onMakeCollectionDefault?: (method: PaymentMethod, currency: string) => void
  collectionCurrency?: string
  busyMethodId?: string | null
}

export function SavedMethods({
  methods,
  labels: overrides,
  className,
  selectedId,
  onSelect,
  onRemove,
  onMakeCollectionDefault,
  collectionCurrency,
  busyMethodId,
}: SavedMethodsProps) {
  const labels = { ...savedMethodsLabels, ...overrides }
  if (methods.length === 0)
    return (
      <p className={cx("orb-methods orb-methods--empty", className)}>
        {labels.empty}
      </p>
    )
  const currency = collectionCurrency?.toUpperCase()
  return (
    <ul
      className={cx("orb-methods", className)}
      role={onSelect ? "listbox" : undefined}
    >
      {methods.map((method) => {
        const selected = selectedId === method.id
        const busy = busyMethodId === method.id
        const health = method.health
        const collects = method.collection_default_currencies ?? []
        const isDefault = !!currency && collects.includes(currency)
        return (
          <li
            key={method.id}
            className={cx("orb-method", selected && "orb-method--selected")}
            data-method-id={method.id}
            data-rail={method.rail}
            data-expiry-status={health?.expiry_status ?? ""}
            data-active={health ? String(health.active) : ""}
            role={onSelect ? "option" : undefined}
            aria-selected={onSelect ? selected : undefined}
          >
            {onSelect ? (
              <button
                type="button"
                className="orb-method__select"
                aria-pressed={selected}
                onClick={() => onSelect(method)}
              >
                {cardLabel(method.card?.brand, method.card?.last4, labels.card)}
              </button>
            ) : (
              <span className="orb-method__name">
                {cardLabel(method.card?.brand, method.card?.last4, labels.card)}
              </span>
            )}
            {method.card?.exp_month && method.card.exp_year ? (
              <span className="orb-method__expiry">
                {labels.expires}{" "}
                {expiryLabel(method.card.exp_month, method.card.exp_year)}
              </span>
            ) : null}
            {health?.expiry_status === "expired" ? (
              <span className="orb-method__flag" data-flag="expired">
                {labels.expired}
              </span>
            ) : health?.expiry_status === "expiring_soon" ? (
              <span className="orb-method__flag" data-flag="expiring_soon">
                {labels.expiringSoon}
              </span>
            ) : health && !health.active ? (
              <span className="orb-method__flag" data-flag="inactive">
                {labels.inactive}
              </span>
            ) : null}
            {collects.length > 0 ? (
              <span className="orb-method__collects">
                {labels.collectsFor} {collects.join(", ")}
              </span>
            ) : null}
            {method.subscriptions && method.subscriptions.length > 0 ? (
              <span className="orb-method__used-by">
                {labels.usedBy}{" "}
                {method.subscriptions.map((s) => s.display_name).join(", ")}
              </span>
            ) : null}
            {selected ? (
              <span className="orb-method__selected">{labels.selected}</span>
            ) : null}
            <div className="orb-method__actions">
              {onMakeCollectionDefault && currency && !isDefault ? (
                <button
                  type="button"
                  className="orb-button orb-button--secondary"
                  disabled={busy}
                  onClick={() => onMakeCollectionDefault(method, currency)}
                >
                  {labels.makeDefault}
                </button>
              ) : null}
              {onRemove ? (
                <button
                  type="button"
                  className="orb-button orb-button--danger"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => onRemove(method)}
                >
                  {labels.remove}
                </button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
