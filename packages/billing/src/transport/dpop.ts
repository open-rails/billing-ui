// RFC 9449 DPoP proofs, ES256/P-256, as AuthKit's verifier accepts them:
// header exactly {typ:"dpop+jwt", alg:"ES256", jwk:{kty,crv,x,y}}, claims
// {jti, htm, htu, iat, ath}. `htu` is the FINAL request URL without query or
// fragment; the verifier lowercases scheme/host and drops default ports, so
// the proof is built from the resolved URL, never from a path template.

function base64url(value: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// createDPoPKeyPair makes a non-extractable P-256 signing key for one browser
// session. The host binds its delegated token to this key's thumbprint.
export function createDPoPKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  )
}

// dpopProofURL is the htu for a request URL: origin + pathname only.
export function dpopProofURL(url: string | URL): string {
  const parsed = new URL(url)
  if (parsed.username || parsed.password)
    throw new Error("DPoP proof URL must not carry credentials")
  return `${parsed.origin}${parsed.pathname}`
}

// dpopThumbprint is the RFC 7638 SHA-256 thumbprint (base64url) of the
// key's public half, the value a delegated token's cnf.jkt must equal.
export async function dpopThumbprint(key: CryptoKeyPair): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", key.publicKey)
  if (!jwk.x || !jwk.y) throw new Error("DPoP key is not a P-256 public key")
  const canonical = `{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  )
  return base64url(digest)
}

export async function createDPoPProof(
  method: string,
  url: string | URL,
  accessToken: string,
  key: CryptoKeyPair,
  now: () => number = Date.now
): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", key.publicKey)
  if (!jwk.x || !jwk.y) throw new Error("DPoP key is not a P-256 public key")
  const header = base64url(
    JSON.stringify({
      typ: "dpop+jwt",
      alg: "ES256",
      jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
    })
  )
  const ath = base64url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessToken))
  )
  const payload = base64url(
    JSON.stringify({
      jti: crypto.randomUUID(),
      htm: method.toUpperCase(),
      htu: dpopProofURL(url),
      iat: Math.floor(now() / 1000),
      ath,
    })
  )
  const signingInput = `${header}.${payload}`
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key.privateKey,
    new TextEncoder().encode(signingInput)
  )
  if (signature.byteLength !== 64)
    throw new Error("DPoP signature is not P-256")
  return `${signingInput}.${base64url(signature)}`
}

// decodeDPoPProof reads a proof's header and claims (unverified); for tests
// and diagnostics only.
export function decodeDPoPProof(proof: string): {
  header: Record<string, unknown>
  claims: Record<string, unknown>
} {
  const [header, claims] = proof.split(".")
  const decode = (part: string | undefined) => {
    if (!part) throw new Error("malformed DPoP proof")
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/")
    return JSON.parse(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))
    ) as Record<string, unknown>
  }
  return { header: decode(header), claims: decode(claims) }
}
