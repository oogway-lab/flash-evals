import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));
// Value imports and re-exports only: `import type` is erased at build time.
const importPattern =
    /(?:import|export)\s+(?!type\s)[^"';]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** Every module the file reaches through relative imports, with what it imports. */
function reachableImports(entry: string): Map<string, string[]> {
    const seen = new Map<string, string[]>();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.shift()!;
        if (seen.has(file)) continue;
        const source = readFileSync(file, "utf8");
        const specifiers: string[] = [];
        for (const match of source.matchAll(importPattern)) {
            const specifier = match[1] ?? match[2];
            if (specifier) specifiers.push(specifier);
        }
        seen.set(file, specifiers);
        for (const specifier of specifiers) {
            if (!specifier.startsWith(".")) continue;
            const target = resolve(
                dirname(file),
                specifier.replace(/\.js$/, ".ts"),
            );
            queue.push(target);
        }
    }
    return seen;
}

describe("the main llm-core entry", () => {
    it("pulls in no node: built-ins, so client components can import it", () => {
        const graph = reachableImports(join(srcDir, "index.ts"));
        const offenders = [...graph.entries()].flatMap(([file, specifiers]) =>
            specifiers
                .filter((specifier) => specifier.startsWith("node:"))
                .map(
                    (specifier) =>
                        `${file.slice(srcDir.length + 1)} → ${specifier}`,
                ),
        );
        expect(offenders).toEqual([]);
    });
});
