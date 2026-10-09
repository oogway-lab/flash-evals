module.exports = {
    forbidden: [
        {
            name: "web-client-to-server-runtime",
            severity: "error",
            comment:
                "Client-side web modules must not import server runtime modules.",
            from: {
                path: "^apps/web/(app|components|lib)/",
                pathNot: "\\.test\\.(ts|tsx)$",
            },
            to: {
                path: "^apps/web/server/",
            },
        },
        {
            name: "api-to-web-app",
            severity: "error",
            comment: "Railway API code must not depend on the Cloudflare web app.",
            from: {
                path: "^apps/api/src/",
            },
            to: {
                path: "^apps/web/",
            },
        },
        {
            name: "packages-to-apps",
            severity: "error",
            comment: "Shared packages must remain app-agnostic.",
            from: {
                path: "^packages/",
            },
            to: {
                path: "^apps/",
            },
        },
    ],
    options: {
        doNotFollow: {
            path: "node_modules",
        },
        exclude: {
            path: [
                "node_modules",
                "dist",
                ".next",
                ".open-next",
                ".wrangler",
                "coverage",
                "apps/web/server/db/migrations",
            ].join("|"),
        },
        tsPreCompilationDeps: true,
        reporterOptions: {
            dot: {
                collapsePattern: "node_modules/[^/]+",
            },
        },
    },
};
