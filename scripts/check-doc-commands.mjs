import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const packageFiles = [
    "package.json",
    "apps/web/package.json",
    "apps/api/package.json",
    "apps/site/package.json",
    "packages/object-storage/package.json",
    "packages/api-contract/package.json",
    "packages/llm-core/package.json",
    "packages/secrets/package.json",
];

const packageScripts = new Map();

for (const packageFile of packageFiles) {
    const pkg = JSON.parse(readFileSync(join(root, packageFile), "utf8"));
    const packageDir = dirname(packageFile);
    const scripts = new Set(Object.keys(pkg.scripts ?? {}));
    packageScripts.set(packageDir === "." ? "" : packageDir, scripts);
}

const communityDocs = [
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
].filter((docPath) => existsSync(join(root, docPath)));

const docsToCheck = [
    "README.md",
    "AGENTS.md",
    ...communityDocs,
    "apps/web/README.md",
    "apps/site/README.md",
    "apps/web/AGENTS.md",
    ".github/pull_request_template.md",
    ...listMarkdownFiles("docs"),
].filter((docPath) => existsSync(join(root, docPath)));
const commandPattern =
    /\bbun\s+(run\s+)?(?:--silent\s+)?(?:(--filter)\s+(@flash-evals\/[a-z-]+)\s+|--cwd\s+((?:apps|packages)\/[a-z-]+)\s+)?([a-zA-Z0-9:_./-]+)/;
// Bun's own subcommands; anything else after `bun` must be a package script.
const BUN_BUILTINS = new Set([
    "install",
    "add",
    "remove",
    "update",
    "outdated",
    "audit",
    "pm",
    "why",
    "x",
    "--version",
    "-v",
]);
const packageToDir = new Map([
    ["@flash-evals/web", "apps/web"],
    ["@flash-evals/api", "apps/api"],
    ["@flash-evals/site", "apps/site"],
    ["@flash-evals/object-storage", "packages/object-storage"],
    ["@flash-evals/api-contract", "packages/api-contract"],
    ["@flash-evals/llm-core", "packages/llm-core"],
    ["@flash-evals/secrets", "packages/secrets"],
]);

const failures = [];

for (const docPath of docsToCheck) {
    const source = readFileSync(join(root, docPath), "utf8");
    for (const commandText of documentedCommands(source)) {
        const match = commandText.match(commandPattern);
        if (!match) continue;
        const usesRun = Boolean(match[1]);
        const packageName = match[3];
        const cwdDir = match[4];
        const scriptName = match[5];
        // A file argument (`bun scripts/x.mjs`) runs that file, not a script.
        if (scriptName.includes("/") || /\.[cm]?[jt]s$/.test(scriptName))
            continue;
        if (!usesRun && scriptName === "test") {
            failures.push(
                `${docPath}: \`${commandText}\` runs Bun's test runner; write \`bun run test\``,
            );
            continue;
        }
        if (!usesRun && BUN_BUILTINS.has(scriptName)) continue;

        const packageDir = packageName
            ? packageToDir.get(packageName)
            : (cwdDir ?? "");
        if (packageName && !packageDir) {
            failures.push(`${docPath}: unknown bun filter ${packageName}`);
            continue;
        }

        const scripts = packageScripts.get(packageDir ?? "");
        if (scripts?.has(scriptName)) continue;
        // `bun run` also runs a package's local binary (wrangler, vitest).
        if (
            usesRun &&
            existsSync(
                join(root, packageDir ?? "", "node_modules/.bin", scriptName),
            )
        )
            continue;

        const target = packageName
            ? `${packageName}:${scriptName}`
            : scriptName;
        failures.push(
            `${docPath}: documented command \`${commandText}\` does not resolve to script ${target}`,
        );
    }
}

if (failures.length > 0) {
    console.error("Documented command check failed:");
    for (const failure of failures) {
        console.error(`  ${failure}`);
    }
    process.exit(1);
}

console.log("Documented command check passed.");

function listMarkdownFiles(relDir) {
    const absDir = join(root, relDir);
    if (!existsSync(absDir)) return [];
    return readdirSync(absDir, { recursive: true })
        .filter((entry) => entry.endsWith(".md"))
        .map((entry) => join(relDir, entry));
}

function documentedCommands(source) {
    const commands = [];
    // Pair inline code spans in order (with fenced blocks removed) so prose
    // like "bun 1.3" between two spans is not read as a command.
    const prose = source.replace(/```[\s\S]*?```/g, "");
    for (const match of prose.matchAll(/`([^`]+)`/g)) {
        if (/\bbun\s+/.test(match[1])) commands.push(match[1]);
    }
    for (const match of source.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)) {
        const block = match[1];
        for (const line of block.split("\n")) {
            const trimmed = line.trim();
            // Also catch commands after env vars or `&&`, e.g. `FOO=1 bun run ...`.
            if (/\bbun\s+/.test(trimmed)) {
                commands.push(trimmed);
            }
        }
    }
    return commands;
}
