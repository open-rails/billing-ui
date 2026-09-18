import { describe, expect, it, vi } from "vitest"

import { BillingError } from "../core/errors"
import {
  NetworkFailure,
  errorEnvelope,
  fixtureServer,
  json,
} from "../test/server"
import { bearerAuth, cookieAuth, dpopAuth, type AuthProvider } from "./auth"
import {
  createDPoPKeyPair,
  decodeDPoPProof,
  dpopProofURL,
  dpopThumbprint,
} from "./dpop"
import { createTransport, normalizeBaseUrl, parseRetryAfter } from "./request"

const base = "https://billing.example"

function transportWith(
  server: ReturnType<typeof fixtureServer>,
  auth: AuthProvider = bearerAuth("tok_1"),
  extra: Partial<Parameters<typeof createTransport>[0]> = {}
) {
  const sleeps: number[] = []
  const transport = createTransport({
    baseUrl: base,
    auth,
    fetch: server.fetch,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    ...extra,
  })
  return { transport, sleeps }
}

describe("normalizeBaseUrl", () => {
  it("keeps origin + mount path and refuses unsafe bases", () => {
    expect(normalizeBaseUrl("https://site.example/api/openrails/")).toBe(
      "https://site.example/api/openrails"
    )
    expect(normalizeBaseUrl("http://127.0.0.1:8080")).toBe(
      "http://127.0.0.1:8080"
    )
    expect(() => normalizeBaseUrl("http://site.example")).toThrow(/https/)
    expect(() => normalizeBaseUrl("/api/openrails")).toThrow(/absolute/)
    expect(() => normalizeBaseUrl("https://u:p@site.example")).toThrow(
      /credentials/
    )
  })
})

describe("request headers", () => {
  it("sends Accept, Bearer and credentials: omit by default", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/me/status", () => json({ ok: true }))
    const { transport } = transportWith(server)
    const response = await transport.request({
      method: "GET",
      path: "/v1/me/status",
    })
    expect(response.status).toBe(200)
    const sent = server.requests[0]
    expect(sent.headers.get("Authorization")).toBe("Bearer tok_1")
    expect(sent.headers.get("Accept")).toBe("application/json")
    expect(sent.headers.get("Idempotency-Key")).toBeNull()
    expect(sent.credentials).toBe("omit")
  })

  it("sends exactly one canonical Idempotency-Key on every mutation and keeps a host key", async () => {
    const server = fixtureServer()
    server.route("POST", "/v1/me/subscriptions/sub_1/cancel", () =>
      json({ status: "queued" }, 202)
    )
    const { transport } = transportWith(server, bearerAuth("tok_1"), {
      idempotencyKey: () => "idem_generated",
    })
    const response = await transport.request({
      method: "POST",
      path: "/v1/me/subscriptions/sub_1/cancel",
      body: { feedback: "too pricey" },
    })
    expect(response.status).toBe(202)
    expect(response.idempotencyKey).toBe("idem_generated")
    expect(server.requests[0].headers.get("Idempotency-Key")).toBe(
      "idem_generated"
    )
    expect(server.requests[0].headers.get("Content-Type")).toBe(
      "application/json"
    )
    expect(server.requests[0].body).toEqual({ feedback: "too pricey" })

    await transport.request({
      method: "POST",
      path: "/v1/me/subscriptions/sub_1/cancel",
      body: {},
      idempotencyKey: "idem_host",
    })
    expect(server.requests[1].headers.get("Idempotency-Key")).toBe("idem_host")
  })

  it("adds host headers and encodes query parameters", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/me/payments", () => json({ object: "list" }))
    const { transport } = transportWith(server, bearerAuth("tok_1"), {
      headers: () => ({ "Accept-Language": "ja" }),
    })
    await transport.request({
      method: "GET",
      path: "/v1/me/payments",
      query: { limit: 10, offset: undefined, type: "nmi" },
    })
    const sent = server.requests[0]
    expect(sent.headers.get("Accept-Language")).toBe("ja")
    expect(sent.url).toBe(`${base}/v1/me/payments?limit=10&type=nmi`)
  })

  it("cookie mode forces credentials: include and the host's CSRF headers", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/me/status", () => json({}))
    const { transport } = transportWith(
      server,
      cookieAuth(() => ({ "X-CSRF-Token": "csrf_1" }))
    )
    await transport.request({ method: "GET", path: "/v1/me/status" })
    expect(server.requests[0].credentials).toBe("include")
    expect(server.requests[0].headers.get("X-CSRF-Token")).toBe("csrf_1")
    expect(server.requests[0].headers.get("Authorization")).toBeNull()
  })
})

