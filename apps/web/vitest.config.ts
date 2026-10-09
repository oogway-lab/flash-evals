import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            "@": root,
        },
    },
    test: {
        environment: "jsdom",
        setupFiles: "./vitest.setup.ts",
        include: ["**/*.test.ts", "**/*.test.tsx"],
        // Build output (`next build`, OpenNext) contains copies of the tests.
        exclude: [...configDefaults.exclude, ".next/**", ".open-next/**"],
        clearMocks: true,
        pool: "forks",
        isolate: true,
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            reportsDirectory: "../../coverage/apps-web",
            thresholds: {
                statements: 35,
                branches: 25,
                functions: 30,
                lines: 35,
            },
        },
    },
});
