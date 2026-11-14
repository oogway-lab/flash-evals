import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

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
    "bun.lock",
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

const findings = listRepositoryFiles().flatMap((path) => {
    if (isIgnored(path) || !sourceExtensions.has(extname(path))) {
        return [];
    }

    return readFileSync(path, "utf8")
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

// Tracked plus untracked-but-not-ignored files, so local build and test
// output covered by .gitignore (.next-playwright, test-results, ...) never
// counts as debt. Paths are relative to the repository root.
function listRepositoryFiles() {
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
    }).trim();
    process.chdir(repoRoot);
    return execFileSync(
        "git",
        ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
        .split("\0")
        .filter((path) => path !== "" && existsSync(path));
}

function isIgnored(path) {
    return (
        [...ignoredPaths].some(
            (ignored) => path === ignored || path.startsWith(`${ignored}/`),
        ) || path.split("/").some((segment) => ignoredPathSegments.has(segment))
    );
}
