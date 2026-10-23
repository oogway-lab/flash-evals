import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { URL, fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const build = spawnSync("pnpm", ["--filter", "@flash-evals/site", "build"], {
    cwd: root,
    stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

const dist = path.join(root, "apps/site/dist");
const assets = path.join(root, "apps/web/public/marketing");
const generated = path.join(root, "apps/web/generated");
const html = await readFile(path.join(dist, "index.html"), "utf8");

await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await mkdir(generated, { recursive: true });
// Bundle HTML in the route, not as a static HTML asset: Cloudflare's HTML URL
// normalization must not redirect / to /marketing or skip session middleware.
await writeFile(
    path.join(generated, "marketing.json"),
    JSON.stringify({ html }),
);
for (const file of ["_astro", "favicon.svg", "og.png", "robots.txt"]) {
    await cp(path.join(dist, file), path.join(assets, file), {
        recursive: true,
    });
}
