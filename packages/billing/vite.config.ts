import path from "node:path"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ["src"],
      entryRoot: path.resolve(root, "src"),
      pathsToAliases: false,
      exclude: ["src/**/*.test.*", "src/test/**"],
      tsconfigPath: path.resolve(root, "tsconfig.json"),
    }),
  ],
  build: {
    lib: {
      entry: {
        index: path.resolve(root, "src/index.ts"),
        core: path.resolve(root, "src/core/index.ts"),
        transport: path.resolve(root, "src/transport/index.ts"),
        client: path.resolve(root, "src/client/index.ts"),
        react: path.resolve(root, "src/react/index.ts"),
        components: path.resolve(root, "src/components/index.ts"),
        checkout: path.resolve(root, "src/checkout/index.ts"),
      },
      formats: ["es"],
    },
    sourcemap: true,
    rollupOptions: {
      external: [
        "@tanstack/react-query",
        "openrails-checkout",
        "openrails-checkout/styles.css",
        "react",
        "react-dom",
        "react/jsx-runtime",
        "zod",
      ],
    },
  },
})
