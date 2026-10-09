import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const sourceDirs = ["apps/web/app", "apps/web/components", "apps/web/lib"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const files = sourceDirs
    .flatMap((dir) => walk(join(root, dir)))
    .filter((file) => sourceExtensions.has(extname(file)))
    .filter((file) => hasUseClientDirective(readFileSync(file, "utf8")))
    .map((file) => relative(root, file));

const failures = [];

for (const file of files) {
    const source = readFileSync(join(root, file), "utf8");
    const imports = source.matchAll(/import\s+([^;]*?)\s+from\s+["'](@\/server\/[^"']+)["'];?/g);
    for (const match of imports) {
        const clause = match[1]?.trim() ?? "";
        const moduleName = match[2] ?? "";
        if (!clause.startsWith("type ")) {
            const line = source.slice(0, match.index).split("\n").length;
            failures.push(`${file}:${line} imports ${moduleName} as a runtime value`);
        }
    }
}

if (failures.length > 0) {
    for (const failure of failures) {
        console.log(`CLIENT SERVER IMPORT: ${failure}`);
    }
    process.exit(1);
}

console.log("Client/server import boundary check passed.");

function walk(dir) {
    return readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        const stats = statSync(path);
        return stats.isDirectory() ? walk(path) : [path];
    });
}

function hasUseClientDirective(source) {
    return /^\s*["']use client["']/.test(source);
}
