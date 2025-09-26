import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["dist", "node_modules"],
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    fakeTimers: {
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      exclude: ["**/dist/**", "**/*.test.ts", "**/*.spec.ts"],
    },
  },
});
