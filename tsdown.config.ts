import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: [
      "./src/index.ts",
      "./src/adapters/fetch.ts",
      "./src/adapters/axios.ts",
    ],
    platform: "neutral",
    dts: true,
  },
]);
