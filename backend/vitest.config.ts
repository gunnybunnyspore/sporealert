import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
