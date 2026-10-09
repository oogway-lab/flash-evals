import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
    cachePurge: "dummy",
    incrementalCache: "dummy",
    queue: "direct",
    tagCache: "dummy",
});
