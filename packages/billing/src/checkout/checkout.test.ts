import { describe, expect, it } from "vitest"

import * as checkout from "./index"

// The subpath re-exports the hosted checkout package unchanged until the
// direct /v1/me/checkout flow is qualified and the component moves in here.
describe("@openrails/billing/checkout", () => {
  it("re-exports the openrails-checkout surface", () => {
    expect(typeof checkout.Checkout).toBe("function")
    expect(typeof checkout.CheckoutModal).toBe("function")
    expect(typeof checkout.createHttpSource).toBe("function")
    expect(typeof checkout.formatAmount).toBe("function")
    expect(checkout.checkoutSessionSchema).toBeDefined()
  })
})
