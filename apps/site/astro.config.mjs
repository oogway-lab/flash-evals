import { defineConfig } from "astro/config";

export default defineConfig({
    site: "https://flashevals.dev",
    output: "static",
    trailingSlash: "ignore",
    build: { inlineStylesheets: "auto" },
});
