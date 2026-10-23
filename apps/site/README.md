# flashevals.dev

The public marketing site is authored in Astro and bundled into the existing
Next/OpenNext `flash-evals` Cloudflare Worker. There is one production deployment
for the marketing site, Clerk login, and dashboard. The Astro app has no runtime
server, database, or secrets.

## Develop

From the repository root, after `pnpm install --frozen-lockfile`:

```bash
pnpm --filter @flash-evals/site dev
```

Open <http://localhost:4321/marketing/> for the standalone design preview.
The login links point to the Next app and need the integrated preview below.
Content and illustrative demo data live in [`src/lib/content.ts`](src/lib/content.ts);
styles in [`src/styles/global.css`](src/styles/global.css); the run demo, stamps,
and copy buttons in [`src/scripts/site.ts`](src/scripts/site.ts). Demo numbers
are illustrative and labeled accordingly; keep that labeling intact.

## Build and preview

```bash
pnpm --filter @flash-evals/site typecheck
pnpm run marketing:build
pnpm --filter @flash-evals/web dev
```

The integration script builds `apps/site/dist`, bundles its complete HTML into
an ignored JSON module used by the Next root Route Handler, and copies only
fonts, scripts, styles and images to `apps/web/public/marketing`. It deliberately
does not publish `index.html` as a Cloudflare asset: static HTML normalization
must not redirect `/` away from the session-aware Next route.

Web development, typecheck, tests, normal build, and Cloudflare build all run the
integration script automatically. Rebuild/restart the integrated preview after
editing the Astro source. For a design-only static preview:

```bash
pnpm --filter @flash-evals/site build
pnpm --filter @flash-evals/site preview
```

## Routing and authentication

- Anonymous `/` returns the complete marketing document, without the app shell.
- Signed-in `/`, `/sign-in`, and `/sign-up` go to `/dashboard`.
- Successful Clerk sign-in/sign-up always goes to `/dashboard`, including a
  login started from a protected deep link. Return URLs cannot override it.
  The original protected link is accessible after login, including via Back.
- `/dashboard` renders the existing dashboard. Users with no workspace/project
  go to `/workspaces`; accounts failing company admission go to `/access-denied`.
- Sign-out returns to `/`; protected links require sign-in again.
- Public entry responses and authentication redirects are not cached.
- API authentication and verified-email/exact-domain admission are unchanged.
  Production admission still requires a verified `oogwaylabs.com` email.
- Double-opt-in localhost dev auth treats the visitor as signed in and takes
  `/` to `/dashboard`. Disable dev auth and configure Clerk to test anonymous
  and real authenticated routing interactively.

`tests/marketing` exercises anonymous routing, assets, accessibility, reduced
motion, no JavaScript, refresh and interrupted/repeated login navigation.
It uses synthetic Clerk keys and cannot prove a real login. The ordinary browser
smoke suite covers dashboard navigation/history using dev auth and a fake API.
Unit tests cover session transitions and redirect configuration with Clerk mocks.
A real Clerk login, sign-out and company-admission browser check remains a separate
integration gate; never describe these synthetic tests as that verification.

## Deploy

Use the existing web deployment; there is no standalone marketing Worker or
second apex-domain route configuration.

```bash
pnpm run web:build:cloudflare
pnpm run web:preview:cloudflare
```

The production deployment command remains the web app's existing
`deploy:cloudflare` script. Rollback uses the existing `flash-evals` Worker's
version history. No DNS or Clerk configuration change is needed for this integration.

## Headers and social image

The root document uses the existing web security headers. Marketing assets have
security and immutable hashed-asset caching rules in
[`../web/public/_headers`](../web/public/_headers). Fonts are self-hosted.
The canonical URL is `https://flashevals.dev/`; its social image is
`/marketing/og.png` (1200×630), with the original provenance embedded in the file.