describe("DPoP", () => {
  it("signs a fresh ES256 proof per attempt whose htu is the final URL without query", async () => {
    const key = await createDPoPKeyPair()
    const server = fixtureServer()
    server.route("GET", "/v1/me/payments", () => json({}))
    const { transport } = transportWith(server, dpopAuth("tok_dpop", key))
    await transport.request({
      method: "GET",
      path: "/v1/me/payments",
      query: { limit: 5 },
    })
    await transport.request({
      method: "GET",
      path: "/v1/me/payments",
      query: { limit: 5 },
    })

    const [first, second] = server.requests
    expect(first.headers.get("Authorization")).toBe("DPoP tok_dpop")
    const proof = decodeDPoPProof(first.headers.get("DPoP")!)
    expect(proof.header).toEqual({
      typ: "dpop+jwt",
      alg: "ES256",
      jwk: expect.objectContaining({ kty: "EC", crv: "P-256" }),
    })
    expect(Object.keys(proof.header.jwk as object).sort()).toEqual([
      "crv",
      "kty",
      "x",
      "y",
    ])
    expect(proof.claims.htm).toBe("GET")
    expect(proof.claims.htu).toBe(`${base}/v1/me/payments`)
    expect(proof.claims.iat).toBeTypeOf("number")
    expect(proof.claims.ath).toBeTypeOf("string")
    expect((proof.claims.jti as string).length).toBeGreaterThanOrEqual(16)
    const again = decodeDPoPProof(second.headers.get("DPoP")!)
    expect(again.claims.jti).not.toBe(proof.claims.jti)

    // The thumbprint the delegated token must be bound to.
    const thumbprint = await dpopThumbprint(key)
    expect(thumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("derives htu from the resolved URL for mounted and default-port bases", () => {
    expect(
      dpopProofURL("https://site.example:443/api/openrails/v1/me/status?x=1#f")
    ).toBe("https://site.example/api/openrails/v1/me/status")
    expect(() => dpopProofURL("https://u:p@site.example/v1")).toThrow()
  })

  it("re-signs the proof for the replay after a 401 refresh", async () => {
    const key = await createDPoPKeyPair()
    const server = fixtureServer()
    server.route("POST", "/v1/me/subscriptions/sub_1/resume", (_req, n) =>
      n === 1
        ? errorEnvelope(401, "unauthorized")
        : json({ status: "queued" }, 202)
    )
    const auth: AuthProvider = {
      credential: () => ({ scheme: "DPoP", token: "stale", key }),
      refresh: vi.fn(async () => ({
        scheme: "DPoP" as const,
        token: "fresh",
        key,
      })),
    }
    const { transport } = transportWith(server, auth)
    const response = await transport.request({
      method: "POST",
      path: "/v1/me/subscriptions/sub_1/resume",
    })
    expect(response.status).toBe(202)
    expect(auth.refresh).toHaveBeenCalledTimes(1)
    const [first, second] = server.requests
    expect(first.headers.get("Authorization")).toBe("DPoP stale")
    expect(second.headers.get("Authorization")).toBe("DPoP fresh")
    expect(decodeDPoPProof(first.headers.get("DPoP")!).claims.ath).not.toBe(
      decodeDPoPProof(second.headers.get("DPoP")!).claims.ath
    )
    // The replay carries the same idempotency key: one operation identity.
    expect(first.headers.get("Idempotency-Key")).toBe(
      second.headers.get("Idempotency-Key")
    )
  })
})

describe("401 refresh", () => {
  it("replays once with the fresh credential and surfaces the 401 when refresh fails", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/me/status", (req) =>
      req.headers.get("Authorization") === "Bearer fresh"
        ? json({ ok: true })
        : errorEnvelope(401, "unauthorized")
    )
    const refresh = vi.fn(async () => ({
      scheme: "Bearer" as const,
      token: "fresh",
    }))
    const { transport } = transportWith(server, {
      credential: () => ({ scheme: "Bearer", token: "stale" }),
      refresh,
    })
    await expect(
      transport.request({ method: "GET", path: "/v1/me/status" })
    ).resolves.toMatchObject({ status: 200 })
    expect(refresh).toHaveBeenCalledWith({ scheme: "Bearer", token: "stale" })
    expect(server.requests).toHaveLength(2)

    server.reset()
    server.route("GET", "/v1/me/status", () =>
      errorEnvelope(401, "unauthorized")
    )
    const gone = {
      credential: () => ({ scheme: "Bearer" as const, token: "stale" }),
      refresh: vi.fn(async () => null),
    }
    const { transport: t2 } = transportWith(server, gone)
    const error = await t2
      .request({ method: "GET", path: "/v1/me/status" })
      .catch((e) => e)
    expect(error).toBeInstanceOf(BillingError)
    expect(error.isUnauthorized).toBe(true)
    expect(gone.refresh).toHaveBeenCalledTimes(1)
    expect(server.requests).toHaveLength(1)
  })

  it("refreshes at most once per request", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/me/status", () =>
      errorEnvelope(401, "unauthorized")
    )
    const refresh = vi.fn(async () => ({
      scheme: "Bearer" as const,
      token: "still-bad",
    }))
    const { transport } = transportWith(server, {
      credential: () => ({ scheme: "Bearer", token: "stale" }),
      refresh,
    })
    await expect(
      transport.request({ method: "GET", path: "/v1/me/status" })
    ).rejects.toMatchObject({ status: 401 })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(server.requests).toHaveLength(2)
  })
})

