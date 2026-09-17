// @openrails/billing — a thin direct-browser client for OpenRails' /v1/me
// surface. Hosts own AuthKit tokens, routing, copy and support; OpenRails
// owns billing policy and state; this package owns transport, DTO
// validation, exact money, query/cache state, idempotency and neutral views.
export * from "./core"
export * from "./transport"
export * from "./client"
export * from "./react"
export * from "./components"
