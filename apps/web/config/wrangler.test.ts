import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Cloudflare Worker configuration", () => {
    it("targets the existing Worker with the OpenNext worker and asset paths", async () => {
        const source = await readFile(
            path.join(process.cwd(), "wrangler.jsonc"),
            "utf8",
        );
        const config = JSON.parse(source.replace(/,\s*([}\]])/g, "$1")) as {
            name: string;
            main: string;
            compatibility_flags: string[];
            assets: { directory: string; binding: string };
        };

        expect(config).toMatchObject({
            name: "flash-evals",
            main: ".open-next/worker.js",
            compatibility_flags: expect.arrayContaining(["nodejs_compat"]),
            assets: {
                directory: ".open-next/assets",
                binding: "ASSETS",
            },
        });
    });
});
