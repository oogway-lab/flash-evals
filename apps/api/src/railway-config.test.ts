import { describe, expect, it } from "vitest";

interface IRailwayService {
    type: string;
    name: string;
    build?: { builder?: string; buildCommand?: string };
    deploy?: {
        startCommand?: string;
        preDeployCommand?: string[];
        healthcheckPath?: string;
        drainingSeconds?: number;
    };
}

type RailwayProgram = (
    ctx: { environment: string },
    project: (name: string, definition: object) => object,
) => Promise<{ resources: IRailwayService[] }>;

// Evaluates .railway/railway.ts the way `railway config plan` does: the file
// builds its own resources, so a minimal context and project are enough.
async function railwayServices(): Promise<Map<string, IRailwayService>> {
    const program = (
        (await import(
            new URL("../../../.railway/railway.ts", import.meta.url).href
        )) as { default: RailwayProgram }
    ).default;
    const definition = await program(
        { environment: "production" },
        (name, rest) => ({ name, ...rest }),
    );
    return new Map(
        definition.resources
            .filter((resource) => resource.type === "service")
            .map((resource) => [resource.name, resource]),
    );
}

describe("Railway infrastructure config", () => {
    it("declares exactly the API and worker services", async () => {
        expect([...(await railwayServices()).keys()].sort()).toEqual([
            "api",
            "worker",
        ]);
    });

    it("builds both services with Railpack so the Bun pin is honored", async () => {
        for (const service of (await railwayServices()).values()) {
            expect(service.build?.builder).toBe("RAILPACK");
            expect(service.build?.buildCommand).toBe(
                "bun run --filter @flash-evals/api build",
            );
        }
    });

    it("runs migrations before the API starts, with Bun", async () => {
        const api = (await railwayServices()).get("api");

        expect(api?.deploy?.preDeployCommand).toEqual([
            "bun run db:migrate && bun run db:bootstrap-pilot-team",
        ]);
        expect(api?.deploy?.healthcheckPath).toBe("/health");
    });

    it("never calls pnpm, which the Bun image does not contain", async () => {
        for (const service of (await railwayServices()).values()) {
            expect(JSON.stringify(service)).not.toMatch(/\bpnpm\b/);
        }
    });

    it("keeps the standalone worker separate from the API HTTP process", async () => {
        const services = await railwayServices();
        const api = services.get("api");
        const worker = services.get("worker");

        expect(worker?.deploy?.startCommand).toBe(
            "cd apps/web && exec node ../../scripts/node-with-supabase-ca.mjs --import tsx scripts/worker.ts",
        );
        expect(worker?.deploy?.healthcheckPath).toBeUndefined();
        expect(worker?.deploy?.preDeployCommand ?? []).toEqual([]);
        // The worker drains for 20 seconds plus a 5-second shutdown buffer.
        expect(worker?.deploy?.drainingSeconds).toBeGreaterThanOrEqual(25);
        // Node runs directly so Railway's SIGTERM reaches the process that
        // drains, not a package-manager wrapper.
        expect(api?.deploy?.startCommand).toBe(
            "cd apps/api && NODE_ENV=production exec node ../../scripts/node-with-supabase-ca.mjs dist/railway.js",
        );
    });
});
