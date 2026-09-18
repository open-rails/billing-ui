// A fetch-compatible fixture server: routes by method + path, answers with
// real Response objects and records every request (headers, body, URL). The
// transport under test runs unchanged against it.
export interface RecordedRequest {
  method: string
  url: string
  path: string
  query: URLSearchParams
  headers: Headers
  body: unknown
  credentials?: RequestCredentials
  signal?: AbortSignal | null
}

export type Handler = (
  request: RecordedRequest,
  n: number
) => Response | Promise<Response> | never

export interface FixtureServer {
  fetch: typeof fetch
  requests: RecordedRequest[]
  route(method: string, path: string, handler: Handler): void
  reset(): void
}

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

export function errorEnvelope(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Response {
  const type =
    status === 401
      ? "authentication_error"
      : status === 403
        ? "authorization_error"
        : status === 402
          ? "card_error"
          : status === 429
            ? "rate_limit_error"
            : status >= 500
              ? "api_error"
              : "invalid_request_error"
  return json(
    {
      error: {
        type,
        code,
        message: `fixture ${code}`,
        request_id: "req_fixture",
        ...extra,
      },
    },
    status,
    headers
  )
}

export class NetworkFailure extends TypeError {
  constructor() {
    super("fetch failed")
    this.name = "TypeError"
  }
}

// `prefix` is the host mount path an embedded deployment serves OpenRails
// under; routes are declared without it.
export function fixtureServer(
  options: { prefix?: string } = {}
): FixtureServer {
  const prefix = options.prefix ?? ""
  const routes = new Map<string, { handler: Handler; hits: number }>()
  const requests: RecordedRequest[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const parsed = new URL(url)
    const method = (init?.method ?? "GET").toUpperCase()
    const headers = new Headers(init?.headers)
    let body: unknown
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    const path = parsed.pathname.startsWith(prefix)
      ? parsed.pathname.slice(prefix.length)
      : parsed.pathname
    const recorded: RecordedRequest = {
      method,
      url,
      path,
      query: parsed.searchParams,
      headers,
      body,
      credentials: init?.credentials,
      signal: init?.signal,
    }
    requests.push(recorded)
    if (init?.signal?.aborted)
      throw init.signal.reason ?? new DOMException("aborted", "AbortError")
    const route = routes.get(`${method} ${path}`)
    if (!route) return errorEnvelope(404, "resource_not_found")
    route.hits += 1
    return route.handler(recorded, route.hits)
  }
  return {
    fetch: fetchImpl,
    requests,
    route(method, path, handler) {
      routes.set(`${method.toUpperCase()} ${path}`, { handler, hits: 0 })
    },
    reset() {
      routes.clear()
      requests.length = 0
    },
  }
}
