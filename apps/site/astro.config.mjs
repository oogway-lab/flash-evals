import { defineConfig } from "astro/config";

export default defineConfig({
    site: "https://flashevals.dev",
    output: "static",
    base: "/marketing",
    trailingSlash: "ignore",
    build: { inlineStylesheets: "auto" },
});
