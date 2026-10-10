import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Railway build config", () => {
    it("uses Railpack so the workspace pnpm version pin is honored", () => {
        const config = JSON.parse(
            readFileSync(
                new URL("../../../railway.json", import.meta.url),
                "utf8",
            ),
        ) as { build?: { builder?: string } };

        expect(config.build?.builder).toBe("RAILPACK");
    });

    it("keeps the standalone worker separate from the API HTTP process", () => {
        const worker = JSON.parse(
            readFileSync(
                new URL("../../../railway.worker.json", import.meta.url),
                "utf8",
            ),
        ) as {
            build: { builder: string; buildCommand: string };
            deploy: {
                startCommand: string;
                healthcheckPath: string | null;
                drainingSeconds: number;
                preDeployCommand?: string[];
            };
        };
        const api = JSON.parse(
            readFileSync(
                new URL("../../../railway.json", import.meta.url),
                "utf8",
            ),
        ) as { deploy: { startCommand: string; healthcheckPath: string } };

        expect(worker.build.builder).toBe("RAILPACK");
        expect(worker.build.buildCommand).toBe(
            "pnpm --filter @mosaic/api build",
        );
        expect(worker.deploy.startCommand).toBe(
            "cd apps/web && exec node ../../scripts/node-with-supabase-ca.mjs --import tsx scripts/worker.ts",
        );
        expect(worker.deploy.healthcheckPath).toBeNull();
        expect(worker.deploy.preDeployCommand).toBeUndefined();
        // The worker drains for 20 seconds plus a 5-second shutdown buffer.
        expect(worker.deploy.drainingSeconds).toBeGreaterThanOrEqual(25);
        expect(api.deploy.startCommand).toBe(
            "pnpm --filter @mosaic/api start:railway",
        );
        expect(api.deploy.healthcheckPath).toBe("/health");
    });
});
