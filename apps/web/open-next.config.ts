import { defineCloudflareConfig } from "@opennextjs/cloudflare";

const cloudflareConfig = defineCloudflareConfig({
    cachePurge: "dummy",
    incrementalCache: "dummy",
    queue: "direct",
    tagCache: "dummy",
});

export default {
    ...cloudflareConfig,
    // Use Next's supported Webpack mode for the OpenNext production build.
    buildCommand: "pnpm exec next build --webpack",
};
