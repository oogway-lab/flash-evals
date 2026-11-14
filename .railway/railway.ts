import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
    const flashEvals = github("oogway-lab/flash-evals", {
        branch: "main",
        checkSuites: true,
    });

    const api = service("api", {
        source: flashEvals,
        build: {
            buildCommand: "bun run --filter @flash-evals/api build",
            buildEnvironment: "V3",
            builder: "RAILPACK",
        },
        start: "cd apps/api && NODE_ENV=production exec node ../../scripts/node-with-supabase-ca.mjs dist/railway.js",
        healthcheck: "/health",
        healthcheckTimeout: 300,
        preDeploy: "bun run db:migrate && bun run db:bootstrap-pilot-team",
        replicas: { "asia-southeast1-eqsg3a": 1 },
        deploy: { drainingSeconds: 30, ipv6EgressEnabled: true },
        domains: ["api.flashevals.dev"],
    });
    const worker = service("worker", {
        source: flashEvals,
        build: {
            buildCommand: "bun run --filter @flash-evals/api build",
            buildEnvironment: "V3",
            builder: "RAILPACK",
        },
        start: "cd apps/web && exec node ../../scripts/node-with-supabase-ca.mjs --import tsx scripts/worker.ts",
        preDeploy: [],
        replicas: { "asia-southeast1-eqsg3a": 1 },
        deploy: {
            drainingSeconds: 30,
            ipv6EgressEnabled: true,
            restartPolicyMaxRetries: 3,
        },
    });

    return project("flash-evals", {
        variables: { managed: false },
        resources: [api, worker],
    });
});
