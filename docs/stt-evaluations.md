# STT evaluations

## Gemini through OpenRouter

For local testing, set `OPENROUTER_API_KEY` in `apps/api/.env`, restart the dev
stack, and run the **Gemini 3.8 Flash** audio capability probe in Settings. A
successful probe enables the model in audio run setup and STT canvas nodes.
The route uses OpenRouter chat completions with audio input; it supports WAV
and MP3 files up to 14 MB, an optional language hint, and vocabulary guidance.
It returns plain transcripts. Speaker diarization and word timestamps are not
supported by this adapter.

Use `google/gemini-3.8-flash` for the optional transliteration and transcript
judge models too. Latin transcript scoring requires an
`expectedTranscriptLatin` reference; native transcript scoring uses
`expectedTranscript`. A missing reference skips that metric.

## Config variants

An STT metrics run can compare one to six configuration variants. Each variant
has its own label, model, language hint, and provider-supported fields. Use
**Duplicate** to copy a variant before changing one axis such as diarization,
language, prompt, temperature, or keyword boost. Every variant creates its own
transcript and metric cells; adding variants therefore multiplies provider cost
for every audio item.

Keyword boost is provider-aware. Soniox receives the terms in its native
`context` field. OpenAI transcription routes that accept an initial prompt get
the same comma-separated terms appended as plain transcript-like vocabulary.
Routes with neither surface do not show the field. The thinking-token budget is
defined for audio-understanding routes but remains unavailable until one of
those routes is live-verified.

Transliteration and the custom transcript judge are shared across all variants
in the run. Results use the variant labels in the leaderboard, matrix, and
transcript views. When variants share a base model, badges call out every config
value that differs.

## Importing gold answers

The gold-answer wizard accepts JSON arrays, keyed JSON objects, and JSONL. It
detects input fields and proposes common aliases such as `gt`, `ground_truth`,
`reference`, or `transcript` for `expectedTranscript`. Review or change every
mapping, then inspect the per-row preview before committing. Invalid rows and
unmatched filenames remain uncommitted and include a specific diagnostic; a
same-stem filename with a different extension is offered as a near-match.

Audio dataset items show separate coverage badges for the native transcript,
Latin transcript, and speaker turns. A missing transcript badge means
deterministic transcript scoring will skip that item, even if another reference
field is present.

## Canvas workflows

The `/stt-evals` canvas composes reusable audio-evaluation branches from five
node types: STT, LLM text, transliteration, judge, and metric comparison. Every
branch begins at an STT root and may fan out, but a downstream node belongs to
exactly one STT root. This prevents cross-root fan-in from overwriting results,
because a workflow run stores one cell per node and dataset item.

STT nodes carry their own full transcription configuration. Duplicate a root
to compare a second configuration, then connect an independent downstream
chain. Metric nodes explicitly select `expectedTranscript` or
`expectedTranscriptLatin`; judge nodes run even when an item has no gold label,
which supports rubrics such as PII or OTP leakage checks.

Canvas runs use the same workflow tables, worker, artifact cache, and progress
API as prompt workflows. The run snapshot freezes node types, configs, and
edges. Prompt workflows retain their existing connected graph and optional
run-level audio pre-stage; STT canvas workflows execute transcription inside
each STT cell and do not create legacy workflow preparation rows.

The API route capability probe uses a generated non-speech tone to check request compatibility. It does not measure transcription quality; use the evaluation workflow with a consented test dataset for that.
