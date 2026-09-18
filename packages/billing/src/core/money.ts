// Exact money. Every monetary value OpenRails serves is a signed int64 decimal
// string of the currency's native unit; the scale (10^decimals per major unit)
// comes from the public currency registry, GET /v1/currencies, never from an
// assumption. Nothing here converts an amount to a JS number: values are
// scaled with BigInt and only the exact major-unit decimal reaches Intl.
import { z } from "zod"

// Amount is an int64 decimal string, e.g. "99000000" (99 USD at 6 decimals).
export type Amount = string

const INT64_MIN = -(1n << 63n)
const INT64_MAX = (1n << 63n) - 1n
export const MAX_UNIT_DECIMALS = 18

// amountUnits parses an exact int64 decimal string, or null.
export function amountUnits(amount: unknown): bigint | null {
  if (typeof amount !== "string" || !/^-?\d{1,19}$/.test(amount)) return null
  const value = BigInt(amount)
  return value < INT64_MIN || value > INT64_MAX ? null : value
}

export function isAmount(value: unknown): value is Amount {
  return amountUnits(value) !== null
}

export function isUnitDecimals(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_UNIT_DECIMALS
  )
}

export const amountSchema = z
  .string()
  .refine(isAmount, "amount must be an int64 decimal string")

export const unitDecimalsSchema = z
  .number()
  .refine(
    isUnitDecimals,
    `decimals must be an integer from 0 to ${MAX_UNIT_DECIMALS}`
  )

// addAmounts sums exact amounts; null when an input or the sum leaves int64.
export function addAmounts(...amounts: Amount[]): Amount | null {
  let total = 0n
  for (const amount of amounts) {
    const units = amountUnits(amount)
    if (units === null) return null
    total += units
  }
  return total < INT64_MIN || total > INT64_MAX ? null : total.toString()
}

// compareAmounts orders two exact amounts (-1, 0, 1); null when either is
// not an int64 decimal string.
export function compareAmounts(a: Amount, b: Amount): -1 | 0 | 1 | null {
  const left = amountUnits(a)
  const right = amountUnits(b)
  if (left === null || right === null) return null
  return left < right ? -1 : left > right ? 1 : 0
}

export function isZeroAmount(amount: Amount): boolean {
  return amountUnits(amount) === 0n
}

export function isNegativeAmount(amount: Amount): boolean {
  const units = amountUnits(amount)
  return units !== null && units < 0n
}

// Intl.NumberFormat formats a decimal string exactly only since ECMA-402 2023
// (Chrome/Edge 106, Firefox 116, Safari 15.4); older engines coerce it through
// Number. Probed once with 2^53 + 1, which a Number cannot hold.
export const intlFormatsDecimalStringsExactly: boolean = (() => {
  try {
    return (
      new Intl.NumberFormat("en", { useGrouping: false }).format(
        "9007199254740993" as `${number}`
      ) === "9007199254740993"
    )
  } catch {
    return false
  }
})()

// Below 10^15 native units a Number-coerced decimal still rounds back to the
// exact digits at every registry scale; from 10^15 the coerced value can differ
// in the last digit, so a legacy engine refuses instead of misformatting.
const LEGACY_EXACT_UNITS = 10n ** 15n

