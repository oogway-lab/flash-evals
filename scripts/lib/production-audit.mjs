// `bun audit --prod` still reports packages reached only through a workspace's
// devDependencies (build tools such as OpenNext or drizzle-kit). These helpers
// rebuild the production dependency graph from bun.lock so the security gate
// only fails on advisories in code that ships, matching the old
// `pnpm audit --prod` behaviour.

const SEVERITY_RANK = { low: 0, moderate: 1, high: 2, critical: 3 };
const RUNTIME_FIELDS = [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
];

/**
 * The advisory map from a `spawnSync("bun", ["audit", "--json"])` result.
 * `bun audit` exits 1 both when it finds advisories (JSON on stdout) and when
 * it cannot run at all (registry or network error, nothing on stdout), so an
 * empty or unreadable report is an error, never "no advisories".
 */
export function readAuditReport({ status, signal, stdout, stderr, error }) {
    const detail = (stderr ?? "").trim();
    if (error) throw new Error(`Could not run \`bun audit\`: ${error.message}`);
    if (signal) throw new Error(`\`bun audit\` was stopped by ${signal}.`);
    const text = (stdout ?? "").trim();
    if (text === "") {
        if (status === 0) return {};
        throw new Error(
            `\`bun audit\` exited with code ${status} and no report.${detail ? `\n${detail}` : ""}`,
        );
    }
    let report;
    try {
        report = JSON.parse(text);
    } catch {
        throw new Error(
            `Could not read \`bun audit --json\` output.${detail ? `\n${detail}` : ""}`,
        );
    }
    if (report === null || typeof report !== "object" || Array.isArray(report))
        throw new Error("`bun audit --json` did not return an advisory map.");
    return report;
}

/** bun.lock is JSON with trailing commas. */
export function parseBunLock(text) {
    return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
}

/** Split a bun.lock package key ("a/@scope/b/c") into package names. */
export function keySegments(key) {
    const parts = key.split("/");
    const names = [];
    for (let i = 0; i < parts.length; i++) {
        if (parts[i].startsWith("@") && i + 1 < parts.length) {
            names.push(`${parts[i]}/${parts[i + 1]}`);
            i++;
        } else names.push(parts[i]);
    }
    return names;
}

/** The packages key a dependency of `parentKey` resolves to, nearest first. */
function resolveKey(packages, parentKey, name) {
    const segments = parentKey ? keySegments(parentKey) : [];
    for (let depth = segments.length; depth >= 0; depth--) {
        const key = [...segments.slice(0, depth), name].join("/");
        if (packages[key]) return key;
    }
    return undefined;
}

function runtimeDependencyNames(entry) {
    return RUNTIME_FIELDS.flatMap((field) => Object.keys(entry?.[field] ?? {}));
}

/** name → set of versions installed for production (no devDependencies). */
export function productionVersions(lock) {
    const packages = lock.packages ?? {};
    const workspaces = lock.workspaces ?? {};
    const versions = new Map();
    const seenKeys = new Set();
    const seenWorkspaces = new Set();
    const stack = [];

    const visitWorkspace = (path) => {
        if (seenWorkspaces.has(path)) return;
        seenWorkspaces.add(path);
        for (const name of runtimeDependencyNames(workspaces[path]))
            stack.push([undefined, name]);
    };
    for (const path of Object.keys(workspaces)) visitWorkspace(path);

    while (stack.length > 0) {
        const [parentKey, name] = stack.pop();
        const key = resolveKey(packages, parentKey, name);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        const [spec, , info] = packages[key];
        const at = spec.lastIndexOf("@");
        const version = spec.slice(at + 1);
        if (version.startsWith("workspace:")) {
            visitWorkspace(version.slice("workspace:".length));
            continue;
        }
        const set = versions.get(name) ?? new Set();
        set.add(version);
        versions.set(name, set);
        for (const child of runtimeDependencyNames(info))
            stack.push([key, child]);
    }
    return versions;
}

/**
 * Advisories at or above `level` that affect an installed production version.
 * `satisfies(version, range)` is injected so the CLI can use Bun.semver.
 */
export function productionAdvisories(audit, versions, satisfies, level) {
    const minimum = SEVERITY_RANK[level];
    const findings = [];
    for (const [name, advisories] of Object.entries(audit)) {
        const installed = [...(versions.get(name) ?? [])];
        for (const advisory of advisories) {
            if ((SEVERITY_RANK[advisory.severity] ?? 0) < minimum) continue;
            const affected = installed.filter((version) =>
                satisfies(version, advisory.vulnerable_versions),
            );
            if (affected.length > 0)
                findings.push({ name, versions: affected, advisory });
        }
    }
    return findings;
}