describe("retries", () => {
  it("retries a GET on network failure, 5xx and 429, honouring Retry-After", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/me/invoices", (_req, n) => {
      if (n === 1) throw new NetworkFailure()
      if (n === 2) return errorEnvelope(503, "service_unavailable")
      if (n === 3)
        return errorEnvelope(
          429,
          "rate_limit_exceeded",
          {},
          { "Retry-After": "2" }
        )
      return json({ invoices: [] })
    })
    const { transport, sleeps } = transportWith(server, bearerAuth("t"), {
      retry: { attempts: 4, baseDelayMs: 100, maxDelayMs: 5_000 },
    })
    const response = await transport.request({
      method: "GET",
      path: "/v1/me/invoices",
    })
    expect(response.status).toBe(200)
    expect(server.requests).toHaveLength(4)
    expect(sleeps).toHaveLength(3)
    expect(sleeps[0]).toBeGreaterThanOrEqual(100)
    expect(sleeps[0]).toBeLessThan(200)
    expect(sleeps[1]).toBeGreaterThanOrEqual(200)
    expect(sleeps[2]).toBe(2_000)
  })

  it("gives up after the configured attempts and surfaces the last error", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/me/invoices", () =>
      errorEnvelope(500, "internal_error")
    )
    const { transport } = transportWith(server, bearerAuth("t"), {
      retry: { attempts: 2 },
    })
    const error = await transport
      .request({ method: "GET", path: "/v1/me/invoices" })
      .catch((e) => e)
    expect(error).toBeInstanceOf(BillingError)
    expect(error.status).toBe(500)
    expect(server.requests).toHaveLength(2)
  })

  it("never retries a mutation, even on a lost response", async () => {
    const server = fixtureServer()
    server.route("POST", "/v1/me/checkout", () => {
      throw new NetworkFailure()
    })
    const { transport, sleeps } = transportWith(server)
    const error = await transport
      .request({
        method: "POST",
        path: "/v1/me/checkout",
        body: { price_id: "price_x" },
      })
      .catch((e) => e)
    expect(error).toBeInstanceOf(BillingError)
    expect(error.kind).toBe("network")
    expect(error.isOutcomeUnknown).toBe(true)
    expect(server.requests).toHaveLength(1)
    expect(sleeps).toHaveLength(0)

    server.reset()
    server.route("POST", "/v1/me/checkout", () =>
      errorEnvelope(503, "service_unavailable")
    )
    await expect(
      transport.request({ method: "POST", path: "/v1/me/checkout", body: {} })
    ).rejects.toMatchObject({ status: 503 })
    expect(server.requests).toHaveLength(1)
  })

  it("does not retry 4xx GETs and surfaces them typed", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/me/subscriptions/sub_other", () =>
      errorEnvelope(404, "resource_not_found")
    )
    const { transport } = transportWith(server)
    const error = await transport
      .request({ method: "GET", path: "/v1/me/subscriptions/sub_other" })
      .catch((e) => e)
    expect(error.isNotFound).toBe(true)
    expect(error.code).toBe("resource_not_found")
    expect(error.requestId).toBe("req_fixture")
    expect(server.requests).toHaveLength(1)
  })

  it("stops on abort and rethrows the abort reason", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/me/status", () =>
      errorEnvelope(500, "internal_error")
    )
    const controller = new AbortController()
    const { transport } = transportWith(server, bearerAuth("t"), {
      sleep: async () => controller.abort(),
    })
    const error = await transport
      .request({
        method: "GET",
        path: "/v1/me/status",
        signal: controller.signal,
      })
      .catch((e) => e)
    expect(error.name).toBe("AbortError")
    expect(server.requests).toHaveLength(1)
  })
})

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    const now = Date.parse("2026-09-17T00:00:00Z")
    expect(parseRetryAfter("3", now)).toBe(3000)
    expect(parseRetryAfter("Thu, 17 Sep 2026 00:00:05 GMT", now)).toBe(5000)
    expect(parseRetryAfter("garbage", now)).toBeUndefined()
    expect(parseRetryAfter(null, now)).toBeUndefined()
  })
})

