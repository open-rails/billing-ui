// Hosts own AuthKit: they mint, refresh and hold credentials. The package
// only asks for the current one, in memory, per request, and never stores it.
//
// Bearer: `Authorization: Bearer <token>` (embedded same-origin hosts, native
// certificate-bound clients). DPoP: `Authorization: DPoP <token>` plus a
// fresh RFC 9449 proof per attempt signed with the host's P-256 key whose
// thumbprint the token is bound to (delegated browser tokens). Cookie: the
// host's session cookie with its own CSRF/Origin contract; the transport
// then sends `credentials: "include"` and the host's headers on every
// request. Short-lived delegated tokens and server-side permissions are the
// protection; CORS is not a defence against a stolen token.

export type Credential =
  | { scheme: "Bearer"; token: string }
  | { scheme: "DPoP"; token: string; key: CryptoKeyPair }
  | { scheme: "Cookie"; headers?: Record<string, string> }

export interface AuthProvider {
  // The credential for the next request, or null to send the request
  // anonymously (the server answers 401).
  credential(): Promise<Credential | null> | Credential | null
  // Called once after a 401: return a fresh credential to replay the request
  // with, or null when the session is gone. `stale` is what the refused
  // request carried.
  refresh?(stale: Credential | null): Promise<Credential | null>
}

export function bearerAuth(
  token: string | (() => string | null)
): AuthProvider {
  return {
    credential: () => {
      const value = typeof token === "function" ? token() : token
      return value ? { scheme: "Bearer", token: value } : null
    },
  }
}

export function dpopAuth(
  token: string | (() => string | null),
  key: CryptoKeyPair
): AuthProvider {
  return {
    credential: () => {
      const value = typeof token === "function" ? token() : token
      return value ? { scheme: "DPoP", token: value, key } : null
    },
  }
}

export function cookieAuth(
  headers?: () => Record<string, string>
): AuthProvider {
  return {
    credential: () => ({ scheme: "Cookie", headers: headers?.() }),
  }
}

export const anonymousAuth: AuthProvider = { credential: () => null }
