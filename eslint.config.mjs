import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
    {
        ignores: [
            ".dev.local/**",
            "**/node_modules/**",
            "**/dist/**",
            "**/.next/**",
            "**/.open-next/**",
            "**/.wrangler/**",
            "**/.astro/**",
            "apps/web/generated/**",
            "apps/web/public/marketing/**",
            "**/coverage/**",
            "docs/api/**",
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
            "max-lines": [
                "warn",
                { max: 1200, skipBlankLines: true, skipComments: true },
            ],
            "no-console": ["warn", { allow: ["warn", "error", "info"] }],
            // Values are camelCase; React components, error classes, and the
            // schema values that stand in for types are PascalCase; constants
            // are UPPER_CASE. snake_case and kebab-case names fail, and types
            // and type parameters stay PascalCase.
            "@typescript-eslint/naming-convention": [
                "error",
                {
                    selector: "variable",
                    format: ["camelCase", "PascalCase", "UPPER_CASE"],
                    leadingUnderscore: "allow",
                    trailingUnderscore: "allow",
                },
                { selector: "function", format: ["camelCase", "PascalCase"] },
                {
                    selector: "parameter",
                    format: ["camelCase", "PascalCase"],
                    leadingUnderscore: "allow",
                },
                { selector: "method", format: ["camelCase", "PascalCase"] },
                { selector: "typeLike", format: ["PascalCase"] },
                { selector: "typeParameter", format: ["PascalCase"] },
                {
                    selector: "enumMember",
                    format: ["PascalCase", "UPPER_CASE"],
                },
            ],
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
        files: [
            "*.config.*",
            "scripts/**/*.mjs",
            "scripts/**/*.js",
            "scripts/**/*.cjs",
            "*.cjs",
        ],
        languageOptions: {
            sourceType: "commonjs",
            globals: {
                module: "readonly",
                require: "readonly",
                exports: "readonly",
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
