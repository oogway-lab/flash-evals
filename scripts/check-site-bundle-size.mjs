import { Buffer } from "node:buffer";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const dist = fileURLToPath(new URL("../apps/site/dist/", import.meta.url));
const maxScriptBytes = 100 * 1024;
const maxTotalBytes = 200 * 1024;
const scripts = [];

for (const htmlFile of findFiles(dist, (file) => file.endsWith(".html"))) {
    const html = readFileSync(htmlFile, "utf8");
    const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let match;
    let inlineIndex = 0;

    while ((match = scriptTag.exec(html))) {
        const [, attributes, content] = match;
        const type = attributes.match(/\btype=["']([^"']+)["']/i)?.[1];
        if (
            type &&
            !/^(module|text\/javascript|application\/javascript)$/i.test(type)
        ) {
            continue;
        }

        const source = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1];
        if (source) {
            const sourcePath = new URL(source, "https://site.invalid").pathname
                .replace(/^\/marketing\/?/, "")
                .replace(/^\/+/, "");
            const asset = path.resolve(dist, sourcePath);
            if (!asset.startsWith(`${path.resolve(dist)}${path.sep}`)) {
                throw new Error(`Marketing script escapes dist: ${source}`);
            }
            if (!existsSync(asset)) {
                throw new Error(
                    `The built HTML references a missing script: ${source}`,
                );
            }
            scripts.push({
                name: path.relative(dist, asset),
                bytes: statSync(asset).size,
            });
        } else {
            inlineIndex += 1;
            scripts.push({
                name: `${path.relative(dist, htmlFile)}#inline-${inlineIndex}`,
                bytes: Buffer.byteLength(content),
            });
        }
    }
}

if (scripts.length === 0) {
    throw new Error("No browser JavaScript found in the Astro build output.");
}

const totalBytes = scripts.reduce((sum, script) => sum + script.bytes, 0);
console.log(
    `Marketing JavaScript: ${scripts.length} script(s), ${formatBytes(totalBytes)} / ${formatBytes(maxTotalBytes)} total.`,
);
for (const script of scripts) {
    console.log(`  ${formatBytes(script.bytes)} ${script.name}`);
}

const oversized = scripts.filter((script) => script.bytes > maxScriptBytes);
if (oversized.length > 0 || totalBytes > maxTotalBytes) {
    console.error(
        `JavaScript budget exceeded: each script must stay below ${formatBytes(maxScriptBytes)} and total JavaScript below ${formatBytes(maxTotalBytes)}.`,
    );
    process.exitCode = 1;
}

function findFiles(directory, predicate) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return findFiles(entryPath, predicate);
        return predicate(entryPath) ? [entryPath] : [];
    });
}

function formatBytes(bytes) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
}
