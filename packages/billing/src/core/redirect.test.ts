import { describe, expect, it } from "vitest"

import { safeRedirectURL } from "./redirect"

const policy = {
  allowedOrigins: ["https://bill.ccbill.com", "https://pay.example:8443"],
}

describe("safeRedirectURL", () => {
  it("allows only https URLs on a configured origin", () => {
    expect(safeRedirectURL("https://bill.ccbill.com/jpost?x=1", policy)).toBe(
      "https://bill.ccbill.com/jpost?x=1"
    )
    expect(safeRedirectURL("https://pay.example:8443/3ds", policy)).toBe(
      "https://pay.example:8443/3ds"
    )
  })

  it("refuses executable, insecure, relative, credentialed and unknown targets", () => {
    for (const url of [
      "javascript:window.__billing_pwned=true",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://bill.ccbill.com/jpost",
      "//bill.ccbill.com/jpost",
      "/checkout/next",
      "https://user:pass@bill.ccbill.com/",
      "https://bill.ccbill.com.evil.example/",
      "https://evil.example/",
      "https://pay.example/3ds",
      "",
      null,
      undefined,
    ])
      expect(safeRedirectURL(url, policy), String(url)).toBeNull()
  })

  it("ignores non-https entries in the allowlist", () => {
    expect(
      safeRedirectURL("https://a.example/", {
        allowedOrigins: ["http://a.example", "javascript:x"],
      })
    ).toBeNull()
    expect(
      safeRedirectURL("https://a.example/", { allowedOrigins: [] })
    ).toBeNull()
  })
})
