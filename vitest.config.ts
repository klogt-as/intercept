// vite.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node 20 har global fetch/WHATWG streams, så 'node' er fint
    environment: "node",
    globals: true,
    // match testfiler
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["dist", "node_modules"],
    // ryddige mocks mellom tester
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    // mer deterministiske timer (du bruker disse i testene)
    fakeTimers: {
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    },
    // valgfritt: coverage
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      exclude: ["**/dist/**", "**/*.test.ts", "**/*.spec.ts"],
    },
  },
});
