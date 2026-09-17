import { describe, expect, it, vi } from "vitest"

import currencies from "../test/fixtures/wire/currencies.json"
import {
  addAmounts,
  amountFromInput,
  amountToDecimal,
  amountUnits,
  compareAmounts,
  formatMoney,
  formatUnits,
  intlFormatsDecimalStringsExactly,
  isAmount,
  parseCurrencyRegistry,
} from "./money"

const maxInt64 = "9223372036854775807"
const minInt64 = "-9223372036854775808"
const registry = parseCurrencyRegistry(currencies)

describe("amounts", () => {
  it("accept exactly the int64 decimal strings", () => {
    for (const value of ["0", "-1", "99000000", maxInt64, minInt64])
      expect(isAmount(value), value).toBe(true)
    for (const value of [
      99_000_000,
      "9223372036854775808",
      "-9223372036854775809",
      "1.5",
      "1e6",
      "",
      " 1",
      "+1",
      null,
    ])
      expect(isAmount(value), String(value)).toBe(false)
    expect(amountUnits(maxInt64)).toBe((1n << 63n) - 1n)
  })

  it("sum and compare without a JS number", () => {
    expect(addAmounts("9007199254740993", "1")).toBe("9007199254740994")
    expect(addAmounts(maxInt64, "1")).toBeNull()
    expect(compareAmounts("9007199254740993", "9007199254740992")).toBe(1)
    expect(compareAmounts("-1", "0")).toBe(-1)
    expect(compareAmounts("x", "0")).toBeNull()
  })

  it("render the exact major-unit decimal at the currency scale", () => {
    expect(amountToDecimal("99000000", 6)).toBe("99")
    expect(amountToDecimal("1234567", 6)).toBe("1.234567")
    expect(amountToDecimal("12345", 4)).toBe("1.2345")
    expect(amountToDecimal(maxInt64, 6)).toBe("9223372036854.775807")
    expect(amountToDecimal("1", 19)).toBeNull()
  })

  it("parse typed major-unit input without rounding", () => {
    expect(amountFromInput("12.50", 6)).toBe("12500000")
    expect(amountFromInput("1234", 4)).toBe("12340000")
    expect(amountFromInput("0.0000001", 6)).toBeNull()
    expect(amountFromInput("9223372036854.775808", 6)).toBeNull()
    expect(amountFromInput("abc", 6)).toBeNull()
  })
})

describe("formatMoney", () => {
  it("formats at the registry scale, never through Number", () => {
    expect(formatMoney("99000000", "USD", registry)).toBe("$99.00")
    expect(formatMoney("1234567", "usd", registry)).toBe("$1.234567")
    expect(formatMoney("12340000", "JPY", registry)).toBe("¥1,234")
    expect(formatMoney("12345", "JPY", registry)).toBe("¥1.2345")
    expect(formatMoney(maxInt64, "USD", registry)).toBe(
      "$9,223,372,036,854.775807"
    )
    expect(formatMoney(minInt64, "EUR", registry)).toBe(
      "-€9,223,372,036,854.775808"
    )
  })

  it("refuses an unregistered currency and an amount it cannot show exactly", () => {
    expect(formatMoney("100", "XYZ", registry)).toBe(
      "XYZ amount in unregistered currency"
    )
    expect(formatMoney("100", "USD", undefined)).toBe(
      "USD amount in unregistered currency"
    )
    expect(formatMoney("9223372036854775808", "USD", registry)).toBe(
      "USD amount exceeds the exact display range"
    )
    expect(formatMoney(null, "USD", registry)).toBe(
      "USD amount exceeds the exact display range"
    )
  })

  it("falls back to a plain decimal for a code Intl rejects", () => {
    expect(formatUnits("2500000", "USDC", 6)).toBe("2.5 USDC")
  })

  it("honours locale and currencyDisplay options", () => {
    expect(
      formatMoney("99000000", "USD", registry, {
        locale: "en",
        currencyDisplay: "code",
      })
    ).toMatch(/USD\s99\.00/)
  })

  it("probes the engine's decimal-string support once", () => {
    expect(intlFormatsDecimalStringsExactly).toBe(true)
  })
})

describe("formatMoney on an engine that coerces decimal strings", () => {
  it("still renders every amount below 10^15 units and refuses above", async () => {
    vi.resetModules()
    const Original = Intl.NumberFormat
    class Coercing extends Original {
      format(value: unknown): string {
        return super.format(Number(value))
      }
    }
    vi.stubGlobal("Intl", { ...Intl, NumberFormat: Coercing })
    const legacy = await import("./money")
    const reg = legacy.parseCurrencyRegistry(currencies)
    expect(legacy.intlFormatsDecimalStringsExactly).toBe(false)
    expect(legacy.formatMoney("99000000", "USD", reg)).toBe("$99.00")
    expect(legacy.formatMoney("999999999999999", "USD", reg)).toBe(
      "$999,999,999.999999"
    )
    expect(legacy.formatMoney("1000000000000000", "USD", reg)).toBe(
      "USD amount exceeds this browser's exact display range"
    )
  })
})
