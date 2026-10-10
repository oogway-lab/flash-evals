# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Product app: existing monorepo (Next.js web on Cloudflare Workers, Node API and worker, PostgreSQL). Marketing site: `apps/site`, static Astro build deployed to Cloudflare at `flashevals.dev` (confirmed by the user).

## Users

Primary: AI product engineers shipping LLM-backed features (structured extraction, classification, agents, voice) who have to decide which model, prompt, or configuration to ship, or whether a cheaper/newer model is safe to switch to, using their own examples rather than public leaderboards. They are comfortable with a terminal, Git, Docker, and environment files.

## Product Purpose

Flash Evals is a self-hosted evaluation workbench. A team brings a dataset of its own text, image, or audio examples, describes the task in a prompt, and runs several models across it. Each run keeps inputs, outputs, scores, latency, and estimated cost together so the team can see which approach wins and inspect why, case by case. Success: an engineer replaces "vibes and a spreadsheet" with a repeatable, auditable comparison before shipping or switching a model.

## Positioning

- Your examples, not benchmarks: comparisons run on the application's own data.
- Quality, latency, and cost recorded side by side for every dataset item × model cell, with a per-model leaderboard.
- One workbench for text, image, and speech-to-text, including transcript accuracy and (where supported) speaker diarization.
- Agent-native: an MCP server exposes the same datasets, prompts, runs, and review notes (88 tools) to MCP-compatible agents.
- Self-hosted and open source (AGPL-3.0-only); data goes only to the providers the team selects.

## Operating Context

Engineers clone the repo, run `pnpm run setup:local`, start PostgreSQL with Docker Compose, migrate, seed synthetic examples, and run `pnpm run dev` (web :3000, API :3001, worker). Real model calls need a provider key, by default `OPENROUTER_API_KEY`. Core vocabulary: dataset, prompt, run (Eval Run), run cell, leaderboard, judge, workflow, STT metrics run, config variants.

## Capabilities and Constraints

- Structured-output scoring against reference labels with field-level diffs; LLM-as-judge against a rubric.
- Prompt workflows: directed graphs of prompt steps; STT canvas with STT, LLM text, transliteration, judge, and metric nodes.
- STT metrics runs compare 1–6 config variants (model, language hint, keyword boost, diarization).
- Providers: OpenRouter, OpenAI, Vercel AI Gateway, Soniox (STT). Result reuse avoids repaying for identical calls.
- Review: per-result notes and annotations.
- Cost figures are estimates; spending limits use recorded usage.
- Early-stage alpha with breaking changes; not a managed service. No hosted offering exists.
- Internal identifiers keep the `mosaic` name (`@mosaic/*`, `MOSAIC_*`, `mosaic://`).

## Brand Commitments

Name: Flash Evals. Publisher: Oogway Labs Private Limited. License: AGPL-3.0-only. Repository: https://github.com/oogway-lab/flash-evals. Domain: flashevals.dev. No logo exists yet. The product app follows a Geist-based monochrome workbench system (root `DESIGN.md`); it must not use Vercel's wordmark or logo.

## Evidence on Hand

- Seeded synthetic workspace: receipt-extraction examples with placeholder images and fixture outputs (`apps/web/scripts/seed.ts`). Not a benchmark.
- Documentation: `README.md`, `CONCEPTS.md`, `docs/`.
- None of the following exist and must not be fabricated: customers, logos, testimonials, benchmark results, user counts, GitHub star counts, pricing, a hosted plan. Demo data on the site is authored and labeled illustrative.

## Product Principles

1. Decide on evidence from your own data, never on a leaderboard.
2. Keep the receipts: every score stays attached to its input, output, latency, and cost.
3. Honest about state: alpha, self-hosted, estimates labeled as estimates.
4. Humans and agents share one workbench.
