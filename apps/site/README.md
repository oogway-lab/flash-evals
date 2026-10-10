# flashevals.dev

The public marketing site for Flash Evals: one static Astro page, served by
Cloudflare Workers static assets at `flashevals.dev` and `www.flashevals.dev`.
It has no server code, no database, and no secrets.

## Develop

From the repository root, after `pnpm install --frozen-lockfile`:

```bash
pnpm --filter @mosaic/site dev
```

Open <http://localhost:4321>. The page content and illustrative demo data live in
[`src/lib/content.ts`](src/lib/content.ts); styles in
[`src/styles/global.css`](src/styles/global.css); the run demo, stamps, and copy
buttons in [`src/scripts/site.ts`](src/scripts/site.ts). Every number in the demo
run is illustrative and is labeled that way on the page. Do not replace it with
claims (benchmarks, customers, stars, pricing) that are not real.

## Build and preview

```bash
pnpm --filter @mosaic/site build
```

The static output goes to `apps/site/dist`. To check it under the Cloudflare
runtime, including `_headers` and the 404 page:

```bash
pnpm --filter @mosaic/site preview
```

## Deploy

The Worker is defined in [`wrangler.jsonc`](wrangler.jsonc) as `flash-evals-site`.
It serves `dist/` as static assets and uses `404.html` for unknown paths.

1. Add `flashevals.dev` to the Cloudflare account as a zone, with its nameservers
   pointed at Cloudflare. The custom-domain routes in `wrangler.jsonc` need an
   active zone, and Wrangler creates the DNS records and certificates for them
   on first deploy.
2. Authenticate Wrangler once, with `pnpm --filter @mosaic/site exec wrangler login`,
   or set `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, plus Zone: DNS: Edit for
   the zone) and `CLOUDFLARE_ACCOUNT_ID` in CI.
3. Deploy:

    ```bash
    pnpm --filter @mosaic/site deploy
    ```

    This builds the site, then runs `wrangler deploy`.

4. Check <https://flashevals.dev> and <https://www.flashevals.dev>, a missing path
   (it should show the "not on this receipt" page), and the response headers.

To roll back, run `pnpm --filter @mosaic/site exec wrangler rollback`, or pick an
earlier version under the Worker's **Deployments** tab in the Cloudflare dashboard.

## Headers and caching

[`public/_headers`](public/_headers) sets a strict Content Security Policy (no
third-party origins; fonts are self-hosted from `@fontsource-variable`) and
long-lived immutable caching for the hashed files under `/_astro/`. If you add an
external script, image, or analytics host, add it to the CSP first.

## Social image

The page references `/og.png` (1200×630) for link previews. It is produced from
the page's own design; see the provenance note embedded in the file. Regenerate it
if the headline changes.
