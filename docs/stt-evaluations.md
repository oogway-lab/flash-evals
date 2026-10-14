# STT evaluations

## Gemini through OpenRouter

For local testing, set `OPENROUTER_API_KEY` in `apps/api/.env`, restart the dev
stack, and run the **Gemini 3.8 Flash** audio capability probe in Settings. A
successful probe enables the model in audio run setup and STT canvas nodes.
The route uses OpenRouter chat completions with audio input, an optional
language hint, and vocabulary guidance. It returns plain transcripts. Speaker
diarization and word timestamps are not supported by this adapter.

Each request carries at most 14 MB of WAV or MP3 audio and 10 minutes of
speech (`STT_OPENROUTER_AUDIO_MAX_BYTES`, `STT_AUDIO_MAX_CHUNK_MS`). Recordings
within both limits are sent unchanged. Larger or longer recordings, and other
formats, are converted on the worker to mono 16 kHz MP3 and, when still over a
limit, split into ordered chunks near silences. The stored upload is never
changed. Chunk transcripts are joined in order into one transcript, so
translation and summary nodes still receive one transcript per recording.
Preparation does not denoise or label speakers. A cut with no nearby silence
adds a warning to the transcript; check that boundary by ear.

Timeouts, rate limits, and provider 5xx errors are retried with backoff
(`STT_MAX_ATTEMPTS`, `STT_REQUEST_TIMEOUT_MS`); invalid audio and credential
errors fail at once. Completed chunks are saved, so a retry only transcribes the
chunks that are missing. A timed-out request may still be billed: the
transcript's metadata then has `costUncertain`, and the reported cost leaves
that request out rather than counting it as zero.

To recover a partial or failed pipeline run, choose **Retry failed cells** on
the run page. Failed cells and the cells they blocked run again. Successful
cells, reused transcripts, and the run's workflow snapshot are kept, and cell
cost shows only new spend.

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
