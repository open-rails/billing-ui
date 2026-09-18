// @openrails/billing/transport — base URL + request function with
// AbortSignal, Bearer/DPoP/cookie credential hooks, canonical headers and no
// token persistence.
export {
  anonymousAuth,
  bearerAuth,
  cookieAuth,
  dpopAuth,
  type AuthProvider,
  type Credential,
} from "./auth"
export {
  createDPoPKeyPair,
  createDPoPProof,
  decodeDPoPProof,
  dpopProofURL,
  dpopThumbprint,
} from "./dpop"
export {
  createIdempotencyKey,
  createTransport,
  isAbortError,
  isMutation,
  isValidIdempotencyKey,
  normalizeBaseUrl,
  parseRetryAfter,
  type HttpMethod,
  type Query,
  type RawResponse,
  type RequestSpec,
  type RetryPolicy,
  type Transport,
  type TransportOptions,
} from "./request"
