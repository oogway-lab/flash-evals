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
            comment:
                "Railway API code must not depend on the Cloudflare web app.",
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
        {
            name: "site-standalone",
            severity: "error",
            comment:
                "The Astro marketing site builds on its own with no workspace dependencies, so it must not import the web app, the API, or shared packages.",
            from: {
                path: "^apps/site/",
            },
            to: {
                path: "^apps/(web|api)/|^packages/",
            },
        },
        {
            name: "web-uses-built-marketing-output",
            severity: "error",
            comment:
                "The web app consumes the marketing site through the built output copied into public/marketing, never through its source.",
            from: {
                path: "^apps/web/",
            },
            to: {
                path: "^apps/site/",
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
