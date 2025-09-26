import { defineConfig } from "tsdown";

export default defineConfig([
  {
    // Explicit entry points — should mirror the subpath exports in package.json
    entry: [
      "./src/index.ts",
      "./src/adapters/fetch.ts",
      "./src/adapters/axios.ts",
    ],

    outDir: "dist",

    // Emit modern ESM output; "neutral" platform works in both Node and bundlers
    format: "esm",
    platform: "neutral",

    // Target modern JS syntax (less polyfills, smaller output)
    target: "es2022", // Node 20+ supports this natively

    // Enable tree-shaking for consumer bundlers
    treeshake: true,

    // Keep axios (and Node built-ins) external — do not bundle them
    external: ["axios", "node:*"],

    // Output optimizations
    minify: true,

    // DX: generate sourcemaps for easier debugging
    sourcemap: true,

    // Generate TypeScript declaration files alongside JS output
    dts: true,
  },
]);
