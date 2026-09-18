import { describe, expect, it } from "vitest"

import pkg from "../package.json"

// Pre-v1 hard cut: @openrails/billing ships no compatibility bridge to the
// hosted checkout package; openrails-checkout stays its own artifact.
describe("package surface", () => {
  it("has no checkout re-export and no dependency on openrails-checkout", () => {
    expect(Object.keys(pkg.exports).sort()).toEqual(
      [
        ".",
        "./client",
        "./components",
        "./core",
        "./package.json",
        "./react",
        "./transport",
      ].sort()
    )
    const deps = {
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.devDependencies,
    } as Record<string, string>
    expect(deps["openrails-checkout"]).toBeUndefined()
  })
})
