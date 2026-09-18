// Server-supplied navigation targets (hosted checkout pages, 3DS / provider
// hops, cancel portals) are data, not trusted code: navigate only to an
// absolute https URL without credentials whose origin the host configured.
// Everything else — javascript:, data:, http:, relative paths, unknown
// origins — is refused. Hosts that navigate to a URL from the client
// themselves must pass it through safeRedirectURL first.
export interface RedirectPolicy {
  // Exact https origins the host allows (e.g. "https://bill.ccbill.com").
  allowedOrigins: readonly string[]
}

function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password
      ? url.origin
      : null
  } catch {
    return null
  }
}

export function safeRedirectURL(
  candidate: string | null | undefined,
  policy: RedirectPolicy
): string | null {
  if (!candidate) return null
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.username || url.password) return null
  const allowed = policy.allowedOrigins.some(
    (origin) => httpsOrigin(origin) === url.origin
  )
  return allowed ? url.toString() : null
}
