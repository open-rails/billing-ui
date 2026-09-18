// Typed resource identifiers (openrails ids.go). OpenRails-minted resources
// travel as prefixed text and host-owned identities as the plain UUID; only
// that spelling is accepted. A bare UUID where a prefixed id belongs is a
// decoding error here and `invalid_param` on the server.
import { z } from "zod"

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

export const ID_PREFIX = {
  product: "prod_",
  price: "price_",
  subscription: "sub_",
  payment: "pay_",
  paymentMethod: "pm_",
  checkoutSession: "cs_",
} as const

function prefixed<P extends string>(prefix: P, kind: string) {
  const pattern = new RegExp(`^${prefix}${UUID}$`, "i")
  return z
    .string()
    .refine(
      (value) => pattern.test(value),
      `${kind} id must be ${prefix}<uuid>`
    ) as unknown as z.ZodType<`${P}${string}`>
}

export const customerIdSchema = z
  .string()
  .regex(new RegExp(`^${UUID}$`, "i"), "customer id must be a UUID")
export const productIdSchema = prefixed(ID_PREFIX.product, "product")
export const priceIdSchema = prefixed(ID_PREFIX.price, "price")
export const subscriptionIdSchema = prefixed(
  ID_PREFIX.subscription,
  "subscription"
)
export const paymentIdSchema = prefixed(ID_PREFIX.payment, "payment")
export const paymentMethodIdSchema = prefixed(
  ID_PREFIX.paymentMethod,
  "payment method"
)
export const checkoutSessionIdSchema = prefixed(
  ID_PREFIX.checkoutSession,
  "checkout session"
)
export const uuidSchema = z.string().regex(new RegExp(`^${UUID}$`, "i"))

export type CustomerID = z.infer<typeof customerIdSchema>
export type ProductID = z.infer<typeof productIdSchema>
export type PriceID = z.infer<typeof priceIdSchema>
export type SubscriptionID = z.infer<typeof subscriptionIdSchema>
export type PaymentID = z.infer<typeof paymentIdSchema>
export type PaymentMethodID = z.infer<typeof paymentMethodIdSchema>
export type CheckoutSessionID = z.infer<typeof checkoutSessionIdSchema>

export const isSubscriptionId = (value: string): value is SubscriptionID =>
  subscriptionIdSchema.safeParse(value).success
export const isPaymentMethodId = (value: string): value is PaymentMethodID =>
  paymentMethodIdSchema.safeParse(value).success
export const isPriceId = (value: string): value is PriceID =>
  priceIdSchema.safeParse(value).success
export const isCheckoutSessionId = (
  value: string
): value is CheckoutSessionID =>
  checkoutSessionIdSchema.safeParse(value).success
