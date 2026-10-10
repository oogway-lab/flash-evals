import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/.next/**",
            "**/.open-next/**",
            "**/.wrangler/**",
            "**/.astro/**",
            "**/coverage/**",
            "**/.claude/worktrees/**",
            "**/.worktrees/**",
            "apps/web/server/db/migrations/**",
            "apps/web/scripts/seed-assets/**",
            "apps/web/scripts/current-db-data.sql",
            "**/*.json",
            "**/*.yml",
            "**/*.yaml",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            "@next/next": nextPlugin,
            react,
            "react-hooks": reactHooks,
        },
        settings: {
            react: {
                version: "detect",
            },
        },
        rules: {
            complexity: ["warn", { max: 18 }],
            "max-depth": ["warn", 5],
            "no-console": ["warn", { allow: ["warn", "error", "info"] }],
            "@typescript-eslint/consistent-type-imports": [
                "warn",
                { prefer: "type-imports" },
            ],
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "react/react-in-jsx-scope": "off",
            // Includes the React Compiler rules (reactCompiler is on in
            // apps/web/next.config.ts). Components that break them are skipped
            // by the compiler, never miscompiled.
            ...reactHooks.configs.flat["recommended-latest"].rules,
            // Pre-existing pattern (reset local state when a server action
            // result arrives); the compiler handles it, so it stays off.
            "react-hooks/set-state-in-effect": "off",
            // Compiler bail-outs in existing code: surfaced, not blocking.
            "react-hooks/refs": "warn",
            "react-hooks/error-boundaries": "warn",
        },
    },
    {
        files: ["*.config.*", "scripts/**/*.mjs", "scripts/**/*.js", "*.cjs"],
        languageOptions: {
            sourceType: "commonjs",
            globals: {
                module: "readonly",
                require: "readonly",
                process: "readonly",
                console: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
            },
        },
        rules: {
            "no-console": "off",
            "@typescript-eslint/no-require-imports": "off",
        },
    },
    {
        files: ["**/*.test.ts", "**/*.test.tsx"],
        rules: {
            "no-console": "off",
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
];
