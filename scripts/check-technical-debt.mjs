import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const debtPattern = /\b(TODO|FIXME|HACK|XXX)\b/;
const sourceExtensions = new Set([
    ".cjs",
    ".css",
    ".js",
    ".json",
    ".jsonc",
    ".md",
    ".mjs",
    ".sh",
    ".ts",
    ".tsx",
    ".yml",
    ".yaml",
]);
const ignoredPaths = new Set([
    "apps/web/server/db/migrations",
    "pnpm-lock.yaml",
    "scripts/check-technical-debt.mjs",
]);
const ignoredPathSegments = new Set([
    ".git",
    ".next",
    ".open-next",
    ".wrangler",
    "coverage",
    "dist",
    "node_modules",
]);

const findings = walk(root).flatMap((file) => {
    const path = relative(root, file);
    if (isIgnored(path) || !sourceExtensions.has(extname(path))) {
        return [];
    }

    return readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
            debtPattern.test(line) ? [`${path}:${index + 1}:${line}`] : [],
        );
});

if (findings.length === 0) {
    console.log("Technical debt marker check passed.");
    process.exit(0);
}

console.error(
    "Technical debt markers found. Convert these to tracked issues or remove them:",
);
for (const finding of findings) {
    console.error(`  ${finding}`);
}
process.exit(1);

function walk(dir) {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        const relativePath = relative(root, path);
        if (isIgnored(relativePath)) {
            return [];
        }

        const stats = statSync(path);
        return stats.isDirectory() ? walk(path) : [path];
    });
}

function isIgnored(path) {
    return (
        ignoredPaths.has(path) ||
        path.split("/").some((segment) => ignoredPathSegments.has(segment))
    );
}