function decimalFromUnits(value: bigint, decimals: number): string {
  const absolute = value < 0n ? -value : value
  const scale = 10n ** BigInt(decimals)
  const fraction = (absolute % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
  return `${value < 0n ? "-" : ""}${absolute / scale}${fraction ? `.${fraction}` : ""}`
}

// amountToDecimal renders native units as the exact major-unit decimal with
// trailing zeros trimmed ("99000000" at 6 -> "99", "1234567" -> "1.234567"),
// or null when the amount or scale is invalid.
export function amountToDecimal(
  amount: Amount,
  decimals: number
): string | null {
  const units = amountUnits(amount)
  if (units === null || !isUnitDecimals(decimals)) return null
  return decimalFromUnits(units, decimals)
}

// amountFromInput converts a major-unit decimal a person typed ("12.50") to
// the exact native-unit wire string at the given scale; null when the input
// is not a decimal, carries more fraction digits than the scale, or leaves
// int64. Never rounds.
export function amountFromInput(
  major: string,
  decimals: number
): Amount | null {
  if (!isUnitDecimals(decimals)) return null
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(major.trim())
  if (!match || (!match[2] && !match[3]) || (match[3]?.length ?? 0) > decimals)
    return null
  const value =
    BigInt(match[2] || "0") * 10n ** BigInt(decimals) +
    BigInt((match[3] || "").padEnd(decimals, "0") || "0")
  const signed = match[1] === "-" ? -value : value
  if (signed < INT64_MIN || signed > INT64_MAX) return null
  return signed.toString()
}

// The currency registry: GET /v1/currencies. Every monetary string on the
// wire is in native units (10^decimals per major unit); providers settle in
// 10^minor_decimals. System-fixed and merchant-independent.
export const currencyUnitsSchema = z.object({
  code: z.string().min(1),
  decimals: unitDecimalsSchema,
  minor_decimals: unitDecimalsSchema,
})
export type CurrencyUnits = z.infer<typeof currencyUnitsSchema>

export const currencyRegistryDocumentSchema = z.object({
  object: z.literal("currencies"),
  currencies: z.array(currencyUnitsSchema),
})
export type CurrencyRegistryDocument = z.infer<
  typeof currencyRegistryDocumentSchema
>

export type CurrencyRegistry = ReadonlyMap<string, CurrencyUnits>

// parseCurrencyRegistry validates the registry document and indexes it by
// uppercase code. It throws on an unexpected shape rather than formatting by
// guesswork.
export function parseCurrencyRegistry(document: unknown): CurrencyRegistry {
  const parsed = currencyRegistryDocumentSchema.parse(document)
  return new Map(
    parsed.currencies.map((units) => [
      units.code.trim().toUpperCase(),
      { ...units, code: units.code.trim().toUpperCase() },
    ])
  )
}

export function lookupCurrency(
  registry: CurrencyRegistry | undefined,
  currency: string | undefined
): CurrencyUnits | undefined {
  if (!registry || !currency) return undefined
  return registry.get(currency.trim().toUpperCase())
}

export interface FormatMoneyOptions {
  // BCP 47 locale for Intl; the browser default when omitted.
  locale?: string
  // "code" renders "USD 99.00" style through Intl's currencyDisplay.
  currencyDisplay?: "symbol" | "narrowSymbol" | "code" | "name"
  // Show at least this many fraction digits (default: Intl's for the currency).
  minimumFractionDigits?: number
}

// formatUnits renders an exact amount at an explicit scale. It never passes
// money through a JS number; an amount it cannot show exactly is refused with
// a visible notice rather than a rounded figure.
export function formatUnits(
  amount: Amount | null | undefined,
  currency: string,
  decimals: number,
  options: FormatMoneyOptions = {}
): string {
  const code = currency.trim().toUpperCase()
  const units = amountUnits(amount)
  if (units === null || !isUnitDecimals(decimals))
    return `${code} amount exceeds the exact display range`
  if (
    !intlFormatsDecimalStringsExactly &&
    (units >= LEGACY_EXACT_UNITS || units <= -LEGACY_EXACT_UNITS)
  )
    return `${code} amount exceeds this browser's exact display range`
  const decimal = decimalFromUnits(units, decimals) as `${number}`
  const fraction: Intl.NumberFormatOptions = {
    maximumFractionDigits: decimals,
  }
  if (options.minimumFractionDigits !== undefined)
    fraction.minimumFractionDigits = Math.min(
      options.minimumFractionDigits,
      decimals
    )
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat(options.locale, {
        style: "currency",
        currency: code,
        currencyDisplay: options.currencyDisplay,
        ...fraction,
      }).format(decimal)
    } catch {
      // not an Intl currency: fall through to the plain form
    }
  }
  const number = new Intl.NumberFormat(options.locale, fraction).format(decimal)
  return `${number} ${code}`
}

// formatMoney renders an exact amount at its currency's registered scale.
// A currency the registry does not carry is refused, never guessed.
export function formatMoney(
  amount: Amount | null | undefined,
  currency: string | undefined,
  registry: CurrencyRegistry | undefined,
  options?: FormatMoneyOptions
): string {
  const units = lookupCurrency(registry, currency)
  if (!units) {
    const code = currency?.trim().toUpperCase() || "(none)"
    return `${code} amount in unregistered currency`
  }
  return formatUnits(amount, units.code, units.decimals, options)
}
