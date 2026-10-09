import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

// Fails when source code reads an environment variable that no doc mentions.
// A variable counts as documented when it appears as `NAME=` in an env example
// or in backticks in docs/configuration.md.
const root = process.cwd();
const sourceDirs = ["apps/api/src", "apps/web", "packages", "scripts"];
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const ignoredPathSegments = new Set([
    ".next",
    ".open-next",
    ".wrangler",
    "coverage",
    "dist",
    "node_modules",
]);
const envExamples = ["apps/api/.env.example", "apps/web/.env.example"];
const configurationDoc = "docs/configuration.md";
const envReadPattern =
    /(?:process\.env|\benv)\.([A-Z][A-Z0-9_]+)|process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g;

const documented = new Set([
    ...envExamples.flatMap((file) =>
        [...read(file).matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]),
    ),
    ...[...read(configurationDoc).matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map(
        (m) => m[1],
    ),
]);

const reads = new Map();
for (const file of sourceDirs.flatMap((dir) => walk(join(root, dir)))) {
    const path = relative(root, file);
    read(path)
        .split("\n")
        .forEach((line, index) => {
            if (isCommentLine(line)) return;
            for (const match of line.matchAll(envReadPattern)) {
                const name = match[1] ?? match[2];
                if (!reads.has(name)) reads.set(name, `${path}:${index + 1}`);
            }
        });
}

const undocumented = [...reads].filter(([name]) => !documented.has(name));
if (undocumented.length === 0) {
    console.log(
        `Env var documentation check passed. ${reads.size} variable(s) read in code.`,
    );
    process.exit(0);
}

console.error(
    `Env vars read in code but not documented. Add them to ${envExamples.join(" or ")} (operator settings) or ${configurationDoc} (dev, test, and script settings):`,
);
for (const [name, location] of undocumented.sort()) {
    console.error(`  ${name} (first read at ${location})`);
}
process.exit(1);

function read(path) {
    return readFileSync(join(root, path), "utf8");
}

function walk(dir) {
    return readdirSync(dir).flatMap((entry) => {
        if (ignoredPathSegments.has(entry)) return [];
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return walk(path);
        return isSourceFile(path) ? [path] : [];
    });
}

function isSourceFile(path) {
    return (
        sourceExtensions.has(extname(path)) &&
        !/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) &&
        !path.includes(".integration.")
    );
}

function isCommentLine(line) {
    const trimmed = line.trimStart();
    return (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
    );
}
