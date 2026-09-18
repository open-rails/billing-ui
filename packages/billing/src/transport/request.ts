// The one request function every client operation goes through. It owns the
// base URL, the credential headers (Bearer, DPoP with a fresh proof for the
// final URL, or the host's cookie contract), the canonical Idempotency-Key on
// mutations, bounded GET retries with Retry-After, a single 401 refresh
// replay, AbortSignal plumbing and the error envelope. It never retries a
// mutation on its own: a lost response is surfaced as an outcome-unknown
// error that keeps the operation identity for the host to replay.
import { BillingError, ErrorCode } from "../core/errors"
import type { AuthProvider, Credential } from "./auth"
import { createDPoPProof } from "./dpop"

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export type Query = Record<string, string | number | boolean | undefined | null>

export interface RetryPolicy {
  // Total attempts for a GET, including the first (default 3).
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export interface TransportOptions {
  // The OpenRails origin, or origin plus mount path for an embedded host
  // ("https://billing.example", "https://site.example/api/openrails"). Paths
  // are appended verbatim, so pass the part before "/v1".
  baseUrl: string
  auth: AuthProvider
  fetch?: typeof fetch
  // Cross-origin default is "omit". Pass "include" only for the cookie
  // contract; a Cookie credential forces it.
  credentials?: RequestCredentials
  // Host headers sent on every request (Accept-Language, a tenant hint).
  headers?: Record<string, string> | (() => Record<string, string>)
  retry?: RetryPolicy
  // Per-attempt timeout; unset means the caller's signal alone bounds it.
  timeoutMs?: number
  // Injection points for tests.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
  idempotencyKey?: () => string
}

export interface RequestSpec {
  method: HttpMethod
  // Absolute path under baseUrl, e.g. "/v1/me/status".
  path: string
  query?: Query
  body?: unknown
  signal?: AbortSignal
  // Mutations get a generated key when none is passed; a host replaying a
  // financial operation must pass the original.
  idempotencyKey?: string
  headers?: Record<string, string>
  // "required" (default): without a credential nothing is sent and the call
  // fails as not signed in. "none": public routes such as /v1/currencies.
  auth?: "required" | "none"
  // "auto" (default): every mutation carries an Idempotency-Key. "none" is
  // for non-mutating POSTs such as a tier-change preview, which the server
  // refuses to key.
  idempotency?: "auto" | "none"
}

export interface RawResponse {
  method: HttpMethod
  status: number
  // Parsed JSON, or undefined for an empty body (204, 202 without a body).
  body: unknown
  headers: Headers
  requestId?: string
  retryAfterMs?: number
  url: string
  // The Idempotency-Key the mutation carried, for host-side replay.
  idempotencyKey?: string
}

export interface Transport {
  readonly baseUrl: string
  url(path: string, query?: Query): string
  request(spec: RequestSpec): Promise<RawResponse>
}

const DEFAULT_RETRY: Required<RetryPolicy> = {
  attempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 10_000,
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "")
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`billing: baseUrl must be absolute, got "${baseUrl}"`)
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error("billing: baseUrl must not carry credentials or a query")
  if (parsed.protocol !== "https:" && !isLoopback(parsed))
    throw new Error("billing: baseUrl must be https (http only on loopback)")
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`
}

function isLoopback(url: URL): boolean {
  const host = url.hostname
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  )
}

export function isMutation(method: HttpMethod): boolean {
  return method !== "GET"
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID()
}

// OpenRails accepts an Idempotency-Key of 1–255 bytes.
export function isValidIdempotencyKey(key: string): boolean {
  const bytes = new TextEncoder().encode(key.trim()).length
  return bytes >= 1 && bytes <= 255
}

export function parseRetryAfter(
  value: string | null,
  now: number
): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.round(seconds * 1000)
  const at = Date.parse(value)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, at - now)
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal))
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function abortError(signal?: AbortSignal): unknown {
  return (
    signal?.reason ??
    new DOMException("The operation was aborted", "AbortError")
  )
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  )
}

interface AttemptScope {
  signal: AbortSignal | undefined
  timedOut: boolean
  // Rejects when the attempt is aborted (caller or timeout), for racing
  // work fetch does not tie to the signal, such as a custom body stream.
  aborted: Promise<never>
  settle(): void
}

// attemptScope follows the caller's signal and, when a timeout is set,
// aborts the attempt once the deadline passes. It lives until the response
// body has been read to the end.
function attemptScope(
  outer: AbortSignal | undefined,
  timeoutMs: number | undefined
): AttemptScope {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const scope: AttemptScope = {
    signal: controller.signal,
    timedOut: false,
    aborted: new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(controller.signal.reason),
        { once: true }
      )
    }),
    settle() {
      clearTimeout(timer)
      outer?.removeEventListener("abort", follow)
    },
  }
  scope.aborted.catch(() => undefined)
  const follow = () => controller.abort(abortError(outer))
  if (timeoutMs)
    timer = setTimeout(() => {
      scope.timedOut = true
      controller.abort(
        new DOMException("The request timed out", "TimeoutError")
      )
    }, timeoutMs)
  if (outer?.aborted) follow()
  else outer?.addEventListener("abort", follow, { once: true })
  return scope
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status !== 501)
}

async function readBody(
  response: Response,
  aborted: Promise<never>
): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined
  let text: string
  try {
    text = await Promise.race([response.text(), aborted])
  } catch (error) {
    void response.body?.cancel().catch(() => undefined)
    throw new BodyReadFailure(error)
  }
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

class BodyReadFailure {
  constructor(readonly cause: unknown) {}
}

export function createTransport(options: TransportOptions): Transport {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const doFetch = options.fetch ?? globalThis.fetch?.bind(globalThis)
  if (!doFetch) throw new Error("billing: fetch is not available")
  const retry = { ...DEFAULT_RETRY, ...options.retry }
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const newKey = options.idempotencyKey ?? createIdempotencyKey

  function url(path: string, query?: Query): string {
    if (!path.startsWith("/"))
      throw new Error(`billing: path must start with /: ${path}`)
    const target = new URL(baseUrl + path)
    if (query)
      for (const [key, value] of Object.entries(query))
        if (value !== undefined && value !== null)
          target.searchParams.set(key, String(value))
    return target.toString()
  }

  function hostHeaders(): Record<string, string> {
    const value =
      typeof options.headers === "function"
        ? options.headers()
        : options.headers
    return value ?? {}
  }

  async function authHeaders(
    method: HttpMethod,
    finalUrl: string,
    credential: Credential | null
  ): Promise<{
    headers: Record<string, string>
    credentials: RequestCredentials
  }> {
    let credentials: RequestCredentials = options.credentials ?? "omit"
    const headers: Record<string, string> = {}
    if (!credential) return { headers, credentials }
    switch (credential.scheme) {
      case "Bearer":
        headers.Authorization = `Bearer ${credential.token}`
        break
      case "DPoP":
        headers.Authorization = `DPoP ${credential.token}`
        headers.DPoP = await createDPoPProof(
          method,
          finalUrl,
          credential.token,
          credential.key,
          now
        )
        break
      case "Cookie":
        credentials = "include"
        Object.assign(headers, credential.headers)
        break
    }
    return { headers, credentials }
  }

  async function attempt(
    spec: RequestSpec,
    finalUrl: string,
    credential: Credential | null,
    idempotencyKey: string | undefined
  ): Promise<RawResponse> {
    if (spec.signal?.aborted) throw abortError(spec.signal)
    const auth = await authHeaders(spec.method, finalUrl, credential)
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...hostHeaders(),
      ...spec.headers,
      ...auth.headers,
    }
    if (spec.body !== undefined) headers["Content-Type"] = "application/json"
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey

    const failure = (
      kind: "network" | "body" | "aborted",
      code: string,
      message: string,
      cause: unknown
    ) =>
      new BillingError({
        kind,
        status: 0,
        code,
        message,
        method: spec.method,
        url: finalUrl,
        idempotencyKey,
        cause,
      })

    // The caller's signal plus the per-attempt timeout, composed without
    // AbortSignal.any/timeout (browser floor: the exact-money one), kept
    // alive until the body has been read.
    const scope = attemptScope(spec.signal, options.timeoutMs)
    let dispatched = false
    try {
      const response = await Promise.race([
        doFetch(finalUrl, {
          method: spec.method,
          headers,
          body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
          credentials: auth.credentials,
          signal: scope.signal,
          redirect: "error",
        }),
        scope.aborted,
      ])
      dispatched = true
      const body = await readBody(response, scope.aborted)
      const requestId = response.headers.get("X-Request-ID") ?? undefined
      const retryAfterMs = parseRetryAfter(
        response.headers.get("Retry-After"),
        now()
      )
      if (!response.ok)
        throw BillingError.fromResponse(
          spec.method,
          finalUrl,
          response.status,
          body,
          retryAfterMs,
          requestId,
          idempotencyKey
        )
      return {
        method: spec.method,
        status: response.status,
        body,
        headers: response.headers,
        requestId,
        retryAfterMs,
        url: finalUrl,
        idempotencyKey,
      }
    } catch (error) {
      if (error instanceof BillingError) throw error
      const cause = error instanceof BodyReadFailure ? error.cause : error
      if (scope.timedOut)
        throw failure(
          dispatched ? "body" : "network",
          ErrorCode.requestTimeout,
          `The billing service did not finish within ${options.timeoutMs}ms`,
          cause
        )
      if (spec.signal?.aborted) {
        // A cancelled read is just cancelled; a cancelled mutation may
        // already have reached the server, so it keeps its key.
        if (!isMutation(spec.method)) throw cause
        throw failure(
          "aborted",
          ErrorCode.requestAborted,
          "The request was cancelled after it was sent",
          cause
        )
      }
      if (error instanceof BodyReadFailure)
        throw failure(
          "body",
          ErrorCode.responseBodyInterrupted,
          "The billing service response was cut off",
          cause
        )
      throw failure(
        "network",
        ErrorCode.networkError,
        "The billing service could not be reached",
        cause
      )
    } finally {
      scope.settle()
    }
  }

  async function request(spec: RequestSpec): Promise<RawResponse> {
    const finalUrl = url(spec.path, spec.query)
    const mutation = isMutation(spec.method)
    const keyed = mutation && spec.idempotency !== "none"
    const idempotencyKey = keyed ? (spec.idempotencyKey ?? newKey()) : undefined
    if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey))
      throw new Error("billing: Idempotency-Key must be 1–255 bytes")
    const attempts = mutation ? 1 : Math.max(1, retry.attempts)
    let credential =
      spec.auth === "none" ? null : await options.auth.credential()
    if (spec.auth !== "none" && !credential)
      throw new BillingError({
        kind: "unauthenticated",
        status: 401,
        code: ErrorCode.notSignedIn,
        message: "No billing credential: sign in first",
        method: spec.method,
        url: finalUrl,
        idempotencyKey,
      })
    let refreshed = false

    for (let n = 1; ; n++) {
      try {
        return await attempt(spec, finalUrl, credential, idempotencyKey)
      } catch (error) {
        if (!(error instanceof BillingError)) throw error
        // One refresh replay. A 401 is refused before any handler runs, so
        // replaying a mutation with the same key cannot double-execute it.
        if (
          error.kind === "response" &&
          error.status === 401 &&
          !refreshed &&
          options.auth.refresh
        ) {
          refreshed = true
          const fresh = await options.auth.refresh(credential)
          if (fresh) {
            credential = fresh
            n--
            continue
          }
          throw error
        }
        const retryable =
          !mutation &&
          n < attempts &&
          !spec.signal?.aborted &&
          (error.kind === "network" ||
            error.kind === "body" ||
            (error.kind === "response" && shouldRetryStatus(error.status)))
        if (!retryable) throw error
        const backoff = Math.min(
          retry.maxDelayMs,
          retry.baseDelayMs * 2 ** (n - 1) + Math.random() * retry.baseDelayMs
        )
        const delay =
          error.retryAfterMs !== undefined
            ? Math.min(retry.maxDelayMs, error.retryAfterMs)
            : backoff
        await sleep(delay, spec.signal)
      }
    }
  }

  return { baseUrl, url, request }
}
