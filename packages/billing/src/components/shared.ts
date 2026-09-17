// Neutral views: semantic markup, stable `orb-*` class hooks and
// `data-*` state attributes, no stylesheet, English defaults every host
// replaces through `labels`. Every figure comes from the server DTO; nothing
// here decides eligibility.
import type { Amount, FormatMoneyOptions } from "../core/money"
import type { CheckoutSession } from "../core/schemas"

export interface MoneyFormatter {
  format(
    amount: Amount | null | undefined,
    currency: string | undefined,
    options?: FormatMoneyOptions
  ): string
}

export type DateFormatter = (iso: string | null | undefined) => string

export function defaultFormatDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  return at.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}

export function cardLabel(
  brand: string | null | undefined,
  last4: string | null | undefined,
  fallback: string
): string {
  const name = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : ""
  if (name && last4) return `${name} •••• ${last4}`
  if (last4) return `•••• ${last4}`
  return name || fallback
}

export function expiryLabel(
  month: number | null | undefined,
  year: number | null | undefined
): string {
  if (!month || !year) return ""
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`
}

// The provider hop a requires_action session asks for, if any.
export function checkoutRedirectURL(session: CheckoutSession): string | null {
  return (
    session.next_action?.redirect_to_url?.url ||
    session.payment.redirect_url ||
    session.url ||
    null
  )
}
