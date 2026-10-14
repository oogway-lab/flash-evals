import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        exclude: [...configDefaults.exclude, "dist/**", ".astro/**"],
        clearMocks: true,
        pool: "forks",
        isolate: true,
        reporters: [
            "default",
            ["json", { outputFile: "../../test-results/apps-site.json" }],
        ],
        coverage: {
            provider: "v8",
            include: ["src/lib/**/*.ts"],
            reporter: ["text", "json", "html"],
            reportsDirectory: "../../coverage/apps-site",
            thresholds: {
                statements: 90,
                branches: 80,
                functions: 100,
                lines: 90,
            },
        },
    },
});
