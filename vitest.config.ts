import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "dist/**",
        "src/cli.ts",
        "src/codegen.ts",
        "test/**",
        "test-d/**",
      ],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 95,
        functions: 100,
        lines: 95,
        statements: 95,
      },
    },
  },
});
