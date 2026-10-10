---
version: 1
slug: "apps-site-src-pages-index-astro"
primary_target: "apps/site/src/pages/index.astro"
related_targets: []
---

# flashevals.dev marketing site

Scope: `apps/site` (single landing page, `/`), static Astro on Cloudflare. Visitor mode: **Persuade**.

Audience: AI product engineers deciding which model/prompt to ship or switch to. Job: believe Flash Evals gives a repeatable, evidence-on-your-data comparison; action: self-host from GitHub (copy the clone command, open the getting-started guide). Proof: authored, labeled-illustrative demo run on a receipt-extraction dataset (mirrors the real seed). No customers, stars, benchmarks, pricing, or hosted plan may be claimed.

## Direction contract

THESIS: The page is one continuous thermal receipt roll feeding out of a printer slot: every model call itemized (input, field checks, score, latency, cost) and totalled. It refuses the dark dev-tool landing: centred headline, glowing screenshot, feature-card grid.

OWN-WORLD: Canary carbonless-copy yellow owns the ground. On it, one cool-white thermal paper roll with serrated tear edges. Thermal black-violet print, rubber-stamp violet for verdicts (MOST ACCURATE / FASTEST / CHEAPEST), end-of-roll pink for failures and crosses. Type: one variable-width mono for everything on the paper, prose included; headers in true double width. Geist Sans only for margin notes on the counter. Dashed rules, asterisk dividers, and a real Code 128 barcode at the end.

STORY: The visitor watches one input get itemized across three models. Then they see the run subtotalled into a leaderboard with stamps, read the capability line items, the audio and agent copies, then the "how to pay" self-host steps. They copy the clone command.

FIRST VIEWPORT: A centred ~704px receipt column with a serrated top edge. Masthead printed in real thermal double width (condensed glyphs, 2× horizontal): FLASH EVALS. Under it, the meta lines (self-hosted model evaluation · flashevals.dev · AGPL-3.0-only · early alpha), an asterisk rule, and the run line. Then a huge printed headline, "PICK YOUR MODEL ON YOUR DATA. KEEP THE RECEIPTS." (up to 64px). Then the pitch, in the receipt mono. The primary action is the clone command with a perforated COPY tear-tab, plus "Read the setup guide" and "View the source" links. Margin notes sit on the yellow at ≥1360px; below that they become slips on the paper. Cited adaptation: the printer is fixed to the viewport bottom, not the top, so scrolling down makes paper emerge from its slot. Its panel carries the persistent copy-clone CTA and a status LCD. Cited adaptation: the planned margin AGPL stamp folded into the masthead meta line; stamps are reserved for leaderboard verdicts, which print in their own column on the paper.

FORM: Keep the Receipts, rank 1 on my ordered list (taken as Impeccable's pick over the assigned Departures Board); seed key e7ad5b07. Signature interaction: the roll prints line by line as it feeds (scroll-linked), and stamps slam onto the subtotal. Motion grammar: paper feed, line print, stamp impact; nothing floats.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Logo/wordmark does not exist; the double-width printed name stands in.
