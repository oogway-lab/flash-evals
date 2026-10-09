import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        clearMocks: true,
        pool: "forks",
        isolate: true,
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            reportsDirectory: "../../coverage/apps-api",
            thresholds: {
                statements: 40,
                branches: 35,
                functions: 40,
                lines: 40,
            },
        },
    },
});