describe("timeouts", () => {
  it("aborts an attempt past timeoutMs and reports outcome unknown", async () => {
    const server = fixtureServer()
    server.route(
      "GET",
      "/v1/me/status",
      (req) =>
        new Promise((_resolve, reject) => {
          req.signal?.addEventListener("abort", () =>
            reject(req.signal?.reason)
          )
        })
    )
    const { transport } = transportWith(server, bearerAuth("t"), {
      timeoutMs: 20,
      retry: { attempts: 1 },
    })
    const error = await transport
      .request({ method: "GET", path: "/v1/me/status" })
      .catch((e) => e)
    expect(error).toBeInstanceOf(BillingError)
    expect(error.kind).toBe("network")
    expect(error.message).toMatch(/20ms/)
  })
})

// PR13 review (findings 1, 4 and signed-out scope): every mutation failure
// that does not prove the outcome keeps the key it was sent under; the
// attempt's timeout and cancellation cover the whole body read; body-read
// failures are their own typed kind.
describe("uncertain mutation failures keep their operation identity", () => {
  const sentKey = (server: ReturnType<typeof fixtureServer>) =>
    server.requests[0].headers.get("Idempotency-Key")

  it("retains the generated key when a mutation response is lost", async () => {
    const server = fixtureServer()
    server.route("POST", "/v1/me/checkout", () => {
      throw new NetworkFailure()
    })
    const { transport } = transportWith(server, bearerAuth("t"), {
      idempotencyKey: () => "operation-1",
    })
    const error = await transport
      .request({ method: "POST", path: "/v1/me/checkout", body: {} })
      .catch((e) => e)
    expect(error).toBeInstanceOf(BillingError)
    expect(error.idempotencyKey).toBe("operation-1")
    expect(error.idempotencyKey).toBe(sentKey(server))
    expect(error.isOutcomeUnknown).toBe(true)
  })

  it("retains the key on a 5xx and marks a mutation 5xx outcome-unknown", async () => {
    const server = fixtureServer()
    server.route("POST", "/v1/me/checkout", () =>
      errorEnvelope(502, "internal_error")
    )
    const { transport } = transportWith(server, bearerAuth("t"), {
      idempotencyKey: () => "operation-5xx",
    })
    const error = await transport
      .request({ method: "POST", path: "/v1/me/checkout", body: {} })
      .catch((e) => e)
    expect(error.idempotencyKey).toBe("operation-5xx")
    expect(error.isOutcomeUnknown).toBe(true)
    // A definite refusal is not outcome-unknown but still names its key.
    server.route("POST", "/v1/me/checkout", () =>
      errorEnvelope(409, "invoice_not_retryable")
    )
    const refused = await transport
      .request({ method: "POST", path: "/v1/me/checkout", body: {} })
      .catch((e) => e)
    expect(refused.isOutcomeUnknown).toBe(false)
    expect(refused.idempotencyKey).toBe("operation-5xx")
  })

  it("keeps the key when the caller cancels a mutation after dispatch", async () => {
    const controller = new AbortController()
    const server = fixtureServer()
    server.route(
      "POST",
      "/v1/me/checkout",
      (req) =>
        new Promise((_resolve, reject) => {
          req.signal?.addEventListener("abort", () =>
            reject(req.signal?.reason)
          )
          controller.abort()
        })
    )
    const { transport } = transportWith(server, bearerAuth("t"), {
      idempotencyKey: () => "operation-cancel",
    })
    const error = await transport
      .request({
        method: "POST",
        path: "/v1/me/checkout",
        body: {},
        signal: controller.signal,
      })
      .catch((e) => e)
    expect(error).toBeInstanceOf(BillingError)
    expect(error.kind).toBe("aborted")
    expect(error.code).toBe("request_aborted")
    expect(error.idempotencyKey).toBe("operation-cancel")
    expect(error.isOutcomeUnknown).toBe(true)
  })

  it("keeps the timeout active while the success body is still streaming", async () => {
    let controller!: ReadableStreamDefaultController
    let sentSignal: AbortSignal | null | undefined
    const { transport } = transportWith(
      { fetch: undefined } as never,
      bearerAuth("t"),
      {
        timeoutMs: 5,
        retry: { attempts: 1 },
        fetch: async (_url, init) => {
          sentSignal = init?.signal
          return new Response(
            new ReadableStream({
              start(c) {
                controller = c
                init?.signal?.addEventListener(
                  "abort",
                  () => c.error(init.signal?.reason),
                  { once: true }
                )
              },
            })
          )
        },
      }
    )
    let settledAs: unknown = "pending"
    const request = transport
      .request({ method: "GET", path: "/v1/me/status" })
      .then(
        () => (settledAs = "resolved"),
        (e) => (settledAs = e)
      )
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(sentSignal?.aborted).toBe(true)
    expect(settledAs).toBeInstanceOf(BillingError)
    expect((settledAs as BillingError).code).toBe("request_timeout")
    expect((settledAs as BillingError).kind).toBe("body")
    // The stream already errored on abort; closing it is a no-op here.
    try {
      controller.close()
    } catch {
      // already errored
    }
    await request
  })

  it("times out a stalled body even when fetch does not tie it to the signal", async () => {
    const { transport } = transportWith(
      { fetch: undefined } as never,
      bearerAuth("t"),
      {
        timeoutMs: 5,
        retry: { attempts: 1 },
        idempotencyKey: () => "operation-stall",
        fetch: async () => new Response(new ReadableStream({ start() {} })),
      }
    )
    const error = await transport
      .request({ method: "POST", path: "/v1/me/checkout", body: {} })
      .catch((e) => e)
    expect(error.code).toBe("request_timeout")
    expect(error.idempotencyKey).toBe("operation-stall")
    expect(error.isOutcomeUnknown).toBe(true)
  })

  it("classifies connection loss while reading a body as a typed, outcome-unknown error", async () => {
    const { transport } = transportWith(
      { fetch: undefined } as never,
      bearerAuth("t"),
      {
        idempotencyKey: () => "operation-body",
        fetch: async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.error(new TypeError("body connection lost"))
              },
            })
          ),
      }
    )
    const error = await transport
      .request({ method: "POST", path: "/v1/me/checkout", body: {} })
      .catch((e) => e)
    expect(error).toBeInstanceOf(BillingError)
    expect(error.kind).toBe("body")
    expect(error.code).toBe("response_body_interrupted")
    expect(error.cause).toBeInstanceOf(TypeError)
    expect(error.idempotencyKey).toBe("operation-body")
    expect(error.isOutcomeUnknown).toBe(true)
  })

  it("cancels a GET body read with the caller's own abort reason", async () => {
    const controller = new AbortController()
    const { transport } = transportWith(
      { fetch: undefined } as never,
      bearerAuth("t"),
      {
        fetch: async () => {
          queueMicrotask(() => controller.abort(new Error("left the page")))
          return new Response(new ReadableStream({ start() {} }))
        },
      }
    )
    const error = await transport
      .request({
        method: "GET",
        path: "/v1/me/status",
        signal: controller.signal,
      })
      .catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("left the page")
  })
})

describe("signed out", () => {
  it("sends nothing on an authenticated route without a credential", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/me/status", () => json({}))
    const { transport } = transportWith(
      server,
      bearerAuth(() => null)
    )
    const error = await transport
      .request({ method: "GET", path: "/v1/me/status" })
      .catch((e) => e)
    expect(error).toBeInstanceOf(BillingError)
    expect(error.kind).toBe("unauthenticated")
    expect(error.code).toBe("not_signed_in")
    expect(error.isUnauthorized).toBe(true)
    expect(server.requests).toHaveLength(0)
  })

  it("still reads public routes anonymously", async () => {
    const server = fixtureServer()
    server.route("GET", "/v1/currencies", () => json({}))
    const { transport } = transportWith(
      server,
      bearerAuth(() => null)
    )
    await transport.request({
      method: "GET",
      path: "/v1/currencies",
      auth: "none",
    })
    expect(server.requests[0].headers.get("Authorization")).toBeNull()
  })
})
