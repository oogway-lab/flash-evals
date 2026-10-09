import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();

// Canonical flag manifests. Each app declares its rollout flags in one of
// these files with `env`, `defaultValue`, and `since` fields so this script
// can detect drift (flags used but never declared, or declared but never
// read) and age (flags left disabled long after introduction).
const MANIFEST_FILES = [
    { path: "apps/api/src/featureFlags.ts", constName: "API_FEATURE_FLAGS" },
    { path: "apps/web/lib/analytics.ts", constName: "WEB_FEATURE_FLAGS" },
];

const FLAG_ENV_PATTERN = /\b(?:NEXT_PUBLIC_)?MOSAIC_FLAG_[A-Z0-9_]+\b/g;
const STALE_AFTER_DAYS = 120;

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const ignoredPathSegments = new Set([
    ".git",
    ".next",
    ".open-next",
    ".wrangler",
    "coverage",
    "dist",
    "node_modules",
]);
const ignoredFiles = new Set(["scripts/check-feature-flags.mjs"]);

const manifest = MANIFEST_FILES.flatMap(({ path, constName }) =>
    parseManifest(path, constName),
);

if (manifest.length === 0) {
    console.error(
        "Feature flag lifecycle check found no flags in the known manifests. " +
            "Update MANIFEST_FILES in scripts/check-feature-flags.mjs if manifests moved.",
    );
    process.exit(1);
}

const manifestByEnv = new Map(manifest.map((flag) => [flag.env, flag]));

// Test files intentionally count as usage evidence: they exercise the flag's
// env-parsing behavior, which is enough to show it is still wired up even
// though production code often reads flags indirectly (e.g. by iterating the
// manifest object rather than referencing the env string literal again).
const sourceFiles = walk(root).filter((file) => {
    const path = relative(root, file);
    return !isIgnored(path) && sourceExtensions.has(extname(path));
});

const usageCounts = new Map(manifest.map((flag) => [flag.env, 0]));
const undeclared = new Map();

for (const file of sourceFiles) {
    const path = relative(root, file);
    const text = readFileSync(file, "utf8");

    for (const match of text.matchAll(FLAG_ENV_PATTERN)) {
        const envName = match[0];
        const flag = manifestByEnv.get(envName);
        if (!flag) {
            const sites = undeclared.get(envName) ?? new Set();
            sites.add(path);
            undeclared.set(envName, sites);
            continue;
        }
        // Only count reads outside the flag's own manifest declaration line.
        if (!(
            path === flag.sourceFile && isDeclarationLine(text, match.index)
        )) {
            usageCounts.set(envName, usageCounts.get(envName) + 1);
        }
    }
}

const orphaned = manifest.filter((flag) => usageCounts.get(flag.env) === 0);
const stale = manifest.filter((flag) => {
    const ageDays = daysSince(flag.since);
    return (
        ageDays !== null &&
        ageDays > STALE_AFTER_DAYS &&
        flag.defaultValue === false
    );
});

if (orphaned.length > 0 || undeclared.size > 0) {
    console.error("Feature flag lifecycle check failed:");
    for (const flag of orphaned) {
        console.error(
            `  ${flag.env}: declared in ${flag.sourceFile} but never read anywhere else. Remove the flag or wire it up.`,
        );
    }
    for (const [envName, sites] of undeclared) {
        console.error(
            `  ${envName}: read in ${[...sites].join(", ")} but not declared in a feature-flag manifest (${MANIFEST_FILES.map((m) => m.path).join(", ")}).`,
        );
    }
    process.exit(1);
}

if (stale.length > 0) {
    console.warn("Feature flag lifecycle warning (non-blocking):");
    for (const flag of stale) {
        console.warn(
            `  ${flag.env}: introduced ${flag.since} (${daysSince(flag.since)} days ago), still disabled by default. Revisit rollout or remove.`,
        );
    }
}

console.log(
    `Feature flag lifecycle check passed. Tracked ${manifest.length} flag(s) across ${MANIFEST_FILES.length} manifest(s).`,
);

function parseManifest(path, constName) {
    const text = readFileSync(join(root, path), "utf8");
    const blockStart = text.indexOf(`${constName} = {`);
    if (blockStart === -1) {
        throw new Error(`Could not find ${constName} in ${path}`);
    }
    const blockEnd = text.indexOf("} as const", blockStart);
    const block = text.slice(
        blockStart,
        blockEnd === -1 ? undefined : blockEnd,
    );

    const entryPattern =
        /env:\s*"([^"]+)"\s*,\s*defaultValue:\s*(true|false)\s*,\s*since:\s*"(\d{4}-\d{2}-\d{2})"/g;

    return [...block.matchAll(entryPattern)].map((match) => ({
        env: match[1],
        defaultValue: match[2] === "true",
        since: match[3],
        sourceFile: path,
    }));
}

function isDeclarationLine(text, index) {
    const lineStart = text.lastIndexOf("\n", index) + 1;
    const lineEnd = text.indexOf("\n", index);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    return line.includes("env:");
}

function daysSince(isoDate) {
    const since = new Date(`${isoDate}T00:00:00Z`).getTime();
    if (Number.isNaN(since)) return null;
    return Math.floor((Date.now() - since) / (1000 * 60 * 60 * 24));
}

function walk(dir) {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        const relativePath = relative(root, path);
        if (isIgnored(relativePath)) return [];
        const stats = statSync(path);
        return stats.isDirectory() ? walk(path) : [path];
    });
}

function isIgnored(path) {
    return (
        ignoredFiles.has(path) ||
        path.split("/").some((segment) => ignoredPathSegments.has(segment))
    );
}
